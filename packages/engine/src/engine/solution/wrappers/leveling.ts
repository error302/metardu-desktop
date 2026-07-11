import type { LevelingInput } from '@/lib/engine/leveling'
import type { LevelingResult } from '@/lib/engine/types'
import { createSolutionV1, solveWithSteps, type Solved, type Solution } from '@/lib/engine/solution/solutionBuilder'
import { formatDistanceMeters, fullNumber } from '@/lib/solution/format'

export function levelingSolved(input: LevelingInput, result: LevelingResult): Solved<LevelingResult> & { solution: Solution } {
  const sumBS = result.readings.reduce((s, r) => s + (r.bs ?? 0), 0)
  const sumFS = result.readings.reduce((s, r) => s + (r.fs ?? 0), 0)

  const last = [...result.readings].reverse().find((r: any) => typeof r.reducedLevel === 'number')
  const lastRL = last?.reducedLevel ?? input.openingRL

  const arithmeticDiff = (sumBS - sumFS) - (lastRL - input.openingRL)
  const distanceKm = input.distanceKm ?? 1

  const solution = createSolutionV1({
    title: `Leveling (${result.method === 'rise_and_fall' ? 'Rise & Fall' : 'Height of Collimation'})`,
    given: [
      { label: 'Opening RL', value: `${fullNumber(input.openingRL)} m` },
      ...(input.closingRL !== undefined ? [{ label: 'Closing RL', value: `${fullNumber(input.closingRL)} m` }] : []),
      { label: 'Distance (K)', value: `${fullNumber(distanceKm)} km` },
      { label: 'No. of rows', value: `${result.readings.length}` },
    ],
    toFind: ['Reduced levels (RL)', 'Misclosure (if closing RL provided)', 'Arithmetic check (Basak)'],
    solution: [
      {
        title: 'Core reduction',
        formula:
          result.method === 'height_of_collimation'
            ? 'HI = RL + BS,  RL(next) = HI − (IS/FS)'
            : 'Compute RLs and rises/falls between successive computed RLs',
        computation: `Final RL = ${fullNumber(lastRL)} m`,
      },
      {
        title: 'Arithmetic check (Basak)',
        formula: 'ΣBS − ΣFS = Last RL − First RL',
        substitution: `ΣBS=${fullNumber(sumBS)}, ΣFS=${fullNumber(sumFS)}, Last RL=${fullNumber(lastRL)}, First RL=${fullNumber(input.openingRL)}`,
        computation: `Diff = (ΣBS−ΣFS) − (Last−First) = ${fullNumber(arithmeticDiff)} m`,
        result: `${Math.abs(arithmeticDiff) < 0.001 ? 'PASS' : 'FAIL'}`,
      },
      {
        title: 'Allowable misclosure (ordinary leveling)',
        formula: 'Allowable = ±10√K mm',
        substitution: `K = ${fullNumber(distanceKm)} km`,
        computation: `Allowable = ±${fullNumber(result.allowableMisclosure * 1000)} mm`,
      },
    ],
    check: [
      {
        label: 'Arithmetic check',
        value: `${Math.abs(arithmeticDiff) < 0.001 ? 'PASS' : 'FAIL'} (diff ${arithmeticDiff.toFixed(4)} m)`,
        ok: Math.abs(arithmeticDiff) < 0.001,
      },
      ...(input.closingRL !== undefined
        ? [
            {
              label: 'Misclosure within allowable',
              value: `${result.misclosure.toFixed(4)} m vs ±${result.allowableMisclosure.toFixed(4)} m`,
              ok: result.isAcceptable,
            },
          ]
        : []),
    ],
    result: [
      { label: 'ΣBS', value: `${sumBS.toFixed(4)} m` },
      { label: 'ΣFS', value: `${sumFS.toFixed(4)} m` },
      { label: 'Final RL', value: `${lastRL.toFixed(4)} m` },
      ...(input.closingRL !== undefined ? [{ label: 'Misclosure', value: formatDistanceMeters(result.misclosure) }] : []),
    ],
  })

  return solveWithSteps(result, solution)
}

export function levelingSolution(input: LevelingInput, result: LevelingResult): Solution {
  return levelingSolved(input, result).solution
}
