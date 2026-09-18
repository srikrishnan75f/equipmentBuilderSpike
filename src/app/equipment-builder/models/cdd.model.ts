export interface CddPoint {
  terminal: string;
  point: string;
  description: string;
  tag: string;
  deviceRange: string;
  ioType?: string;
  sourceGroup?: string;
  manufacturerPartNumber?: string;
}

export interface CddConfiguration {
  equipmentName: string;
  siteName: string;
  sequenceId: string;
  sequenceName: string;
  generatedAt: Date;
  inputs: Record<string, string | number | boolean>;
  resolvedValues: Record<string, string | number | boolean>;
  boMappings: CddPoint[];
  uiMappings: CddPoint[];
  pointList: CddPoint[];
  pointTableTemplate?: PointTableTemplate;
  hardwareValid: boolean;
  validationMessages: string[];
}

export interface PointTableTemplate {
  rows: PointTableTemplateRow[];
}

export interface PointTableTemplateRow {
  type: 'fixed' | 'terminal';
  point: string;
  terminal?: string;
  description?: string;
  tag?: string;
  deviceRange?: string;
  manufacturerPartNumber?: string;
  spareDescription?: string;
  spareTag?: string;
  spareDeviceRange?: string;
  spare?: boolean;
  shaded?: boolean;
  bold?: boolean;
}

export interface EquipmentBuilderParameterOption {
  label: string;
  value: string | number | boolean | null;
}

export interface EquipmentBuilderParameter {
  id: string;
  category: string;
  name: string;
  type: string;
  default?: string | number | boolean | null | Array<string | number | boolean | null>;
  selectedValue: string | number | boolean | null | Array<string | number | boolean | null>;
  unit?: string | null;
  options?: EquipmentBuilderParameterOption[];
}

export interface EquipmentBuilderSelection {
  sequenceId: string;
  sequenceName: string;
  parameters: EquipmentBuilderParameter[];
}

export interface CddScenario {
  scenario: number;
  sourceRow: number;
  match: Record<string, string | number | boolean>;
  pointGroups: Record<string, CddPoint[]>;
  spares: Record<string, string[]>;
  points: CddPoint[];
}

export interface CddSequence {
  sequenceId: string;
  sequenceName: string;
  sourceWorkbook: string;
  sourceSheet: string;
  dimensions: string[];
  pointTableTemplate?: PointTableTemplate;
  scenarios: CddScenario[];
}

export interface CddSequenceCatalog {
  generatedAt: string;
  sourceWorkbooks: string[];
  sequences: CddSequence[];
}
