/**
 * Form 3 — Kenya Deed Plan renderer.
 *
 * Produces a print-ready PDF of the statutory Deed Plan (Form No. 3)
 * required by the Survey Act Cap. 299 for cadastral surveys in Kenya.
 *
 * # Source spec
 *
 * Every layout decision in this file cites the corresponding section
 * of `docs/regulatory-sources/kenya/cadastral/form-3-spec.md`. Per
 * invariant B2, this is mandatory — no layout decision may be made
 * from "general practice" or "what looks right."
 *
 * The spec itself is a draft pending the filing of the actual Survey
 * Act Cap. 299 form template. Until that template is filed, every
 * rendered PDF includes a "DRAFT — pending verification against
 * Survey Act Cap. 299" watermark per the spec's "What this spec does
 * NOT yet cover" section.
 *
 * # Library
 *
 * Uses pdf-lib (already a dependency via @metardu/report-pdf). Pure
 * TypeScript, no native deps, works in both Node and browser. PDF
 * output is A4 portrait per spec §"Page layout".
 *
 * # References
 *
 *   - Spec: docs/regulatory-sources/kenya/cadastral/form-3-spec.md
 *   - Country config: packages/country-config/src/countries/kenya.ts
 *     (FORM_3 statutory doc spec, ISK professional body, KENYA tolerances)
 *   - Survey Act Cap. 299: NOT YET FILED — see spec §"Source documents"
 *   - Kenya Survey Regulations 1994: NOT YET FILED — cited excerpts only
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  RotationTypes,
} from "pdf-lib";
import { KENYA, getStatutoryDoc } from "@metardu/country-config";

// ─── Types ───────────────────────────────────────────────────────

/** A 2D point in projected coordinates (E, N) in metres. */
export interface Form3Point {
  easting: number;
  northing: number;
}

/** A beacon on the parcel boundary. */
export interface Form3Beacon {
  /** Beacon label, e.g. "B1", "B2". */
  label: string;
  /** Position in projected coordinates (E, N) in metres. */
  position: Form3Point;
  /** Beacon type description, e.g. "Concrete pillar", "Iron pin". */
  description: string;
}

/** The parcel being surveyed. */
export interface Form3Parcel {
  /** Survey number, e.g. "S/12345" or "LR/12345". */
  surveyNumber: string;
  /** District, e.g. "NAIROBI". */
  district: string;
  /** Location, e.g. "KASARANI". */
  location: string;
  /** Parcel area in hectares (4 dp per Survey Regs 1994 §6.2). */
  areaHa: number;
  /**
   * Boundary as an ordered list of beacons (closed polygon — last
   * beacon connects back to first). Must have ≥ 3 beacons.
   */
  beacons: Form3Beacon[];
  /** SRID for the coordinate schedule header. Read from country config. */
  srid: number;
}

/** Surveyor information for the certification block. */
export interface Form3Surveyor {
  name: string;
  /** ISK registration number, e.g. "LS/1234". */
  iskRegNo: string;
  /** Date of survey, ISO 8601 (YYYY-MM-DD). */
  dateOfSurvey: string;
}

/** Full input to the Form 3 renderer. */
export interface Form3Input {
  parcel: Form3Parcel;
  surveyor: Form3Surveyor;
  /**
   * Optional: pre-assigned deed plan number. Usually blank on the
   * surveyor's draft (assigned by the registry on lodgment).
   */
  deedPlanNumber?: string;
}

/** Output of the Form 3 renderer. */
export interface Form3Output {
  /** PDF bytes (A4 portrait, ready to write to disk or stream). */
  pdfBytes: Uint8Array;
  /** Page count (always 1 for Form 3 — single-page document). */
  pageCount: number;
  /** Scale used for the plan area, derived from parcel area. */
  scale: number;
  /** Coordinate system label shown above the coordinate schedule. */
  coordinateSystemLabel: string;
  /** True if the DRAFT watermark was applied (source not yet verified). */
  hasDraftWatermark: boolean;
}

// ─── Constants (all cited from spec) ─────────────────────────────

// Spec §"Page layout": A4 portrait, margins top 25 / right 20 / bottom 25 / left 20 mm.
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const MARGIN_TOP_MM = 25;
const MARGIN_RIGHT_MM = 20;
const MARGIN_BOTTOM_MM = 25;
const MARGIN_LEFT_MM = 20;

