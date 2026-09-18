import { TestBed } from '@angular/core/testing';

import sequenceCatalogJson from '../data/cdd-sequence-catalog.json';
import { CddConfiguration, PointTableTemplate } from '../models/cdd.model';
import { CddPdfService } from './cdd-pdf.service';

describe('CddPdfService', () => {
  let service: CddPdfService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CddPdfService);
  });

  it('builds points-list rows from dynamic selected scenario points', () => {
    const rows = (service as unknown as {
      buildPointTableRows(points: CddConfiguration['pointList'], template?: PointTableTemplate): Array<{
        description: string;
        point: string;
        tag: string;
        deviceRange: string;
        spare?: boolean;
      }>;
    }).buildPointTableRows([
      { terminal: 'UI1', point: 'UI1', description: 'OCCUPANCY SENSOR 1 STATUS', tag: 'OCC1_STS', deviceRange: 'DIGITAL INPUT' },
      { terminal: 'UI2', point: 'UI2', description: 'OCCUPANCY SENSOR 2 STATUS', tag: 'OCC2_STS', deviceRange: 'DIGITAL INPUT' },
      { terminal: 'BO1', point: 'BO1', description: 'LIGHTING CIRCUIT 1 CMD', tag: 'LGHT1_CMD', deviceRange: 'CC = ON (24VAC)' },
      { terminal: 'BO2', point: 'BO2', description: 'LIGHTING CIRCUIT 2 CMD', tag: 'LGHT2_CMD', deviceRange: 'CC = ON (24VAC)' },
    ], sequenceCatalogJson.sequences.find((sequence) => sequence.sequenceId === 'LIGHTING_CONTROL_DO_CN')?.pointTableTemplate as PointTableTemplate);

    expect(rows).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({ point: 'UI1', description: 'OCCUPANCY SENSOR 1 STATUS' }),
      jasmine.objectContaining({ point: 'UI2', description: 'OCCUPANCY SENSOR 2 STATUS' }),
      jasmine.objectContaining({ point: 'UI3', description: 'SPARE', spare: true }),
      jasmine.objectContaining({ point: 'BO1 (Y1)', description: 'LIGHTING CIRCUIT 1 CMD' }),
      jasmine.objectContaining({ point: 'BO2 (Y2)', description: 'LIGHTING CIRCUIT 2 CMD' }),
      jasmine.objectContaining({ point: 'BO3 (G1)', description: 'SPARE', spare: true }),
    ]));
  });
});
