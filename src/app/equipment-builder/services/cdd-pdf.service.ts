import { Injectable } from '@angular/core';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import { CddConfiguration } from '../models/cdd.model';

@Injectable({ providedIn: 'root' })
export class CddPdfService {
  private readonly templatePdfUrl = 'assets/connect-module-generic.pdf';

  async generate(configuration: CddConfiguration): Promise<Blob> {
    const templateBytes = await this.loadTemplate();
    const pdf = await PDFDocument.load(templateBytes);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const [page] = pdf.getPages();
    const { width } = page.getSize();

    this.writeTitleBlock(page, font, width, configuration);

    const generatedBytes = await pdf.save();
    return new Blob([generatedBytes], { type: 'application/pdf' });
  }

  private async loadTemplate(): Promise<ArrayBuffer> {
    const response = await fetch(this.templatePdfUrl);

    if (!response.ok) {
      throw new Error(`Unable to load Connect Module Generic PDF: ${response.status} ${response.statusText}`);
    }

    return response.arrayBuffer();
  }

  private writeTitleBlock(
    page: PDFPage,
    font: PDFFont,
    pageWidth: number,
    configuration: CddConfiguration,
  ): void {
    const rightEdge = pageWidth - 18;
    const projectLeft = rightEdge - 262;
    const projectAddress = this.formatAddress(configuration);

    this.text(page, configuration.siteName || 'Demo Site', projectLeft + 120, 91, font, 7.8);

    if (projectAddress) {
      this.text(page, projectAddress, projectLeft + 120, 53, font, 7.4);
    }
  }

  private text(
    page: ReturnType<PDFDocument['getPages']>[number],
    value: string,
    x: number,
    y: number,
    font: PDFFont,
    size: number,
  ): void {
    page.drawText(value, {
      x,
      y,
      size,
      font,
      color: rgb(0, 0, 0),
    });
  }

  private formatAddress(configuration: CddConfiguration): string {
    const projectAddress = configuration.inputs['projectAddress'];
    return typeof projectAddress === 'string' && projectAddress.trim().length > 0 ? projectAddress : '';
  }
}
