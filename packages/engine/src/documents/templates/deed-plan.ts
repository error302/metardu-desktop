/**
 * Deed Plan Template — Kenya Survey Department Standard
 *
 * Generates a complete vector PDF deed plan that meets Kenya
 * Survey Department (SoK) standards for submission to Ardhi House.
 *
 * Layout: A1 landscape (841 × 594mm)
 * Title block in bottom-right corner (SoK standard layout)
 * Grid overlay with Cassini-Soldner or UTM coordinates
 * North arrow with grid convergence
 * Beacon schedule table
 * Area computation table
 * Surveyor signature block
 * Plan number, LR number, registry
 * Scale bar
 *
 * Watermark:
 * - Free plan: "METARDU" watermark diagonally across the plan
 * - Paid plan + company logo: Logo in title block
 * - Paid plan + no logo: Blank (no watermark)
 */

import {
  createSurveyDocument,
  drawLine,
  drawRect,
  drawText,
  drawBeaconSymbol,
  drawNorthArrow,
  drawScaleBar,
  drawCompanyLogo,
  drawMetarduWatermark,
  PAPER_SIZES,
  LINE_WEIGHTS,
  TEXT_SIZES,
  type PaperSizeName,
  type DocumentMetadata,
} from '../pdf-engine';
import type { DocumentTemplate, TemplateGenerateOptions } from './registry';
import type { ResolvedLogo } from '../resolve-logo';
import type { PlanId } from '@/lib/subscription/catalog';

// ─── Types ───────────────────────────────────────────────────────

export interface DeedPlanPoint {
  easting: number;
  northing: number;
  label: string;
  beaconType: 'control' | 'beacon' | 'benchmark';
  description?: string;
}

export interface DeedPlanBoundary {
  fromIndex: number;
  toIndex: number;
  type: 'scheme' | 'parcel' | 'road' | 'river' | 'dimension';
  bearing?: string;
  distance?: string;
}

export interface DeedPlanTemplateData {
  /** Points defining the parcel boundary */
  points: DeedPlanPoint[];
  /** Boundary lines connecting points */
  boundaries: DeedPlanBoundary[];
  /** Paper size (A1 or A2) */
  paperSize: PaperSizeName;
  /** Map scale (e.g., 1000 for 1:1000) */
  scale: number;
  /** Title block data */
  titleData: {
    lrNumber: string;
    area: string;
    scale: number;
    surveyorName: string;
    surveyorLicense: string;
    date: string;
    county: string;
    subCounty?: string;
    revision?: string;
    projection?: string;
    datum?: string;
    planNumber?: string;
    registry?: string;
    /** Registry Map Sheet reference number (required by Survey Act Cap 299) */
    registryMapSheet?: string;
    /** Deed Plan number (DP number) */
    deedPlanNumber?: string;
    /** Director of Surveys approval reference */
    directorOfSurveysRef?: string;
  };
  /** Document metadata */
  metadata: DocumentMetadata;
  /** Grid convergence at map center (decimal degrees) */
  convergence?: number;
  /** Grid interval in meters (default: auto) */
  gridInterval?: number;
  /** Margin around map area (mm) */
  mapMargin?: number;
}

// ─── Constants ───────────────────────────────────────────────────

const TITLE_BLOCK_RESERVE = 70; // mm reserved for title block at bottom (increased for DoS approval block)
const MARGIN = 15; // mm margin around the page

// ─── Core Generator ──────────────────────────────────────────────

