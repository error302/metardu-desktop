import { dmsToDecimal } from '@/lib/engine/angles'
import { distanceBearing, polarPoint } from '@/lib/engine/distance'
import { createSolutionV1, solveWithSteps, type Solved, type Solution } from '@/lib/engine/solution/solutionBuilder'
import { formatBearingWcbDms, formatCoordMeters, formatDeltaMeters, formatDistanceMeters, fullNumber } from '@/lib/solution/format'

export function pegFromStationSolved(input: {
  stationE: number
  stationN: number
  bearingD: number
  bearingM: number
  bearingS: number
  distance: number
}): Solved<{ peg: ReturnType<typeof polarPoint>; bearingDeg: number; deltaE: number; deltaN: number }> & { solution: Solution } {
  const bearingDec = dmsToDecimal({ degrees: input.bearingD, minutes: input.bearingM, seconds: input.bearingS, direction: 'N' })
  const peg = polarPoint({ easting: input.stationE, northing: input.stationN }, bearingDec, input.distance)
  const dE = peg.easting - input.stationE
  const dN = peg.northing - input.stationN
  const checkDist = Math.sqrt(dE * dE + dN * dN)

  const solution = createSolutionV1({
    title: 'Station + Bearing + Distance → Peg Coordinates',
    given: [
      { label: 'Station (E₁, N₁)', value: `(${fullNumber(input.stationE)}, ${fullNumber(input.stationN)}) m` },
      { label: 'Bearing (WCB)', value: formatBearingWcbDms(bearingDec) },
      { label: 'Distance (d)', value: `${fullNumber(input.distance)} m` },
    ],
    toFind: ['Peg coordinates (E₂, N₂)'],
    solution: [
      {
        title: 'Peg Coordinates',
        formula: 'E₂ = E₁ + d×sin(θ),  N₂ = N₁ + d×cos(θ)',
        substitution: `θ = ${fullNumber(bearingDec)}°, d = ${fullNumber(input.distance)} m`,
        computation: `E₂ = ${fullNumber(peg.easting)} m,  N₂ = ${fullNumber(peg.northing)} m`,
        result: `E₂ = ${formatCoordMeters(peg.easting)},  N₂ = ${formatCoordMeters(peg.northing)}`,
      },
    ],
    check: [
      {
        label: 'Distance check',
        value: `√(ΔE² + ΔN²) = ${fullNumber(checkDist)} m`,
        ok: Math.abs(checkDist - input.distance) < 1e-6,
      },
    ],
    result: [
      { label: 'Peg Easting', value: formatCoordMeters(peg.easting) },
      { label: 'Peg Northing', value: formatCoordMeters(peg.northing) },
      { label: 'Bearing (WCB)', value: formatBearingWcbDms(bearingDec) },
      { label: 'Distance', value: formatDistanceMeters(input.distance) },
      { label: 'ΔE', value: formatDeltaMeters(dE) },
      { label: 'ΔN', value: formatDeltaMeters(dN) },
    ],
  })

  return solveWithSteps({ peg, bearingDeg: bearingDec, deltaE: dE, deltaN: dN }, solution)
}

export function pegFromStationSolution(input: {
  stationE: number
  stationN: number
  bearingD: number
  bearingM: number
  bearingS: number
  distance: number
}): Solution {
  return pegFromStationSolved(input).solution
}

export function bearingDistanceSolved(input: { stationE: number; stationN: number; targetE: number; targetN: number }): Solved<ReturnType<typeof distanceBearing> & { moveEW: string; moveNS: string }> & {
  solution: Solution
} {
  const r = distanceBearing({ easting: input.stationE, northing: input.stationN }, { easting: input.targetE, northing: input.targetN })
  const check = Math.abs(r.distance * r.distance - (r.deltaE * r.deltaE + r.deltaN * r.deltaN))

  const moveEW = `${r.deltaE >= 0 ? 'E' : 'W'} ${Math.abs(r.deltaE).toFixed(2)} m`
  const moveNS = `${r.deltaN >= 0 ? 'N' : 'S'} ${Math.abs(r.deltaN).toFixed(2)} m`

  const solution = createSolutionV1({
    title: 'Station → Target (Bearing & Distance)',
    given: [
      { label: 'Station (E₁, N₁)', value: `(${fullNumber(input.stationE)}, ${fullNumber(input.stationN)}) m` },
      { label: 'Target (E₂, N₂)', value: `(${fullNumber(input.targetE)}, ${fullNumber(input.targetN)}) m` },
    ],
    toFind: ['Distance (D)', 'Bearing (WCB)'],
    solution: [
      {
        title: 'Coordinate Differences',
        formula: 'ΔE = E₂ − E₁,  ΔN = N₂ − N₁',
        substitution: `ΔE = ${fullNumber(input.targetE)} − ${fullNumber(input.stationE)},  ΔN = ${fullNumber(input.targetN)} − ${fullNumber(input.stationN)}`,
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
        result: r.bearingDMS,
      },
    ],
    check: [
      { label: 'Arithmetic check', value: `D² − (ΔE² + ΔN²) = ${fullNumber(check)}`, ok: check < 1e-6 },
      { label: 'Field move (E/W)', value: moveEW },
      { label: 'Field move (N/S)', value: moveNS },
    ],
    result: [
      { label: 'Distance', value: formatDistanceMeters(r.distance) },
      { label: 'Bearing (WCB)', value: r.bearingDMS },
      { label: 'ΔE', value: formatDeltaMeters(r.deltaE) },
      { label: 'ΔN', value: formatDeltaMeters(r.deltaN) },
    ],
  })

  return solveWithSteps({ ...r, moveEW, moveNS }, solution)
}

export function bearingDistanceSolution(input: { stationE: number; stationN: number; targetE: number; targetN: number }): Solution {
  return bearingDistanceSolved(input).solution
}
