/**
 * map-svg.ts — print-quality survey plan SVG builder (pure).
 *
 * Renders the project's real survey geometry (MapGeometry, in the survey's
 * projected CRS — easting/northing metres) into a cartographic plan SVG:
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  TITLE  ·  CRS LABEL                                       │
 *   │  ┌───────────────────────────────────────────┐  ↑ N        │
 *   │  │   grid + E/N labels                       │  north      │
 *   │  │   parcel boundary (orange)                │  arrow      │
 *   │  │   beacons B1..Bn (labels)                 │             │
 *   │  │   field points (dots)  ┌ legend ┐         │             │
 *   │  └────────────────────────┴────────┴─────────┘             │
 *   │  surveyor · date · scale 1:XXXX · MetaRDU v2.0             │
 *   └────────────────────────────────────────────────────────────┘
 *
 * The legend (bottom-left inside the frame) is auto-generated from the
 * geometry — only symbology actually on the sheet is listed, so a legend
 * never explains an empty symbol set.
 *
 * The SVG is sized in POINTS (72/inch) so rasterizing with
 * sharp(svg, { density: 300 }) yields a true 300-DPI print:
 *   output_px = width_pt × dpi / 72.
 * A4 landscape = 842×595 pt → 3508×2480 px at 300 DPI.
 *
 * Pure string building — no DOM, no React, no electron, no sharp. The
 * sharp rasterization lives in the main process (main/map-export.ts).
 *
 * # Why projected CRS (not WGS84)?
 *
 * Statutory survey plans are filed in the survey's grid CRS with a
 * coordinate grid + scale bar + north arrow. The interactive MapView
 * reprojects to WGS84 for the basemap; the print plan stays native.
 */

import type { MapGeometry } from "./map-geometry.js";

/** Rasterization density for the print map. */
export const PRINT_DPI = 300;

/**
 * Sheet sizes in points (72/inch), portrait orientation.
 * ISO 216 (A4–A0) plus the US ANSI sizes used by SPCS/ALTA plans.
 * Landscape callers swap width/height. A4 is the default.
 */
export const SHEET_SIZES_PT: Record<string, { widthPt: number; heightPt: number }> = {
  a4: { widthPt: 595.28, heightPt: 841.89 },
  a3: { widthPt: 841.89, heightPt: 1190.55 },
  a2: { widthPt: 1190.55, heightPt: 1683.78 },
  a1: { widthPt: 1683.78, heightPt: 2383.94 },
  a0: { widthPt: 2383.94, heightPt: 3369.45 },
  letter: { widthPt: 612, heightPt: 792 },
  legal: { widthPt: 612, heightPt: 1008 },
};

/**
 * Resolve a named sheet + orientation to portrait/landscape point
 * dimensions. Returns null for unknown sheet names.
 */
export function resolveSheetPt(
  sheetSize?: string,
  orientation?: "landscape" | "portrait",
): { widthPt: number; heightPt: number } | null {
  const base = sheetSize ? SHEET_SIZES_PT[sheetSize.toLowerCase()] : undefined;
  if (!base) return null;
  return orientation === "landscape"
    ? { widthPt: base.heightPt, heightPt: base.widthPt }
    : { widthPt: base.widthPt, heightPt: base.heightPt };
}

/**
 * Map scale mode: auto-fit to the sheet, or a fixed 1:denominator
 * (the printed ground distance per paper distance is exact).
 */
export type SurveyMapScaleMode =
  | { mode: "fit" }
  | { mode: "fixed"; denominator: number };

