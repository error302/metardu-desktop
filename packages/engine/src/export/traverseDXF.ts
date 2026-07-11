/**
 * Traverse-Specific DXF Export Generator
 *
 * Produces a professional traverse plan DXF using the `dxf-writer` library.
 * Designed for Kenyan cadastral surveys — includes control point markers,
 * raw/adjusted traverse lines, parcel boundary, coordinate grid, and a
 * Kenya Survey Regulations-compliant title block.
 *
 * Layers:
 *   CONTROL_POINTS   — Point markers (cross + circle) at each station
 *   CONTROL_LABELS   — Station name labels with coordinates
 *   TRAVERSE_RAW     — Raw traverse legs (dashed, red)
 *   TRAVERSE_ADJUSTED— Adjusted traverse legs (solid, green)
 *   PARCEL_BOUNDARY  — Closed polygon boundary (if applicable)
 *   GRID             — Coordinate grid at 1 km intervals
 *   TITLE_BLOCK      — Title block text and border
 *   BORDER           — Sheet border
 *   NORTH_ARROW      — North arrow symbol
 *   SCALE_BAR        — Scale bar
 *
 * Reference standards:
 * - Survey of Kenya Drawing Standards
 * - Kenya Survey Regulations 1994
 * - ISO 5457 (Technical product documentation — Sizes and layout of drawing sheets)
 * - ISO 7200 (Technical product documentation — Title blocks)
 */

import Drawing from 'dxf-writer'
import { DXF_LAYERS, formatBearingDMS, initialiseSokDXFLayers } from '@/lib/drawing/dxfLayers'

// ─── Public Types ────────────────────────────────────────────────────────────

export interface TraverseStation {
  name: string
  easting: number
  northing: number
  /** Adjusted easting (after traverse computation) */
  adjustedEasting?: number
  /** Adjusted northing (after traverse computation) */
  adjustedNorthing?: number
}

export interface TraverseLeg {
  from: string
  to: string
  bearing: number
  distance: number
}

export interface TraverseMisclosure {
  angular: number
  linear: number
  precisionRatio: number
}

export interface TraverseProjectInfo {
  name: string
  lrNumber: string
  county: string
  datum: string
  surveyor: string
}

