import { Injectable } from '@angular/core';

import sequenceCatalogJson from '../data/seq-parameter-cdd.json';
import {
  CddConfiguration,
  CddPoint,
  CddScenario,
  CddSequence,
  CddSequenceCatalog,
  EquipmentBuilderParameter,
  EquipmentBuilderSelection,
} from '../models/cdd.model';

@Injectable({ providedIn: 'root' })
export class CddSelectionResolverService {
  private readonly catalog = sequenceCatalogJson as CddSequenceCatalog;

  resolve(selection: EquipmentBuilderSelection): CddConfiguration {
    const sequence = this.findSequence(selection);
    const match = this.buildScenarioMatch(sequence, selection);
    const scenario = this.findScenario(sequence, match);
    const parametersByName = this.parametersByName(selection);
    const pointList = this.resolvePointList(sequence, scenario);

    return {
      equipmentName: selection.sequenceName,
      siteName: selection.siteName || 'Demo Site',
      projectAddress: selection.projectAddress,
      sequenceId: selection.sequenceId,
      sequenceName: selection.sequenceName,
      generatedAt: new Date(),
      inputs: this.selectedInputs(selection),
      resolvedValues: {
        scenario: scenario.scenario,
        sourceWorkbook: sequence.sourceWorkbook,
        sourceSheet: sequence.sourceSheet,
        ...scenario.match,
      },
      boMappings: pointList.filter((point) => /^BO/i.test(point.terminal)),
      uiMappings: pointList.filter((point) => /^UI/i.test(point.terminal)),
      pointList,
      pointTableTemplate: sequence.pointTableTemplate,
      hardwareValid: true,
      validationMessages: [
        `Matched scenario ${scenario.scenario} from ${sequence.sourceWorkbook}.`,
        ...this.selectionSummary(scenario.match, parametersByName),
      ],
    };
  }

  private findSequence(selection: EquipmentBuilderSelection): CddSequence {
    const requestedKeys = [
      selection.sequenceId,
      selection.sequenceName,
      this.normalizeSequenceId(selection.sequenceId),
      this.normalizeSequenceId(selection.sequenceName),
    ].map((key) => this.compactKey(key));

    const sequence = this.catalog.sequences.find((candidate) => {
      const candidateKeys = [
        candidate.sequenceId,
        candidate.sequenceName,
        this.normalizeSequenceId(candidate.sequenceId),
        this.normalizeSequenceId(candidate.sequenceName),
      ].map((key) => this.compactKey(key));

      return candidateKeys.some((key) => requestedKeys.includes(key)) ||
        this.hasSameSequenceTokens(selection, candidate);
    });

    if (!sequence) {
      throw new Error(`No CDD sequence catalog found for "${selection.sequenceId}" / "${selection.sequenceName}".`);
    }

    return sequence;
  }

  private buildScenarioMatch(
    sequence: CddSequence,
    selection: EquipmentBuilderSelection,
  ): Record<string, string | number | boolean> {
    const parametersByName = this.parametersByName(selection);

    return Object.fromEntries(sequence.dimensions.map((dimension) => {
      const key = this.camelCase(dimension);
      return [key, this.resolveDimensionValue(dimension, sequence, parametersByName)];
    }));
  }

  private resolveDimensionValue(
    dimension: string,
    sequence: CddSequence,
    parametersByName: Map<string, EquipmentBuilderParameter>,
  ): string | number | boolean {
    const directParameter = parametersByName.get(this.compactKey(dimension));

    if (directParameter) {
      return this.normalizeDimensionValue(dimension, directParameter, sequence);
    }

    if (/control mode/i.test(dimension)) {
      const controlParameter = parametersByName.get(this.compactKey('Control Type'));
      if (controlParameter) return this.normalizeDimensionValue(dimension, controlParameter, sequence);
    }

    if (/occ.*sensor.*required/i.test(dimension)) {
      return this.hasSelection(parametersByName.get(this.compactKey('Occupancy Sensor')));
    }

    if (/manual.*override.*required/i.test(dimension)) {
      return this.hasSelection(parametersByName.get(this.compactKey('Manual Override')));
    }

    throw new Error(`Unable to resolve selected value for scenario dimension "${dimension}".`);
  }

