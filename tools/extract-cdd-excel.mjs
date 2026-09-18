#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import xlsx from 'xlsx';

const DEFAULT_OUTPUT = 'src/app/equipment-builder/data/cdd-sequence-catalog.json';
const DEFAULT_REPORT = 'src/app/equipment-builder/data/cdd-sequence-catalog.report.json';
const POINT_COLUMN_PATTERN = /^(BO|BI|AO|AI|UI|DO|DI|RO|RI)(?:\s+\w+)?\s+Point$/i;
const DETAIL_COLUMN_PATTERN = /Details?\s*\(Point\s*(?:➔|->|=>|>)\s*Name\s*&\s*Tag\)/i;
const MAP_COLUMN_PATTERN = /\bMap\b/i;
const SPARE_COLUMN_PATTERN = /^Spare\s+/i;
const NON_MATCH_COLUMNS = new Set(['Scenario #', 'Hardware Status']);

main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputFiles = expandInputs(args.inputs);

  if (inputFiles.length === 0) {
    fail('Usage: npm run extract:cdd -- --input "/path/file.xlsx" [--input "/path/other.xlsx"]');
  }

  const errors = [];
  const warnings = [];
  const sequences = inputFiles.map((filePath) => extractWorkbook(filePath, errors, warnings));

  const catalog = {
    generatedAt: new Date().toISOString(),
    sourceWorkbooks: inputFiles.map((filePath) => path.basename(filePath)),
    sequences,
  };
  const report = {
    generatedAt: catalog.generatedAt,
    sourceWorkbooks: inputFiles,
    sequenceCount: sequences.length,
    scenarioCount: sequences.reduce((total, sequence) => total + sequence.scenarios.length, 0),
    sequences: sequences.map((sequence) => ({
      sequenceId: sequence.sequenceId,
      sequenceName: sequence.sequenceName,
      sourceWorkbook: sequence.sourceWorkbook,
      sourceSheet: sequence.sourceSheet,
      dimensions: sequence.dimensions,
      pointGroups: sequence.pointGroups,
      scenarioCount: sequence.scenarios.length,
      coverage: sequence.coverage,
    })),
    errors,
    warnings,
  };

  writeJson(args.output ?? DEFAULT_OUTPUT, catalog);
  writeJson(args.report ?? DEFAULT_REPORT, report);

  if (errors.length > 0) {
    console.error(`CDD extraction failed with ${errors.length} error(s).`);
    console.error(`Report: ${path.resolve(args.report ?? DEFAULT_REPORT)}`);
    process.exit(1);
  }

  console.log(`CDD sequence catalog written: ${path.resolve(args.output ?? DEFAULT_OUTPUT)}`);
  console.log(`Validation report written: ${path.resolve(args.report ?? DEFAULT_REPORT)}`);
  console.log(`Sequences extracted: ${sequences.length}`);
  console.log(`Scenarios extracted: ${report.scenarioCount}`);
  if (warnings.length > 0) console.warn(`Warnings: ${warnings.length}`);
}

function extractWorkbook(filePath, errors, warnings) {
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const sequenceName = discoverSequenceName(workbook);
  const scenarioSheet = discoverScenarioSheet(workbook);

  if (!scenarioSheet) {
    errors.push(`${path.basename(filePath)}: no scenario table with "Scenario #" header was found.`);
    return emptySequence(filePath, sequenceName);
  }

  const rows = rowsFromSheet(workbook.Sheets[scenarioSheet.name]);
  const headers = scenarioSheet.headers;
  const pointGroups = discoverPointGroups(headers);
  const dimensions = discoverDimensions(headers, pointGroups);
  const pointTableTemplate = discoverPointTableTemplate(workbook);
  const scenarios = rows
    .slice(scenarioSheet.headerIndex + 1)
    .filter((row) => cell(row, headers, 'Scenario #') !== '')
    .map((row, rowOffset) => normalizeScenario({
      row,
      headers,
      pointGroups,
      dimensions,
      excelRowNumber: scenarioSheet.headerIndex + rowOffset + 2,
      errors,
      warnings,
    }));

  validateSequence({
    filePath,
    scenarios,
    dimensions,
    errors,
    warnings,
  });

  return {
    sequenceId: slugify(sequenceName || path.basename(filePath, path.extname(filePath))),
    sequenceName: sequenceName || path.basename(filePath, path.extname(filePath)),
    sourceWorkbook: path.basename(filePath),
    sourceSheet: scenarioSheet.name,
    dimensions,
    pointGroups: pointGroups.map((group) => ({
      key: group.key,
      ioType: group.ioType,
      pointColumn: group.pointColumn ?? null,
      detailColumn: group.detailColumn ?? null,
      mapColumn: group.mapColumn ?? null,
      descriptionColumn: group.descriptionColumn ?? null,
      tagColumn: group.tagColumn ?? null,
      rangeColumn: group.rangeColumn ?? null,
    })),
    pointTableTemplate,
    coverage: summarizeCoverage(scenarios, dimensions),
    scenarios,
  };
}

