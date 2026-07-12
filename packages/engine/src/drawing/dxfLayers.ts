import Drawing from 'dxf-writer'

/**
 * SoK DXF Layer Standard — METARDU Canonical Layer Registry
 *
 * Based on Survey of Kenya / LISCAD CAD conventions.
 * Every METARDU DXF export uses these layers.
 *
 * References:
 *   - SoK Survey Regulations 1994, Cap 299
 *   - RDM 1.1 (2025) symbol standards
 *   - LISCAD layer naming conventions used by GoK cadastral offices
 *   - AutoCAD Color Index (ACI): 1=Red, 2=Yellow, 3=Green, 4=Cyan,
 *     5=Blue, 6=Magenta, 7=White/Black, 8=Gray
 *
 * Migration: replace calls to initialiseDXFLayers() with initialiseSokDXFLayers()
 * throughout the codebase. The old function is kept for backward compatibility
 * during the transition period.
 */

// ── Canonical layer definitions ────────────────────────────────────────────────

export const DXF_LAYERS = {
  // ── Cadastral layers ──────────────────────────────────────────────────────────
  /** New parcel boundary (solid red) */
  PARCEL_BDY:      { name: 'PARCEL_BDY',    color: 1, linetype: 'CONTINUOUS' },
  /** Existing/registered boundary (dashed gray) */
  EXIST_BDY:      { name: 'EXIST_BDY',    color: 8, linetype: 'DASHED'     },
  /** All boundary beacons — concrete, iron pin, masonry nail */
  BEACONS:         { name: 'BEACONS',       color: 2, linetype: 'CONTINUOUS' },
  /** Benchmark and vertical control marks */
  BMARK:           { name: 'BMARK',         color: 3, linetype: 'CONTINUOUS' },
  /** Survey control points (PSC, SSC, TSC) */
  CONTROL:         { name: 'CONTROL',      color: 4, linetype: 'CONTINUOUS' },
  /** Dimension/projection lines */
  DIMENS:          { name: 'DIMENS',        color: 3, linetype: 'CONTINUOUS' },
  /** Bearing annotations (N 00°00'00"E format) */
  BEARINGS:        { name: 'BEARINGS',      color: 3, linetype: 'CONTINUOUS' },
  /** Distance annotations (metres, 3dp) */
  DISTANCES:       { name: 'DISTANCES',     color: 3, linetype: 'CONTINUOUS' },
  /** Area text annotations */
  AREA_TXT:        { name: 'AREA_TXT',     color: 1, linetype: 'CONTINUOUS' },
  /** Parcel / LR number and abuttal labels */
  PARCEL_TXT:      { name: 'PARCEL_TXT',   color: 7, linetype: 'CONTINUOUS' },
  /** Beacon point labels (point names) */
  BEACON_TXT:      { name: 'BEACON_TXT',   color: 7, linetype: 'CONTINUOUS' },
  /** General notes and annotations */
  NOTES_TXT:       { name: 'NOTES_TXT',    color: 7, linetype: 'CONTINUOUS' },
  /** Title block frame and all content */
  TITLE_BLK:       { name: 'TITLE_BLK',    color: 7, linetype: 'CONTINUOUS' },
  /** Scale bar and divisions */
  SCL_BAR:         { name: 'SCL_BAR',      color: 7, linetype: 'CONTINUOUS' },
  /** North arrow */
  NORTH_ARR:       { name: 'NORTH_ARR',   color: 7, linetype: 'CONTINUOUS' },
  /** UTM coordinate grid lines */
  GRID:             { name: 'GRID',          color: 8, linetype: 'DASHED'     },

  // ── Topographic layers ──────────────────────────────────────────────────────
  /** Minor/intermediate contour lines */
  CONTOURS:         { name: 'CONTOURS',    color: 4, linetype: 'CONTINUOUS' },
  /** Index contours (every 5th, visually heavier) */
  CONTOUR_I:        { name: 'CONTOUR_I',   color: 4, linetype: 'CONTINUOUS' },
  /** Spot heights with elevation labels */
  SPOT:             { name: 'SPOT',          color: 2, linetype: 'CONTINUOUS' },
  /** Topographic detail grid */
  TOPO_GRID:        { name: 'TOPO_GRID',   color: 8, linetype: 'DASHED'     },
  /** Main/permanent buildings (solid) */
  BUILDING:         { name: 'BUILDING',    color: 7, linetype: 'CONTINUOUS' },
  /** Subsidiary buildings (dashed/finer) */
  BLDG_SS:          { name: 'BLDG_SS',     color: 7, linetype: 'DASHED'     },
  /** Fence lines (chain-link, barbed wire, wall) */
  FENCE:            { name: 'FENCE',        color: 7, linetype: 'DASHED'     },
  /** Permanent wall boundaries */
  WALL:             { name: 'WALL',         color: 7, linetype: 'CONTINUOUS' },
  /** Road kerb/edge lines */
  ROAD_EDGE:        { name: 'ROAD_EDGE',   color: 7, linetype: 'CONTINUOUS' },
  /** Road centreline */
  ROAD_CENT:        { name: 'ROAD_CENT',   color: 1, linetype: 'CONTINUOUS' },
  /** Access paths and tracks */
  ACCESS_PTH:       { name: 'ACCESS_PTH',  color: 8, linetype: 'DASHED'     },
  /** Water courses — use linetype to distinguish perennial/intermittent */
  WATER:            { name: 'WATER',        color: 5, linetype: 'CONTINUOUS' },
  /** Open drains and canals */
  DRAINAGE:         { name: 'DRAINAGE',     color: 5, linetype: 'DASHED'     },
  /** Significant trees (with species label) */
  TREES:            { name: 'TREES',        color: 3, linetype: 'CONTINUOUS' },
  /** Utility lines — power, telecoms */
  UTILITY:           { name: 'UTILITY',     color: 1, linetype: 'DASHED'     },
  /** Pipelines — oil, gas, water */
  PIPE:             { name: 'PIPE',         color: 1, linetype: 'DASHED'     },
  /** Railway lines */
  RAIL:             { name: 'RAIL',         color: 4, linetype: 'CONTINUOUS' },
  /** Public right-of-way boundaries */
  PROW:             { name: 'PROW',         color: 2, linetype: 'DASHED'     },

  // ── Engineering / road survey layers ───────────────────────────────────────
  /** Road/street centerline */
  CENTERLINE:       { name: 'CENTERLINE',  color: 1, linetype: 'CONTINUOUS' },
  /** Chainage markers */
  CHAIN:            { name: 'CHAIN',       color: 3, linetype: 'CONTINUOUS' },
  /** Cross-section lines */
  XSECTION:         { name: 'XSECTION',    color: 6, linetype: 'CONTINUOUS' },
  /** Longitudinal profile line */
  PROFILE:           { name: 'PROFILE',     color: 6, linetype: 'CONTINUOUS' },
  /** Culvert symbols */
  CULVERT:          { name: 'CULVERT',     color: 4, linetype: 'CONTINUOUS' },
  /** Right-of-way boundaries */
  ROW_BDY:           { name: 'ROW_BDY',    color: 2, linetype: 'DASHED'     },
  /** Setting-out pegs */
  SETOUT:            { name: 'SETOUT',     color: 5, linetype: 'CONTINUOUS' },
  /** Cut slope edge */
  CUT_EDGE:          { name: 'CUT_EDGE',   color: 1, linetype: 'DASHED'     },
  /** Fill slope edge */
  FILL_EDGE:         { name: 'FILL_EDGE',  color: 3, linetype: 'DASHED'     },

  // ── Legacy aliases (map to canonical names for backward compat) ──────────────
  // These are kept so old code still compiles during the transition period.
  // All new code must use the canonical names above.
  WORKING:       { name: 'PARCEL_BDY',   color: 7, linetype: 'CONTINUOUS' },
  BOUNDARY:      { name: 'PARCEL_BDY',   color: 1, linetype: 'CONTINUOUS' },
  BEACON_LABELS: { name: 'BEACON_TXT',   color: 7, linetype: 'CONTINUOUS' },
  AREA_LABEL:    { name: 'AREA_TXT',     color: 1, linetype: 'CONTINUOUS' },
  TITLE_BLOCK:   { name: 'TITLE_BLK',   color: 7, linetype: 'CONTINUOUS' },
  TITLEBLOCK:    { name: 'TITLE_BLK',   color: 7, linetype: 'CONTINUOUS' },
  SCALE_BAR:     { name: 'SCL_BAR',     color: 7, linetype: 'CONTINUOUS' },
  SCALEBAR:      { name: 'SCL_BAR',     color: 7, linetype: 'CONTINUOUS' },
  NORTH_ARROW:   { name: 'NORTH_ARR',  color: 7, linetype: 'CONTINUOUS' },
  NORTHARROW:    { name: 'NORTH_ARR',  color: 7, linetype: 'CONTINUOUS' },
  ANNOTATIONS:   { name: 'NOTES_TXT',   color: 7, linetype: 'CONTINUOUS' },
  CENTRELINE:    { name: 'ROAD_CENT',  color: 1, linetype: 'CONTINUOUS' },
  CONTOURS_IDX:  { name: 'CONTOUR_I',  color: 4, linetype: 'CONTINUOUS' },
  OLD_BOUNDARY:  { name: 'EXIST_BDY',  color: 8, linetype: 'DASHED'     },
  NEW_BOUNDARY:  { name: 'PARCEL_BDY', color: 1, linetype: 'CONTINUOUS' },
  TRAVERSE:      { name: 'CONTROL',    color: 4, linetype: 'CONTINUOUS' },
  CONTROL_POINTS:{ name: 'CONTROL',   color: 4, linetype: 'CONTINUOUS' },
  SETOUT_POINTS: { name: 'SETOUT',     color: 5, linetype: 'CONTINUOUS' },
} as const