  private normalizeDimensionValue(
    dimension: string,
    parameter: EquipmentBuilderParameter,
    sequence: CddSequence,
  ): string | number | boolean {
    const selectedValue = Array.isArray(parameter.selectedValue) ? parameter.selectedValue[0] : parameter.selectedValue;

    if (/control mode/i.test(dimension)) {
      const modeNumber = Number(selectedValue);
      const availableMode = this.availableValues(sequence, dimension)
        .find((value) => typeof value === 'string' && value.startsWith(`${modeNumber} -`));

      if (availableMode) return availableMode;

      const selectedLabel = parameter.options?.find((option) => option.value === selectedValue)?.label;
      const normalizedLabel = selectedLabel ? this.normalizeControlLabel(selectedLabel) : '';
      const labelMode = this.availableValues(sequence, dimension)
        .find((value) => typeof value === 'string' && this.compactKey(value).includes(this.compactKey(normalizedLabel)));

      if (labelMode) return labelMode;
    }

    return selectedValue === null ? '' : selectedValue;
  }

  private findScenario(
    sequence: CddSequence,
    match: Record<string, string | number | boolean>,
  ): CddScenario {
    const scenario = sequence.scenarios.find((candidate) => (
      Object.entries(match).every(([key, value]) => candidate.match[key] === value)
    ));

    if (scenario) return scenario;

    const relaxedScenario = this.findScenarioWithCatalogRequiredFlags(sequence, match);
    if (relaxedScenario) return relaxedScenario;

    throw new Error(`No scenario matched selected values: ${JSON.stringify(match)}.`);
  }

  private selectedInputs(selection: EquipmentBuilderSelection): Record<string, string | number | boolean> {
    return Object.fromEntries(selection.parameters.map((parameter) => {
      const selectedValue = Array.isArray(parameter.selectedValue)
        ? parameter.selectedValue.join(', ')
        : parameter.selectedValue;

      return [parameter.id, selectedValue ?? ''];
    }));
  }

  private findScenarioWithCatalogRequiredFlags(
    sequence: CddSequence,
    match: Record<string, string | number | boolean>,
  ): CddScenario | null {
    const requiredFlagKeys = Object.keys(match).filter((key) => this.isDerivedRequiredFlag(key));
    if (requiredFlagKeys.length === 0) return null;

    const fixedMatchEntries = Object.entries(match).filter(([key]) => !requiredFlagKeys.includes(key));
    const candidates = sequence.scenarios.filter((candidate) => (
      fixedMatchEntries.every(([key, value]) => candidate.match[key] === value)
    ));

    return candidates.length === 1 ? candidates[0] : null;
  }

  private selectionSummary(
    scenarioMatch: Record<string, string | number | boolean>,
    parametersByName: Map<string, EquipmentBuilderParameter>,
  ): string[] {
    const occupancy = parametersByName.get(this.compactKey('Occupancy Sensor'));
    const manual = parametersByName.get(this.compactKey('Manual Override'));
    const occupancyRequired = this.booleanMatchValue(scenarioMatch, 'occSensorRequired') ?? this.hasSelection(occupancy);
    const manualRequired = this.booleanMatchValue(scenarioMatch, 'manualOverrideRequired') ?? this.hasSelection(manual);

    return [
      `Occupancy sensor required: ${occupancyRequired ? 'Yes' : 'No'}.`,
      `Manual override required: ${manualRequired ? 'Yes' : 'No'}.`,
    ];
  }

  private booleanMatchValue(match: Record<string, string | number | boolean>, key: string): boolean | null {
    const value = match[key];
    return typeof value === 'boolean' ? value : null;
  }

  private parametersByName(selection: EquipmentBuilderSelection): Map<string, EquipmentBuilderParameter> {
    return new Map(selection.parameters.map((parameter) => [this.compactKey(parameter.name), parameter]));
  }

  private availableValues(sequence: CddSequence, dimension: string): Array<string | number | boolean> {
    const key = this.camelCase(dimension);
    return [...new Set(sequence.scenarios.map((scenario) => scenario.match[key]))];
  }