async function generateDeedPlanPdf(
  data: DeedPlanTemplateData,
  options?: TemplateGenerateOptions
): Promise<Buffer> {
  const {
    points,
    boundaries,
    paperSize,
    scale,
    titleData,
    metadata,
    convergence,
    gridInterval,
    mapMargin = 10,
  } = data;

  const plan: PlanId = options?.plan ?? 'free';
  const companyLogo: ResolvedLogo | null = options?.companyLogo ?? null;

  const paper = PAPER_SIZES[paperSize];

  // Create PDF document (landscape orientation for deed plans)
  const doc = createSurveyDocument({
    paperSize,
    orientation: 'landscape',
    scale,
    metadata,
    companyLogo: companyLogo?.data ?? null,
    plan,
  });

  // Collect PDF data into a buffer
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const pdfPromise = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // ─── Page dimensions (landscape) ──────────────────────────────
  const pageW = paper.height; // Landscape: swap width/height
  const pageH = paper.width;

  // ─── Apply METARDU watermark for free plan ────────────────────
  if (plan === 'free') {
    drawMetarduWatermark(doc, pageW, pageH);
  }

  // ─── Compute map area ─────────────────────────────────────────
  const mapAreaX = MARGIN;
  const mapAreaY = MARGIN;
  const mapAreaW = pageW - 2 * MARGIN;
  const mapAreaH = pageH - 2 * MARGIN - TITLE_BLOCK_RESERVE;

  // ─── Compute coordinate extent of the survey ──────────────────
  const eastings = points.map((p) => p.easting);
  const northings = points.map((p) => p.northing);

  const minE = Math.min(...eastings);
  const maxE = Math.max(...eastings);
  const minN = Math.min(...northings);
  const maxN = Math.max(...northings);

  // Add 10% padding around the survey area
  const rangeE = maxE - minE || 100;
  const rangeN = maxN - minN || 100;
  const paddingE = rangeE * 0.1;
  const paddingN = rangeN * 0.1;

  const originE = minE - paddingE;
  const originN = minN - paddingN;
  const extentE = rangeE + 2 * paddingE;
  const extentN = rangeN + 2 * paddingN;

  // mm per meter on the plan
  const mmPerMeter = 1000 / scale;

  // ─── Draw map border ──────────────────────────────────────────
  drawRect(doc, mapAreaX, mapAreaY, mapAreaW, mapAreaH, LINE_WEIGHTS.titleBorder);

  // ─── Draw coordinate grid (UTM ticks) ─────────────────────────
  const gridInt = gridInterval ?? computeGridInterval(scale);
  drawGridTicks(doc, originE, originN, extentE, extentN,
    mapAreaX + mapMargin, mapAreaY + mapMargin,
    mapAreaW - 2 * mapMargin, mapAreaH - 2 * mapMargin,
    scale, gridInt);

  // ─── Coordinate transform: ground (meters) → paper (mm) ───────
  const groundToPaperX = (easting: number) => {
    return mapAreaX + mapMargin + (easting - originE) * mmPerMeter;
  };
  const groundToPaperY = (northing: number) => {
    return mapAreaY + mapMargin + (maxN + paddingN - northing) * mmPerMeter;
  };

  // ─── Draw boundary lines ──────────────────────────────────────
  for (const boundary of boundaries) {
    const fromPt = points[boundary.fromIndex];
    const toPt = points[boundary.toIndex];

    if (!fromPt || !toPt) continue;

    const x1 = groundToPaperX(fromPt.easting);
    const y1 = groundToPaperY(fromPt.northing);
    const x2 = groundToPaperX(toPt.easting);
    const y2 = groundToPaperY(toPt.northing);

    // Draw boundary line with appropriate weight
    const weight = boundary.type === 'scheme' ? LINE_WEIGHTS.schemeBoundary
      : boundary.type === 'road' ? LINE_WEIGHTS.roadLine
      : LINE_WEIGHTS.parcelBoundary;

    drawLine(doc, x1, y1, x2, y2, weight);

    // Bearing and distance labels
    if (boundary.bearing || boundary.distance) {
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      // Offset label perpendicular to the line
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = (-dy / length) * 3;
      const ny = (dx / length) * 3;

      if (boundary.bearing) {
        drawText(doc, boundary.bearing, midX + nx, midY + ny, TEXT_SIZES.bearing, { align: 'center' });
      }
      if (boundary.distance) {
        drawText(doc, boundary.distance, midX + nx, midY + ny + 2, TEXT_SIZES.dimension, { align: 'center' });
      }
    }
  }

  // ─── Draw beacon symbols ──────────────────────────────────────
  for (const point of points) {
    const px = groundToPaperX(point.easting);
    const py = groundToPaperY(point.northing);

    drawBeaconSymbol(doc, px, py, 3, 0.15);
    drawText(doc, point.label, px + 3, py - 1, TEXT_SIZES.coordinate);

    // Coordinate label
    const coordText = `E ${point.easting.toFixed(1)}  N ${point.northing.toFixed(1)}`;
    drawText(doc, coordText, px + 3, py + 1.5, TEXT_SIZES.small);
  }

  // ─── Draw beacon schedule table ───────────────────────────────
  const scheduleX = mapAreaX;
  const scheduleY = pageH - MARGIN - TITLE_BLOCK_RESERVE;
  drawBeaconSchedule(doc, points, scheduleX, scheduleY);

  // ─── Draw area computation table ──────────────────────────────
  const areaX = scheduleX + 205;
  drawAreaTable(doc, titleData.area, areaX, scheduleY, 120);

  // ─── Draw title block (SoK standard, bottom-right) ────────────
  drawDeedPlanTitleBlock(doc, pageW - MARGIN, pageH - MARGIN, titleData, companyLogo, plan);

  // ─── North arrow ──────────────────────────────────────────────
  drawNorthArrow(doc, MARGIN + 15, MARGIN + 25, 15, convergence);

  // ─── Scale bar ────────────────────────────────────────────────
  const groundDistance = scale <= 1000 ? 100 : 200;
  drawScaleBar(doc, MARGIN + 5, scheduleY - 10, scale, 80, groundDistance, 0.3);

  // ─── Finalize PDF ─────────────────────────────────────────────
  doc.end();

  return pdfPromise;
}

