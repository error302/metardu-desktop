/**
 * Topographic Plan Template
 *
 * A1 landscape topographic plan with feature code legend,
 * contour interval legend, scale bar, north arrow, and title block.
 *
 * Layout:
 * - A1 landscape (841 × 594mm)
 * - Feature code legend (auto-populated from data)
 * - Contour interval legend
 * - Scale bar
 * - North arrow
 * - Title block (bottom-right)
 *
 * Watermark:
 * - Free plan: METARDU watermark diagonally across the plan
 * - Paid plan + company logo: Logo in title block
 * - Paid plan + no logo: Blank
 */

import {
  createSurveyDocument,
  drawLine,
  drawRect,
  drawText,
  drawCircle,
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

export interface TopoFeature {
  /** Feature code (e.g., 'BLDG', 'ROAD', 'TREE', 'FENCE') */
  code: string;
  /** Human-readable feature name */
  name: string;
  /** Symbol description for legend */
  symbolDescription: string;
  /** Color for rendering */
  color?: string;
}

export interface TopoContourInfo {
  /** Contour interval in meters */
  interval: number;
  /** Minimum elevation */
  minElevation: number;
  /** Maximum elevation */
  maxElevation: number;
  /** Index contour multiplier (every Nth contour is an index contour) */
  indexMultiplier?: number;
}

export interface TopoPlanPoint {
  easting: number;
  northing: number;
  elevation?: number;
  featureCode?: string;
  label?: string;
}

export interface TopoPlanData {
  /** Paper size (A1 or A2) */
  paperSize: PaperSizeName;
  /** Map scale (e.g., 1000 for 1:1000) */
  scale: number;
  /** Project name */
  projectName: string;
  /** Surveyor info */
  surveyorName: string;
  surveyorLicense: string;
  /** Date of survey */
  date: string;
  /** County */
  county?: string;
  /** LR Number */
  lrNumber?: string;
  /** Coordinate system / projection */
  projection?: string;
  /** Datum */
  datum?: string;
  /** Grid convergence */
  convergence?: number;
  /** Survey points with feature codes */
  points: TopoPlanPoint[];
  /** Feature codes present in the data */
  features: TopoFeature[];
  /** Contour information */
  contourInfo: TopoContourInfo;
  /** Document metadata */
  metadata: DocumentMetadata;
}

// ─── Constants ───────────────────────────────────────────────────

const MARGIN = 15;
const TITLE_BLOCK_WIDTH = 160;
const TITLE_BLOCK_HEIGHT = 50;
const LEGEND_WIDTH = 60;
const LEGEND_MARGIN = 5;

// ─── Standard Feature Code Colors ────────────────────────────────

const FEATURE_COLORS: Record<string, string> = {
  BLDG: '#333333',
  ROAD: '#000000',
  PATH: '#666666',
  FENCE: '#8B4513',
  WALL: '#555555',
  TREE: '#228B22',
  BUSH: '#2E8B57',
  WATER: '#0066CC',
  RIVER: '#0066CC',
  DRAIN: '#0099CC',
  POWER: '#CC0000',
  TELE: '#FF6600',
  BMRK: '#000000',
  CTRL: '#000000',
};

// ─── Core Generator ──────────────────────────────────────────────

async function generateTopoPlanPdf(
  data: TopoPlanData,
  options?: TemplateGenerateOptions
): Promise<Buffer> {
  const plan: PlanId = options?.plan ?? 'free';
  const companyLogo: ResolvedLogo | null = options?.companyLogo ?? null;

  const paper = PAPER_SIZES[data.paperSize];
  const pageW = paper.height; // Landscape: swap
  const pageH = paper.width;

  const doc = createSurveyDocument({
    paperSize: data.paperSize,
    orientation: 'landscape',
    scale: data.scale,
    metadata: data.metadata,
    companyLogo: companyLogo?.data ?? null,
    plan,
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const pdfPromise = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // ─── Apply METARDU watermark for free plan ──────────────────
  if (plan === 'free') {
    drawMetarduWatermark(doc, pageW, pageH);
  }

  // ─── Map area ───────────────────────────────────────────────
  const mapAreaX = MARGIN;
  const mapAreaY = MARGIN;
  const mapAreaW = pageW - 2 * MARGIN - LEGEND_WIDTH - 5;
  const mapAreaH = pageH - 2 * MARGIN - TITLE_BLOCK_HEIGHT - 10;

  // Map border
  drawRect(doc, mapAreaX, mapAreaY, mapAreaW, mapAreaH, LINE_WEIGHTS.titleBorder);

  // ─── Draw feature code legend (right side) ──────────────────
  const legendX = mapAreaX + mapAreaW + LEGEND_MARGIN;
  const legendY = MARGIN;
  drawFeatureCodeLegend(doc, data.features, legendX, legendY, LEGEND_WIDTH);

  // ─── Draw contour interval legend ───────────────────────────
  const contourLegendY = legendY + data.features.length * 6 + 15;
  drawContourLegend(doc, data.contourInfo, legendX, contourLegendY, LEGEND_WIDTH);

  // ─── Draw survey points with feature symbols ────────────────
  if (data.points.length > 0) {
    const eastings = data.points.map((p) => p.easting);
    const northings = data.points.map((p) => p.northing);

    const minE = Math.min(...eastings);
    const maxE = Math.max(...eastings);
    const minN = Math.min(...northings);
    const maxN = Math.max(...northings);

    const rangeE = maxE - minE || 100;
    const rangeN = maxN - minN || 100;
    const paddingE = rangeE * 0.1;
    const paddingN = rangeN * 0.1;
    const mmPerMeter = 1000 / data.scale;

    const mapMargin = 10;

    const groundToPaperX = (easting: number) => {
      return mapAreaX + mapMargin + (easting - (minE - paddingE)) * mmPerMeter;
    };
    const groundToPaperY = (northing: number) => {
      return mapAreaY + mapMargin + (maxN + paddingN - northing) * mmPerMeter;
    };

    for (const point of data.points) {
      const px = groundToPaperX(point.easting);
      const py = groundToPaperY(point.northing);

      // Check if point is within map area
      if (px < mapAreaX || px > mapAreaX + mapAreaW || py < mapAreaY || py > mapAreaY + mapAreaH) {
        continue;
      }

      const featureColor = point.featureCode
        ? (FEATURE_COLORS[point.featureCode] ?? '#000000')
        : '#000000';

      // Draw point symbol
      drawCircle(doc, px, py, 0.5, 0.15, featureColor);

      // Label
      if (point.label) {
        drawText(doc, point.label, px + 2, py - 1, TEXT_SIZES.small, { color: featureColor });
      }

      // Elevation
      if (point.elevation !== undefined) {
        drawText(doc, point.elevation.toFixed(1), px + 2, py + 1, TEXT_SIZES.small, {
          color: featureColor,
        });
      }
    }

    // ─── Draw coordinate grid ticks ──────────────────────────
    const gridInterval = computeGridInterval(data.scale);
    const originE = minE - paddingE;
    const originN = minN - paddingN;
    const extentE = rangeE + 2 * paddingE;
    const extentN = rangeN + 2 * paddingN;

    drawGridTicks(doc, originE, originN, extentE, extentN,
      mapAreaX + mapMargin, mapAreaY + mapMargin,
      mapAreaW - 2 * mapMargin, mapAreaH - 2 * mapMargin,
      data.scale, gridInterval);
  }

  // ─── Draw title block ───────────────────────────────────────
  const tbX = pageW - MARGIN - TITLE_BLOCK_WIDTH;
  const tbY = pageH - MARGIN - TITLE_BLOCK_HEIGHT;
  drawTopoTitleBlock(doc, tbX, tbY, data, companyLogo, plan);

  // ─── North arrow ────────────────────────────────────────────
  drawNorthArrow(doc, MARGIN + 15, MARGIN + 25, 15, data.convergence);

  // ─── Scale bar ──────────────────────────────────────────────
  const groundDistance = data.scale <= 1000 ? 100 : 200;
  drawScaleBar(doc, MARGIN + 5, pageH - MARGIN - TITLE_BLOCK_HEIGHT - 10, data.scale, 80, groundDistance, 0.3);

  // ─── Finalize PDF ───────────────────────────────────────────
  doc.end();
  return pdfPromise;
}

// ─── Helper: Feature Code Legend ─────────────────────────────────

function drawFeatureCodeLegend(
  doc: PDFKit.PDFDocument,
  features: TopoFeature[],
  x: number, y: number,
  width: number
): void {
  const rowHeight = 6;
  const headerHeight = 8;

  // Legend border
  drawRect(doc, x, y, width, headerHeight + features.length * rowHeight + 5, LINE_WEIGHTS.titleBorder);

  // Header
  drawRect(doc, x, y, width, headerHeight, 0.2, 'black', '#E0E0E0');
  drawText(doc, 'FEATURE CODES', x + 2, y + 2, TEXT_SIZES.small, { bold: true });

  // Feature rows
  let rowY = y + headerHeight;
  for (const feature of features) {
    const color = FEATURE_COLORS[feature.code] ?? '#000000';

    // Symbol indicator
    drawCircle(doc, x + 5, rowY + 2.5, 1.5, 0.15, color);

    // Feature code and name
    drawText(doc, feature.code, x + 10, rowY + 1, TEXT_SIZES.small, { bold: true, color });
    drawText(doc, feature.name, x + 25, rowY + 1, TEXT_SIZES.small);

    rowY += rowHeight;
  }
}

// ─── Helper: Contour Interval Legend ─────────────────────────────

function drawContourLegend(
  doc: PDFKit.PDFDocument,
  contourInfo: TopoContourInfo,
  x: number, y: number,
  width: number
): void {
  const height = 40;
  const indexMultiplier = contourInfo.indexMultiplier ?? 5;

  // Border
  drawRect(doc, x, y, width, height, LINE_WEIGHTS.titleBorder);

  // Header
  drawRect(doc, x, y, width, 8, 0.2, 'black', '#E0E0E0');
  drawText(doc, 'CONTOURS', x + 2, y + 2, TEXT_SIZES.small, { bold: true });

  // Contour interval
  drawText(doc, `Interval: ${contourInfo.interval}m`, x + 2, y + 10, TEXT_SIZES.small);

  // Index contour
  drawText(doc, `Index: every ${indexMultiplier}th`, x + 2, y + 14, TEXT_SIZES.small);

  // Sample lines
  const lineY = y + 20;
  // Intermediate contour
  drawLine(doc, x + 5, lineY, x + width - 5, lineY, LINE_WEIGHTS.contourIntermediate);
  drawText(doc, `${contourInfo.interval}m`, x + width - 18, lineY - 1, TEXT_SIZES.small);

  // Index contour
  drawLine(doc, x + 5, lineY + 6, x + width - 5, lineY + 6, LINE_WEIGHTS.contourIndex);
  drawText(doc, `${contourInfo.interval * indexMultiplier}m`, x + width - 18, lineY + 5, TEXT_SIZES.small);

  // Elevation range
  drawText(doc, `Range: ${contourInfo.minElevation.toFixed(0)}–${contourInfo.maxElevation.toFixed(0)}m`, x + 2, y + 32, TEXT_SIZES.small);
}

// ─── Helper: Title Block ─────────────────────────────────────────

function drawTopoTitleBlock(
  doc: PDFKit.PDFDocument,
  x: number, y: number,
  data: TopoPlanData,
  companyLogo: ResolvedLogo | null,
  plan: PlanId
): void {
  const innerMargin = 3;
  const rowHeight = 5;

  // Outer border
  drawRect(doc, x, y, TITLE_BLOCK_WIDTH, TITLE_BLOCK_HEIGHT, LINE_WEIGHTS.titleBorder);

  // ─── Logo / METARDU ─────────────────────────────────────────
  if (companyLogo?.data) {
    drawCompanyLogo(doc, companyLogo.data, x + innerMargin, y + innerMargin, 35, 12);
  } else if (plan === 'free') {
    drawText(doc, 'METARDU', x + innerMargin, y + innerMargin, 4, {
      bold: true,
      color: '#999999',
    });
  }

  // Header
  drawText(doc, 'TOPOGRAPHIC PLAN', x + 45, y + innerMargin, TEXT_SIZES.titleBlock, {
    bold: true,
    align: 'center',
  });

  // Separator
  drawLine(doc, x, y + rowHeight * 3, x + TITLE_BLOCK_WIDTH, y + rowHeight * 3, 0.3);

  // Data rows
  let currentY = y + rowHeight * 3 + innerMargin;
  const col1X = x + innerMargin;
  const col2X = x + TITLE_BLOCK_WIDTH / 2 + innerMargin;
  const labelWidth = 30;

  // Left column
  drawLabelValue(doc, col1X, currentY, 'Project:', data.projectName, labelWidth);
  drawLabelValue(doc, col1X, currentY + rowHeight, 'Scale:', `1:${data.scale}`, labelWidth);
  drawLabelValue(doc, col1X, currentY + rowHeight * 2, 'County:', data.county ?? '', labelWidth);
  drawLabelValue(doc, col1X, currentY + rowHeight * 3, 'Datum:', data.datum ?? 'Arc 1960', labelWidth);

  // Right column
  drawLabelValue(doc, col2X, currentY, 'Surveyor:', data.surveyorName, labelWidth);
  drawLabelValue(doc, col2X, currentY + rowHeight, 'License:', data.surveyorLicense, labelWidth);
  drawLabelValue(doc, col2X, currentY + rowHeight * 2, 'Date:', data.date, labelWidth);
  drawLabelValue(doc, col2X, currentY + rowHeight * 3, 'Proj:', data.projection ?? 'UTM', labelWidth);

  // Column separator
  drawLine(doc, x + TITLE_BLOCK_WIDTH / 2, y + rowHeight * 3, x + TITLE_BLOCK_WIDTH / 2, y + TITLE_BLOCK_HEIGHT, 0.15);
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

/** Draw coordinate grid ticks */
function drawGridTicks(
  doc: PDFKit.PDFDocument,
  originE: number, originN: number,
  extentE: number, extentN: number,
  paperX: number, paperY: number,
  paperW: number, paperH: number,
  scale: number, gridInterval: number
): void {
  const mmPerMeter = 1000 / scale;
  const tickLength = 2;

  const firstE = Math.ceil(originE / gridInterval) * gridInterval;
  for (let e = firstE; e <= originE + extentE; e += gridInterval) {
    const dx = (e - originE) * mmPerMeter;
    const px = paperX + dx;
    if (px < paperX || px > paperX + paperW) continue;

    drawLine(doc, px, paperY, px, paperY - tickLength, LINE_WEIGHTS.gridLine);
    drawLine(doc, px, paperY + paperH, px, paperY + paperH + tickLength, LINE_WEIGHTS.gridLine);
    drawText(doc, Math.round(e).toString(), px, paperY + paperH + tickLength + 0.5, TEXT_SIZES.gridLabel, { align: 'center' });
  }

  const firstN = Math.ceil(originN / gridInterval) * gridInterval;
  for (let n = firstN; n <= originN + extentN; n += gridInterval) {
    const dy = (n - originN) * mmPerMeter;
    const py = paperY + paperH - dy;
    if (py < paperY || py > paperY + paperH) continue;

    drawLine(doc, paperX, py, paperX - tickLength, py, LINE_WEIGHTS.gridLine);
    drawLine(doc, paperX + paperW, py, paperX + paperW + tickLength, py, LINE_WEIGHTS.gridLine);
    drawText(doc, Math.round(n).toString(), paperX - tickLength - 1, py - 0.75, TEXT_SIZES.gridLabel, { align: 'right' });
  }
}

// ─── Template Registration ───────────────────────────────────────

export const TOPO_PLAN_TEMPLATE: DocumentTemplate<TopoPlanData> = {
  id: 'topo-plan',
  name: 'Topographic Plan',
  description: 'A1 landscape topographic plan with feature code legend, contour interval legend, scale bar, and north arrow',
  documentType: 'topo-plan',
  paperSize: 'A1',
  orientation: 'landscape',
  generate: generateTopoPlanPdf,
};
