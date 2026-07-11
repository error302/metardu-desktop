import { dmsToDecimal } from '@/lib/engine/angles'
import type { DMS } from '@/lib/engine/types'
import { heightOfObject } from '@/lib/engine/heightOfObject'
import { createSolutionV1, solveWithSteps, type Solved, type Solution } from '@/lib/engine/solution/solutionBuilder'
import { fullNumber } from '@/lib/solution/format'

export function heightOfObjectSolved(input: {
  horizontalDistance: number
  angleTop: DMS
  angleBase: DMS
  instrumentHeight: number
}): Solved<ReturnType<typeof heightOfObject> & { angleTopDeg: number; angleBaseDeg: number }> & { solution: Solution } {
  const alpha = dmsToDecimal(input.angleTop)
  const beta = dmsToDecimal(input.angleBase)
  const r = heightOfObject({
    horizontalDistance: input.horizontalDistance,
    angleTopDeg: alpha,
    angleBaseDeg: beta,
    instrumentHeight: input.instrumentHeight,
  })

  const solution = createSolutionV1({
    title: 'Height of Object (Trigonometric Leveling)',
    given: [
      { label: 'Horizontal distance (D)', value: `${fullNumber(input.horizontalDistance)} m` },
      { label: 'Angle to top (α)', value: `${fullNumber(alpha)}°` },
      { label: 'Angle to base (β)', value: `${fullNumber(beta)}°` },
      { label: 'Instrument height (HI)', value: `${fullNumber(input.instrumentHeight)} m` },
    ],
    toFind: ['Height above instrument line', 'Total object height'],
    solution: [
      {
        title: 'Height from HI',
        formula: 'h = D × (tan(α) − tan(β))',
        substitution: `h = ${fullNumber(input.horizontalDistance)} × (tan(${fullNumber(alpha)}°) − tan(${fullNumber(beta)}°))`,
        computation: `h = ${fullNumber(r.heightFromHI)} m`,
      },
      {
        title: 'Total Height',
        formula: 'H = h + HI',
        substitution: `H = ${fullNumber(r.heightFromHI)} + ${fullNumber(input.instrumentHeight)}`,
        computation: `H = ${fullNumber(r.totalHeight)} m`,
        result: `${r.totalHeight.toFixed(4)} m`,
      },
    ],
    check: [{ label: 'Field check', value: 'Ensure D is horizontal distance (not slope distance).' }],
    result: [
      { label: 'Height above HI', value: `${r.heightFromHI.toFixed(4)} m` },
      { label: 'Total height', value: `${r.totalHeight.toFixed(4)} m` },
    ],
  })

  return solveWithSteps({ ...r, angleTopDeg: alpha, angleBaseDeg: beta }, solution)
}

export function heightOfObjectSolution(input: {
  horizontalDistance: number
  angleTop: DMS
  angleBase: DMS
  instrumentHeight: number
}): Solution {
  return heightOfObjectSolved(input).solution
}
