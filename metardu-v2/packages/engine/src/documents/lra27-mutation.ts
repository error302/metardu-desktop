/**
 * LRA-27 — Land Registration Act Form LRA-27 (Mutation) renderer.
 *
 * Produces an A4 portrait PDF of the LRA-27 Mutation / Application for
 * Subdivision form. This is a registry form (not a geodetic plan) that
 * travels with Form 4 (Mutation Plan) to the Land Registry. It records
 * title numbers, registry, proprietors, instructions to the surveyor,
 * and the schedule of new parcels.
 *
 * # Source spec
 *
 * Every layout decision cites `docs/regulatory-sources/kenya/forms/lra27-spec.md`
 * per invariant B2. Unverifiable decisions flagged [HK] with hkItemCount = 12.
 *
 * Source documents:
 *   docs/regulatory-sources/kenya/forms/form-lra-27-mutation-form.doc
 *     — .doc working template (filed; structure on disk)
 *   docs/regulatory-sources/kenya/cadastral/survey-act-cap-299-revised-2012.pdf
 *     — Survey Act ss.28-29 mutation lineage [HK]
 *   docs/regulatory-sources/kenya/cadastral/kenya-gazette-survey-regulations-1994.pdf
 *     — §6.2 area 4dp
 *   Land Registration (General) Regulations 2017 — triplicate [HK]
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { KENYA } from "@metardu/country-config";
import {
  validateNonEmptyString,
  validateNonNaN,
  validatePositive,
} from "../workflows/validation.js";

// ─── Types ─────────────────────────────────────────────────────────

export interface Lra27Proprietor {
  name: string;
  idNumber?: string;
  share?: string;
}

export interface Lra27NewParcelSchedule {
  lrNumber: string;
  areaHa: number;
}

export interface Lra27Surveyor {
  name: string;
  regNumber: string; // ISK format ^LS/\d{3,5}$/i
  date: string; // YYYY-MM-DD
}

export interface Lra27Input {
  titleNumbers: string[];
  registry: string;
  proprietors: Lra27Proprietor[];
  instructionsToSurveyor: string;
  newParcelsSchedule: Lra27NewParcelSchedule[];
  surveyor: Lra27Surveyor;
  serialNo?: string;
}

export interface Lra27Output {
  pdfBytes: Uint8Array;
  hasDraftWatermark: true;
  hkItemCount: number;
}

// ─── Constants ────────────────────────────────────────────────────

// Spec §Page layout — [HK-PENDING-SPECIMEN]
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const MARGIN_TOP_MM = 20;
const MARGIN_RIGHT_MM = 15;
const MARGIN_BOTTOM_MM = 20;
const MARGIN_LEFT_MM = 15;
const MM_TO_PT = 2.834645669;
const PAGE_WIDTH_PT = PAGE_WIDTH_MM * MM_TO_PT;
const PAGE_HEIGHT_PT = PAGE_HEIGHT_MM * MM_TO_PT;
const MARGIN_TOP_PT = MARGIN_TOP_MM * MM_TO_PT;
const MARGIN_RIGHT_PT = MARGIN_RIGHT_MM * MM_TO_PT;
const MARGIN_BOTTOM_PT = MARGIN_BOTTOM_MM * MM_TO_PT;
const MARGIN_LEFT_PT = MARGIN_LEFT_MM * MM_TO_PT;

const HEADER_HEIGHT_PT = 22 * MM_TO_PT;
const LABEL_FONT_SIZE = 7;
const HEADER_FONT_SIZE = 8.5;
const BODY_FONT_SIZE = 8;

const BLACK = rgb(0, 0, 0);
const DRAFT_RED = rgb(0.75, 0.15, 0.15);
const ROW_HEADER_BG = rgb(0.92, 0.92, 0.92);
const HK_ITEM_COUNT = 12; // per lra27-spec.md

// ─── Helpers ──────────────────────────────────────────────────────

function sanitizeAscii(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x00b0 || code === 0x00ba) out += "d";
    else if (code >= 32 && code < 127) out += s[i]!;
    else if (code === 8211 || code === 8212) out += "-";
    else if (code === 8220 || code === 8221) out += '"';
    else if (code === 8216 || code === 8217) out += "'";
    else if (code >= 128) out += "?";
    else out += s[i]!;
  }
  return out;
}

function drawDraftWatermark(page: PDFPage, font: PDFFont) {
  const text = sanitizeAscii("DRAFT -- NOT FOR LODGEMENT (HK-PENDING-SPECIMEN)");
  const size = 42;
  const textWidth = font.widthOfTextAtSize(text, size);
  const x = PAGE_WIDTH_PT / 2 - textWidth / 2;
  const y = PAGE_HEIGHT_PT / 2;
  page.drawText(text, { x, y, size, font, color: DRAFT_RED, opacity: 0.15, rotate: degrees(45) });
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawBorderedTable(
  page: PDFPage,
  x: number, y: number, w: number, h: number,
  headerText: string,
  _font: PDFFont, fontBold: PDFFont,
): number {
  // Outer border
  page.drawRectangle({ x, y, width: w, height: h, borderColor: BLACK, borderWidth: 0.7, color: rgb(1,1,1) });
  // Header band
  const headerH = 12;
  page.drawRectangle({ x, y: y + h - headerH, width: w, height: headerH, color: ROW_HEADER_BG, borderColor: BLACK, borderWidth: 0.5 });
  page.drawText(sanitizeAscii(headerText), { x: x + 4, y: y + h - headerH + 3, size: HEADER_FONT_SIZE - 1, font: fontBold, color: BLACK });
  return y + h - headerH; // content top
}

function drawVerificationFooter(page: PDFPage, font: PDFFont, hkCount: number) {
  const lines = [
    sanitizeAscii(`Layout cites: LRA-27 .doc (filed) & Survey Act Cap.299 ss.28-29 & Survey Regs 1994 s.6.2 -- HK items: ${hkCount} pending gazetted specimen.`),
    sanitizeAscii(`DRAFT watermark -- NOT FOR LODGEMENT. Triplicate execution per LRA General Regs 2017 [HK].`),
    sanitizeAscii(`Source: lra27-spec.md -- verification required before lodgement.`),
  ];
  const size = 6.5; const lineH = size * 1.35;
  const xM = MARGIN_LEFT_PT;
  const totalH = lines.length * lineH;
  const y0 = MARGIN_BOTTOM_PT - 4 - totalH;
  page.drawLine({ start: { x: xM, y: y0 + totalH + 2 }, end: { x: PAGE_WIDTH_PT - MARGIN_RIGHT_PT, y: y0 + totalH + 2 }, thickness: 0.25, color: rgb(0.55,0.55,0.55) });
  for (let i = 0; i < lines.length; i++) {
    page.drawText(lines[i]!, { x: xM, y: y0 + (lines.length - 1 - i) * lineH, size, font, color: rgb(0.45,0.45,0.45) });
  }
}

// ─── Section drawers ─────────────────────────────────────────────

function drawHeader(page: PDFPage, input: Lra27Input, font: PDFFont, fontBold: PDFFont) {
  const blockX = MARGIN_LEFT_PT;
  const blockW = PAGE_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT;
  const blockY = PAGE_HEIGHT_PT - MARGIN_TOP_PT - HEADER_HEIGHT_PT;
  const blockH = HEADER_HEIGHT_PT;
  page.drawRectangle({ x: blockX, y: blockY, width: blockW, height: blockH, borderColor: BLACK, borderWidth: 1, color: rgb(1,1,1) });

  const texts: Array<{ text: string; size: number; y: number; bold: boolean }> = [
    { text: "REPUBLIC OF KENYA", size: 10, y: blockY + blockH - 14, bold: true },
    { text: "THE LAND REGISTRATION ACT (No. 3 of 2012)", size: 8, y: blockY + blockH - 27, bold: false },
    { text: "FORM LRA-27 -- MUTATION / APPLICATION FOR SUBDIVISION", size: 9, y: blockY + blockH - 40, bold: true },
    { text: "This form is executed in triplicate.", size: 7, y: blockY + blockH - 51, bold: false },
  ];
  for (const t of texts) {
    const f = t.bold ? fontBold : font;
    const w = f.widthOfTextAtSize(sanitizeAscii(t.text), t.size);
    const cx = blockX + (blockW - w) / 2;
    // italic for triplicate note: use normal font but drawn italic style not available — keep normal + note in comment
    page.drawText(sanitizeAscii(t.text), { x: cx, y: t.y, size: t.size, font: f, color: BLACK });
  }
  // Serial No. right-aligned
  const serialText = sanitizeAscii(input.serialNo ? `Serial No.: ${input.serialNo}` : "Serial No.: ________");
  const serialW = font.widthOfTextAtSize(serialText, 7);
  page.drawText(serialText, { x: blockX + blockW - serialW - 6, y: blockY + 4, size: 7, font, color: BLACK });
}

function drawTitleNumbersSection(page: PDFPage, input: Lra27Input, font: PDFFont, fontBold: PDFFont, startY: number): number {
  const x = MARGIN_LEFT_PT;
  const w = PAGE_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT;
  const h = 28;
  const y = startY - h;
  const contentTop = drawBorderedTable(page, x, y, w, h, "1. TITLE NUMBER(S) & REGISTRY", font, fontBold);
  const registryLine = sanitizeAscii(`Registry: ${input.registry}   |   Titles (${input.titleNumbers.length}): ${input.titleNumbers.join(", ")}`);
  page.drawText(registryLine, { x: x + 4, y: contentTop - 13, size: BODY_FONT_SIZE, font, color: BLACK });
  return y;
}

function drawProprietorsSection(page: PDFPage, input: Lra27Input, font: PDFFont, fontBold: PDFFont, startY: number): number {
  const x = MARGIN_LEFT_PT;
  const w = PAGE_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT;
  const rowH = 11;
  const headerH = 12;
  const rows = input.proprietors.length;
  const h = headerH + rows * rowH + 4;
  const y = startY - 2 - h;
  const contentTop = drawBorderedTable(page, x, y, w, h, "2. PROPRIETOR(S)", font, fontBold);

  // Column headers inside
  const colW = [w * 0.45, w * 0.30, w * 0.25];
  const headers = ["Name", "ID Number", "Share"];
  let cx = x;
  for (let i = 0; i < headers.length; i++) {
    page.drawText(sanitizeAscii(headers[i]!), { x: cx + 3, y: contentTop - 11, size: LABEL_FONT_SIZE, font: fontBold, color: BLACK });
    cx += colW[i]!;
  }
  page.drawLine({ start: { x, y: contentTop - 13 }, end: { x: x + w, y: contentTop - 13 }, thickness: 0.5, color: BLACK });
  // vertical dividers
  cx = x;
  for (let i = 0; i < colW.length - 1; i++) {
    cx += colW[i]!;
    page.drawLine({ start: { x: cx, y }, end: { x: cx, y: contentTop }, thickness: 0.4, color: BLACK });
  }
  for (let r = 0; r < rows; r++) {
    const prop = input.proprietors[r]!;
    const rowY = contentTop - 13 - (r + 1) * rowH;
    const data = [sanitizeAscii(prop.name), sanitizeAscii(prop.idNumber ?? "--"), sanitizeAscii(prop.share ?? "--")];
    cx = x;
    for (let i = 0; i < data.length; i++) {
      page.drawText(data[i]!, { x: cx + 3, y: rowY + 3, size: BODY_FONT_SIZE - 0.5, font, color: BLACK });
      cx += colW[i]!;
    }
    if (r < rows - 1) page.drawLine({ start: { x, y: rowY }, end: { x: x + w, y: rowY }, thickness: 0.2, color: rgb(0.8,0.8,0.8) });
  }
  return y;
}

function drawInstructionsSection(page: PDFPage, input: Lra27Input, font: PDFFont, fontBold: PDFFont, startY: number): number {
  const x = MARGIN_LEFT_PT;
  const w = PAGE_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT;
  const lines = wrapText(input.instructionsToSurveyor, 95);
  const h = 22 + lines.length * 9;
  const y = startY - 2 - h;
  const contentTop = drawBorderedTable(page, x, y, w, h, "3. INSTRUCTIONS TO THE SURVEYOR / DIRECTOR OF SURVEYS", font, fontBold);
  for (let i = 0; i < lines.length; i++) {
    page.drawText(sanitizeAscii(lines[i]!), { x: x + 4, y: contentTop - 13 - i * 9, size: BODY_FONT_SIZE, font, color: BLACK });
  }
  return y;
}

function drawScheduleSection(page: PDFPage, input: Lra27Input, font: PDFFont, fontBold: PDFFont, startY: number): number {
  const x = MARGIN_LEFT_PT;
  const w = PAGE_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT;
  const headerH = 12;
  const rowH = 10;
  const rows = input.newParcelsSchedule.length;
  const h = headerH + rows * rowH + 14; // + total foot
  const y = startY - 2 - h;
  const contentTop = drawBorderedTable(page, x, y, w, h, "4. SCHEDULE OF NEW PARCELS", font, fontBold);
  // inner header
  const colW = [w * 0.55, w * 0.45];
  page.drawText(sanitizeAscii("LR Number"), { x: x + 4, y: contentTop - 11, size: LABEL_FONT_SIZE, font: fontBold, color: BLACK });
  page.drawText(sanitizeAscii("Area (ha)"), { x: x + colW[0]! + 4, y: contentTop - 11, size: LABEL_FONT_SIZE, font: fontBold, color: BLACK });
  page.drawLine({ start: { x, y: contentTop - 13 }, end: { x: x + w, y: contentTop - 13 }, thickness: 0.5, color: BLACK });
  page.drawLine({ start: { x: x + colW[0]!, y }, end: { x: x + colW[0]!, y: contentTop }, thickness: 0.4, color: BLACK });

  for (let r = 0; r < rows; r++) {
    const entry = input.newParcelsSchedule[r]!;
    const rowY = contentTop - 13 - (r + 1) * rowH;
    page.drawText(sanitizeAscii(entry.lrNumber), { x: x + 4, y: rowY + 2, size: BODY_FONT_SIZE, font, color: BLACK });
    page.drawText(sanitizeAscii(`${entry.areaHa.toFixed(4)} ha`), { x: x + colW[0]! + 4, y: rowY + 2, size: BODY_FONT_SIZE, font, color: BLACK });
    if (r < rows - 1) page.drawLine({ start: { x, y: rowY }, end: { x: x + w, y: rowY }, thickness: 0.2, color: rgb(0.8,0.8,0.8) });
  }
  // total footer
  const total = input.newParcelsSchedule.reduce((s, p) => s + p.areaHa, 0);
  const totalText = sanitizeAscii(`TOTAL: ${total.toFixed(4)} ha (${rows} parcel(s))`);
  const footY = y + 3;
  page.drawLine({ start: { x, y: footY + 10 }, end: { x: x + w, y: footY + 10 }, thickness: 0.4, color: BLACK });
  page.drawText(totalText, { x: x + 4, y: footY + 2, size: LABEL_FONT_SIZE, font: fontBold, color: BLACK });
  return y;
}

function drawSurveyorBlock(page: PDFPage, input: Lra27Input, font: PDFFont, fontBold: PDFFont, startY: number): number {
  const x = MARGIN_LEFT_PT;
  const w = PAGE_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT;
  const h = 48;
  const y = startY - 4 - h;
  const contentTop = drawBorderedTable(page, x, y, w, h, "5. SURVEYOR CERTIFICATION", font, fontBold);
  const lines = [
    sanitizeAscii(`I, ${input.surveyor.name}, licensed surveyor No. ${input.surveyor.regNumber}, certify that the schedule above`),
    sanitizeAscii(`accords with the mutation survey executed by me on ${input.surveyor.date} per Survey Act and Land Registration Act. [HK]`),
    sanitizeAscii(`Signed: _______________________      Date: ${input.surveyor.date}`),
  ];
  for (let i = 0; i < lines.length; i++) {
    page.drawText(lines[i]!, { x: x + 4, y: contentTop - 14 - i * 9, size: BODY_FONT_SIZE - 0.5, font, color: BLACK });
  }
  // Seal note
  page.drawText(sanitizeAscii("Seal: [on companion Form 4]"), { x: x + 4, y: y + 4, size: 6.5, font, color: rgb(0.45,0.45,0.45) });
  return y;
}

// ─── Validation ────────────────────────────────────────────────────

function validateLra27Input(input: Lra27Input): void {
  if (!Array.isArray(input.titleNumbers) || input.titleNumbers.length === 0) {
    throw new Error("Validation error: Lra27Input.titleNumbers must have at least 1 title number.");
  }
  for (let i = 0; i < input.titleNumbers.length; i++) {
    validateNonEmptyString(input.titleNumbers[i]!, `Lra27Input.titleNumbers[${i}]`);
  }
  validateNonEmptyString(input.registry, "Lra27Input.registry");
  if (!Array.isArray(input.proprietors) || input.proprietors.length === 0) {
    throw new Error("Validation error: Lra27Input.proprietors must have at least 1 proprietor.");
  }
  for (let i = 0; i < input.proprietors.length; i++) {
    validateNonEmptyString(input.proprietors[i]!.name, `Lra27Input.proprietors[${i}].name`);
    if (input.proprietors[i]!.idNumber !== undefined) {
      validateNonEmptyString(input.proprietors[i]!.idNumber!, `Lra27Input.proprietors[${i}].idNumber`);
    }
    if (input.proprietors[i]!.share !== undefined) {
      validateNonEmptyString(input.proprietors[i]!.share!, `Lra27Input.proprietors[${i}].share`);
    }
  }
  validateNonEmptyString(input.instructionsToSurveyor, "Lra27Input.instructionsToSurveyor");
  if (!Array.isArray(input.newParcelsSchedule) || input.newParcelsSchedule.length === 0) {
    throw new Error("Validation error: Lra27Input.newParcelsSchedule must have at least 1 entry.");
  }
  for (let i = 0; i < input.newParcelsSchedule.length; i++) {
    validateNonEmptyString(input.newParcelsSchedule[i]!.lrNumber, `Lra27Input.newParcelsSchedule[${i}].lrNumber`);
    validateNonNaN(input.newParcelsSchedule[i]!.areaHa, `Lra27Input.newParcelsSchedule[${i}].areaHa`);
    validatePositive(input.newParcelsSchedule[i]!.areaHa, `Lra27Input.newParcelsSchedule[${i}].areaHa`);
  }
  validateNonEmptyString(input.surveyor.name, "Lra27Input.surveyor.name");
  validateNonEmptyString(input.surveyor.regNumber, "Lra27Input.surveyor.regNumber");
  validateNonEmptyString(input.surveyor.date, "Lra27Input.surveyor.date");
  const iskPattern = KENYA.professionalBody.registrationPattern;
  if (iskPattern && !new RegExp(iskPattern, "i").test(input.surveyor.regNumber)) {
    throw new Error(`Validation error: Lra27Input.surveyor.regNumber '${input.surveyor.regNumber}' does not match pattern ${iskPattern} (e.g. 'LS/1234').`);
  }
  if (input.serialNo !== undefined) validateNonEmptyString(input.serialNo, "Lra27Input.serialNo");
}

// ─── Main entry point ──────────────────────────────────────────────

/**
 * Generate an LRA-27 (Mutation) PDF.
 *
 * A4 portrait, header + 5 bordered sections + certification, DRAFT watermark
 * opacity 0.15 diagonal, verification footer with HK count = 12.
 */
