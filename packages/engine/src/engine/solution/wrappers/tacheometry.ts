import { dmsToDecimal } from '@/lib/engine/angles'
import type { DMS } from '@/lib/engine/types'
import { tacheometryReduction } from '@/lib/engine/tacheometry'
import { createSolutionV1, solveWithSteps, type Solved, type Solution } from '@/lib/engine/solution/solutionBuilder'
import { fullNumber } from '@/lib/solution/format'

export function tacheometrySolved(input: {
  instrumentHeight: number
  upper: number
  middle: number
  lower: number
  verticalAngle: DMS
  K: number
  C: number
}): Solved<ReturnType<typeof tacheometryReduction>> & { solution: Solution } {
  const verticalAngleDeg = dmsToDecimal(input.verticalAngle)
  const r = tacheometryReduction({
    instrumentHeight: input.instrumentHeight,
    upper: input.upper,
    middle: input.middle,
    lower: input.lower,
    verticalAngleDeg,
    K: input.K,
    C: input.C,
  })

  const solution = createSolutionV1({
    title: 'Tacheometry Reduction',
    given: [
      { label: 'HI', value: `${fullNumber(input.instrumentHeight)} m` },
      { label: 'Upper staff', value: `${fullNumber(input.upper)} m` },
      { label: 'Middle staff', value: `${fullNumber(input.middle)} m` },
      { label: 'Lower staff', value: `${fullNumber(input.lower)} m` },
      { label: 'Vertical angle (θ)', value: `${fullNumber(verticalAngleDeg)}°` },
      { label: 'K', value: fullNumber(input.K) },
      { label: 'C', value: `${fullNumber(input.C)} m` },
    ],
    toFind: ['Staff intercept (S)', 'Horizontal distance (D)', 'Vertical component (V)', 'Staff station RL'],
    solution: [
      {
        title: 'Staff Intercept',
        formula: 'S = upper − lower',
        substitution: `S = ${fullNumber(input.upper)} − ${fullNumber(input.lower)}`,
        computation: `S = ${fullNumber(r.S)} m`,
      },
      {
        title: 'Horizontal Distance',
        formula: 'D = K×S×cos²(θ) + C',
        substitution: `D = ${fullNumber(input.K)}×${fullNumber(r.S)}×cos²(${fullNumber(verticalAngleDeg)}°) + ${fullNumber(input.C)}`,
        computation: `D = ${fullNumber(r.horizontalDistance)} m`,
        result: `${r.horizontalDistance.toFixed(4)} m`,
      },
      {
        title: 'Vertical Component',
        formula: 'V = (K×S×sin(2θ))/2',
        substitution: `V = ( ${fullNumber(input.K)}×${fullNumber(r.S)}×sin(2×${fullNumber(verticalAngleDeg)}°) ) / 2`,
        computation: `V = ${fullNumber(r.verticalDistance)} m`,
      },
      {
        title: 'Reduced Level (staff station)',
        formula: 'RL = HI + V − middle',
        substitution: `RL = ${fullNumber(input.instrumentHeight)} + ${fullNumber(r.verticalDistance)} − ${fullNumber(input.middle)}`,
        computation: `RL = ${fullNumber(r.staffStationRL)} m`,
        result: `${r.staffStationRL.toFixed(4)} m`,
      },
    ],
    check: [{ label: 'Staff intercept S', value: `${r.S.toFixed(4)} m` }],
    result: [
      { label: 'Horizontal distance (D)', value: `${r.horizontalDistance.toFixed(4)} m` },
      { label: 'Vertical component (V)', value: `${r.verticalDistance.toFixed(4)} m` },
      { label: 'Staff station RL', value: `${r.staffStationRL.toFixed(4)} m` },
    ],
  })

  return solveWithSteps(r, solution)
}

export function tacheometrySolution(input: {
  instrumentHeight: number
  upper: number
  middle: number
  lower: number
  verticalAngle: DMS
  K: number
  C: number
}): Solution {
  return tacheometrySolved(input).solution
}
