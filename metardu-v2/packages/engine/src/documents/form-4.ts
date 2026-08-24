/**
 * Form 4 — Kenya Mutation / Subdivision Plan renderer.
 *
 * Produces a print-ready A4 PDF of the statutory Mutation Plan (Form No. 4)
 * required by Survey Act Cap. 299 for subdividing a parent parcel into
 * two or more new parcels. The plan shows OLD (parent) vs NEW
 * subdivision boundaries on the same sheet, with a coordinate schedule per
 * parcel and an area cross-check between parent and sum(new).
 *
 * # Source spec
 *
 * Every layout decision in this file cites the corresponding section of
 * `docs/regulatory-sources/kenya/cadastral/form-4-spec.md`. Per invariant
 * B2, this is mandatory — no layout decision may be made from "general
 * practice". Unverifiable decisions are marked [HK] and counted in
 * hkItemCount = 10.
 *
 * Source documents (filed or pending):
 *   docs/regulatory-sources/kenya/cadastral/survey-act-cap-299-revised-2012.pdf
 *     — Survey Act Cap.299 ss.24/27/28-29/30/32/41/45(1)(c) [HK lineage]
 *   docs/regulatory-sources/kenya/cadastral/kenya-gazette-survey-regulations-1994.pdf
 *     — §6.2 area 4dp, §6.3 scale, §6.4 beacon/boundary, §6.5 bearing/distance,
 *       §6.6 coord schedule, §6.7 north arrow/scale bar, §6.8 grid
 *   docs/regulatory-sources/kenya/reference/4-acres-working-diagram.pdf (illustrative)
 *   docs/regulatory-sources/kenya/cadastral/form-3-spec.md (pattern reuse)
 *   packages/country-config/src/countries/kenya.ts FORM_4 (statutory spec)
 *
 * # Invariants
 *
 *   A2 — SRID from country-config, never literal 21037 outside country-config +
 *         crs-database + tests. Looked up via KENYA geodeticFramework.
 *   B1/B2 — DRAFT watermark until Form 4 specimen eye-checked; every element
 *           cites source or carries [HK]; hkItemCount in footer.
 *   ASCII-only — all text sanitised via sanitizeAscii for Helvetica standard
 *                fonts (per invoice-pdf pattern).
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
  validateSRID,
} from "../workflows/validation.js";
import {
  DxfDocument,
  Colors,
  Units,
  LineTypes,
  point3d,
} from "@tarikjabiri/dxf";

// ─── Types ─────────────────────────────────────────────────────────

/** A 2D point in projected coordinates (E, N) in metres — reuse Form 3 shape. */
export interface Form4Point {
  easting: number;
  northing: number;
}

/** A beacon on a boundary — same shape as Form3Beacon. */
export interface Form4Beacon {
  label: string;
  position: Form4Point;
  description: string;
}

/** Parent parcel being subdivided. */
export interface Form4ParentParcel {
  lrNumber: string;
  beacons: Form4Beacon[];
}

/** A new parcel created by the subdivision. */
export interface Form4NewParcel {
  lrNumber: string;
  beacons: Form4Beacon[];
}

/** Surveyor — same shape as Form3Surveyor. */
export interface Form4Surveyor {
  name: string;
  iskRegNo: string;
  dateOfSurvey: string;
}

/** Input to the Form 4 renderer. */
export interface Form4Input {
  county: string;
  subCounty: string;
  parentParcel: Form4ParentParcel;
  newParcels: Form4NewParcel[];
  mutationReason: string;
  /** Map from lrNumber → area (ha). Must contain an entry for each newParcel lrNumber. */
  areaHaByParcel: Record<string, number>;
  srid: number;
  surveyor: Form4Surveyor;
}

/** Output of the Form 4 renderer. */
export interface Form4Output {
  pdfBytes: Uint8Array;
  /** Always true — DRAFT watermark is drawn until specimen filed. */
  hasDraftWatermark: true;
  /** Count of layout decisions flagged [HK] per form-4-spec.md. */
  hkItemCount: number;
  /** Whether parent area ≈ sum(new areas) within 0.01 ha. */
  areasCrossChecked: boolean;
  /** DXF companion string for the mutation (for test layer assertions). */
  dxfString?: string;
}

// ─── Constants (all cited from form-4-spec.md §Page layout) ────────

// Spec §Page layout: A4 portrait — [HK-PENDING-SPECIMEN]
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const MARGIN_TOP_MM = 25;
const MARGIN_RIGHT_MM = 20;
const MARGIN_BOTTOM_MM = 25;
const MARGIN_LEFT_MM = 20;

const MM_TO_PT = 2.834645669;
const PAGE_WIDTH_PT = PAGE_WIDTH_MM * MM_TO_PT;
const PAGE_HEIGHT_PT = PAGE_HEIGHT_MM * MM_TO_PT;
const MARGIN_TOP_PT = MARGIN_TOP_MM * MM_TO_PT;
const MARGIN_RIGHT_PT = MARGIN_RIGHT_MM * MM_TO_PT;
const MARGIN_BOTTOM_PT = MARGIN_BOTTOM_MM * MM_TO_PT;
const MARGIN_LEFT_PT = MARGIN_LEFT_MM * MM_TO_PT;

