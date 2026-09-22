import { Injectable } from '@angular/core';
import { jsPDF } from 'jspdf';

import { CddConfiguration, CddPoint, PointTableTemplate, PointTableTemplateRow } from '../models/cdd.model';

export interface PointTableRow {
  description: string;
  point: string;
  tag: string;
  deviceRange: string;
  manufacturer?: string;
  manufacturerPartNumber?: string;
  spare?: boolean;
  shaded?: boolean;
  bold?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CddPdfService {
  private readonly designWidth = 1224;
  private readonly designHeight = 792;
  private readonly layoutScale = 1;
  private readonly pageOffsetX = 0;
  private readonly pageOffsetY = 0;
  private readonly tableColors = {
    header: this.rgb(217, 217, 217),
    spare: this.rgb(89, 89, 89),
    shaded: this.rgb(231, 230, 230),
    white: this.rgb(255, 255, 255),
    grid: this.rgb(166, 166, 166),
  };
  private readonly templatePngUrl = 'assets/connect-module-template.png';
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
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: [this.designWidth, this.designHeight],
      compress: true,
    });

    await this.writeTemplateBackground(pdf);
    await this.writeWiringDiagram(pdf, configuration);
    this.writePointsTable(pdf, configuration);
    this.writeCommissioningNotes(pdf);
    this.writeTitleBlock(pdf, this.designWidth, configuration);

    return pdf.output('blob');
  }

  async generateWiringDiagramSvg(configuration: CddConfiguration): Promise<string> {
    const svg = await this.loadWiringDiagramSvg();
    const activePoints = new Map(configuration.pointList.map((point) => [this.normalizeTerminal(point.terminal), point]));
    return this.renderScenarioSvg(svg, activePoints);
  }

  private async writeTemplateBackground(pdf: jsPDF): Promise<void> {
    const response = await fetch(this.templatePngUrl);

    if (!response.ok) {
      throw new Error(`Unable to load Connect Module template image: ${response.status} ${response.statusText}`);
    }

    const imageBytes = new Uint8Array(await response.arrayBuffer());
    pdf.addImage(imageBytes, 'PNG', 0, 0, this.designWidth, this.designHeight);
  }

  private async writeWiringDiagram(
    pdf: jsPDF,
    configuration: CddConfiguration,
  ): Promise<void> {
    const renderedSvg = await this.generateWiringDiagramSvg(configuration);
    const pngBytes = await this.svgToPng(renderedSvg, 1972, 2376);

    this.fill(pdf, 24, 24, 586, this.designHeight - 44, 1, 1, 1);
    this.drawText(pdf, 'WIRING DIAGRAM', 30, this.designHeight - 38, 10);
    pdf.addImage(
      pngBytes,
      'PNG',
      this.toPdfX(65),
      this.toPdfY(145, 566),
      this.scale(470),
      this.scale(566),
    );
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
    pdf: jsPDF,
    configuration: CddConfiguration,
  ): void {
    const tableX = 630;
    const tableTop = 52;
    const tableWidth = 568;
    const titleHeight = 18;
    const headerHeight = 16;
    const rows = this.buildPointTableRows(configuration.pointList, configuration.pointTableTemplate);
    const tableBottomY = 245;
    const tableTopY = this.designHeight - tableTop;
    const availableBodyHeight = tableTopY - tableBottomY - titleHeight - headerHeight;
    const rowHeight = Math.min(13.2, availableBodyHeight / Math.max(rows.length, 1));
    const tableHeight = titleHeight + headerHeight + rows.length * rowHeight;
    const tableY = this.designHeight - tableTop - tableHeight;
    const originalTableBottomY = 245;
    const columns = [
      { label: 'DESCRIPTION', width: 205, align: 'left' as const },
      { label: 'POINT', width: 65, align: 'left' as const },
      { label: 'TAG', width: 95, align: 'left' as const },
      { label: 'DEVICE RANGE', width: 260, align: 'left' as const },
      { label: 'MFG', width: 55, align: 'center' as const },
      { label: 'PART #', width: 68, align: 'center' as const },
    ];
    const scale = tableWidth / columns.reduce((total, column) => total + column.width, 0);
    const scaledColumns = columns.map((column) => ({ ...column, width: column.width * scale }));

    this.fill(pdf, tableX - 4, originalTableBottomY, tableWidth + 8, this.designHeight - tableTop - originalTableBottomY + 4, 1, 1, 1);
    this.drawCell(pdf, tableX, tableY + tableHeight - titleHeight, tableWidth, titleHeight, this.tableColors.white, true);
    this.drawText(pdf, 'CONNECT MODULE', tableX + tableWidth / 2, tableY + tableHeight - 12, 9.2, 'center', [0, 0, 0], 'bold');

    let currentY = tableY + tableHeight - titleHeight - headerHeight;
    this.drawTableRow(pdf, scaledColumns, tableX, currentY, headerHeight, {
      description: 'DESCRIPTION',
      point: 'POINT',
      tag: 'TAG',
      deviceRange: 'DEVICE RANGE',
      manufacturer: 'MFG',
      manufacturerPartNumber: 'PART #',
      shaded: true,
      bold: true,
    }, this.tableColors.header);

    currentY -= rowHeight;
    for (const row of rows) {
      this.drawTableRow(
        pdf,
        scaledColumns,
        tableX,
        currentY,
        rowHeight,
        row,
        row.spare ? this.tableColors.spare : row.shaded ? this.tableColors.shaded : this.tableColors.white,
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
    pdf: jsPDF,
    columns: Array<{ label: string; width: number; align: 'left' | 'center' }>,
    x: number,
    y: number,
    height: number,
    row: PointTableRow,
    fillColor: [number, number, number],
  ): void {
    const values = [
      row.description,
      row.point,
      row.tag,
      row.deviceRange,
      row.manufacturer ?? '',
      row.manufacturerPartNumber ?? '',
    ];
    let currentX = x;
    const textColor: [number, number, number] = row.spare ? [1, 1, 1] : [0, 0, 0];

    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
      const fontStyle = row.spare || row.bold ? 'bold' : 'normal';
      const fontSize = Math.min(row.bold ? 7.4 : 7.2, Math.max(5.8, height * 0.58));

      this.drawCell(pdf, currentX, y, column.width, height, fillColor);
      this.drawText(
        pdf,
        this.fitText(pdf, values[index], column.width, fontSize, fontStyle),
        column.align === 'left' ? currentX + 3 : currentX + column.width / 2,
        y + height / 2 - 2.4,
        fontSize,
        column.align,
        textColor,
        fontStyle,
      );
      currentX += column.width;
    }
  }

  private drawCell(
    pdf: jsPDF,
    x: number,
    y: number,
    width: number,
    height: number,
    fillColor: [number, number, number],
    thick = false,
  ): void {
    this.setFillColor(pdf, fillColor);
    this.setDrawColor(pdf, this.tableColors.grid);
    pdf.setLineWidth(this.scale(thick ? 0.65 : 0.45));
    pdf.rect(this.toPdfX(x), this.toPdfY(y, height), this.scale(width), this.scale(height), 'FD');
  }

  private fill(
    pdf: jsPDF,
    x: number,
    y: number,
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
  ): void {
    this.setFillColor(pdf, [r, g, b]);
    pdf.rect(this.toPdfX(x), this.toPdfY(y, height), this.scale(width), this.scale(height), 'F');
  }

  private writeSheetFrame(pdf: jsPDF, configuration: CddConfiguration): void {
    pdf.setLineWidth(this.scale(1));
    pdf.setDrawColor(0, 0, 0);
    pdf.rect(this.toPdfX(18), this.toPdfY(18, 756), this.scale(1188), this.scale(756), 'S');
    this.line(pdf, 610, 126, 610, 774);
    this.line(pdf, 18, 126, 1206, 126);

    this.drawText(pdf, 'POINTS LIST AND COMMISSIONING NOTES', 620, 755, 10, 'left', [0, 0, 0], 'bold');
    this.drawNotesBlock(pdf);
    this.drawLogoBlock(pdf);
    this.drawProjectBlock(pdf, configuration);
  }

  private writeCommissioningNotes(pdf: jsPDF): void {
    const x = 632;
    let y = 222;

    this.fill(pdf, 620, 124, 570, 120.5, 1, 1, 1);
    this.drawText(pdf, '75F COMMISSIONING NOTES:', x, y, 10, 'left', [0, 0, 0], 'bold');
    y -= 24;
    [
      'TO PAIR AND CONFIGURE THE ZONE:',
      '- CONFIGURE THE CONNECT NODE BY NAVIGATING TO INSTALLER OPTIONS.',
      '- UNDER INSTALLER OPTIONS, SELECT CONFIGURE MODE.',
      '- FOR MODE, SELECT ZONE.',
      '- ADD A ZONE TO THE CCU.',
      '- PAIR EACH CIRCUITS AS CONNECT NODE.',
      '- SELECT SAVE.',
    ].forEach((line) => {
      this.drawText(pdf, line, x, y, 7.6);
      y -= 9;
    });

    this.drawText(pdf, 'CONTACT 75F SUPPORT FOR INSTRUCTIONS ON PAIRING TO THE CENTRAL CONTROL UNIT.', x, 132, 7.6);
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.6);
    this.line(pdf, x, 130, 982, 130);
  }

  private drawNotesBlock(pdf: jsPDF): void {
    const x = 18;
    const y = 18;
    const width = 860;
    const height = 108;
    const rowHeight = 26;

    this.line(pdf, x, y + height - 16, x + width, y + height - 16);
    this.line(pdf, x, y + height - 16 - rowHeight, x + width, y + height - 16 - rowHeight);
    this.line(pdf, x, y + height - 16 - rowHeight * 2, x + width, y + height - 16 - rowHeight * 2);
    this.line(pdf, x, y, x + width, y);
    this.line(pdf, x + width, y, x + width, y + height);

    this.drawText(pdf, 'Drawing Notes:', x + 8, y + height - 12, 7.8, 'left', [0, 0, 0], 'bold');
    this.drawText(pdf, '1  RS-485 COMM - CONNECT A TO A, B TO B. DISREGARD', x + 8, y + height - 34, 8.4);
    this.drawText(pdf, '    POLARITY', x + 8, y + height - 48, 8.4);
    this.drawText(pdf, '2', x + 8, y + height - 60, 8.4);
    this.drawText(pdf, '3', x + 8, y + height - 86, 8.4);
  }

  private drawLogoBlock(pdf: jsPDF): void {
    const x = 878;
    const y = 18;
    const width = 110;
    const height = 108;
    this.fill(pdf, x, y, width, height, 1, 1, 1);
    this.line(pdf, x + width, y, x + width, y + height);
    this.draw75fLogo(pdf, x + 18, y + 30);
  }

  private draw75fLogo(pdf: jsPDF, x: number, y: number): void {
    pdf.setLineWidth(this.scale(1.8));
    pdf.setDrawColor(239, 84, 49);
    pdf.circle(this.toPdfX(x + 16), this.toPdfY(y + 18), this.scale(11), 'S');
    pdf.circle(this.toPdfX(x + 16), this.toPdfY(y + 18), this.scale(6), 'S');
    this.line(pdf, x + 16, y + 30, x + 16, y + 12);
    this.drawText(pdf, '75F', x + 52, y + 12, 22, 'left', [0.42, 0.42, 0.45], 'bold');
  }

  private drawProjectBlock(pdf: jsPDF, configuration: CddConfiguration): void {
    pdf.setLineWidth(this.scale(1));
    pdf.setDrawColor(0, 0, 0);

    const right = this.designWidth - 18;
    const left = right - 262;
    const bottom = 18;
    const top = 126;
    const midY = 90;
    const lowerY = 54;

    this.line(pdf, left, bottom, left, top);
    this.line(pdf, left, midY, right, midY);
    this.line(pdf, left, lowerY, right, lowerY);
    this.line(pdf, left + 56, bottom, left + 56, lowerY);
    this.line(pdf, left + 112, bottom, left + 112, lowerY);
    this.line(pdf, left + 174, bottom, left + 174, lowerY);

    this.drawText(pdf, 'Project Name:', left + 8, top - 18, 8, 'left', [0, 0, 0], 'bold');
    this.drawText(pdf, configuration.siteName || 'Demo Site', left + 120, top - 35, 7.8);
    this.drawText(pdf, 'REV.0', left + 120, top - 48, 7.8);
    this.drawText(pdf, 'Project Address:', left + 8, midY - 12, 8, 'left', [0, 0, 0], 'bold');
    this.drawText(pdf, 'DB:', left + 8, lowerY - 14, 8, 'left', [0, 0, 0], 'bold');
    this.drawText(pdf, 'CB:', left + 66, lowerY - 14, 8, 'left', [0, 0, 0], 'bold');
    this.drawText(pdf, 'Page:', left + 126, lowerY - 14, 8, 'left', [0, 0, 0], 'bold');
    this.drawText(pdf, 'of', left + 206, lowerY - 14, 8, 'left', [0, 0, 0], 'bold');
    this.drawText(pdf, 'Drawing:', 888, 10, 7, 'left', [0, 0, 0], 'bold');
    this.drawText(pdf, 'CONNECT MODULE GENERIC', 974, 10, 7, 'left');
  }

  private writeTitleBlock(
    pdf: jsPDF,
    pageWidth: number,
    configuration: CddConfiguration,
  ): void {
    const rightEdge = pageWidth - 18;
    const projectLeft = rightEdge - 262;
    const projectAddress = this.formatAddress(configuration);

    this.drawText(pdf, configuration.siteName || 'Demo Site', projectLeft + 120, 91, 7.8);

    if (projectAddress) {
      this.drawText(pdf, projectAddress, projectLeft + 120, 53, 7.4);
    }
  }

  private drawText(
    pdf: jsPDF,
    value: string,
    x: number,
    y: number,
    size: number,
    align: 'left' | 'center' = 'left',
    color: [number, number, number] = [0, 0, 0],
    fontStyle: 'normal' | 'bold' = 'normal',
  ): void {
    pdf.setFont('helvetica', fontStyle);
    pdf.setFontSize(this.scale(size));
    this.setTextColor(pdf, color);
    const textX = align === 'center' ? x - pdf.getTextWidth(value) / 2 : x;

    pdf.text(value, this.toPdfX(textX), this.toPdfY(y));
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

  private fitText(
    pdf: jsPDF,
    value: string,
    width: number,
    size: number,
    fontStyle: 'normal' | 'bold',
  ): string {
    let text = value;
    const maxWidth = this.scale(width - 6);
    pdf.setFont('helvetica', fontStyle);
    pdf.setFontSize(this.scale(size));

    while (text.length > 1 && pdf.getTextWidth(text) > maxWidth) {
      text = text.slice(0, -1);
    }

    return text;
  }

  private line(pdf: jsPDF, x1: number, y1: number, x2: number, y2: number): void {
    pdf.line(this.toPdfX(x1), this.toPdfY(y1), this.toPdfX(x2), this.toPdfY(y2));
  }

  private fillPage(pdf: jsPDF): void {
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, this.designWidth, this.designHeight, 'F');
  }

  private scale(value: number): number {
    return value * this.layoutScale;
  }

  private toPdfX(x: number): number {
    return this.pageOffsetX + this.scale(x);
  }

  private toPdfY(y: number, height = 0): number {
    return this.pageOffsetY + this.scale(this.designHeight - y - height);
  }

  private setFillColor(pdf: jsPDF, color: [number, number, number]): void {
    pdf.setFillColor(...color.map((value) => Math.round(value * 255)) as [number, number, number]);
  }

  private setDrawColor(pdf: jsPDF, color: [number, number, number]): void {
    pdf.setDrawColor(...color.map((value) => Math.round(value * 255)) as [number, number, number]);
  }

  private setTextColor(pdf: jsPDF, color: [number, number, number]): void {
    pdf.setTextColor(...color.map((value) => Math.round(value * 255)) as [number, number, number]);
  }

  private rgb(red: number, green: number, blue: number): [number, number, number] {
    return [red / 255, green / 255, blue / 255];
  }
}