function discoverPointTableTemplate(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const rows = rowsFromSheet(workbook.Sheets[sheetName]);
    const titleIndex = rows.findIndex((row) => row.some((item) => /DYNAMIC CDD GENERATION/i.test(value(item))));
    if (titleIndex < 0) continue;

    const headerIndex = rows.findIndex((row, index) => (
      index > titleIndex && value(row[0]).toUpperCase() === 'DESCRIPTION' && value(row[1]).toUpperCase() === 'POINT'
    ));
    if (headerIndex < 0) continue;

    return {
      rows: rows
      .slice(headerIndex + 1)
      .filter((row) => value(row[0]) || value(row[1]) || value(row[2]) || value(row[3]) || value(row[4]))
      .map((row) => pointTableTemplateRow(row)),
    };
  }

  return { rows: [] };
}

function pointTableTemplateRow(row) {
  const description = value(row[0]);
  const point = value(row[1]);
  const tag = value(row[2]);
  const deviceRange = value(row[3]);
  const manufacturerPartNumber = value(row[4]);
  const terminal = terminalFromPoint(point);
  const base = {
    type: terminal ? 'terminal' : 'fixed',
    description,
    point,
    tag,
    deviceRange,
    manufacturerPartNumber,
  };

  if (terminal) {
    return {
      type: 'terminal',
      terminal,
      point,
      spareDescription: description.toUpperCase() === 'SPARE' ? description : 'SPARE',
      spareTag: description.toUpperCase() === 'SPARE' ? tag : '-',
      spareDeviceRange: description.toUpperCase() === 'SPARE' ? deviceRange : '-',
    };
  }

  return {
    ...base,
    spare: description.toUpperCase() === 'SPARE',
    shaded: /^24VAC R|^24 VAC R|AUXILIARY RELAY/i.test(description),
    bold: /^24VAC R|^24 VAC R|AUXILIARY RELAY/i.test(description),
  };
}

function terminalFromPoint(point) {
  const match = value(point).match(/^(UI|AO|BO|AI|BI|DO|DI)\d+/i);
  return match ? match[0].toUpperCase() : null;
}