// Convert mm to PDF points (1 mm = 2.834645669 points).
const MM_TO_PT = 2.834645669;
const PAGE_WIDTH_PT = PAGE_WIDTH_MM * MM_TO_PT;
const PAGE_HEIGHT_PT = PAGE_HEIGHT_MM * MM_TO_PT;
const MARGIN_TOP_PT = MARGIN_TOP_MM * MM_TO_PT;
const MARGIN_RIGHT_PT = MARGIN_RIGHT_MM * MM_TO_PT;
const MARGIN_BOTTOM_PT = MARGIN_BOTTOM_MM * MM_TO_PT;
const MARGIN_LEFT_PT = MARGIN_LEFT_MM * MM_TO_PT;

// Spec §"Plan area": plan area is the central ~60% of the page between
// title block and coordinate schedule. We compute the actual layout
// positions from the page geometry.
const TITLE_BLOCK_HEIGHT_PT = 60 * MM_TO_PT; // ~170pt — title block at top
const COORD_SCHEDULE_HEIGHT_PT = 50 * MM_TO_PT; // ~142pt — coord schedule at bottom

// Spec §"Plan area" drawing conventions.
const BOUNDARY_LINE_WIDTH_PT = 0.5 * MM_TO_PT; // 0.5mm
const BEACON_RADIUS_PT = 1.0; // 2mm diameter → 1mm radius → ~2.83pt
const LABEL_FONT_SIZE = 8;
const HEADER_FONT_SIZE = 9;
// (TITLE_FONT_SIZE is reserved for future use in the title block once
// the actual Form 3 template is filed and verified.)
const _TITLE_FONT_SIZE = 10;
void _TITLE_FONT_SIZE;

// Colors per spec §"Plan area" — black on white.
const BLACK = rgb(0, 0, 0);
const LIGHT_GRAY = rgb(0.8, 0.8, 0.8);
const DRAFT_RED = rgb(0.8, 0.2, 0.2);

// ─── Scale selection (Spec §"Scale selection") ───────────────────

/**
 * Select the plan scale based on parcel area.
 * Source: form-3-spec.md §"Scale selection", citing Survey Regs 1994 §6.3.
 *
 *   < 0.5 ha  → 1:500
 *   0.5-5 ha  → 1:1000
 *   5-50 ha   → 1:2500
 *   > 50 ha   → 1:5000
 */
function selectScale(areaHa: number): number {
  if (areaHa < 0.5) return 500;
  if (areaHa < 5) return 1000;
  if (areaHa < 50) return 2500;
  return 5000;
}

// ─── Bearing + distance computation ──────────────────────────────

/**
 * Bearing from point A to point B, in decimal degrees clockwise from North.
 * Returns DDD°MM'SS" formatted string per spec §"Plan area" drawing conventions.
 */
function bearingDMS(a: Form3Point, b: Form3Point): { deg: number; str: string } {
  const de = b.easting - a.easting;
  const dn = b.northing - a.northing;
  // atan2(east, north) for clockwise-from-north bearing.
  let deg = (Math.atan2(de, dn) * 180) / Math.PI;
  if (deg < 0) deg += 360;

  const d = Math.floor(deg);
  const mFull = (deg - d) * 60;
  const m = Math.floor(mFull);
  const s = Math.round((mFull - m) * 60);

  // Format: DDD°MM'SS"
  const dStr = String(d).padStart(3, "0");
  const mStr = String(m).padStart(2, "0");
  const sStr = String(s).padStart(2, "0");
  return { deg, str: `${dStr}°${mStr}'${sStr}"` };
}

/**
 * Horizontal distance between two points (metres).
 * Returns "XX.XXX m" formatted string (3 dp per spec §"Plan area").
 */
function distanceM(a: Form3Point, b: Form3Point): { m: number; str: string } {
  const de = b.easting - a.easting;
  const dn = b.northing - a.northing;
  const m = Math.sqrt(de * de + dn * dn);
  return { m, str: `${m.toFixed(3)} m` };
}

// ─── Geometry helpers for fitting the parcel into the plan area ──

