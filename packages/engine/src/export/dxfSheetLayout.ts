/**
 * DXF Sheet Layout Generator
 *
 * Produces professional survey drawing sheets with title block, border,
 * north arrow, scale bar, and grid ticks — the standard deliverable every
 * surveyor hands to clients.
 *
 * Uses raw DXF text concatenation (matching settingOutDxf.ts pattern)
 * for maximum control over DXF structure and compatibility with
 * AutoCAD, LibreCAD, DraftSight, and QCAD.
 *
 * Reference standards:
 * - Survey of Kenya Drawing Standards
 * - Kenya Survey Regulations 1994
 * - ISO 1101 (Geometrical Product Specifications)
 * - ASPRS Accuracy Standards for Large-Scale Maps
 * - ISO 5457 (Technical product documentation — Sizes and layout of drawing sheets)
 * - ISO 7200 (Technical product documentation — Title blocks)
 */

// ─── Public Types ────────────────────────────────────────────────────────────

export interface SheetLayoutOptions {
  // Page
  sheetSize: 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
  orientation: 'landscape' | 'portrait';

  // Drawing scale
  scale: number;              // e.g. 1:500 means scale = 500
  units: 'metric' | 'imperial';

  // Coordinate system
  coordinateSystem: string;   // e.g. "Arc 1960 / UTM Zone 37S"

  // Project info
  projectName: string;
  projectNumber?: string;
  clientName?: string;
  surveyorName?: string;
  surveyorLicense?: string;   // e.g. ISK/LSK number
  date: string;               // ISO date string
  revision?: string;
  sheetNumber?: string;
  totalSheets?: string;

  // Drawing extents (real world coordinates in meters)
  minEasting?: number;
  maxEasting?: number;
  minNorthing?: number;
  maxNorthing?: number;

  // Display options
  showNorthArrow: boolean;
  showScaleBar: boolean;
  showGridTicks: boolean;
  gridInterval?: number;      // meters between grid ticks
  showBorder: boolean;

  // Custom layers to include
  layers?: DXFLayer[];
}

export interface DXFLayer {
  name: string;
  color: number;             // AutoCAD Color Index (ACI) 0-255
  lineType?: string;         // default CONTINUOUS
}

