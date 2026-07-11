import { createSolutionV1, solveWithSteps, type Solved, type Solution } from '@/lib/engine/solution/solutionBuilder'
import { formatBearingWcbDms, formatDeltaMeters, formatDistanceMeters, formatPrecisionRatio, fullNumber } from '@/lib/solution/format'

export type TraverseAdjustmentSolvedResult = {
  legs: Array<{
    from: string
    to: string
    distance: number
    bearing: number
    rawDeltaE: number
    rawDeltaN: number
    correctionE: number
    correctionN: number
    adjDeltaE: number
    adjDeltaN: number
    adjEasting: number
    adjNorthing: number
  }>
  closingErrorE: number
  closingErrorN: number
  linearError: number
  totalDistance: number
  precisionRatio: number
  precisionGrade: string
  isClosed: boolean
}

export function bowditchAdjustmentSolvedFromResult(result: TraverseAdjustmentSolvedResult): Solved<TraverseAdjustmentSolvedResult> & { solution: Solution } {
  const sumAdjE = result.legs.reduce((s, l) => s + l.adjDeltaE, 0)
  const sumAdjN = result.legs.reduce((s, l) => s + l.adjDeltaN, 0)
  const sumCorrE = result.legs.reduce((s, l) => s + l.correctionE, 0)
  const sumCorrN = result.legs.reduce((s, l) => s + l.correctionN, 0)

  const firstLeg = result.legs[0]

  const solution = createSolutionV1({
    title: 'Closed Traverse Adjustment (Bowditch Rule)',
    given: [
      { label: 'No. of legs', value: `${result.legs.length}` },
      { label: 'Total distance (ΣD)', value: `${fullNumber(result.totalDistance)} m` },
      { label: 'Closing error (E)', value: `${fullNumber(result.closingErrorE)} m` },
      { label: 'Closing error (N)', value: `${fullNumber(result.closingErrorN)} m` },
    ],
    toFind: ['Corrections per leg (Bowditch)', 'Adjusted ΔE, ΔN', 'Adjusted coordinates', 'Precision ratio + grade'],
    solution: [
      {
        title: 'Latitude & Departure (per leg)',
        formula: 'ΔN = D × cos(θ),  ΔE = D × sin(θ)  (θ = WCB)',
        substitution: firstLeg
          ? `Example (${firstLeg.from}→${firstLeg.to}): ΔN = ${fullNumber(firstLeg.distance)}×cos(${fullNumber(firstLeg.bearing)}°), ΔE = ${fullNumber(firstLeg.distance)}×sin(${fullNumber(firstLeg.bearing)}°)`
          : undefined,
        computation: firstLeg
          ? `Example result: ΔN = ${fullNumber(firstLeg.rawDeltaN)} m, ΔE = ${fullNumber(firstLeg.rawDeltaE)} m`
          : undefined,
      },
      {
        title: 'Closing Error',
        formula: 'eN = −ΣΔN,  eE = −ΣΔE (closed traverse)',
        substitution: `eN = ${fullNumber(result.closingErrorN)} m,  eE = ${fullNumber(result.closingErrorE)} m`,
        computation: `Linear misclosure = √(eE² + eN²) = ${fullNumber(result.linearError)} m`,
        result: formatDistanceMeters(result.linearError),
      },
      {
        title: 'Bowditch Corrections',
        formula: 'corrNᵢ = −(Dᵢ/ΣD)×eN,  corrEᵢ = −(Dᵢ/ΣD)×eE',
        substitution: `Using ΣD = ${fullNumber(result.totalDistance)} m`,
        computation: `ΣcorrN = ${fullNumber(sumCorrN)} m,  ΣcorrE = ${fullNumber(sumCorrE)} m`,
      },
      {
        title: 'Adjusted Deltas',
        formula: 'Adj ΔNᵢ = ΔNᵢ + corrNᵢ,  Adj ΔEᵢ = ΔEᵢ + corrEᵢ',
        computation: `ΣAdjΔN = ${fullNumber(sumAdjN)} m,  ΣAdjΔE = ${fullNumber(sumAdjE)} m (should be ≈ 0)`,
      },
      {
        title: 'Precision',
        formula: 'Relative precision = ΣD / linear misclosure',
        substitution: `= ${fullNumber(result.totalDistance)} / ${fullNumber(result.linearError)}`,
        computation: `= ${fullNumber(result.totalDistance / Math.max(1e-12, result.linearError))}`,
        result: formatPrecisionRatio(result.totalDistance, result.linearError),
      },
    ],
    check: [
      { label: 'Closure after adjustment (ΣAdjΔN)', value: formatDeltaMeters(sumAdjN), ok: Math.abs(sumAdjN) < 1e-6 },
      { label: 'Closure after adjustment (ΣAdjΔE)', value: formatDeltaMeters(sumAdjE), ok: Math.abs(sumAdjE) < 1e-6 },
      { label: 'Closed traverse grade', value: String(result.precisionGrade), ok: result.isClosed },
    ],
    result: [
      { label: 'Linear misclosure', value: formatDistanceMeters(result.linearError) },
      { label: 'Precision', value: formatPrecisionRatio(result.totalDistance, result.linearError) },
      { label: 'Grade', value: String(result.precisionGrade) },
      ...(firstLeg
        ? [
            { label: `Example bearing (${firstLeg.from}→${firstLeg.to})`, value: formatBearingWcbDms(firstLeg.bearing) },
            { label: `Example distance (${firstLeg.from}→${firstLeg.to})`, value: formatDistanceMeters(firstLeg.distance) },
          ]
        : []),
    ],
  })

  return solveWithSteps(result, solution)
}

