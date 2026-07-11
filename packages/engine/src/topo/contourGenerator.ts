import { contours } from 'd3-contour'

export interface IDWOutput {
  grid: number[][]
  gridMinE: number
  gridMinN: number
  gridResolution: number
  cols: number
  rows: number
}

export interface ContourLine {
  elevation: number
  isIndex: boolean
  coordinates: [number, number][][]
}

export interface ContourGeneratorOptions {
  interval: number
  indexInterval?: number
}

export function generateContours(
  idwOutput: IDWOutput,
  options: ContourGeneratorOptions
): ContourLine[] {
  const { grid, gridMinE, gridMinN, gridResolution, cols, rows } = idwOutput
  const { interval, indexInterval = 5 } = options

  const values: number[] = Array(cols * rows)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      values[(rows - 1 - row) * cols + col] = grid[row][col]
    }
  }

  const validValues = values.filter(v => !isNaN(v))
  if (validValues.length === 0) return []

  const minZ = Math.min(...validValues)
  const maxZ = Math.max(...validValues)

  const firstContour = Math.ceil(minZ / interval) * interval
  const thresholds: number[] = []
  for (let z = firstContour; z <= maxZ; z += interval) {
    thresholds.push(parseFloat(z.toFixed(4)))
  }

  if (thresholds.length === 0) return []

  const contourGenerator = (contours as any)()
    .size([cols, rows])
    .thresholds(thresholds)

  const rawContours: any = contourGenerator(values)

  return rawContours.map((contour: any, i: number) => {
    const elevation = thresholds[i]
    const isIndex = Math.round(elevation / interval) % indexInterval === 0

    const worldRings: [number, number][][] = contour.coordinates.flatMap(
      (polygon: any) => polygon.map((ring: any) =>
        ring.map(([px, py]: [number, number]): [number, number] => {
          const e = gridMinE + px * gridResolution
          const n = gridMinN + (rows - 1 - py) * gridResolution
          return [e, n]
        })
      )
    )

    return { elevation, isIndex, coordinates: worldRings }
  })
}