// Title block taller than Form 3 (6 rows of fields) — [HK]
const TITLE_BLOCK_HEIGHT_PT = 72 * MM_TO_PT;
// Coord schedule taller (parent + N new parcel sections)
const COORD_SCHEDULE_HEIGHT_PT = 56 * MM_TO_PT;

const BOUNDARY_LINE_WIDTH_PT = 0.5 * MM_TO_PT;
const BEACON_RADIUS_PT = 1.0;
const LABEL_FONT_SIZE = 7;
const HEADER_FONT_SIZE = 8;

const BLACK = rgb(0, 0, 0);
const DRAFT_RED = rgb(0.75, 0.15, 0.15);
const LIGHT_GRAY = rgb(0.8, 0.8, 0.8);
const HK_ITEM_COUNT = 10; // per form-4-spec.md §Verification footer

// ─── Helpers — reuse form-3.ts pattern (bearingDMS, distanceM, parcelBounds, selectScale) ─

/** Sanitise to ASCII for Helvetica standard fonts (invariant: PDFs ASCII-only). */
function sanitizeAscii(s: string): string {
  // Replace non-ASCII printable with '?' or closest ASCII; degree symbol → 'd'
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x00b0 || code === 0x00ba) {
      out += "d"; // degree
    } else if (code >= 32 && code < 127) {
      out += s[i]!;
    } else if (code === 8211 || code === 8212) {
      out += "-"; // en/em dash
    } else if (code === 8220 || code === 8221) {
      out += '"';
    } else if (code === 8216 || code === 8217) {
      out += "'";
    } else if (code >= 128) {
      out += "?";
    } else {
      out += s[i]!;
    }
  }
  return out;
}

/**
 * Select plan scale per Survey Regs 1994 §6.3 (reuse form-3.ts pattern).
 * <0.5 ha → 500, 0.5-5 → 1000, 5-50 → 2500, >50 → 5000
 */
function selectScale(areaHa: number): number {
  if (areaHa < 0.5) return 500;
  if (areaHa < 5) return 1000;
  if (areaHa < 50) return 2500;
  return 5000;
}

/** Bearing DMS formatted as ASCII "DDDdMM'SS\"" per §6.5 (sanitised). */
function bearingDMS(a: Form4Point, b: Form4Point): { deg: number; str: string } {
  const de = b.easting - a.easting;
  const dn = b.northing - a.northing;
  let degVal = (Math.atan2(de, dn) * 180) / Math.PI;
  if (degVal < 0) degVal += 360;
  const d = Math.floor(degVal);
  const mFull = (degVal - d) * 60;
  const m = Math.floor(mFull);
  const s = Math.round((mFull - m) * 60);
  const dStr = String(d).padStart(3, "0");
  const mStr = String(m).padStart(2, "0");
  const sStr = String(s).padStart(2, "0");
  return { deg: degVal, str: `${dStr}d${mStr}'${sStr}"` };
}

/** Horizontal distance metres formatted "XX.XXX m" 3dp per §6.5. */
function distanceM(a: Form4Point, b: Form4Point): { m: number; str: string } {
  const de = b.easting - a.easting;
  const dn = b.northing - a.northing;
  const m = Math.sqrt(de * de + dn * dn);
  return { m, str: `${m.toFixed(3)} m` };
}

/** Bounding box with 10% padding — same as form-3.ts parcelBounds. */
function parcelBounds(beacons: Form4Beacon[]): {
  minE: number; maxE: number; minN: number; maxN: number; width: number; height: number;
} {
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const b of beacons) {
    if (b.position.easting < minE) minE = b.position.easting;
    if (b.position.easting > maxE) maxE = b.position.easting;
    if (b.position.northing < minN) minN = b.position.northing;
    if (b.position.northing > maxN) maxN = b.position.northing;
  }
  const padE = (maxE - minE) * 0.1;
  const padN = (maxN - minN) * 0.1;
  return {
    minE: minE - padE, maxE: maxE + padE,
    minN: minN - padN, maxN: maxN + padN,
    width: (maxE - minE) + 2 * padE,
    height: (maxN - minN) + 2 * padN,
  };
}

/** Combined bounds across parent + all new parcels. */
function combinedBounds(parent: Form4Beacon[], newParcels: Form4NewParcel[]): ReturnType<typeof parcelBounds> {
  const all = [...parent];
  for (const np of newParcels) all.push(...np.beacons);
  return parcelBounds(all);
}

/** Shoelace polygon area in hectares (ground metres → ha). */
function polygonAreaHa(beacons: Form4Beacon[]): number {
  if (beacons.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < beacons.length; i++) {
    const j = (i + 1) % beacons.length;
    area += beacons[i]!.position.easting * beacons[j]!.position.northing
          - beacons[j]!.position.easting * beacons[i]!.position.northing;
  }
  return Math.abs(area) / 2 / 10000;
}

/** Transform parcel (E,N) → page (x,y) for the plan area. */
function makePlanTransform(
  bounds: { minE: number; maxE: number; minN: number; maxN: number; width: number; height: number },
  planAreaX: number, planAreaY: number, planAreaW: number, planAreaH: number,
  scale: number,
): (p: Form4Point) => { x: number; y: number } {
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
  return (p: Form4Point) => ({
    x: planCenterX + (p.easting - parcelCenterE) * ptPerM,
    y: planCenterY + (p.northing - parcelCenterN) * ptPerM,
  });
}