function discoverScenarioSheet(workbook) {
  const candidates = [];

  for (const sheetName of workbook.SheetNames) {
    const rows = rowsFromSheet(workbook.Sheets[sheetName]);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const normalized = rows[rowIndex].map(value);
      if (!normalized.includes('Scenario #')) continue;

      const score = normalized.filter((header) => (
        POINT_COLUMN_PATTERN.test(header) ||
        DETAIL_COLUMN_PATTERN.test(header) ||
        SPARE_COLUMN_PATTERN.test(header) ||
        MAP_COLUMN_PATTERN.test(header)
      )).length;

      candidates.push({
        name: sheetName,
        headerIndex: rowIndex,
        headers: normalized,
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ?? null;
}

function discoverSequenceName(workbook) {
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const firstRow = rowsFromSheet(firstSheet)[0] ?? [];
  return value(firstRow.find((item) => value(item) !== ''));
}

function discoverPointGroups(headers) {
  const groups = [];
  const usedDetailColumns = new Set();
  const usedMapColumns = new Set();

  for (const pointColumn of headers.filter((header) => POINT_COLUMN_PATTERN.test(header))) {
    const key = pointColumn.replace(/\s+Point$/i, '').trim();
    groups.push({
      key,
      ioType: ioTypeFromKey(key),
      pointColumn,
      descriptionColumn: findSibling(headers, key, ['Description']),
      tagColumn: findSibling(headers, key, ['Tag']),
      rangeColumn: findSibling(headers, key, ['Range', 'Device Range']),
    });
  }

  for (const detailColumn of headers.filter((header) => DETAIL_COLUMN_PATTERN.test(header))) {
    const mapColumn = nearestUnusedMapColumn(headers, detailColumn, usedMapColumns);
    const key = detailColumn.replace(/\s*Details?.*/i, '').trim();
    usedDetailColumns.add(detailColumn);
    if (mapColumn) usedMapColumns.add(mapColumn);

    groups.push({
      key,
      ioType: ioTypeFromKey(key),
      mapColumn,
      detailColumn,
    });
  }

  return groups.filter((group, index, allGroups) => (
    index === allGroups.findIndex((candidate) => (
      candidate.key === group.key &&
      candidate.pointColumn === group.pointColumn &&
      candidate.detailColumn === group.detailColumn
    ))
  ));
}

function discoverDimensions(headers, pointGroups) {
  const pointColumns = new Set();
  for (const group of pointGroups) {
    [
      group.pointColumn,
      group.descriptionColumn,
      group.tagColumn,
      group.rangeColumn,
      group.mapColumn,
      group.detailColumn,
    ].filter(Boolean).forEach((column) => pointColumns.add(column));
  }

  return headers.filter((header) => (
    header &&
    !NON_MATCH_COLUMNS.has(header) &&
    !SPARE_COLUMN_PATTERN.test(header) &&
    !MAP_COLUMN_PATTERN.test(header) &&
    !pointColumns.has(header)
  ));
}

function normalizeScenario(options) {
  const scenario = toNumber(cell(options.row, options.headers, 'Scenario #'));
  const match = Object.fromEntries(options.dimensions.map((dimension) => [
    camelCase(dimension),
    typedValue(cell(options.row, options.headers, dimension)),
  ]));
  const pointGroups = Object.fromEntries(options.pointGroups.map((group) => [
    camelCase(group.key),
    extractPointGroup(options.row, options.headers, group, options.excelRowNumber, options.errors),
  ]));
  const points = Object.values(pointGroups).flat();
  const spares = Object.fromEntries(options.headers
    .filter((header) => SPARE_COLUMN_PATTERN.test(header))
    .map((header) => [camelCase(header), expandRangeCell(cell(options.row, options.headers, header))]));

  if (!Number.isInteger(scenario)) {
    options.errors.push(`Row ${options.excelRowNumber}: Scenario # is missing or invalid.`);
  }

  return {
    scenario,
    sourceRow: options.excelRowNumber,
    match,
    pointGroups,
    spares,
    points,
    raw: Object.fromEntries(options.headers.map((header, index) => [header || `Column ${index + 1}`, value(options.row[index])])),
  };
}

function extractPointGroup(row, headers, group, excelRowNumber, errors) {
  if (group.detailColumn) {
    return splitLines(cell(row, headers, group.detailColumn))
      .map((line) => parseDetailPoint(line, group.ioType, group.key))
      .filter(Boolean);
  }

  const terminals = splitLines(cell(row, headers, group.pointColumn));
  const descriptions = splitLines(cell(row, headers, group.descriptionColumn));
  const tags = splitLines(cell(row, headers, group.tagColumn));
  const ranges = splitLines(cell(row, headers, group.rangeColumn));
  const presentLengths = [terminals, descriptions, tags, ranges]
    .filter((items) => items.length > 0)
    .map((items) => items.length);

  if (presentLengths.some((length) => length !== presentLengths[0])) {
    errors.push(
      `Row ${excelRowNumber}: ${group.key} multiline values are not aligned ` +
      `(point=${terminals.length}, description=${descriptions.length}, tag=${tags.length}, range=${ranges.length}).`,
    );
  }

  return terminals.map((terminal, index) => ({
    terminal,
    ioType: group.ioType,
    point: terminal,
    description: descriptions[index] ?? '',
    tag: tags[index] ?? '',
    deviceRange: ranges[index] ?? '',
    sourceGroup: group.key,
  }));
}

function parseDetailPoint(line, ioType, sourceGroup) {
  const text = value(line);
  if (!text || /^none$/i.test(text)) return null;

  const match = text.match(/^(.+?)\s*(?:➔|->|=>|>)\s*(.+?)\s*\((.+?)\)\s*$/);
  if (!match) {
    return {
      terminal: text,
      ioType,
      point: text,
      description: '',
      tag: '',
      deviceRange: '',
      sourceGroup,
    };
  }

  const terminal = value(match[1]);
  return {
    terminal,
    ioType,
    point: terminal,
    description: value(match[2]),
    tag: value(match[3]),
    deviceRange: '',
    sourceGroup,
  };
}

function validateSequence(options) {
  const scenarioNumbers = new Map();
  const combinationKeys = new Map();

  for (const scenario of options.scenarios) {
    addUnique(scenarioNumbers, scenario.scenario, `${path.basename(options.filePath)} Scenario # ${scenario.scenario}`, scenario.sourceRow, options.errors);
    addUnique(combinationKeys, JSON.stringify(scenario.match), `${path.basename(options.filePath)} combination ${JSON.stringify(scenario.match)}`, scenario.sourceRow, options.errors);
    validateScenarioPoints(options.filePath, scenario, options.warnings);
  }
}

function validateScenarioPoints(filePath, scenario, warnings) {
  for (const point of scenario.points) {
    if (!point.terminal) warnings.push(`${path.basename(filePath)} row ${scenario.sourceRow}: point terminal is blank.`);
    if (!point.description) warnings.push(`${path.basename(filePath)} row ${scenario.sourceRow}: ${point.terminal} description is blank.`);
    if (!point.tag) warnings.push(`${path.basename(filePath)} row ${scenario.sourceRow}: ${point.terminal} tag is blank.`);
  }
}

function summarizeCoverage(scenarios, dimensions) {
  return {
    valuesByDimension: Object.fromEntries(dimensions.map((dimension) => {
      const key = camelCase(dimension);
      return [key, uniqueSorted(scenarios.map((scenario) => scenario.match[key]))];
    })),
    actualCount: scenarios.length,
  };
}

function nearestUnusedMapColumn(headers, detailColumn, usedMapColumns) {
  const detailIndex = headers.indexOf(detailColumn);
  for (let index = detailIndex - 1; index >= 0; index -= 1) {
    const header = headers[index];
    if (MAP_COLUMN_PATTERN.test(header) && !usedMapColumns.has(header)) return header;
    if (DETAIL_COLUMN_PATTERN.test(header)) break;
  }
  return null;
}

function findSibling(headers, key, suffixes) {
  return headers.find((header) => (
    suffixes.some((suffix) => new RegExp(`^${escapeRegExp(key)}\\s+${escapeRegExp(suffix)}$`, 'i').test(header))
  )) ?? null;
}

function ioTypeFromKey(key) {
  const upper = key.toUpperCase();
  if (upper.startsWith('BO') || upper.includes('CMD')) return 'Digital Output';
  if (upper.startsWith('AO')) return 'Analog Output';
  if (upper.startsWith('UI') || upper.includes('STATUS') || upper.includes('INTERLOCK')) return 'Digital Input';
  if (upper.startsWith('AI')) return 'Analog Input';
  return 'Point';
}

function expandInputs(inputs) {
  return inputs.flatMap((input) => {
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) fail(`Input not found: ${input}`);
    const stat = fs.statSync(resolved);

    if (stat.isDirectory()) {
      return fs.readdirSync(resolved)
        .filter((entry) => /\.xlsx$/i.test(entry) && !entry.startsWith('~$'))
        .map((entry) => path.join(resolved, entry));
    }

    return [resolved];
  });
}

function parseArgs(args) {
  const parsed = { inputs: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--input') parsed.inputs.push(args[++index]);
    else if (arg === '--output') parsed.output = args[++index];
    else if (arg === '--report') parsed.report = args[++index];
    else if (!arg.startsWith('--')) parsed.inputs.push(arg);
    else fail(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function rowsFromSheet(sheet) {
  return xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });
}

function cell(row, headers, header) {
  if (!header) return '';
  const index = headers.indexOf(header);
  return index >= 0 ? value(row[index]) : '';
}

function splitLines(input) {
  const text = value(input);
  if (!text || /^none$/i.test(text)) return [];
  return text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function expandRangeCell(input) {
  const text = value(input);
  if (!text || /^none$/i.test(text)) return [];

  const rangeMatch = text.match(/^([A-Z]+)(\d+)\s+to\s+\1(\d+)$/i);
  if (!rangeMatch) return splitLines(text);

  const prefix = rangeMatch[1].toUpperCase();
  const start = Number(rangeMatch[2]);
  const end = Number(rangeMatch[3]);
  const step = start <= end ? 1 : -1;
  const items = [];

  for (let current = start; step > 0 ? current <= end : current >= end; current += step) {
    items.push(`${prefix}${current}`);
  }

  return items;
}

function addUnique(map, key, label, sourceRow, errors) {
  if (key === undefined || key === null || key === '') return;
  if (map.has(key)) {
    errors.push(`Duplicate ${label}: rows ${map.get(key)} and ${sourceRow}.`);
    return;
  }
  map.set(key, sourceRow);
}

function uniqueSorted(values) {
  return [...new Set(values.filter((item) => item !== undefined && item !== null && item !== ''))]
    .sort((a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b), undefined, { numeric: true });
    });
}

function typedValue(input) {
  const text = value(input);
  if (/^(yes|true)$/i.test(text)) return true;
  if (/^(no|false)$/i.test(text)) return false;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function toNumber(input) {
  const number = Number(value(input));
  return Number.isFinite(number) ? number : null;
}

function value(input) {
  return String(input ?? '').trim();
}

function camelCase(input) {
  const words = value(input)
    .replace(/[?#()]/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/);

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      return index === 0 ? lower : `${lower[0].toUpperCase()}${lower.slice(1)}`;
    })
    .join('');
}

function slugify(input) {
  return value(input)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writeJson(filePath, data) {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(data, null, 2)}\n`);
}

function emptySequence(filePath, sequenceName) {
  return {
    sequenceId: slugify(sequenceName || path.basename(filePath, path.extname(filePath))),
    sequenceName: sequenceName || path.basename(filePath, path.extname(filePath)),
    sourceWorkbook: path.basename(filePath),
    sourceSheet: null,
    dimensions: [],
    pointGroups: [],
    coverage: { valuesByDimension: {}, actualCount: 0 },
    scenarios: [],
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
