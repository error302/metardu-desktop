/**
 * invoice-pdf.ts — Proforma invoice PDF generator using pdf-lib.
 *
 * Generates a professional A4 portrait proforma invoice with:
 *   - Company header + logo placeholder
 *   - Invoice metadata (number, date, validity)
 *   - Client details
 *   - Fee breakdown table (base, area, beacon, traverse, terrain, VAT, total)
 *   - Payment terms
 *   - Regulatory reference
 *   - Professional body reference
 *
 * Uses pdf-lib (pure JS, works in browser/renderer context).
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getFeeScale, formatCurrency, type CountryFeeCode, type FeeBreakdown } from "./fee-scales.js";

// ─── Constants ───────────────────────────────────────────────────

const PAGE_WIDTH = 595.28; // A4 portrait width in points
const PAGE_HEIGHT = 841.89; // A4 portrait height in points
const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 50;
const MARGIN_TOP = 50;
const MARGIN_BOTTOM = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

// Colors
const PRIMARY = rgb(0.05, 0.25, 0.55); // Navy blue
const ACCENT = rgb(0.85, 0.45, 0.1); // Orange
const TEXT = rgb(0.15, 0.15, 0.15);
const TEXT_LIGHT = rgb(0.45, 0.45, 0.45);
const BORDER = rgb(0.75, 0.75, 0.75);
const ROW_ALT = rgb(0.96, 0.96, 0.96);
const HEADER_BG = rgb(0.05, 0.25, 0.55);
const HEADER_TEXT = rgb(1, 1, 1);

// ─── Types ───────────────────────────────────────────────────────

export interface InvoiceParams {
  invoiceNo: string;
  clientName: string;
  clientAddress?: string;
  jobTitle: string;
  breakdown: FeeBreakdown;
  countryCode: CountryFeeCode;
  surveyorName: string;
  surveyorRegNo: string;
  surveyorAddress?: string;
  date: string;
  validDays?: number;
}

// ─── Helper Functions ────────────────────────────────────────────

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = TEXT,
) {
  page.drawText(text, { x, y, font, size, color });
}

function drawLine(
  page: PDFPage,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = BORDER,
  thickness = 0.5,
) {
  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    color,
    thickness,
  });
}

function drawRect(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  color: ReturnType<typeof rgb>,
) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color,
  });
}

// ─── Main Generator ──────────────────────────────────────────────

export async function generateProformaInvoicePdf(
  params: InvoiceParams,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Proforma Invoice — ${params.invoiceNo}`);
  pdfDoc.setAuthor(params.surveyorName);
  pdfDoc.setSubject(`Survey Services — ${params.jobTitle}`);

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const scale = getFeeScale(params.countryCode);
  const breakdown = params.breakdown;
  const validDays = params.validDays ?? 30;

  let y = PAGE_HEIGHT - MARGIN_TOP;

  // ─── Header Banner ──────────────────────────────────────────
  drawRect(page, 0, y - 5, PAGE_WIDTH, 55, PRIMARY);
  drawText(page, "PROFORMA INVOICE", MARGIN_LEFT, y + 8, fontBold, 22, HEADER_TEXT);
  drawText(
    page,
    scale.professionalBody,
    PAGE_WIDTH - MARGIN_RIGHT - 250,
    y + 8,
    font,
    10,
    rgb(0.8, 0.85, 0.95),
  );
  y -= 30;

  // ─── Invoice Metadata ───────────────────────────────────────
  y -= 20;
  drawText(page, `Invoice No:`, MARGIN_LEFT, y, font, 10, TEXT_LIGHT);
  drawText(page, params.invoiceNo, MARGIN_LEFT + 70, y, fontBold, 10, TEXT);
  drawText(page, `Date:`, PAGE_WIDTH / 2, y, font, 10, TEXT_LIGHT);
  drawText(page, params.date, PAGE_WIDTH / 2 + 35, y, font, 10, TEXT);
  y -= 16;
  drawText(page, `Valid for:`, MARGIN_LEFT, y, font, 10, TEXT_LIGHT);
  drawText(page, `${validDays} days`, MARGIN_LEFT + 70, y, font, 10, TEXT);
  drawText(page, `Currency:`, PAGE_WIDTH / 2, y, font, 10, TEXT_LIGHT);
  drawText(page, `${scale.currency} (${scale.symbol})`, PAGE_WIDTH / 2 + 50, y, font, 10, TEXT);
  y -= 8;
  drawLine(page, MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y, BORDER, 0.5);
  y -= 20;

  // ─── From / To ──────────────────────────────────────────────
  const leftCol = MARGIN_LEFT;
  const rightCol = PAGE_WIDTH / 2 + 20;

  // FROM
  drawText(page, "FROM:", leftCol, y, fontBold, 9, PRIMARY);
  y -= 14;
  drawText(page, params.surveyorName, leftCol, y, fontBold, 10, TEXT);
  if (params.surveyorAddress) {
    y -= 13;
    drawText(page, params.surveyorAddress, leftCol, y, font, 9, TEXT_LIGHT);
  }
  y -= 13;
  drawText(page, `Reg. No: ${params.surveyorRegNo}`, leftCol, y, font, 9, TEXT_LIGHT);
  y -= 13;
  drawText(page, scale.regulatoryRef, leftCol, y, fontItalic, 8, TEXT_LIGHT);

  // TO (reset y for right column)
  let toY = PAGE_HEIGHT - MARGIN_TOP - 60;
  drawText(page, "TO:", rightCol, toY, fontBold, 9, PRIMARY);
  toY -= 14;
  drawText(page, params.clientName, rightCol, toY, fontBold, 10, TEXT);
  if (params.clientAddress) {
    toY -= 13;
    drawText(page, params.clientAddress, rightCol, toY, font, 9, TEXT_LIGHT);
  }

  y -= 30;
  drawText(page, "RE:", leftCol, y, fontBold, 9, PRIMARY);
  y -= 14;
  drawText(page, params.jobTitle, leftCol, y, font, 10, TEXT);
  y -= 10;
  drawLine(page, MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y, BORDER, 0.5);
  y -= 25;

  // ─── Fee Breakdown Table ────────────────────────────────────
  drawText(page, "FEE BREAKDOWN", MARGIN_LEFT, y, fontBold, 11, PRIMARY);
  y -= 5;

  // Table header
  const tableLeft = MARGIN_LEFT;
  const amountWidth = CONTENT_WIDTH * 0.35;
  const tableRight = MARGIN_LEFT + CONTENT_WIDTH;

  y -= 15;
  drawRect(page, tableLeft, y - 4, CONTENT_WIDTH, 18, HEADER_BG);
  drawText(page, "Description", tableLeft + 8, y, fontBold, 9, HEADER_TEXT);
  drawText(page, "Amount", tableRight - amountWidth + 8, y, fontBold, 9, HEADER_TEXT);
  y -= 22;

  // Table rows
  const rows: Array<{ label: string; amount: string; bold?: boolean; alt?: boolean }> = [
    { label: "Base Lodgement & Plan Fee", amount: formatCurrency(breakdown.baseFee, params.countryCode) },
    { label: `Area Fee (${params.breakdown.symbol} per ha)`, amount: formatCurrency(breakdown.areaFee, params.countryCode), alt: true },
    { label: "Beaconing", amount: formatCurrency(breakdown.beaconFee, params.countryCode) },
    { label: "Control Traverse", amount: formatCurrency(breakdown.traverseFee, params.countryCode), alt: true },
  ];

  for (const row of rows) {
    if (row.alt) {
      drawRect(page, tableLeft, y - 4, CONTENT_WIDTH, 16, ROW_ALT);
    }
    drawText(page, row.label, tableLeft + 8, y, font, 9, TEXT);
    drawText(page, row.amount, tableRight - amountWidth + 8, y, font, 9, TEXT);
    y -= 18;
  }

  // Subtotal line
  drawLine(page, tableLeft, y, tableRight, y, BORDER, 0.5);
  y -= 16;
  drawText(page, "Subtotal", tableLeft + 8, y, font, 9, TEXT);
  drawText(page, formatCurrency(breakdown.subtotalBeforeTerrain, params.countryCode), tableRight - amountWidth + 8, y, font, 9, TEXT);
  y -= 18;

  // Terrain multiplier
  drawText(page, `Terrain Adjustment (${breakdown.terrainMultiplier}×)`, tableLeft + 8, y, font, 9, TEXT_LIGHT);
  drawText(page, formatCurrency(breakdown.subtotalAfterTerrain, params.countryCode), tableRight - amountWidth + 8, y, fontBold, 9, TEXT);
  y -= 18;

  // Minimum fee notice
  if (breakdown.minimumApplied) {
    drawText(page, `⚠ Minimum fee applied (${scale.symbol} ${scale.minimumFee?.toLocaleString()})`, tableLeft + 8, y, fontItalic, 8, ACCENT);
    y -= 16;
  }

  // VAT
  drawText(page, breakdown.vatLabel, tableLeft + 8, y, font, 9, TEXT_LIGHT);
  drawText(page, formatCurrency(breakdown.vat, params.countryCode), tableRight - amountWidth + 8, y, font, 9, TEXT_LIGHT);
  y -= 6;

  // Total line
  drawLine(page, tableLeft, y, tableRight, y, PRIMARY, 1.5);
  y -= 20;

  // Total row (highlighted)
  drawRect(page, tableLeft, y - 8, CONTENT_WIDTH, 26, rgb(0.95, 0.97, 1.0));
  drawText(page, "TOTAL DUE", tableLeft + 8, y, fontBold, 12, PRIMARY);
  drawText(page, formatCurrency(breakdown.total, params.countryCode), tableRight - amountWidth + 8, y, fontBold, 12, PRIMARY);
  y -= 30;

  // Hourly rate
  drawText(page, `Professional Hourly Rate: ${formatCurrency(scale.hourlyRate, params.countryCode)}/hr`, tableLeft + 8, y, fontItalic, 8, TEXT_LIGHT);
  y -= 30;

  // ─── Payment Terms ──────────────────────────────────────────
  drawLine(page, MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y, BORDER, 0.5);
  y -= 18;
  drawText(page, "PAYMENT TERMS", MARGIN_LEFT, y, fontBold, 10, PRIMARY);
  y -= 14;
  drawText(page, "1.  50% upon acceptance of this proforma invoice.", MARGIN_LEFT + 10, y, font, 9, TEXT);
  y -= 13;
  drawText(page, "2.  50% upon delivery of final statutory survey plans.", MARGIN_LEFT + 10, y, font, 9, TEXT);
  y -= 13;
  drawText(page, `3.  Payment due within ${validDays} days of invoice date.`, MARGIN_LEFT + 10, y, font, 9, TEXT);
  y -= 13;
  drawText(page, "4.  Late payments attract 2% per month interest.", MARGIN_LEFT + 10, y, font, 9, TEXT);
  y -= 25;

  // ─── Scope of Work ──────────────────────────────────────────
  drawText(page, "SCOPE OF WORK", MARGIN_LEFT, y, fontBold, 10, PRIMARY);
  y -= 14;
  const sym = scale.symbol;
  const scopeLines = [
    `• Cadastral survey — ${sym} ${Math.round(breakdown.total).toLocaleString()} total`,
    `• Establishment / re-establishment of boundary beacons`,
    `• Control traverse`,
    `• Preparation of statutory deed plan / survey plan`,
    `• Digital submission to relevant land registry`,
    `• RSA-2048 digital signing of all deliverables`,
  ];
  for (const line of scopeLines) {
    drawText(page, line, MARGIN_LEFT + 10, y, font, 9, TEXT);
    y -= 13;
  }
  y -= 15;

  // ─── Footer ─────────────────────────────────────────────────
  drawLine(page, MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y, BORDER, 0.5);
  y -= 14;
  drawText(
    page,
    "This is a proforma invoice. Prices are valid for 30 days from the date of issue.",
    MARGIN_LEFT,
    y,
    fontItalic,
    8,
    TEXT_LIGHT,
  );
  y -= 12;
  drawText(
    page,
    `Regulatory reference: ${scale.regulatoryRef}`,
    MARGIN_LEFT,
    y,
    fontItalic,
    8,
    TEXT_LIGHT,
  );
  y -= 12;
  drawText(
    page,
    "Generated by MetaRDU Desktop — Survey Practice Management",
    MARGIN_LEFT,
    y,
    fontItalic,
    7,
    rgb(0.6, 0.6, 0.6),
  );

  // ─── Page Number ────────────────────────────────────────────
  drawText(
    page,
    "Page 1 of 1",
    PAGE_WIDTH - MARGIN_RIGHT - 60,
    MARGIN_BOTTOM - 10,
    font,
    7,
    TEXT_LIGHT,
  );

  // ─── Save ───────────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}