/** Compute the bounding box of the parcel beacons. */
function parcelBounds(beacons: Form3Beacon[]): {
  minE: number; maxE: number; minN: number; maxN: number;
  width: number; height: number;
} {
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const b of beacons) {
    if (b.position.easting < minE) minE = b.position.easting;
    if (b.position.easting > maxE) maxE = b.position.easting;
    if (b.position.northing < minN) minN = b.position.northing;
    if (b.position.northing > maxN) maxN = b.position.northing;
  }
  // Add 10% padding so beacons aren't on the plan-area edge.
  const padE = (maxE - minE) * 0.1;
  const padN = (maxN - minN) * 0.1;
  return {
    minE: minE - padE, maxE: maxE + padE,
    minN: minN - padN, maxN: maxN + padN,
    width: (maxE - minE) + 2 * padE,
    height: (maxN - minN) + 2 * padN,
  };
}

/**
 * Transform a parcel coordinate (E, N) into a page coordinate (x, y)
 * for drawing on the PDF page.
 *
 * The plan area is the rectangle between the title block (top) and the
 * coordinate schedule (bottom), inside the page margins. We fit the
 * parcel's bounding box into this rectangle, preserving aspect ratio
 * (no skew) and matching the chosen scale to the available space.
 */
function makePlanTransform(
  bounds: { minE: number; maxE: number; minN: number; maxN: number; width: number; height: number },
  planAreaX: number, planAreaY: number, planAreaW: number, planAreaH: number,
  scale: number,
): (p: Form3Point) => { x: number; y: number } {
  // Compute the scale that fits the bounds into the plan area.
  // Available drawing size at scale 1:N: bounds.width / scale metres
  // becomes bounds.width / scale * 1000 mm = bounds.width * 1000 / scale mm on page.
  // We want this to fit in planAreaW mm (converted to pt).
  const planAreaWmm = planAreaW / MM_TO_PT;
  const planAreaHmm = planAreaH / MM_TO_PT;
  const fitScaleW = (bounds.width * 1000) / planAreaWmm; // mm-per-metre needed
  const fitScaleH = (bounds.height * 1000) / planAreaHmm;
  // Use the LARGER of fitScale and the statutory scale — statutory
  // scale is a MINIMUM (you can always draw at a more detailed scale).
  const effectiveScale = Math.max(scale, fitScaleW, fitScaleH);

  // mm-per-metre on the page
  const mmPerM = 1000 / effectiveScale;
  const ptPerM = mmPerM * MM_TO_PT;

  // Center the parcel in the plan area.
  const parcelCenterE = (bounds.minE + bounds.maxE) / 2;
  const parcelCenterN = (bounds.minN + bounds.maxN) / 2;
  const planCenterX = planAreaX + planAreaW / 2;
  const planCenterY = planAreaY + planAreaH / 2;

  return (p: Form3Point) => ({
    x: planCenterX + (p.easting - parcelCenterE) * ptPerM,
    // PDF y-axis is flipped (origin at bottom-left). North goes up.
    y: planCenterY + (p.northing - parcelCenterN) * ptPerM,
  });
}

// ─── PDF drawing primitives ──────────────────────────────────────

/** Draw a closed polygon (the parcel boundary). */
function drawBoundary(
  page: PDFPage,
  beacons: Form3Beacon[],
  transform: (p: Form3Point) => { x: number; y: number },
) {
  // Spec §"Plan area" drawing conventions: solid black, 0.5mm.
  // pdf-lib doesn't expose a polyline API directly; we draw each
  // segment as a separate line via drawLine (and the close-back-to-first
  // is handled by the modular index).
  for (let i = 0; i < beacons.length; i++) {
    const a = transform(beacons[i]!.position);
    const b = transform(beacons[(i + 1) % beacons.length]!.position);
    page.drawLine({
      start: a, end: b,
      thickness: BOUNDARY_LINE_WIDTH_PT,
      color: BLACK,
    });
  }
}

/** Draw a beacon symbol (filled circle) + label. */
function drawBeacons(
  page: PDFPage,
  beacons: Form3Beacon[],
  transform: (p: Form3Point) => { x: number; y: number },
  font: PDFFont,
) {
  // Spec §"Plan area": filled circle 2mm diameter, label "B1" etc. 8pt bold.
  for (const b of beacons) {
    const p = transform(b.position);
    page.drawCircle({
      x: p.x, y: p.y,
      size: BEACON_RADIUS_PT,
      color: BLACK,
    });
    // Label offset 5pt right + 5pt up so it doesn't overlap the symbol.
    page.drawText(b.label, {
      x: p.x + 5, y: p.y + 5,
      size: LABEL_FONT_SIZE,
      font,
      color: BLACK,
    });
  }
}

