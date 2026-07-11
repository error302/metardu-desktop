import { twoPegTest } from '@/lib/engine/twoPegTest'
import { createSolutionV1, solveWithSteps, type Solved, type Solution } from '@/lib/engine/solution/solutionBuilder'
import { fullNumber } from '@/lib/solution/format'

export function twoPegTestSolved(input: {
  A1: number
  B1: number
  A2: number
  B2: number
  baselineMeters?: number
  allowableMmPer100m?: number
}): Solved<ReturnType<typeof twoPegTest>> & { solution: Solution } {
  const r = twoPegTest(input)

  const solution = createSolutionV1({
    title: 'Two Peg Test (Collimation Error)',
    given: [
      { label: 'A1 (Pos. 1)', value: `${fullNumber(input.A1)} m` },
      { label: 'B1 (Pos. 1)', value: `${fullNumber(input.B1)} m` },
      { label: 'A2 (Pos. 2)', value: `${fullNumber(input.A2)} m` },
      { label: 'B2 (Pos. 2)', value: `${fullNumber(input.B2)} m` },
      { label: 'Baseline', value: `${fullNumber(r.baselineMeters)} m` },
    ],
    toFind: ['True difference in level (A−B)', 'Collimation error', 'Error per 100 m', 'Pass/Fail'],
    solution: [
      {
        title: 'Observed Differences',
        formula: '(A − B) for each setup',
        computation: `Obs₁ = ${fullNumber(r.obsDiff1)} m,  Obs₂ = ${fullNumber(r.obsDiff2)} m`,
      },
      {
        title: 'True Difference (Average)',
        formula: 'True diff = (Obs₁ + Obs₂) / 2',
        substitution: `= (${fullNumber(r.obsDiff1)} + ${fullNumber(r.obsDiff2)}) / 2`,
        computation: `= ${fullNumber(r.trueDiff)} m`,
      },
      {
        title: 'Collimation Error',
        formula: 'Error = (Obs₁ − Obs₂) / 2',
        substitution: `= (${fullNumber(r.obsDiff1)} − ${fullNumber(r.obsDiff2)}) / 2`,
        computation: `= ${fullNumber(r.collimationError)} m`,
      },
      {
        title: 'Error per 100 m',
        formula: 'Error₁₀₀ = Error × (100 / baseline)',
        substitution: `= ${fullNumber(r.collimationError)} × (100 / ${fullNumber(r.baselineMeters)})`,
        computation: `= ${fullNumber(r.collimationPer100m)} m per 100 m`,
        result: `${(r.collimationPer100m * 1000).toFixed(2)} mm/100m`,
      },
    ],
    check: [
      { label: 'Allowable (typical)', value: `±${r.allowableMmPer100m.toFixed(1)} mm per 100 m`, ok: r.pass },
      { label: 'Status', value: r.pass ? 'PASS' : 'FAIL', ok: r.pass },
    ],
    result: [
      { label: 'True difference (A−B)', value: `${r.trueDiff.toFixed(4)} m` },
      { label: 'Collimation error', value: `${(r.collimationError * 1000).toFixed(2)} mm` },
      { label: 'Error per 100 m', value: `${(r.collimationPer100m * 1000).toFixed(2)} mm/100m` },
      { label: 'Instrument status', value: r.pass ? 'PASS' : 'FAIL' },
    ],
  })

  return solveWithSteps(r, solution)
}

export function twoPegTestSolution(input: {
  A1: number
  B1: number
  A2: number
  B2: number
  baselineMeters?: number
  allowableMmPer100m?: number
}): Solution {
  return twoPegTestSolved(input).solution
}