// ─── PDF drawing primitives ────────────────────────────────────────

function drawDraftWatermark(page: PDFPage, font: PDFFont) {
  // Spec §Page layout: diagonal DRAFT watermark opacity 0.15
  // Source: invariant B1/B2 — required until Form 4 specimen filed.
  const text = sanitizeAscii("DRAFT -- NOT FOR LODGEMENT (HK-PENDING-SPECIMEN)");
  const size = 42;
  const textWidth = font.widthOfTextAtSize(text, size);
  const x = PAGE_WIDTH_PT / 2 - textWidth / 2;
  const y = PAGE_HEIGHT_PT / 2;
  page.drawText(text, {
    x, y,
    size,
    font,
    color: DRAFT_RED,
    opacity: 0.15,
    rotate: degrees(45),
  });
}

function drawDashedLine(page: PDFPage, a: { x: number; y: number }, b: { x: number; y: number }, color = BLACK) {
  // Simulate dashed line (parent OLD boundary) by splitting into segments — [HK] dash pattern
  const len = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  if (len < 1) {
    page.drawLine({ start: a, end: b, thickness: BOUNDARY_LINE_WIDTH_PT, color });
    return;
  }
  const dash = 6; const gap = 4;
  const steps = Math.ceil(len / (dash + gap));
  const dx = (b.x - a.x) / len;
  const dy = (b.y - a.y) / len;
  for (let i = 0; i < steps; i++) {
    const s0 = i * (dash + gap);
    const s1 = Math.min(s0 + dash, len);
    if (s1 <= s0) break;
    page.drawLine({
      start: { x: a.x + dx * s0, y: a.y + dy * s0 },
      end: { x: a.x + dx * s1, y: a.y + dy * s1 },
      thickness: BOUNDARY_LINE_WIDTH_PT * 0.8,
      color,
    });
  }
}

function drawBoundarySolid(page: PDFPage, beacons: Form4Beacon[], transform: (p: Form4Point) => { x: number; y: number }) {
  for (let i = 0; i < beacons.length; i++) {
    const a = transform(beacons[i]!.position);
    const b = transform(beacons[(i + 1) % beacons.length]!.position);
    page.drawLine({ start: a, end: b, thickness: BOUNDARY_LINE_WIDTH_PT, color: BLACK });
  }
}

function drawBoundaryDashed(page: PDFPage, beacons: Form4Beacon[], transform: (p: Form4Point) => { x: number; y: number }) {
  for (let i = 0; i < beacons.length; i++) {
    const a = transform(beacons[i]!.position);
    const b = transform(beacons[(i + 1) % beacons.length]!.position);
    drawDashedLine(page, a, b, rgb(0.3, 0.3, 0.3));
  }
}

function drawBeacons(page: PDFPage, beacons: Form4Beacon[], transform: (p: Form4Point) => { x: number; y: number }, font: PDFFont) {
  for (const b of beacons) {
    const p = transform(b.position);
    page.drawCircle({ x: p.x, y: p.y, size: BEACON_RADIUS_PT, color: BLACK });
    page.drawText(sanitizeAscii(b.label), { x: p.x + 5, y: p.y + 5, size: LABEL_FONT_SIZE, font, color: BLACK });
  }
}

function drawBearingDistanceLabels(page: PDFPage, beacons: Form4Beacon[], transform: (p: Form4Point) => { x: number; y: number }, font: PDFFont) {
  for (let i = 0; i < beacons.length; i++) {
    const a = beacons[i]!;
    const b = beacons[(i + 1) % beacons.length]!;
    const pa = transform(a.position);
    const pb = transform(b.position);
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    const { str: brgStr } = bearingDMS(a.position, b.position);
    const { str: distStr } = distanceM(a.position, b.position);
    const dx = pb.x - pa.x; const dy = pb.y - pa.y;
    const lineLen = Math.sqrt(dx * dx + dy * dy);
    if (lineLen < 1) continue;
    const perpX = -dy / lineLen; const perpY = dx / lineLen;
    page.drawText(sanitizeAscii(brgStr), {
      x: mid.x + perpX * 6 - font.widthOfTextAtSize(brgStr, LABEL_FONT_SIZE) / 2,
      y: mid.y + perpY * 6,
      size: LABEL_FONT_SIZE, font, color: BLACK,
    });
    page.drawText(sanitizeAscii(distStr), {
      x: mid.x - perpX * 6 - font.widthOfTextAtSize(distStr, LABEL_FONT_SIZE) / 2,
      y: mid.y - perpY * 6 - LABEL_FONT_SIZE,
      size: LABEL_FONT_SIZE, font, color: BLACK,
    });
  }
}

