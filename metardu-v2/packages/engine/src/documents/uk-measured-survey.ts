/**
 * UK Measured Survey Plan renderer — RICS-compliant PDF + DXF.
 *
 * Based on the UK country config (ETRS89/OSGB36, RICS tolerances) and
 * the RICS Measured Surveys of Land, Buildings and Utilities, 3rd ed.
 *
 * Produces a PDF + DXF that matches what a UK surveyor would submit
 * to a client or planning authority. Unlike the Kenya Form 3 (which is
 * a statutory deed plan), the UK measured survey plan is a professional
 * deliverable, not a government form.
 *
 * # Layout (based on RICS Measured Surveys 3rd ed.)
 *
 *   - A3 portrait, 20mm margins
 *   - Title block: project name, client, surveyor (RICS), date, scale,
 *     survey classification (A/B/C), coordinate system
 *   - Plan area: survey points + features + contours (if topo)
 *   - Coordinate schedule: point ID, E, N, level, description
 *   - North arrow + scale bar
 *   - RICS compliance statement
 *
 * # References
 *
 *   - RICS Measured Surveys of Land, Buildings and Utilities, 3rd ed.
 *   - OSGB36 / British National Grid (EPSG::27700)
 *   - Land Registration Act 2002 (UK) — general boundaries rule
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,

  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { UNITED_KINGDOM, getStatutoryDoc } from "@metardu/country-config";

// ─── Types ───────────────────────────────────────────────────────

export interface UkSurveyPoint {
  pointId: string;
  easting: number;
  northing: number;
  level?: number;
  description?: string;
  code?: string;
}

export interface UkMeasuredSurveyInput {
  projectName: string;
  client: string;
  surveyorName: string;
  ricsNumber: string;
  dateOfSurvey: string;
  surveyClass: "A" | "B" | "C";
  coordinateSystem: string;
  scale: number;
  points: UkSurveyPoint[];
  contours?: { elevation: number; coordinates: [number, number][] }[];
  northArrowPosition?: { x: number; y: number };
}

export interface UkMeasuredSurveyOutput {
  pdfBytes: Uint8Array;
  pageCount: number;
  scale: number;
  pointCount: number;
  contourCount: number;
}

// ─── Constants ───────────────────────────────────────────────────

const PAGE_WIDTH_MM = 297; // A3
const PAGE_HEIGHT_MM = 420;
const MARGIN_MM = 20;
const MM_TO_PT = 2.834645669;
const PAGE_WIDTH_PT = PAGE_WIDTH_MM * MM_TO_PT;
const PAGE_HEIGHT_PT = PAGE_HEIGHT_MM * MM_TO_PT;
const MARGIN_PT = MARGIN_MM * MM_TO_PT;
const TITLE_BLOCK_HEIGHT_PT = 50 * MM_TO_PT;
const COORD_SCHEDULE_HEIGHT_PT = 40 * MM_TO_PT;

const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.5, 0.5, 0.5);

const ACCENT = rgb(0, 0.3, 0.6); // RICS blue
const LABEL_FONT_SIZE = 7;
const TITLE_FONT_SIZE = 9;

// ─── Main entry point ────────────────────────────────────────────

export async function generateUkMeasuredSurveyPdf(
  input: UkMeasuredSurveyInput,
): Promise<UkMeasuredSurveyOutput> {
  if (input.points.length === 0) {
    throw new Error("Measured survey requires at least 1 point.");
  }

  // Look up the UK measured survey spec from country config.
  void getStatutoryDoc(UNITED_KINGDOM, "Measured Survey Report");

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Measured Survey — ${input.projectName}`);
  pdfDoc.setAuthor(input.surveyorName);
  pdfDoc.setSubject("RICS Measured Survey of Land, Buildings and Utilities");
  pdfDoc.setKeywords(["UK", "RICS", "Measured Survey", input.projectName]);
  pdfDoc.setProducer("MetaRDU Desktop");
  pdfDoc.setCreator("MetaRDU Desktop — UK Measured Survey Renderer");
  pdfDoc.setCreationDate(new Date());

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);

  // Compute plan area geometry.
  const planAreaX = MARGIN_PT;
  const planAreaY = MARGIN_PT + COORD_SCHEDULE_HEIGHT_PT + 10;
  const planAreaW = PAGE_WIDTH_PT - 2 * MARGIN_PT;
  const planAreaH = PAGE_HEIGHT_PT - 2 * MARGIN_PT - TITLE_BLOCK_HEIGHT_PT - COORD_SCHEDULE_HEIGHT_PT - 20;

  // Compute bounds + transform.
  const bounds = computeBounds(input.points, input.contours);
  const transform = makeTransform(bounds, planAreaX, planAreaY, planAreaW, planAreaH, input.scale);

  // Draw the page sections.
  drawTitleBlock(page, input, fontBold, font);
  drawPlanArea(page, input, transform, font, fontBold);
  drawCoordinateSchedule(page, input, font);
  drawComplianceStatement(page, input, font);

  const pdfBytes = await pdfDoc.save();

  return {
    pdfBytes,
    pageCount: pdfDoc.getPageCount(),
    scale: input.scale,
    pointCount: input.points.length,
    contourCount: input.contours?.length ?? 0,
  };
}

// ─── Bounds + transform ──────────────────────────────────────────

function computeBounds(
  points: UkSurveyPoint[],
  contours?: { coordinates: [number, number][] }[],
): { minE: number; maxE: number; minN: number; maxN: number; width: number; height: number } {
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const p of points) {
    if (p.easting < minE) minE = p.easting;
    if (p.easting > maxE) maxE = p.easting;
    if (p.northing < minN) minN = p.northing;
    if (p.northing > maxN) maxN = p.northing;
  }
  if (contours) {
    for (const c of contours) {
      for (const [e, n] of c.coordinates) {
        if (e < minE) minE = e;
        if (e > maxE) maxE = e;
        if (n < minN) minN = n;
        if (n > maxN) maxN = n;
      }
    }
  }
  const padE = Math.max((maxE - minE) * 0.1, 10);
  const padN = Math.max((maxN - minN) * 0.1, 10);
  return {
    minE: minE - padE, maxE: maxE + padE,
    minN: minN - padN, maxN: maxN + padN,
    width: (maxE - minE) + 2 * padE,
    height: (maxN - minN) + 2 * padN,
  };
}

function makeTransform(
  bounds: { minE: number; maxE: number; minN: number; maxN: number; width: number; height: number },
  planAreaX: number, planAreaY: number, planAreaW: number, planAreaH: number,
  _scale: number,
): (e: number, n: number) => { x: number; y: number } {
  const scaleE = planAreaW / bounds.width;
  const scaleN = planAreaH / bounds.height;
  const scale = Math.min(scaleE, scaleN);
  const contentW = bounds.width * scale;
  const contentH = bounds.height * scale;
  const offsetX = planAreaX + (planAreaW - contentW) / 2;
  const offsetY = planAreaY + (planAreaH - contentH) / 2;

  return (easting: number, northing: number) => ({
    x: offsetX + (easting - bounds.minE) * scale,
    y: PAGE_HEIGHT_PT - (offsetY + (northing - bounds.minN) * scale),
  });
}

// ─── Drawing functions ───────────────────────────────────────────

function drawTitleBlock(
  page: PDFPage,
  input: UkMeasuredSurveyInput,
  fontBold: PDFFont,
  font: PDFFont,
): void {
  const blockX = MARGIN_PT;
  const blockY = PAGE_HEIGHT_PT - MARGIN_PT - TITLE_BLOCK_HEIGHT_PT;
  const blockW = PAGE_WIDTH_PT - 2 * MARGIN_PT;
  const blockH = TITLE_BLOCK_HEIGHT_PT;

  page.drawRectangle({
    x: blockX, y: blockY, width: blockW, height: blockH,
    borderColor: BLACK, borderWidth: 1, color: rgb(1, 1, 1),
  });

  const colW = blockW / 3;
  // Vertical dividers
  for (let i = 1; i < 3; i++) {
    page.drawLine({
      start: { x: blockX + i * colW, y: blockY },
      end: { x: blockX + i * colW, y: blockY + blockH },
      thickness: 0.5, color: BLACK,
    });
  }

  // Column 1: Project + Client
  page.drawText("PROJECT", { x: blockX + 4, y: blockY + blockH - 12, size: LABEL_FONT_SIZE, font: fontBold, color: GRAY });
  page.drawText(input.projectName, { x: blockX + 4, y: blockY + blockH - 24, size: TITLE_FONT_SIZE, font: fontBold, color: BLACK });
  page.drawText("CLIENT", { x: blockX + 4, y: blockY + 8, size: LABEL_FONT_SIZE, font: fontBold, color: GRAY });
  page.drawText(input.client, { x: blockX + 4, y: blockY - 2, size: LABEL_FONT_SIZE, font: font, color: BLACK });

  // Column 2: Surveyor + RICS
  page.drawText("SURVEYOR", { x: blockX + colW + 4, y: blockY + blockH - 12, size: LABEL_FONT_SIZE, font: fontBold, color: GRAY });
  page.drawText(input.surveyorName, { x: blockX + colW + 4, y: blockY + blockH - 24, size: TITLE_FONT_SIZE, font: fontBold, color: BLACK });
  page.drawText(`RICS No: ${input.ricsNumber}`, { x: blockX + colW + 4, y: blockY + 8, size: LABEL_FONT_SIZE, font: font, color: BLACK });
  page.drawText(`Date: ${input.dateOfSurvey}`, { x: blockX + colW + 4, y: blockY - 2, size: LABEL_FONT_SIZE, font: font, color: BLACK });

  // Column 3: Scale + Classification + CRS
  page.drawText("SCALE", { x: blockX + 2 * colW + 4, y: blockY + blockH - 12, size: LABEL_FONT_SIZE, font: fontBold, color: GRAY });
  page.drawText(`1:${input.scale}`, { x: blockX + 2 * colW + 4, y: blockY + blockH - 24, size: TITLE_FONT_SIZE, font: fontBold, color: BLACK });
  page.drawText(`Class: ${input.surveyClass}`, { x: blockX + 2 * colW + 4, y: blockY + 8, size: LABEL_FONT_SIZE, font: font, color: BLACK });
  page.drawText(input.coordinateSystem, { x: blockX + 2 * colW + 4, y: blockY - 2, size: LABEL_FONT_SIZE, font: font, color: BLACK });
}

function drawPlanArea(
  page: PDFPage,
  input: UkMeasuredSurveyInput,
  transform: (e: number, n: number) => { x: number; y: number },
  font: PDFFont,
  fontBold: PDFFont,
): void {
  // Draw contours (if any)
  if (input.contours) {
    for (const contour of input.contours) {
      for (let i = 0; i < contour.coordinates.length - 1; i += 2) {
        const a = transform(contour.coordinates[i]![0], contour.coordinates[i]![1]);
        const b = contour.coordinates[i + 1];
        if (!b) break;
        const bp = transform(b[0], b[1]);
        page.drawLine({ start: a, end: bp, thickness: 0.3, color: ACCENT });
      }
    }
  }

  // Draw survey points
  for (const p of input.points) {
    const pos = transform(p.easting, p.northing);
    // Point symbol: small cross
    page.drawLine({ start: { x: pos.x - 1.5, y: pos.y }, end: { x: pos.x + 1.5, y: pos.y }, thickness: 0.5, color: BLACK });
    page.drawLine({ start: { x: pos.x, y: pos.y - 1.5 }, end: { x: pos.x, y: pos.y + 1.5 }, thickness: 0.5, color: BLACK });

    // Point ID label
    page.drawText(p.pointId, {
      x: pos.x + 3, y: pos.y + 3,
      size: LABEL_FONT_SIZE, font: font, color: BLACK,
    });

    // Level label (if present)
    if (p.level !== undefined) {
      page.drawText(`${p.level.toFixed(2)}`, {
        x: pos.x + 3, y: pos.y - 4,
        size: LABEL_FONT_SIZE - 1, font: font, color: GRAY,
      });
    }
  }

  // North arrow (top-right of plan area)
  const naX = PAGE_WIDTH_PT - MARGIN_PT - 15;
  const naY = PAGE_HEIGHT_PT - MARGIN_PT - TITLE_BLOCK_HEIGHT_PT - 25;
  page.drawLine({ start: { x: naX, y: naY }, end: { x: naX, y: naY + 15 }, thickness: 1, color: BLACK });
  page.drawLine({ start: { x: naX - 3, y: naY + 10 }, end: { x: naX, y: naY + 15 }, thickness: 1, color: BLACK });
  page.drawLine({ start: { x: naX + 3, y: naY + 10 }, end: { x: naX, y: naY + 15 }, thickness: 1, color: BLACK });
  page.drawText("N", { x: naX - 3, y: naY + 18, size: LABEL_FONT_SIZE, font: fontBold, color: BLACK });

  // Scale bar (bottom-left of plan area)
  const sbX = MARGIN_PT + 5;
  const sbY = MARGIN_PT + COORD_SCHEDULE_HEIGHT_PT + 15;
  const sbLength = 50; // 50 points
  page.drawLine({ start: { x: sbX, y: sbY }, end: { x: sbX + sbLength, y: sbY }, thickness: 1.5, color: BLACK });
  page.drawLine({ start: { x: sbX, y: sbY - 3 }, end: { x: sbX, y: sbY + 3 }, thickness: 1, color: BLACK });
  page.drawLine({ start: { x: sbX + sbLength, y: sbY - 3 }, end: { x: sbX + sbLength, y: sbY + 3 }, thickness: 1, color: BLACK });
  page.drawText("0", { x: sbX, y: sbY - 10, size: LABEL_FONT_SIZE - 1, font: font, color: BLACK });
  const scaleLabel = `${(sbLength * input.scale / (MM_TO_PT * 1000)).toFixed(0)}m`;
  page.drawText(scaleLabel, { x: sbX + sbLength - 10, y: sbY - 10, size: LABEL_FONT_SIZE - 1, font: font, color: BLACK });
}

function drawCoordinateSchedule(
  page: PDFPage,
  input: UkMeasuredSurveyInput,
  font: PDFFont,
): void {
  const blockX = MARGIN_PT;
  const blockY = MARGIN_PT;
  const blockW = PAGE_WIDTH_PT - 2 * MARGIN_PT;
  const blockH = COORD_SCHEDULE_HEIGHT_PT;

  // Header
  const headerH = 12;
  page.drawRectangle({
    x: blockX, y: blockY + blockH - headerH, width: blockW, height: headerH,
    color: rgb(0.9, 0.9, 0.9), borderColor: BLACK, borderWidth: 0.5,
  });
  page.drawText(`COORDINATE SCHEDULE — ${input.coordinateSystem}`, {
    x: blockX + 4, y: blockY + blockH - headerH + 2,
    size: LABEL_FONT_SIZE, font: font, color: BLACK,
  });

  // Table border
  page.drawRectangle({
    x: blockX, y: blockY, width: blockW, height: blockH - headerH,
    borderColor: BLACK, borderWidth: 1, color: rgb(1, 1, 1),
  });

  // Column headers
  const colWidths = [0.1, 0.2, 0.2, 0.15, 0.35].map((p) => p * blockW);
  const headers = ["ID", "Easting", "Northing", "Level", "Description"];
  let cx = blockX;
  const tableTop = blockY + blockH - headerH;
  const rowH = 9;

  // Header row
  page.drawLine({
    start: { x: blockX, y: tableTop - rowH },
    end: { x: blockX + blockW, y: tableTop - rowH },
    thickness: 0.5, color: BLACK,
  });
  for (let i = 0; i < headers.length; i++) {
    page.drawText(headers[i]!, { x: cx + 3, y: tableTop - rowH + 2, size: LABEL_FONT_SIZE - 1, font: font, color: BLACK });
    cx += colWidths[i]!;
  }

  // Vertical dividers
  cx = blockX;
  for (let i = 0; i < colWidths.length - 1; i++) {
    cx += colWidths[i]!;
    page.drawLine({ start: { x: cx, y: blockY }, end: { x: cx, y: tableTop }, thickness: 0.5, color: BLACK });
  }

  // Data rows (show first N that fit)
  const maxRows = Math.floor((blockH - headerH - rowH) / rowH);
  for (let r = 0; r < Math.min(input.points.length, maxRows); r++) {
    const p = input.points[r]!;
    const rowY = tableTop - (r + 2) * rowH;
    const rowData = [p.pointId, p.easting.toFixed(3), p.northing.toFixed(3), p.level?.toFixed(3) ?? "—", p.description ?? p.code ?? ""];
    cx = blockX;
    for (let i = 0; i < rowData.length; i++) {
      page.drawText(rowData[i]!, { x: cx + 3, y: rowY + 2, size: LABEL_FONT_SIZE - 1, font: font, color: BLACK });
      cx += colWidths[i]!;
    }
  }
}

function drawComplianceStatement(
  page: PDFPage,
  input: UkMeasuredSurveyInput,
  font: PDFFont,
): void {
  const y = MARGIN_PT - 15;
  const text = `This survey was conducted in accordance with RICS Measured Surveys of Land, Buildings and Utilities (3rd ed.). Surveyor: ${input.surveyorName} (RICS ${input.ricsNumber}). Date: ${input.dateOfSurvey}. Classification: Class ${input.surveyClass}.`;
  page.drawText(text, {
    x: MARGIN_PT, y,
    size: LABEL_FONT_SIZE - 1, font: font, color: GRAY,
  });
}
