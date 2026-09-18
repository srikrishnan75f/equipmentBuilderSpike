import { Injectable } from '@angular/core';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import { CddConfiguration, CddPoint, PointTableTemplate, PointTableTemplateRow } from '../models/cdd.model';

export interface PointTableRow {
  description: string;
  point: string;
  tag: string;
  deviceRange: string;
  manufacturerPartNumber?: string;
  spare?: boolean;
  shaded?: boolean;
  bold?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CddPdfService {
  private readonly templatePdfUrl = 'assets/connect-module-generic.pdf';

  async generate(configuration: CddConfiguration): Promise<Blob> {
    const templateBytes = await this.loadTemplate();
    const pdf = await PDFDocument.load(templateBytes);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const [page] = pdf.getPages();
    const { width } = page.getSize();

    this.writePointsTable(page, font, boldFont, configuration);
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

  private writePointsTable(
    page: PDFPage,
    font: PDFFont,
    boldFont: PDFFont,
    configuration: CddConfiguration,
  ): void {
    const pageHeight = page.getHeight();
    const tableX = 632;
    const tableTop = 52;
    const tableWidth = 560;
    const titleHeight = 18;
    const headerHeight = 16;
    const rowHeight = 12.5;
    const rows = this.buildPointTableRows(configuration.pointList, configuration.pointTableTemplate);
    const tableHeight = titleHeight + headerHeight + rows.length * rowHeight;
    const tableY = pageHeight - tableTop - tableHeight;
    const originalTableBottomY = 245;
    const columns = [
      { label: 'DESCRIPTION', width: 160, align: 'left' as const },
      { label: 'POINT', width: 74, align: 'center' as const },
      { label: 'TAG', width: 116, align: 'center' as const },
      { label: 'DEVICE RANGE', width: 270, align: 'center' as const },
      { label: 'MFG PART #', width: 90, align: 'center' as const },
    ];
    const scale = tableWidth / columns.reduce((total, column) => total + column.width, 0);
    const scaledColumns = columns.map((column) => ({ ...column, width: column.width * scale }));

    this.fill(page, tableX - 4, originalTableBottomY, tableWidth + 8, pageHeight - tableTop - originalTableBottomY + 4, 1, 1, 1);
    this.drawCell(page, tableX, tableY + tableHeight - titleHeight, tableWidth, titleHeight, [1, 1, 1], true);
    this.drawText(page, 'CONNECT MODULE', tableX + tableWidth / 2, tableY + tableHeight - 12, boldFont, 9.2, 'center');

    let currentY = tableY + tableHeight - titleHeight - headerHeight;
    this.drawTableRow(page, scaledColumns, tableX, currentY, headerHeight, {
      description: 'DESCRIPTION',
      point: 'POINT',
      tag: 'TAG',
      deviceRange: 'DEVICE RANGE',
      manufacturerPartNumber: 'MFG PART #',
      shaded: true,
      bold: true,
    }, font, boldFont, [0.86, 0.86, 0.86]);

    currentY -= rowHeight;
    for (const row of rows) {
      this.drawTableRow(
        page,
        scaledColumns,
        tableX,
        currentY,
        rowHeight,
        row,
        font,
        boldFont,
        row.spare ? [0.36, 0.36, 0.36] : row.shaded ? [0.82, 0.82, 0.82] : [1, 1, 1],
      );
      currentY -= rowHeight;
    }
  }

  buildPointTableRows(points: CddPoint[], template?: PointTableTemplate): PointTableRow[] {
    const pointMap = new Map(points.map((point) => [this.normalizeTerminal(point.terminal), point]));

    return (template?.rows ?? []).map((row) => (
      row.type === 'terminal' ? this.dynamicTerminalRow(row, pointMap) : this.fixedRow(row)
    ));
  }

  private fixedRow(row: PointTableTemplateRow): PointTableRow {
    return {
      description: row.description ?? '',
      point: row.point,
      tag: row.tag ?? '',
      deviceRange: row.deviceRange ?? '',
      manufacturerPartNumber: row.manufacturerPartNumber,
      spare: row.spare,
      shaded: row.shaded,
      bold: row.bold,
    };
  }

  private dynamicTerminalRow(row: PointTableTemplateRow, pointMap: Map<string, CddPoint>): PointTableRow {
    const point = row.terminal ? pointMap.get(row.terminal) : undefined;

    if (!point) {
      return {
        description: row.spareDescription ?? 'SPARE',
        point: row.point,
        tag: row.spareTag ?? '-',
        deviceRange: row.spareDeviceRange ?? '-',
        spare: true,
      };
    }

    return {
      description: point.description,
      point: row.point,
      tag: point.tag || '-',
      deviceRange: point.deviceRange || '-',
    };
  }

  private drawTableRow(
    page: PDFPage,
    columns: Array<{ label: string; width: number; align: 'left' | 'center' }>,
    x: number,
    y: number,
    height: number,
    row: PointTableRow,
    font: PDFFont,
    boldFont: PDFFont,
    fillColor: [number, number, number],
  ): void {
    const values = [
      row.description,
      row.point,
      row.tag,
      row.deviceRange,
      row.manufacturerPartNumber ?? '',
    ];
    let currentX = x;
    const textColor: [number, number, number] = row.spare ? [1, 1, 1] : [0, 0, 0];

    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
      this.drawCell(page, currentX, y, column.width, height, fillColor);
      this.drawText(
        page,
        this.fitText(values[index], column.width, row.spare || row.bold ? boldFont : font, row.spare || row.bold ? 7.2 : 7),
        column.align === 'left' ? currentX + 3 : currentX + column.width / 2,
        y + height / 2 - 2.4,
        row.spare || row.bold ? boldFont : font,
        row.spare || row.bold ? 7.2 : 7,
        column.align,
        textColor,
      );
      currentX += column.width;
    }
  }

  private drawCell(
    page: PDFPage,
    x: number,
    y: number,
    width: number,
    height: number,
    fillColor: [number, number, number],
    thick = false,
  ): void {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: rgb(...fillColor),
      borderColor: rgb(0.52, 0.52, 0.52),
      borderWidth: thick ? 0.8 : 0.55,
    });
  }

  private fill(
    page: PDFPage,
    x: number,
    y: number,
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
  ): void {
    page.drawRectangle({ x, y, width, height, color: rgb(r, g, b) });
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

    this.drawText(page, configuration.siteName || 'Demo Site', projectLeft + 120, 91, font, 7.8);

    if (projectAddress) {
      this.drawText(page, projectAddress, projectLeft + 120, 53, font, 7.4);
    }
  }

  private drawText(
    page: PDFPage,
    value: string,
    x: number,
    y: number,
    font: PDFFont,
    size: number,
    align: 'left' | 'center' = 'left',
    color: [number, number, number] = [0, 0, 0],
  ): void {
    const textX = align === 'center' ? x - font.widthOfTextAtSize(value, size) / 2 : x;

    page.drawText(value, {
      x: textX,
      y,
      size,
      font,
      color: rgb(...color),
    });
  }

  private formatAddress(configuration: CddConfiguration): string {
    const projectAddress = configuration.inputs['projectAddress'];
    return typeof projectAddress === 'string' && projectAddress.trim().length > 0 ? projectAddress : '';
  }

  private normalizeTerminal(terminal: string): string {
    const match = terminal.toUpperCase().match(/^(BO|UI|AO|AI|BI|DO|DI)\d+/);
    return match ? match[0] : terminal.toUpperCase();
  }

  private fitText(value: string, width: number, font: PDFFont, size: number): string {
    let text = value;
    const maxWidth = width - 6;

    while (text.length > 1 && font.widthOfTextAtSize(text, size) > maxWidth) {
      text = text.slice(0, -1);
    }

    return text;
  }
}
