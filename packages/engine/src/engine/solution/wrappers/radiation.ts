import { radiation } from '@/lib/engine/cogo'
import type { Point2D } from '@/lib/engine/types'
import { createSolutionV1, solveWithSteps, type Solved, type Solution } from '@/lib/engine/solution/solutionBuilder'
import { formatBearingWcbDms, formatCoordMeters, formatDistanceMeters, fullNumber } from '@/lib/solution/format'

export function radiationSolved(input: { station: Point2D; bearingDeg: number; distance: number }): Solved<ReturnType<typeof radiation> & { deltaE: number; deltaN: number }> & { solution: Solution } {
  const r = radiation(input.station, input.bearingDeg, input.distance)
  const deltaE = r.point.easting - input.station.easting
  const deltaN = r.point.northing - input.station.northing

  const solution = createSolutionV1({
    title: 'Radiation (Polar to Coordinates)',
    given: [
      { label: 'Station (E, N)', value: `(${fullNumber(input.station.easting)}, ${fullNumber(input.station.northing)}) m` },
      { label: 'Bearing (WCB)', value: `${fullNumber(input.bearingDeg)}°` },
      { label: 'Distance (D)', value: `${fullNumber(input.distance)} m` },
    ],
    toFind: ['Target point coordinates (E, N)'],
    solution: [
      {
        title: 'Coordinate increments',
        formula: 'ΔE = D·sin(θ),  ΔN = D·cos(θ)',
        substitution: `ΔE = ${fullNumber(input.distance)}·sin(${fullNumber(input.bearingDeg)}°),  ΔN = ${fullNumber(input.distance)}·cos(${fullNumber(input.bearingDeg)}°)`,
        computation: `ΔE=${fullNumber(deltaE)} m, ΔN=${fullNumber(deltaN)} m`,
      },
      {
        title: 'Target coordinates',
        formula: 'E = E₀ + ΔE,  N = N₀ + ΔN',
        computation: `E=${fullNumber(r.point.easting)} m, N=${fullNumber(r.point.northing)} m`,
        result: `E ${r.point.easting.toFixed(4)} m; N ${r.point.northing.toFixed(4)} m`,
      },
    ],
    check: [{ label: 'Bearing display', value: formatBearingWcbDms(input.bearingDeg) }],
    result: [
      { label: 'Easting', value: formatCoordMeters(r.point.easting) },
      { label: 'Northing', value: formatCoordMeters(r.point.northing) },
      { label: 'Distance', value: formatDistanceMeters(input.distance) },
      { label: 'Bearing (WCB)', value: formatBearingWcbDms(input.bearingDeg) },
    ],
  })

  return solveWithSteps({ ...r, deltaE, deltaN }, solution)
}

export function radiationSolution(input: { station: Point2D; bearingDeg: number; distance: number }): Solution {
  return radiationSolved(input).solution
}
