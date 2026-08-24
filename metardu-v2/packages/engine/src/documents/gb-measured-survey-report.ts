/**
 * GB Measured Survey Report — RICS-compliant statutory DRAFT renderer.
 *
 * Produces a DRAFT PDF on the sheet/orientation/CRS from
 * `getCountryConfig("GB").planSheet` plus the RICS report field set.
 * Includes mandatory HMLR disclaimer and OSTN15 coarse-Helmert warning.
 *
 * # Source spec
 *
 * `docs/regulatory-sources/uk/measured-survey-spec.md` per invariant B2.
 * HK items = 11.
 *
 * Sources: RICS Measured Surveys 3rd ed. [HK], LRA 2002 s.60/s.66 [HK],
 * HMLR PG40 [HK], OSGB36/BNG EPSG:27700, OSTN15 EPSG:9704, country-config GB.
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

export interface GbPoint {
  pointId: string;
  easting: number;
  northing: number;
  level?: number;
  description?: string;
}

export interface GbSurveyor {
  name: string;
  ricsRegNo: string;
  dateOfSurvey: string;
}

export interface GbMeasuredSurveyReportInput {
  projectName: string;
  client: string;
  surveyor: GbSurveyor;
  surveyClass: "A" | "B" | "C";
  scale: number;
  points: GbPoint[];
  srid: number;
  titleNumber?: string;
  propertyAddress?: string;
  osMapReference?: string;
}

export interface GbMeasuredSurveyReportOutput {
  pdfBytes: Uint8Array;
  hasDraftWatermark: true;
  hkItemCount: number;
  pageSize: string;
  orientation: string;
  srid: number;
}

// ─── Sheet helpers ────────────────────────────────────────────────

const SHEET_SIZES_MM: Record<string, { w: number; h: number }> = {
  a0: { w: 841, h: 1189 },
  a1: { w: 594, h: 841 },
  a2: { w: 420, h: 594 },
  a3: { w: 297, h: 420 },
  a4: { w: 210, h: 297 },
  a5: { w: 148, h: 210 },
};

const MM_TO_PT = 2.834645669;
const HK_ITEM_COUNT = 11;
const BLACK = rgb(0, 0, 0);
const DRAFT_RED = rgb(0.75, 0.15, 0.15);

function sanitizeAscii(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x00b0 || code === 0x00ba) out += "d";
    else if (code === 8211 || code === 8212) out += "-";
    else if (code === 8220 || code === 8221) out += '"';
    else if (code === 8216 || code === 8217) out += "'";
    else if (code === 0x2014) out += "-";
    else if (code >= 32 && code < 127) out += s[i]!;
    else if (code >= 128) out += "?";
    else out += s[i]!;
  }
  return out;
}

function getSheetDims(cfg: ReturnType<typeof getCountryConfig>) {
  const planSheet = cfg.planSheet!;
  const key = planSheet.defaultSheetSize.toLowerCase();
  const dims = SHEET_SIZES_MM[key];
  if (!dims) throw new Error(`Unknown sheet size ${planSheet.defaultSheetSize}`);
  let wMm = dims.w, hMm = dims.h;
  if (planSheet.defaultOrientation === "landscape") [wMm, hMm] = [hMm, wMm];
  const doc = cfg.statutoryDocuments.find((d) => d.docType === "Title Plan" || d.docType === "Measured Survey Report");
  // Use Measured Survey Report margins if available
  const msDoc = cfg.statutoryDocuments.find((d) => d.docType === "Measured Survey Report");
  const marginsMm = (msDoc?.margins_mm ?? doc?.margins_mm ?? [25, 25, 25, 25]) as [number, number, number, number];
  return { pageWidthPt: wMm * MM_TO_PT, pageHeightPt: hMm * MM_TO_PT, pageSize: planSheet.defaultSheetSize.toUpperCase(), orientation: planSheet.defaultOrientation, marginsPt: marginsMm.map((m) => m * MM_TO_PT) as [number, number, number, number] };
}

function drawDraftWatermark(page: PDFPage, font: PDFFont, pageWidthPt: number, pageHeightPt: number) {
  const text = sanitizeAscii("DRAFT -- NOT FOR LODGEMENT (HK-PENDING-SPECIMEN)");
  const size = pageWidthPt > 500 ? 42 : 36;
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: pageWidthPt / 2 - w / 2, y: pageHeightPt / 2, size, font, color: DRAFT_RED, opacity: 0.15, rotate: degrees(45) });
}

function drawVerificationFooter(page: PDFPage, font: PDFFont, pageWidthPt: number, marginBottomPt: number, marginLeftPt: number, marginRightPt: number, hkCount: number) {
  const lines = [
    sanitizeAscii(`Layout cites: RICS Measured Surveys 3rd ed. & LRA 2002 s.60/s.66 & HMLR PG40 -- OSGB36/BNG (EPSG::27700) -- OSTN15 coarse [HK] -- HK items: ${hkCount} pending RICS specimen.`),
    sanitizeAscii(`Title Plan is HMLR-produced; this report is the surveyor deliverable. [DRAFT]`),
    sanitizeAscii(`DRAFT watermark -- NOT FOR LODGEMENT. [HK-PENDING-SPECIMEN] Source: measured-survey-spec.md`),
  ];
  const size = 5.5, lineH = size * 1.35;
  const xM = marginLeftPt;
  const totalH = lines.length * lineH;
  const y0 = marginBottomPt - 4 - totalH;
  if (y0 < 0) return;
  page.drawLine({ start: { x: xM, y: y0 + totalH + 2 }, end: { x: pageWidthPt - marginRightPt, y: y0 + totalH + 2 }, thickness: 0.25, color: rgb(0.55, 0.55, 0.55) });
  for (let i = 0; i < lines.length; i++) page.drawText(lines[i]!, { x: xM, y: y0 + (lines.length - 1 - i) * lineH, size, font, color: rgb(0.45, 0.45, 0.45) });
}

function computeBounds(points: GbPoint[]) {
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const p of points) {
    if (p.easting < minE) minE = p.easting;
    if (p.easting > maxE) maxE = p.easting;
    if (p.northing < minN) minN = p.northing;
    if (p.northing > maxN) maxN = p.northing;
  }
  const padE = Math.max((maxE - minE) * 0.1, 10);
  const padN = Math.max((maxN - minN) * 0.1, 10);
  return { minE: minE - padE, maxE: maxE + padE, minN: minN - padN, maxN: maxN + padN, width: (maxE - minE) + 2 * padE, height: (maxN - minN) + 2 * padN };
}

function validateGbInput(input: GbMeasuredSurveyReportInput): void {
  validateNonEmptyString(input.projectName, "GbMeasuredSurveyReportInput.projectName");
  validateNonEmptyString(input.client, "GbMeasuredSurveyReportInput.client");
  validateNonEmptyString(input.surveyor.name, "GbMeasuredSurveyReportInput.surveyor.name");
  validateNonEmptyString(input.surveyor.ricsRegNo, "GbMeasuredSurveyReportInput.surveyor.ricsRegNo");
  validateNonEmptyString(input.surveyor.dateOfSurvey, "GbMeasuredSurveyReportInput.surveyor.dateOfSurvey");
  const cfg = getCountryConfig("GB");
  const pat = cfg.professionalBody.registrationPattern;
  if (pat && !new RegExp(pat).test(input.surveyor.ricsRegNo)) throw new Error(`Validation error: GbMeasuredSurveyReportInput.surveyor.ricsRegNo '${input.surveyor.ricsRegNo}' does not match pattern ${pat}.`);
  if (!["A", "B", "C"].includes(input.surveyClass)) throw new Error(`Validation error: surveyClass must be A, B, or C, got ${input.surveyClass}`);
  validateNonNaN(input.scale, "GbMeasuredSurveyReportInput.scale");
  validatePositive(input.scale, "GbMeasuredSurveyReportInput.scale");
  if (!Array.isArray(input.points) || input.points.length === 0) throw new Error("Validation error: GbMeasuredSurveyReportInput.points must have at least 1 point.");
  for (let i = 0; i < input.points.length; i++) {
    const p = input.points[i]!;
    validateNonEmptyString(p.pointId, `GbMeasuredSurveyReportInput.points[${i}].pointId`);
    validateNonNaN(p.easting, `GbMeasuredSurveyReportInput.points[${i}].easting`);
    validateNonNaN(p.northing, `GbMeasuredSurveyReportInput.points[${i}].northing`);
    if (p.level !== undefined) validateNonNaN(p.level, `GbMeasuredSurveyReportInput.points[${i}].level`);
  }
  validateSRID(input.srid, "GbMeasuredSurveyReportInput.srid");
  if (input.titleNumber !== undefined) validateNonEmptyString(input.titleNumber, "GbMeasuredSurveyReportInput.titleNumber");
  if (input.propertyAddress !== undefined) validateNonEmptyString(input.propertyAddress, "GbMeasuredSurveyReportInput.propertyAddress");
  if (input.osMapReference !== undefined) validateNonEmptyString(input.osMapReference, "GbMeasuredSurveyReportInput.osMapReference");
}

export async function generateGbMeasuredSurveyReportPdf(input: GbMeasuredSurveyReportInput): Promise<GbMeasuredSurveyReportOutput> {
  validateGbInput(input);

  const cfg = getCountryConfig("GB");
  const planSheet = cfg.planSheet!;
  const { pageWidthPt, pageHeightPt, pageSize, orientation, marginsPt } = getSheetDims(cfg);
  const [marginTopPt, marginRightPt, marginBottomPt, marginLeftPt] = marginsPt;

  const pdfDoc = await PDFDocument.create();
  const primaryZone = cfg.geodeticFramework.projectionZones.find((z) => z.srid === cfg.geodeticFramework.primarySRID);
  const inputZone = cfg.geodeticFramework.projectionZones.find((z) => z.srid === input.srid);
  const crsLabel = inputZone?.name ?? primaryZone?.name ?? cfg.geodeticFramework.datum;
  const sridForSubject = inputZone?.srid ?? cfg.geodeticFramework.primarySRID;
  pdfDoc.setTitle(sanitizeAscii(`RICS Measured Survey Report -- ${input.projectName} -- ${crsLabel}`));
  pdfDoc.setAuthor(sanitizeAscii(input.surveyor.name));
  pdfDoc.setSubject(sanitizeAscii(`RICS Measured Surveys 3rd ed. -- ${crsLabel} (EPSG::${sridForSubject}) -- Title Plan is HMLR-produced; this report is the surveyor deliverable [DRAFT]`));
  pdfDoc.setKeywords(["United Kingdom", "RICS", "Measured Survey", "OSGB36", "BNG", sanitizeAscii(input.projectName), "HMLR"]);
  pdfDoc.setProducer("MetaRDU Desktop");
  pdfDoc.setCreator("MetaRDU Desktop -- packages/engine/src/documents/gb-measured-survey-report.ts");
  pdfDoc.setCreationDate(new Date());

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);

  drawDraftWatermark(page, fontBold, pageWidthPt, pageHeightPt);

  // Title block — override HMLR planSheet with RICS report fields per spec [HK divergence]
  const titleBlockH = 58 * MM_TO_PT;
  const titleBlockX = marginLeftPt;
  const titleBlockY = pageHeightPt - marginTopPt - titleBlockH;
  const titleBlockW = pageWidthPt - marginLeftPt - marginRightPt;

  page.drawRectangle({ x: titleBlockX, y: titleBlockY, width: titleBlockW, height: titleBlockH, borderColor: BLACK, borderWidth: 1, color: rgb(1, 1, 1) });
  const headerH = 13;
  page.drawRectangle({ x: titleBlockX, y: titleBlockY + titleBlockH - headerH, width: titleBlockW, height: headerH, color: rgb(0.92, 0.92, 0.92), borderColor: BLACK, borderWidth: 0.5 });
  const headerText = sanitizeAscii(`RICS MEASURED SURVEY REPORT -- ${planSheet.titleBlockLabel}`);
  const headerSz = 6;
  const hw = fontBold.widthOfTextAtSize(headerText, headerSz);
  page.drawText(headerText, { x: titleBlockX + (titleBlockW - hw) / 2, y: titleBlockY + titleBlockH - headerH + 3, size: headerSz, font: fontBold, color: BLACK });

  // RICS report field grid: 3 columns x 3 rows (9 cells)
  const cols = 3;
  const colsW = titleBlockW / cols;
  const rows = 3;
  const rowH = (titleBlockH - headerH) / rows;
  for (let c = 1; c < cols; c++) page.drawLine({ start: { x: titleBlockX + c * colsW, y: titleBlockY }, end: { x: titleBlockX + c * colsW, y: titleBlockY + titleBlockH - headerH }, thickness: 0.5, color: BLACK });
  for (let r = 1; r < rows; r++) page.drawLine({ start: { x: titleBlockX, y: titleBlockY + r * rowH }, end: { x: titleBlockX + titleBlockW, y: titleBlockY + r * rowH }, thickness: 0.4, color: rgb(0.85, 0.85, 0.85) });

  const ricsFields: Array<{ label: string; value: string }> = [
    { label: "PROJECT NAME", value: input.projectName },
    { label: "CLIENT", value: input.client },
    { label: "SURVEYOR (RICS)", value: `${input.surveyor.name} -- RICS ${input.surveyor.ricsRegNo}` },
    { label: "RICS REG. NO.", value: input.surveyor.ricsRegNo },
    { label: "DATE OF SURVEY", value: input.surveyor.dateOfSurvey },
    { label: "SURVEY CLASSIFICATION (A/B/C)", value: `Class ${input.surveyClass}` },
    { label: "SCALE", value: `1:${input.scale}` },
    { label: "CRS", value: crsLabel },
    { label: "TITLE NUMBER [HMLR]", value: input.titleNumber ?? "(none -- HMLR Title Plan separate)" },
  ];

  for (let i = 0; i < ricsFields.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = titleBlockX + col * colsW + 3;
    const cellY = titleBlockY + (rows - 1 - row) * rowH + 3;
    const f = ricsFields[i]!;
    page.drawText(sanitizeAscii(f.label), { x: cellX, y: cellY + rowH - 7, size: 4.5, font: fontBold, color: rgb(0.4, 0.4, 0.4) });
    let disp = sanitizeAscii(f.value);
    const maxW = colsW - 6;
    let sz = 6;
    if (font.widthOfTextAtSize(disp, sz) > maxW) {
      while (disp.length > 3 && font.widthOfTextAtSize(disp + "...", sz) > maxW) disp = disp.slice(0, -1);
      disp = disp + "...";
    }
    page.drawText(disp, { x: cellX, y: cellY + 1, size: sz, font, color: BLACK });
  }

  // HMLR disclaimer — mandatory footer line just below title block (readiness §6)
  {
    const discY = titleBlockY - 10;
    const discText = sanitizeAscii("Title Plan is HMLR-produced; this report is the surveyor deliverable.");
    page.drawText(discText, { x: titleBlockX, y: discY, size: 6, font: fontBold, color: rgb(0.35, 0.35, 0.35) });
    // OSTN15 warning
    const ostnText = sanitizeAscii("ETRS89 -> OSGB36 Helmert (7-param, EPSG:27700) is coarse; survey-grade requires OSTN15 grid (EPSG:9704) [HK-PENDING-OSTN15].");
    page.drawText(ostnText, { x: titleBlockX, y: discY - 8, size: 5, font: fontOblique, color: rgb(0.55, 0.15, 0.15) });
  }

  // Plan area — points
  const coordScheduleH = 38 * MM_TO_PT;
  const planAreaX = marginLeftPt;
  const planAreaY = marginBottomPt + coordScheduleH + 30;
  const planAreaW = pageWidthPt - marginLeftPt - marginRightPt;
  const planAreaH = pageHeightPt - marginTopPt - titleBlockH - coordScheduleH - 52;

  const bounds = computeBounds(input.points);
  // Simple fit transform
  const scaleE = planAreaW / bounds.width;
  const scaleN = planAreaH / bounds.height;
  const fitScale = Math.min(scaleE, scaleN);
  const contentW = bounds.width * fitScale;
  const contentH = bounds.height * fitScale;
  const offsetX = planAreaX + (planAreaW - contentW) / 2;
  const offsetY = planAreaY + (planAreaH - contentH) / 2;
  const transform = (e: number, n: number) => ({
    x: offsetX + (e - bounds.minE) * fitScale,
    y: offsetY + (n - bounds.minN) * fitScale,
  });

  // plan area border
  page.drawRectangle({ x: planAreaX, y: planAreaY, width: planAreaW, height: planAreaH, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.4, color: rgb(1, 1, 1) });

  for (const p of input.points) {
    const pos = transform(p.easting, p.northing);
    page.drawLine({ start: { x: pos.x - 1.5, y: pos.y }, end: { x: pos.x + 1.5, y: pos.y }, thickness: 0.5, color: BLACK });
    page.drawLine({ start: { x: pos.x, y: pos.y - 1.5 }, end: { x: pos.x, y: pos.y + 1.5 }, thickness: 0.5, color: BLACK });
    page.drawText(sanitizeAscii(p.pointId), { x: pos.x + 3, y: pos.y + 3, size: 6, font, color: BLACK });
    if (p.level !== undefined) page.drawText(sanitizeAscii(`${p.level.toFixed(2)}`), { x: pos.x + 3, y: pos.y - 5, size: 5, font, color: rgb(0.5, 0.5, 0.5) });
  }
  // north arrow
  {
    const naX = planAreaX + planAreaW - 16;
    const naY = planAreaY + planAreaH - 20;
    const h = 14;
    const w2 = h / 3;
    page.drawLine({ start: { x: naX, y: naY }, end: { x: naX, y: naY + h }, thickness: 1, color: BLACK });
    page.drawLine({ start: { x: naX - w2 / 2, y: naY + h - w2 }, end: { x: naX, y: naY + h }, thickness: 1, color: BLACK });
    page.drawLine({ start: { x: naX + w2 / 2, y: naY + h - w2 }, end: { x: naX, y: naY + h }, thickness: 1, color: BLACK });
    page.drawText("N", { x: naX - font.widthOfTextAtSize("N", 6) / 2, y: naY + h + 2, size: 6, font: fontBold, color: BLACK });
  }
  {
    const sx = planAreaX + 6;
    const sy = planAreaY + 6;
    const totalMm = (50 * 1000) / input.scale;
    const totalPt = totalMm * MM_TO_PT;
    const segLen = totalPt / 4;
    for (let i = 0; i < 4; i++) {
      const x = sx + i * segLen;
      if (i % 2 === 0) page.drawRectangle({ x, y: sy, width: segLen, height: 4, color: BLACK, borderColor: BLACK, borderWidth: 0.3 });
      else page.drawRectangle({ x, y: sy, width: segLen, height: 4, color: rgb(1, 1, 1), borderColor: BLACK, borderWidth: 0.3 });
    }
    page.drawText("0", { x: sx - 2, y: sy - 8, size: 5, font, color: BLACK });
    const lbl = "50 m";
    page.drawText(lbl, { x: sx + totalPt - font.widthOfTextAtSize(lbl, 5), y: sy - 8, size: 5, font, color: BLACK });
    page.drawText(sanitizeAscii(`Scale 1:${input.scale}`), { x: sx, y: sy - 16, size: 5, font, color: BLACK });
  }

  // Coordinate schedule
  {
    const csX = marginLeftPt;
    const csY = marginBottomPt + 22;
    const csW = pageWidthPt - marginLeftPt - marginRightPt;
    const csH = coordScheduleH;
    const headerH = 10;
    const zone = cfg.geodeticFramework.projectionZones.find((z) => z.srid === input.srid);
    const headerLabel = zone ? `${zone.name} (EPSG::${String(zone.srid).padStart(5, "0")})` : `SRID ${input.srid}`;
    const coordHeader = sanitizeAscii(`COORDINATE SCHEDULE -- ${headerLabel}`);
    page.drawRectangle({ x: csX, y: csY + csH - headerH, width: csW, height: headerH, color: rgb(0.92, 0.92, 0.92), borderColor: BLACK, borderWidth: 0.5 });
    page.drawText(coordHeader, { x: csX + 4, y: csY + csH - headerH + 2, size: 5.5, font: fontBold, color: BLACK });
    page.drawRectangle({ x: csX, y: csY, width: csW, height: csH - headerH, borderColor: BLACK, borderWidth: 0.7, color: rgb(1, 1, 1) });
    const colWidths = [0.14, 0.24, 0.24, 0.14, 0.24].map((p) => p * csW);
    const headers2 = ["ID", "Easting (BNG)", "Northing (BNG)", "Level", "Description"];
    const tableTop = csY + csH - headerH;
    const rowH = 8;
    let cx = csX;
    for (let i = 0; i < headers2.length; i++) { page.drawText(sanitizeAscii(headers2[i]!), { x: cx + 3, y: tableTop - rowH + 2, size: 5, font: fontBold, color: BLACK }); cx += colWidths[i]!; }
    page.drawLine({ start: { x: csX, y: tableTop - rowH }, end: { x: csX + csW, y: tableTop - rowH }, thickness: 0.5, color: BLACK });
    cx = csX; for (let i = 0; i < colWidths.length - 1; i++) { cx += colWidths[i]!; page.drawLine({ start: { x: cx, y: csY }, end: { x: cx, y: tableTop }, thickness: 0.4, color: BLACK }); }
    const maxRows = Math.floor((csH - headerH - rowH) / rowH);
    for (let r = 0; r < Math.min(input.points.length, maxRows); r++) {
      const p = input.points[r]!;
      const rowY = tableTop - (r + 2) * rowH;
      const rowData = [sanitizeAscii(p.pointId), p.easting.toFixed(3), p.northing.toFixed(3), p.level !== undefined ? p.level.toFixed(2) : "--", sanitizeAscii(p.description ?? "")];
      cx = csX; for (let i = 0; i < rowData.length; i++) { page.drawText(rowData[i]!, { x: cx + 3, y: rowY + 2, size: 5, font, color: BLACK }); cx += colWidths[i]!; }
    }
  }

  // Certification + GENERAL BOUNDARIES from planSheet
  {
    const cert = planSheet.titleBlockLayout.certification;
    if (cert) {
      const y = marginBottomPt + 10;
      page.drawText(sanitizeAscii(cert.heading), { x: marginLeftPt, y: y + 7, size: 5.5, font: fontBold, color: BLACK });
      const lines = cert.lines.map((l) => sanitizeAscii(l));
      let ly = y;
      for (const l of lines.slice(0, 1)) {
        // first line only for compact A4
        page.drawText(l, { x: marginLeftPt, y: ly, size: 4.5, font, color: rgb(0.3, 0.3, 0.3) });
        ly -= 6;
      }
    }
    // Crown copyright footer line
    const sfl = planSheet.titleBlockLayout.statutoryFooterLines ?? [];
    if (sfl.length > 0) {
      const y = marginBottomPt + 2;
      const txt = sanitizeAscii(sfl[0]! + " " + (sfl[1] ?? ""));
      const maxW = pageWidthPt - marginLeftPt - marginRightPt;
      let disp = txt;
      while (disp.length > 3 && fontOblique.widthOfTextAtSize(disp, 4.5) > maxW) disp = disp.slice(0, -1);
      if (disp.length < txt.length) disp = disp + "...";
      page.drawText(disp, { x: marginLeftPt, y, size: 4.5, font: fontOblique, color: rgb(0.35, 0.35, 0.35) });
    }
    // RICS compliance line
    {
      const y = marginBottomPt + 14;
      const comp = sanitizeAscii(`This survey was conducted per RICS Measured Surveys 3rd ed. Surveyor: ${input.surveyor.name} (RICS ${input.surveyor.ricsRegNo}) Date: ${input.surveyor.dateOfSurvey} Class: ${input.surveyClass}. [HK]`);
      const maxW = pageWidthPt - marginLeftPt - marginRightPt;
      let disp = comp;
      while (disp.length > 3 && font.widthOfTextAtSize(disp, 5) > maxW) disp = disp.slice(0, -1);
      if (disp.length < comp.length) disp = disp + "...";
      page.drawText(disp, { x: marginLeftPt, y, size: 5, font, color: rgb(0.4, 0.4, 0.4) });
    }
  }

  drawVerificationFooter(page, font, pageWidthPt, marginBottomPt, marginLeftPt, marginRightPt, HK_ITEM_COUNT);

  const pdfBytes = await pdfDoc.save();
  return { pdfBytes, hasDraftWatermark: true, hkItemCount: HK_ITEM_COUNT, pageSize, orientation, srid: input.srid };
}
