/**
 * @module cutFillEngine
 *
 * Cut and Fill Earthwork Calculation Engine
 *
 * Computes earthwork volumes using the grid method:
 * 1. Import Existing Ground surface (Grid A) and Design Grade (Grid B)
 * 2. For each grid cell, compute depth variance: ΔZ = Z_design - Z_existing
 * 3. Cell Volume = Cell Area × ΔZ
 * 4. Sum positive volumes (fill) and negative volumes (cut)
 *
 * Outputs:
 * - Total cut volume (m³)
 * - Total fill volume (m³)
 * - Net volume (cut - fill)
 * - Heat map data for visualization
 * - Grid-level breakdown
 *
 * Reference: "Construction Surveying" by Augelli & Pence (Chapter 8)
 */

export interface GridPoint {
  easting: number
  northing: number
  elevation: number
}

export interface GridSurface {
  /** Grid points in row-major order */
  points: GridPoint[]
  /** Spacing between grid points in meters */
  spacing: number
  /** Number of rows */
  rows: number
  /** Number of columns */
  cols: number
}

export interface CutFillCell {
  row: number
  col: number
  easting: number
  northing: number
  existingElevation: number
  designElevation: number
  deltaZ: number  // design - existing (positive = fill, negative = cut)
  area: number    // m²
  volume: number  // m³
  type: 'cut' | 'fill' | 'none'
}

export interface CutFillResult {
  cells: CutFillCell[]
  totalCutVolume: number  // m³
  totalFillVolume: number // m³
  netVolume: number       // m³ (negative = net cut, positive = net fill)
  totalArea: number       // m²
  cutArea: number         // m²
  fillArea: number        // m²
  avgCutDepth: number     // m
  avgFillDepth: number    // m
  maxCutDepth: number     // m
  maxFillDepth: number    // m
}

/**
 * Compute cut and fill volumes between existing and design surfaces.
 *
 * Both surfaces must have the same grid dimensions and spacing.
 *
 * @param existing - Existing ground surface
 * @param design - Design grade surface
 * @returns Cut and fill computation result
 */
export function computeCutFill(
  existing: GridSurface,
  design: GridSurface,
): CutFillResult {
  if (existing.rows !== design.rows || existing.cols !== design.cols) {
    throw new Error('Grid dimensions must match between existing and design surfaces')
  }

  const cellArea = existing.spacing * existing.spacing
  const cells: CutFillCell[] = []

  let totalCutVolume = 0
  let totalFillVolume = 0
  let cutArea = 0
  let fillArea = 0
  let maxCutDepth = 0
  let maxFillDepth = 0

  for (let row = 0; row < existing.rows; row++) {
    for (let col = 0; col < existing.cols; col++) {
      const idx = row * existing.cols + col
      const existingPt = existing.points[idx]
      const designPt = design.points[idx]

      if (!existingPt || !designPt) continue

      const deltaZ = designPt.elevation - existingPt.elevation
      const volume = cellArea * deltaZ

      const type: 'cut' | 'fill' | 'none' =
        deltaZ < -0.001 ? 'cut' :
        deltaZ > 0.001 ? 'fill' : 'none'

      if (type === 'cut') {
        totalCutVolume += Math.abs(volume)
        cutArea += cellArea
        maxCutDepth = Math.min(maxCutDepth, deltaZ)
      } else if (type === 'fill') {
        totalFillVolume += volume
        fillArea += cellArea
        maxFillDepth = Math.max(maxFillDepth, deltaZ)
      }

      cells.push({
        row,
        col,
        easting: existingPt.easting,
        northing: existingPt.northing,
        existingElevation: existingPt.elevation,
        designElevation: designPt.elevation,
        deltaZ,
        area: cellArea,
        volume,
        type,
      })
    }
  }

  const totalArea = existing.rows * existing.cols * cellArea
  const cutCells = cells.filter(c => c.type === 'cut')
  const fillCells = cells.filter(c => c.type === 'fill')

  return {
    cells,
    totalCutVolume,
    totalFillVolume,
    netVolume: totalFillVolume - totalCutVolume,
    totalArea,
    cutArea,
    fillArea,
    avgCutDepth: cutCells.length > 0 ? cutCells.reduce((s, c) => s + Math.abs(c.deltaZ), 0) / cutCells.length : 0,
    avgFillDepth: fillCells.length > 0 ? fillCells.reduce((s, c) => s + c.deltaZ, 0) / fillCells.length : 0,
    maxCutDepth: Math.abs(maxCutDepth),
    maxFillDepth,
  }
}

/**
 * Generate heat map color for a cell based on delta Z.
 * Red = cut (remove earth), Green = fill (add earth), Gray = no change.
 */
export function getHeatMapColor(deltaZ: number): string {
  if (Math.abs(deltaZ) < 0.001) return '#6b7280' // gray

  if (deltaZ < 0) {
    // Cut — red gradient (deeper = more red)
    const intensity = Math.min(1, Math.abs(deltaZ) / 5)
    const r = 239
    const g = Math.round(68 + (1 - intensity) * 100)
    const b = Math.round(68 + (1 - intensity) * 100)
    return `rgb(${r}, ${g}, ${b})`
  } else {
    // Fill — green gradient (deeper = more green)
    const intensity = Math.min(1, deltaZ / 5)
    const r = Math.round(34 + (1 - intensity) * 100)
    const g = 197
    const b = Math.round(94 + (1 - intensity) * 100)
    return `rgb(${r}, ${g}, ${b})`
  }
}

/**
 * Generate a CSV report of the cut/fill computation.
 */
export function generateCutFillReport(result: CutFillResult): string {
  let csv = 'Row,Col,Easting,Northing,Existing Elevation,Design Elevation,Delta Z,Area (m²),Volume (m³),Type\n'

  for (const cell of result.cells) {
    csv += `${cell.row},${cell.col},${cell.easting.toFixed(3)},${cell.northing.toFixed(3)},`
    csv += `${cell.existingElevation.toFixed(3)},${cell.designElevation.toFixed(3)},`
    csv += `${cell.deltaZ.toFixed(3)},${cell.area.toFixed(2)},${cell.volume.toFixed(3)},${cell.type}\n`
  }

  csv += '\nSummary\n'
  csv += `Total Cut Volume (m³),${result.totalCutVolume.toFixed(3)}\n`
  csv += `Total Fill Volume (m³),${result.totalFillVolume.toFixed(3)}\n`
  csv += `Net Volume (m³),${result.netVolume.toFixed(3)}\n`
  csv += `Total Area (m²),${result.totalArea.toFixed(2)}\n`
  csv += `Cut Area (m²),${result.cutArea.toFixed(2)}\n`
  csv += `Fill Area (m²),${result.fillArea.toFixed(2)}\n`
  csv += `Average Cut Depth (m),${result.avgCutDepth.toFixed(3)}\n`
  csv += `Average Fill Depth (m),${result.avgFillDepth.toFixed(3)}\n`
  csv += `Maximum Cut Depth (m),${result.maxCutDepth.toFixed(3)}\n`
  csv += `Maximum Fill Depth (m),${result.maxFillDepth.toFixed(3)}\n`

  return csv
}