  private hasSelection(parameter: EquipmentBuilderParameter | undefined): boolean {
    if (!parameter) return false;
    const selectedValue = parameter.selectedValue;

    if (Array.isArray(selectedValue)) {
      return selectedValue.some((value) => !this.isNone(value));
    }

    return !this.isNone(selectedValue) && selectedValue !== false;
  }

  private resolvePointList(sequence: CddSequence, scenario: CddScenario): CddPoint[] {
    const existingPoints = scenario.points.map((point) => this.toCddPoint(point));
    if (existingPoints.length > 0) return existingPoints;

    return this.pointsFromRawMaps(sequence, scenario);
  }

  private pointsFromRawMaps(sequence: CddSequence, scenario: CddScenario): CddPoint[] {
    const raw = scenario.raw ?? {};
    const points: CddPoint[] = [];

    for (const [key, value] of Object.entries(raw)) {
      if (!/map/i.test(key) || this.isNone(value)) continue;

      const detailsKey = this.detailsKeyForMapKey(raw, key);
      const details = detailsKey ? this.parsePointDetails(String(raw[detailsKey] ?? '')) : new Map<string, Partial<CddPoint>>();

      for (const terminal of this.parseTerminalList(String(value))) {
        const point = this.pointFromTerminalMap(sequence, terminal, key, details.get(terminal));
        if (point && !points.some((existing) => existing.terminal === point.terminal)) {
          points.push(point);
        }
      }
    }

    return points;
  }

  private pointFromTerminalMap(
    sequence: CddSequence,
    terminal: string,
    mapKey: string,
    detail: Partial<CddPoint> | undefined,
  ): CddPoint | null {
    const templateRow = sequence.pointTableTemplate?.rows.find((row) => row.type === 'terminal' && row.terminal === terminal);
    if (!templateRow) return null;

    const inferred = this.inferPointMetadata(terminal, mapKey);

    return this.toCddPoint({
      terminal,
      point: templateRow.point || terminal,
      description: detail?.description || inferred.description,
      tag: detail?.tag || inferred.tag,
      deviceRange: detail?.deviceRange || inferred.deviceRange,
      ioType: inferred.ioType,
      sourceGroup: mapKey,
      manufacturerPartNumber: templateRow.manufacturerPartNumber,
    });
  }

  private inferPointMetadata(terminal: string, mapKey: string): Pick<CddPoint, 'description' | 'tag' | 'deviceRange' | 'ioType'> {
    const terminalNumber = this.terminalNumber(terminal);

    if (/^BO/i.test(terminal)) {
      if (/exhaust|cmd/i.test(mapKey) && !/lights/i.test(mapKey)) {
        return {
          description: `EXHAUST FAN ${terminalNumber} CMD`,
          tag: `EF${terminalNumber}_CMD`,
          deviceRange: 'CC = ON (24VAC)',
          ioType: 'Digital Output',
        };
      }

      return {
        description: `LIGHTING CIRCUIT ${terminalNumber} CMD`,
        tag: `LGHT${terminalNumber}_CMD`,
        deviceRange: 'CC = ON (24VAC)',
        ioType: 'Digital Output',
      };
    }

    if (/interlock/i.test(mapKey)) {
      return {
        description: `INTERLOCK STATUS EF${terminalNumber}`,
        tag: `ITRLK_STS_EF${terminalNumber}`,
        deviceRange: 'DIGITAL INPUT',
        ioType: 'Digital Input',
      };
    }

    if (/status/i.test(mapKey)) {
      return {
        description: `EXHAUST FAN ${terminalNumber} STATUS`,
        tag: `EF${terminalNumber}_STS`,
        deviceRange: 'DIGITAL INPUT',
        ioType: 'Digital Input',
      };
    }

    if (/override/i.test(mapKey)) {
      return {
        description: `MANUAL OVERRIDE ${terminalNumber}`,
        tag: `OVR${terminalNumber}_STS`,
        deviceRange: 'DIGITAL INPUT',
        ioType: 'Digital Input',
      };
    }

    return {
      description: `OCCUPANCY SENSOR ${terminalNumber} STATUS`,
      tag: `OCC${terminalNumber}_STS`,
      deviceRange: 'DIGITAL INPUT',
      ioType: 'Digital Input',
    };
  }