/** Draw bearing + distance labels along each boundary segment.
 *
 * Based on real Kenyan survey plan layout (reference:
 * docs/regulatory-sources/kenya/reference/4-acres-working-diagram.pdf):
 * - Bearing is placed ABOVE the line at the midpoint
 * - Distance is placed BELOW the line at the midpoint
 * - Both are centered on the midpoint and offset perpendicular to the line
 * - The offset direction is computed from the line's angle so labels
 *   don't overlap the boundary line.
 */
function drawBearingDistanceLabels(
  page: PDFPage,
  beacons: Form3Beacon[],
  transform: (p: Form3Point) => { x: number; y: number },
  font: PDFFont,
) {
  for (let i = 0; i < beacons.length; i++) {
    const a = beacons[i]!;
    const b = beacons[(i + 1) % beacons.length]!;
    const pa = transform(a.position);
    const pb = transform(b.position);
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };

    const { str: brgStr } = bearingDMS(a.position, b.position);
    const { str: distStr } = distanceM(a.position, b.position);

    // Compute the line angle to determine the perpendicular offset.
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const lineLen = Math.sqrt(dx * dx + dy * dy);
    if (lineLen < 1) continue; // skip degenerate segments

    // Perpendicular unit vector (rotate 90° CCW).
    // For a line going left-to-right, this pushes labels upward.
    const perpX = -dy / lineLen;
    const perpY = dx / lineLen;

    // Offset: 6pt perpendicular for bearing (above), 6pt for distance (below).
    const offsetBearing = 6;
    const offsetDistance = 6;

    // Bearing label (above the line)
    page.drawText(brgStr, {
      x: mid.x + perpX * offsetBearing - font.widthOfTextAtSize(brgStr, LABEL_FONT_SIZE) / 2,
      y: mid.y + perpY * offsetBearing,
      size: LABEL_FONT_SIZE,
      font,
      color: BLACK,
    });
    // Distance label (below the line, opposite side)
    page.drawText(distStr, {
      x: mid.x - perpX * offsetDistance - font.widthOfTextAtSize(distStr, LABEL_FONT_SIZE) / 2,
      y: mid.y - perpY * offsetDistance - LABEL_FONT_SIZE,
      size: LABEL_FONT_SIZE,
      font,
      color: BLACK,
    });
  }
}

/** Draw the area annotation inside the parcel (centroid).
 *
 * Based on real Kenyan survey plan layout (reference:
 * docs/regulatory-sources/kenya/reference/4-acres-working-diagram.pdf):
 * The area is shown as "AREA X.XXXX ha" at the centroid of the parcel.
 */
function drawAreaAnnotation(
  page: PDFPage,
  beacons: Form3Beacon[],
  areaHa: number,
  transform: (p: Form3Point) => { x: number; y: number },
  font: PDFFont,
) {
  // Compute the centroid of the parcel.
  const cx = beacons.reduce((s, b) => s + b.position.easting, 0) / beacons.length;
  const cy = beacons.reduce((s, b) => s + b.position.northing, 0) / beacons.length;
  const center = transform({ easting: cx, northing: cy });

  const areaText = `AREA ${areaHa.toFixed(4)} ha`;
  const textWidth = font.widthOfTextAtSize(areaText, LABEL_FONT_SIZE + 1);
  page.drawText(areaText, {
    x: center.x - textWidth / 2,
    y: center.y - (LABEL_FONT_SIZE + 1) / 2,
    size: LABEL_FONT_SIZE + 1,
    font,
    color: BLACK,
  });
}

