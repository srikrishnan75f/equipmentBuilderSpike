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
    UI5: { x: 317, y: 154, orientation: 'vertical', width: 17, height: 50 },
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
  private readonly terminalAnchors: Record<string, { x: number; y: number }> = {
    UI1: { x: 226, y: 252 },
    UI2: { x: 242, y: 252 },
    UI3: { x: 258, y: 252 },
    UI4: { x: 274, y: 252 },
    UI5: { x: 317, y: 252 },
    UI6: { x: 341, y: 252 },
    UI7: { x: 357, y: 252 },
    UI8: { x: 373, y: 252 },
    AO1: { x: 475, y: 276 },
    AO2: { x: 475, y: 292 },
    AO3: { x: 475, y: 363 },
    AO4: { x: 475, y: 379 },
    BO1: { x: 238, y: 438 },
    BO2: { x: 247, y: 438 },
    BO3: { x: 255, y: 438 },
    BO4: { x: 277, y: 438 },
    BO5: { x: 285, y: 438 },
    BO6: { x: 293, y: 438 },
    BO7: { x: 315, y: 438 },
    BO8: { x: 331, y: 438 },
  };
  private readonly uiCommonTerminalAnchors: Record<string, { x: number; y: number }> = {
    UI1: { x: 234, y: 252 },
    UI2: { x: 250, y: 252 },
    UI3: { x: 266, y: 252 },
    UI4: { x: 282, y: 252 },
    UI5: { x: 309, y: 252 },
    UI6: { x: 333, y: 252 },
    UI7: { x: 349, y: 252 },
    UI8: { x: 365, y: 252 },
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
    const svg = await this.loadWiringDiagramSvg();
    const activePoints = new Map(configuration.pointList.map((point) => [this.normalizeTerminal(point.terminal), point]));
    const renderedSvg = this.renderScenarioSvg(svg, activePoints);
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
    const overlay: string[] = [
      '<g id="CDD_DYNAMIC_CALLOUTS">',
      '<rect x="132" y="72" width="282" height="108" fill="#fff"/>',
      '<rect x="210" y="178" width="188" height="58" fill="#fff"/>',
      '<rect x="455" y="250" width="170" height="150" fill="#fff"/>',
      '<rect x="45" y="454" width="350" height="251" fill="#fff"/>',
      '<rect x="205" y="438" width="150" height="42" fill="#fff"/>',
    ];

    let rendered = svg.replace('<svg ', '<svg shape-rendering="geometricPrecision" ');

    for (const terminal of this.terminals) {
      const point = activePoints.get(terminal);
      const anchor = this.labelAnchors[terminal];

      rendered = this.removeElement(rendered, `${terminal}_LABEL`);
      rendered = this.removeElement(rendered, `${terminal}_LINE`);
      rendered = this.removeElement(rendered, `${terminal}_LINE_SEGMENT_2`);

      if (!point) {
        if (anchor) overlay.push(this.coverLabel(anchor));
        continue;
      }

      if (anchor) {
        overlay.push(this.coverLabel(anchor));
        overlay.push(this.dynamicLine(terminal, anchor));
        overlay.push(this.dynamicLabel(anchor, this.labelForPoint(point)));
      }
    }

    overlay.push('</g>');
    return rendered.replace('</svg>', `${overlay.join('')}</svg>`);
  }

  private dynamicLine(
    terminal: string,
    anchor: { x: number; y: number; orientation: 'horizontal' | 'vertical'; width: number; height: number },
  ): string {
    const terminalAnchor = this.terminalAnchors[terminal];

    if (!terminalAnchor) return '';

    if (anchor.orientation === 'vertical') {
      const labelBottom = anchor.y + anchor.height / 2;
      const commonAnchor = this.uiCommonTerminalAnchors[terminal] ?? { x: terminalAnchor.x + 8, y: terminalAnchor.y };
      const startX = terminalAnchor.x;
      const forkY = 224;

      return [
        `<path d="M${startX},${labelBottom} V${forkY}" fill="none" stroke="#b8b8b8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
        `<path d="M${startX},${forkY} L${terminalAnchor.x},${terminalAnchor.y}" fill="none" stroke="#b8b8b8" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>`,
        `<path d="M${startX},${forkY} L${commonAnchor.x},${commonAnchor.y}" fill="none" stroke="#545454" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>`,
      ].join('');
    }

    if (/^BO/i.test(terminal)) {
      const labelRight = anchor.x + anchor.width / 2;
      const commonX = 230;
      const redY = anchor.y + 7;
      return [
        `<path d="M${labelRight},${anchor.y} H${commonX} V${terminalAnchor.y}" fill="none" stroke="#b8b8b8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
        `<circle cx="${commonX}" cy="${anchor.y}" r="2" fill="#545454"/>`,
        `<path d="M${labelRight},${redY} H${terminalAnchor.x} V${terminalAnchor.y}" fill="none" stroke="#ff4040" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>`,
      ].join('');
    }

    const labelLeft = anchor.x - anchor.width / 2;
    return [
      `<line x1="${terminalAnchor.x}" y1="${terminalAnchor.y}" x2="${labelLeft}" y2="${anchor.y}" stroke="#b8b8b8" stroke-width="2.2" stroke-linecap="round"/>`,
      `<line x1="${terminalAnchor.x}" y1="${terminalAnchor.y}" x2="${labelLeft}" y2="${anchor.y}" stroke="#545454" stroke-width="0.7" stroke-linecap="round"/>`,
    ].join('');
  }

  private removeElement(svg: string, id: string): string {
    const idPattern = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const groupPattern = new RegExp(`<g\\b(?=[^>]*\\bid="${idPattern}")[^>]*>[\\s\\S]*?<\\/g>`, 'g');
    const selfClosingPathPattern = new RegExp(`<path\\b(?=[^>]*\\bid="${idPattern}")[^>]*/>`, 'g');
    const pairedPathPattern = new RegExp(`<path\\b(?=[^>]*\\bid="${idPattern}")[^>]*>[\\s\\S]*?<\\/path>`, 'g');

    return svg
      .replace(groupPattern, '')
      .replace(selfClosingPathPattern, '')
      .replace(pairedPathPattern, '');
  }

  private coverLabel(anchor: { x: number; y: number; orientation: 'horizontal' | 'vertical'; width: number; height: number }): string {
    const width = anchor.orientation === 'vertical' ? anchor.width + 5 : anchor.width + 8;
    const height = anchor.orientation === 'vertical' ? anchor.height + 8 : anchor.height + 6;
    const x = anchor.x - width / 2;
    const y = anchor.y - height / 2;

    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#fff"/>`;
  }

  private dynamicLabel(
    anchor: { x: number; y: number; orientation: 'horizontal' | 'vertical'; width: number; height: number },
    value: string,
  ): string {
    const boxWidth = anchor.orientation === 'vertical' ? anchor.width : Math.max(anchor.width, Math.min(118, value.length * 5.2 + 16));
    const boxHeight = anchor.orientation === 'vertical' ? Math.max(anchor.height, Math.min(118, value.length * 5.2 + 16)) : anchor.height;
    const x = anchor.x - boxWidth / 2;
    const y = anchor.y - boxHeight / 2;
    const fontSize = value.length > 14 ? 7.4 : 8.4;
    const escapedValue = this.escapeXml(value);
    const textTransform = anchor.orientation === 'vertical'
      ? ` transform="rotate(-90 ${anchor.x} ${anchor.y})"`
      : '';

    return [
      `<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="4" ry="4" fill="#fff" stroke="#545454" stroke-width="0.75"/>`,
      `<text x="${anchor.x}" y="${anchor.y + 0.5}"${textTransform} text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="#007fff">${escapedValue}</text>`,
    ].join('');
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
