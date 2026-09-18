import { Injectable } from '@angular/core';

import sequenceCatalogJson from '../data/cdd-sequence-catalog.json';
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
    const pointList = scenario.points.map((point) => this.toCddPoint(point));

    return {
      equipmentName: selection.sequenceName,
      siteName: 'Demo Site',
      sequenceId: selection.sequenceId,
      sequenceName: selection.sequenceName,
      generatedAt: new Date(),
      inputs: this.selectedInputs(selection),
      resolvedValues: {
        scenario: scenario.scenario,
        sourceWorkbook: sequence.sourceWorkbook,
        sourceSheet: sequence.sourceSheet,
        ...match,
      },
      boMappings: pointList.filter((point) => /^BO/i.test(point.terminal)),
      uiMappings: pointList.filter((point) => /^UI/i.test(point.terminal)),
      pointList,
      pointTableTemplate: sequence.pointTableTemplate,
      hardwareValid: true,
      validationMessages: [
        `Matched scenario ${scenario.scenario} from ${sequence.sourceWorkbook}.`,
        ...this.selectionSummary(parametersByName),
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

    if (!scenario) {
      throw new Error(`No scenario matched selected values: ${JSON.stringify(match)}.`);
    }

    return scenario;
  }

  private selectedInputs(selection: EquipmentBuilderSelection): Record<string, string | number | boolean> {
    return Object.fromEntries(selection.parameters.map((parameter) => {
      const selectedValue = Array.isArray(parameter.selectedValue)
        ? parameter.selectedValue.join(', ')
        : parameter.selectedValue;

      return [parameter.id, selectedValue ?? ''];
    }));
  }

  private selectionSummary(parametersByName: Map<string, EquipmentBuilderParameter>): string[] {
    const occupancy = parametersByName.get(this.compactKey('Occupancy Sensor'));
    const manual = parametersByName.get(this.compactKey('Manual Override'));

    return [
      `Occupancy sensor required: ${this.hasSelection(occupancy) ? 'Yes' : 'No'}.`,
      `Manual override required: ${this.hasSelection(manual) ? 'Yes' : 'No'}.`,
    ];
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
      return selectedValue.some((value) => value !== null && value !== undefined && value !== '');
    }

    return selectedValue !== null && selectedValue !== undefined && selectedValue !== '' && selectedValue !== false;
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
