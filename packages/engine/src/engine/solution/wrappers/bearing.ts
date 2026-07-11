import { distanceBearing } from '@/lib/engine/distance'
import { backBearing, parseDMSString, normalizeBearing } from '@/lib/engine/angles'
import { createSolutionV1, solveWithSteps, type Solved, type Solution } from '@/lib/engine/solution/solutionBuilder'
import { formatBearingWcbDms, formatDistanceMeters, fullNumber } from '@/lib/solution/format'

export function bearingSolvedFromCoords(input: { e1: number; n1: number; e2: number; n2: number }): Solved<ReturnType<typeof distanceBearing>> & { solution: Solution } {
  const r = distanceBearing({ easting: input.e1, northing: input.n1 }, { easting: input.e2, northing: input.n2 })
  const solution = createSolutionV1({
    title: 'Bearing (WCB) from Coordinates',
    given: [
      { label: 'Point A (E, N)', value: `(${fullNumber(input.e1)}, ${fullNumber(input.n1)}) m` },
      { label: 'Point B (E, N)', value: `(${fullNumber(input.e2)}, ${fullNumber(input.n2)}) m` },
    ],
    toFind: ['Bearing AB (WCB)', 'Back bearing'],
    solution: [
      {
        formula: 'θ = atan2(ΔE, ΔN) (WCB from North, clockwise)',
        substitution: `ΔE=${fullNumber(r.deltaE)}, ΔN=${fullNumber(r.deltaN)}`,
        computation: `θ = ${fullNumber(r.bearing)}°`,
        result: formatBearingWcbDms(r.bearing),
      },
    ],
    result: [
      { label: 'Bearing (WCB)', value: formatBearingWcbDms(r.bearing) },
      { label: 'Back bearing', value: formatBearingWcbDms(r.backBearing) },
      { label: 'Distance', value: formatDistanceMeters(r.distance) },
    ],
  })
  return solveWithSteps(r, solution)
}

export function bearingSolutionFromCoords(input: { e1: number; n1: number; e2: number; n2: number }): Solution {
  return bearingSolvedFromCoords(input).solution
}

export function backBearingSolved(input: { bearingDmsOrDeg: string }): Solved<{ backBearingDeg: number } | null> & { solution: Solution } {
  const parsed = parseDMSString(input.bearingDmsOrDeg)
  if (parsed === null) {
    const solution = createSolutionV1({
      title: 'Back Bearing',
      given: [{ label: 'Bearing', value: input.bearingDmsOrDeg }],
      toFind: ['Back bearing'],
      solution: [{ formula: 'Invalid bearing input', computation: 'Unable to parse.' }],
      result: [{ label: 'Back bearing', value: '—' }],
    })
    return solveWithSteps(null, solution)
  }

  const b = normalizeBearing(parsed)
  const bb = backBearing(b)
  const solution = createSolutionV1({
    title: 'Back Bearing',
    given: [{ label: 'Bearing (WCB)', value: formatBearingWcbDms(b) }],
    toFind: ['Back bearing'],
    solution: [
      {
        formula: 'Back bearing = θ ± 180° (normalize to 0–360°)',
        substitution: `θ = ${fullNumber(b)}°`,
        computation: `Back bearing = ${fullNumber(bb)}°`,
        result: formatBearingWcbDms(bb),
      },
    ],
    result: [{ label: 'Back bearing', value: formatBearingWcbDms(bb) }],
  })

  return solveWithSteps({ backBearingDeg: bb }, solution)
}

export function backBearingSolution(input: { bearingDmsOrDeg: string }): Solution {
  return backBearingSolved(input).solution
}
