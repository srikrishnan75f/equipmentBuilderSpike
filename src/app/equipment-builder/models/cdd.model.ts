export interface CddPoint {
  terminal: string;
  point: string;
  description: string;
  tag: string;
  deviceRange: string;
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
  hardwareValid: boolean;
  validationMessages: string[];
}
