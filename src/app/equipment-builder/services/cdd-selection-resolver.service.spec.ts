import { TestBed } from '@angular/core/testing';

import { EquipmentBuilderSelection } from '../models/cdd.model';
import { CddSelectionResolverService } from './cdd-selection-resolver.service';

describe('CddSelectionResolverService', () => {
  let service: CddSelectionResolverService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CddSelectionResolverService);
  });

  it('resolves the selectedValue payload into a CDD configuration', () => {
    const configuration = service.resolve(buildSelection());

    expect(configuration.resolvedValues['scenario']).toBe(1);
    expect(configuration.pointList).toEqual([
      jasmine.objectContaining({
        terminal: 'BO1',
        description: 'LIGHTING CIRCUIT 1 CMD',
        tag: 'LGHT1_CMD',
      }),
    ]);
  });

  it('matches the two-circuit schedule with auto occupancy scenario', () => {
    const selection = buildSelection({
      lightingCircuitCount: 2,
      occupancySensor: [1, 2],
      controlType: 4,
    });
    const configuration = service.resolve(selection);

    expect(configuration.resolvedValues['scenario']).toBe(11);
    expect(configuration.pointList).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({
        terminal: 'UI1',
        description: 'OCCUPANCY SENSOR 1 STATUS',
        tag: 'OCC1_STS',
      }),
      jasmine.objectContaining({
        terminal: 'UI2',
        description: 'OCCUPANCY SENSOR 2 STATUS',
        tag: 'OCC2_STS',
      }),
      jasmine.objectContaining({
        terminal: 'BO1',
        description: 'LIGHTING CIRCUIT 1 CMD',
        tag: 'LGHT1_CMD',
      }),
      jasmine.objectContaining({
        terminal: 'BO2',
        description: 'LIGHTING CIRCUIT 2 CMD',
        tag: 'LGHT2_CMD',
      }),
    ]));
  });
});

function buildSelection(overrides: {
  lightingCircuitCount?: number;
  occupancySensor?: number[];
  manualOverride?: number[];
  controlType?: number;
} = {}): EquipmentBuilderSelection {
  return {
    sequenceId: 'DO_LIGHTING_CONTROL',
    sequenceName: 'DO - Lighting Control',
    parameters: [
      {
        id: 'lightingCircuitCount',
        category: 'Basic',
        name: 'Lighting Circuits Count',
        type: 'dropdown',
        selectedValue: overrides.lightingCircuitCount ?? 1,
        options: [],
      },
      {
        id: 'occupancySensor',
        category: 'Input Sensor',
        name: 'Occupancy Sensor',
        type: 'multiselect',
        selectedValue: overrides.occupancySensor ?? [],
        options: [],
      },
      {
        id: 'manualOverride',
        category: 'Input',
        name: 'Manual Override',
        type: 'multiselect',
        selectedValue: overrides.manualOverride ?? [],
        options: [],
      },
      {
        id: 'controlType',
        category: 'Control',
        name: 'Control Type',
        type: 'dropdown',
        selectedValue: overrides.controlType ?? 1,
        options: [
          { value: 1, label: 'Schedule Mode' },
          { value: 2, label: 'Occupancy Mode' },
          { value: 3, label: 'Vacancy Mode' },
          { value: 4, label: 'Schedule with Auto Occupancy Mode' },
          { value: 5, label: 'Schedule with Auto Vacancy Mode' },
          { value: 6, label: 'Schedule with Auto Occupancy Vacancy Mode' },
          { value: 7, label: 'Manual Override Mode' },
        ],
      },
    ],
  };
}
