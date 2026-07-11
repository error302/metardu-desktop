import { compoundCurveElements, curveStakeout, reverseCurveApprox } from '@/lib/engine/curves'
import { createSolutionV1, solveWithSteps, type Solved, type Solution } from '@/lib/engine/solution/solutionBuilder'
import { formatDistanceMeters, fullNumber } from '@/lib/solution/format'

export function simpleCurveSolved(input: {
  radius: number
  deflectionDeg: number
  piChainage: number
  interval: number
}): Solved<ReturnType<typeof curveStakeout>> & { solution: Solution; stakeout: ReturnType<typeof curveStakeout> } {
  const stakeout = curveStakeout(input.piChainage, 0, input.radius, input.deflectionDeg, input.interval)
  const el = stakeout.elements

  const solution = createSolutionV1({
      title: 'Simple Circular Curve',
      given: [
        { label: 'Radius (R)', value: `${fullNumber(input.radius)} m` },
        { label: 'Deflection angle (Δ)', value: `${fullNumber(input.deflectionDeg)}°` },
        { label: 'PI chainage', value: `${fullNumber(input.piChainage)} m` },
        { label: 'Stake interval', value: `${fullNumber(input.interval)} m` },
      ],
      toFind: ['T, L, C, E, M', 'PC chainage', 'PT chainage', 'Stakeout table'],
      solution: [
        {
          title: 'Curve elements',
          formula: 'T = R·tan(Δ/2),  L = R·Δ (radians),  C = 2R·sin(Δ/2)',
          substitution: `R=${fullNumber(input.radius)}, Δ=${fullNumber(input.deflectionDeg)}°`,
          computation: `T=${fullNumber(el.tangentLength)} m, L=${fullNumber(el.arcLength)} m, C=${fullNumber(el.longChord)} m`,
        },
        {
          title: 'Mid-ordinate & external distance',
          formula: 'M = R·(1 − cos(Δ/2)),  E = R·(sec(Δ/2) − 1)',
          computation: `M=${fullNumber(el.midOrdinate)} m, E=${fullNumber(el.externalDistance)} m`,
        },
        {
          title: 'Key chainages',
          formula: 'PC = PI − T,  PT = PC + L',
          substitution: `PC = ${fullNumber(input.piChainage)} − ${fullNumber(el.tangentLength)},  PT = PC + ${fullNumber(el.arcLength)}`,
          computation: `PC=${fullNumber(stakeout.pcChainage)} m, PT=${fullNumber(stakeout.ptChainage)} m`,
          result: `PC ${stakeout.pcChainage.toFixed(3)} m; PT ${stakeout.ptChainage.toFixed(3)} m`,
        },
      ],
      check: [{ label: 'Stake points', value: `${stakeout.points.length} point(s) generated (including PC/PT).` }],
      result: [
        { label: 'Tangent (T)', value: formatDistanceMeters(el.tangentLength) },
        { label: 'Curve length (L)', value: formatDistanceMeters(el.arcLength) },
        { label: 'Long chord (C)', value: formatDistanceMeters(el.longChord) },
        { label: 'External (E)', value: formatDistanceMeters(el.externalDistance) },
        { label: 'Mid-ordinate (M)', value: formatDistanceMeters(el.midOrdinate) },
        { label: 'PC chainage', value: `${stakeout.pcChainage.toFixed(3)} m` },
        { label: 'PT chainage', value: `${stakeout.ptChainage.toFixed(3)} m` },
      ],
    })

  const solved = solveWithSteps(stakeout, solution)
  return { ...solved, stakeout: solved.result }
}

export function simpleCurveSolution(input: {
  radius: number
  deflectionDeg: number
  piChainage: number
  interval: number
}): { solution: Solution; stakeout: ReturnType<typeof curveStakeout> } {
  const s = simpleCurveSolved(input)
  return { stakeout: s.result, solution: s.solution }
}