// ─── Helper: Draw grid ticks ─────────────────────────────────────

function drawGridTicks(
  doc: PDFKit.PDFDocument,
  originE: number, originN: number,
  extentE: number, extentN: number,
  paperX: number, paperY: number,
  paperW: number, paperH: number,
  scale: number, gridInterval: number
): void {
  const mmPerMeter = 1000 / scale;
  const tickLength = 2; // mm

  // Easting ticks (vertical lines at grid interval)
  const firstE = Math.ceil(originE / gridInterval) * gridInterval;
  for (let e = firstE; e <= originE + extentE; e += gridInterval) {
    const dx = (e - originE) * mmPerMeter;
    const px = paperX + dx;
    if (px < paperX || px > paperX + paperW) continue;

    // Top and bottom ticks
    drawLine(doc, px, paperY, px, paperY - tickLength, LINE_WEIGHTS.gridLine);
    drawLine(doc, px, paperY + paperH, px, paperY + paperH + tickLength, LINE_WEIGHTS.gridLine);

    // Coordinate label
    drawText(doc, Math.round(e).toString(), px, paperY + paperH + tickLength + 0.5, TEXT_SIZES.gridLabel, { align: 'center' });
  }

  // Northing ticks (horizontal lines at grid interval)
  const firstN = Math.ceil(originN / gridInterval) * gridInterval;
  for (let n = firstN; n <= originN + extentN; n += gridInterval) {
    const dy = (n - originN) * mmPerMeter;
    const py = paperY + paperH - dy;
    if (py < paperY || py > paperY + paperH) continue;

    // Left and right ticks
    drawLine(doc, paperX, py, paperX - tickLength, py, LINE_WEIGHTS.gridLine);
    drawLine(doc, paperX + paperW, py, paperX + paperW + tickLength, py, LINE_WEIGHTS.gridLine);

    // Coordinate label
    drawText(doc, Math.round(n).toString(), paperX - tickLength - 1, py - 0.75, TEXT_SIZES.gridLabel, { align: 'right' });
  }
}

// ─── Helper: Beacon Schedule Table ───────────────────────────────

function drawBeaconSchedule(
  doc: PDFKit.PDFDocument,
  points: DeedPlanPoint[],
  x: number, y: number
): void {
  const mmToPt = 2.8346;
  const rowHeight = 5;
  const headerHeight = 6;
  const colWidths = [30, 55, 55, 60];
  const headers = ['Beacon', 'Easting', 'Northing', 'Description'];

  // Header row
  let cx = x;
  for (let i = 0; i < headers.length; i++) {
    drawRect(doc, cx, y, colWidths[i], headerHeight, 0.2, 'black', '#E0E0E0');
    drawText(doc, headers[i], cx + 1, y + 1, TEXT_SIZES.small, { bold: true });
    cx += colWidths[i];
  }

  // Data rows (max 8 rows for space)
  const maxRows = Math.min(points.length, 8);
  for (let r = 0; r < maxRows; r++) {
    cx = x;
    const rowY = y + headerHeight + r * rowHeight;
    const pt = points[r];
    const values = [
      pt.label,
      pt.easting.toFixed(3),
      pt.northing.toFixed(3),
      pt.description ?? '',
    ];

    for (let i = 0; i < colWidths.length; i++) {
      drawRect(doc, cx, rowY, colWidths[i], rowHeight, 0.08);
      drawText(doc, values[i], cx + 1, rowY + 1, TEXT_SIZES.small);
      cx += colWidths[i];
    }
  }
}

