import { gradeFromElevations } from '@/lib/engine/grade'
import { createSolutionV1, solveWithSteps, type Solved, type Solution } from '@/lib/engine/solution/solutionBuilder'
import { fullNumber } from '@/lib/solution/format'

export function gradeSolved(input: { elev1: number; elev2: number; horizontalDistance: number }): Solved<ReturnType<typeof gradeFromElevations>> & { solution: Solution } {
  const r = gradeFromElevations(input)

  const solution = createSolutionV1({
    title: 'Grade / Slope',
    given: [
      { label: 'Elevation 1', value: `${fullNumber(input.elev1)} m` },
      { label: 'Elevation 2', value: `${fullNumber(input.elev2)} m` },
      { label: 'Horizontal distance (D)', value: `${fullNumber(input.horizontalDistance)} m` },
    ],
    toFind: ['Rise/Fall (ΔH)', 'Gradient (%)', 'Slope angle (θ)', 'Gradient ratio (1 : R)'],
    solution: [
      {
        title: 'Rise/Fall',
        formula: 'ΔH = H₂ − H₁',
        substitution: `ΔH = ${fullNumber(input.elev2)} − ${fullNumber(input.elev1)}`,
        computation: `ΔH = ${fullNumber(r.riseFall)} m`,
      },
      {
        title: 'Gradient (%)',
        formula: 'G% = (ΔH / D) × 100',
        substitution: `G% = (${fullNumber(r.riseFall)} / ${fullNumber(input.horizontalDistance)}) × 100`,
        computation: `G% = ${fullNumber(r.gradientPercent)} %`,
        result: `${r.gradientPercent.toFixed(2)} %`,
      },
      {
        title: 'Slope Angle',
        formula: 'θ = arctan(ΔH / D)',
        substitution: `θ = arctan(${fullNumber(r.riseFall)} / ${fullNumber(input.horizontalDistance)})`,
        computation: `θ = ${fullNumber(r.slopeAngleDeg)}°`,
        result: `${r.slopeAngleDeg.toFixed(2)}°`,
      },
      {
        title: 'Gradient Ratio',
        formula: 'R = D / |ΔH|  ⇒  Gradient ratio = 1 : R',
        substitution: `R = ${fullNumber(input.horizontalDistance)} / |${fullNumber(r.riseFall)}|`,
        computation: `R = ${isFinite(r.ratio) ? fullNumber(r.ratio) : '∞'}`,
        result: `1 : ${isFinite(r.ratio) ? r.ratio.toFixed(2) : '∞'}`,
      },
    ],
    check: [{ label: 'Sign convention', value: 'Positive ΔH = rising; negative ΔH = falling.' }],
    result: [
      { label: 'Rise/Fall (ΔH)', value: `${r.riseFall >= 0 ? '+' : ''}${r.riseFall.toFixed(4)} m` },
      { label: 'Gradient (%)', value: `${r.gradientPercent.toFixed(2)} %` },
      { label: 'Slope angle', value: `${r.slopeAngleDeg.toFixed(2)}°` },
      { label: 'Gradient ratio', value: `1 : ${isFinite(r.ratio) ? r.ratio.toFixed(2) : '∞'}` },
    ],
  })

  return solveWithSteps(r, solution)
}

export function gradeSolution(input: { elev1: number; elev2: number; horizontalDistance: number }): Solution {
  return gradeSolved(input).solution
}