export function compoundCurveSolved(input: {
  R1: number
  R2: number
  delta1Deg: number
  delta2Deg: number
  junctionChainage: number
}): Solved<ReturnType<typeof compoundCurveElements>> & { solution: Solution } {
  const r = compoundCurveElements(input)

  const solution = createSolutionV1({
    title: 'Compound Curve (Elements)',
    given: [
      { label: 'R1', value: `${fullNumber(input.R1)} m` },
      { label: 'R2', value: `${fullNumber(input.R2)} m` },
      { label: 'Δ1', value: `${fullNumber(input.delta1Deg)}°` },
      { label: 'Δ2', value: `${fullNumber(input.delta2Deg)}°` },
      { label: 'Junction chainage (J)', value: `${fullNumber(input.junctionChainage)} m` },
    ],
    toFind: ['t1, t2', 'l1, l2', 'T1, T2 chainages'],
    solution: [
      { title: 'Tangents', formula: 't = R·tan(Δ/2)', computation: `t1=${fullNumber(r.t1)} m, t2=${fullNumber(r.t2)} m` },
      { title: 'Arc lengths', formula: 'l = R·Δ (radians)', computation: `l1=${fullNumber(r.l1)} m, l2=${fullNumber(r.l2)} m` },
      { title: 'Key chainages', formula: 'T1 = J − t1,  T2 = J + t2', computation: `T1=${fullNumber(r.chainT1)} m, T2=${fullNumber(r.chainT2)} m` },
    ],
    result: [
      { label: 't1', value: `${r.t1.toFixed(4)} m` },
      { label: 't2', value: `${r.t2.toFixed(4)} m` },
      { label: 'l1', value: `${r.l1.toFixed(4)} m` },
      { label: 'l2', value: `${r.l2.toFixed(4)} m` },
      { label: 'Total curve length', value: `${r.totalLength.toFixed(4)} m` },
      { label: 'T1 chainage', value: `${r.chainT1.toFixed(3)} m` },
      { label: 'T2 chainage', value: `${r.chainT2.toFixed(3)} m` },
    ],
  })

  return solveWithSteps(r, solution)
}

export function compoundCurveSolution(input: {
  R1: number
  R2: number
  delta1Deg: number
  delta2Deg: number
  junctionChainage: number
}): Solution {
  return compoundCurveSolved(input).solution
}

export function reverseCurveSolved(input: { R1: number; R2: number; AB: number }): Solved<ReturnType<typeof reverseCurveApprox>> & { solution: Solution } {
  const r = reverseCurveApprox(input)

  const solution = createSolutionV1({
    title: 'Reverse Curve (Approx. Elements)',
    given: [
      { label: 'R1', value: `${fullNumber(input.R1)} m` },
      { label: 'R2', value: `${fullNumber(input.R2)} m` },
      { label: 'AB', value: `${fullNumber(input.AB)} m` },
    ],
    toFind: ['Common tangent length', 'Total length (approx.)'],
    solution: [
      {
        title: 'Common Tangent',
        formula: 'T = √(AB² − (R2 − R1)²)',
        substitution: `T = √(${fullNumber(input.AB)}² − (${fullNumber(input.R2)} − ${fullNumber(input.R1)})²)`,
        computation: `T = ${fullNumber(r.commonTangent)} m`,
      },
      {
        title: 'Total length (approx.)',
        formula: 'L ≈ πR1 + πR2',
        computation: `L = ${fullNumber(r.totalLength)} m`,
        result: `${r.totalLength.toFixed(4)} m`,
      },
    ],
    result: [
      { label: 'Common tangent', value: `${r.commonTangent.toFixed(4)} m` },
      { label: 'Total length', value: `${r.totalLength.toFixed(4)} m` },
    ],
  })

  return solveWithSteps(r, solution)
}

export function reverseCurveSolution(input: { R1: number; R2: number; AB: number }): Solution {
  return reverseCurveSolved(input).solution
}
