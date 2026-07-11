/**
 * IDW (Inverse Distance Weighting) interpolation engine.
 * Runs synchronously for survey point counts < 50,000.
 * For larger datasets, consider chunked processing.
 */

import type { SurveyPoint } from '@/types/surveyPoint'

/**
 * Numeric sample used by the IDW kernel. Distinct from `SurveyPoint` because
 * the kernel only needs three floats — callers may pass `SurveyPoint[]`
 * directly via the overloaded `runIDW` entrypoint below.
 */
export interface IDWSample {
  x: number
  y: number
  z: number
}

export interface IDWGrid {
  grid: number[][]
  cols: number
  rows: number
  minX: number
  minY: number
  cellSize: number
}

export interface IDWOptions {
  power?: number
  resolution?: number
  noDataValue?: number
}

export interface IDWProgress {
  percent: number
  rowsCompleted: number
  totalRows: number
}

type ProgressCallback = (progress: IDWProgress) => void

/**
 * Run IDW interpolation. Accepts either canonical `SurveyPoint[]`
 * (using `easting`/`northing`/`elevation`) or pre-shaped `IDWSample[]`.
 */
export function runIDW(
  points: SurveyPoint[] | IDWSample[],
  options: IDWOptions = {},
  onProgress?: ProgressCallback
): IDWGrid {
  return runIDWSync(points, options, onProgress)
}

export function runIDWSync(
  points: SurveyPoint[] | IDWSample[],
  options: IDWOptions = {},
  onProgress?: ProgressCallback
): IDWGrid {
  // Normalise to IDWSample so the kernel below only deals with one shape.
  const samples: IDWSample[] = (points as Array<SurveyPoint | IDWSample>).map(
    (p) =>
      'x' in p && 'y' in p && 'z' in p
        ? (p as IDWSample)
        : {
            x: (p as SurveyPoint).easting,
            y: (p as SurveyPoint).northing,
            z: (p as SurveyPoint).elevation ?? 0,
          }
  )
  const power = options.power ?? 2
  const resolution = options.resolution ?? 100
  const noData = options.noDataValue ?? -9999

  if (samples.length === 0) {
    throw new Error('IDW requires at least one survey point.')
  }

  const xs = samples.map(p => p.x)
  const ys = samples.map(p => p.y)
  const rawMinX = Math.min(...xs)
  const rawMaxX = Math.max(...xs)
  const rawMinY = Math.min(...ys)
  const rawMaxY = Math.max(...ys)

  const padX = (rawMaxX - rawMinX) * 0.05 || 1
  const padY = (rawMaxY - rawMinY) * 0.05 || 1
  const minX = rawMinX - padX
  const maxX = rawMaxX + padX
  const minY = rawMinY - padY
  const maxY = rawMaxY + padY

  const cellSize = Math.max((maxX - minX) / resolution, (maxY - minY) / resolution)
  const cols = Math.ceil((maxX - minX) / cellSize) + 1
  const rows = Math.ceil((maxY - minY) / cellSize) + 1

  const grid: number[][] = Array.from({ length: rows }, () =>
    new Array(cols).fill(noData)
  )

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const gx = minX + col * cellSize
      const gy = minY + row * cellSize

      let weightedSum = 0
      let weightTotal = 0
      let exactHit = false

      for (const pt of samples) {
        const dx = gx - pt.x
        const dy = gy - pt.y
        const d2 = dx * dx + dy * dy

        if (d2 === 0) {
          grid[row][col] = pt.z
          exactHit = true
          break
        }

        const w = 1 / Math.pow(d2, power / 2)
        weightedSum += w * pt.z
        weightTotal += w
      }

      if (!exactHit && weightTotal > 0) {
        grid[row][col] = weightedSum / weightTotal
      }
    }
  }

  return { grid, cols, rows, minX, minY, cellSize }
}

export function gridToFlat(idwGrid: IDWGrid): Float64Array {
  const { grid, rows, cols } = idwGrid
  const flat = new Float64Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      flat[r * cols + c] = grid[r][c]
    }
  }
  return flat
}