  private parseTerminalList(value: string): string[] {
    const normalized = value.trim();
    if (this.isNone(normalized)) return [];

    const rangeMatch = normalized.match(/\b([A-Z]+)(\d+)\s+to\s+(?:[A-Z]+)?(\d+)\b/i);
    if (rangeMatch) {
      const [, prefix, start, end] = rangeMatch;
      const from = Number(start);
      const to = Number(end);
      return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => `${prefix.toUpperCase()}${from + index}`);
    }

    return [...normalized.matchAll(/\b(?:UI|BO|AO)\d+\b/gi)].map((match) => match[0].toUpperCase());
  }

  private parsePointDetails(value: string): Map<string, Partial<CddPoint>> {
    const details = new Map<string, Partial<CddPoint>>();

    for (const line of value.split(/\r?\n/)) {
      const match = line.match(/\b((?:UI|BO|AO)\d+)\s*(?:➔|->|=>)\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/i);
      if (!match) continue;

      const [, terminal, description, tag] = match;
      details.set(terminal.toUpperCase(), {
        description: description.trim(),
        tag: tag?.trim() ?? '',
      });
    }

    return details;
  }

  private detailsKeyForMapKey(raw: Record<string, string | number | boolean | null>, mapKey: string): string | undefined {
    const candidates = Object.keys(raw).filter((key) => /details/i.test(key));
    const compactMapKey = this.compactKey(mapKey.replace(/map/i, ''));

    return candidates.find((key) => this.compactKey(key).includes(compactMapKey)) ??
      candidates.find((key) => {
        const compactCandidate = this.compactKey(key);
        return compactCandidate.includes('bo') && /bo/i.test(mapKey) ||
          compactCandidate.includes('status') && /status/i.test(mapKey) ||
          compactCandidate.includes('interlock') && /interlock/i.test(mapKey);
      });
  }

  private terminalNumber(terminal: string): number {
    return Number(terminal.match(/\d+/)?.[0] ?? 1);
  }

  private isNone(value: unknown): boolean {
    return value === null || value === undefined || String(value).trim() === '' || /^none$/i.test(String(value).trim());
  }

  private isDerivedRequiredFlag(key: string): boolean {
    return /^occ.*sensor.*required$/i.test(key) || /^manual.*override.*required$/i.test(key);
  }

  private toCddPoint(point: CddPoint): CddPoint {
    return {
      terminal: point.terminal,
      point: point.point,
      description: point.description,
      tag: point.tag,
      deviceRange: point.deviceRange,
      ioType: point.ioType,
      sourceGroup: point.sourceGroup,
      manufacturerPartNumber: point.manufacturerPartNumber,
    };
  }

  private normalizeSequenceId(value: string): string {
    return value
      .replace(/^DO_/i, '')
      .replace(/\bDO\b/i, '')
      .replace(/\bCN\b/i, '')
      .replace(/CONTROL/i, 'CONTROL');
  }

  private hasSameSequenceTokens(selection: EquipmentBuilderSelection, sequence: CddSequence): boolean {
    const requestedTokens = new Set([
      ...this.sequenceTokens(selection.sequenceId),
      ...this.sequenceTokens(selection.sequenceName),
    ]);
    const candidateTokens = new Set([
      ...this.sequenceTokens(sequence.sequenceId),
      ...this.sequenceTokens(sequence.sequenceName),
    ]);

    return requestedTokens.size > 0 &&
      [...requestedTokens].every((token) => candidateTokens.has(token));
  }

  private sequenceTokens(value: string): string[] {
    return value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token && !['cn', 'do'].includes(token));
  }

  private normalizeControlLabel(value: string): string {
    return value
      .replace(/occupancy vacancy/i, 'occ vac')
      .replace(/occupancy/i, 'occ')
      .replace(/vacancy/i, 'vac')
      .replace(/mode/i, '');
  }

  private compactKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private camelCase(input: string): string {
    const words = input
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
}