export type DXFLayerKey = keyof typeof DXF_LAYERS

/**
 * Register all SoK-standard DXF layers with correct colors and linetypes.
 * Call this as the first step in every DXF generation function.
 */
export function initialiseSokDXFLayers(drawing: Drawing): void {
  Object.values(DXF_LAYERS).forEach(layer => {
    drawing.addLayer(layer.name, layer.color, layer.linetype)
  })
  // Ensure custom linetypes are registered
  drawing.addLineType('DASHED', 'Dashed', [-1.0, -0.5])
  drawing.addLineType('DOTTED', 'Dotted', [-0.25, -0.25])
  drawing.addLineType('CENTER', 'Center', [-2.0, -0.5, 0, -0.5])
  drawing.addLineType('PHANTOM', 'Phantom', [-2.0, -0.5, -0.5, -0.5])
}

/**
 * @deprecated Use initialiseSokDXFLayers() instead.
 * Kept for backward compatibility during transition.
 */
export function initialiseDXFLayers(drawing: Drawing): void {
  initialiseSokDXFLayers(drawing)
}

export interface TitleBlockData {
  drawingTitle: string
  lrNumber: string
  county: string
  district: string
  locality: string
  areaHa: number
  perimeterM: number
  surveyorName: string
  registrationNumber: string
  firmName: string
  date: string
  submissionRef: string
  coordinateSystem: string
  scale: string
  sheetNumber: string
  revision: string
}