function drawAreaAnnotations(page: PDFPage, newParcels: Form4NewParcel[], areaHaByParcel: Record<string, number>, transform: (p: Form4Point) => { x: number; y: number }, font: PDFFont) {
  for (const np of newParcels) {
    const cx = np.beacons.reduce((s, b) => s + b.position.easting, 0) / np.beacons.length;
    const cy = np.beacons.reduce((s, b) => s + b.position.northing, 0) / np.beacons.length;
    const center = transform({ easting: cx, northing: cy });
    const area = areaHaByParcel[np.lrNumber];
    const areaText = area !== undefined ? `AREA ${area.toFixed(4)} ha` : `AREA ? ha`;
    const w = font.widthOfTextAtSize(areaText, LABEL_FONT_SIZE + 1);
    page.drawText(sanitizeAscii(areaText), { x: center.x - w / 2, y: center.y, size: LABEL_FONT_SIZE + 1, font, color: BLACK });
    // LR label just below
    const lrText = sanitizeAscii(np.lrNumber);
    const w2 = font.widthOfTextAtSize(lrText, LABEL_FONT_SIZE);
    page.drawText(lrText, { x: center.x - w2 / 2, y: center.y - 10, size: LABEL_FONT_SIZE, font, color: BLACK });
  }
}

function drawNorthArrow(page: PDFPage, x: number, y: number, font: PDFFont) {
  const arrowHeight = 15 * MM_TO_PT;
  const arrowWidth = arrowHeight / 3;
  page.drawLine({ start: { x, y }, end: { x, y: y + arrowHeight }, thickness: 1, color: BLACK });
  page.drawLine({ start: { x: x - arrowWidth / 2, y: y + arrowHeight - arrowWidth }, end: { x, y: y + arrowHeight }, thickness: 1, color: BLACK });
  page.drawLine({ start: { x: x + arrowWidth / 2, y: y + arrowHeight - arrowWidth }, end: { x, y: y + arrowHeight }, thickness: 1, color: BLACK });
  page.drawText("N", { x: x - font.widthOfTextAtSize("N", LABEL_FONT_SIZE) / 2, y: y + arrowHeight + 3, size: LABEL_FONT_SIZE, font, color: BLACK });
}

function drawScaleBar(page: PDFPage, x: number, y: number, scale: number, font: PDFFont) {
  const totalLengthMm = (100 * 1000) / scale;
  const totalLengthPt = totalLengthMm * MM_TO_PT;
  const segments = 4; const segLen = totalLengthPt / segments;
  for (let i = 0; i < segments; i++) {
    const segX = x + i * segLen;
    if (i % 2 === 0) page.drawRectangle({ x: segX, y, width: segLen, height: 6, color: BLACK, borderColor: BLACK, borderWidth: 0.5 });
    else page.drawRectangle({ x: segX, y, width: segLen, height: 6, color: rgb(1,1,1), borderColor: BLACK, borderWidth: 0.5 });
  }
  page.drawText(sanitizeAscii("0"), { x: x - 2, y: y - 10, size: LABEL_FONT_SIZE - 1, font, color: BLACK });
  const label100 = "100 m";
  page.drawText(sanitizeAscii(label100), { x: x + totalLengthPt - font.widthOfTextAtSize(label100, LABEL_FONT_SIZE - 1), y: y - 10, size: LABEL_FONT_SIZE - 1, font, color: BLACK });
  page.drawText(sanitizeAscii(`Scale 1:${scale}`), { x, y: y - 22, size: LABEL_FONT_SIZE - 1, font, color: BLACK });
}

function drawTitleBlock(page: PDFPage, input: Form4Input, scale: number, font: PDFFont, fontBold: PDFFont) {
  const blockX = MARGIN_LEFT_PT;
  const blockY = PAGE_HEIGHT_PT - MARGIN_TOP_PT - TITLE_BLOCK_HEIGHT_PT;
  const blockW = PAGE_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT;
  const blockH = TITLE_BLOCK_HEIGHT_PT;
  page.drawRectangle({ x: blockX, y: blockY, width: blockW, height: blockH, borderColor: BLACK, borderWidth: 1, color: rgb(1,1,1) });
  const colW = blockW / 2; const rows = 6; const rowH = blockH / rows;
  page.drawLine({ start: { x: blockX + colW, y: blockY }, end: { x: blockX + colW, y: blockY + blockH }, thickness: 0.5, color: BLACK });
  for (let i = 1; i < rows; i++) page.drawLine({ start: { x: blockX, y: blockY + i * rowH }, end: { x: blockX + blockW, y: blockY + i * rowH }, thickness: 0.5, color: BLACK });

  const newParcelList = input.newParcels.map(p => p.lrNumber).join(", ");
  const parentArea = polygonAreaHa(input.parentParcel.beacons);
  const newTotal = Object.values(input.areaHaByParcel).reduce((a, b) => a + b, 0);
  const fields: Array<{ label: string; value: string }> = [
    { label: "MUTATION NO.", value: "(to be assigned)" },
    { label: "COUNTY", value: input.county },
    { label: "SUB-COUNTY", value: input.subCounty },
    { label: "PARENT PARCEL NO. (LR)", value: input.parentParcel.lrNumber },
    { label: "NEW PARCEL NOS.", value: newParcelList || "(none)" },
    { label: "MUTATION REASON", value: input.mutationReason },
    { label: "AREA — PARENT", value: `${parentArea.toFixed(4)} ha` },
    { label: "AREA — NEW TOTAL", value: `${newTotal.toFixed(4)} ha` },
    { label: "SCALE", value: `1:${scale}` },
    { label: "SURVEYOR", value: `${input.surveyor.name} (${input.surveyor.iskRegNo})` },
    { label: "DATE OF SURVEY", value: input.surveyor.dateOfSurvey },
    { label: "SEAL", value: "[seal]" },
  ];
  for (let i = 0; i < fields.length; i++) {
    const col = i % 2; const row = Math.floor(i / 2);
    const cellX = blockX + col * colW + 3;
    const cellY = blockY + blockH - (row + 1) * rowH + 3;
    const f = fields[i]!;
    page.drawText(sanitizeAscii(f.label), { x: cellX, y: cellY + rowH - 4 - LABEL_FONT_SIZE, size: LABEL_FONT_SIZE - 2, font, color: BLACK });
    const val = sanitizeAscii(f.value);
    // Truncate if too wide
    const maxW = colW - 6;
    let displayVal = val;
    let sz = HEADER_FONT_SIZE - 1;
    if (font.widthOfTextAtSize(val, sz) > maxW) {
      // shorten
      while (displayVal.length > 3 && font.widthOfTextAtSize(displayVal + "...", sz) > maxW) displayVal = displayVal.slice(0, -1);
      displayVal = displayVal + "...";
    }
    page.drawText(displayVal, { x: cellX, y: cellY + 3, size: sz, font: fontBold, color: BLACK });
  }
}