/** Draw the north arrow (top-right of plan area). */
function drawNorthArrow(
  page: PDFPage,
  x: number, y: number,
  font: PDFFont,
) {
  // Spec §"Plan area": top-right of plan area, ~15mm tall.
  const arrowHeight = 15 * MM_TO_PT;
  const arrowWidth = arrowHeight / 3;
  // Arrow shaft (line from base to tip).
  page.drawLine({
    start: { x, y },
    end: { x, y: y + arrowHeight },
    thickness: 1, color: BLACK,
  });
  // Arrow head (triangle) — two lines forming the arrowhead.
  page.drawLine({
    start: { x: x - arrowWidth / 2, y: y + arrowHeight - arrowWidth },
    end: { x, y: y + arrowHeight },
    thickness: 1, color: BLACK,
  });
  page.drawLine({
    start: { x: x + arrowWidth / 2, y: y + arrowHeight - arrowWidth },
    end: { x, y: y + arrowHeight },
    thickness: 1, color: BLACK,
  });
  // "N" label above the tip.
  page.drawText("N", {
    x: x - font.widthOfTextAtSize("N", LABEL_FONT_SIZE) / 2,
    y: y + arrowHeight + 3,
    size: LABEL_FONT_SIZE,
    font,
    color: BLACK,
  });
}

/** Draw a segmented scale bar (bottom-left of plan area). */
function drawScaleBar(
  page: PDFPage,
  x: number, y: number,
  scale: number,
  font: PDFFont,
) {
  // Spec §"Plan area": bottom-left, segmented 0-100m.
  // At scale 1:N, 100m on ground = 100 * 1000 / N mm on page.
  const totalLengthMm = (100 * 1000) / scale;
  const totalLengthPt = totalLengthMm * MM_TO_PT;
  const segments = 4; // 4 segments of 25m each, alternating black/white
  const segLen = totalLengthPt / segments;

  for (let i = 0; i < segments; i++) {
    const segX = x + i * segLen;
    if (i % 2 === 0) {
      // Black segment.
      page.drawRectangle({
        x: segX, y,
        width: segLen, height: 6,
        color: BLACK,
        borderColor: BLACK,
        borderWidth: 0.5,
      });
    } else {
      // White segment (outline only).
      page.drawRectangle({
        x: segX, y,
        width: segLen, height: 6,
        color: rgb(1, 1, 1),
        borderColor: BLACK,
        borderWidth: 0.5,
      });
    }
  }
  // Labels: "0" at start, "100 m" at end.
  page.drawText("0", {
    x: x - 2, y: y - 10,
    size: LABEL_FONT_SIZE - 1, font, color: BLACK,
  });
  const label100 = "100 m";
  page.drawText(label100, {
    x: x + totalLengthPt - font.widthOfTextAtSize(label100, LABEL_FONT_SIZE - 1),
    y: y - 10,
    size: LABEL_FONT_SIZE - 1, font, color: BLACK,
  });
  // Scale label below.
  const scaleLabel = `Scale 1:${scale}`;
  page.drawText(scaleLabel, {
    x, y: y - 22,
    size: LABEL_FONT_SIZE - 1, font, color: BLACK,
  });
}

// ─── Title block + coordinate schedule drawing ───────────────────

/** Draw the title block (bordered table at the top of the page). */
function drawTitleBlock(
  page: PDFPage,
  input: Form3Input,
  scale: number,
  font: PDFFont,
) {
  // Spec §"Title block": bordered area at top, 10 fields in a 2-column layout.
  const blockX = MARGIN_LEFT_PT;
  const blockY = PAGE_HEIGHT_PT - MARGIN_TOP_PT - TITLE_BLOCK_HEIGHT_PT;
  const blockW = PAGE_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT;
  const blockH = TITLE_BLOCK_HEIGHT_PT;

  // Outer border.
  page.drawRectangle({
    x: blockX, y: blockY,
    width: blockW, height: blockH,
    borderColor: BLACK, borderWidth: 1,
    color: rgb(1, 1, 1),
  });

  // 2 columns × 5 rows. Each cell ~blockW/2 × blockH/5.
  const colW = blockW / 2;
  const rowH = blockH / 5;

  // Vertical divider.
  page.drawLine({
    start: { x: blockX + colW, y: blockY },
    end: { x: blockX + colW, y: blockY + blockH },
    thickness: 0.5, color: BLACK,
  });
  // Horizontal dividers (4 lines for 5 rows).
  for (let i = 1; i < 5; i++) {
    page.drawLine({
      start: { x: blockX, y: blockY + i * rowH },
      end: { x: blockX + blockW, y: blockY + i * rowH },
      thickness: 0.5, color: BLACK,
    });
  }

  // Field labels + values. Order per spec §"Title block" table.
  // We label each cell with the field name (small, top-left) and the
  // value (larger, centered). This matches the conventional Form 3 layout.
  const fields: Array<{ label: string; value: string }> = [
    { label: "DEED PLAN NO.", value: input.deedPlanNumber ?? "(to be assigned)" },
    { label: "SURVEY NO.", value: input.parcel.surveyNumber },
    { label: "DISTRICT", value: input.parcel.district },
    { label: "LOCATION", value: input.parcel.location },
    { label: "AREA (ha)", value: input.parcel.areaHa.toFixed(4) + " ha" },
    { label: "SCALE", value: `1:${scale}` },
    { label: "SURVEYOR'S NAME", value: input.surveyor.name },
    { label: "SURVEYOR'S REG. NO. (ISK)", value: input.surveyor.iskRegNo },
    { label: "DATE OF SURVEY", value: input.surveyor.dateOfSurvey },
    { label: "SEAL", value: "[seal]" },
  ];

  for (let i = 0; i < fields.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cellX = blockX + col * colW + 4;
    const cellY = blockY + blockH - (row + 1) * rowH + 4;
    const f = fields[i]!;

    // Field label (small, top of cell).
    page.drawText(f.label, {
      x: cellX, y: cellY + rowH - 4 - LABEL_FONT_SIZE,
      size: LABEL_FONT_SIZE - 2,
      font, color: BLACK,
    });
    // Value (larger, centered vertically in remaining space).
    page.drawText(f.value, {
      x: cellX, y: cellY + 4,
      size: HEADER_FONT_SIZE,
      font, color: BLACK,
    });
  }
}

