/**
 * Pile / Column Grid Setting-Out Computation Engine
 *
 * Pure functions — no side effects, no DB, no React imports.
 * Generates pile grid coordinates, computes setting-out data
 * (bearing & distance from instrument station), DXF export,
 * and CSV import/export.
 *
 * Reference:
 *   Basak §8.5 – Foundation Setting Out
 *   Ghilani & Wolf §24.1 – Construction Surveying
 */

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface PileGridDefinition {
  name: string;
  originEasting: number;
  originNorthing: number;
  originRL: number;
  rows: number;
  columns: number;
  rowSpacing: number;
  columnSpacing: number;
  rotation: number;           // degrees clockwise from north
  startLabel: string;
  labelRowsAs: 'alpha' | 'numeric';
  labelColumnsAs: 'alpha' | 'numeric';
  pileType: 'pile' | 'column' | 'pier' | 'abutment';
  pileDiameter?: number;      // mm
  depth?: number;             // meters
  coordinateSystem: string;
}

export interface PileCoordinate {
  label: string;
  row: number;
  column: number;
  easting: number;
  northing: number;
  designRL: number;
  gridOffsetE: number;
  gridOffsetN: number;
}

export interface PileGridResult {
  definition: PileGridDefinition;
  piles: PileCoordinate[];
  boundingBox: { minE: number; minN: number; maxE: number; maxN: number };
  totalPiles: number;
  area: number;
}