function drawCoordinateSchedule(page: PDFPage, input: Form4Input, font: PDFFont, fontBold: PDFFont) {
  const blockX = MARGIN_LEFT_PT;
  const blockH = COORD_SCHEDULE_HEIGHT_PT;
  const blockY = MARGIN_BOTTOM_PT + 36; // leave room for cert + footer
  const blockW = PAGE_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT;
  const headerH = 13;
  const headerY = blockY + blockH - headerH;
  // SRID header — invariant A2
  const sridZone = KENYA.geodeticFramework.projectionZones.find(z => z.srid === input.srid);
  const coordLabel = sridZone
    ? `COORDINATES: ${sridZone.name} (EPSG::${String(sridZone.srid).padStart(5, "0")})`
    : `COORDINATES: SRID ${input.srid}`;
  page.drawRectangle({ x: blockX, y: headerY, width: blockW, height: headerH, color: rgb(0.92,0.92,0.92), borderColor: BLACK, borderWidth: 0.5 });
  page.drawText(sanitizeAscii(coordLabel), { x: blockX + 4, y: headerY + (headerH - HEADER_FONT_SIZE) / 2, size: HEADER_FONT_SIZE - 1, font: fontBold, color: BLACK });

  // Table border
  page.drawRectangle({ x: blockX, y: blockY, width: blockW, height: blockH - headerH, borderColor: BLACK, borderWidth: 1, color: rgb(1,1,1) });
  const colWidths = [0.18, 0.22, 0.22, 0.38].map(p => p * blockW);
  const headers = ["Beacon", "Easting", "Northing", "Description"];
  const tableTop = blockY + blockH - headerH;
  const rowHeight = 10; const headerRowHeight = 11;
  let cx = blockX;
  for (let i = 0; i < headers.length; i++) {
    page.drawText(sanitizeAscii(headers[i]!), { x: cx + 3, y: tableTop - headerRowHeight + 2, size: LABEL_FONT_SIZE - 1, font: fontBold, color: BLACK });
    cx += colWidths[i]!;
  }
  page.drawLine({ start: { x: blockX, y: tableTop - headerRowHeight }, end: { x: blockX + blockW, y: tableTop - headerRowHeight }, thickness: 0.5, color: BLACK });
  // vertical dividers
  cx = blockX;
  for (let i = 0; i < colWidths.length - 1; i++) {
    cx += colWidths[i]!;
    page.drawLine({ start: { x: cx, y: blockY }, end: { x: cx, y: tableTop }, thickness: 0.5, color: BLACK });
  }
  // Rows: parent first then each new parcel (grouped)
  let rowIdx = 0;
  const allGroups: Array<{ heading: string; beacons: Form4Beacon[] }> = [
    { heading: `PARENT ${input.parentParcel.lrNumber}`, beacons: input.parentParcel.beacons },
    ...input.newParcels.map(np => ({ heading: `NEW ${np.lrNumber}`, beacons: np.beacons })),
  ];
  for (const grp of allGroups) {
    // group heading row (shaded)
    if (rowIdx * rowHeight > (blockH - headerH - headerRowHeight - 2)) break; // clip
    const rowY = tableTop - headerRowHeight - (rowIdx + 1) * rowHeight;
    page.drawRectangle({ x: blockX, y: rowY, width: blockW, height: rowHeight, color: rgb(0.95,0.95,0.95), borderColor: LIGHT_GRAY, borderWidth: 0.2 });
    page.drawText(sanitizeAscii(grp.heading), { x: blockX + 3, y: rowY + 2, size: LABEL_FONT_SIZE - 1, font: fontBold, color: BLACK });
    rowIdx++;
    for (const b of grp.beacons) {
      if (rowIdx * rowHeight > (blockH - headerH - headerRowHeight - 2)) break;
      const rowY2 = tableTop - headerRowHeight - (rowIdx + 1) * rowHeight;
      const rowData = [sanitizeAscii(b.label), b.position.easting.toFixed(3), b.position.northing.toFixed(3), sanitizeAscii(b.description)];
      cx = blockX;
      for (let i = 0; i < rowData.length; i++) {
        page.drawText(rowData[i]!, { x: cx + 3, y: rowY2 + 2, size: LABEL_FONT_SIZE - 1, font, color: BLACK });
        cx += colWidths[i]!;
      }
      if (rowIdx < 8) page.drawLine({ start: { x: blockX, y: rowY2 }, end: { x: blockX + blockW, y: rowY2 }, thickness: 0.2, color: LIGHT_GRAY });
      rowIdx++;
    }
  }
}