export interface SurveyMapSvgOptions {
  /** Plan title (e.g. project name). */
  title: string;
  /** Coordinate system label, e.g. "Arc 1960 / UTM zone 37S". */
  coordinateSystemLabel?: string;
  surveyorName?: string;
  /** ISO date string; formatted as YYYY-MM-DD. */
  date?: string;
  /**
   * Named ISO sheet (a4..a0). When provided together with `orientation`,
   * overrides the default A4 landscape and takes precedence over any
   * explicit widthPt/heightPt unless those are also supplied.
   */
  sheetSize?: string;
  /** Paper orientation for a named sheet. Default portrait dimensions. */
  orientation?: "landscape" | "portrait";
  /** Paper size in points (72/inch). Default: A4 landscape 842×595. */
  widthPt?: number;
  heightPt?: number;
  /**
   * Scale: auto-fit to the sheet (default) or a fixed 1:denominator.
   * Fixed scale draws the extent centred in the frame; when the extent is
   * larger than the frame the overflow is clipped and `fitsSheet` is false.
   */
  scaleMode?: SurveyMapScaleMode;
  /**
   * Statutory header rendered centered in the title strip (e.g.
   * "REPUBLIC OF KENYA" or "SURVEYOR-GENERAL, REPUBLIC OF SOUTH AFRICA").
   * Sourced from the country's planSheet profile.
   */
  titleBlockLabel?: string;
  /** Plan-type label prefixed to the title (e.g. "DEED PLAN", "SG DIAGRAM"). */
  planTypeLabel?: string;
  /** Statutory disclaimer printed under the footer scale line. */
  footerNote?: string;
  /**
   * Per-market statutory title-block layout (from the country planSheet
   * profile): field grid, certification block, and surveyor seal placement
   * rendered as a bordered block above the footer. Structurally mirrors
   * the country-config TitleBlockLayout so configs pass through as-is.
   */
  titleBlockLayout?: StatutoryTitleBlock;
  /**
   * Legend title override. Defaults to "LEGEND"; markets may prefer
   * "KEY" (GB) or "ZEICHENERKLÄRUNG" (DE). The legend itself is
   * auto-generated from the geometry — only symbology actually on the
   * sheet is listed (beacons / boundaries / field points), so nothing
   * explains an empty legend. Rendered bottom-left inside the frame.
   */
  legendTitle?: string;
}

/** Layout style driving the statutory block's lettering (mirrors country-config). */
export type TitleBlockVariant = "standard" | "sg-diagram" | "us-alta" | "hmlr-title-plan";

/** One statutory field row: label + optional {{token}} value (mirrors country-config). */
export interface StatutoryFieldRow {
  label: string;
  value?: string;
}

/** Certification block: heading + body lines (mirrors country-config). */
export interface StatutoryCertification {
  heading: string;
  lines: string[];
}

/** Surveyor seal placement (mirrors country-config SealPlacement). */
export interface StatutorySeal {
  position: "bottom-right" | "bottom-left" | "none";
  caption?: string;
}

/** Per-market statutory title block rendered into the plan (mirrors country-config). */
export interface StatutoryTitleBlock {
  variant?: TitleBlockVariant;
  fieldRows: StatutoryFieldRow[];
  certification?: StatutoryCertification;
  seal: StatutorySeal;
  statutoryFooterLines?: string[];
}

export interface SurveyMapSvgResult {
  /** The SVG document (point-sized, ready for sharp at PRINT_DPI). */
  svg: string;
  /** Output pixel dimensions when rasterized at PRINT_DPI. */
  widthPx: number;
  heightPx: number;
  /** Approximate map scale denominator (1:denominator). */
  scaleDenominator: number;
  /** True when the whole survey extent fits inside the map frame at the chosen scale. */
  fitsSheet: boolean;
  /** Survey extent (metres, E/N). */
  extent: { minE: number; maxE: number; minN: number; maxN: number };
}

// ─── Palette (matches MapView + app theme, ink-friendly on white) ──

const INK = "#1A1F36";        // navy — text
const MUTED = "#5A5F6E";      // secondary text
const GRID = "#D8DAE0";       // grid lines
const BOUNDARY = "#FF9500";   // parcel outline (orange)
const BEACON = "#EA8A00";     // beacon marker
const BEACON_TEXT = "#0E7490";// beacon label (dark cyan)
const FIELD = "#6B7280";      // field point dot
const CONTOUR = "#22c55e";    // topographic contour line (matches SurveyCanvas)
const FILL = "rgba(255,149,0,0.12)";

const FONT_MONO = "'DejaVu Sans Mono', monospace";
const FONT_SANS = "sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmt(v: number, digits = 0): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/**
 * Fill {{token}} placeholders in a statutory title-block value with the
 * live plan context (title, surveyor, date, scale, CRS, plan type).
 * Unknown tokens are left intact so a config typo is visible, not silent.
 */
function fillStatTokens(
  value: string,
  ctx: { title: string; surveyor: string; date: string; scale: string; crs: string; planType: string },
): string {
  return value
    .replace(/\{\{title\}\}/g, ctx.title)
    .replace(/\{\{surveyor\}\}/g, ctx.surveyor)
    .replace(/\{\{date\}\}/g, ctx.date)
    .replace(/\{\{scale\}\}/g, ctx.scale)
    .replace(/\{\{crs\}\}/g, ctx.crs)
    .replace(/\{\{planType\}\}/g, ctx.planType);
}

/**
 * Word-wrap statutory text (certification lines) to a max mono-char width
 * so long statements wrap inside their box instead of bleeding past the
 * edge. Same greedy word-wrap as the footerNote path.
 */
