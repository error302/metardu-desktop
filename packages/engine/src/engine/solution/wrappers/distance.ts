import { distanceBearing, gradient, horizontalDistance, verticalDistance } from '@/lib/engine/distance'
import { createSolutionV1, solveWithSteps, type Solved, type Solution } from '@/lib/engine/solution/solutionBuilder'
import { formatBearingWcbDms, formatDeltaMeters, formatDistanceMeters, fullNumber } from '@/lib/solution/format'

export function distanceBearingSolvedFromCoords(input: { e1: number; n1: number; e2: number; n2: number }): Solved<ReturnType<typeof distanceBearing>> & { solution: Solution } {
  const r = distanceBearing({ easting: input.e1, northing: input.n1 }, { easting: input.e2, northing: input.n2 })
  const check = Math.abs(r.distance * r.distance - (r.deltaE * r.deltaE + r.deltaN * r.deltaN))

  const solution = createSolutionV1({
    title: 'Distance & Bearing (WCB)',
    given: [
      { label: 'Point A (E, N)', value: `(${fullNumber(input.e1)}, ${fullNumber(input.n1)}) m` },
      { label: 'Point B (E, N)', value: `(${fullNumber(input.e2)}, ${fullNumber(input.n2)}) m` },
    ],
    toFind: ['ΔE, ΔN', 'Distance AB', 'Bearing AB (WCB)'],
    solution: [
      {
        title: 'Coordinate Differences',
        formula: 'ΔE = E₂ − E₁,  ΔN = N₂ − N₁',
        substitution: `ΔE = ${fullNumber(input.e2)} − ${fullNumber(input.e1)},  ΔN = ${fullNumber(input.n2)} − ${fullNumber(input.n1)}`,
        computation: `ΔE = ${fullNumber(r.deltaE)} m,  ΔN = ${fullNumber(r.deltaN)} m`,
      },
      {
        title: 'Distance',
        formula: 'D = √(ΔE² + ΔN²)',
        substitution: `D = √((${fullNumber(r.deltaE)})² + (${fullNumber(r.deltaN)})²)`,
        computation: `D = ${fullNumber(r.distance)} m`,
        result: formatDistanceMeters(r.distance),
      },
      {
        title: 'Bearing (WCB)',
        formula: 'θ = atan2(ΔE, ΔN) (WCB from North, clockwise)',
        substitution: `θ = atan2(${fullNumber(r.deltaE)}, ${fullNumber(r.deltaN)})`,
        computation: `θ = ${fullNumber(r.bearing)}°`,
        result: formatBearingWcbDms(r.bearing),
      },
    ],
    check: [{ label: 'Arithmetic check', value: `D² − (ΔE² + ΔN²) = ${fullNumber(check)}`, ok: check < 1e-6 }],
    result: [
      { label: 'Distance', value: formatDistanceMeters(r.distance) },
      { label: 'Bearing (WCB)', value: formatBearingWcbDms(r.bearing) },
      { label: 'Back bearing', value: r.backBearingDMS },
      { label: 'ΔE', value: formatDeltaMeters(r.deltaE) },
      { label: 'ΔN', value: formatDeltaMeters(r.deltaN) },
    ],
  })

  return solveWithSteps(r, solution)
}

export function distanceBearingSolutionFromCoords(input: { e1: number; n1: number; e2: number; n2: number }): Solution {
  return distanceBearingSolvedFromCoords(input).solution
}

export function slopeReductionSolved(input: { slopeDistance: number; verticalAngleDeg: number }): Solved<{
  horizontal: number
  vertical: number
  gradient: ReturnType<typeof gradient>
}> & { solution: Solution } {
  const h = horizontalDistance(input.slopeDistance, input.verticalAngleDeg)
  const v = verticalDistance(input.slopeDistance, input.verticalAngleDeg)
  const g = gradient(v, h)

  const solution = createSolutionV1({
    title: 'Slope Reduction',
    given: [
      { label: 'Slope distance (SD)', value: `${fullNumber(input.slopeDistance)} m` },
      { label: 'Vertical angle (VA)', value: `${fullNumber(input.verticalAngleDeg)}°` },
    ],
    toFind: ['Horizontal distance (HD)', 'Vertical component (VD)', 'Gradient'],
    solution: [
      {
        title: 'Horizontal Distance',
        formula: 'HD = SD × cos(VA)',
        substitution: `HD = ${fullNumber(input.slopeDistance)} × cos(${fullNumber(input.verticalAngleDeg)}°)`,
        computation: `HD = ${fullNumber(h)} m`,
        result: formatDistanceMeters(h),
      },
      {
        title: 'Vertical Distance',
        formula: 'VD = SD × sin(VA)',
        substitution: `VD = ${fullNumber(input.slopeDistance)} × sin(${fullNumber(input.verticalAngleDeg)}°)`,
        computation: `VD = ${fullNumber(v)} m`,
      },
      {
        title: 'Gradient',
        formula: 'Gradient (%) = (VD / HD) × 100',
        substitution: `= (${fullNumber(v)} / ${fullNumber(h)}) × 100`,
        computation: `= ${fullNumber(g.percentage)} %`,
      },
    ],
    result: [
      { label: 'Horizontal distance', value: formatDistanceMeters(h) },
      { label: 'Vertical distance', value: `${v.toFixed(2)} m` },
      { label: 'Gradient', value: `${g.percentage.toFixed(2)}% (${g.degrees.toFixed(2)}°)` },
    ],
  })

  return solveWithSteps({ horizontal: h, vertical: v, gradient: g }, solution)
}

export function slopeReductionSolution(input: { slopeDistance: number; verticalAngleDeg: number }): Solution {
  return slopeReductionSolved(input).solution
}