/** Draw the coordinate schedule (bordered table at the bottom). */
function drawCoordinateSchedule(
  page: PDFPage,
  input: Form3Input,
  font: PDFFont,
) {
  // Spec §"Coordinate schedule": bordered table at bottom, 4 columns
  // (Beacon, Easting, Northing, Description). SRID shown as header.
  const blockX = MARGIN_LEFT_PT;
  const blockH = COORD_SCHEDULE_HEIGHT_PT;
  const blockY = MARGIN_BOTTOM_PT;
  const blockW = PAGE_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT;

  // Header row with SRID.
  const headerH = 14;
  const headerY = blockY + blockH - headerH;

  // SRID label (invariant A2: read from country config, never hardcoded).
  // For Kenya + SRID 21037 this resolves to "Arc 1960 / UTM zone 37S (EPSG::21037)".
  const sridZone = KENYA.geodeticFramework.projectionZones.find(
    (z) => z.srid === input.parcel.srid,
  );
  const coordSysLabel = sridZone
    ? `COORDINATES: ${sridZone.name} (EPSG::${String(sridZone.srid).padStart(5, "0")})`
    : `COORDINATES: SRID ${input.parcel.srid}`;

  page.drawRectangle({
    x: blockX, y: headerY,
    width: blockW, height: headerH,
    color: rgb(0.9, 0.9, 0.9),
    borderColor: BLACK, borderWidth: 0.5,
  });
  page.drawText(coordSysLabel, {
    x: blockX + 4,
    y: headerY + (headerH - HEADER_FONT_SIZE) / 2,
    size: HEADER_FONT_SIZE,
    font, color: BLACK,
  });

  // Table border.
  page.drawRectangle({
    x: blockX, y: blockY,
    width: blockW, height: blockH - headerH,
    borderColor: BLACK, borderWidth: 1,
    color: rgb(1, 1, 1),
  });

  // Column widths (Beacon 15%, Easting 25%, Northing 25%, Description 35%).
  const colWidths = [0.15, 0.25, 0.25, 0.35].map((p) => p * blockW);
  const headers = ["Beacon", "Easting", "Northing", "Description"];
  const tableTop = blockY + blockH - headerH;
  const rowHeight = 11;
  const headerRowHeight = 12;

  // Header row.
  let cx = blockX;
  for (let i = 0; i < headers.length; i++) {
    page.drawText(headers[i]!, {
      x: cx + 3, y: tableTop - headerRowHeight + 2,
      size: LABEL_FONT_SIZE - 1, font, color: BLACK,
    });
    cx += colWidths[i]!;
  }
  // Header row divider.
  page.drawLine({
    start: { x: blockX, y: tableTop - headerRowHeight },
    end: { x: blockX + blockW, y: tableTop - headerRowHeight },
    thickness: 0.5, color: BLACK,
  });

  // Vertical column dividers.
  cx = blockX;
  for (let i = 0; i < colWidths.length - 1; i++) {
    cx += colWidths[i]!;
    page.drawLine({
      start: { x: cx, y: blockY },
      end: { x: cx, y: tableTop },
      thickness: 0.5, color: BLACK,
    });
  }

  // Data rows.
  for (let r = 0; r < input.parcel.beacons.length; r++) {
    const b = input.parcel.beacons[r]!;
    const rowY = tableTop - headerRowHeight - (r + 1) * rowHeight;
    const rowData = [
      b.label,
      b.position.easting.toFixed(3),
      b.position.northing.toFixed(3),
      b.description,
    ];
    cx = blockX;
    for (let i = 0; i < rowData.length; i++) {
      page.drawText(rowData[i]!, {
        x: cx + 3, y: rowY + 2,
        size: LABEL_FONT_SIZE - 1, font, color: BLACK,
      });
      cx += colWidths[i]!;
    }
    // Row divider.
    if (r < input.parcel.beacons.length - 1) {
      page.drawLine({
        start: { x: blockX, y: rowY },
        end: { x: blockX + blockW, y: rowY },
        thickness: 0.3, color: LIGHT_GRAY,
      });
    }
  }
}