export async function generateLra27Pdf(input: Lra27Input): Promise<Lra27Output> {
  validateLra27Input(input);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(sanitizeAscii(`LRA-27 -- ${input.titleNumbers.join(", ")} -> ${input.newParcelsSchedule.map(p=>p.lrNumber).join(", ")}`));
  pdfDoc.setAuthor(sanitizeAscii(input.surveyor.name));
  pdfDoc.setSubject(sanitizeAscii("Kenya Land Registration Act, Form LRA-27 -- Mutation [DRAFT]"));
  pdfDoc.setKeywords(["Kenya", "LRA-27", "Mutation", "Land Registration", sanitizeAscii(input.registry)]);
  pdfDoc.setProducer("MetaRDU Desktop");
  pdfDoc.setCreator("MetaRDU Desktop -- packages/engine/src/documents/lra27-mutation.ts");
  pdfDoc.setCreationDate(new Date());

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);

  // 1. DRAFT watermark behind
  drawDraftWatermark(page, fontBold);

  // 2. Header
  drawHeader(page, input, font, fontBold);
  let cursorY = PAGE_HEIGHT_PT - MARGIN_TOP_PT - HEADER_HEIGHT_PT;

  // 3. Sections top-to-bottom
  cursorY = drawTitleNumbersSection(page, input, font, fontBold, cursorY);
  cursorY = drawProprietorsSection(page, input, font, fontBold, cursorY);
  cursorY = drawInstructionsSection(page, input, font, fontBold, cursorY);
  cursorY = drawScheduleSection(page, input, font, fontBold, cursorY);
  cursorY = drawSurveyorBlock(page, input, font, fontBold, cursorY);

  void cursorY; // keep for layout debugging

  // 4. Verification footer
  drawVerificationFooter(page, font, HK_ITEM_COUNT);

  const pdfBytes = await pdfDoc.save();
  return { pdfBytes, hasDraftWatermark: true, hkItemCount: HK_ITEM_COUNT };
}
