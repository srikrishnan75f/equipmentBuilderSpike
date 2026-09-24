#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import xlsx from 'xlsx';

const INPUT_FILE = 'Equipment_Builder-Final.xlsx';
const OUTPUT_FILE = 'equipment_builder.json';
const MAIN_SHEET = 'Equipment Builder';

main();

function main() {
    const args = parseArgs(process.argv.slice(2));
    const inputFile = args.input ?? INPUT_FILE;
    const outputFile = args.output ?? OUTPUT_FILE;

    const inputPath = path.resolve(inputFile);
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Excel file not found: ${inputPath}`);
    }

    console.log(`Reading Excel file: ${inputPath}`);
    const workbook = xlsx.readFile(inputPath, { cellDates: false });
    console.log(`Sheets: ${workbook.SheetNames.join(', ')}`);

    const result = buildOutput(workbook, args.sheet ?? MAIN_SHEET);

    const outputPath = path.resolve(outputFile);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf-8');

    console.log(`\nSuccessfully generated:\n${outputPath}`);
    console.log(`Total equipment objects: ${result.length}`);
}

function parseArgs(args) {
    const parsed = {};

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];

        if (arg === '--input') parsed.input = args[++index];
        else if (arg === '--output') parsed.output = args[++index];
        else if (arg === '--sheet') parsed.sheet = args[++index];
        else if (arg === '--help') {
            printUsage();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return parsed;
}

function printUsage() {
    console.log('Usage: node tools/extract-equipment-builder.mjs [--input <xlsx>] [--output <json>] [--sheet <name>]');
}

function rowsFromSheet(sheet) {
    return xlsx.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        raw: true,
        blankrows: false,
    });
}

function clean(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' && Number.isInteger(value)) return String(value);
    return String(value).replace(/\u00a0/g, ' ').trim();
}

function normalize(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeHeader(value) {
    return normalize(value);
}

function isEmpty(value) {
    return clean(value) === '';
}

function uniqueList(values) {
    const result = [];
    const seen = new Set();

    for (const item of values ?? []) {
        const value = clean(item);
        if (!value) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(value);
    }

    return result;
}

function mergeUnique(first, second) {
    return uniqueList([...(first ?? []), ...(second ?? [])]);
}

function toCamelCase(value) {
    const text = clean(value);
    if (!text) return '';
    if (/^[a-z][A-Za-z0-9]*$/.test(text)) return text;

    const words = text.match(/[A-Za-z0-9]+/g) ?? [];
    if (words.length === 0) return '';

    return words[0].toLowerCase() + words.slice(1)
        .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
        .join('');
}

function parseArray(value) {
    const text = clean(value);
    if (!text) return [];

    const normalizedBreaks = text.replace(/<br\s*\/?>/gi, '\n');
    const parts = normalizedBreaks.split(/[,;\n|]+/);
    return uniqueList(parts.map((part) => clean(part)).filter(Boolean));
}

function parseApplicationTypes(value) {
    const text = clean(value);
    if (!text) return [];

    const parts = text.split(/[,/&]+/);
    const result = [];

    for (const part of parts) {
        const item = clean(part).toLowerCase();
        if (item === 'system' || item === 'zone') result.push(item);
    }

    return uniqueList(result);
}

function findHeaderRow(rows, requiredHeaders, maxRows = 50) {
    const required = new Set(requiredHeaders.map((header) => normalizeHeader(header)));
    const limit = Math.min(rows.length, maxRows);

    for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
        const current = new Set();
        for (const value of rows[rowIndex] ?? []) {
            if (!isEmpty(value)) current.add(normalizeHeader(value));
        }

        let allFound = true;
        for (const key of required) {
            if (!current.has(key)) {
                allFound = false;
                break;
            }
        }

        if (allFound) return rowIndex;
    }

    return null;
}

function findHeaderRowWithAliases(rows, requiredHeaderGroups, maxRows = 50) {
    const required = requiredHeaderGroups.map((headerGroup) => (
        Array.isArray(headerGroup) ? headerGroup : [headerGroup]
    ).map((header) => normalizeHeader(header)));
    const limit = Math.min(rows.length, maxRows);

    for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
        const current = new Set();
        for (const value of rows[rowIndex] ?? []) {
            if (!isEmpty(value)) current.add(normalizeHeader(value));
        }

        const allFound = required.every((aliases) => aliases.some((alias) => current.has(alias)));
        if (allFound) return rowIndex;
    }

    return null;
}

function buildHeaderMap(rows, headerRow) {
    const mapping = {};
    const headers = rows[headerRow] ?? [];

    for (let col = 0; col < headers.length; col += 1) {
        const value = headers[col];
        if (!isEmpty(value)) mapping[normalizeHeader(value)] = col;
    }

    return mapping;
}

function getColumn(headerMap, ...names) {
    for (const name of names) {
        const key = normalizeHeader(name);
        if (Object.prototype.hasOwnProperty.call(headerMap, key)) return headerMap[key];
    }
    return null;
}

function getCell(rows, rowIndex, colIndex) {
    if (colIndex === null || colIndex === undefined) return null;
    return rows[rowIndex]?.[colIndex] ?? null;
}

function getCommonAnalytics(rows, analyticsColumn) {
    if (analyticsColumn === null || analyticsColumn === undefined) return [];

    let commonRow = null;
    const limit = Math.min(rows.length, 50);

    for (let row = 0; row < limit; row += 1) {
        const current = rows[row] ?? [];
        const hasCommon = current.some((value) => normalize(value) === 'commonanalytics');
        if (hasCommon) {
            commonRow = row;
            break;
        }
    }

    if (commonRow === null) return [];

    const result = [];
    for (let row = commonRow + 1; row < limit; row += 1) {
        const value = clean(getCell(rows, row, analyticsColumn));
        if (!value) continue;
        if (normalize(value) === 'analyticsname') break;
        result.push(value);
    }

    return uniqueList(result);
}

function parseEquipmentBuilder(workbook, mainSheetName) {
    const sheet = workbook.Sheets[mainSheetName];
    if (!sheet) {
        throw new Error(`Sheet not found: ${mainSheetName}`);
    }

    const rows = rowsFromSheet(sheet);
    const headerRow = findHeaderRowWithAliases(rows, [
        'Algorithm',
        ['Application : System or Zone', 'Application: System or Zone', 'Application : System  or Zone'],
        'Hayloft Model',
        ['Device Specific Seeunce Names', 'Device Specific Sequence Names', 'Device Specific Sequnce Names'],
    ]);

    if (headerRow === null) {
        throw new Error('Could not find Equipment Builder header row.');
    }

    const headers = buildHeaderMap(rows, headerRow);
    const algorithmCol = getColumn(headers, 'Algorithm');
    const applicationCol = getColumn(headers, 'Application : System or Zone', 'Application : System or Zone ', 'Application: System or Zone', 'Application : System  or Zone');
    const hayloftModelCol = getColumn(headers, 'Hayloft Model');
    const sequenceNameCol = getColumn(headers, 'Device Specific Seeunce Names', 'Device Specific Sequence Names', 'Device Specific Sequnce Names');
    const deviceSequenceCol = getColumn(headers, 'Device Sequences', 'Device Sequences ');
    const descriptionCol = getColumn(headers, 'Description');
    const graphicsCol = getColumn(headers, 'Equip Graphics', 'Equip Graphics ');
    const analyticsCol = getColumn(headers, 'Analytics Name');
    const cddCol = getColumn(headers, 'CDD');

    const commonAnalytics = getCommonAnalytics(rows, analyticsCol);
    const equipmentGroups = [];

    let currentAlgorithm = '';
    let currentApplication = '';
    let currentEquipment = null;

    function createEquipment(model) {
        return {
            algorithm: currentAlgorithm,
            hayloftModel: model,
            description: '',
            application: currentApplication,
            sequences: [],
            equipGraphics: [],
            analyticsName: [],
            cdd: '',
            deviceSequences: [],
        };
    }

    for (let row = headerRow + 1; row < rows.length; row += 1) {
        const algorithm = clean(getCell(rows, row, algorithmCol));
        const application = clean(getCell(rows, row, applicationCol));
        const hayloftModel = clean(getCell(rows, row, hayloftModelCol));
        const sequenceName = clean(getCell(rows, row, sequenceNameCol));
        const deviceSequence = clean(getCell(rows, row, deviceSequenceCol));
        const description = clean(getCell(rows, row, descriptionCol));
        const graphics = clean(getCell(rows, row, graphicsCol));
        const analytics = clean(getCell(rows, row, analyticsCol));
        const cdd = clean(getCell(rows, row, cddCol));

        if (algorithm) currentAlgorithm = algorithm;
        if (application) currentApplication = application;

        if (hayloftModel) {
            currentEquipment = createEquipment(hayloftModel);
            equipmentGroups.push(currentEquipment);
        }

        if (!currentEquipment) continue;

        if (description) currentEquipment.description = description;
        if (cdd) currentEquipment.cdd = cdd;

        if (graphics) {
            currentEquipment.equipGraphics = mergeUnique(currentEquipment.equipGraphics, parseArray(graphics));
        }

        if (analytics) {
            currentEquipment.analyticsName = mergeUnique(currentEquipment.analyticsName, [analytics]);
        }

        if (sequenceName) currentEquipment.sequences.push(sequenceName);
        if (deviceSequence) currentEquipment.deviceSequences.push(deviceSequence);
    }

    for (const equipment of equipmentGroups) {
        equipment.analyticsName = mergeUnique(commonAnalytics, equipment.analyticsName);
        equipment.sequences = uniqueList(equipment.sequences);
        equipment.deviceSequences = uniqueList(equipment.deviceSequences);
    }

    return equipmentGroups;
}

function normalizeSheetName(value) {
    return normalize(clean(value).replace(/–/g, '-').replace(/—/g, '-'));
}

function findParameterSheet(workbook, sequenceName, deviceSequenceNames = []) {
    const candidates = [];
    if (sequenceName) candidates.push(sequenceName);
    candidates.push(...deviceSequenceNames);

    for (const candidate of candidates) {
        if (workbook.Sheets[candidate]) {
            return { name: candidate, sheet: workbook.Sheets[candidate] };
        }
    }

    const normalizedSheets = new Map();
    for (const sheetName of workbook.SheetNames) {
        normalizedSheets.set(normalizeSheetName(sheetName), sheetName);
    }

    for (const candidate of candidates) {
        const normalizedCandidate = normalizeSheetName(candidate);
        if (normalizedSheets.has(normalizedCandidate)) {
            const sheetName = normalizedSheets.get(normalizedCandidate);
            return { name: sheetName, sheet: workbook.Sheets[sheetName] };
        }
    }

    for (const candidate of candidates) {
        const normalizedCandidate = normalizeSheetName(candidate);
        if (!normalizedCandidate) continue;

        for (const sheetName of workbook.SheetNames) {
            const normalizedSheet = normalizeSheetName(sheetName);
            if (normalizedCandidate.includes(normalizedSheet) || normalizedSheet.includes(normalizedCandidate)) {
                return { name: sheetName, sheet: workbook.Sheets[sheetName] };
            }
        }
    }

    const suffixMatch = String(sequenceName ?? '').match(/_(CN|SN)$/i);
    if (suffixMatch) {
        const suffix = suffixMatch[1].toLowerCase();
        for (const sheetName of workbook.SheetNames) {
            if (!sheetName.toLowerCase().endsWith(`_${suffix}`)) continue;

            const sequenceWords = new Set((sequenceName.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(Boolean));
            const sheetWords = new Set((sheetName.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(Boolean));
            sequenceWords.delete(suffix);
            sheetWords.delete(suffix);

            const overlap = [...sequenceWords].some((word) => sheetWords.has(word));
            if (overlap) return { name: sheetName, sheet: workbook.Sheets[sheetName] };
        }
    }

    return null;
}

function findParameterHeader(rows) {
    return findHeaderRow(rows, ['Parameter Category', 'Parameter Name', 'Options', 'Type', 'Default'], 30);
}

function convertScalar(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isInteger(value) ? value : value;

    const text = clean(value);
    if (!text) return null;

    const lower = text.toLowerCase();
    if (['yes', 'no', 'none', 'null', 'n/a'].includes(lower)) return text;
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
    if (/^-?\d+\.\d+$/.test(text)) return Number.parseFloat(text);

    return text;
}

function parseOptionValue(value) {
    const text = clean(value);
    if (!text) return null;
    return convertScalar(text);
}

function parseOptions(value) {
    const text = clean(value);
    if (!text) return [];

    const normalizedBreaks = text.replace(/<br\s*\/?>/gi, '\n');
    const rawItems = [];

    for (const rawLine of normalizedBreaks.split(/\r?\n/)) {
        const line = clean(rawLine);
        if (!line) continue;

        if (!line.includes('=')) {
            if (line.includes(',')) {
                rawItems.push(...line.split(',').map((item) => item.trim()).filter(Boolean));
            } else if (line.includes('/')) {
                rawItems.push(...line.split('/').map((item) => item.trim()).filter(Boolean));
            } else {
                rawItems.push(line);
            }
        } else {
            rawItems.push(line);
        }
    }

    const result = [];

    for (const itemValue of rawItems) {
        const item = clean(itemValue);
        if (!item) continue;

        const explicitMatch = item.match(/^([^=]+?)\s*=\s*(.+)$/);
        if (explicitMatch) {
            const rawValue = clean(explicitMatch[1]);
            const label = clean(explicitMatch[2]);
            result.push({
                label,
                value: parseOptionValue(rawValue),
            });
            continue;
        }

        let parsedValue = parseOptionValue(item);
        if (typeof parsedValue === 'string') {
            const identifier = extractIdentifier(item);
            if (identifier !== null) parsedValue = identifier;
        }

        result.push({
            label: item,
            value: parsedValue,
        });
    }

    return result;
}

function parseBoolean(value, defaultValue = false) {
    if (typeof value === 'boolean') return value;
    const text = clean(value).toLowerCase();
    if (new Set(['true', 'yes', '1', 'y']).has(text)) return true;
    if (new Set(['false', 'no', '0', 'n']).has(text)) return false;
    return defaultValue;
}

function parseRuleParams(paramValues) {
    const params = {};
    let positionalIndex = 1;

    function assignParam(rawInput) {
        const value = clean(rawInput);
        if (!value) return;

        const equalsMatch = value.match(/^([^=]+?)\s*=\s*(.*)$/);
        if (equalsMatch) {
            const key = clean(equalsMatch[1]);
            const parsedValue = convertScalar(equalsMatch[2]);
            if (key) params[key] = parsedValue;
            return;
        }

        const colonMatch = value.match(/^([^:]+?)\s*:\s*(.*)$/);
        if (colonMatch) {
            const key = clean(colonMatch[1]);
            const parsedValue = convertScalar(colonMatch[2]);
            if (key) params[key] = parsedValue;
            return;
        }

        params[`param${positionalIndex}`] = convertScalar(value);
        positionalIndex += 1;
    }

    paramValues.forEach((rawValue, index) => {
        void index;
        const value = clean(rawValue);
        if (!value) return;

        const normalizedBreaks = value.replace(/<br\s*\/?>/gi, '\n');
        const tokens = normalizedBreaks
            .split(/\r?\n|,(?=\s*[^,=:]+\s*[:=])/)
            .map((part) => clean(part))
            .filter(Boolean);

        if (tokens.length === 0) return;
        if (tokens.length === 1) {
            assignParam(tokens[0]);
            return;
        }

        tokens.forEach((token) => assignParam(token));
    });

    return params;
}

function parseSequenceParameterRules(workbook) {
    // Prefer the modified rules sheet shape while keeping the old sheet name usable for older workbooks.
    const sheetName = ['Sequence Parameter Rules Modif.', 'Sequence Parameter Rules']
        .find((candidate) => workbook.Sheets[candidate]);
    if (!sheetName) return [];

    const rows = rowsFromSheet(workbook.Sheets[sheetName]);
    const headerRow = findHeaderRowWithAliases(rows, [
        'Sequence Tab',
        'Parameter Name',
        'Rule Order',
        'Rule Type',
        'Source Field',
        'Param 1',
        ['Read Only', 'Lock Target'],
    ], 20);

    if (headerRow === null) {
        console.warn(`WARNING: Could not find headers in '${sheetName}'.`);
        return [];
    }

    const headers = buildHeaderMap(rows, headerRow);
    const sequenceTabCol = getColumn(headers, 'Sequence Tab');
    const sequenceNameCol = getColumn(headers, 'Sequence Name');
    const parameterNameCol = getColumn(headers, 'Parameter Name');
    const ruleOrderCol = getColumn(headers, 'Rule Order');
    const ruleTypeCol = getColumn(headers, 'Rule Type');
    const sourceFieldCol = getColumn(headers, 'Source Field');
    // Read Param 1, Param 2, etc. so the rule sheet can add more params without parser changes.
    const paramCols = Object.entries(headers)
        .filter(([header]) => /^param\d+$/.test(header))
        .sort(([first], [second]) => Number(first.replace('param', '')) - Number(second.replace('param', '')))
        .map(([, column]) => column);
    const readOnlyColumn = getColumn(headers, 'Read Only');
    const notesCol = getColumn(headers, 'Notes');

    const rules = [];

    for (let row = headerRow + 1; row < rows.length; row += 1) {
        const ruleType = clean(getCell(rows, row, ruleTypeCol));
        if (!ruleType) continue;

        const sequenceTab = clean(getCell(rows, row, sequenceTabCol));
        const sequenceName = clean(getCell(rows, row, sequenceNameCol));
        const parameterName = clean(getCell(rows, row, parameterNameCol));
        const rawOrder = getCell(rows, row, ruleOrderCol);

        let ruleOrder = 0;
        if (!isEmpty(rawOrder)) {
            const parsedOrder = Number.parseInt(clean(rawOrder), 10);
            ruleOrder = Number.isFinite(parsedOrder) ? parsedOrder : 0;
        }

        const sourceField = parseArray(getCell(rows, row, sourceFieldCol));

        const paramValues = [];
        for (const paramCol of paramCols) {
            paramValues.push(getCell(rows, row, paramCol));
        }

        const rule = {
            sequenceTab,
            sequenceName,
            parameterName,
            order: ruleOrder,
            type: ruleType,
            sourceField,
            params: parseRuleParams(paramValues),
            readOnly: parseBoolean(getCell(rows, row, readOnlyColumn), false)
        };

        const notes = clean(getCell(rows, row, notesCol));
        void notes;
        rules.push(rule);
    }

    return rules;
}

function getParameterRules(rules, sequenceName, sequenceTab, parameterName) {
    const normalizedSequenceName = normalize(sequenceName);
    const normalizedSequenceTab = normalize(sequenceTab);
    const normalizedParameterName = normalize(parameterName);

    const matched = [];

    for (const rule of rules) {
        const ruleSequenceName = normalize(rule.sequenceName);
        const ruleSequenceTab = normalize(rule.sequenceTab);
        const ruleParameterName = normalize(rule.parameterName);

        let sequenceMatches = false;

        if (normalizedSequenceTab && ruleSequenceTab && normalizedSequenceTab === ruleSequenceTab) {
            sequenceMatches = true;
        }

        if (normalizedSequenceName && ruleSequenceName && normalizedSequenceName === ruleSequenceName) {
            sequenceMatches = true;
        }

        if (!sequenceMatches) continue;
        if (ruleParameterName !== normalizedParameterName) continue;

        matched.push(rule);
    }

    matched.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return matched;
}

function attachRulesToParameter(parameter, rules, sequenceName, sequenceTab) {
    const parameterRules = getParameterRules(rules, sequenceName, sequenceTab, parameter.name ?? '');
    if (parameterRules.length === 0) return;

    parameter.rules = parameterRules.map((rule) => {
        const output = {
            order: rule.order,
            type: rule.type,
            readOnly: rule.readOnly ?? false,
        };

        if (Array.isArray(rule.sourceField) && rule.sourceField.length > 0) {
            output.sourceField = rule.sourceField;
        }
        if (rule.params && Object.keys(rule.params).length > 0) output.params = rule.params;
        return output;
    });
}

function parseTags(value) {
    const text = clean(value);
    if (!text) return [];

    const normalized = text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+and\s+/gi, '|');

    return uniqueList(parseArray(normalized));
}

function parsePoints(value) {
    return parseArray(value);
}

function extractIdentifier(value) {
    const text = clean(value);
    if (!text) return null;

    const wholeWord = text.match(/\b(\d+)\b/);
    if (wholeWord) return Number.parseInt(wholeWord[1], 10);

    const trailing = text.match(/(\d+)(?!.*\d)/);
    if (trailing) return Number.parseInt(trailing[1], 10);

    return null;
}

function parsePointMapping(pointValue, options) {
    const points = parsePoints(pointValue);
    if (points.length === 0) return [null, null];

    const optionIdentifiers = options.map((option) => {
        const label = clean(option?.label);
        const value = option?.value;

        if (typeof value === 'number' && Number.isInteger(value)) return value;
        const inferred = extractIdentifier(label);
        return inferred;
    });

    if (optionIdentifiers.some((identifier) => identifier !== null)) {
        const mapping = {};
        let pointIndex = 0;

        for (const identifier of optionIdentifiers) {
            if (identifier === null) continue;
            if (pointIndex >= points.length) break;
            mapping[String(identifier)] = points[pointIndex];
            pointIndex += 1;
        }

        if (Object.keys(mapping).length > 0) return [mapping, null];
    }

    const pointIdentifiers = points.map((point) => extractIdentifier(point));
    if (pointIdentifiers.some((identifier) => identifier !== null)) {
        const mapping = {};
        for (let index = 0; index < points.length; index += 1) {
            const identifier = pointIdentifiers[index];
            if (identifier !== null) mapping[String(identifier)] = points[index];
        }
        if (Object.keys(mapping).length > 0) return [mapping, null];
    }

    if (points.length === 1) return [null, points[0]];
    return [null, null];
}

function parseValidation(options, typeValue) {
    const typeText = clean(typeValue).toLowerCase();
    if (!typeText.includes('number') && !typeText.includes('int')) return null;

    const value = clean(options);
    const match = value.match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
    if (!match) return null;

    let min = Number.parseFloat(match[1]);
    let max = Number.parseFloat(match[2]);
    if (Number.isInteger(min)) min = Number.parseInt(String(min), 10);
    if (Number.isInteger(max)) max = Number.parseInt(String(max), 10);

    return {
        min,
        max,
        integer: typeText.includes('int'),
    };
}

function convertParameterType(typeValue) {
    const lower = clean(typeValue).toLowerCase();
    if (lower.includes('multi')) return 'multiselect';
    if (lower.includes('dropdown')) return 'dropdown';
    if (lower.includes('number')) return 'number';
    if (lower.includes('boolean')) return 'boolean';
    if (lower.includes('integer')) return 'number';
    if (lower.includes('int')) return 'number';
    if (lower.includes('float')) return 'number';
    if (lower.includes('string')) return 'text';
    return lower;
}

function parseDefault(value, parameterType) {
    const typeText = clean(parameterType).toLowerCase();
    if (typeText.includes('multi')) return [];

    const text = clean(value);
    if (!text) return null;
    return convertScalar(text);
}

function parseParametersFromSheet(sheet, sequenceTabName, rules = [], sequenceName = '', sequenceTab = '') {
    const rows = rowsFromSheet(sheet);
    const headerRow = findParameterHeader(rows);

    if (headerRow === null) {
        console.warn(`WARNING: Parameter header not found in sheet '${sequenceTabName ?? 'unknown'}'`);
        return [];
    }

    const headers = buildHeaderMap(rows, headerRow);
    const categoryCol = getColumn(headers, 'Parameter Category');
    const nameCol = getColumn(headers, 'Parameter Name');
    const optionsCol = getColumn(headers, 'Options');
    const typeCol = getColumn(headers, 'Type');
    const defaultCol = getColumn(headers, 'Default');
    const unitCol = getColumn(headers, 'Unit');
    const pointCol = getColumn(headers, 'Map Haylofyt Points', 'Map Hayloft Points', 'Map Haylofyt Point');
    const tagsCol = getColumn(headers, 'Tags');
    const scheduleCol = getColumn(headers, 'Point Based Schedule', 'Point Based  Schedule');
    const commentsCol = getColumn(headers, 'Comments');

    const parameters = [];

    for (let row = headerRow + 1; row < rows.length; row += 1) {
        const parameterName = clean(getCell(rows, row, nameCol));
        if (!parameterName) continue;

        const category = clean(getCell(rows, row, categoryCol));
        const optionsRaw = clean(getCell(rows, row, optionsCol));
        const typeRaw = clean(getCell(rows, row, typeCol));
        const defaultRaw = getCell(rows, row, defaultCol);
        const unitRaw = clean(getCell(rows, row, unitCol));
        const pointRaw = clean(getCell(rows, row, pointCol));
        const tagsRaw = clean(getCell(rows, row, tagsCol));
        const scheduleRaw = clean(getCell(rows, row, scheduleCol));
        const commentsRaw = clean(getCell(rows, row, commentsCol));

        const parameterType = convertParameterType(typeRaw);
        const parameter = {
            id: toCamelCase(parameterName),
            category,
            name: parameterName,
            type: parameterType,
            default: parseDefault(defaultRaw, typeRaw),
            unit: (!unitRaw || unitRaw.toLowerCase() === 'none') ? null : unitRaw,
        };

        let parsedOptions = [];
        if (parameterType === 'dropdown' || parameterType === 'multiselect') {
            parsedOptions = parseOptions(optionsRaw);
            if (parsedOptions.length > 0) parameter.options = parsedOptions;
        }

        const [pointMapping, point] = parsePointMapping(pointRaw, parsedOptions);
        if (pointMapping) parameter.pointMapping = pointMapping;
        else if (point) parameter.point = point;

        const tags = parseTags(tagsRaw);
        if (tags.length > 0) parameter.tags = tags;

        const validation = parseValidation(optionsRaw, typeRaw);
        if (validation) parameter.validation = validation;

        if (scheduleRaw) parameter.pointBasedSchedule = scheduleRaw;
        if (commentsRaw) parameter.comments = commentsRaw;

        attachRulesToParameter(parameter, rules, sequenceName, sequenceTab);
        parameters.push(parameter);
    }

    return parameters;
}

function generateSequenceId(sequenceName) {
    return clean(sequenceName)
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
}

function generateEquipmentId(hayloftModel, sequenceName, equipmentType, usedIds) {
    const base = `${hayloftModel}-${sequenceName}-${equipmentType}`.replace(/\s+/g, '-');
    let candidate = base;
    let counter = 2;

    while (usedIds.has(candidate)) {
        candidate = `${base}-${counter}`;
        counter += 1;
    }

    usedIds.add(candidate);
    return candidate;
}

function buildOutput(workbook, mainSheetName) {
    const equipmentGroups = parseEquipmentBuilder(workbook, mainSheetName);
    const output = [];
    const sequenceParameterRules = parseSequenceParameterRules(workbook);
    const usedIds = new Set();
    const missingParameterSheets = [];

    for (const equipment of equipmentGroups) {
        let applicationTypes = parseApplicationTypes(equipment.application);
        if (applicationTypes.length === 0) applicationTypes = ['zone'];

        const sequences = equipment.sequences;
        const deviceSequences = equipment.deviceSequences;

        for (const sequenceName of sequences) {
            const parameterSheet = findParameterSheet(workbook, sequenceName, deviceSequences);

            let parameters;
            if (parameterSheet) {
                parameters = parseParametersFromSheet(
                    parameterSheet.sheet,
                    parameterSheet.name,
                    sequenceParameterRules,
                    sequenceName,
                    parameterSheet.name,
                );
            } else {
                parameters = [];
                missingParameterSheets.push(sequenceName);
            }

            const sequenceId = generateSequenceId(sequenceName);

            for (const equipmentType of applicationTypes) {
                const equipmentId = generateEquipmentId(
                    equipment.hayloftModel,
                    sequenceName,
                    equipmentType,
                    usedIds,
                );

                output.push({
                    algorithm: equipment.algorithm,
                    id: equipmentId,
                    hayloftModel: equipment.hayloftModel,
                    name: sequenceName,
                    description: equipment.description,
                    type: equipmentType,
                    equipGraphics: [...equipment.equipGraphics],
                    analyticsName: [...equipment.analyticsName],
                    cdd: equipment.cdd,
                    sequenceId,
                    sequenceName,
                    parameters,
                });
            }
        }
    }

    const uniqueMissing = uniqueList(missingParameterSheets);
    if (uniqueMissing.length > 0) {
        console.warn('\nWARNING: Parameter sheets were not found:');
        for (const name of uniqueMissing) console.warn(`  - ${name}`);
    }

    return output;
}