// ─── Helper: Area Computation Table ──────────────────────────────

function drawAreaTable(
  doc: PDFKit.PDFDocument,
  area: string,
  x: number, y: number,
  width: number
): void {
  const rowHeight = 5;

  drawRect(doc, x, y, width, 6, 0.2, 'black', '#E0E0E0');
  drawText(doc, 'AREA COMPUTATION', x + 2, y + 1, TEXT_SIZES.small, { bold: true });

  drawRect(doc, x, y + 6, width, rowHeight, 0.08);
  drawText(doc, 'Area:', x + 2, y + 7, TEXT_SIZES.small, { bold: true });
  drawText(doc, `${area} Ha`, x + 30, y + 7, TEXT_SIZES.coordinate);

  // Note about computation method
  drawRect(doc, x, y + 6 + rowHeight, width, rowHeight, 0.08);
  drawText(doc, 'Method:', x + 2, y + 7 + rowHeight, TEXT_SIZES.small, { bold: true });
  drawText(doc, 'Coordinates', x + 30, y + 7 + rowHeight, TEXT_SIZES.small);

  // Survey Act reference
  drawRect(doc, x, y + 6 + rowHeight * 2, width, rowHeight, 0.08);
  drawText(doc, 'Ref:', x + 2, y + 7 + rowHeight * 2, TEXT_SIZES.small, { bold: true });
  drawText(doc, 'Survey Act Cap 299', x + 30, y + 7 + rowHeight * 2, TEXT_SIZES.small);
}

// ─── Helper: Deed Plan Title Block (SoK Standard) ───────────────