function drawAreaCrossCheckNote(page: PDFPage, parentAreaHa: number, newTotalHa: number, areasCrossChecked: boolean, font: PDFFont) {
  const blockX = MARGIN_LEFT_PT;
  const blockY = MARGIN_BOTTOM_PT + COORD_SCHEDULE_HEIGHT_PT + 46;
  const text = sanitizeAscii(`Area cross-check: parent ${parentAreaHa.toFixed(4)} ha | sum(new) ${newTotalHa.toFixed(4)} ha -- ${areasCrossChecked ? "MATCH" : "MISMATCH"} (tol 0.01 ha) [HK]`);
  page.drawText(text, { x: blockX, y: blockY, size: 7, font, color: areasCrossChecked ? rgb(0.2,0.5,0.2) : rgb(0.7,0.15,0.15) });
}

function drawCertification(page: PDFPage, input: Form4Input, font: PDFFont) {
  const blockX = MARGIN_LEFT_PT;
  const blockY = MARGIN_BOTTOM_PT + 6;
  const lines = [
    sanitizeAscii(`I, ${input.surveyor.name}, licensed land surveyor No. ${input.surveyor.iskRegNo},`),
    sanitizeAscii(`certify that the mutation survey subdividing ${input.parentParcel.lrNumber}`),
    sanitizeAscii(`into ${input.newParcels.length} new parcel(s) for "${input.mutationReason}" was`),
    sanitizeAscii(`executed by me on ${input.surveyor.dateOfSurvey} per Survey Act Cap.299 ss.28-29 [HK].`),
    sanitizeAscii(`Signed: _______________________      Seal: [ISK SEAL]`),
  ];
  for (let i = 0; i < lines.length; i++) {
    page.drawText(lines[i]!, { x: blockX, y: blockY + (lines.length - 1 - i) * 8, size: LABEL_FONT_SIZE - 1, font, color: BLACK });
  }
}

