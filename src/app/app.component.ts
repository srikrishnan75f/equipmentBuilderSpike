import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import { CddConfiguration, EquipmentBuilderSelection } from './equipment-builder/models/cdd.model';
import { CddPdfService, PointTableRow } from './equipment-builder/services/cdd-pdf.service';
import { CddSelectionResolverService } from './equipment-builder/services/cdd-selection-resolver.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnDestroy {
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
  protected readonly isGenerating = signal(false);
  protected readonly generationError = signal<string | null>(null);
  protected readonly hasPreview = computed(() => this.previewUrl() !== null);
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

  ngOnDestroy(): void {
    this.revokePreviewUrl();
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

  protected closePreview(): void {
    this.revokePreviewUrl();
  }

  protected updateSelectedValueJson(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    this.selectedValueJson.set(textarea.value);
    this.generationError.set(null);
  }

  protected resetSelectedValueJson(): void {
    this.selectedValueJson.set(JSON.stringify(this.selectedValue(), null, 2));
    this.generationError.set(null);
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

  private parseSelectedValueJson(): EquipmentBuilderSelection {
    try {
      const parsed = JSON.parse(this.selectedValueJson()) as EquipmentBuilderSelection;

      if (!parsed.sequenceId || !parsed.sequenceName || !Array.isArray(parsed.parameters)) {
        throw new Error('JSON must include sequenceId, sequenceName, and parameters array.');
      }

      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Selected value JSON is invalid: ${error.message}`);
      }

      throw error;
    }
  }
}