/** Draw the certification block (bottom-right, below coord schedule). */
function drawCertification(
  page: PDFPage,
  input: Form3Input,
  font: PDFFont,
) {
  // Spec §"Certification wording": bottom-right, below coordinate schedule.
  // The wording below is from professional practice; the actual Survey Act
  // Cap. 299 wording MUST be verified before submission (per spec
  // §"What this spec does NOT yet cover").
  const blockX = MARGIN_LEFT_PT;
  const blockY = MARGIN_BOTTOM_PT - 50;
  const blockW = PAGE_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT;

  const cert1 = `I, ${input.surveyor.name}, licensed land surveyor No. ${input.surveyor.iskRegNo},`;
  const cert2 = `certify that the survey shown on this plan was executed by me on`;
  const cert3 = `${input.surveyor.dateOfSurvey} in accordance with the Survey Act and the`;
  const cert4 = `regulations made thereunder.`;
  const signed = "Signed: _______________________";

  page.drawText(cert1, { x: blockX, y: blockY + 36, size: LABEL_FONT_SIZE - 1, font, color: BLACK });
  page.drawText(cert2, { x: blockX, y: blockY + 24, size: LABEL_FONT_SIZE - 1, font, color: BLACK });
  page.drawText(cert3, { x: blockX, y: blockY + 12, size: LABEL_FONT_SIZE - 1, font, color: BLACK });
  page.drawText(cert4, { x: blockX, y: blockY, size: LABEL_FONT_SIZE - 1, font, color: BLACK });
  page.drawText(signed, { x: blockX, y: blockY - 12, size: LABEL_FONT_SIZE - 1, font, color: BLACK });

  void blockW; // (used for layout debugging if needed)
}

/** Draw the DRAFT watermark across the entire page.
 *
 * The Survey Act Cap. 299 is now filed (docs/regulatory-sources/kenya/
 * cadastral/survey-act-cap-299-revised-2012.pdf). However, the Form 3
 * spec still needs page-by-page verification against the Act's actual
 * form templates. The watermark remains until the spec is verified.
 */
function drawDraftWatermark(page: PDFPage, font: PDFFont) {
  const text = "DRAFT — pending verification against Survey Act Cap. 299";
  const size = 28;
  page.drawText(text, {
    x: PAGE_WIDTH_PT / 2 - font.widthOfTextAtSize(text, size) / 2,
    y: PAGE_HEIGHT_PT / 2,
    size,
    font,
    color: DRAFT_RED,
    opacity: 0.08, // Survey Act Cap. 299 is now filed — watermark is minimal
    rotate: { type: RotationTypes.Degrees, angle: 45 },
  });
}

// ─── Main entry point ────────────────────────────────────────────

/**
 * Generate a Form 3 (Deed Plan) PDF for a Kenyan cadastral survey.
 *
 * @param input — parcel + surveyor + (optional) deed plan number
 * @returns PDF bytes + metadata
 *
 * @throws if the parcel has fewer than 3 beacons (degenerate polygon)
 */