export function bowditchAdjustmentSolutionFromResult(result: TraverseAdjustmentSolvedResult): Solution {
  return bowditchAdjustmentSolvedFromResult(result).solution
}

export function transitAdjustmentSolvedFromResult(result: TraverseAdjustmentSolvedResult): Solved<TraverseAdjustmentSolvedResult> & { solution: Solution } {
  const sumAdjE = result.legs.reduce((s, l) => s + l.adjDeltaE, 0)
  const sumAdjN = result.legs.reduce((s, l) => s + l.adjDeltaN, 0)

  const sumCorrE = result.legs.reduce((s, l) => s + l.correctionE, 0)
  const sumCorrN = result.legs.reduce((s, l) => s + l.correctionN, 0)

  const absSumLat = result.legs.reduce((s, l) => s + Math.abs(l.rawDeltaN), 0)
  const absSumDep = result.legs.reduce((s, l) => s + Math.abs(l.rawDeltaE), 0)

  const firstLeg = result.legs[0]

  const solution = createSolutionV1({
    title: 'Closed Traverse Adjustment (Transit Rule)',
    given: [
      { label: 'No. of legs', value: `${result.legs.length}` },
      { label: 'Total distance (ΣD)', value: `${fullNumber(result.totalDistance)} m` },
      { label: 'Closing error (E)', value: `${fullNumber(result.closingErrorE)} m` },
      { label: 'Closing error (N)', value: `${fullNumber(result.closingErrorN)} m` },
      { label: 'Σ|Lat|', value: `${fullNumber(absSumLat)} m` },
      { label: 'Σ|Dep|', value: `${fullNumber(absSumDep)} m` },
    ],
    toFind: ['Corrections per leg (Transit rule)', 'Adjusted ΔE, ΔN', 'Adjusted coordinates', 'Precision ratio + grade'],
    solution: [
      {
        title: 'Latitude & Departure (per leg)',
        formula: 'ΔN = D × cos(θ),  ΔE = D × sin(θ)  (θ = WCB)',
        substitution: firstLeg
          ? `Example (${firstLeg.from}→${firstLeg.to}): ΔN = ${fullNumber(firstLeg.distance)}×cos(${fullNumber(firstLeg.bearing)}°), ΔE = ${fullNumber(firstLeg.distance)}×sin(${fullNumber(firstLeg.bearing)}°)`
          : undefined,
        computation: firstLeg
          ? `Example result: ΔN = ${fullNumber(firstLeg.rawDeltaN)} m, ΔE = ${fullNumber(firstLeg.rawDeltaE)} m`
          : undefined,
      },
      {
        title: 'Closing Error',
        formula: 'eN = −ΣΔN,  eE = −ΣΔE (closed traverse)',
        substitution: `eN = ${fullNumber(result.closingErrorN)} m,  eE = ${fullNumber(result.closingErrorE)} m`,
        computation: `Linear misclosure = √(eE² + eN²) = ${fullNumber(result.linearError)} m`,
        result: formatDistanceMeters(result.linearError),
      },
      {
        title: 'Transit Corrections',
        formula: 'corrNᵢ = −(|ΔNᵢ|/Σ|ΔN|)×eN,  corrEᵢ = −(|ΔEᵢ|/Σ|ΔE|)×eE',
        substitution: `Using Σ|ΔN| = ${fullNumber(absSumLat)} m, Σ|ΔE| = ${fullNumber(absSumDep)} m`,
        computation: `ΣcorrN = ${fullNumber(sumCorrN)} m,  ΣcorrE = ${fullNumber(sumCorrE)} m`,
      },
      {
        title: 'Adjusted Deltas',
        formula: 'Adj ΔNᵢ = ΔNᵢ + corrNᵢ,  Adj ΔEᵢ = ΔEᵢ + corrEᵢ',
        computation: `ΣAdjΔN = ${fullNumber(sumAdjN)} m,  ΣAdjΔE = ${fullNumber(sumAdjE)} m (should be ≈ 0)`,
      },
      {
        title: 'Precision',
        formula: 'Relative precision = ΣD / linear misclosure',
        substitution: `= ${fullNumber(result.totalDistance)} / ${fullNumber(result.linearError)}`,
        computation: `= ${fullNumber(result.totalDistance / Math.max(1e-12, result.linearError))}`,
        result: formatPrecisionRatio(result.totalDistance, result.linearError),
      },
    ],
    check: [
      { label: 'Closure after adjustment (ΣAdjΔN)', value: formatDeltaMeters(sumAdjN), ok: Math.abs(sumAdjN) < 1e-6 },
      { label: 'Closure after adjustment (ΣAdjΔE)', value: formatDeltaMeters(sumAdjE), ok: Math.abs(sumAdjE) < 1e-6 },
      { label: 'Closed traverse grade', value: String(result.precisionGrade), ok: result.isClosed },
    ],
    result: [
      { label: 'Linear misclosure', value: formatDistanceMeters(result.linearError) },
      { label: 'Precision', value: formatPrecisionRatio(result.totalDistance, result.linearError) },
      { label: 'Grade', value: String(result.precisionGrade) },
      ...(firstLeg
        ? [
            { label: `Example bearing (${firstLeg.from}→${firstLeg.to})`, value: formatBearingWcbDms(firstLeg.bearing) },
            { label: `Example distance (${firstLeg.from}→${firstLeg.to})`, value: formatDistanceMeters(firstLeg.distance) },
          ]
        : []),
    ],
  })

  return solveWithSteps(result, solution)
}

export function transitAdjustmentSolutionFromResult(result: TraverseAdjustmentSolvedResult): Solution {
  return transitAdjustmentSolvedFromResult(result).solution
}
