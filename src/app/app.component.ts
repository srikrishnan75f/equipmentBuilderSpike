import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import { CddConfiguration } from './equipment-builder/models/cdd.model';
import { CddPdfService } from './equipment-builder/services/cdd-pdf.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnDestroy {
  private readonly cddPdfService = inject(CddPdfService);
  private readonly sanitizer = inject(DomSanitizer);
  private objectUrl: string | null = null;

  protected readonly sampleConfiguration = signal<CddConfiguration>({
    equipmentName: 'Lighting Panel DO-CN-04',
    siteName: 'Demo Site',
    sequenceId: 'DO_LIGHTING_CONTROL',
    sequenceName: 'DO - Lighting Control',
    generatedAt: new Date(),
    inputs: {
      lightingCircuitCount: 4,
      controlMode: '6 - Sched with Auto Occ/Vac',
      occupancyDurationMinutes: 20,
      vacancyDurationMinutes: 20,
      flashWarningMinutes: 1,
    },
    resolvedValues: {
      occupancySensorsMapped: 'UI1 to UI4',
      manualOverridesMapped: 'UI5 to UI8',
      scheduleMode: true,
      hardwareCapacity: 'Connect Module UI capacity OK',
    },
    boMappings: [
      { terminal: 'BO1 (Y1)', point: 'BO1', description: 'LIGHTING CIRCUIT 1 CMD', tag: 'LGHT1_CMD', deviceRange: 'CC = ON (24VAC)' },
      { terminal: 'BO2 (Y2)', point: 'BO2', description: 'LIGHTING CIRCUIT 2 CMD', tag: 'LGHT2_CMD', deviceRange: 'CC = ON (24VAC)' },
      { terminal: 'BO3 (G1)', point: 'BO3', description: 'LIGHTING CIRCUIT 3 CMD', tag: 'LGHT3_CMD', deviceRange: 'CC = ON (24VAC)' },
      { terminal: 'BO4 (W1)', point: 'BO4', description: 'LIGHTING CIRCUIT 4 CMD', tag: 'LGHT4_CMD', deviceRange: 'CC = ON (24VAC)' },
    ],
    uiMappings: [
      { terminal: 'UI5', point: 'UI5', description: 'OCCUPANCY SENSOR 1 STATUS', tag: 'OCC1_STS', deviceRange: 'DIGITAL INPUT' },
      { terminal: 'UI6', point: 'UI6', description: 'OCCUPANCY SENSOR 2 STATUS', tag: 'OCC2_STS', deviceRange: 'DIGITAL INPUT' },
      { terminal: 'UI7', point: 'UI7', description: 'OCCUPANCY SENSOR 3 STATUS', tag: 'OCC3_STS', deviceRange: 'DIGITAL INPUT' },
      { terminal: 'UI8', point: 'UI8', description: 'OCCUPANCY SENSOR 4 STATUS', tag: 'OCC4_STS', deviceRange: 'DIGITAL INPUT' },
    ],
    pointList: [
      { terminal: '24 VAC', point: '24V', description: '24 VAC', tag: '24V_IN', deviceRange: '24 VAC' },
      { terminal: '24 VAC COMMON', point: 'GND', description: '24 VAC COMMON', tag: '24V_IN', deviceRange: '24 VAC' },
      { terminal: 'UI5', point: 'UI5', description: 'OCCUPANCY SENSOR 1 STATUS', tag: 'OCC1_STS', deviceRange: 'DIGITAL INPUT' },
      { terminal: 'UI6', point: 'UI6', description: 'OCCUPANCY SENSOR 2 STATUS', tag: 'OCC2_STS', deviceRange: 'DIGITAL INPUT' },
      { terminal: 'UI7', point: 'UI7', description: 'OCCUPANCY SENSOR 3 STATUS', tag: 'OCC3_STS', deviceRange: 'DIGITAL INPUT' },
      { terminal: 'UI8', point: 'UI8', description: 'OCCUPANCY SENSOR 4 STATUS', tag: 'OCC4_STS', deviceRange: 'DIGITAL INPUT' },
      { terminal: 'BO1 (Y1)', point: 'BO1', description: 'LIGHTING CIRCUIT 1 CMD', tag: 'LGHT1_CMD', deviceRange: 'CC = ON (24VAC)' },
      { terminal: 'BO2 (Y2)', point: 'BO2', description: 'LIGHTING CIRCUIT 2 CMD', tag: 'LGHT2_CMD', deviceRange: 'CC = ON (24VAC)' },
      { terminal: 'BO3 (G1)', point: 'BO3', description: 'LIGHTING CIRCUIT 3 CMD', tag: 'LGHT3_CMD', deviceRange: 'CC = ON (24VAC)' },
      { terminal: 'BO4 (W1)', point: 'BO4', description: 'LIGHTING CIRCUIT 4 CMD', tag: 'LGHT4_CMD', deviceRange: 'CC = ON (24VAC)' },
    ],
    hardwareValid: true,
    validationMessages: ['Sample values only. Excel-driven data will replace this model in the next phase.'],
  });

  protected readonly previewUrl = signal<SafeResourceUrl | null>(null);
  protected readonly isGenerating = signal(false);
  protected readonly generationError = signal<string | null>(null);
  protected readonly hasPreview = computed(() => this.previewUrl() !== null);

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
      const blob = await this.cddPdfService.generate({
        ...this.sampleConfiguration(),
        generatedAt: new Date(),
      });
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
      const blob = await this.cddPdfService.generate({
        ...this.sampleConfiguration(),
        generatedAt: new Date(),
      });
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
}
