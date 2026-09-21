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
  private readonly wiringDiagramSvgUrl = 'assets/ftconnect-module-semantic.svg';
  private readonly terminals = [
    'UI1', 'UI2', 'UI3', 'UI4', 'UI5', 'UI6', 'UI7', 'UI8',
    'AO1', 'AO2', 'AO3', 'AO4',
    'BO1', 'BO2', 'BO3', 'BO4', 'BO5', 'BO6', 'BO7', 'BO8',
  ];
  private readonly labelAnchors: Record<string, { x: number; y: number; orientation: 'horizontal' | 'vertical'; width: number; height: number }> = {
    UI1: { x: 226, y: 154, orientation: 'vertical', width: 17, height: 50 },
    UI2: { x: 242, y: 105, orientation: 'vertical', width: 17, height: 50 },
    UI3: { x: 258, y: 154, orientation: 'vertical', width: 17, height: 50 },
    UI4: { x: 274, y: 105, orientation: 'vertical', width: 17, height: 50 },
    UI5: { x: 325, y: 154, orientation: 'vertical', width: 17, height: 50 },
    UI6: { x: 341, y: 105, orientation: 'vertical', width: 17, height: 50 },
    UI7: { x: 357, y: 154, orientation: 'vertical', width: 17, height: 50 },
    UI8: { x: 373, y: 105, orientation: 'vertical', width: 17, height: 50 },
    AO1: { x: 500, y: 276, orientation: 'horizontal', width: 62, height: 16 },
    AO2: { x: 557, y: 292, orientation: 'horizontal', width: 62, height: 16 },
    AO3: { x: 500, y: 363, orientation: 'horizontal', width: 62, height: 16 },
    AO4: { x: 557, y: 379, orientation: 'horizontal', width: 62, height: 16 },
    BO1: { x: 88, y: 482, orientation: 'horizontal', width: 70, height: 16 },
    BO2: { x: 88, y: 510, orientation: 'horizontal', width: 70, height: 16 },
    BO3: { x: 88, y: 538, orientation: 'horizontal', width: 70, height: 16 },
    BO4: { x: 88, y: 566, orientation: 'horizontal', width: 70, height: 16 },
    BO5: { x: 88, y: 594, orientation: 'horizontal', width: 70, height: 16 },
    BO6: { x: 88, y: 622, orientation: 'horizontal', width: 70, height: 16 },
    BO7: { x: 88, y: 650, orientation: 'horizontal', width: 70, height: 16 },
    BO8: { x: 88, y: 677, orientation: 'horizontal', width: 70, height: 16 },
  };

  async generate(configuration: CddConfiguration): Promise<Blob> {
    const templateBytes = await this.loadTemplate();
    const pdf = await PDFDocument.load(templateBytes);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const [page] = pdf.getPages();
    const { width } = page.getSize();

    await this.writeWiringDiagram(pdf, page, font, configuration);
    this.writePointsTable(page, font, boldFont, configuration);
    this.writeTitleBlock(page, font, width, configuration);

    const generatedBytes = await pdf.save();
    return new Blob([generatedBytes], { type: 'application/pdf' });
  }

  async generateWiringDiagramSvg(configuration: CddConfiguration): Promise<string> {
    const svg = await this.loadWiringDiagramSvg();
    const activePoints = new Map(configuration.pointList.map((point) => [this.normalizeTerminal(point.terminal), point]));
    return this.renderScenarioSvg(svg, activePoints);
  }

  private async loadTemplate(): Promise<ArrayBuffer> {
    const response = await fetch(this.templatePdfUrl);

    if (!response.ok) {
      throw new Error(`Unable to load Connect Module Generic PDF: ${response.status} ${response.statusText}`);
    }

    return response.arrayBuffer();
  }

  private async writeWiringDiagram(
    pdf: PDFDocument,
    page: PDFPage,
    font: PDFFont,
    configuration: CddConfiguration,
  ): Promise<void> {
    const pageHeight = page.getHeight();
    const renderedSvg = await this.generateWiringDiagramSvg(configuration);
    const pngBytes = await this.svgToPng(renderedSvg, 1972, 2376);
    const image = await pdf.embedPng(pngBytes);

    this.fill(page, 24, 24, 586, pageHeight - 44, 1, 1, 1);
    this.drawText(page, 'WIRING DIAGRAM', 30, pageHeight - 38, font, 10);
    page.drawImage(image, {
      x: 65,
      y: 145,
      width: 470,
      height: 566,
    });
  }

  private async loadWiringDiagramSvg(): Promise<string> {
    const response = await fetch(this.wiringDiagramSvgUrl);

    if (!response.ok) {
      throw new Error(`Unable to load wiring diagram SVG: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  private renderScenarioSvg(svg: string, activePoints: Map<string, CddPoint>): string {
    let rendered = svg.replace('<svg ', '<svg shape-rendering="geometricPrecision" ');
    const activeLabels: string[] = ['<g id="CDD_DYNAMIC_LABELS">'];

    for (const terminal of this.terminals) {
      const point = activePoints.get(terminal);
      const anchor = this.labelAnchors[terminal];

      if (!point) {
        rendered = this.hideElementsByIdPrefix(rendered, `${terminal}_`);
        continue;
      }

      if (anchor) {
        rendered = this.hideLabelArtwork(rendered, terminal);
        activeLabels.push(this.dynamicLabel(anchor, this.labelForPoint(point)));
      }
    }

    if (!this.hasAnyActiveTerminal(activePoints, ['AO1', 'AO2'])) {
      rendered = this.hideElementsByIdPrefix(rendered, 'AO1_AO2_SHARED_');
    }

    if (!this.hasAnyActiveTerminal(activePoints, this.terminals.filter((terminal) => terminal.startsWith('BO')))) {
      rendered = this.hideElementById(rendered, 'BO_SHARED_JUNCTION_VERTICAL_LINE');
    }

    activeLabels.push('</g>');
    return rendered.replace('</svg>', `${activeLabels.join('')}</svg>`);
  }

  private hideLabelArtwork(svg: string, terminal: string): string {
    let rendered = this.hideElementById(svg, `${terminal}_LABEL`);
    rendered = this.hideElementsByIdPrefix(rendered, `${terminal}_LABEL_BORDER_PART_`);

    if (terminal === 'AO1' || terminal === 'AO2') {
      rendered = this.hideElementsByIdPrefix(rendered, 'AO1_AO2_SHARED_LABEL_BORDER_PART_');
    }

    return rendered;
  }

  private hideElementsByIdPrefix(svg: string, prefix: string): string {
    const idPattern = `${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*`;
    return svg.replace(
      new RegExp(`<([a-zA-Z][\\w:-]*)\\b(?=[^>]*\\bid="${idPattern}")[^>]*>`, 'g'),
      (match) => this.addDisplayNone(match),
    );
  }

  private hideElementById(svg: string, id: string): string {
    const idPattern = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return svg.replace(
      new RegExp(`<([a-zA-Z][\\w:-]*)\\b(?=[^>]*\\bid="${idPattern}")[^>]*>`, 'g'),
      (match) => this.addDisplayNone(match),
    );
  }

  private addDisplayNone(openingTag: string): string {
    if (/\sstyle="/.test(openingTag)) {
      return openingTag.replace(/\sstyle="([^"]*)"/, (_match, style: string) => ` style="${style};display:none"`);
    }

    return openingTag.replace(/\/?>$/, (end) => ` style="display:none"${end}`);
  }

  private hasAnyActiveTerminal(activePoints: Map<string, CddPoint>, terminals: string[]): boolean {
    return terminals.some((terminal) => activePoints.has(terminal));
  }

  private labelBox(
    anchor: { x: number; y: number; orientation: 'horizontal' | 'vertical'; width: number; height: number },
  ): { width: number; height: number } {
    return {
      width: anchor.width,
      height: anchor.height,
    };
  }

  private dynamicLabel(
    anchor: { x: number; y: number; orientation: 'horizontal' | 'vertical'; width: number; height: number },
    value: string,
  ): string {
    const { width: boxWidth, height: boxHeight } = this.labelBox(anchor);
    const x = anchor.x - boxWidth / 2;
    const y = anchor.y - boxHeight / 2;
    const fontSize = this.labelFontSize(value, anchor);
    const escapedValue = this.escapeXml(value);
    const textTransform = anchor.orientation === 'vertical'
      ? ` transform="rotate(-90 ${anchor.x} ${anchor.y})"`
      : '';

    return [
      `<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="4" ry="4" fill="#fff" stroke="#545454" stroke-width="0.75"/>`,
      `<text x="${anchor.x}" y="${anchor.y + 0.5}"${textTransform} text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="#007fff">${escapedValue}</text>`,
    ].join('');
  }

  private labelFontSize(
    value: string,
    anchor: { orientation: 'horizontal' | 'vertical'; width: number; height: number },
  ): number {
    const available = anchor.orientation === 'vertical' ? anchor.height : anchor.width;
    if (value.length <= 9) return 8.4;
    return Math.max(5.8, Math.min(8.4, available / Math.max(value.length, 1) * 1.45));
  }

  private labelForPoint(point: CddPoint): string {
    const pointWithDomain = point as CddPoint & { domainName?: string; displayName?: string };
    return pointWithDomain.domainName || pointWithDomain.displayName || point.tag || point.description || point.terminal;
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private async svgToPng(svg: string, width: number, height: number): Promise<Uint8Array> {
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    const image = await this.loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Unable to create canvas context for wiring diagram rendering.');
    }

    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error('Unable to render wiring diagram PNG.'));
        }
      }, 'image/png');
    });

    return new Uint8Array(await pngBlob.arrayBuffer());
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Unable to load generated wiring diagram SVG image.'));
      image.src = url;
    });
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
    if (configuration.projectAddress?.trim()) {
      return configuration.projectAddress.trim();
    }

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