export interface TraverseDXFOptions {
  stations: TraverseStation[]
  legs: TraverseLeg[]
  misclosure: TraverseMisclosure
  projectInfo: TraverseProjectInfo
  /** Sheet size for layout (default: 'A3') */
  sheetSize?: 'A0' | 'A1' | 'A2' | 'A3' | 'A4'
  /** Scale denominator e.g. 1000 for 1:1000 (default: auto-computed) */
  scale?: number
  /** Grid interval in meters (default: 1000 for 1km) */
  gridInterval?: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** ACI colour index for traverse-specific layers */
const ACI = {
  WHITE: 7,
  RED: 1,
  GREEN: 3,
  YELLOW: 2,
  CYAN: 4,
  MAGENTA: 6,
  GREY: 8,
  BLUE: 5,
}

/** Sheet dimensions in mm (width, height) — landscape orientation */
const SHEET_DIMS: Record<string, [number, number]> = {
  A0: [1189, 841],
  A1: [841, 594],
  A2: [594, 420],
  A3: [420, 297],
  A4: [297, 210],
}

/** Title block height in mm per sheet size */
const TB_HEIGHT: Record<string, number> = {
  A0: 40,
  A1: 40,
  A2: 30,
  A3: 30,
  A4: 25,
}

/** Border inset from sheet edge in mm */
const BORDER_INSET = 2

/** Inner margin for drawing area in mm */
const INNER_MARGIN = 15

/** Cross marker size for control points (in model units / meters) */
const CROSS_SIZE = 2.0

/** Circle radius for control point markers (in model units / meters) */
const CIRCLE_RADIUS = 1.5

/** Default text height for station labels (model units / meters) */
const LABEL_HEIGHT = 2.0

/** Coordinate label height (model units / meters) */
const COORD_LABEL_HEIGHT = 1.2

/** North arrow size in mm */
const NORTH_ARROW_SIZE = 12

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format number to fixed decimals for DXF */
function f(value: number, decimals = 4): string {
  return value.toFixed(decimals)
}

/** Format an ISO date for display (dd/mm/yyyy) */
function formatPlanDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

/**
 * Compute a sensible scale denominator that fits the traverse data on the sheet.
 * Returns a "nice" number from a standard scale series.
 */
function computeAutoScale(
  stations: TraverseStation[],
  sheetSize: string,
): number {
  if (stations.length === 0) return 1000

  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity
  for (const s of stations) {
    const e = s.adjustedEasting ?? s.easting
    const n = s.adjustedNorthing ?? s.northing
    if (e < minE) minE = e
    if (e > maxE) maxE = e
    if (n < minN) minN = n
    if (n > maxN) maxN = n
  }

  const rangeE = maxE - minE || 100
  const rangeN = maxN - minN || 100

  // Add 20% padding
  const paddedE = rangeE * 1.2
  const paddedN = rangeN * 1.2

  const [sheetW, sheetH] = SHEET_DIMS[sheetSize]
  const drawW = sheetW - 2 * INNER_MARGIN - 40  // mm available for drawing
  const drawH = sheetH - 2 * INNER_MARGIN - TB_HEIGHT[sheetSize] - 20

  // Scale = real_meters / paper_mm * 1000  (to get denominator)
  const scaleE = (paddedE / drawW) * 1000
  const scaleN = (paddedN / drawH) * 1000
  const required = Math.max(scaleE, scaleN)

  // Round up to the nearest "nice" scale from standard series
  const niceScales = [
    50, 100, 200, 250, 500,
    1000, 2000, 2500, 5000,
    10000, 20000, 25000, 50000,
    100000,
  ]
  for (const s of niceScales) {
    if (s >= required) return s
  }
  return niceScales[niceScales.length - 1]
}

/**
 * Build station coordinate lookup (preferring adjusted coordinates).
 */
function buildStationMap(stations: TraverseStation[]): Map<string, { e: number; n: number }> {
  const map = new Map<string, { e: number; n: number }>()
  for (const s of stations) {
    map.set(s.name, {
      e: s.adjustedEasting ?? s.easting,
      n: s.adjustedNorthing ?? s.northing,
    })
  }
  return map
}

// ─── Raw DXF String Building ─────────────────────────────────────────────────

/**
 * Build a north arrow symbol using raw DXF entities.
 * Places a triangular arrow at (x, y) pointing up with a circle and "N" label.
 */
function buildNorthArrow(x: number, y: number): string[] {
  const s = NORTH_ARROW_SIZE
  const parts: string[] = []

  // Shaft
  parts.push(
    '0', 'LINE', '8', 'NORTHARROW',
    '10', f(x), '20', f(y - s * 0.6),
    '11', f(x), '21', f(y + s * 0.4),
  )
  // Arrowhead left
  parts.push(
    '0', 'LINE', '8', 'NORTHARROW',
    '10', f(x), '20', f(y + s * 0.4),
    '11', f(x - s * 0.25), '21', f(y + s * 0.05),
  )
  // Arrowhead right
  parts.push(
    '0', 'LINE', '8', 'NORTHARROW',
    '10', f(x), '20', f(y + s * 0.4),
    '11', f(x + s * 0.25), '21', f(y + s * 0.05),
  )
  // Crossbar base
  parts.push(
    '0', 'LINE', '8', 'NORTHARROW',
    '10', f(x - s * 0.2), '20', f(y - s * 0.6),
    '11', f(x + s * 0.1), '21', f(y - s * 0.6),
  )
  // Circle
  parts.push(
    '0', 'CIRCLE', '8', 'NORTHARROW',
    '10', f(x), '20', f(y - s * 0.1), '30', '0',
    '40', f(s * 0.75),
  )
  // "N" label
  parts.push(
    '0', 'TEXT', '8', 'NORTHARROW',
    '10', f(x), '20', f(y + s * 0.7),
    '40', f(s * 0.4),
    '1', 'N',
    '72', '1',   // horizontal center
    '11', f(x), '21', f(y + s * 0.7),
  )

  return parts
}

/**
 * Build a scale bar using raw DXF entities.
 * Segments are sized based on the scale and sheet size.
 */
function buildScaleBar(x: number, y: number, scale: number, sheetSize: string): string[] {
  const parts: string[] = []
  const barH = 3 // mm

  // Target ~60mm per segment on paper
  const targetRealMeters = 60 * scale / 1000

  // Pick a nice step
  const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
  let segmentMeters = niceSteps[0]
  for (const step of niceSteps) {
    const segmentMm = (step / scale) * 1000
    if (segmentMm >= 25 && segmentMm <= 120) {
      segmentMeters = step
      break
    }
    segmentMeters = step
  }

  const segmentMm = (segmentMeters / scale) * 1000
  const numSegments = 4

  // Draw segments
  for (let i = 0; i < numSegments; i++) {
    const x0 = x + i * segmentMm
    const x1 = x + (i + 1) * segmentMm
    parts.push(
      '0', 'LWPOLYLINE', '8', 'SCALEBAR',
      '90', '4', '70', '1',
      '10', f(x0), '20', f(y),
      '10', f(x0), '20', f(y + barH),
      '10', f(x1), '20', f(y + barH),
      '10', f(x1), '20', f(y),
    )
  }

  // Outer outline
  const totalW = numSegments * segmentMm
  parts.push(
    '0', 'LWPOLYLINE', '8', 'SCALEBAR',
    '90', '4', '70', '1',
    '10', f(x), '20', f(y),
    '10', f(x), '20', f(y + barH),
    '10', f(x + totalW), '20', f(y + barH),
    '10', f(x + totalW), '20', f(y),
  )

  // Labels
  const labelH = barH * 0.8
  for (let i = 0; i <= numSegments; i++) {
    const px = x + i * segmentMm
    const totalM = i * segmentMeters
    const label = totalM >= 1000
      ? `${(totalM / 1000).toFixed(totalM % 1000 === 0 ? 0 : 1)}km`
      : `${totalM}m`
    parts.push(
      '0', 'TEXT', '8', 'SCALEBAR',
      '10', f(px), '20', f(y - 2.5),
      '40', f(labelH),
      '1', label,
      '72', '1',
      '11', f(px), '21', f(y - 2.5),
    )
  }

  // Per-division label
  const segLabel = segmentMeters >= 1000
    ? `${(segmentMeters / 1000).toFixed(segmentMeters % 1000 === 0 ? 0 : 1)}km`
    : `${segmentMeters}m`
  parts.push(
    '0', 'TEXT', '8', 'SCALEBAR',
    '10', f(x + totalW / 2), '20', f(y - 2.5 - labelH - 1),
    '40', f(labelH),
    '1', `${segLabel} / div`,
    '72', '1',
    '11', f(x + totalW / 2), '21', f(y - 2.5 - labelH - 1),
  )

  return parts
}

// ─── Main Generator ──────────────────────────────────────────────────────────

/**
 * Generate a professional traverse plan DXF file.
 *
 * Uses the `dxf-writer` library for the core drawing, and appends raw DXF
 * strings for the title block, north arrow, scale bar, grid, and border
 * (following the `dxfSheetLayout.ts` pattern for maximum CAD compatibility).
 *
 * The resulting DXF is fully compatible with AutoCAD, LibreCAD, DraftSight,
 * and QCAD.
 *
 * @param options - Traverse data and project metadata
 * @returns Complete DXF file as a string
 */
export function generateTraverseDXF(options: TraverseDXFOptions): string {
  const {
    stations,
    legs,
    misclosure,
    projectInfo,
    sheetSize = 'A3',
    scale: userScale,
    gridInterval = 1000,
  } = options

  // ── Compute scale ───────────────────────────────────────────────────────
  const scale = userScale ?? computeAutoScale(stations, sheetSize)

  // ── Build station coordinate maps ────────────────────────────────────────
  const adjMap = buildStationMap(stations)      // adjusted (or raw if no adj)
  const rawMap = new Map<string, { e: number; n: number }>()
  for (const s of stations) {
    rawMap.set(s.name, { e: s.easting, n: s.northing })
  }

  // ── Compute coordinate extents ──────────────────────────────────────────
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity
  for (const s of stations) {
    const e = s.adjustedEasting ?? s.easting
    const n = s.adjustedNorthing ?? s.northing
    if (e < minE) minE = e
    if (e > maxE) maxE = e
    if (n < minN) minN = n
    if (n > maxN) maxN = n
  }

  // Add padding for labels and markers
  const padding = Math.max((maxE - minE) * 0.1, 10)
  minE -= padding; maxE += padding
  minN -= padding; maxN += padding

  // ── Create dxf-writer Drawing ───────────────────────────────────────────
  const drawing = new Drawing()
  drawing.setUnits('Meters')

  // Register standard layers from dxfLayers.ts
  initialiseSokDXFLayers(drawing)

  // Register traverse-specific layers
  drawing.addLayer('CONTROL_POINTS', ACI.MAGENTA, 'CONTINUOUS')
  drawing.addLayer('CONTROL_LABELS', ACI.WHITE, 'CONTINUOUS')
  drawing.addLayer('TRAVERSE_RAW', ACI.RED, 'DASHED')
  drawing.addLayer('TRAVERSE_ADJUSTED', ACI.GREEN, 'CONTINUOUS')
  drawing.addLayer('PARCEL_BOUNDARY', ACI.YELLOW, 'CONTINUOUS')
  drawing.addLayer('GRID', ACI.GREY, 'DASHED')
  drawing.addLayer('TITLE_BLOCK', ACI.WHITE, 'CONTINUOUS')
  drawing.addLayer('BORDER', ACI.WHITE, 'CONTINUOUS')

  // Register line types
  drawing.addLineType('DASHED', 'Dashed', [-1.0, 0.5])
  drawing.addLineType('DASHDOT', 'DashDot', [-2.0, 0.5, 0.1, 0.5])

  // ── Draw Coordinate Grid ───────────────────────────────────────────────
  drawing.setActiveLayer('GRID')
  const startE = Math.floor(minE / gridInterval) * gridInterval
  const startN = Math.floor(minN / gridInterval) * gridInterval

  for (let e = startE; e <= maxE; e += gridInterval) {
    drawing.drawLine(e, minN, e, maxN)
  }
  for (let n = startN; n <= maxN; n += gridInterval) {
    drawing.drawLine(minE, n, maxE, n)
  }

  // Grid labels
  drawing.setActiveLayer('CONTROL_LABELS')
  for (let e = startE; e <= maxE; e += gridInterval) {
    drawing.drawText(
      e, minN - LABEL_HEIGHT * 1.2,
      COORD_LABEL_HEIGHT, 0, String(e),
      'center', 'top',
    )
    drawing.drawText(
      e, maxN + COORD_LABEL_HEIGHT * 0.5,
      COORD_LABEL_HEIGHT, 0, String(e),
      'center', 'baseline',
    )
  }
  for (let n = startN; n <= maxN; n += gridInterval) {
    drawing.drawText(
      minE - LABEL_HEIGHT * 0.5, n,
      COORD_LABEL_HEIGHT, 90, String(n),
      'right', 'middle',
    )
    drawing.drawText(
      maxE + COORD_LABEL_HEIGHT * 0.5, n,
      COORD_LABEL_HEIGHT, 90, String(n),
      'left', 'middle',
    )
  }

  // ── Draw Raw Traverse Lines (dashed, red) ───────────────────────────────
  drawing.setActiveLayer('TRAVERSE_RAW')
  for (const leg of legs) {
    const from = rawMap.get(leg.from)
    const to = rawMap.get(leg.to)
    if (!from || !to) continue
    drawing.drawLine(from.e, from.n, to.e, to.n)
  }

  // ── Draw Adjusted Traverse Lines (solid, green) ─────────────────────────
  const hasAdjusted = stations.some(s => s.adjustedEasting !== undefined)
  if (hasAdjusted) {
    drawing.setActiveLayer('TRAVERSE_ADJUSTED')
    for (const leg of legs) {
      const from = adjMap.get(leg.from)
      const to = adjMap.get(leg.to)
      if (!from || !to) continue
      drawing.drawLine(from.e, from.n, to.e, to.n)
    }
  }

  // ── Draw Parcel Boundary (closed polygon if traverse closes) ────────────
  const closes = legs.length >= 3 &&
    legs[0].from === legs[legs.length - 1].to
  if (closes && adjMap.size >= 3) {
    drawing.setActiveLayer('PARCEL_BOUNDARY')
    const orderedStations: [number, number][] = []
    // Follow legs order to construct polygon vertices
    const visited = new Set<string>()
    let current = legs[0].from
    for (let i = 0; i <= legs.length; i++) {
      if (visited.has(current)) break
      visited.add(current)
      const pt = adjMap.get(current)
      if (pt) orderedStations.push([pt.e, pt.n])
      // Find the next station
      const leg = legs.find(l => l.from === current)
      if (!leg) break
      current = leg.to
    }

    if (orderedStations.length >= 3) {
      drawing.drawPolyline(orderedStations, true)
    }
  }

  // ── Draw Control Point Markers (cross + circle) ─────────────────────────
  drawing.setActiveLayer('CONTROL_POINTS')
  for (const s of stations) {
    const e = s.adjustedEasting ?? s.easting
    const n = s.adjustedNorthing ?? s.northing

    // Cross marker
    drawing.drawLine(e - CROSS_SIZE, n, e + CROSS_SIZE, n)
    drawing.drawLine(e, n - CROSS_SIZE, e, n + CROSS_SIZE)

    // Circle
    drawing.drawCircle(e, n, CIRCLE_RADIUS)
  }

  // ── Draw Station Labels ─────────────────────────────────────────────────
  drawing.setActiveLayer('CONTROL_LABELS')
  for (const s of stations) {
    const e = s.adjustedEasting ?? s.easting
    const n = s.adjustedNorthing ?? s.northing

    // Station name
    drawing.drawText(
      e + CIRCLE_RADIUS + 1,
      n + CIRCLE_RADIUS + 1,
      LABEL_HEIGHT, 0, s.name,
    )

    // Coordinates label (E/N)
    const coordText = `E: ${e.toFixed(3)}  N: ${n.toFixed(3)}`
    drawing.drawText(
      e + CIRCLE_RADIUS + 1,
      n + CIRCLE_RADIUS + 1 - LABEL_HEIGHT * 1.5,
      COORD_LABEL_HEIGHT, 0, coordText,
    )
  }

  // ── Build dxf-writer core output ────────────────────────────────────────
  const coreDxf = drawing.toDxfString()

  // ── Build title block, north arrow, scale bar, border via raw DXF ──────
  const rawParts: string[] = []

  const [sheetW, sheetH] = SHEET_DIMS[sheetSize]
  const tbH = TB_HEIGHT[sheetSize]

  // Inner drawing area bounds (in mm)
  const innerLeft = INNER_MARGIN
  const innerBottom = INNER_MARGIN + tbH
  const innerRight = sheetW - INNER_MARGIN
  const innerTop = sheetH - INNER_MARGIN

  // ── Outer border ──
  rawParts.push(
    '0', 'LWPOLYLINE', '8', 'BORDER',
    '90', '4', '70', '1',
    '10', f(BORDER_INSET), '20', f(BORDER_INSET),
    '10', f(sheetW - BORDER_INSET), '20', f(BORDER_INSET),
    '10', f(sheetW - BORDER_INSET), '20', f(sheetH - BORDER_INSET),
    '10', f(BORDER_INSET), '20', f(sheetH - BORDER_INSET),
  )

  // ── Inner border ──
  rawParts.push(
    '0', 'LWPOLYLINE', '8', 'BORDER',
    '90', '4', '70', '1',
    '10', f(innerLeft), '20', f(innerBottom),
    '10', f(innerRight), '20', f(innerBottom),
    '10', f(innerRight), '20', f(innerTop),
    '10', f(innerLeft), '20', f(innerTop),
  )

  // ── Title Block ─────────────────────────────────────────────────────────
  const tbLeft = BORDER_INSET
  const tbRight = sheetW - BORDER_INSET
  const tbTop = INNER_MARGIN + tbH
  const tbBottom = BORDER_INSET

  // Title block outer rectangle
  rawParts.push(
    '0', 'LWPOLYLINE', '8', 'TITLE_BLOCK',
    '90', '4', '70', '1',
    '10', f(tbLeft), '20', f(tbBottom),
    '10', f(tbRight), '20', f(tbBottom),
    '10', f(tbRight), '20', f(tbTop),
    '10', f(tbLeft), '20', f(tbTop),
  )

  // Row divider (top ~45% vs bottom ~55%)
  const rowDivY = tbBottom + tbH * 0.45
  rawParts.push(
    '0', 'LINE', '8', 'TITLE_BLOCK',
    '10', f(tbLeft), '20', f(rowDivY),
    '11', f(tbRight), '21', f(rowDivY),
  )

  // Column dividers in top row
  const col1W = (tbRight - tbLeft) * 0.45
  const col2W = (tbRight - tbLeft) * 0.20
  const col3W = (tbRight - tbLeft) * 0.15
  const col4W = (tbRight - tbLeft) * 0.10
  const col1R = tbLeft + col1W
  const col2R = col1R + col2W
  const col3R = col2R + col3W
  const col4R = col3R + col4W

  for (const x of [col1R, col2R, col3R, col4R]) {
    rawParts.push(
      '0', 'LINE', '8', 'TITLE_BLOCK',
      '10', f(x), '20', f(rowDivY),
      '11', f(x), '21', f(tbTop),
    )
  }

  // Column dividers in bottom row
  const bCol1R = tbLeft + (tbRight - tbLeft) * 0.40
  const bCol2R = tbLeft + (tbRight - tbLeft) * 0.65
  for (const x of [bCol1R, bCol2R]) {
    rawParts.push(
      '0', 'LINE', '8', 'TITLE_BLOCK',
      '10', f(x), '20', f(tbBottom),
      '11', f(x), '21', f(rowDivY),
    )
  }

  // ── Title Block Text ────────────────────────────────────────────────────
  const isLarge = sheetSize === 'A0' || sheetSize === 'A1'
  const titleH = isLarge ? 5 : 3.5
  const subtitleH = isLarge ? 3 : 2.5
  const bodyH = isLarge ? 2.5 : 2
  const smallH = isLarge ? 2 : 1.8

  // Helper: centred text
  function addT(layer: string, text: string, x: number, y: number, h: number) {
    rawParts.push(
      '0', 'TEXT', '8', layer,
      '10', f(x), '20', f(y), '30', f(0),
      '40', f(h),
      '1', text,
      '72', '1',
      '11', f(x), '21', f(y), '31', f(0),
    )
  }

  // Top row — Col 1: Republic of Kenya / Project name
  addT('TITLE_BLOCK', 'REPUBLIC OF KENYA',
    (tbLeft + col1R) / 2, rowDivY + tbH * 0.65, subtitleH)
  addT('TITLE_BLOCK', projectInfo.name,
    (tbLeft + col1R) / 2, rowDivY + tbH * 0.30, titleH)
  addT('TITLE_BLOCK', `LR No: ${projectInfo.lrNumber}`,
    (tbLeft + col1R) / 2, rowDivY + tbH * 0.08, bodyH)

  // Top row — Col 2: Scale
  addT('TITLE_BLOCK', `SCALE 1:${scale}`,
    (col1R + col2R) / 2, rowDivY + tbH * 0.50, subtitleH)
  addT('TITLE_BLOCK', 'METRIC',
    (col1R + col2R) / 2, rowDivY + tbH * 0.20, smallH)

  // Top row — Col 3: Coordinate System
  addT('TITLE_BLOCK', 'COORD SYSTEM',
    (col2R + col3R) / 2, rowDivY + tbH * 0.60, smallH)
  const cs = projectInfo.datum || 'Arc 1960 / UTM Zone 37S'
  addT('TITLE_BLOCK', cs,
    (col2R + col3R) / 2, rowDivY + tbH * 0.25, bodyH)

  // Top row — Col 4: Sheet / Revision
  addT('TITLE_BLOCK', 'Sheet 1 of 1',
    (col3R + col4R) / 2, rowDivY + tbH * 0.40, bodyH)

  // Top row — Col 5: METARDU branding
  addT('TITLE_BLOCK', 'METARDU',
    (col4R + tbRight) / 2, rowDivY + tbH * 0.60, bodyH)
  addT('TITLE_BLOCK', 'Traverse Plan',
    (col4R + tbRight) / 2, rowDivY + tbH * 0.35, smallH)

  // Bottom row text
  const botMidY = (tbBottom + rowDivY) / 2
  const botTopY = rowDivY - tbH * 0.12
  const botBotY = tbBottom + tbH * 0.12

  // Bottom Col A: Surveyor
  addT('TITLE_BLOCK', 'Licensed Surveyor:',
    (tbLeft + bCol1R) / 2, botTopY, smallH)
  addT('TITLE_BLOCK', projectInfo.surveyor || '—',
    (tbLeft + bCol1R) / 2, botMidY, bodyH)

  // Bottom Col B: County
  addT('TITLE_BLOCK', 'County:',
    (bCol1R + bCol2R) / 2, botTopY, smallH)
  addT('TITLE_BLOCK', projectInfo.county || '—',
    (bCol1R + bCol2R) / 2, botMidY, bodyH)

  // Bottom Col C: Date + misclosure
  addT('TITLE_BLOCK', `Date: ${formatPlanDate(new Date())}`,
    (bCol2R + tbRight) / 2, botTopY, bodyH)

  // Misclosure info
  if (misclosure) {
    const miscText = `Misclosure: L=${misclosure.linear.toFixed(4)}m  1:${misclosure.precisionRatio.toFixed(0)}`
    addT('TITLE_BLOCK', miscText,
      (bCol2R + tbRight) / 2, botMidY, smallH)
  }

  addT('TITLE_BLOCK', 'As per Kenya Survey Regulations 1994',
    (bCol2R + tbRight) / 2, botBotY, smallH)

  // ── North Arrow ─────────────────────────────────────────────────────────
  const arrowX = innerRight - NORTH_ARROW_SIZE * 1.5
  const arrowY = innerTop - NORTH_ARROW_SIZE * 1.5
  rawParts.push(...buildNorthArrow(arrowX, arrowY))

  // ── Scale Bar ───────────────────────────────────────────────────────────
  rawParts.push(...buildScaleBar(innerLeft + 10, innerBottom + 8, scale, sheetSize))

  // ── Traverse Summary Table (raw DXF text above title block) ─────────────
  const summaryY = innerBottom + 25
  addT('CONTROL_LABELS', 'TRAVERSE SUMMARY', innerLeft + 5, summaryY + 18, subtitleH)
  addT('CONTROL_LABELS', `Stations: ${stations.length}  |  Legs: ${legs.length}`,
    innerLeft + 5, summaryY + 14, bodyH)
  if (misclosure) {
    addT('CONTROL_LABELS',
      `Angular Misclosure: ${formatBearingDMS(misclosure.angular)}`,
      innerLeft + 5, summaryY + 10, bodyH)
    addT('CONTROL_LABELS',
      `Linear Misclosure: ${misclosure.linear.toFixed(4)} m`,
      innerLeft + 5, summaryY + 6, bodyH)
    addT('CONTROL_LABELS',
      `Precision Ratio: 1 : ${misclosure.precisionRatio.toFixed(0)}`,
      innerLeft + 5, summaryY + 2, bodyH)
  }

  // ── Merge raw entities into the dxf-writer output ───────────────────────
  // Insert before EOF in the dxf-writer output
  const eofMarker = '0\nEOF'
  const eofIdx = coreDxf.lastIndexOf(eofMarker)
  if (eofIdx !== -1) {
    return (
      coreDxf.substring(0, eofIdx) +
      rawParts.join('\n') + '\n' +
      coreDxf.substring(eofIdx)
    )
  }

  // Fallback: append
  return coreDxf + '\n' + rawParts.join('\n') + '\n0\nEOF\n'
}

/**
 * Initialise standard DXF layers on a dxf-writer Drawing instance.
 * Re-exports the standard layer definitions from dxfLayers.ts and also
 * registers traverse-specific layers.
 * @deprecated Use initialiseSokDXFLayers() from dxfLayers.ts instead.
 */
function initialiseDXFLayers(drawing: Drawing): void {
  initialiseSokDXFLayers(drawing)
}
