/**
 * Title Block Generator
 *
 * Generates the standard Kenya survey plan title block.
 * Positioned at the bottom-right of the plan.
 *
 * Standard title block contains:
 * - LR Number (Land Registration)
 * - Area (hectares/acres)
 * - Scale (representative fraction + graphical bar)
 * - Surveyor name and license number
 * - Date of survey
 * - County and sub-county
 * - Revision number
 * - Coordinate reference block (datum, projection, scale factor, mean elevation)
 * - North arrow
 *
 * New in SRVY2025-1:
 * - Submission number (RS###_YYYY_###_R##)
 * - Sheet numbering (N of total)
 * - Scale factor for grid-to-ground correction
 * - Mean elevation
 * - Registry Map Sheet reference
 * - Control survey accuracy class
 */

import type PDFKit from 'pdfkit';
import { drawLine, drawRect, drawText, LINE_WEIGHTS, TEXT_SIZES } from '../pdf-engine';
import { drawNorthArrow, drawScaleBar } from '../pdf-engine';

export interface TitleBlockData {
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
  submissionNo?: string;
  sheetNo?: number;
  totalSheets?: number;
  scaleFactor?: number;
  meanElevation?: number;
  gridArea?: string;
  registryMapSheet?: string;
  controlClass?: string;
}

const TITLE_BLOCK_WIDTH = 160;
const TITLE_BLOCK_HEIGHT = 55;
const MARGIN = 3;
const ROW_HEIGHT = 5;

export function drawTitleBlock(
  doc: PDFKit.PDFDocument,
  x: number, y: number,
  data: TitleBlockData
): void {
  const bx = x - TITLE_BLOCK_WIDTH;
  const by = y - TITLE_BLOCK_HEIGHT;

  drawRect(doc, bx, by, TITLE_BLOCK_WIDTH, TITLE_BLOCK_HEIGHT, LINE_WEIGHTS.titleBorder);

  const headerY = by + MARGIN;
  const titleParts: string[] = ['DEED PLAN'];
  if (data.submissionNo) titleParts.push(`Ref: ${data.submissionNo}`);
  if (data.sheetNo && data.totalSheets) titleParts.push(`Sheet ${data.sheetNo}/${data.totalSheets}`);
  drawText(doc, titleParts.join('  |  '), bx + MARGIN, headerY, TEXT_SIZES.titleBlock, {
    bold: true,
    align: 'center',
  });

  drawLine(doc, bx, by + ROW_HEIGHT * 2, bx + TITLE_BLOCK_WIDTH, by + ROW_HEIGHT * 2, 0.3);

  let currentY = by + ROW_HEIGHT * 2 + MARGIN;
  const col1X = bx + MARGIN;
  const col2X = bx + 55;
  const col3X = bx + 105;
  const labelWidth = 30;

  drawLabelValue(doc, col1X, currentY, 'LR No.:', data.lrNumber, labelWidth);
  drawLabelValue(doc, col1X, currentY + ROW_HEIGHT, 'Area:', data.area, labelWidth);
  drawLabelValue(doc, col1X, currentY + ROW_HEIGHT * 2, 'Scale:', `1:${data.scale}`, labelWidth);
  drawLabelValue(doc, col1X, currentY + ROW_HEIGHT * 3, 'County:', data.county, labelWidth);
  if (data.registryMapSheet) {
    drawLabelValue(doc, col1X, currentY + ROW_HEIGHT * 4, 'Map Sheet:', data.registryMapSheet, labelWidth);
  }

  drawLabelValue(doc, col2X, currentY, 'Surveyor:', data.surveyorName, labelWidth);
  drawLabelValue(doc, col2X, currentY + ROW_HEIGHT, 'License:', data.surveyorLicense, labelWidth);
  drawLabelValue(doc, col2X, currentY + ROW_HEIGHT * 2, 'Date:', data.date, labelWidth);
  drawLabelValue(doc, col2X, currentY + ROW_HEIGHT * 3, 'Datum:', data.datum ?? 'Arc 1960', labelWidth);
  if (data.controlClass) {
    drawLabelValue(doc, col2X, currentY + ROW_HEIGHT * 4, 'Class:', data.controlClass, labelWidth);
  }

  const utmLabel = data.projection?.includes('37') ? 'UTM Z37S' : 'UTM Z36S';
  drawLabelValue(doc, col3X, currentY, 'Datum:', data.datum ?? 'Arc 1960', labelWidth);
  drawLabelValue(doc, col3X, currentY + ROW_HEIGHT, 'Proj.:', utmLabel, labelWidth);
  if (data.scaleFactor !== undefined) {
    drawLabelValue(doc, col3X, currentY + ROW_HEIGHT * 2, 'SF:', data.scaleFactor.toFixed(6), labelWidth);
  }
  if (data.meanElevation !== undefined) {
    drawLabelValue(doc, col3X, currentY + ROW_HEIGHT * 3, 'Elev.:', `${data.meanElevation.toFixed(1)}m`, labelWidth);
  }
  if (data.revision) {
    drawLabelValue(doc, col3X, currentY + ROW_HEIGHT * 4, 'Rev.:', data.revision, labelWidth);
  }

  drawLine(doc, bx + 52, by + ROW_HEIGHT * 2, bx + 52, by + TITLE_BLOCK_HEIGHT - MARGIN, 0.15);
  drawLine(doc, bx + 102, by + ROW_HEIGHT * 2, bx + 102, by + TITLE_BLOCK_HEIGHT - MARGIN, 0.15);
  drawLine(doc, bx + 102, by + ROW_HEIGHT * 6, bx + TITLE_BLOCK_WIDTH, by + ROW_HEIGHT * 6, 0.15);

  if (data.gridArea) {
    currentY = by + ROW_HEIGHT * 6 + MARGIN;
    drawLabelValue(doc, bx + 105, currentY, 'Grid Area:', data.gridArea, labelWidth);
  }

  drawNorthArrow(doc, bx - 18, by + 18, 12, undefined);
  const scaleBarY = by + TITLE_BLOCK_HEIGHT + 5;
  const groundDistance = data.scale <= 1000 ? 100 : 200;
  drawScaleBar(doc, bx, scaleBarY, data.scale, TITLE_BLOCK_WIDTH, groundDistance, 0.3);
}

function drawLabelValue(
  doc: PDFKit.PDFDocument,
  x: number, y: number,
  label: string, value: string,
  labelWidth: number
): void {
  drawText(doc, label, x, y, TEXT_SIZES.small, { bold: true });
  drawText(doc, value, x + labelWidth, y, TEXT_SIZES.coordinate);
}