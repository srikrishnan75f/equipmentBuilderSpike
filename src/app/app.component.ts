import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl, SafeUrl } from '@angular/platform-browser';

import { CddConfiguration, EquipmentBuilderSelection } from './equipment-builder/models/cdd.model';
import { CddPdfService, PointTableRow } from './equipment-builder/services/cdd-pdf.service';
import { CddSelectionResolverService } from './equipment-builder/services/cdd-selection-resolver.service';

type JsonRecord = Record<string, unknown>;

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly cddPdfService = inject(CddPdfService);
  private readonly cddSelectionResolver = inject(CddSelectionResolverService);
  private readonly sanitizer = inject(DomSanitizer);
  private objectUrl: string | null = null;

  protected readonly selectedValue = signal<EquipmentBuilderSelection>({
    sequenceId: 'DO_LIGHTING_CONTROL',
    sequenceName: 'DO - Lighting Control',
    parameters: [
      {
        id: 'lightingCircuitCount',
        category: 'Basic',
        name: 'Lighting Circuits Count',
        type: 'dropdown',
        selectedValue: 2,
      },
      {
        id: 'occupancySensor',
        category: 'Input Sensor',
        name: 'Occupancy Sensor',
        type: 'multiselect',
        selectedValue: [1, 2],
      },
      {
        id: 'manualOverride',
        category: 'Input',
        name: 'Manual Override',
        type: 'multiselect',
        selectedValue: [],
      },
      {
        id: 'controlType',
        category: 'Control',
        name: 'Control Type',
        type: 'dropdown',
        selectedValue: 4,
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
      {
        id: 'scheduleMode',
        category: 'Control',
        name: 'Schedule Mode',
        type: 'dropdown',
        selectedValue: true,
      },
    ],
  });
  protected readonly selectedValueJson = signal(JSON.stringify(this.selectedValue(), null, 2));

  protected readonly previewUrl = signal<SafeResourceUrl | null>(null);
  protected readonly wiringDiagramUrl = signal<SafeUrl | null>(null);
  protected readonly isGenerating = signal(false);
  protected readonly generationError = signal<string | null>(null);
  protected readonly hasPreview = computed(() => this.previewUrl() !== null);
  protected readonly uploadedExcelFileName = signal<string | null>(null);
  protected readonly uploadedExcelBuffer = signal<ArrayBuffer | null>(null);
  protected readonly extractionError = signal<string | null>(null);
  protected readonly extractionStatus = signal<string | null>(null);
  protected readonly resolvedConfiguration = computed<CddConfiguration | null>(() => {
    try {
      return this.cddSelectionResolver.resolve(this.parseSelectedValueJson());
    } catch {
      return null;
    }
  });
  protected readonly tableRows = computed<PointTableRow[]>(() => {
    const configuration = this.resolvedConfiguration();
    return configuration
      ? this.cddPdfService.buildPointTableRows(configuration.pointList, configuration.pointTableTemplate)
      : [];
  });
  protected readonly resolvedSummary = computed(() => {
    const configuration = this.resolvedConfiguration();
    return configuration ? configuration.validationMessages.join(' ') : 'Paste valid selectedValue JSON to preview table rows.';
  });

  ngOnInit(): void {
    void this.refreshWiringDiagramPreview();
  }

  ngOnDestroy(): void {
    this.revokePreviewUrl();
  }

  protected async onExcelSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    this.extractionError.set(null);
    this.extractionStatus.set(null);
    if (!file) {
      this.uploadedExcelFileName.set(null);
      this.uploadedExcelBuffer.set(null);
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      this.uploadedExcelBuffer.set(buffer);
      this.uploadedExcelFileName.set(file.name);
    } catch (error) {
      this.uploadedExcelBuffer.set(null);
      this.uploadedExcelFileName.set(null);
      this.extractionError.set(error instanceof Error ? error.message : 'Unable to read the selected Excel file.');
    }
  }

  protected async extractEquipmentBuilderData(): Promise<void> {
    if (this.isGenerating()) {
      return;
    }

    const buffer = this.uploadedExcelBuffer();
    if (!buffer) {
      this.extractionError.set('Upload an Excel file before running extraction.');
      return;
    }

    this.isGenerating.set(true);
    this.extractionError.set(null);
    this.extractionStatus.set(null);

    try {
      const response = await fetch('/api/extract-equipment-builder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-file-name': this.uploadedExcelFileName() ?? 'equipment-builder.xlsx',
        },
        body: buffer,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || 'Unable to save equipment-builder-data JSON.');
      }

      const payload = await response.json() as { outputPath?: string; items?: number };
      const count = typeof payload.items === 'number' ? payload.items : 0;
      const outputPath = payload.outputPath ?? 'src/app/equipment-builder/data/equipment-builder-data.json';
      this.extractionStatus.set(`Saved ${count} rows to ${outputPath}`);
    } catch (error) {
      this.extractionError.set(error instanceof Error ? error.message : 'Unable to extract equipment-builder-data.');
    } finally {
      this.isGenerating.set(false);
    }
  }

  protected async extractCddData(): Promise<void> {
    if (this.isGenerating()) {
      return;
    }

    const buffer = this.uploadedExcelBuffer();
    if (!buffer) {
      this.extractionError.set('Upload an Excel file before running extraction.');
      return;
    }

    this.isGenerating.set(true);
    this.extractionError.set(null);
    this.extractionStatus.set(null);

    try {
      const response = await fetch('/api/extract-cdd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-file-name': this.uploadedExcelFileName() ?? 'cdd-source.xlsx',
        },
        body: buffer,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || 'Unable to save CDD JSON files.');
      }

      const payload = await response.json() as {
        outputPath?: string;
        sequenceCount?: number;
        scenarioCount?: number;
      };
      const sequenceCount = typeof payload.sequenceCount === 'number' ? payload.sequenceCount : 0;
      const scenarioCount = typeof payload.scenarioCount === 'number' ? payload.scenarioCount : 0;
      const outputPath = payload.outputPath ?? 'src/app/equipment-builder/data/seq-parameter-cdd.json';

      this.extractionStatus.set(
        `CDD saved (${sequenceCount} sequence(s), ${scenarioCount} scenario(s)) to ${outputPath}`,
      );
    } catch (error) {
      this.extractionError.set(error instanceof Error ? error.message : 'Unable to extract CDD data.');
    } finally {
      this.isGenerating.set(false);
    }
  }

  protected async extractAllData(): Promise<void> {
    if (this.isGenerating()) {
      return;
    }

    const buffer = this.uploadedExcelBuffer();
    if (!buffer) {
      this.extractionError.set('Upload an Excel file before running extraction.');
      return;
    }

    this.isGenerating.set(true);
    this.extractionError.set(null);
    this.extractionStatus.set(null);

    try {
      const response = await fetch('/api/extract-all-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-file-name': this.uploadedExcelFileName() ?? 'equipment-source.xlsx',
        },
        body: buffer,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || 'Unable to save extracted JSON files.');
      }

      const payload = await response.json() as {
        combinedOutputPath?: string;
        equipmentItems?: number;
        cddSequenceCount?: number;
        cddScenarioCount?: number;
      };

      const equipmentItems = typeof payload.equipmentItems === 'number' ? payload.equipmentItems : 0;
      const cddSequenceCount = typeof payload.cddSequenceCount === 'number' ? payload.cddSequenceCount : 0;
      const cddScenarioCount = typeof payload.cddScenarioCount === 'number' ? payload.cddScenarioCount : 0;
      const combinedOutputPath = payload.combinedOutputPath ?? 'src/app/equipment-builder/data/seq-parameter-cdd.json';

      this.extractionStatus.set(
        `Merged builder data (${equipmentItems} rows) into combined JSON; ` +
        `CDD (${cddSequenceCount} sequence(s), ${cddScenarioCount} scenario(s)); ` +
        `combined JSON to ${combinedOutputPath}`,
      );
    } catch (error) {
      this.extractionError.set(error instanceof Error ? error.message : 'Unable to extract builder and CDD data.');
    } finally {
      this.isGenerating.set(false);
    }
  }

  protected async previewCdd(): Promise<void> {
    if (this.isGenerating()) {
      return;
    }

    this.isGenerating.set(true);
    this.generationError.set(null);

    try {
      const configuration = this.cddSelectionResolver.resolve(this.parseSelectedValueJson());
      const blob = await this.cddPdfService.generate(configuration);
      this.setPreviewBlob(blob);
    } catch (error) {
      this.generationError.set(error instanceof Error ? error.message : 'Unable to generate CDD PDF.');
    } finally {
      this.isGenerating.set(false);
    }
  }

  protected async downloadCdd(): Promise<void> {
    if (this.isGenerating()) {
      return;
    }

    this.isGenerating.set(true);
    this.generationError.set(null);

    try {
      const configuration = this.cddSelectionResolver.resolve(this.parseSelectedValueJson());
      const blob = await this.cddPdfService.generate(configuration);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'sample-cdd.pdf';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.generationError.set(error instanceof Error ? error.message : 'Unable to download CDD PDF.');
    } finally {
      this.isGenerating.set(false);
    }
  }

  protected async downloadWiringSvg(): Promise<void> {
    if (this.isGenerating()) {
      return;
    }

    this.isGenerating.set(true);
    this.generationError.set(null);

    try {
      const configuration = this.cddSelectionResolver.resolve(this.parseSelectedValueJson());
      const svg = await this.cddPdfService.generateWiringDiagramSvg(configuration);
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${this.fileNamePart(configuration.sequenceName)}-wiring-diagram.svg`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.generationError.set(error instanceof Error ? error.message : 'Unable to download wiring SVG.');
    } finally {
      this.isGenerating.set(false);
    }
  }

  protected closePreview(): void {
    this.revokePreviewUrl();
  }

  protected updateSelectedValueJson(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    this.selectedValueJson.set(textarea.value);
    this.generationError.set(null);
    void this.refreshWiringDiagramPreview();
  }

  protected resetSelectedValueJson(): void {
    this.selectedValueJson.set(JSON.stringify(this.selectedValue(), null, 2));
    this.generationError.set(null);
    void this.refreshWiringDiagramPreview();
  }

  private setPreviewBlob(blob: Blob): void {
    this.revokePreviewUrl();
    this.objectUrl = URL.createObjectURL(blob);
    this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
  }

  private revokePreviewUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.previewUrl.set(null);
  }

  private fileNamePart(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cdd';
  }

  private async refreshWiringDiagramPreview(): Promise<void> {
    try {
      const configuration = this.cddSelectionResolver.resolve(this.parseSelectedValueJson());
      const svg = await this.cddPdfService.generateWiringDiagramSvg(configuration);
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      this.wiringDiagramUrl.set(this.sanitizer.bypassSecurityTrustUrl(url));
    } catch {
      this.wiringDiagramUrl.set(null);
    }
  }

  private parseSelectedValueJson(): EquipmentBuilderSelection {
    try {
      const parsed = JSON.parse(this.selectedValueJson()) as unknown;
      return this.normalizeSelectedValuePayload(parsed);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Selected value JSON is invalid: ${error.message}`);
      }

      throw error;
    }
  }

  private normalizeSelectedValuePayload(payload: unknown): EquipmentBuilderSelection {
    if (!this.isRecord(payload)) {
      throw new Error('JSON must be an object.');
    }

    const legacySelection = this.selectionFromRecord(payload);
    if (legacySelection) {
      return legacySelection;
    }

    const selectedSequence = payload['selectedSequence'];
    if (!this.isRecord(selectedSequence)) {
      throw new Error('JSON must include either sequenceId/sequenceName/parameters or selectedSequence.');
    }

    const parameterSource = Array.isArray(payload['parameterDetails'])
      ? payload['parameterDetails']
      : selectedSequence['parameters'];

    if (!Array.isArray(parameterSource)) {
      throw new Error('New payload JSON must include parameterDetails or selectedSequence.parameters array.');
    }

    const sequenceId = this.stringField(selectedSequence, 'sequenceId', 'id', 'name');
    const sequenceName = this.stringField(selectedSequence, 'sequenceName', 'name', 'cdd') ?? sequenceId;

    if (!sequenceId || !sequenceName) {
      throw new Error('New payload JSON must include selectedSequence.sequenceId and selectedSequence.sequenceName.');
    }

    const siteData = payload['siteData'];

    return {
      sequenceId,
      sequenceName,
      siteName: this.isRecord(siteData) ? this.stringField(siteData, 'siteName', 'dis', 'address') : undefined,
      projectAddress: this.isRecord(siteData) ? this.projectAddressFromSiteData(siteData) : undefined,
      parameters: parameterSource.map((parameter, index) => this.normalizeParameter(parameter, index)),
    };
  }

  private selectionFromRecord(record: JsonRecord): EquipmentBuilderSelection | null {
    if (!Array.isArray(record['parameters'])) {
      return null;
    }

    const sequenceId = this.stringField(record, 'sequenceId', 'id');
    const sequenceName = this.stringField(record, 'sequenceName', 'name') ?? sequenceId;

    if (!sequenceId || !sequenceName) {
      return null;
    }

    return {
      sequenceId,
      sequenceName,
      siteName: this.stringField(record, 'siteName'),
      projectAddress: this.stringField(record, 'projectAddress', 'address'),
      parameters: record['parameters'].map((parameter, index) => this.normalizeParameter(parameter, index)),
    };
  }

  private projectAddressFromSiteData(siteData: JsonRecord): string | undefined {
    const directAddress = this.stringField(siteData, 'projectAddress', 'address');
    if (directAddress) return directAddress;

    const locationDetails = siteData['locationDetails'];
    if (!this.isRecord(locationDetails)) return undefined;

    const addressParts = [
      this.stringField(locationDetails, 'geoAddr'),
      this.stringField(locationDetails, 'geoCity'),
      this.stringField(locationDetails, 'geoState'),
      this.stringField(locationDetails, 'geoCountry'),
    ].filter((part): part is string => Boolean(part));
    const postalCode = this.stringField(locationDetails, 'geoPostalCode');

    if (postalCode && addressParts.length > 0) {
      return `${addressParts.join(', ')} - ${postalCode}`;
    }

    return addressParts.join(', ') || postalCode;
  }

  private normalizeParameter(parameter: unknown, index: number): EquipmentBuilderSelection['parameters'][number] {
    if (!this.isRecord(parameter)) {
      throw new Error(`Parameter at index ${index} must be an object.`);
    }

    const id = this.stringField(parameter, 'id', 'key', 'field');
    const name = this.stringField(parameter, 'name', 'parameterName', 'label');
    const type = this.stringField(parameter, 'type', 'inputType') ?? 'text';

    if (!id || !name) {
      throw new Error(`Parameter at index ${index} must include id and name.`);
    }

    return {
      id,
      category: this.stringField(parameter, 'category') ?? '',
      name,
      type,
      default: this.selectedValueLike(parameter['default']),
      selectedValue: Object.prototype.hasOwnProperty.call(parameter, 'selectedValue')
        ? this.selectedValueLike(parameter['selectedValue'])
        : this.selectedValueLike(parameter['default']),
      unit: this.stringField(parameter, 'unit'),
      options: Array.isArray(parameter['options'])
        ? parameter['options']
          .filter((option): option is JsonRecord => this.isRecord(option))
          .map((option) => ({
            label: this.stringField(option, 'label', 'name') ?? String(option['value'] ?? ''),
            value: this.scalarValue(option['value']),
          }))
        : undefined,
    };
  }

  private selectedValueLike(value: unknown): string | number | boolean | null | Array<string | number | boolean | null> {
    if (Array.isArray(value)) {
      return value.map((item) => this.scalarValue(item));
    }

    return this.scalarValue(value);
  }

  private scalarValue(value: unknown): string | number | boolean | null {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null
      ? value
      : null;
  }

  private stringField(record: JsonRecord, ...keys: string[]): string | undefined {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }

    return undefined;
  }

  private isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

}