function drawDeedPlanTitleBlock(
  doc: PDFKit.PDFDocument,
  x: number, y: number,
  data: DeedPlanTemplateData['titleData'],
  companyLogo: ResolvedLogo | null,
  plan: PlanId
): void {
  const tbWidth = 180;
  const tbHeight = 65; // Increased to accommodate Republic of Kenya header and DoS block
  const innerMargin = 3;
  const rowHeight = 5;

  // Title block origin (top-left corner)
  const bx = x - tbWidth;
  const by = y - tbHeight;

  // Outer border
  drawRect(doc, bx, by, tbWidth, tbHeight, LINE_WEIGHTS.titleBorder);

  // ─── Logo area (top-left of title block) ──────────────────────
  if (companyLogo?.data) {
    // Render company logo in title block (max 40x15mm)
    drawCompanyLogo(doc, companyLogo.data, bx + innerMargin, by + innerMargin, 40, 10);
  } else if (plan === 'free') {
    // METARDU text for free tier
    drawText(doc, 'METARDU', bx + innerMargin, by + innerMargin, 4, {
      bold: true,
      color: '#999999',
    });
  }
  // If paid plan but no logo: leave blank

  // ─── Republic of Kenya Header (required by Survey Act Cap 299) ──
  const headerY = by + innerMargin;
  drawText(doc, 'REPUBLIC OF KENYA', bx + 50, headerY, TEXT_SIZES.small, {
    bold: true,
    align: 'center',
  });

  // Deed Plan title
  drawText(doc, 'DEED PLAN', bx + 50, headerY + 3.5, TEXT_SIZES.titleBlock, {
    bold: true,
    align: 'center',
  });

  // DP number (Deed Plan number)
  if (data.deedPlanNumber) {
    drawText(doc, `DP No. ${data.deedPlanNumber}`, bx + 120, headerY, TEXT_SIZES.small, { bold: true });
  }
  // Fallback: planNumber
  if (!data.deedPlanNumber && data.planNumber) {
    drawText(doc, `Plan No. ${data.planNumber}`, bx + 120, headerY, TEXT_SIZES.small);
  }

  // Separator line below header
  drawLine(doc, bx, by + rowHeight * 3 + 3, bx + tbWidth, by + rowHeight * 3 + 3, 0.3);

  // ─── Data rows (two columns) ─────────────────────────────────
  let currentY = by + rowHeight * 3 + 3 + innerMargin;
  const col1X = bx + innerMargin;
  const col2X = bx + tbWidth / 2 + innerMargin;
  const labelWidth = 32;

  // Left column
  drawLabelValue(doc, col1X, currentY, 'LR No.:', data.lrNumber, labelWidth);
  drawLabelValue(doc, col1X, currentY + rowHeight, 'Area:', data.area, labelWidth);
  drawLabelValue(doc, col1X, currentY + rowHeight * 2, 'Scale:', `1:${data.scale}`, labelWidth);
  drawLabelValue(doc, col1X, currentY + rowHeight * 3, 'County:', data.county, labelWidth);
  if (data.registryMapSheet) {
    drawLabelValue(doc, col1X, currentY + rowHeight * 4, 'Reg. Map:', data.registryMapSheet, labelWidth);
  }

  // Right column
  drawLabelValue(doc, col2X, currentY, 'Surveyor:', data.surveyorName, labelWidth);
  drawLabelValue(doc, col2X, currentY + rowHeight, 'License:', data.surveyorLicense, labelWidth);
  drawLabelValue(doc, col2X, currentY + rowHeight * 2, 'Date:', data.date, labelWidth);
  drawLabelValue(doc, col2X, currentY + rowHeight * 3, 'Datum:', data.datum ?? 'Arc 1960', labelWidth);
  if (data.registry) {
    drawLabelValue(doc, col2X, currentY + rowHeight * 4, 'Registry:', data.registry, labelWidth);
  }

  // Column separator
  drawLine(doc, bx + tbWidth / 2, by + rowHeight * 3 + 3, bx + tbWidth / 2, by + tbHeight, 0.15);

  // ─── Revision ────────────────────────────────────────────────
  if (data.revision) {
    drawText(doc, `Rev: ${data.revision}`, bx + tbWidth - 30, by + tbHeight - 5, TEXT_SIZES.small);
  }

  // ─── Director of Surveys Approval Block (required by Survey Act Cap 299) ─
  const dosY = by + tbHeight - 8;
  drawLine(doc, bx, dosY, bx + tbWidth, dosY, 0.15);
  drawText(doc, 'DIRECTOR OF SURVEYS', bx + innerMargin, dosY + 1, TEXT_SIZES.small, { bold: true });
  if (data.directorOfSurveysRef) {
    drawText(doc, `Ref: ${data.directorOfSurveysRef}`, bx + innerMargin + 45, dosY + 1, TEXT_SIZES.small);
  }
  drawLine(doc, bx + 80, dosY + 5, bx + tbWidth - 3, dosY + 5, 0.15);
  drawText(doc, 'Approved / Date', bx + 80, dosY + 6, TEXT_SIZES.small);

  // ─── Surveyor signature block ────────────────────────────────
  const sigY = by + tbHeight + 3;
  drawLine(doc, bx + 80, sigY, bx + tbWidth, sigY, 0.2);
  drawText(doc, `Signed: ${data.surveyorName}`, bx + 80, sigY + 1, TEXT_SIZES.small);
  drawText(doc, `(${data.surveyorLicense})`, bx + 80, sigY + 3, TEXT_SIZES.small);
}

/** Draw a label-value pair */
function drawLabelValue(
  doc: PDFKit.PDFDocument,
  x: number, y: number,
  label: string, value: string,
  labelWidth: number
): void {
  drawText(doc, label, x, y, TEXT_SIZES.small, { bold: true });
  drawText(doc, value, x + labelWidth, y, TEXT_SIZES.coordinate);
}

/** Compute grid interval from scale */
function computeGridInterval(scale: number): number {
  if (scale <= 500) return 50;
  if (scale <= 2000) return 100;
  if (scale <= 5000) return 200;
  if (scale <= 10000) return 500;
  return 1000;
}

// ─── Template Registration ───────────────────────────────────────

export const DEED_PLAN_TEMPLATE: DocumentTemplate<DeedPlanTemplateData> = {
  id: 'deed-plan',
  name: 'Kenya Deed Plan',
  description: 'A1 landscape deed plan with grid, north arrow, beacon schedule, area table, and SoK standard title block',
  documentType: 'deed-plan',
  paperSize: 'A1',
  orientation: 'landscape',
  generate: generateDeedPlanPdf,
};
