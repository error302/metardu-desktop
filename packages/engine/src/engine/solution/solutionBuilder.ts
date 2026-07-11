import type { Solution, SolutionV1, SolutionKV, SolutionWorkStep, SolutionCheck } from '@/lib/solution/schema'

/**
 * METARDU Engine Solution Builder
 *
 * Blueprint-standard output:
 * Given → To Find → Solution (formula → substitution → computation) → Check → Result
 *
 * This module is intentionally "thin": it does not perform survey math.
 * It structures explanation objects around results computed by the engine.
 */

export type { Solution, SolutionV1, SolutionKV, SolutionWorkStep, SolutionCheck }

export type SolutionStep = {
  label: string
  formula?: string
  substitution?: string
  computation?: string
  result?: string
}

export type Solved<T> = {
  result: T
  steps: SolutionStep[]
}

export function createSolutionV1(input: {
  title?: string
  given: SolutionKV[]
  toFind: string[]
  solution: SolutionWorkStep[]
  check?: SolutionCheck[]
  result: SolutionKV[]
}): SolutionV1 {
  return {
    version: 1,
    title: input.title,
    given: input.given,
    toFind: input.toFind,
    solution: input.solution,
    check: input.check,
    result: input.result,
  }
}

export function isSolutionV1(value: unknown): value is SolutionV1 {
  if (!value || typeof value !== 'object') return false
  const v = value as any
  return v.version === 1 && Array.isArray(v.given) && Array.isArray(v.toFind) && Array.isArray(v.solution) && Array.isArray(v.result)
}

function joinLines(lines: Array<string | undefined | null>, fallback: string) {
  const out = lines.map((x) => (x ?? '').trim()).filter(Boolean)
  return out.length ? out.join('\n') : fallback
}

/**
 * Convert Blueprint SolutionV1 into the required academic 7-step structure:
 * Given → To Find → Formula → Substitution → Computation → Check → Final Result
 */
export function solutionV1ToSteps(solution: SolutionV1): SolutionStep[] {
  const givenText = joinLines(solution.given.map((g) => `${g.label} = ${g.value}`), '—')
  const toFindText = joinLines(solution.toFind.map((x) => `• ${x}`), '—')

  const formulas = joinLines(
    solution.solution.map((s, i) => {
      const prefix = s.title ? `${i + 1}. ${s.title}: ` : `${i + 1}. `
      return `${prefix}${s.formula}`
    }),
    '—'
  )

  const substitutions = joinLines(
    solution.solution.map((s, i) => (s.substitution ? `${i + 1}. ${s.substitution}` : undefined)),
    '—'
  )

  const computations = joinLines(
    solution.solution.map((s, i) => {
      const chunks = [s.computation, s.result ? `Result: ${s.result}` : undefined].filter(Boolean)
      if (!chunks.length) return undefined
      return `${i + 1}. ${chunks.join(' | ')}`
    }),
    '—'
  )

  const checkText = joinLines(
    (solution.check ?? []).map((c) => {
      const status = c.ok === true ? '' : c.ok === false ? '[x]' : '•'
      return `${status} ${c.label}: ${c.value}`
    }),
    '—'
  )

  const finalText = joinLines(solution.result.map((r) => `${r.label}: ${r.value}`), '—')

  return [
    { label: 'Given', result: givenText },
    { label: 'To Find', result: toFindText },
    { label: 'Formula', formula: formulas },
    { label: 'Substitution', substitution: substitutions },
    { label: 'Computation', computation: computations },
    { label: 'Check', result: checkText },
    { label: 'Final Result', result: finalText },
  ]
}

export function solveWithSteps<T>(result: T, solution: SolutionV1): Solved<T> & { solution: SolutionV1 } {
  return { result, steps: solutionV1ToSteps(solution), solution }
}