function wrapStatutoryLines(lines: string[], charsPerLine: number): string[] {
  const out: string[] = [];
  for (const src of lines) {
    const words = src.split(/\s+/);
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (test.length > charsPerLine && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * Round a raw step up to a "nice" 1/2/5×10^k value.
 */
function niceStep(raw: number): number {
  if (raw <= 0 || !Number.isFinite(raw)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return step * mag;
}

/** True if a polygon ring is closed (first vertex repeats at the end). */
function isClosedRing(vertices: { easting: number; northing: number }[]): boolean {
  if (vertices.length < 4) return false;
  const a = vertices[0]!;
  const b = vertices[vertices.length - 1]!;
  return a.easting === b.easting && a.northing === b.northing;
}

/**
 * Build the survey plan SVG.
 */
export function buildSurveyMapSvg(
  geometry: MapGeometry,
  options: SurveyMapSvgOptions,
): SurveyMapSvgResult {
  const sheet = resolveSheetPt(options.sheetSize, options.orientation);
  const widthPt = options.widthPt ?? sheet?.widthPt ?? 842;   // A4 landscape
  const heightPt = options.heightPt ?? sheet?.heightPt ?? 595;
  const MARGIN = 36;
  const TOP_STRIP_H = 40;                   // title bar

  // ─── Statutory title-block geometry ───────────────────────────────
  // When the country's planSheet defines a titleBlockLayout, a bordered
  // statutory block (field grid + certification box + surveyor seal)
  // renders between the map frame and the footer, and any
  // statutoryFooterLines stack below the footer text. Both grow the
  // bottom strip so nothing collides or overflows the sheet.
  //
  // The block height is computed up-front from its content:
  //   - certification lines are word-wrapped to the box width BEFORE
  //     sizing, so long ALTA statements never bleed past the box edge;
  //   - field values that would collide with their label wrap to a
  //     second line under the label (GB's "ORDNANCE SURVEY MAP
  //     REFERENCE" + a long CRS name must never overlap).
  const statutory = options.titleBlockLayout;
  const statFooterLines = statutory?.statutoryFooterLines ?? [];
  const noteLineCount = options.footerNote ? 2 : 0;   // footerNote caps at 2
  const extraFooterLines = statFooterLines.length + noteLineCount;
  const bottomPad = MARGIN + Math.max(0, extraFooterLines * 8.5 - 8);

  const blockW = widthPt - 2 * MARGIN;
  const gridW = blockW * 0.55;
  const colW = gridW / 2;
  const certW = blockW - gridW - 20;
  // Monospace char widths at the block's font sizes (~0.6 em).
  const CERT_CHAR_W = 3.6;    // 6pt mono
  const LABEL_CHAR_W = 4.3;   // 6.5pt bold mono
  const VALUE_CHAR_W = 3.9;   // 6.5pt mono

  const certCharsPerLine = Math.max(28, Math.floor(certW / CERT_CHAR_W));
  const certWrapped = statutory?.certification
    ? wrapStatutoryLines(statutory.certification.lines, certCharsPerLine)
    : [];
  const statCertH = statutory?.certification
    ? 16 + certWrapped.length * 8.5 + 6
    : 0;

  // Shared predicate: does a field's label + filled value fit on one line?
  // Used by BOTH the height computation and the render loop so the two can
  // never drift (a drift here is what would reintroduce text overlap).
  const fieldCollides = (label: string, value: string): boolean =>
    value.length > 0 &&
    label.length * LABEL_CHAR_W + value.length * VALUE_CHAR_W > colW - 6;

  // Estimate each field value's rendered length for collision detection.
  // Reuses fillStatTokens with a fixed {{scale}} width — the true fit
  // scale isn't known until the map is sized, and 1:1,000,000 is wider
  // than any scale a statutory plan prints, so the estimate is strictly
  // conservative (always equal-or-wider than the real value).
  const estimateValue = (raw: string): string =>
    fillStatTokens(raw, {
      title: options.title,
      surveyor: options.surveyorName ?? "",
      date: options.date ?? "",
      scale: "1:1,000,000",
      crs: options.coordinateSystemLabel ?? "",
      planType: options.planTypeLabel ?? "",
    });
  const fieldRows = statutory?.fieldRows ?? [];
  const gridRowLineCounts: number[] = [];
  for (let i = 0; i < fieldRows.length; i++) {
    const row = fieldRows[i]!;
    const r = Math.floor(i / 2);
    const value = estimateValue(row.value ?? "");
    gridRowLineCounts[r] = Math.max(
      gridRowLineCounts[r] ?? 1,
      fieldCollides(row.label, value) ? 2 : 1,
    );
  }
  const statGridLineCount = gridRowLineCounts.reduce((a, b) => a + b, 0);
  const statGridH = statGridLineCount > 0 ? statGridLineCount * 13 + 8 : 0;
  const statSealH = statutory && statutory.seal.position !== "none" ? 30 : 0;
  const statBlockH = statutory ? Math.max(statGridH, statCertH) + statSealH + 8 : 0;
  const BOTTOM_STRIP_H = 44 + statBlockH;

  const mapLeft = MARGIN;
  const mapRight = widthPt - MARGIN;
  const mapTop = MARGIN + TOP_STRIP_H;
  const mapBottom = heightPt - bottomPad - BOTTOM_STRIP_H;
  const mapW = mapRight - mapLeft;
  const mapH = mapBottom - mapTop;

  // ─── Collect every point we need to bound the extent ─────────────
  // Contour vertices are part of the plot (a topo plan's contours can
  // extend past the TIN vertices they were derived from) — excluding them
  // here mapped contours to huge off-canvas coordinates.
  const pts: Array<{ e: number; n: number }> = [];
  for (const b of geometry.beacons) pts.push({ e: b.easting, n: b.northing });
  for (const b of geometry.boundaries) for (const v of b.vertices) pts.push({ e: v.easting, n: v.northing });
  for (const p of geometry.fieldPoints) pts.push({ e: p.easting, n: p.northing });
  for (const c of geometry.contours) for (const v of c.vertices) pts.push({ e: v.easting, n: v.northing });

  const hasGeometry = pts.length > 0;
  let minE = 0, maxE = 1, minN = 0, maxN = 1;
  if (hasGeometry) {
    minE = Math.min(...pts.map((p) => p.e));
    maxE = Math.max(...pts.map((p) => p.e));
    minN = Math.min(...pts.map((p) => p.n));
    maxN = Math.max(...pts.map((p) => p.n));
  }
  // Pad the extent so features aren't clipped at the frame edge.
  const padE = Math.max((maxE - minE) * 0.08, 1);
  const padN = Math.max((maxN - minN) * 0.08, 1);
  minE -= padE; maxE += padE;
  minN -= padN; maxN += padN;
  const extentW = maxE - minE;
  const extentH = maxN - minN;

  // ─── Scale ───────────────────────────────────────────────────────
  // Fit mode: scale the extent to fill the frame (as much as the aspect
  // ratio allows). Fixed mode: 1 pt = 25.4/72 mm of paper, so at scale
  // 1:denominator, scalePt = (1000 × 72) / (25.4 × denominator) pt per
  // ground metre. Fixed-scale plans are centred in the frame; overflow is
  // clipped (fitsSheet reports the fit).
  const fitScalePt = Math.min(mapW / extentW, mapH / extentH);
  const fixedDenom = options.scaleMode?.mode === "fixed" ? options.scaleMode.denominator : 0;
  const useFixed = Number.isFinite(fixedDenom) && fixedDenom > 0;
  const scalePt = useFixed ? (1000 * 72) / (25.4 * fixedDenom) : fitScalePt;

  const drawnW = extentW * scalePt;
  const drawnH = extentH * scalePt;
  // Centre the drawn extent in the frame; when it overflows, anchor to the
  // frame's left/top edges (standard CAD viewport behaviour — clip).
  const anchorX = mapLeft + Math.max(0, (mapW - drawnW) / 2);
  const anchorTop = mapTop + Math.max(0, (mapH - drawnH) / 2);
  const toX = (e: number): number => anchorX + (e - minE) * scalePt;
  const toY = (n: number): number => anchorTop + (maxN - n) * scalePt;

  // Scale denominator reported in the footer: exact for fixed mode,
  // rounded for fit mode (1 pt = 1/72 in = 25.4/72 mm on paper).
  const scaleDenominator = useFixed
    ? fixedDenom
    : Math.round((1000 * 72) / (25.4 * fitScalePt));
  const fitsSheet = drawnW <= mapW + 0.5 && drawnH <= mapH + 0.5;
  // Ground metres per point — used by the scale bar. (== 1/scalePt.)
  const mPerPt = 1 / scalePt;

  // ─── Grid step (target ~5 divisions across the map) ─────────────
  const gridStepE = niceStep(extentW / 5);
  const gridStepN = niceStep(extentH / 5);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPt}" height="${heightPt}" ` +
    `viewBox="0 0 ${widthPt} ${heightPt}" font-family="${FONT_SANS}">`,
    `<rect width="100%" height="100%" fill="#FFFFFF"/>`,
  );

  // ─── Title strip ─────────────────────────────────────────────────
  // Statutory header (titleBlockLabel) centered, plan-type prefix on the
  // title (left), CRS label (right). Mirrors per-country title-block
  // conventions so the sheet is filed as-is.
  const titleText = options.planTypeLabel
    ? `${options.planTypeLabel} — ${options.title}`
    : options.title;
  parts.push(
    `<text x="${MARGIN}" y="${MARGIN + 16}" font-size="15" font-weight="bold" fill="${INK}" font-family="${FONT_SANS}">${esc(titleText)}</text>`,
  );
  if (options.titleBlockLabel) {
    parts.push(
      `<text x="${widthPt / 2}" y="${MARGIN + 12}" text-anchor="middle" font-size="8" letter-spacing="1" fill="${MUTED}" font-family="${FONT_SANS}">${esc(options.titleBlockLabel)}</text>`,
    );
  }
  if (options.coordinateSystemLabel) {
    parts.push(
      `<text x="${widthPt - MARGIN}" y="${MARGIN + 16}" font-size="9" text-anchor="end" fill="${MUTED}" font-family="${FONT_MONO}">${esc(options.coordinateSystemLabel)}</text>`,
    );
  }
  parts.push(
    `<line x1="${MARGIN}" y1="${MARGIN + 24}" x2="${widthPt - MARGIN}" y2="${MARGIN + 24}" stroke="${INK}" stroke-width="1"/>`,
  );

  // ─── Map frame ───────────────────────────────────────────────────
  parts.push(
    `<rect x="${mapLeft}" y="${mapTop}" width="${mapW}" height="${mapH}" fill="#FBFBF9" stroke="${INK}" stroke-width="1.2"/>`,
  );

  if (hasGeometry) {
    // ── Grid lines + E/N labels ─────────────────────────────────────
    for (let e = Math.ceil(minE / gridStepE) * gridStepE; e <= maxE; e += gridStepE) {
      const x = toX(e);
      parts.push(
        `<line x1="${x}" y1="${mapTop}" x2="${x}" y2="${mapBottom}" stroke="${GRID}" stroke-width="0.6"/>`,
        `<text x="${x + 3}" y="${mapBottom + 12}" font-size="7" fill="${MUTED}" font-family="${FONT_MONO}">${fmt(e)}</text>`,
      );
    }
    for (let n = Math.ceil(minN / gridStepN) * gridStepN; n <= maxN; n += gridStepN) {
      const y = toY(n);
      parts.push(
        `<line x1="${mapLeft}" y1="${y}" x2="${mapRight}" y2="${y}" stroke="${GRID}" stroke-width="0.6"/>`,
        `<text x="${mapLeft + 3}" y="${y - 3}" font-size="7" fill="${MUTED}" font-family="${FONT_MONO}">${fmt(n)}</text>`,
      );
    }

    // ── Boundaries (polygons / polylines) ───────────────────────────
    for (const boundary of geometry.boundaries) {
      const closed = isClosedRing(boundary.vertices);
      const d = boundary.vertices
        .map((v, i) => `${i === 0 ? "M" : "L"}${toX(v.easting).toFixed(2)},${toY(v.northing).toFixed(2)}`)
        .join(" ") + (closed ? " Z" : "");
      parts.push(
        `<path d="${d}" fill="${closed ? FILL : "none"}" stroke="${BOUNDARY}" stroke-width="2.2" stroke-linejoin="round"/>`,
      );
      // Boundary label near the first vertex.
      const v0 = boundary.vertices[0]!;
      parts.push(
        `<text x="${toX(v0.easting) + 8}" y="${toY(v0.northing) - 8}" font-size="8.5" font-weight="bold" fill="${BOUNDARY}" font-family="${FONT_MONO}">${esc(boundary.label)}</text>`,
      );
    }

    // ── Beacons (labeled markers) ───────────────────────────────────
    for (const beacon of geometry.beacons) {
      const x = toX(beacon.easting);
      const y = toY(beacon.northing);
      parts.push(
        `<circle cx="${x}" cy="${y}" r="4" fill="${BEACON}" stroke="#FFFFFF" stroke-width="1.4"/>`,
        `<text x="${x + 6}" y="${y - 6}" font-size="8" fill="${BEACON_TEXT}" font-weight="bold" font-family="${FONT_MONO}">${esc(beacon.label)}</text>`,
      );
    }

    // ── Field points ────────────────────────────────────────────────
    for (const fp of geometry.fieldPoints) {
      parts.push(
        `<circle cx="${toX(fp.easting)}" cy="${toY(fp.northing)}" r="1.8" fill="${FIELD}" opacity="0.85"/>`,
      );
    }

    // ── Contours (topographic elevation lines) ──────────────────────
    // Elevation-tagged polylines from the TIN extraction — the same data
    // SurveyCanvas renders — so the printed plan matches the canvas. An
    // elevation label sits at each line's first vertex.
    for (const contour of geometry.contours) {
      const d = contour.vertices
        .map((v, i) => `${i === 0 ? "M" : "L"}${toX(v.easting).toFixed(2)},${toY(v.northing).toFixed(2)}`)
        .join(" ") + (contour.closed ? " Z" : "");
      parts.push(
        `<path d="${d}" fill="none" stroke="${CONTOUR}" stroke-width="1" opacity="0.85"/>`,
      );
      const v0 = contour.vertices[0]!;
      parts.push(
        `<text x="${toX(v0.easting) + 3}" y="${toY(v0.northing) - 3}" font-size="6.5" fill="${CONTOUR}" font-family="${FONT_MONO}">${esc(contour.elevation.toFixed(1))}</text>`,
      );
    }

    // ── North arrow (top-right inside the frame) ────────────────────
    const naX = mapRight - 22;
    const naY = mapTop + 24;
    parts.push(
      `<polygon points="${naX},${naY - 10} ${naX - 5},${naY + 4} ${naX},${naY} ${naX + 5},${naY + 4}" fill="${INK}"/>`,
      `<text x="${naX}" y="${naY + 16}" text-anchor="middle" font-size="9" font-weight="bold" fill="${INK}">N</text>`,
    );

    // ── Scale bar (bottom-right inside the frame) ───────────────────
    const targetPt = 110; // desired bar length in points
    const segM = niceStep(mPerPt * targetPt);
    const segPt = segM / mPerPt;
    const sbY = mapBottom - 14;
    const sbX = mapRight - segPt - 10;
    const sbLabel = segM >= 1000 ? `${(segM / 1000).toFixed(segM % 1000 === 0 ? 0 : 1)} km` : `${fmt(segM)} m`;
    parts.push(
      `<rect x="${sbX}" y="${sbY - 4}" width="${segPt}" height="6" fill="${INK}"/>`,
      `<rect x="${sbX + segPt / 2}" y="${sbY - 4}" width="${segPt / 2}" height="6" fill="#FFFFFF" stroke="${INK}" stroke-width="0.8"/>`,
      `<line x1="${sbX}" y1="${sbY - 7}" x2="${sbX}" y2="${sbY + 5}" stroke="${INK}" stroke-width="1"/>`,
      `<line x1="${sbX + segPt}" y1="${sbY - 7}" x2="${sbX + segPt}" y2="${sbY + 5}" stroke="${INK}" stroke-width="1"/>`,
      `<text x="${sbX + segPt / 2}" y="${sbY - 12}" text-anchor="middle" font-size="7.5" fill="${INK}" font-family="${FONT_MONO}">${sbLabel}</text>`,
    );

    // ── Legend (bottom-left inside the frame) ───────────────────────
    // Auto-generated from the geometry: only the symbology actually on
    // the sheet is explained (honest — no empty legend rows). The title
    // is overridable per market (GB "KEY", DE "ZEICHENERKLÄRUNG").
    const legendTitle = options.legendTitle ?? "LEGEND";
    const legendRows: Array<{ glyph: "beacon" | "boundary" | "field" | "contour"; label: string }> = [];
    if (geometry.beacons.length > 0) legendRows.push({ glyph: "beacon", label: "Beacon" });
    if (geometry.boundaries.length > 0) legendRows.push({ glyph: "boundary", label: "Boundary" });
    if (geometry.fieldPoints.length > 0) legendRows.push({ glyph: "field", label: "Field point" });
    if (geometry.contours.length > 0) legendRows.push({ glyph: "contour", label: "Contour" });
    if (legendRows.length > 0) {
      const lgRowH = 13;
      const lgW = 96;
      const lgH = 18 + legendRows.length * lgRowH + 6;
      const lgX = mapLeft + 10;
      const lgY = mapBottom - lgH - 10;
      parts.push(
        `<rect x="${lgX}" y="${lgY}" width="${lgW}" height="${lgH}" fill="#FFFFFF" stroke="${INK}" stroke-width="0.8"/>`,
        `<text x="${lgX + 6}" y="${lgY + 11}" font-size="7" font-weight="bold" letter-spacing="0.5" fill="${INK}">${esc(legendTitle)}</text>`,
      );
      legendRows.forEach((row, i) => {
        const ry = lgY + 18 + i * lgRowH;
        if (row.glyph === "beacon") {
          parts.push(
            `<circle cx="${lgX + 11}" cy="${ry + 4}" r="3.2" fill="${BEACON}" stroke="#FFFFFF" stroke-width="1"/>`,
          );
        } else if (row.glyph === "boundary") {
          parts.push(
            `<line x1="${lgX + 6}" y1="${ry + 4}" x2="${lgX + 16}" y2="${ry + 4}" stroke="${BOUNDARY}" stroke-width="2.2"/>`,
          );
        } else if (row.glyph === "contour") {
          parts.push(
            `<line x1="${lgX + 6}" y1="${ry + 4}" x2="${lgX + 16}" y2="${ry + 4}" stroke="${CONTOUR}" stroke-width="1.2"/>`,
          );
        } else {
          parts.push(
            `<circle cx="${lgX + 11}" cy="${ry + 4}" r="1.8" fill="${FIELD}" opacity="0.85"/>`,
          );
        }
        parts.push(
          `<text x="${lgX + 22}" y="${ry + 7}" font-size="7" fill="${MUTED}" font-family="${FONT_MONO}">${esc(row.label)}</text>`,
        );
      });
    }
  } else {
    // Honest empty state — a note instead of a blank frame.
    parts.push(
      `<text x="${(mapLeft + mapRight) / 2}" y="${(mapTop + mapBottom) / 2}" text-anchor="middle" font-size="11" fill="${MUTED}">No plottable geometry in this survey output.</text>`,
    );
  }

  // ─── Statutory title block (per-country, between map and footer) ────
  // Renders the market's statutory field grid + certification block + a
  // dashed surveyor-seal placeholder (the physical stamp lands here at
  // filing). Values fill {{token}} placeholders from the live plan
  // context; blank values render a dotted underline for manual completion.
  if (statutory && statBlockH > 0) {
    const blockTop = mapBottom + 8;
    const certX = MARGIN + gridW + 12;
    const tokenCtx = {
      title: options.title,
      surveyor: options.surveyorName ?? "",
      date: options.date ?? "",
      scale: `1:${fmt(scaleDenominator)}`,
      crs: options.coordinateSystemLabel ?? "",
      planType: options.planTypeLabel ?? "",
    };

    parts.push(
      `<rect x="${MARGIN}" y="${blockTop}" width="${blockW}" height="${statBlockH}" fill="#FFFFFF" stroke="${INK}" stroke-width="0.8"/>`,
    );
    // ── Field grid (label + filled value, or dotted blank for manual fill) ──
    // Grid rows advance by their wrapped line count, so a value that
    // collides with its label renders on its own line below the label.
    let gridLineOffset = 0;
    statutory.fieldRows.forEach((row, i) => {
      const col = i % 2;
      const rowIdx = Math.floor(i / 2);
      const x = MARGIN + 10 + col * colW;
      const y = blockTop + 8 + gridLineOffset * 13 + 6;
      const value = row.value ? fillStatTokens(row.value, tokenCtx) : "";
      const collides = fieldCollides(row.label, value);
      parts.push(
        `<text x="${x}" y="${y}" font-size="6.5" font-weight="bold" fill="${INK}" font-family="${FONT_MONO}">${esc(row.label)}</text>`,
      );
      if (value && !collides) {
        parts.push(
          `<text x="${x + colW - 8}" y="${y}" text-anchor="end" font-size="6.5" fill="${INK}" font-family="${FONT_MONO}">${esc(value)}</text>`,
        );
      } else if (value && collides) {
        // Too wide for the row — own line under the label (full value,
        // never truncated: statutory fields must carry the complete text).
        parts.push(
          `<text x="${x}" y="${y + 10}" font-size="6.5" fill="${INK}" font-family="${FONT_MONO}">${esc(value)}</text>`,
        );
      } else {
        // Blank statutory field — honest dotted underline for manual fill.
        parts.push(
          `<line x1="${x + colW - 110}" y1="${y + 2}" x2="${x + colW - 8}" y2="${y + 2}" stroke="${GRID}" stroke-width="0.7" stroke-dasharray="2,1.6"/>`,
        );
      }
      // Advance the shared grid cursor when a grid row is complete.
      if (col === 1 || i === statutory.fieldRows.length - 1) {
        gridLineOffset += gridRowLineCounts[rowIdx] ?? 1;
      }
    });
    // ── Certification block (boxed heading + wrapped statutory wording) ──
    if (statutory.certification) {
      const certH = 16 + certWrapped.length * 8.5 + 6;
      parts.push(
        `<rect x="${certX}" y="${blockTop + 8}" width="${certW}" height="${certH}" fill="none" stroke="${INK}" stroke-width="0.7"/>`,
        `<text x="${certX + 6}" y="${blockTop + 20}" font-size="6.5" font-weight="bold" letter-spacing="0.5" fill="${INK}" font-family="${FONT_MONO}">${esc(statutory.certification.heading)}</text>`,
      );
      certWrapped.forEach((ln, i) => {
        parts.push(
          `<text x="${certX + 6}" y="${blockTop + 31 + i * 8.5}" font-size="6" fill="${MUTED}" font-family="${FONT_MONO}">${esc(ln)}</text>`,
        );
      });
    }
    // ── Surveyor seal (dashed placeholder — physical stamp lands here) ──
    if (statutory.seal.position !== "none") {
      const sealX =
        statutory.seal.position === "bottom-left"
          ? MARGIN + 30
          : widthPt - MARGIN - 30;
      const sealY = blockTop + statBlockH - 18;
      parts.push(
        `<circle cx="${sealX}" cy="${sealY}" r="11" fill="none" stroke="${INK}" stroke-width="0.9" stroke-dasharray="2.5,1.6"/>`,
        `<text x="${sealX}" y="${sealY + 15}" text-anchor="middle" font-size="5.5" fill="${MUTED}" font-family="${FONT_MONO}">${esc(statutory.seal.caption ?? "SURVEYOR'S SEAL")}</text>`,
      );
    }
  }

  // ─── Footer strip ────────────────────────────────────────────────
  const footerY = heightPt - bottomPad + 4;
  parts.push(
    `<line x1="${MARGIN}" y1="${heightPt - bottomPad - 8}" x2="${widthPt - MARGIN}" y2="${heightPt - bottomPad - 8}" stroke="${INK}" stroke-width="0.8"/>`,
    `<text x="${MARGIN}" y="${footerY}" font-size="8.5" fill="${MUTED}">${esc(options.surveyorName ? `Surveyor: ${options.surveyorName}  ·  ` : "")}${esc(options.date ?? "")}</text>`,
    `<text x="${widthPt / 2}" y="${footerY}" text-anchor="middle" font-size="8.5" fill="${MUTED}">Scale 1:${fmt(scaleDenominator)}</text>`,
    `<text x="${widthPt - MARGIN}" y="${footerY}" text-anchor="end" font-size="8.5" fill="${MUTED}">MetaRDU Desktop v2.0</text>`,
  );
  // Statutory footer lines (e.g. GB OS Crown-copyright statement) then
  // the statutory footerNote — stacked, never truncated silently.
  let footerLineIdx = 0;
  for (const ln of statFooterLines) {
    parts.push(
      `<text x="${MARGIN}" y="${footerY + 12 + footerLineIdx * 8.5}" font-size="6.5" fill="${MUTED}" font-family="${FONT_MONO}">${esc(ln)}</text>`,
    );
    footerLineIdx += 1;
  }
  if (options.footerNote) {
    const note = options.footerNote.trim();
    const charsPerLine = Math.max(40, Math.floor((widthPt - 2 * MARGIN) / 4.6)); // ~4.6pt per 7px mono char
    const words = note.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (test.length > charsPerLine && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    // Cap at 2 rendered lines; any dropped remainder is marked with an
    // ellipsis so a statutory disclaimer is never silently truncated.
    if (lines.length > 2) {
      lines[1] = `${lines[1]!} …`;
      lines.length = 2;
    }
    lines.forEach((ln, i) => {
      parts.push(
        `<text x="${MARGIN}" y="${footerY + 12 + (footerLineIdx + i) * 8.5}" font-size="7" fill="${MUTED}" font-family="${FONT_MONO}">${esc(ln)}</text>`,
      );
    });
  }

  parts.push(`</svg>`);

  return {
    svg: parts.join("\n"),
    widthPx: Math.round((widthPt * PRINT_DPI) / 72),
    heightPx: Math.round((heightPt * PRINT_DPI) / 72),
    scaleDenominator,
    fitsSheet,
    extent: { minE, maxE, minN, maxN },
  };
}