export interface PileSettingOutData {
  pile: PileCoordinate;
  bearingDeg: number;
  bearingDMS: string;
  horizontalDistance: number;
  targetHeight: number;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Convert a 0-based index to an Excel-style column letter: 0 -> A, 25 -> Z, 26 -> AA */
function indexToAlpha(idx: number): string {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function indexToNumeric(idx: number): string {
  return String(idx + 1);
}

function labelForRow(rowIdx: number, mode: 'alpha' | 'numeric'): string {
  return mode === 'alpha' ? indexToAlpha(rowIdx) : indexToNumeric(rowIdx);
}

function labelForColumn(colIdx: number, mode: 'alpha' | 'numeric'): string {
  return mode === 'alpha' ? indexToAlpha(colIdx) : indexToNumeric(colIdx);
}

/** Determine how the start label is structured (row-part + col-part). */
function parseStartLabel(
  startLabel: string,
  rowMode: 'alpha' | 'numeric',
  colMode: 'alpha' | 'numeric',
): { rowOffset: number; colOffset: number } {
  // Try "A1" style labels (alpha row, numeric col)
  const alphaMatch = startLabel.match(/^([A-Za-z]+)(\d+)$/);
  if (alphaMatch && rowMode === 'alpha' && colMode === 'numeric') {
    const rowLetters = alphaMatch[1].toUpperCase();
    let rowIdx = 0;
    for (let i = 0; i < rowLetters.length; i++) {
      rowIdx = rowIdx * 26 + (rowLetters.charCodeAt(i) - 64);
    }
    rowIdx--; // zero-based
    const colIdx = parseInt(alphaMatch[2], 10) - 1;
    return { rowOffset: rowIdx, colOffset: colIdx };
  }

  // Try "1A" style (numeric row, alpha column)
  const numAlphaMatch = startLabel.match(/^(\d+)([A-Za-z]+)$/);
  if (numAlphaMatch && rowMode === 'numeric' && colMode === 'alpha') {
    const rowIdx = parseInt(numAlphaMatch[1], 10) - 1;
    const colLetters = numAlphaMatch[2].toUpperCase();
    let colIdx = 0;
    for (let i = 0; i < colLetters.length; i++) {
      colIdx = colIdx * 26 + (colLetters.charCodeAt(i) - 64);
    }
    colIdx--;
    return { rowOffset: rowIdx, colOffset: colIdx };
  }

  return { rowOffset: 0, colOffset: 0 };
}

// ─── CORE FUNCTIONS ───────────────────────────────────────────────────────────

/**
 * Generate all pile coordinates from a grid definition.
 *
 * Rotation convention:
 *   0 deg  = grid aligned with north (row spacing along N, column spacing along E)
 *   90 deg = column spacing along N, row spacing along E
 *   Positive = clockwise
 *
 * For each (col, row):
 *   lx = col * columnSpacing
 *   ly = row * rowSpacing
 *   rx = lx * cos(theta) + ly * sin(theta)
 *   ry = -lx * sin(theta) + ly * cos(theta)
 *   easting  = originE + rx
 *   northing = originN + ry
 */
export function generatePileGrid(def: PileGridDefinition): PileGridResult {
  const theta = (def.rotation * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const parsed = parseStartLabel(def.startLabel, def.labelRowsAs, def.labelColumnsAs);

  const piles: PileCoordinate[] = [];

  for (let r = 0; r < def.rows; r++) {
    for (let c = 0; c < def.columns; c++) {
      const lx = c * def.columnSpacing;
      const ly = r * def.rowSpacing;

      const rx = lx * cosT + ly * sinT;
      const ry = -lx * sinT + ly * cosT;

      const rowLabel = labelForRow(parsed.rowOffset + r, def.labelRowsAs);
      const colLabel = labelForColumn(parsed.colOffset + c, def.labelColumnsAs);
      const label = rowLabel + colLabel;

      piles.push({
        label,
        row: r,
        column: c,
        easting: def.originEasting + rx,
        northing: def.originNorthing + ry,
        designRL: def.originRL,
        gridOffsetE: rx,
        gridOffsetN: ry,
      });
    }
  }

  // Bounding box from actual pile positions
  let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity;
  for (const p of piles) {
    if (p.easting < minE) minE = p.easting;
    if (p.northing < minN) minN = p.northing;
    if (p.easting > maxE) maxE = p.easting;
    if (p.northing > maxN) maxN = p.northing;
  }

  const area =
    (Math.max(def.columns - 1, 0) * def.columnSpacing) *
    (Math.max(def.rows - 1, 0) * def.rowSpacing);

  return {
    definition: def,
    piles,
    boundingBox: { minE, minN, maxE, maxN },
    totalPiles: piles.length,
    area,
  };
}

/**
 * Compute setting-out data: bearing, distance, and target height
 * from an instrument station to each pile.
 *
 * Bearing = atan2(dE, dN), normalised to 0-360 degrees.
 * Distance = sqrt(dE^2 + dN^2)
 * Target height on staff = pile.designRL - stationRL - heightOfInstrument
 */
export function computeSettingOut(
  piles: PileCoordinate[],
  stationE: number,
  stationN: number,
  stationRL: number,
  heightOfInstrument: number,
): PileSettingOutData[] {
  return piles.map((pile) => {
    const dE = pile.easting - stationE;
    const dN = pile.northing - stationN;

    // Bearing: atan2(dE, dN) in radians, then to degrees, normalise 0-360
    let bearingRad = Math.atan2(dE, dN);
    if (bearingRad < 0) bearingRad += 2 * Math.PI;
    const bearingDeg = (bearingRad * 180) / Math.PI;

    const horizontalDistance = Math.sqrt(dE * dE + dN * dN);
    const targetHeight = pile.designRL - stationRL - heightOfInstrument;

    return {
      pile,
      bearingDeg,
      bearingDMS: formatBearingDMS(bearingDeg),
      horizontalDistance,
      targetHeight,
    };
  });
}

// ─── FORMATTING ───────────────────────────────────────────────────────────────

/**
 * Convert a bearing in degrees to a DMS string.
 * Convention: 0 deg = North, clockwise positive.
 * Output: e.g. "127\u00B030'15.2\""
 */
export function formatBearingDMS(degrees: number): string {
  // Normalise to 0-360
  let totalDeg = degrees % 360;
  if (totalDeg < 0) totalDeg += 360;

  const deg = Math.floor(totalDeg);
  let remMin = (totalDeg - deg) * 60;
  const min = Math.floor(remMin);
  const sec = (remMin - min) * 60;

  // Pad seconds: e.g. "05.2" -> "05.2", "15.2" -> "15.2"
  const secStr = sec < 10 ? `0${sec.toFixed(1)}` : sec.toFixed(1);

  return `${deg}\u00B0${String(min).padStart(2, '0')}'${secStr}"`;
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

/**
 * Parse a CSV string into a partial PileGridDefinition.
 * Expected format: "Parameter,Value" per line.
 */
export function parsePileGridCSV(csv: string): Partial<PileGridDefinition> {
  const lines = csv.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const result: Record<string, string> = {};

  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      // Skip header row
      if (key.toLowerCase() === 'parameter') continue;
      result[key] = parts.slice(1).join(',').trim();
    }
  }

  const def: Partial<PileGridDefinition> = {};

  if (result['Name']) def.name = result['Name'];
  if (result['Origin E']) def.originEasting = parseFloat(result['Origin E']);
  if (result['Origin N']) def.originNorthing = parseFloat(result['Origin N']);
  if (result['Origin RL']) def.originRL = parseFloat(result['Origin RL']);
  if (result['Rows']) def.rows = parseInt(result['Rows'], 10);
  if (result['Columns']) def.columns = parseInt(result['Columns'], 10);
  if (result['Row Spacing']) def.rowSpacing = parseFloat(result['Row Spacing']);
  if (result['Column Spacing']) def.columnSpacing = parseFloat(result['Column Spacing']);
  if (result['Rotation']) def.rotation = parseFloat(result['Rotation']);
  if (result['Start Label']) def.startLabel = result['Start Label'];
  if (result['Label Rows As']) {
    const v = result['Label Rows As'].toLowerCase();
    if (v === 'alpha' || v === 'numeric') def.labelRowsAs = v;
  }
  if (result['Label Columns As']) {
    const v = result['Label Columns As'].toLowerCase();
    if (v === 'alpha' || v === 'numeric') def.labelColumnsAs = v;
  }
  if (result['Pile Type']) {
    const v = result['Pile Type'].toLowerCase();
    if (['pile', 'column', 'pier', 'abutment'].includes(v)) {
      def.pileType = v as PileGridDefinition['pileType'];
    }
  }
  if (result['Pile Diameter']) def.pileDiameter = parseFloat(result['Pile Diameter']);
  if (result['Depth']) def.depth = parseFloat(result['Depth']);
  if (result['Coordinate System']) def.coordinateSystem = result['Coordinate System'];

  return def;
}

/**
 * Export a PileGridResult to CSV string (pile coordinates).
 */
export function pileGridToCSV(result: PileGridResult): string {
  const header = [
    'Label', 'Row', 'Column', 'Easting', 'Northing', 'Design RL',
    'Grid Offset E', 'Grid Offset N',
  ].join(',');
  const rows = result.piles.map((p) =>
    [
      p.label, p.row, p.column,
      p.easting.toFixed(4), p.northing.toFixed(4), p.designRL.toFixed(4),
      p.gridOffsetE.toFixed(4), p.gridOffsetN.toFixed(4),
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

// ─── DXF GENERATION ───────────────────────────────────────────────────────────

/**
 * Generate a raw DXF text string for the pile grid setting-out drawing.
 *
 * Layers:
 *   SETOUT_POINTS  - pile positions (POINT entities)
 *   ANNOTATIONS    - pile labels (TEXT entities)
 *   BORDER         - grid outline (LINE entities)
 *   GRID           - internal grid lines (LINE entities, dashed)
 *   PILE_CIRCLE    - pile diameter circles (CIRCLE entities)
 */
export function generatePileGridDXF(result: PileGridResult): string {
  const { definition: def, piles, boundingBox } = result;
  const theta = (def.rotation * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // Helper: rotate local (e, n) offset around origin to world coords
  const rotate = (le: number, ln: number) => ({
    e: le * cosT + ln * sinT + def.originEasting,
    n: -le * sinT + ln * cosT + def.originNorthing,
  });

  const totalWidth = Math.max(def.columns - 1, 0) * def.columnSpacing;
  const totalHeight = Math.max(def.rows - 1, 0) * def.rowSpacing;

  // Grid corners
  const c0 = rotate(0, 0);
  const c1 = rotate(totalWidth, 0);
  const c2 = rotate(totalWidth, totalHeight);
  const c3 = rotate(0, totalHeight);

  const f = (v: number) => v.toFixed(4);

  let dxf = '';

  // ─── HEADER ──────────────────────────────────────────────────────────────
  dxf += `0\nSECTION\n2\nHEADER\n`;
  dxf += `9\n$ACADVER\n1\nAC1021\n`;
  dxf += `9\n$EXTMIN\n10\n${f(boundingBox.minE - 10)}\n20\n${f(boundingBox.minN - 10)}\n30\n0.0\n`;
  dxf += `9\n$EXTMAX\n10\n${f(boundingBox.maxE + 10)}\n20\n${f(boundingBox.maxN + 10)}\n30\n0.0\n`;
  dxf += `0\nENDSEC\n`;

  // ─── TABLES ──────────────────────────────────────────────────────────────
  dxf += `0\nSECTION\n2\nTABLES\n`;
  // LTYPE table with DASHED linetype
  dxf += `0\nTABLE\n2\nLTYPE\n70\n1\n`;
  dxf += `0\nLTYPE\n2\nDASHED\n70\n0\n3\nDash __ __ __ __ __ __ __ __ __ __ __ __ __ _\n72\n65\n73\n2\n40\n5.0\n50\n3.0\n51\n2.0\n`;
  dxf += `0\nENDTAB\n`;
  // LAYER table
  dxf += `0\nTABLE\n2\nLAYER\n70\n5\n`;
  const layers = ['SETOUT_POINTS', 'ANNOTATIONS', 'BORDER', 'GRID', 'PILE_CIRCLE'];
  for (const layer of layers) {
    dxf += `0\nLAYER\n2\n${layer}\n70\n0\n62\n7\n6\nCONTINUOUS\n`;
  }
  dxf += `0\nENDTAB\n`;
  dxf += `0\nENDSEC\n`;

  // ─── ENTITIES ───────────────────────────────────────────────────────────
  dxf += `0\nSECTION\n2\nENTITIES\n`;

  // ─── BORDER: outer rectangle ────────────────────────────────────────────
  const borderCorners = [c0, c1, c2, c3];
  for (let i = 0; i < 4; i++) {
    const p1 = borderCorners[i];
    const p2 = borderCorners[(i + 1) % 4];
    dxf += `0\nLINE\n8\nBORDER\n10\n${f(p1.e)}\n20\n${f(p1.n)}\n30\n0.0\n11\n${f(p2.e)}\n21\n${f(p2.n)}\n31\n0.0\n`;
  }

  // ─── GRID: dashed lines for grid lines ──────────────────────────────────
  // Row grid lines (horizontal in local space)
  for (let r = 1; r < def.rows; r++) {
    const localN = r * def.rowSpacing;
    const p1 = rotate(0, localN);
    const p2 = rotate(totalWidth, localN);
    dxf += `0\nLINE\n8\nGRID\n6\nDASHED\n10\n${f(p1.e)}\n20\n${f(p1.n)}\n30\n0.0\n11\n${f(p2.e)}\n21\n${f(p2.n)}\n31\n0.0\n`;
  }
  // Column grid lines (vertical in local space)
  for (let c = 1; c < def.columns; c++) {
    const localE = c * def.columnSpacing;
    const p1 = rotate(localE, 0);
    const p2 = rotate(localE, totalHeight);
    dxf += `0\nLINE\n8\nGRID\n6\nDASHED\n10\n${f(p1.e)}\n20\n${f(p1.n)}\n30\n0.0\n11\n${f(p2.e)}\n21\n${f(p2.n)}\n31\n0.0\n`;
  }

  // ─── SETOUT_POINTS: POINT entities at each pile ─────────────────────────
  for (const pile of piles) {
    dxf += `0\nPOINT\n8\nSETOUT_POINTS\n10\n${f(pile.easting)}\n20\n${f(pile.northing)}\n30\n0.0\n`;
  }

  // ─── PILE_CIRCLE: CIRCLE entities if pileDiameter > 0 ───────────────────
  if (def.pileDiameter && def.pileDiameter > 0) {
    const radius = def.pileDiameter / 2000; // mm to metres, then /2 for radius
    for (const pile of piles) {
      dxf += `0\nCIRCLE\n8\nPILE_CIRCLE\n10\n${f(pile.easting)}\n20\n${f(pile.northing)}\n30\n0.0\n40\n${f(radius)}\n`;
    }
  }

  // ─── ANNOTATIONS: TEXT entities for labels ───────────────────────────────
  const labelOffset = (def.pileDiameter ? def.pileDiameter / 2000 : 0) + 0.8;
  for (const pile of piles) {
    // Place label north-east of the pile
    const labelE = pile.easting + labelOffset * (sinT * 0.5 + cosT * 0.5);
    const labelN = pile.northing + labelOffset * (cosT * 0.5 - sinT * 0.5);
    dxf += `0\nTEXT\n8\nANNOTATIONS\n10\n${f(labelE)}\n20\n${f(labelN)}\n30\n0.0\n40\n1.2\n1\n${pile.label}\n`;
  }

  dxf += `0\nENDSEC\n0\nEOF\n`;

  return dxf;
}