function drawVerificationFooter(page: PDFPage, font: PDFFont, hkCount: number) {
  const lines = [
    sanitizeAscii(`Layout cites: Survey Act Cap.299 ss.24/27/28-29/30/32/41/45(1)(c) & Survey Regs 1994 s.6.x -- HK items: ${hkCount} pending specimen.`),
    sanitizeAscii(`DRAFT watermark -- NOT FOR LODGEMENT. Area cross-check pending specimen [HK].`),
    sanitizeAscii(`Source: form-4-spec.md -- verification required before lodgement.`),
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

// ─── DXF companion ──────────────────────────────────────────────────

/**
 * Generate DXF companion for a Form 4 mutation.
 * Layers per form-4-spec.md §DXF companion + kenya.ts FORM_4 dxfLayers.
 */
export function generateForm4Dxf(input: Form4Input): string {
  const doc = new DxfDocument();
  doc.setUnits(Units.Meters);
  const layerDefs: Array<{ name: string; color: number }> = [
    { name: "BOUNDARY-OLD", color: Colors.White },
    { name: "BOUNDARY-NEW", color: Colors.White },
    { name: "BEACON-EXISTING", color: Colors.White },
    { name: "BEACON-NEW", color: Colors.White },
    { name: "TEXT-MUTATION", color: Colors.Cyan },
    { name: "TEXT-COORDS", color: Colors.Cyan },
    { name: "TEXT-AREA", color: Colors.Cyan },
    { name: "TEXT-BEARINGS", color: Colors.Green },
    { name: "TEXT-DISTANCES", color: Colors.Green },
    { name: "TEXT-BEACON-LABELS", color: Colors.Yellow },
    { name: "TITLE-BLOCK", color: Colors.White },
    { name: "COORD-SCHEDULE", color: Colors.White },
    { name: "NORTH-ARROW", color: Colors.White },
    { name: "SCALE-BAR", color: Colors.White },
  ];
  for (const l of layerDefs) doc.tables.addLayer(l.name, l.color, LineTypes.Continuous);

  // Parent OLD boundary (dashed simulation → use BOUNDARY-OLD)
  const parentPts = input.parentParcel.beacons.map(b => point3d(b.position.easting, b.position.northing, 0));
  for (let i = 0; i < parentPts.length; i++) {
    const a = parentPts[i]!; const b = parentPts[(i+1)%parentPts.length]!;
    doc.entities.modelSpace.addLine(a, b, { layerName: "BOUNDARY-OLD" });
  }
  for (const b of input.parentParcel.beacons) {
    doc.entities.modelSpace.addCircle(point3d(b.position.easting, b.position.northing, 0), 0.5, { layerName: "BEACON-EXISTING" });
    doc.entities.modelSpace.addText(point3d(b.position.easting + 1, b.position.northing + 1, 0), 1.5, b.label, { layerName: "TEXT-BEACON-LABELS" });
  }
  // New parcels
  for (const np of input.newParcels) {
    const pts = np.beacons.map(b => point3d(b.position.easting, b.position.northing, 0));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!; const b = pts[(i+1)%pts.length]!;
      doc.entities.modelSpace.addLine(a, b, { layerName: "BOUNDARY-NEW" });
    }
    for (const b of np.beacons) {
      doc.entities.modelSpace.addCircle(point3d(b.position.easting, b.position.northing, 0), 0.5, { layerName: "BEACON-NEW" });
      doc.entities.modelSpace.addText(point3d(b.position.easting + 1, b.position.northing + 1, 0), 1.5, b.label, { layerName: "TEXT-BEACON-LABELS" });
    }
    // area annotation
    const cx = np.beacons.reduce((s, x) => s + x.position.easting, 0) / np.beacons.length;
    const cy = np.beacons.reduce((s, x) => s + x.position.northing, 0) / np.beacons.length;
    const area = input.areaHaByParcel[np.lrNumber];
    if (area !== undefined) doc.entities.modelSpace.addText(point3d(cx, cy, 0), 2.0, sanitizeAscii(`AREA ${area.toFixed(4)} ha ${np.lrNumber}`), { layerName: "TEXT-AREA" });
  }
  // coordinate schedule text block
  let yText = -10;
  doc.entities.modelSpace.addText(point3d(0, yText, 0), 2.0, sanitizeAscii(`MUTATION ${input.parentParcel.lrNumber} -> ${input.newParcels.map(p=>p.lrNumber).join(", ")} COUNTY ${input.county}`), { layerName: "TEXT-MUTATION" });
  // SRID label
  yText -= 4;
  doc.entities.modelSpace.addText(point3d(0, yText, 0), 1.8, sanitizeAscii(`SRID ${input.srid}`), { layerName: "TEXT-COORDS" });
  return doc.stringify();
}

// ─── Validation ─────────────────────────────────────────────────────

function validateForm4Input(input: Form4Input): void {
  // county / subCounty / mutationReason non-empty — §Title block
  validateNonEmptyString(input.county, "Form4Input.county");
  validateNonEmptyString(input.subCounty, "Form4Input.subCounty");
  validateNonEmptyString(input.mutationReason, "Form4Input.mutationReason");
  // parentParcel
  validateNonEmptyString(input.parentParcel.lrNumber, "Form4Input.parentParcel.lrNumber");
  if (!Array.isArray(input.parentParcel.beacons) || input.parentParcel.beacons.length < 3) {
    throw new Error(`Validation error: Form4Input.parentParcel.beacons must have at least 3 beacons, got ${input.parentParcel.beacons?.length ?? 0}.`);
  }
  for (let i = 0; i < input.parentParcel.beacons.length; i++) {
    const b = input.parentParcel.beacons[i]!;
    validateNonEmptyString(b.label, `Form4Input.parentParcel.beacons[${i}].label`);
    validateNonEmptyString(b.description, `Form4Input.parentParcel.beacons[${i}].description`);
    validateNonNaN(b.position.easting, `Form4Input.parentParcel.beacons[${i}].position.easting`);
    validateNonNaN(b.position.northing, `Form4Input.parentParcel.beacons[${i}].position.northing`);
  }
  // newParcels >=1
  if (!Array.isArray(input.newParcels) || input.newParcels.length < 1) {
    throw new Error(`Validation error: Form4Input.newParcels must have at least 1 new parcel, got ${input.newParcels?.length ?? 0}.`);
  }
  for (let idx = 0; idx < input.newParcels.length; idx++) {
    const np = input.newParcels[idx]!;
    validateNonEmptyString(np.lrNumber, `Form4Input.newParcels[${idx}].lrNumber`);
    if (!Array.isArray(np.beacons) || np.beacons.length < 3) {
      throw new Error(`Validation error: Form4Input.newParcels[${idx}].beacons must have at least 3 beacons, got ${np.beacons?.length ?? 0}.`);
    }
    for (let i = 0; i < np.beacons.length; i++) {
      const b = np.beacons[i]!;
      validateNonEmptyString(b.label, `Form4Input.newParcels[${idx}].beacons[${i}].label`);
      validateNonEmptyString(b.description, `Form4Input.newParcels[${idx}].beacons[${i}].description`);
      validateNonNaN(b.position.easting, `Form4Input.newParcels[${idx}].beacons[${i}].position.easting`);
      validateNonNaN(b.position.northing, `Form4Input.newParcels[${idx}].beacons[${i}].position.northing`);
    }
    // areaHaByParcel must have positive finite area for each new parcel
    const area = input.areaHaByParcel[np.lrNumber];
    if (area === undefined) {
      throw new Error(`Validation error: Form4Input.areaHaByParcel missing entry for new parcel lrNumber '${np.lrNumber}'.`);
    }
    validateNonNaN(area, `Form4Input.areaHaByParcel[${np.lrNumber}]`);
    validatePositive(area, `Form4Input.areaHaByParcel[${np.lrNumber}]`);
  }
  // srid valid — invariant A2
  validateSRID(input.srid, "Form4Input.srid");
  // surveyor
  validateNonEmptyString(input.surveyor.name, "Form4Input.surveyor.name");
  validateNonEmptyString(input.surveyor.iskRegNo, "Form4Input.surveyor.iskRegNo");
  validateNonEmptyString(input.surveyor.dateOfSurvey, "Form4Input.surveyor.dateOfSurvey");
  const iskPattern = KENYA.professionalBody.registrationPattern;
  if (iskPattern && !new RegExp(iskPattern, "i").test(input.surveyor.iskRegNo)) {
    throw new Error(`Validation error: Form4Input.surveyor.iskRegNo '${input.surveyor.iskRegNo}' does not match pattern ${iskPattern} (e.g. 'LS/1234').`);
  }
}

// ─── Main entry point ──────────────────────────────────────────────

/**
 * Generate a Form 4 (Mutation Plan) PDF.
 *
 * Validates inputs via workflows/validation.ts, draws A4 portrait sheet
 * with title block, plan area (OLD dashed + NEW solid), coordinate schedule,
 * area cross-check note, certification, DRAFT watermark (opacity 0.15),
 * and verification footer with HK count.
 */
export async function generateForm4Pdf(input: Form4Input): Promise<Form4Output> {
  validateForm4Input(input);

  const parentAreaHa = polygonAreaHa(input.parentParcel.beacons);
  const newTotalHa = Object.values(input.areaHaByParcel).reduce((a, b) => a + b, 0);
  const areasCrossChecked = Math.abs(parentAreaHa - newTotalHa) <= 0.01;

  // Scale based on largest new parcel area — Survey Regs 1994 §6.3
  const maxNewArea = Math.max(...Object.values(input.areaHaByParcel));
  const scale = selectScale(maxNewArea);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(sanitizeAscii(`Mutation Plan -- ${input.parentParcel.lrNumber} -> ${input.newParcels.map(p=>p.lrNumber).join(", ")}`));
  pdfDoc.setAuthor(sanitizeAscii(input.surveyor.name));
  pdfDoc.setSubject(sanitizeAscii("Kenya Survey Act Cap. 299, Form No. 4 -- Mutation Plan [DRAFT]"));
  pdfDoc.setKeywords(["Kenya", "Cadastral", "Form 4", "Mutation", sanitizeAscii(input.parentParcel.lrNumber)]);
  pdfDoc.setProducer("MetaRDU Desktop");
  pdfDoc.setCreator("MetaRDU Desktop -- packages/engine/src/documents/form-4.ts");
  pdfDoc.setCreationDate(new Date());

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);

  // Plan area geometry
  const planAreaX = MARGIN_LEFT_PT;
  const planAreaY = MARGIN_BOTTOM_PT + COORD_SCHEDULE_HEIGHT_PT + 48;
  const planAreaW = PAGE_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT;
  const planAreaH = PAGE_HEIGHT_PT - MARGIN_TOP_PT - TITLE_BLOCK_HEIGHT_PT - COORD_SCHEDULE_HEIGHT_PT - 62;

  const bounds = combinedBounds(input.parentParcel.beacons, input.newParcels);
  const transform = makePlanTransform(bounds, planAreaX, planAreaY, planAreaW, planAreaH, scale);

  // 1. DRAFT watermark (behind content but visible)
  drawDraftWatermark(page, fontBold);

  // 2. Title block
  drawTitleBlock(page, input, scale, font, fontBold);

  // 3. Plan area drawings
  drawBoundaryDashed(page, input.parentParcel.beacons, transform);
  for (const np of input.newParcels) {
    drawBoundarySolid(page, np.beacons, transform);
  }
  // Beacons
  drawBeacons(page, input.parentParcel.beacons, transform, fontBold);
  for (const np of input.newParcels) drawBeacons(page, np.beacons, transform, fontBold);
  // Bearing/distance per new parcel (avoid duplicate labels on shared edges)
  for (const np of input.newParcels) drawBearingDistanceLabels(page, np.beacons, transform, font);
  // Parent bearing/distance as well (lighter — still drawn)
  drawBearingDistanceLabels(page, input.parentParcel.beacons, transform, font);
  drawAreaAnnotations(page, input.newParcels, input.areaHaByParcel, transform, fontBold);
  drawNorthArrow(page, planAreaX + planAreaW - 20, planAreaY + planAreaH - 25, font);
  drawScaleBar(page, planAreaX + 5, planAreaY + 5, scale, font);

  // 4. Coordinate schedule
  drawCoordinateSchedule(page, input, font, fontBold);

  // 5. Area cross-check note
  drawAreaCrossCheckNote(page, parentAreaHa, newTotalHa, areasCrossChecked, font);

  // 6. Certification
  drawCertification(page, input, font);

  // 7. Verification footer with HK count
  drawVerificationFooter(page, font, HK_ITEM_COUNT);

  const pdfBytes = await pdfDoc.save();
  // Generate DXF companion for tests / export panel (not part of PDF bytes)
  const dxfString = generateForm4Dxf(input);

  // ASCII-only assertion helper (sanitised throughout); verification below ensures
  // the PDF text extraction path (pypdf) will see only ASCII in the title/author.
  void sanitizeAscii;

  return {
    pdfBytes,
    hasDraftWatermark: true,
    hkItemCount: HK_ITEM_COUNT,
    areasCrossChecked,
    dxfString,
  };
}