export interface FormNo4TitleBlockData {
  lrNumber: string
  parcelNumber: string
  county: string
  division: string
  district: string
  locality: string
  areaHa: string
  perimeterM: string
  surveyorName: string
  iskNumber: string
  firmName: string
  surveyDate: string
  scale: string
  sheet: string
  revision: string
  referenceNumber: string
}

export function formatPlanDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

export function formatBearingDMS(decimalDegrees: number): string {
  const normalised = ((decimalDegrees % 360) + 360) % 360
  const totalSeconds = Math.round(normalised * 3600)
  const d = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${String(d).padStart(3, '0')}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"`
}

export function formatDistanceM(metres: number): string {
  return metres.toFixed(3)
}

export const TITLE_BLOCK_TEMPLATES = {
  eng_horizontal_curve: { drawingTitle: 'Horizontal Curve Layout' },
  eng_superelevation: { drawingTitle: 'Superelevation Diagram' },
  eng_volumes: { drawingTitle: 'Volume Calculation Sheet' },
  cadastral_form4: { drawingTitle: 'Form No. 4 - Plan of Survey' },
  topo_contours: { drawingTitle: 'Topographic Contour Plan' },
  mining_section: { drawingTitle: 'Mining Section' },
} as const

export function addStandardTitleBlock(
  drawing: Drawing,
  data: TitleBlockData,
  originX = 0,
  originY = -30
): void {
  drawing.setActiveLayer(DXF_LAYERS.TITLE_BLK.name)

  const rows: [number, string][] = [
    [0,   `REPUBLIC OF KENYA`],
    [-4,  `SURVEY OF KENYA`],
    [-8,  data.drawingTitle],
    [-14, `LR No: ${data.lrNumber}`],
    [-18, `County: ${data.county}`],
    [-22, `District: ${data.district}`],
    [-26, `Locality: ${data.locality}`],
    [-32, `Area: ${data.areaHa.toFixed(4)} Ha (${(data.areaHa * 10000).toFixed(2)} m²)`],
    [-36, `Perimeter: ${data.perimeterM.toFixed(3)} m`],
    [-42, `Licensed Surveyor: ${data.surveyorName}`],
    [-46, `Reg. No: ${data.registrationNumber}`],
    [-50, `Firm: ${data.firmName}`],
    [-56, `Date: ${data.date}`],
    [-60, `Scale: ${data.scale}`],
    [-64, `Coord. System: ${data.coordinateSystem}`],
    [-68, `Submission Ref: ${data.submissionRef}`],
    [-72, `Sheet: ${data.sheetNumber}  Rev: ${data.revision}`],
  ]

  rows.forEach(([yOffset, text]) => {
    drawing.drawText(
      originX + 2,
      originY + yOffset,
      yOffset <= -8 && yOffset >= -8 ? 2.5 : 1.5,
      0,
      text
    )
  })
}
