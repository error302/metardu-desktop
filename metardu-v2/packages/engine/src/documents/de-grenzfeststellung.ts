/**
 * DE Grenzfeststellung — Niederschrift uber die Grenzfeststellung renderer.
 *
 * DRAFT PDF on sheet/orientation/CRS from `getCountryConfig("DE").planSheet`
 * and `geodeticFramework`. Includes AdV/ETRS89 framework note and DHDN->ETRS89
 * NTv2 TODO footer (DHDN verified in Task 2 but grid still pending).
 *
 * # Source spec
 *
 * `docs/regulatory-sources/de/grenzfeststellung-spec.md` per invariant B2.
 * HK items = 10. DHDN Helmert EPSG:1777 verified per Position Vector; NTv2 BeTA2007 grid = [HK-PENDING-NTv2].
 *
 * Sources: VermKatG (state) [HK], AdV ETRS89/UTM + ALKIS [HK], EPSG:25832/25833/31467/1777, country-config DE.
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
  validateSRID,
  validatePositive,
} from "../workflows/validation.js";

// ─── Types ────────────────────────────────────────────────────────

export interface DePoint {
  easting: number;
  northing: number;
}

export interface DeBeacon {
  label: string;
  position: DePoint;
  description: string;
}

export interface DeParcel {
  beacons: DeBeacon[];
  areaHa?: number;
  srid: number;
}

export interface DeSurveyor {
  name: string;
  regNo: string;
  date: string;
}

export interface DeGrenzfeststellungInput {
  parcel: DeParcel;
  surveyor: DeSurveyor;
  gemarkung?: string;
  flur?: string;
  flurstueckNr?: string;
  gemeinde?: string;
  landkreis?: string;
  bundesland?: string;
}

export interface DeGrenzfeststellungOutput {
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
const HK_ITEM_COUNT = 10;
const BLACK = rgb(0, 0, 0);
const DRAFT_RED = rgb(0.75, 0.15, 0.15);
const LIGHT_GRAY = rgb(0.85, 0.85, 0.85);

function sanitizeAscii(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x00b0 || code === 0x00ba) out += "d";
    else if (code === 8211 || code === 8212) out += "-";
    else if (code === 8220 || code === 8221) out += '"';
    else if (code === 8216 || code === 8217) out += "'";
    else if (code === 0x2014) out += "-";
    else if (code === 0xe4 || code === 0xc4) out += "ae"; // äÄ
    else if (code === 0xf6 || code === 0xd6) out += "oe"; // öÖ
    else if (code === 0xfc || code === 0xdc) out += "ue"; // üÜ
    else if (code === 0xdf) out += "ss"; // ß
    else if (code >= 32 && code < 127) out += s[i]!;
    else if (code >= 128) out += "?";
    else out += s[i]!;
  }
  return out;
}

function selectScale(areaHa: number): number {
  // DE boundary sketches: 1:250 urban (<0.5), 1:500 (0.5-5), 1:1000 (>5) — [HK-PENDING-SPECIMEN]
  if (areaHa < 0.5) return 250;
  if (areaHa < 5) return 500;
  return 1000;
}

function bearingDMS(a: DePoint, b: DePoint) {
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

function distanceM(a: DePoint, b: DePoint) {
  const de = b.easting - a.easting;
  const dn = b.northing - a.northing;
  const m = Math.sqrt(de * de + dn * dn);
  return { m, str: `${m.toFixed(3)} m` };
}

function parcelBounds(beacons: DeBeacon[]) {
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
): (p: DePoint) => { x: number; y: number } {
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
  return (p: DePoint) => ({ x: planCenterX + (p.easting - parcelCenterE) * ptPerM, y: planCenterY + (p.northing - parcelCenterN) * ptPerM });
}

function getSheetDims(cfg: ReturnType<typeof getCountryConfig>) {
  const planSheet = cfg.planSheet!;
  const key = planSheet.defaultSheetSize.toLowerCase();
  const dims = SHEET_SIZES_MM[key];
  if (!dims) throw new Error(`Unknown sheet size ${planSheet.defaultSheetSize}`);
  let wMm = dims.w, hMm = dims.h;
  if (planSheet.defaultOrientation === "landscape") [wMm, hMm] = [hMm, wMm];
  const doc = cfg.statutoryDocuments.find((d) => d.docType === "Grenzfeststellung");
  const marginsMm = (doc?.margins_mm ?? [25, 25, 25, 25]) as [number, number, number, number];
  return { pageWidthPt: wMm * MM_TO_PT, pageHeightPt: hMm * MM_TO_PT, pageSize: planSheet.defaultSheetSize.toUpperCase(), orientation: planSheet.defaultOrientation, marginsPt: marginsMm.map((m) => m * MM_TO_PT) as [number, number, number, number] };
}

function drawDraftWatermark(page: PDFPage, font: PDFFont, pageWidthPt: number, pageHeightPt: number) {
  const text = sanitizeAscii("DRAFT -- NOT FOR LODGEMENT (HK-PENDING-SPECIMEN)");
  const size = pageWidthPt > 500 ? 38 : 32;
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: pageWidthPt / 2 - w / 2, y: pageHeightPt / 2, size, font, color: DRAFT_RED, opacity: 0.15, rotate: degrees(45) });
}

function polygonAreaHa(beacons: DeBeacon[]): number {
  if (beacons.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < beacons.length; i++) {
    const j = (i + 1) % beacons.length;
    area += beacons[i]!.position.easting * beacons[j]!.position.northing - beacons[j]!.position.easting * beacons[i]!.position.northing;
  }
  return Math.abs(area) / 2 / 10000;
}

function validateDeInput(input: DeGrenzfeststellungInput): void {
  if (!Array.isArray(input.parcel.beacons) || input.parcel.beacons.length < 3) throw new Error(`Validation error: DeGrenzfeststellungInput.parcel.beacons must have at least 3 beacons, got ${input.parcel.beacons?.length ?? 0}.`);
  for (let i = 0; i < input.parcel.beacons.length; i++) {
    const b = input.parcel.beacons[i]!;
    validateNonEmptyString(b.label, `DeGrenzfeststellungInput.parcel.beacons[${i}].label`);
    validateNonEmptyString(b.description, `DeGrenzfeststellungInput.parcel.beacons[${i}].description`);
    validateNonNaN(b.position.easting, `DeGrenzfeststellungInput.parcel.beacons[${i}].position.easting`);
    validateNonNaN(b.position.northing, `DeGrenzfeststellungInput.parcel.beacons[${i}].position.northing`);
  }
  validateSRID(input.parcel.srid, "DeGrenzfeststellungInput.parcel.srid");
  if (input.parcel.areaHa !== undefined) { validateNonNaN(input.parcel.areaHa, "DeGrenzfeststellungInput.parcel.areaHa"); validatePositive(input.parcel.areaHa, "DeGrenzfeststellungInput.parcel.areaHa"); }
  validateNonEmptyString(input.surveyor.name, "DeGrenzfeststellungInput.surveyor.name");
  validateNonEmptyString(input.surveyor.regNo, "DeGrenzfeststellungInput.surveyor.regNo");
  validateNonEmptyString(input.surveyor.date, "DeGrenzfeststellungInput.surveyor.date");
  const cfg = getCountryConfig("DE");
  const pat = cfg.professionalBody.registrationPattern;
  if (pat && !new RegExp(pat).test(input.surveyor.regNo)) throw new Error(`Validation error: DeGrenzfeststellungInput.surveyor.regNo '${input.surveyor.regNo}' does not match pattern ${pat}.`);
  if (input.gemarkung !== undefined) validateNonEmptyString(input.gemarkung, "DeGrenzfeststellungInput.gemarkung");
  if (input.flur !== undefined) validateNonEmptyString(input.flur, "DeGrenzfeststellungInput.flur");
  if (input.flurstueckNr !== undefined) validateNonEmptyString(input.flurstueckNr, "DeGrenzfeststellungInput.flurstueckNr");
}

export async function generateDeGrenzfeststellungPdf(input: DeGrenzfeststellungInput): Promise<DeGrenzfeststellungOutput> {
  validateDeInput(input);

  const cfg = getCountryConfig("DE");
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
  pdfDoc.setTitle(sanitizeAscii(`Niederschrift ueber die Grenzfeststellung -- ${input.flurstueckNr ?? input.gemarkung ?? "DRAFT"} -- ${crsLabel}`));
  pdfDoc.setAuthor(sanitizeAscii(input.surveyor.name));
  pdfDoc.setSubject(sanitizeAscii(`${planSheet.titleBlockLabel} -- NIEDERSCHRIFT UEBER DIE GRENZFESTSTELLUNG [DRAFT] -- ${crsLabel} (EPSG::${sridForSubject}) -- AdV ETRS89`));
  pdfDoc.setKeywords(["Germany", "DE", "Grenzfeststellung", "ETRS89", "UTM", "AdV", "ALKIS", sanitizeAscii(input.gemarkung ?? "DRAFT")]);
  pdfDoc.setProducer("MetaRDU Desktop");
  pdfDoc.setCreator("MetaRDU Desktop -- packages/engine/src/documents/de-grenzfeststellung.ts");
  pdfDoc.setCreationDate(new Date());

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);

  drawDraftWatermark(page, fontBold, pageWidthPt, pageHeightPt);

  // Title block derived from planSheet.titleBlockLayout.fieldRows
  const titleBlockH = 60 * MM_TO_PT;
  const titleBlockX = marginLeftPt;
  const titleBlockY = pageHeightPt - marginTopPt - titleBlockH;
  const titleBlockW = pageWidthPt - marginLeftPt - marginRightPt;

  page.drawRectangle({ x: titleBlockX, y: titleBlockY, width: titleBlockW, height: titleBlockH, borderColor: BLACK, borderWidth: 1, color: rgb(1, 1, 1) });
  const headerH = 13;
  page.drawRectangle({ x: titleBlockX, y: titleBlockY + titleBlockH - headerH, width: titleBlockW, height: headerH, color: rgb(0.92, 0.92, 0.92), borderColor: BLACK, borderWidth: 0.5 });
  const headerText = sanitizeAscii(`${planSheet.titleBlockLabel} -- NIEDERSCHRIFT UEBER DIE GRENZFESTSTELLUNG`);
  const headerSz = 5.5;
  const hw = fontBold.widthOfTextAtSize(headerText, headerSz);
  // truncate if too wide
  let hDisp = headerText;
  if (hw > titleBlockW - 8) {
    while (hDisp.length > 3 && fontBold.widthOfTextAtSize(hDisp + "...", headerSz) > titleBlockW - 8) hDisp = hDisp.slice(0, -1);
    hDisp = hDisp + "...";
  }
  const hw2 = fontBold.widthOfTextAtSize(hDisp, headerSz);
  page.drawText(hDisp, { x: titleBlockX + (titleBlockW - hw2) / 2, y: titleBlockY + titleBlockH - headerH + 3.5, size: headerSz, font: fontBold, color: BLACK });

  const fieldRows = planSheet.titleBlockLayout.fieldRows;
  const cols = 2;
  const rows = Math.ceil(fieldRows.length / cols);
  const colW = titleBlockW / cols;
  const rowH = (titleBlockH - headerH) / rows;
  page.drawLine({ start: { x: titleBlockX + colW, y: titleBlockY }, end: { x: titleBlockX + colW, y: titleBlockY + titleBlockH - headerH }, thickness: 0.5, color: BLACK });
  for (let r = 1; r < rows; r++) page.drawLine({ start: { x: titleBlockX, y: titleBlockY + r * rowH }, end: { x: titleBlockX + titleBlockW, y: titleBlockY + r * rowH }, thickness: 0.4, color: LIGHT_GRAY });

  const tokenMap: Record<string, string> = {
    "{{scale}}": `1:${scale}`,
    "{{date}}": input.surveyor.date,
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

  for (let i = 0; i < fieldRows.length; i++) {
    const fr = fieldRows[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = titleBlockX + col * colW + 3;
    const cellY = titleBlockY + (rows - 1 - row) * rowH + 3;
    page.drawText(sanitizeAscii(fr.label), { x: cellX, y: cellY + rowH - 7, size: 4.5, font: fontBold, color: BLACK });
    let value = resolveToken(fr.value);
    if (!value) {
      const lbl = fr.label.toLowerCase();
      if (lbl.includes("gemarkung")) value = input.gemarkung ?? "--";
      else if (lbl.includes("flur") && !lbl.includes("flurst")) value = input.flur ?? "--";
      else if (lbl.includes("flurst")) value = input.flurstueckNr ?? "--";
      else if (lbl.includes("gemeinde")) value = input.gemeinde ?? "--";
      else if (lbl.includes("landkreis")) value = input.landkreis ?? "--";
      else if (lbl.includes("bundesland")) value = input.bundesland ?? "--";
      else if (lbl.includes("massstab") || lbl.includes("scale")) value = `1:${scale}`;
      else if (lbl.includes("datum")) value = input.surveyor.date;
      else value = "";
    }
    let disp = sanitizeAscii(value);
    const maxW = colW - 6;
    let sz = 6;
    if (font.widthOfTextAtSize(disp, sz) > maxW) {
      while (disp.length > 3 && font.widthOfTextAtSize(disp + "...", sz) > maxW) disp = disp.slice(0, -1);
      disp = disp + "...";
    }
    page.drawText(disp, { x: cellX, y: cellY + 1, size: sz, font, color: BLACK });
  }

  // AdV framework note just below title block
  {
    const advY = titleBlockY - 9;
    const advText = sanitizeAscii("Geodetic framework: ETRS89 / UTM (EPSG:25832) per AdV Geodateninfrastruktur (2001). DHDN (Bessel 1841 / GK zone 3, EPSG:31467) is legacy.");
    page.drawText(advText, { x: titleBlockX, y: advY, size: 5, font: fontOblique, color: rgb(0.35, 0.35, 0.35) });
    // DHDN TODO / NTv2 footer
    const dhdnY = advY - 7;
    const dhdnText = sanitizeAscii("DHDN -> ETRS89 via EPSG:1777 7-param (Position Vector) -- Verified EPSG GN7-2 s.1.3.11. Survey-grade requires AdV NTv2 (BeTA2007) grid [HK-PENDING-NTv2].");
    // wrap/truncate
    const maxW = titleBlockW;
    let disp = dhdnText;
    while (disp.length > 3 && fontOblique.widthOfTextAtSize(disp, 5) > maxW) disp = disp.slice(0, -1);
    if (disp.length < dhdnText.length) disp = disp + "...";
    page.drawText(disp, { x: titleBlockX, y: dhdnY, size: 5, font: fontOblique, color: rgb(0.55, 0.15, 0.15) });
  }

  // Plan area
  const coordScheduleH = 40 * MM_TO_PT;
  const planAreaX = marginLeftPt;
  const planAreaY = marginBottomPt + coordScheduleH + 32;
  const planAreaW = pageWidthPt - marginLeftPt - marginRightPt;
  const planAreaH = pageHeightPt - marginTopPt - titleBlockH - coordScheduleH - 52 - 4;
  const bounds = parcelBounds(input.parcel.beacons);
  const transform = makePlanTransform(bounds, planAreaX, planAreaY, planAreaW, planAreaH, scale);
  for (let i = 0; i < input.parcel.beacons.length; i++) {
    const a = transform(input.parcel.beacons[i]!.position);
    const b = transform(input.parcel.beacons[(i + 1) % input.parcel.beacons.length]!.position);
    page.drawLine({ start: a, end: b, thickness: 0.5 * MM_TO_PT, color: BLACK });
  }
  for (const b of input.parcel.beacons) {
    const p = transform(b.position);
    page.drawCircle({ x: p.x, y: p.y, size: 1.2, color: BLACK });
    page.drawText(sanitizeAscii(b.label), { x: p.x + 4, y: p.y + 4, size: 7, font: fontBold, color: BLACK });
  }
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
  {
    const cx = input.parcel.beacons.reduce((s, b) => s + b.position.easting, 0) / input.parcel.beacons.length;
    const cy = input.parcel.beacons.reduce((s, b) => s + b.position.northing, 0) / input.parcel.beacons.length;
    const center = transform({ easting: cx, northing: cy });
    const areaText = sanitizeAscii(`FLAECHE ${areaHa.toFixed(4)} ha`);
    const w = fontBold.widthOfTextAtSize(areaText, 8);
    page.drawText(areaText, { x: center.x - w / 2, y: center.y, size: 8, font: fontBold, color: BLACK });
  }
  {
    const naX = planAreaX + planAreaW - 16;
    const naY = planAreaY + planAreaH - 20;
    const h = 14; const w2 = h / 3;
    page.drawLine({ start: { x: naX, y: naY }, end: { x: naX, y: naY + h }, thickness: 1, color: BLACK });
    page.drawLine({ start: { x: naX - w2 / 2, y: naY + h - w2 }, end: { x: naX, y: naY + h }, thickness: 1, color: BLACK });
    page.drawLine({ start: { x: naX + w2 / 2, y: naY + h - w2 }, end: { x: naX, y: naY + h }, thickness: 1, color: BLACK });
    page.drawText("N", { x: naX - font.widthOfTextAtSize("N", 6) / 2, y: naY + h + 2, size: 6, font: fontBold, color: BLACK });
  }
  {
    const sx = planAreaX + 6; const sy = planAreaY + 6;
    const totalMm = (100 * 1000) / scale; const totalPt = totalMm * MM_TO_PT; const segLen = totalPt / 4;
    for (let i = 0; i < 4; i++) {
      const x = sx + i * segLen;
      if (i % 2 === 0) page.drawRectangle({ x, y: sy, width: segLen, height: 5, color: BLACK, borderColor: BLACK, borderWidth: 0.4 });
      else page.drawRectangle({ x, y: sy, width: segLen, height: 5, color: rgb(1, 1, 1), borderColor: BLACK, borderWidth: 0.4 });
    }
    page.drawText("0", { x: sx - 2, y: sy - 9, size: 6, font, color: BLACK });
    page.drawText("100 m", { x: sx + totalPt - font.widthOfTextAtSize("100 m", 6), y: sy - 9, size: 6, font, color: BLACK });
    page.drawText(sanitizeAscii(`Massstab 1:${scale}`), { x: sx, y: sy - 18, size: 6, font, color: BLACK });
  }

  // Coordinate schedule
  {
    const csX = marginLeftPt; const csY = marginBottomPt + 22; const csW = pageWidthPt - marginLeftPt - marginRightPt; const csH = coordScheduleH;
    const headerH = 10;
    const zone = cfg.geodeticFramework.projectionZones.find((z) => z.srid === input.parcel.srid);
    const headerLabel = zone ? `${zone.name} (EPSG::${String(zone.srid).padStart(5, "0")})` : `SRID ${input.parcel.srid}`;
    const coordHeader = sanitizeAscii(`KOORDINATEN: ${headerLabel} -- ETRS89 / UTM`);
    page.drawRectangle({ x: csX, y: csY + csH - headerH, width: csW, height: headerH, color: rgb(0.92, 0.92, 0.92), borderColor: BLACK, borderWidth: 0.5 });
    page.drawText(coordHeader, { x: csX + 4, y: csY + csH - headerH + 2.5, size: 5.5, font: fontBold, color: BLACK });
    page.drawRectangle({ x: csX, y: csY, width: csW, height: csH - headerH, borderColor: BLACK, borderWidth: 0.7, color: rgb(1, 1, 1) });
    const colWidths = [0.18, 0.27, 0.27, 0.28].map((p) => p * csW);
    const headers2 = ["Punkt-Nr.", "Rechtswert (E)", "Hochwert (N)", "Art / Bemerkung"];
    const tableTop = csY + csH - headerH; const rowH = 9;
    let cx = csX;
    for (let i = 0; i < headers2.length; i++) { page.drawText(sanitizeAscii(headers2[i]!), { x: cx + 3, y: tableTop - rowH + 2, size: 5, font: fontBold, color: BLACK }); cx += colWidths[i]!; }
    page.drawLine({ start: { x: csX, y: tableTop - rowH }, end: { x: csX + csW, y: tableTop - rowH }, thickness: 0.5, color: BLACK });
    cx = csX; for (let i = 0; i < colWidths.length - 1; i++) { cx += colWidths[i]!; page.drawLine({ start: { x: cx, y: csY }, end: { x: cx, y: tableTop }, thickness: 0.4, color: BLACK }); }
    for (let r = 0; r < input.parcel.beacons.length; r++) {
      if ((r + 1) * rowH > csH - headerH - rowH) break;
      const b = input.parcel.beacons[r]!;
      const rowY = tableTop - rowH - (r + 1) * rowH;
      const rowData = [sanitizeAscii(b.label), b.position.easting.toFixed(3), b.position.northing.toFixed(3), sanitizeAscii(b.description)];
      cx = csX; for (let i = 0; i < rowData.length; i++) { page.drawText(rowData[i]!, { x: cx + 3, y: rowY + 2, size: 5, font, color: BLACK }); cx += colWidths[i]!; }
    }
  }

  // Certification
  {
    const cert = planSheet.titleBlockLayout.certification;
    if (cert) {
      const y = marginBottomPt + 10;
      page.drawText(sanitizeAscii(cert.heading), { x: marginLeftPt, y: y + 7, size: 5.5, font: fontBold, color: BLACK });
      const text = sanitizeAscii(cert.lines.join(" "));
      const maxW = pageWidthPt - marginLeftPt - marginRightPt;
      // simple truncate
      let disp = text;
      while (disp.length > 3 && font.widthOfTextAtSize(disp, 5) > maxW) disp = disp.slice(0, -1);
      if (disp.length < text.length) disp = disp + "...";
      page.drawText(disp, { x: marginLeftPt, y: y, size: 5, font, color: BLACK });
    }
    const seal = planSheet.titleBlockLayout.seal;
    if (seal.position !== "none") {
      const cap = sanitizeAscii(seal.caption ?? "OEBVI");
      page.drawText(sanitizeAscii(`Seal: [${cap}]`), { x: pageWidthPt - marginRightPt - 85, y: marginBottomPt + 10, size: 5, font: fontOblique, color: rgb(0.4, 0.4, 0.4) });
    }
    // statutory footer lines first one
    const sfl = planSheet.titleBlockLayout.statutoryFooterLines ?? [];
    if (sfl.length > 0) {
      const txt = sanitizeAscii(sfl[0]!);
      const maxW = pageWidthPt - marginLeftPt - marginRightPt;
      let disp = txt;
      while (disp.length > 3 && fontOblique.widthOfTextAtSize(disp, 4.5) > maxW) disp = disp.slice(0, -1);
      if (disp.length < txt.length) disp = disp + "...";
      page.drawText(disp, { x: marginLeftPt, y: marginBottomPt + 2, size: 4.5, font: fontOblique, color: rgb(0.35, 0.35, 0.35) });
    }
  }

  // Verification footer with HK count
  {
    const lines = [
      sanitizeAscii(`Layout cites: VermKatG (state) & AdV ETRS89/UTM & ALKIS & EPSG:${cfg.geodeticFramework.primarySRID}/1777/31467 -- ETRS89/UTM primary, DHDN legacy -- HK items: ${HK_ITEM_COUNT} pending per-Bundesland specimen.`),
      sanitizeAscii(`DRAFT watermark -- NOT FOR LODGEMENT. [HK-PENDING-SPECIMEN] NTv2 BeTA2007 pending [HK-PENDING-NTv2].`),
      sanitizeAscii(`Source: grenzfeststellung-spec.md -- verification required before lodgement.`),
    ];
    const size = 5.5, lineH = size * 1.35;
    const xM = marginLeftPt;
    const totalH = lines.length * lineH;
    const y0 = marginBottomPt - 4 - totalH;
    if (y0 >= -10) {
      page.drawLine({ start: { x: xM, y: y0 + totalH + 2 }, end: { x: pageWidthPt - marginRightPt, y: y0 + totalH + 2 }, thickness: 0.25, color: rgb(0.55, 0.55, 0.55) });
      for (let i = 0; i < lines.length; i++) page.drawText(lines[i]!, { x: xM, y: y0 + (lines.length - 1 - i) * lineH, size, font, color: rgb(0.45, 0.45, 0.45) });
    }
  }

  const pdfBytes = await pdfDoc.save();
  return { pdfBytes, hasDraftWatermark: true, hkItemCount: HK_ITEM_COUNT, pageSize, orientation, srid: input.parcel.srid };
}
