/**
 * AU Plan of Survey — NSW Deposited Plan (D.P.) renderer.
 *
 * Produces a DRAFT PDF on the sheet/orientation/CRS defined by
 * `getCountryConfig("AU").planSheet` and `geodeticFramework`.
 * Reuses form-3.ts helpers (bearingDMS, distanceM, parcelBounds,
 * makePlanTransform) with market-specific title block, footer, and
 * certification from AU planSheet.
 *
 * # Source spec
 *
 * Every layout decision cites `docs/regulatory-sources/australia/nsw/plan-of-survey-spec.md`
 * per invariant B2. Unverifiable decisions flagged [HK] with hkItemCount = 9.
 *
 * Sources:
 *   Surveying and Spatial Information Act 2002 (NSW) s.21 [HK-PENDING-SPECIMEN]
 *   Surveying and Spatial Information Regulation 2017 (NSW) [HK]
 *   ICSM SP1 v2.2
 *   NSW LRS Plan of Survey template [HK-PENDING-SPECIMEN]
 *   packages/country-config/src/countries/australia.ts — PLAN_OF_SURVEY + AUSTRALIA.planSheet
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { getCountryConfig } from "@metardu/country-config";
import {
  validateNonEmptyString,
  validateNonNaN,
  validatePositive,
  validateSRID,
} from "../workflows/validation.js";

// ─── Types ────────────────────────────────────────────────────────

export interface AuPoint {
  easting: number;
  northing: number;
}

export interface AuBeacon {
  label: string;
  position: AuPoint;
  description: string;
}

export interface AuParcel {
  beacons: AuBeacon[];
  areaHa?: number;
  srid: number;
}

export interface AuSurveyor {
  name: string;
  regNo: string;
  dateOfSurvey: string;
}

export interface AuPlanOfSurveyInput {
  parcel: AuParcel;
  surveyor: AuSurveyor;
  planNumber?: string;
  edition?: string;
  council?: string;
  locality?: string;
  parish?: string;
  county?: string;
  lga?: string;
}

export interface AuPlanOfSurveyOutput {
  pdfBytes: Uint8Array;
  hasDraftWatermark: true;
  hkItemCount: number;
  pageSize: string;
  orientation: string;
  srid: number;
}

// ─── Sheet constants derived from country-config ─────────────────

// ISO sheet sizes in mm
const SHEET_SIZES_MM: Record<string, { w: number; h: number }> = {
  a0: { w: 841, h: 1189 },
  a1: { w: 594, h: 841 },
  a2: { w: 420, h: 594 },
  a3: { w: 297, h: 420 },
  a4: { w: 210, h: 297 },
  a5: { w: 148, h: 210 },
  letter: { w: 216, h: 279 },
  legal: { w: 216, h: 356 },
};

const MM_TO_PT = 2.834645669;

const HK_ITEM_COUNT = 9;

// Colors
const BLACK = rgb(0, 0, 0);
const DRAFT_RED = rgb(0.75, 0.15, 0.15);
const LIGHT_GRAY = rgb(0.85, 0.85, 0.85);

// ─── Helpers ──────────────────────────────────────────────────────

function sanitizeAscii(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x00b0 || code === 0x00ba) out += "d";
    else if (code === 8211 || code === 8212) out += "-";
    else if (code === 8220 || code === 8221) out += '"';
    else if (code === 8216 || code === 8217) out += "'";
    else if (code === 0x2014) out += "-"; // em dash
    else if (code >= 32 && code < 127) out += s[i]!;
    else if (code >= 128) out += "?";
    else out += s[i]!;
  }
  return out;
}

function selectScale(areaHa: number): number {
  if (areaHa < 0.5) return 500;
  if (areaHa < 5) return 1000;
  if (areaHa < 50) return 2000;
  return 4000;
}

function bearingDMS(a: AuPoint, b: AuPoint): { deg: number; str: string } {
  const de = b.easting - a.easting;
  const dn = b.northing - a.northing;
  let degVal = (Math.atan2(de, dn) * 180) / Math.PI;
  if (degVal < 0) degVal += 360;
  const d = Math.floor(degVal);
  const mFull = (degVal - d) * 60;
  const m = Math.floor(mFull);
  const s = Math.round((mFull - m) * 60);
  return { deg: degVal, str: `${String(d).padStart(3, "0")}d${String(m).padStart(2, "0")}'${String(s).padStart(2, "0")}"` };
}

function distanceM(a: AuPoint, b: AuPoint): { m: number; str: string } {
  const de = b.easting - a.easting;
  const dn = b.northing - a.northing;
  return { m: Math.sqrt(de * de + dn * dn), str: `${Math.sqrt(de * de + dn * dn).toFixed(3)} m` };
}

function parcelBounds(beacons: AuBeacon[]) {
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const b of beacons) {
    if (b.position.easting < minE) minE = b.position.easting;
    if (b.position.easting > maxE) maxE = b.position.easting;
    if (b.position.northing < minN) minN = b.position.northing;
    if (b.position.northing > maxN) maxN = b.position.northing;
  }
  const padE = (maxE - minE) * 0.1;
  const padN = (maxN - minN) * 0.1;
  return { minE: minE - padE, maxE: maxE + padE, minN: minN - padN, maxN: maxN + padN, width: (maxE - minE) + 2 * padE, height: (maxN - minN) + 2 * padN };
}

function makePlanTransform(
  bounds: { minE: number; maxE: number; minN: number; maxN: number; width: number; height: number },
  planAreaX: number, planAreaY: number, planAreaW: number, planAreaH: number,
  scale: number,
): (p: AuPoint) => { x: number; y: number } {
  const planAreaWmm = planAreaW / MM_TO_PT;
  const planAreaHmm = planAreaH / MM_TO_PT;
  const fitScaleW = (bounds.width * 1000) / planAreaWmm;
  const fitScaleH = (bounds.height * 1000) / planAreaHmm;
  const effectiveScale = Math.max(scale, fitScaleW, fitScaleH);
  const mmPerM = 1000 / effectiveScale;
  const ptPerM = mmPerM * MM_TO_PT;
  const parcelCenterE = (bounds.minE + bounds.maxE) / 2;
  const parcelCenterN = (bounds.minN + bounds.maxN) / 2;
  const planCenterX = planAreaX + planAreaW / 2;
  const planCenterY = planAreaY + planAreaH / 2;
  return (p: AuPoint) => ({
    x: planCenterX + (p.easting - parcelCenterE) * ptPerM,
    y: planCenterY + (p.northing - parcelCenterN) * ptPerM,
  });
}

function getSheetDims(cfg: ReturnType<typeof getCountryConfig>): { pageWidthPt: number; pageHeightPt: number; pageSize: string; orientation: string; marginsPt: [number, number, number, number] } {
  const planSheet = cfg.planSheet!;
  const key = planSheet.defaultSheetSize.toLowerCase();
  const dims = SHEET_SIZES_MM[key];
  if (!dims) throw new Error(`Unknown sheet size ${planSheet.defaultSheetSize} for ${cfg.countryCode}`);
  const orientation = planSheet.defaultOrientation;
  let wMm = dims.w;
  let hMm = dims.h;
  if (orientation === "landscape") {
    [wMm, hMm] = [hMm, wMm];
  }
  const pageSize = planSheet.defaultSheetSize.toUpperCase();
  // margins from statutory doc PLAN_OF_SURVEY — prefer doc spec, fall back to 20mm
  const doc = cfg.statutoryDocuments.find((d) => d.docType === "Plan of Survey");
  const marginsMm = (doc?.margins_mm ?? [20, 20, 20, 20]) as [number, number, number, number];
  const marginsPt: [number, number, number, number] = marginsMm.map((m) => m * MM_TO_PT) as [number, number, number, number];
  return { pageWidthPt: wMm * MM_TO_PT, pageHeightPt: hMm * MM_TO_PT, pageSize, orientation, marginsPt };
}

function drawDraftWatermark(page: PDFPage, font: PDFFont, pageWidthPt: number, pageHeightPt: number) {
  const text = sanitizeAscii("DRAFT -- NOT FOR LODGEMENT (HK-PENDING-SPECIMEN)");
  const size = pageWidthPt > 600 ? 56 : 42;
  const textWidth = font.widthOfTextAtSize(text, size);
  const x = pageWidthPt / 2 - textWidth / 2;
  const y = pageHeightPt / 2;
  page.drawText(text, { x, y, size, font, color: DRAFT_RED, opacity: 0.15, rotate: degrees(45) });
}

function drawVerificationFooter(page: PDFPage, font: PDFFont, pageWidthPt: number, marginBottomPt: number, marginLeftPt: number, marginRightPt: number, hkCount: number, cfg: ReturnType<typeof getCountryConfig>) {
  const crsLabel = cfg.geodeticFramework.projectionZones.find((z) => z.srid === cfg.geodeticFramework.primarySRID)?.name ?? cfg.geodeticFramework.datum;
  const lines = [
    sanitizeAscii(`Layout cites: Surveying and Spatial Information Act 2002 (NSW) s.21 & ICSM SP1 v2.2 -- ${crsLabel} -- HK items: ${hkCount} pending NSW LRS specimen.`),
    sanitizeAscii(`DRAFT watermark -- NOT FOR LODGEMENT. BOSSI seal pending [HK].`),
    sanitizeAscii(`Source: plan-of-survey-spec.md -- verification required before lodgement.`),
  ];
  const size = 6.5;
  const lineH = size * 1.35;
  const xM = marginLeftPt;
  const totalH = lines.length * lineH;
  const y0 = marginBottomPt - 4 - totalH;
  if (y0 < 0) return;
  page.drawLine({ start: { x: xM, y: y0 + totalH + 2 }, end: { x: pageWidthPt - marginRightPt, y: y0 + totalH + 2 }, thickness: 0.25, color: rgb(0.55, 0.55, 0.55) });
  for (let i = 0; i < lines.length; i++) {
    page.drawText(lines[i]!, { x: xM, y: y0 + (lines.length - 1 - i) * lineH, size, font, color: rgb(0.45, 0.45, 0.45) });
  }
}

function polygonAreaHa(beacons: AuBeacon[]): number {
  if (beacons.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < beacons.length; i++) {
    const j = (i + 1) % beacons.length;
    area += beacons[i]!.position.easting * beacons[j]!.position.northing - beacons[j]!.position.easting * beacons[i]!.position.northing;
  }
  return Math.abs(area) / 2 / 10000;
}

// ─── Validation ───────────────────────────────────────────────────

function validateAuInput(input: AuPlanOfSurveyInput): void {
  if (!Array.isArray(input.parcel.beacons) || input.parcel.beacons.length < 3) {
    throw new Error(`Validation error: AuPlanOfSurveyInput.parcel.beacons must have at least 3 beacons, got ${input.parcel.beacons?.length ?? 0}.`);
  }
  for (let i = 0; i < input.parcel.beacons.length; i++) {
    const b = input.parcel.beacons[i]!;
    validateNonEmptyString(b.label, `AuPlanOfSurveyInput.parcel.beacons[${i}].label`);
    validateNonEmptyString(b.description, `AuPlanOfSurveyInput.parcel.beacons[${i}].description`);
    validateNonNaN(b.position.easting, `AuPlanOfSurveyInput.parcel.beacons[${i}].position.easting`);
    validateNonNaN(b.position.northing, `AuPlanOfSurveyInput.parcel.beacons[${i}].position.northing`);
  }
  validateSRID(input.parcel.srid, "AuPlanOfSurveyInput.parcel.srid");
  if (input.parcel.areaHa !== undefined) {
    validateNonNaN(input.parcel.areaHa, "AuPlanOfSurveyInput.parcel.areaHa");
    validatePositive(input.parcel.areaHa, "AuPlanOfSurveyInput.parcel.areaHa");
  }
  validateNonEmptyString(input.surveyor.name, "AuPlanOfSurveyInput.surveyor.name");
  validateNonEmptyString(input.surveyor.regNo, "AuPlanOfSurveyInput.surveyor.regNo");
  validateNonEmptyString(input.surveyor.dateOfSurvey, "AuPlanOfSurveyInput.surveyor.dateOfSurvey");
  const cfg = getCountryConfig("AU");
  const pat = cfg.professionalBody.registrationPattern;
  if (pat && !new RegExp(pat).test(input.surveyor.regNo)) {
    throw new Error(`Validation error: AuPlanOfSurveyInput.surveyor.regNo '${input.surveyor.regNo}' does not match pattern ${pat}.`);
  }
  if (input.planNumber !== undefined) validateNonEmptyString(input.planNumber, "AuPlanOfSurveyInput.planNumber");
  if (input.council !== undefined) validateNonEmptyString(input.council, "AuPlanOfSurveyInput.council");
  if (input.locality !== undefined) validateNonEmptyString(input.locality, "AuPlanOfSurveyInput.locality");
}

// ─── Main ─────────────────────────────────────────────────────────

export async function generateAuPlanOfSurveyPdf(input: AuPlanOfSurveyInput): Promise<AuPlanOfSurveyOutput> {
  validateAuInput(input);

  const cfg = getCountryConfig("AU");
  const planSheet = cfg.planSheet!;
  const { pageWidthPt, pageHeightPt, pageSize, orientation, marginsPt } = getSheetDims(cfg);
  const [marginTopPt, marginRightPt, marginBottomPt, marginLeftPt] = marginsPt;

  const areaHa = input.parcel.areaHa ?? polygonAreaHa(input.parcel.beacons);
  const scale = selectScale(areaHa);

  const pdfDoc = await PDFDocument.create();
  const primaryZone = cfg.geodeticFramework.projectionZones.find((z) => z.srid === cfg.geodeticFramework.primarySRID);
  const inputZone = cfg.geodeticFramework.projectionZones.find((z) => z.srid === input.parcel.srid);
  const crsLabel = inputZone?.name ?? primaryZone?.name ?? cfg.geodeticFramework.datum;
  const sridForSubject = inputZone?.srid ?? cfg.geodeticFramework.primarySRID;
  pdfDoc.setTitle(sanitizeAscii(`${planSheet.planTypeLabel} -- ${input.planNumber ?? "DRAFT"} -- ${crsLabel}`));
  pdfDoc.setAuthor(sanitizeAscii(input.surveyor.name));
  pdfDoc.setSubject(sanitizeAscii(`${planSheet.titleBlockLabel} -- ${planSheet.planTypeLabel} [DRAFT] -- ${crsLabel} (EPSG::${sridForSubject})`));
  pdfDoc.setKeywords(["Australia", "NSW", "Deposited Plan", "GDA2020", "MGA", sanitizeAscii(input.planNumber ?? "DRAFT")]);
  pdfDoc.setProducer("MetaRDU Desktop");
  pdfDoc.setCreator("MetaRDU Desktop -- packages/engine/src/documents/au-plan-of-survey.ts");
  pdfDoc.setCreationDate(new Date());

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);

  // 1. DRAFT watermark behind
  drawDraftWatermark(page, fontBold, pageWidthPt, pageHeightPt);

  // 2. Title block — driven by planSheet.titleBlockLayout.fieldRows
  const titleBlockH = 62 * MM_TO_PT;
  const titleBlockX = marginLeftPt;
  const titleBlockY = pageHeightPt - marginTopPt - titleBlockH;
  const titleBlockW = pageWidthPt - marginLeftPt - marginRightPt;

  // Outer border
  page.drawRectangle({ x: titleBlockX, y: titleBlockY, width: titleBlockW, height: titleBlockH, borderColor: BLACK, borderWidth: 1, color: rgb(1, 1, 1) });
  // Header band — titleBlockLabel + planTypeLabel
  const headerH = 14;
  page.drawRectangle({ x: titleBlockX, y: titleBlockY + titleBlockH - headerH, width: titleBlockW, height: headerH, color: rgb(0.92, 0.92, 0.92), borderColor: BLACK, borderWidth: 0.5 });
  const headerText = sanitizeAscii(`${planSheet.titleBlockLabel} -- ${planSheet.planTypeLabel}`);
  const headerSz = 7;
  const headerW = fontBold.widthOfTextAtSize(headerText, headerSz);
  page.drawText(headerText, { x: titleBlockX + (titleBlockW - headerW) / 2, y: titleBlockY + titleBlockH - headerH + 3.5, size: headerSz, font: fontBold, color: BLACK });
  // Grid: 2 columns x rows per fieldRows (up to 5 rows visible)
  const fieldRows = planSheet.titleBlockLayout.fieldRows;
  const cols = 2;
  const rows = Math.ceil(fieldRows.length / cols);
  const colW = titleBlockW / cols;
  const rowH = (titleBlockH - headerH) / rows;
  // vertical divider
  page.drawLine({ start: { x: titleBlockX + colW, y: titleBlockY }, end: { x: titleBlockX + colW, y: titleBlockY + titleBlockH - headerH }, thickness: 0.5, color: BLACK });
  for (let r = 1; r < rows; r++) {
    page.drawLine({ start: { x: titleBlockX, y: titleBlockY + r * rowH }, end: { x: titleBlockX + titleBlockW, y: titleBlockY + r * rowH }, thickness: 0.4, color: LIGHT_GRAY });
  }
  // Token resolvers for fieldRows
  const tokenMap: Record<string, string> = {
    "{{scale}}": `1:${scale}`,
    "{{date}}": input.surveyor.dateOfSurvey,
    "{{surveyor}}": `${input.surveyor.name} (${input.surveyor.regNo})`,
    "{{crs}}": crsLabel,
    "{{planType}}": planSheet.planTypeLabel,
    "{{title}}": planSheet.titleBlockLabel,
  };
  function resolveToken(v: string | undefined): string {
    if (!v) return "";
    let out = v;
    for (const [tok, val] of Object.entries(tokenMap)) out = out.replace(tok, val);
    return out;
  }
  // Draw fieldRows
  for (let i = 0; i < fieldRows.length; i++) {
    const fr = fieldRows[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = titleBlockX + col * colW + 3;
    const cellY = titleBlockY + (rows - 1 - row) * rowH + 3;
    // label small
    page.drawText(sanitizeAscii(fr.label), { x: cellX, y: cellY + rowH - 8, size: 5, font: fontBold, color: BLACK });
    // value mapping from input or token
    let value = resolveToken(fr.value);
    if (!value) {
      // derive from input fields by label
      const lbl = fr.label.toLowerCase();
      if (lbl.includes("plan number")) value = input.planNumber ?? "(to be assigned)";
      else if (lbl.includes("edition")) value = input.edition ?? "1";
      else if (lbl.includes("council")) value = input.council ?? "--";
      else if (lbl.includes("suburb") || lbl.includes("locality")) value = input.locality ?? "--";
      else if (lbl.includes("parish")) value = input.parish ?? "--";
      else if (lbl.includes("county")) value = input.county ?? "--";
      else if (lbl.includes("local government") || lbl.includes("lga")) value = input.lga ?? input.council ?? "--";
      else if (lbl.includes("surveyor") || lbl.includes("bossi")) value = `${input.surveyor.name} (${input.surveyor.regNo})`;
      else value = "";
    }
    const vSan = sanitizeAscii(value);
    const maxW = colW - 6;
    let disp = vSan;
    let sz = 6.5;
    if (font.widthOfTextAtSize(disp, sz) > maxW) {
      while (disp.length > 3 && font.widthOfTextAtSize(disp + "...", sz) > maxW) disp = disp.slice(0, -1);
      disp = disp + "...";
    }
    page.drawText(disp, { x: cellX, y: cellY + 2, size: sz, font, color: BLACK });
  }

  // 3. Plan area
  const coordScheduleH = 44 * MM_TO_PT;
  const planAreaX = marginLeftPt;
  const planAreaY = marginBottomPt + coordScheduleH + 28;
  const planAreaW = pageWidthPt - marginLeftPt - marginRightPt;
  const planAreaH = pageHeightPt - marginTopPt - titleBlockH - coordScheduleH - 36 - 18;
  const bounds = parcelBounds(input.parcel.beacons);
  const transform = makePlanTransform(bounds, planAreaX, planAreaY, planAreaW, planAreaH, scale);
  // boundary
  for (let i = 0; i < input.parcel.beacons.length; i++) {
    const a = transform(input.parcel.beacons[i]!.position);
    const b = transform(input.parcel.beacons[(i + 1) % input.parcel.beacons.length]!.position);
    page.drawLine({ start: a, end: b, thickness: 0.5 * MM_TO_PT, color: BLACK });
  }
  // beacons
  for (const b of input.parcel.beacons) {
    const p = transform(b.position);
    page.drawCircle({ x: p.x, y: p.y, size: 1.2, color: BLACK });
    page.drawText(sanitizeAscii(b.label), { x: p.x + 4, y: p.y + 4, size: 7, font: fontBold, color: BLACK });
  }
  // bearing/distance
  for (let i = 0; i < input.parcel.beacons.length; i++) {
    const a = input.parcel.beacons[i]!;
    const b = input.parcel.beacons[(i + 1) % input.parcel.beacons.length]!;
    const pa = transform(a.position);
    const pb = transform(b.position);
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    const { str: brgStr } = bearingDMS(a.position, b.position);
    const { str: distStr } = distanceM(a.position, b.position);
    const dx = pb.x - pa.x, dy = pb.y - pa.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) continue;
    const perpX = -dy / len, perpY = dx / len;
    const sBrg = sanitizeAscii(brgStr);
    const sDist = sanitizeAscii(distStr);
    page.drawText(sBrg, { x: mid.x + perpX * 6 - font.widthOfTextAtSize(sBrg, 6) / 2, y: mid.y + perpY * 6, size: 6, font, color: BLACK });
    page.drawText(sDist, { x: mid.x - perpX * 6 - font.widthOfTextAtSize(sDist, 6) / 2, y: mid.y - perpY * 6 - 5, size: 6, font, color: BLACK });
  }
  // area annotation at centroid
  {
    const cx = input.parcel.beacons.reduce((s, b) => s + b.position.easting, 0) / input.parcel.beacons.length;
    const cy = input.parcel.beacons.reduce((s, b) => s + b.position.northing, 0) / input.parcel.beacons.length;
    const center = transform({ easting: cx, northing: cy });
    const areaText = sanitizeAscii(`AREA ${areaHa.toFixed(4)} ha`);
    const w = fontBold.widthOfTextAtSize(areaText, 8);
    page.drawText(areaText, { x: center.x - w / 2, y: center.y, size: 8, font: fontBold, color: BLACK });
  }
  // north arrow top-right
  {
    const naX = planAreaX + planAreaW - 18;
    const naY = planAreaY + planAreaH - 22;
    const h = 15 * MM_TO_PT;
    const w2 = h / 3;
    page.drawLine({ start: { x: naX, y: naY }, end: { x: naX, y: naY + h }, thickness: 1, color: BLACK });
    page.drawLine({ start: { x: naX - w2 / 2, y: naY + h - w2 }, end: { x: naX, y: naY + h }, thickness: 1, color: BLACK });
    page.drawLine({ start: { x: naX + w2 / 2, y: naY + h - w2 }, end: { x: naX, y: naY + h }, thickness: 1, color: BLACK });
    page.drawText("N", { x: naX - font.widthOfTextAtSize("N", 7) / 2, y: naY + h + 3, size: 7, font: fontBold, color: BLACK });
  }
  // scale bar bottom-left
  {
    const sx = planAreaX + 6;
    const sy = planAreaY + 6;
    const totalMm = (100 * 1000) / scale;
    const totalPt = totalMm * MM_TO_PT;
    const segLen = totalPt / 4;
    for (let i = 0; i < 4; i++) {
      const x = sx + i * segLen;
      if (i % 2 === 0) page.drawRectangle({ x, y: sy, width: segLen, height: 5, color: BLACK, borderColor: BLACK, borderWidth: 0.4 });
      else page.drawRectangle({ x, y: sy, width: segLen, height: 5, color: rgb(1, 1, 1), borderColor: BLACK, borderWidth: 0.4 });
    }
    page.drawText("0", { x: sx - 2, y: sy - 9, size: 6, font, color: BLACK });
    page.drawText("100 m", { x: sx + totalPt - font.widthOfTextAtSize("100 m", 6), y: sy - 9, size: 6, font, color: BLACK });
    page.drawText(sanitizeAscii(`Scale 1:${scale}`), { x: sx, y: sy - 18, size: 6, font, color: BLACK });
  }

  // 4. Coordinate schedule
  {
    const csX = marginLeftPt;
    const csY = marginBottomPt + 22;
    const csW = pageWidthPt - marginLeftPt - marginRightPt;
    const csH = coordScheduleH;
    const headerH = 11;
    const zone = cfg.geodeticFramework.projectionZones.find((z) => z.srid === input.parcel.srid);
    const headerLabel = zone ? `${zone.name} (EPSG::${String(zone.srid).padStart(5, "0")})` : `SRID ${input.parcel.srid}`;
    const coordHeader = sanitizeAscii(`COORDINATES: ${headerLabel}`);
    page.drawRectangle({ x: csX, y: csY + csH - headerH, width: csW, height: headerH, color: rgb(0.92, 0.92, 0.92), borderColor: BLACK, borderWidth: 0.5 });
    page.drawText(coordHeader, { x: csX + 4, y: csY + csH - headerH + 2.5, size: 6, font: fontBold, color: BLACK });
    page.drawRectangle({ x: csX, y: csY, width: csW, height: csH - headerH, borderColor: BLACK, borderWidth: 0.7, color: rgb(1, 1, 1) });
    const colWidths = [0.18, 0.27, 0.27, 0.28].map((p) => p * csW);
    const headers2 = ["Beacon", "Easting (MGA)", "Northing (MGA)", "Description"];
    const tableTop = csY + csH - headerH;
    const rowH = 9;
    let cx = csX;
    for (let i = 0; i < headers2.length; i++) {
      page.drawText(sanitizeAscii(headers2[i]!), { x: cx + 3, y: tableTop - rowH + 2, size: 5.5, font: fontBold, color: BLACK });
      cx += colWidths[i]!;
    }
    page.drawLine({ start: { x: csX, y: tableTop - rowH }, end: { x: csX + csW, y: tableTop - rowH }, thickness: 0.5, color: BLACK });
    cx = csX;
    for (let i = 0; i < colWidths.length - 1; i++) {
      cx += colWidths[i]!;
      page.drawLine({ start: { x: cx, y: csY }, end: { x: cx, y: tableTop }, thickness: 0.4, color: BLACK });
    }
    for (let r = 0; r < input.parcel.beacons.length; r++) {
      if ((r + 1) * rowH > csH - headerH - rowH) break;
      const b = input.parcel.beacons[r]!;
      const rowY = tableTop - rowH - (r + 1) * rowH;
      const rowData = [sanitizeAscii(b.label), b.position.easting.toFixed(3), b.position.northing.toFixed(3), sanitizeAscii(b.description)];
      cx = csX;
      for (let i = 0; i < rowData.length; i++) {
        page.drawText(rowData[i]!, { x: cx + 3, y: rowY + 2, size: 5.5, font, color: BLACK });
        cx += colWidths[i]!;
      }
    }
  }

  // 5. Certification block (from planSheet.titleBlockLayout.certification)
  {
    const cert = planSheet.titleBlockLayout.certification;
    if (cert) {
      const certText = sanitizeAscii(cert.lines.join(" "));
      const y = marginBottomPt + 10;
      page.drawText(sanitizeAscii(cert.heading), { x: marginLeftPt, y: y + 8, size: 6, font: fontBold, color: BLACK });
      // wrap lines ~ 105 chars
      const words = certText.split(/\s+/);
      let line = "";
      let lineY = y;
      const maxChars = pageSize === "A1" ? 140 : 100;
      for (const w of words) {
        if ((line + " " + w).trim().length > maxChars) {
          page.drawText(line, { x: marginLeftPt, y: lineY, size: 5.5, font, color: BLACK });
          lineY -= 7;
          line = w;
        } else line = line ? line + " " + w : w;
      }
      if (line) page.drawText(line, { x: marginLeftPt, y: lineY, size: 5.5, font, color: BLACK });
    }
    // seal placeholder
    const seal = planSheet.titleBlockLayout.seal;
    if (seal.position !== "none") {
      const cap = sanitizeAscii(seal.caption ?? "REGISTERED SURVEYOR");
      page.drawText(sanitizeAscii(`Seal: [${cap}]`), { x: pageWidthPt - marginRightPt - 80, y: marginBottomPt + 10, size: 5, font: fontOblique, color: rgb(0.4, 0.4, 0.4) });
    }
    // statutory footer lines
    const sfl = planSheet.titleBlockLayout.statutoryFooterLines ?? [];
    // drawn at very bottom above verification footer — small
    let fy = marginBottomPt + 2;
    for (const l of sfl.slice(0, 1)) {
      page.drawText(sanitizeAscii(l), { x: marginLeftPt, y: fy, size: 4.5, font: fontOblique, color: rgb(0.45, 0.45, 0.45) });
      fy -= 5;
    }
  }

  // 6. Footer note from planSheet.footerNote
  {
    const footerNote = sanitizeAscii(planSheet.footerNote);
    // wrap and draw just above verification footer
    const y = marginBottomPt + 16;
    // only first line for compact
    const fw = fontOblique.widthOfTextAtSize(footerNote, 5);
    if (fw < pageWidthPt - marginLeftPt - marginRightPt) {
      page.drawText(footerNote, { x: marginLeftPt, y, size: 5, font: fontOblique, color: rgb(0.35, 0.35, 0.35) });
    } else {
      // truncated
      let disp = footerNote;
      const maxW = pageWidthPt - marginLeftPt - marginRightPt;
      while (disp.length > 3 && fontOblique.widthOfTextAtSize(disp + "...", 5) > maxW) disp = disp.slice(0, -1);
      page.drawText(disp + "...", { x: marginLeftPt, y, size: 5, font: fontOblique, color: rgb(0.35, 0.35, 0.35) });
    }
  }

  // 7. Verification footer with HK count
  drawVerificationFooter(page, font, pageWidthPt, marginBottomPt, marginLeftPt, marginRightPt, HK_ITEM_COUNT, cfg);

  const pdfBytes = await pdfDoc.save();
  return { pdfBytes, hasDraftWatermark: true, hkItemCount: HK_ITEM_COUNT, pageSize, orientation, srid: input.parcel.srid };
}