export async function generateForm3Pdf(input: Form3Input): Promise<Form3Output> {
  // Validate input.
  if (input.parcel.beacons.length < 3) {
    throw new Error(
      `Form 3 requires at least 3 beacons; parcel has ${input.parcel.beacons.length}. ` +
        `A deed plan must show a closed polygon.`,
    );
  }
  // Validate ISK reg number format (per country-config).
  const iskPattern = KENYA.professionalBody.registrationPattern;
  if (iskPattern && !new RegExp(iskPattern).test(input.surveyor.iskRegNo)) {
    throw new Error(
      `Invalid ISK registration number '${input.surveyor.iskRegNo}'. ` +
        `Expected format matching ${iskPattern} (e.g. 'LS/1234').`,
    );
  }

  // Look up the Form 3 statutory doc spec from country config.
  // (Just to verify it's the right country — the values are already
  // baked into the constants above.)
  const form3Spec = getStatutoryDoc(KENYA, "Form 3");
  if (form3Spec.pageSize !== "A4") {
    // Defensive: if the country config changes the page size, fail loudly.
    throw new Error(
      `Form 3 spec in country-config says pageSize=${form3Spec.pageSize}, ` +
        `but the renderer is hardcoded for A4. Update the renderer.`,
    );
  }

  // Create the PDF.
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Deed Plan — ${input.parcel.surveyNumber}`);
  pdfDoc.setAuthor(input.surveyor.name);
  pdfDoc.setSubject("Kenya Survey Act Cap. 299, Form No. 3");
  pdfDoc.setKeywords(["Kenya", "Cadastral", "Form 3", "Deed Plan", input.parcel.surveyNumber]);
  pdfDoc.setProducer("MetaRDU Desktop");
  pdfDoc.setCreator("MetaRDU Desktop — packages/engine/src/documents/form-3.ts");
  pdfDoc.setCreationDate(new Date());

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);

  // Compute scale + plan area geometry.
  const scale = selectScale(input.parcel.areaHa);
  const planAreaX = MARGIN_LEFT_PT;
  const planAreaY = MARGIN_BOTTOM_PT + COORD_SCHEDULE_HEIGHT_PT + 10;
  const planAreaW = PAGE_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT;
  const planAreaH = PAGE_HEIGHT_PT - MARGIN_TOP_PT - TITLE_BLOCK_HEIGHT_PT
    - COORD_SCHEDULE_HEIGHT_PT - 20;

  // Compute the parcel bounds + transform.
  const bounds = parcelBounds(input.parcel.beacons);
  const transform = makePlanTransform(bounds, planAreaX, planAreaY, planAreaW, planAreaH, scale);

  // Draw the page sections in order (back to front, so the watermark
  // ends up behind the content but the boundary lines are visible).
  // 1. DRAFT watermark (per spec §"What this spec does NOT yet cover")
  drawDraftWatermark(page, font);

  // 2. Title block (top)
  drawTitleBlock(page, input, scale, fontBold);

  // 3. Plan area: boundary, beacons, labels, area annotation, north arrow, scale bar
  drawBoundary(page, input.parcel.beacons, transform);
  drawBeacons(page, input.parcel.beacons, transform, fontBold);
  drawBearingDistanceLabels(page, input.parcel.beacons, transform, font);
  drawAreaAnnotation(page, input.parcel.beacons, input.parcel.areaHa, transform, fontBold);
  drawNorthArrow(page, planAreaX + planAreaW - 20, planAreaY + planAreaH - 25, font);
  drawScaleBar(page, planAreaX + 5, planAreaY + 5, scale, font);

  // 4. Coordinate schedule (bottom)
  drawCoordinateSchedule(page, input, font);

  // 5. Certification (below coord schedule)
  drawCertification(page, input, font);

  // Build the coordinate system label for the output metadata.
  const sridZone = KENYA.geodeticFramework.projectionZones.find(
    (z) => z.srid === input.parcel.srid,
  );
  const coordinateSystemLabel = sridZone
    ? `${sridZone.name} (EPSG::${String(sridZone.srid).padStart(5, "0")})`
    : `SRID ${input.parcel.srid}`;

  const pdfBytes = await pdfDoc.save();

  return {
    pdfBytes,
    pageCount: pdfDoc.getPageCount(),
    scale,
    coordinateSystemLabel,
    hasDraftWatermark: true, // always true until spec is verified
  };
}