/** A single DXF entity to be appended to an existing file */
export interface DXFEntity {
  type: 'LINE' | 'TEXT' | 'POINT' | 'CIRCLE' | 'ARC' | 'LWPOLYLINE' | 'POLYLINE' | 'INSERT' | 'MTEXT';
  layer: string;
  /** Entity-specific properties (keyed by DXF group code) */
  props: Record<number, string | number>;
  /** For LWPOLYLINE / INSERT: extra lines of DXF data beyond props */
  extraLines?: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Sheet dimensions in mm.
 * Values are [width, height] for landscape orientation.
 * Portrait simply swaps width and height.
 */
export const SHEET_SIZES: Record<string, [number, number]> = {
  A0: [1189, 841],
  A1: [841, 594],
  A2: [594, 420],
  A3: [420, 297],
  A4: [297, 210],
};

/** Title block height in mm per sheet size */
export const TITLE_BLOCK_HEIGHTS: Record<string, number> = {
  A0: 40,
  A1: 40,
  A2: 30,
  A3: 30,
  A4: 25,
};

/** Outer border inset from sheet edge in mm */
const BORDER_INSET = 2;

/** Inner margin for the drawing area border in mm */
const INNER_MARGIN = 15;

/** Grid tick length in mm */
const GRID_TICK_LENGTH = 5;

/** North arrow block size in mm */
const NORTH_ARROW_SIZE = 12;

/** Scale bar segment height in mm */
const SCALE_BAR_HEIGHT = 3;

/** Scale bar label offset in mm */
const SCALE_BAR_LABEL_OFFSET = 2.5;

/** Standard layers included on every sheet layout */
const STANDARD_LAYERS: Array<{ name: string; color: number; lineType: string }> = [
  { name: 'BORDER',     color: 7, lineType: 'CONTINUOUS' },
  { name: 'TITLEBLOCK', color: 7, lineType: 'CONTINUOUS' },
  { name: 'TITLETEXT',  color: 7, lineType: 'CONTINUOUS' },
  { name: 'NORTHARROW', color: 7, lineType: 'CONTINUOUS' },
  { name: 'SCALEBAR',   color: 7, lineType: 'CONTINUOUS' },
  { name: 'GRID',       color: 8, lineType: 'DASHED'     },
  { name: 'DRAWING',    color: 7, lineType: 'CONTINUOUS' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Safely format a number to fixed decimal places */
function f(value: number, decimals = 4): string {
  return value.toFixed(decimals);
}

/** Get sheet width and height based on orientation */
function getSheetDimensions(opts: SheetLayoutOptions): { width: number; height: number } {
  const [w, h] = SHEET_SIZES[opts.sheetSize];
  if (opts.orientation === 'portrait') {
    return { width: h, height: w };
  }
  return { width: w, height: h };
}

/** Convert real-world meters to paper mm at the given scale */
function metersToMm(realMeters: number, scale: number): number {
  return (realMeters / scale) * 1000;
}

/** Format a coordinate label (removes unnecessary trailing zeros) */
function formatCoordLabel(value: number): string {
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

// ─── DXF Section Builders ────────────────────────────────────────────────────

/**
 * Build the HEADER section of a DXF file.
 * Sets EXTMIN/EXTMAX to sheet bounds, MEASUREMENT to 1 (metric),
 * and unit system variables.
 */
function buildHeader(sheetW: number, sheetH: number, isMetric: boolean): string {
  return [
    '0', 'SECTION', '2', 'HEADER',
    // AutoCAD version (R2007 / AC1021 — widely compatible)
    '9', '$ACADVER', '1', 'AC1021',
    // Insertion base point
    '9', '$INSBASE',
    '10', f(0), '20', f(0), '30', f(0),
    // Drawing extents minimum
    '9', '$EXTMIN',
    '10', f(0), '20', f(0), '30', f(0),
    // Drawing extents maximum
    '9', '$EXTMAX',
    '10', f(sheetW), '20', f(sheetH), '30', f(0),
    // Measurement: 1 = metric, 0 = imperial
    '9', '$MEASUREMENT', '70', isMetric ? '1' : '0',
    // Unit mode (0 = decimal, 1 = architectural, 2 = engineering, etc.)
    '9', '$LUNITS', '70', '2',
    // Angular units (0 = decimal degrees)
    '9', '$AUNITS', '70', '0',
    // Dimension unit format
    '9', '$DIMUNIT', '70', '2',
    // Text style
    '9', '$TEXTSTYLE', '7', 'STANDARD',
    // Text height default
    '9', '$TEXTSIZE', '40', f(2.5),
    // Snap base
    '9', '$SNAPBASE',
    '10', f(0), '20', f(0),
    // Grid spacing
    '9', '$GRIDUNIT',
    '10', f(10), '20', f(10),
    '0', 'ENDSEC',
  ].join('\n');
}

/**
 * Build the TABLES section.
 * Includes LTYPE, LAYER, and STYLE tables.
 */
function buildTables(allLayers: Array<{ name: string; color: number; lineType: string }>): string {
  const parts: string[] = [];

  // ── LTYPE table ─────────────────────────────────────────────────────────
  const linetypes = [
    { name: 'CONTINUOUS', desc: 'Solid line',        elements: [] },
    { name: 'DASHED',     desc: 'Dashed line',       elements: [12.0, -6.0] },
    { name: 'CENTER',     desc: 'Center line',       elements: [24.0, -3.0, 3.0, -3.0] },
    { name: 'PHANTOM',    desc: 'Phantom line',      elements: [18.0, -5.0, 5.0, -5.0] },
    { name: 'DASHDOT',    desc: 'Dash-dot line',     elements: [15.0, -3.0, 3.0, -3.0] },
    { name: 'DOT',        desc: 'Dotted line',       elements: [0.5, -3.0] },
  ];

  parts.push('0', 'SECTION', '2', 'TABLES');

  // LTYPE table
  parts.push(
    '0', 'TABLE', '2', 'LTYPE',
    '70', String(linetypes.length),
  );
  // CONTINUOUS must come first with handle 0x14
  for (let i = 0; i < linetypes.length; i++) {
    const lt = linetypes[i];
    parts.push(
      '0', 'LTYPE',
      '2', lt.name,
      '70', '0',
      '3', lt.desc,
      '72', '65',          // alignment code A (always 65 for simple linetypes)
      '73', String(lt.elements.length),
      '40', f(lt.elements.reduce((sum, e) => sum + Math.abs(e), 0)),
    );
    for (const elem of lt.elements) {
      parts.push('49', f(elem));
    }
  }
  parts.push('0', 'ENDTAB');

  // ── LAYER table ────────────────────────────────────────────────────────
  parts.push(
    '0', 'TABLE', '2', 'LAYER',
    '70', String(allLayers.length),
  );
  for (const layer of allLayers) {
    parts.push(
      '0', 'LAYER',
      '2', layer.name,
      '70', '0',          // flags: 0 = not frozen/locked
      '62', String(layer.color),  // ACI color number
      '6', layer.lineType,         // linetype name
    );
  }
  parts.push('0', 'ENDTAB');

  // ── STYLE table ────────────────────────────────────────────────────────
  parts.push(
    '0', 'TABLE', '2', 'STYLE',
    '70', '3',
    // STANDARD style (simplex.shx equivalent — we use a simple definition)
    '0', 'STYLE',
    '2', 'STANDARD',
    '70', '0',
    '40', f(0),          // fixed text height (0 = variable)
    '41', f(1),          // width factor
    '50', f(0),          // oblique angle
    '71', '0',           // text generation flags
    '3', 'txt',          // primary font file name
    '4', '',             // big font file (empty)
    // TITLE style for title block headers
    '0', 'STYLE',
    '2', 'TITLE',
    '70', '0',
    '40', f(0),
    '41', f(1),
    '50', f(0),
    '71', '0',
    '3', 'txt',
    '4', '',
    // SMALL style for labels and tick labels
    '0', 'STYLE',
    '2', 'SMALL',
    '70', '0',
    '40', f(0),
    '41', f(0.85),
    '50', f(0),
    '71', '0',
    '3', 'txt',
    '4', '',
  );
  parts.push('0', 'ENDTAB');

  // ── APPID table (required for XREFs / entity data) ─────────────────────
  parts.push(
    '0', 'TABLE', '2', 'APPID',
    '70', '1',
    '0', 'APPID',
    '2', 'ACAD',
    '70', '0',
  );
  parts.push('0', 'ENDTAB');

  parts.push('0', 'ENDSEC');
  return parts.join('\n');
}

/**
 * Build the BLOCKS section.
 * Defines:
 * - NORTH_ARROW: simple triangular arrow pointing up with "N" label
 * - SCALE_BAR: segmented bar with labeled distances
 */
function buildBlocks(scale: number, sheetSize: string): string {
  const parts: string[] = [];
  parts.push('0', 'SECTION', '2', 'BLOCKS');

  // ── North Arrow Block ──────────────────────────────────────────────────
  // Centered at (0, 0), pointing up (+Y direction).
  // Size controlled by NORTH_ARROW_SIZE constant.
  const aSize = NORTH_ARROW_SIZE;

  parts.push(
    '0', 'BLOCK',
    '8', '0',
    '2', 'NORTH_ARROW',
    '70', '0',
    '10', f(0), '20', f(0), '30', f(0),  // base point
  );
  // Shaft: vertical line from base to tip
  parts.push(
    '0', 'LINE',
    '8', 'NORTHARROW',
    '10', f(0), '20', f(-aSize * 0.6),
    '11', f(0), '21', f(aSize * 0.4),
  );
  // Arrowhead: two lines from tip sweeping back
  parts.push(
    '0', 'LINE',
    '8', 'NORTHARROW',
    '10', f(0), '20', f(aSize * 0.4),
    '11', f(-aSize * 0.25), '21', f(aSize * 0.05),
  );
  parts.push(
    '0', 'LINE',
    '8', 'NORTHARROW',
    '10', f(0), '20', f(aSize * 0.4),
    '11', f(aSize * 0.25), '21', f(aSize * 0.05),
  );
  // Filled arrowhead (triangle)
  parts.push(
    '0', 'LINE',
    '8', 'NORTHARROW',
    '10', f(-aSize * 0.25), '20', f(aSize * 0.05),
    '11', f(aSize * 0.25), '21', f(aSize * 0.05),
  );
  // Cross bar at base (horizontal half-line left)
  parts.push(
    '0', 'LINE',
    '8', 'NORTHARROW',
    '10', f(-aSize * 0.2), '20', f(-aSize * 0.6),
    '11', f(aSize * 0.1), '21', f(-aSize * 0.6),
  );
  // "N" label above the tip
  parts.push(
    '0', 'TEXT',
    '8', 'NORTHARROW',
    '10', f(0), '20', f(aSize * 0.7),
    '40', f(aSize * 0.4),
    '1', 'N',
    '72', '1',   // horizontal center
    '11', f(0), '21', f(aSize * 0.7),
  );
  // "S" label below the base (smaller)
  parts.push(
    '0', 'TEXT',
    '8', 'NORTHARROW',
    '10', f(0), '20', f(-aSize * 0.85),
    '40', f(aSize * 0.22),
    '1', 'S',
    '72', '1',
    '11', f(0), '21', f(-aSize * 0.85),
  );
  // Circle around the arrowhead
  parts.push(
    '0', 'CIRCLE',
    '8', 'NORTHARROW',
    '10', f(0), '20', f(-aSize * 0.1), '30', f(0),
    '40', f(aSize * 0.75),
  );
  parts.push('0', 'ENDBLK');

  // ── Scale Bar Block ────────────────────────────────────────────────────
  // A segmented scale bar showing real-world distances.
  // We compute appropriate segment lengths based on the scale and sheet size.
  // The block is positioned at its insertion point (bottom-left corner).
  const barH = SCALE_BAR_HEIGHT;

  // Determine a good real-world distance per segment in meters.
  // Target: each segment should be between 30mm and 100mm on paper.
  const targetSegmentMm = 60; // mm on paper per segment
  const targetRealMeters = targetSegmentMm * scale / 1000;

  // Round to a nice number: 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, etc.
  const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
  let segmentMeters = niceSteps[0];
  for (const step of niceSteps) {
    const segmentMm = metersToMm(step, scale);
    if (segmentMm >= 25 && segmentMm <= 120) {
      segmentMeters = step;
      break;
    }
    if (step === niceSteps[niceSteps.length - 1]) {
      segmentMeters = step;
    }
  }

  const segmentMm = metersToMm(segmentMeters, scale);
  const numSegments = 4; // always 4 segments for a clean bar

  // Format the segment label
  const segmentLabel = segmentMeters >= 1000
    ? `${(segmentMeters / 1000).toFixed(segmentMeters % 1000 === 0 ? 0 : 1)}km`
    : `${segmentMeters}m`;

  parts.push(
    '0', 'BLOCK',
    '8', '0',
    '2', 'SCALE_BAR',
    '70', '0',
    '10', f(0), '20', f(0), '30', f(0),
  );

  // Draw the alternating filled segments
  for (let i = 0; i < numSegments; i++) {
    const x0 = i * segmentMm;
    const x1 = (i + 1) * segmentMm;

    if (i % 2 === 0) {
      // Filled (black) segment — draw as two horizontal lines (top and bottom)
      // plus vertical fills (diagonal hatching approximated with solid fill via LWPOLYLINE)
      parts.push(
        '0', 'LWPOLYLINE',
        '8', 'SCALEBAR',
        '90', '4',
        '70', '1',  // closed
        '10', f(x0), '20', f(0),
        '10', f(x0), '20', f(barH),
        '10', f(x1), '20', f(barH),
        '10', f(x1), '20', f(0),
      );
    } else {
      // Unfilled segment — draw outline only
      parts.push(
        '0', 'LWPOLYLINE',
        '8', 'SCALEBAR',
        '90', '4',
        '70', '1',
        '10', f(x0), '20', f(0),
        '10', f(x0), '20', f(barH),
        '10', f(x1), '20', f(barH),
        '10', f(x1), '20', f(0),
      );
    }
  }

  // Full outer outline of the scale bar
  const totalBarWidth = numSegments * segmentMm;
  parts.push(
    '0', 'LWPOLYLINE',
    '8', 'SCALEBAR',
    '90', '4',
    '70', '1',
    '10', f(0), '20', f(0),
    '10', f(0), '20', f(barH),
    '10', f(totalBarWidth), '20', f(barH),
    '10', f(totalBarWidth), '20', f(0),
  );

  // Vertical dividing lines between segments
  for (let i = 1; i < numSegments; i++) {
    const x = i * segmentMm;
    parts.push(
      '0', 'LINE',
      '8', 'SCALEBAR',
      '10', f(x), '20', f(0),
      '11', f(x), '21', f(barH),
    );
  }

  // Segment labels below the bar
  const labelH = barH * 0.8;
  for (let i = 0; i <= numSegments; i++) {
    const x = i * segmentMm;
    const totalM = i * segmentMeters;
    const label = totalM >= 1000
      ? `${(totalM / 1000).toFixed(totalM % 1000 === 0 ? 0 : 1)}km`
      : `${totalM}m`;

    parts.push(
      '0', 'TEXT',
      '8', 'SCALEBAR',
      '10', f(x), '20', f(-SCALE_BAR_LABEL_OFFSET),
      '40', f(labelH),
      '1', label,
      '72', '1',  // center
      '11', f(x), '21', f(-SCALE_BAR_LABEL_OFFSET),
    );
  }

  // Segment distance label below center of bar
  parts.push(
    '0', 'TEXT',
    '8', 'SCALEBAR',
    '10', f(totalBarWidth / 2), '20', f(-SCALE_BAR_LABEL_OFFSET - labelH - 1),
    '40', f(labelH),
    '1', `${segmentLabel} / div`,
    '72', '1',
    '11', f(totalBarWidth / 2), '21', f(-SCALE_BAR_LABEL_OFFSET - labelH - 1),
  );

  parts.push('0', 'ENDBLK');

  parts.push('0', 'ENDSEC');
  return parts.join('\n');
}

/**
 * Build the ENTITIES section.
 * Creates the complete sheet layout: borders, title block, north arrow,
 * scale bar, grid ticks, and drawing extent rectangle.
 */
function buildEntities(opts: SheetLayoutOptions, dims: { width: number; height: number }): string {
  const parts: string[] = [];
  parts.push('0', 'SECTION', '2', 'ENTITIES');

  const { width, height } = dims;
  const tbHeight = TITLE_BLOCK_HEIGHTS[opts.sheetSize];

  // ── Outer Border (sheet edge) ──────────────────────────────────────────
  if (opts.showBorder) {
    const inset = BORDER_INSET;
    parts.push(
      '0', 'LWPOLYLINE',
      '8', 'BORDER',
      '90', '4',
      '70', '1',
      '10', f(inset), '20', f(inset),
      '10', f(width - inset), '20', f(inset),
      '10', f(width - inset), '20', f(height - inset),
      '10', f(inset), '20', f(height - inset),
    );
  }

  // ── Inner Border (drawing area) ────────────────────────────────────────
  const innerLeft = INNER_MARGIN;
  const innerBottom = INNER_MARGIN + tbHeight;
  const innerRight = width - INNER_MARGIN;
  const innerTop = height - INNER_MARGIN;

  parts.push(
    '0', 'LWPOLYLINE',
    '8', 'BORDER',
    '90', '4',
    '70', '1',
    '10', f(innerLeft), '20', f(innerBottom),
    '10', f(innerRight), '20', f(innerBottom),
    '10', f(innerRight), '20', f(innerTop),
    '10', f(innerLeft), '20', f(innerTop),
  );

  // ── Title Block ────────────────────────────────────────────────────────
  buildTitleBlock(parts, opts, width, height, tbHeight);

  // ── North Arrow (INSERT of NORTH_ARROW block) ──────────────────────────
  if (opts.showNorthArrow) {
    const arrowX = innerRight - NORTH_ARROW_SIZE * 1.5;
    const arrowY = innerTop - NORTH_ARROW_SIZE * 1.5;

    parts.push(
      '0', 'INSERT',
      '8', 'NORTHARROW',
      '2', 'NORTH_ARROW',
      '10', f(arrowX), '20', f(arrowY), '30', f(0),
      '41', f(1), '42', f(1), '50', f(0),
    );
  }

  // ── Scale Bar (INSERT of SCALE_BAR block) ──────────────────────────────
  if (opts.showScaleBar) {
    const barY = innerBottom + 8;
    parts.push(
      '0', 'INSERT',
      '8', 'SCALEBAR',
      '2', 'SCALE_BAR',
      '10', f(innerLeft + 10), '20', f(barY), '30', f(0),
      '41', f(1), '42', f(1), '50', f(0),
    );
  }

  // ── Grid Ticks ─────────────────────────────────────────────────────────
  if (opts.showGridTicks && opts.gridInterval && opts.gridInterval > 0) {
    buildGridTicks(parts, opts, innerLeft, innerRight, innerBottom, innerTop);
  }

  // ── Drawing Extent Rectangle ───────────────────────────────────────────
  if (
    opts.minEasting !== undefined && opts.maxEasting !== undefined &&
    opts.minNorthing !== undefined && opts.maxNorthing !== undefined
  ) {
    buildDrawingExtent(parts, opts, innerLeft, innerRight, innerBottom, innerTop);
  }

  parts.push('0', 'ENDSEC');
  return parts.join('\n');
}

/**
 * Build the title block at the bottom of the sheet.
 * Includes vertical dividers, project info, surveyor details, date,
 * scale notation, coordinate system, and METARDU footer.
 */
function buildTitleBlock(
  parts: string[],
  opts: SheetLayoutOptions,
  sheetW: number,
  sheetH: number,
  tbHeight: number,
): void {
  const inset = BORDER_INSET;
  const tbTop = INNER_MARGIN + tbHeight;
  const tbBottom = inset;
  const tbLeft = inset;
  const tbRight = sheetW - inset;

  // Title block outer rectangle (on TITLEBLOCK layer)
  parts.push(
    '0', 'LWPOLYLINE',
    '8', 'TITLEBLOCK',
    '90', '4',
    '70', '1',
    '10', f(tbLeft), '20', f(tbBottom),
    '10', f(tbRight), '20', f(tbBottom),
    '10', f(tbRight), '20', f(tbTop),
    '10', f(tbLeft), '20', f(tbTop),
  );

  // Horizontal divider: row 1 (top ~45%) vs row 2 (bottom ~55%)
  const rowDividerY = tbBottom + tbHeight * 0.45;
  parts.push(
    '0', 'LINE',
    '8', 'TITLEBLOCK',
    '10', f(tbLeft), '20', f(rowDividerY),
    '11', f(tbRight), '21', f(rowDividerY),
  );

  // Column dividers in the top row:
  // Col 1: Project info (wide)
  // Col 2: Scale / Coord system
  // Col 3: Date / Revision
  // Col 4: Sheet number
  // Col 5: METARDU branding (narrow)
  const colWidth1 = (tbRight - tbLeft) * 0.45;
  const colWidth2 = (tbRight - tbLeft) * 0.20;
  const colWidth3 = (tbRight - tbLeft) * 0.15;
  const colWidth4 = (tbRight - tbLeft) * 0.10;
  // colWidth5 = remainder

  const col1Right = tbLeft + colWidth1;
  const col2Right = col1Right + colWidth2;
  const col3Right = col2Right + colWidth3;
  const col4Right = col3Right + colWidth4;

  for (const x of [col1Right, col2Right, col3Right, col4Right]) {
    parts.push(
      '0', 'LINE',
      '8', 'TITLEBLOCK',
      '10', f(x), '20', f(rowDividerY),
      '11', f(x), '21', f(tbTop),
    );
  }

  // Column dividers in the bottom row:
  // Col A: Surveyor / Client
  // Col B: Project number
  // Col C: Date / Revision
  const bCol1Right = tbLeft + (tbRight - tbLeft) * 0.40;
  const bCol2Right = tbLeft + (tbRight - tbLeft) * 0.65;

  for (const x of [bCol1Right, bCol2Right]) {
    parts.push(
      '0', 'LINE',
      '8', 'TITLEBLOCK',
      '10', f(x), '20', f(tbBottom),
      '11', f(x), '21', f(rowDividerY),
    );
  }

  // ── Text sizes based on sheet size ─────────────────────────────────────
  const isLargeSheet = opts.sheetSize === 'A0' || opts.sheetSize === 'A1';
  const titleH = isLargeSheet ? 5 : 3.5;
  const subtitleH = isLargeSheet ? 3 : 2.5;
  const bodyH = isLargeSheet ? 2.5 : 2;
  const smallH = isLargeSheet ? 2 : 1.8;
  const footerH = isLargeSheet ? 1.8 : 1.5;

  // ── Top Row Text (TITLETEXT layer) ─────────────────────────────────────

  // Column 1: Project Name (large)
  addCenteredText(parts, 'TITLETEXT', opts.projectName,
    (tbLeft + col1Right) / 2, rowDividerY + tbHeight * 0.35, titleH);
  // Subtitle: Project Number
  if (opts.projectNumber) {
    addCenteredText(parts, 'TITLETEXT', `Project: ${opts.projectNumber}`,
      (tbLeft + col1Right) / 2, rowDividerY + tbHeight * 0.12, bodyH);
  }

  // Column 2: Scale
  addCenteredText(parts, 'TITLETEXT', `SCALE 1:${opts.scale}`,
    (col1Right + col2Right) / 2, rowDividerY + tbHeight * 0.35, subtitleH);
  addCenteredText(parts, 'TITLETEXT', opts.units.toUpperCase(),
    (col1Right + col2Right) / 2, rowDividerY + tbHeight * 0.12, smallH);

  // Column 3: Coordinate System
  addCenteredText(parts, 'TITLETEXT', 'COORD SYSTEM',
    (col2Right + col3Right) / 2, rowDividerY + tbHeight * 0.5, smallH);
  // Wrap long coordinate system names
  const csText = opts.coordinateSystem;
  if (csText.length > 20 && (col3Right - col2Right) < 120) {
    const mid = Math.ceil(csText.length / 2);
    const spaceIdx = csText.lastIndexOf(' ', mid);
    const breakAt = spaceIdx > 0 ? spaceIdx : mid;
    addCenteredText(parts, 'TITLETEXT', csText.substring(0, breakAt),
      (col2Right + col3Right) / 2, rowDividerY + tbHeight * 0.28, bodyH);
    addCenteredText(parts, 'TITLETEXT', csText.substring(breakAt + 1),
      (col2Right + col3Right) / 2, rowDividerY + tbHeight * 0.1, bodyH);
  } else {
    addCenteredText(parts, 'TITLETEXT', csText,
      (col2Right + col3Right) / 2, rowDividerY + tbHeight * 0.22, bodyH);
  }

  // Column 4: Sheet Number
  const sheetLabel = opts.sheetNumber && opts.totalSheets
    ? `Sheet ${opts.sheetNumber} of ${opts.totalSheets}`
    : opts.sheetNumber
      ? `Sheet ${opts.sheetNumber}`
      : 'Sheet 1 of 1';
  addCenteredText(parts, 'TITLETEXT', sheetLabel,
    (col3Right + col4Right) / 2, rowDividerY + tbHeight * 0.35, bodyH);
  if (opts.revision) {
    addCenteredText(parts, 'TITLETEXT', `Rev ${opts.revision}`,
      (col3Right + col4Right) / 2, rowDividerY + tbHeight * 0.12, smallH);
  }

  // Column 5: METARDU branding
  addCenteredText(parts, 'TITLETEXT', 'METARDU',
    (col4Right + tbRight) / 2, rowDividerY + tbHeight * 0.55, bodyH);
  addCenteredText(parts, 'TITLETEXT', 'Professional',
    (col4Right + tbRight) / 2, rowDividerY + tbHeight * 0.38, smallH);
  addCenteredText(parts, 'TITLETEXT', 'Survey Platform',
    (col4Right + tbRight) / 2, rowDividerY + tbHeight * 0.22, smallH);

  // ── Bottom Row Text ────────────────────────────────────────────────────
  const bottomRowMidY = (tbBottom + rowDividerY) / 2;
  const bottomRowTopY = rowDividerY - tbHeight * 0.12;
  const bottomRowBotY = tbBottom + tbHeight * 0.12;

  // Col A: Surveyor & Client
  addCenteredText(parts, 'TITLETEXT', 'Licensed Surveyor:',
    (tbLeft + bCol1Right) / 2, bottomRowTopY, smallH);
  addCenteredText(parts, 'TITLETEXT', opts.surveyorName || '—',
    (tbLeft + bCol1Right) / 2, bottomRowMidY, bodyH);
  if (opts.surveyorLicense) {
    addCenteredText(parts, 'TITLETEXT', opts.surveyorLicense,
      (tbLeft + bCol1Right) / 2, bottomRowBotY, smallH);
  }

  // Col B: Project Number / Client
  addCenteredText(parts, 'TITLETEXT', 'Client:',
    (bCol1Right + bCol2Right) / 2, bottomRowTopY, smallH);
  addCenteredText(parts, 'TITLETEXT', opts.clientName || '—',
    (bCol1Right + bCol2Right) / 2, bottomRowMidY, bodyH);
  if (opts.projectNumber) {
    addCenteredText(parts, 'TITLETEXT', `Ref: ${opts.projectNumber}`,
      (bCol1Right + bCol2Right) / 2, bottomRowBotY, smallH);
  }

  // Col C: Date & Revision
  const formattedDate = formatDisplayDate(opts.date);
  addCenteredText(parts, 'TITLETEXT', `Date: ${formattedDate}`,
    (bCol2Right + tbRight) / 2, bottomRowTopY, bodyH);
  if (opts.revision) {
    addCenteredText(parts, 'TITLETEXT', `Revision: ${opts.revision}`,
      (bCol2Right + tbRight) / 2, bottomRowMidY, smallH);
  }
  addCenteredText(parts, 'TITLETEXT', 'As per Kenya Survey Regulations 1994',
    (bCol2Right + tbRight) / 2, bottomRowBotY, smallH);
}

/**
 * Add a horizontally centered TEXT entity.
 */
function addCenteredText(
  parts: string[],
  layer: string,
  text: string,
  x: number,
  y: number,
  height: number,
): void {
  // Escape any backslashes in the text for DXF MTEXT compatibility
  const safeText = text.replace(/\\/g, '\\\\');
  parts.push(
    '0', 'TEXT',
    '8', layer,
    '10', f(x), '20', f(y), '30', f(0),
    '40', f(height),
    '1', safeText,
    '72', '1',    // horizontal justification: center
    '11', f(x), '21', f(y), '31', f(0),
  );
}

/**
 * Add a left-justified TEXT entity.
 */
function addLeftText(
  parts: string[],
  layer: string,
  text: string,
  x: number,
  y: number,
  height: number,
): void {
  const safeText = text.replace(/\\/g, '\\\\');
  parts.push(
    '0', 'TEXT',
    '8', layer,
    '10', f(x), '20', f(y), '30', f(0),
    '40', f(height),
    '1', safeText,
  );
}

/**
 * Build grid tick marks and coordinate labels along the inner border.
 */
function buildGridTicks(
  parts: string[],
  opts: SheetLayoutOptions,
  innerLeft: number,
  innerRight: number,
  innerBottom: number,
  innerTop: number,
): void {
  const interval = opts.gridInterval!;
  const tickLen = GRID_TICK_LENGTH;
  const isLargeSheet = opts.sheetSize === 'A0' || opts.sheetSize === 'A1';
  const labelH = isLargeSheet ? 2 : 1.8;
  const labelOffset = tickLen + 2; // mm below/left of tick

  // Only draw grid ticks if we have coordinate extents
  if (
    opts.minEasting === undefined || opts.maxEasting === undefined ||
    opts.minNorthing === undefined || opts.maxNorthing === undefined
  ) {
    return;
  }

  const { minEasting, maxEasting, minNorthing, maxNorthing } = opts;

  // Compute drawing area on paper (mm)
  const drawW = metersToMm(maxEasting - minEasting, opts.scale);
  const drawH = metersToMm(maxNorthing - minNorthing, opts.scale);

  // Center the drawing within the inner border
  const innerW = innerRight - innerLeft;
  const innerH = innerTop - innerBottom;
  const offsetX = innerLeft + (innerW - drawW) / 2;
  const offsetY = innerBottom + (innerH - drawH) / 2;

  // Easting ticks along the bottom edge
  const startE = Math.ceil(minEasting / interval) * interval;
  for (let e = startE; e <= maxEasting; e += interval) {
    const paperX = offsetX + metersToMm(e - minEasting, opts.scale);

    // Only draw if within the inner border area
    if (paperX < innerLeft || paperX > innerRight) continue;

    // Bottom tick
    parts.push(
      '0', 'LINE',
      '8', 'GRID',
      '10', f(paperX), '20', f(innerBottom),
      '11', f(paperX), '21', f(innerBottom - tickLen),
    );
    // Top tick
    parts.push(
      '0', 'LINE',
      '8', 'GRID',
      '10', f(paperX), '20', f(innerTop),
      '11', f(paperX), '21', f(innerTop + tickLen),
    );
    // Bottom label
    addCenteredText(parts, 'GRID', formatCoordLabel(e),
      paperX, innerBottom - tickLen - labelOffset, labelH);
    // Top label
    addCenteredText(parts, 'GRID', formatCoordLabel(e),
      paperX, innerTop + tickLen + labelOffset + labelH, labelH);
  }

  // Northing ticks along the left edge
  const startN = Math.ceil(minNorthing / interval) * interval;
  for (let n = startN; n <= maxNorthing; n += interval) {
    const paperY = offsetY + metersToMm(n - minNorthing, opts.scale);

    if (paperY < innerBottom || paperY > innerTop) continue;

    // Left tick
    parts.push(
      '0', 'LINE',
      '8', 'GRID',
      '10', f(innerLeft), '20', f(paperY),
      '11', f(innerLeft - tickLen), '21', f(paperY),
    );
    // Right tick
    parts.push(
      '0', 'LINE',
      '8', 'GRID',
      '10', f(innerRight), '20', f(paperY),
      '11', f(innerRight + tickLen), '21', f(paperY),
    );
    // Left label (rotated 90° or horizontal — we use horizontal for compatibility)
    addLeftText(parts, 'GRID', formatCoordLabel(n),
      innerLeft - tickLen - 2, paperY - labelH * 0.3, labelH);
    // Right label
    addLeftText(parts, 'GRID', formatCoordLabel(n),
      innerRight + tickLen + 2, paperY - labelH * 0.3, labelH);
  }
}

/**
 * Build the drawing extent rectangle (dashed reference on DRAWING layer).
 */
function buildDrawingExtent(
  parts: string[],
  opts: SheetLayoutOptions,
  innerLeft: number,
  innerRight: number,
  innerBottom: number,
  innerTop: number,
): void {
  const minEasting = opts.minEasting!;
  const maxEasting = opts.maxEasting!;
  const minNorthing = opts.minNorthing!;
  const maxNorthing = opts.maxNorthing!;

  // Compute paper dimensions
  const drawW = metersToMm(maxEasting - minEasting, opts.scale);
  const drawH = metersToMm(maxNorthing - minNorthing, opts.scale);

  // Center within inner border
  const innerW = innerRight - innerLeft;
  const innerH = innerTop - innerBottom;
  const offsetX = innerLeft + (innerW - drawW) / 2;
  const offsetY = innerBottom + (innerH - drawH) / 2;

  // Draw dashed rectangle on DRAWING layer
  parts.push(
    '0', 'LWPOLYLINE',
    '8', 'DRAWING',
    '6', 'DASHED',
    '90', '4',
    '70', '1',
    '10', f(offsetX), '20', f(offsetY),
    '10', f(offsetX + drawW), '20', f(offsetY),
    '10', f(offsetX + drawW), '20', f(offsetY + drawH),
    '10', f(offsetX), '20', f(offsetY + drawH),
  );

  // Add corner coordinate labels
  const coordH = 2;
  const coordOffset = 3;
  const corners = [
    { e: minEasting, n: minNorthing, px: offsetX, py: offsetY },
    { e: maxEasting, n: minNorthing, px: offsetX + drawW, py: offsetY },
    { e: maxEasting, n: maxNorthing, px: offsetX + drawW, py: offsetY + drawH },
    { e: minEasting, n: maxNorthing, px: offsetX, py: offsetY + drawH },
  ];

  for (const c of corners) {
    // Position labels slightly inside each corner
    const dx = c.px < offsetX + drawW / 2 ? coordOffset : -coordOffset * 8;
    const dy = c.py < offsetY + drawH / 2 ? coordOffset : -coordOffset * 3;
    addLeftText(parts, 'DRAWING',
      `E: ${formatCoordLabel(c.e)}`, c.px + dx, c.py + dy, coordH);
    addLeftText(parts, 'DRAWING',
      `N: ${formatCoordLabel(c.n)}`, c.px + dx, c.py + dy - coordH * 1.5, coordH);
  }
}

/**
 * Format an ISO date string for display in the title block.
 * Converts "2025-01-15" to "15/01/2025" format per Kenyan survey practice.
 */
function formatDisplayDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return isoDate;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return isoDate;
  }
}

// ─── Main Generator ──────────────────────────────────────────────────────────

/**
 * Generate a complete DXF sheet layout string.
 *
 * Produces a valid DXF file (AC1021 / AutoCAD 2007 format) containing:
 * - HEADER: sheet extents, units, system variables
 * - TABLES: linetypes, layers, text styles
 * - BLOCKS: NORTH_ARROW and SCALE_BAR block definitions
 * - ENTITIES: borders, title block, north arrow, scale bar, grid ticks,
 *             and drawing extent rectangle
 *
 * The DXF is fully compatible with AutoCAD, LibreCAD, DraftSight, QCAD,
 * and other major CAD applications.
 *
 * @param options - Sheet layout configuration
 * @returns Complete DXF file as a string
 */
export function generateSheetLayout(options: SheetLayoutOptions): string {
  const dims = getSheetDimensions(options);

  // Merge standard layers with custom layers
  const allLayers: Array<{ name: string; color: number; lineType: string }> = [
    ...STANDARD_LAYERS,
  ];
  if (options.layers) {
    for (const customLayer of options.layers) {
      // Avoid duplicates with standard layers
      if (!allLayers.some(l => l.name === customLayer.name)) {
        allLayers.push({
          name: customLayer.name,
          color: customLayer.color,
          lineType: customLayer.lineType || 'CONTINUOUS',
        });
      }
    }
  }

  const header = buildHeader(dims.width, dims.height, options.units === 'metric');
  const tables = buildTables(allLayers);
  const blocks = buildBlocks(options.scale, options.sheetSize);
  const entities = buildEntities(options, dims);

  return [
    header,
    tables,
    blocks,
    entities,
    '0', 'EOF',
  ].join('\n');
}

/**
 * Append drawing entities to an existing DXF string.
 *
 * This utility allows adding survey data (points, lines, polygons, etc.)
 * to a sheet layout generated by `generateSheetLayout`. It inserts the
 * entities just before the `EOF` marker.
 *
 * Supported entity types: LINE, TEXT, POINT, CIRCLE, ARC, LWPOLYLINE, INSERT.
 *
 * @param dxf - Existing DXF string (typically from generateSheetLayout)
 * @param entities - Array of DXF entity definitions
 * @returns Modified DXF string with appended entities
 */
export function addDrawingEntities(dxf: string, entities: DXFEntity[]): string {
  if (entities.length === 0) return dxf;

  const entityLines: string[] = [];

  for (const entity of entities) {
    const lines: string[] = [];

    // Entity type
    lines.push('0', entity.type);

    // Layer name
    lines.push('8', entity.layer);

    // Entity-specific properties (group code → value)
    // Skip group codes 0 and 8 (already handled)
    const skipCodes = new Set([0, 8]);
    for (const [code, value] of Object.entries(entity.props)) {
      const groupCode = parseInt(code, 10);
      if (!skipCodes.has(groupCode)) {
        lines.push(String(groupCode), String(value));
      }
    }

    // Extra lines for complex entities like LWPOLYLINE vertices
    if (entity.extraLines && entity.extraLines.length > 0) {
      lines.push(...entity.extraLines);
    }

    entityLines.push(lines.join('\n'));
  }

  // Insert before EOF
  const eofIndex = dxf.lastIndexOf('0\nEOF');
  if (eofIndex === -1) {
    // No EOF found — append at the end
    return dxf + '\n' + entityLines.join('\n') + '\n0\nEOF\n';
  }

  // Also need to insert before ENDSEC of ENTITIES section if it exists
  // Actually, we insert before the ENDSEC/EOF sequence
  // Find the last ENDSEC before EOF
  const lastEndsecIndex = dxf.lastIndexOf('0\nENDSEC');
  if (lastEndsecIndex !== -1 && lastEndsecIndex < eofIndex) {
    // Insert entities before the last ENDSEC (which closes ENTITIES)
    return (
      dxf.substring(0, lastEndsecIndex) +
      entityLines.join('\n') + '\n' +
      dxf.substring(lastEndsecIndex)
    );
  }

  // Fallback: insert before EOF
  return (
    dxf.substring(0, eofIndex) +
    entityLines.join('\n') + '\n' +
    dxf.substring(eofIndex)
  );
}

/**
 * Create a DXF LINE entity for use with `addDrawingEntities`.
 */
export function lineEntity(
  layer: string,
  x1: number, y1: number,
  x2: number, y2: number,
): DXFEntity {
  return {
    type: 'LINE',
    layer,
    props: {
      10: x1, 20: y1, 30: 0,
      11: x2, 21: y2, 31: 0,
    },
  };
}

/**
 * Create a DXF TEXT entity for use with `addDrawingEntities`.
 */
export function textEntity(
  layer: string,
  text: string,
  x: number, y: number,
  height: number = 2.5,
): DXFEntity {
  return {
    type: 'TEXT',
    layer,
    props: {
      10: x, 20: y, 30: 0,
      40: height,
      1: text,
    },
  };
}

/**
 * Create a DXF POINT entity for use with `addDrawingEntities`.
 */
export function pointEntity(
  layer: string,
  x: number, y: number,
): DXFEntity {
  return {
    type: 'POINT',
    layer,
    props: {
      10: x, 20: y, 30: 0,
    },
  };
}

/**
 * Create a DXF CIRCLE entity for use with `addDrawingEntities`.
 */
export function circleEntity(
  layer: string,
  cx: number, cy: number,
  radius: number,
): DXFEntity {
  return {
    type: 'CIRCLE',
    layer,
    props: {
      10: cx, 20: cy, 30: 0,
      40: radius,
    },
  };
}

/**
 * Create a DXF LWPOLYLINE entity (closed polygon) for use with `addDrawingEntities`.
 *
 * @param layer - Layer name
 * @param vertices - Array of [x, y] coordinate pairs
 * @param closed - Whether to close the polyline (default: true)
 * @param lineType - Optional linetype name (e.g. 'DASHED')
 */
export function lwpolylineEntity(
  layer: string,
  vertices: Array<[number, number]>,
  closed: boolean = true,
  lineType?: string,
): DXFEntity {
  const extraLines: string[] = [];
  extraLines.push(String(90), String(vertices.length));
  extraLines.push('70', closed ? '1' : '0');
  for (const [x, y] of vertices) {
    extraLines.push('10', f(x), '20', f(y));
  }

  const props: Record<number, string | number> = {};
  if (lineType) {
    props[6] = lineType;
  }

  return {
    type: 'LWPOLYLINE',
    layer,
    props,
    extraLines,
  };
}

/**
 * Create a DXF INSERT entity (block reference) for use with `addDrawingEntities`.
 */
export function insertEntity(
  layer: string,
  blockName: string,
  x: number, y: number,
  scaleX: number = 1,
  scaleY: number = 1,
  rotation: number = 0,
): DXFEntity {
  return {
    type: 'INSERT',
    layer,
    props: {
      2: blockName,
      10: x, 20: y, 30: 0,
      41: scaleX,
      42: scaleY,
      50: rotation,
    },
  };
}

// ─── Re-exports for convenience ──────────────────────────────────────────────

export { formatDisplayDate, metersToMm, formatCoordLabel };
