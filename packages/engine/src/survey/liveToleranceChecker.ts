/**
 * LiveToleranceChecker — field-side, offline-first tolerance checking
 *
 * THE PROMISE
 * -----------
 * "The surveyor never has to do arithmetic in their head between the moment
 * they capture a shot and the moment it's either flagged wrong or accepted
 * as correct."
 *
 * This module wraps the existing traverse engine + RDM 1.1 tolerance tables
 * + LSA statistical testing into a single function that runs client-side,
 * offline, in < 100ms. After each shot is added to the field book, re-run
 * this check. Show a persistent badge: green (passing), yellow (marginal),
 * red (failing). When red, highlight the leg with the largest residual and
 * say "recheck setup at station X."
 *
 * WHAT IT CHECKS
 * --------------
 * 1. Traverse closure: linear misclosure / perimeter → precision ratio
 *    → RDM 1.1 Table 5.1 order classification → pass/fail
 * 2. Angular misclosure: sum of measured angles vs (n-2)×180°
 *    → per-station allowance → pass/fail
 * 3. Leveling closure: misclosure vs C√K mm → pass/fail
 * 4. LSA global test (if enough observations for redundancy)
 * 5. Worst-leg identification: which leg has the largest residual
 *
 * OFFLINE-FIRST
 * -------------
 * The entire check runs in the browser. No server round-trip. Uses the
 * observations already in IndexedDB. The result syncs when connectivity
 * returns.
 *
 * USAGE
 * -----
 *   import { checkTolerance } from '@/lib/survey/liveToleranceChecker'
 *
 *   const result = checkTolerance({
 *     surveyType: 'cadastral',
 *     observations: [...],  // from the field book
 *     openingEasting: 264000,
 *     openingNorthing: 9861000,
 *     closingEasting: 264000,  // same = closed traverse
 *     closingNorthing: 9861000,
 *   })
 *
 *   if (result.status === 'fail') {
 *     // Show: "Closure failed (1:8,234). Recheck setup at station CP3."
 *   }
 */

import { computeTraverse, type RawObservation, type TraverseComputationResult } from '@/lib/computations/traverseEngine'
import {
  checkTraverseConformance,
  checkLevelingConformance,
  RDM_TRAVERSE_ACCURACY,
  RDM_LEVELING_ACCURACY,
  type RDMConformanceResult,
} from '@/lib/standards/rdm11'
import { globalChiSquareTest } from '@/lib/survey/lsaStatisticalTesting'

// ─── Types ──────────────────────────────────────────────────────────────────

export type SurveyType =
  | 'cadastral'
  | 'engineering'
  | 'topographic'
  | 'control'
  | 'monitoring'
  | 'leveling'
  | 'construction'

export type ToleranceStatus = 'pass' | 'marginal' | 'fail' | 'insufficient_data'

export interface ToleranceCheckInput {
  /** Survey type — determines which RDM 1.1 order is required */
  surveyType: SurveyType

  /** Traverse observations (from the field book) */
  observations: RawObservation[]

  /** Opening control point */
  openingEasting: number
  openingNorthing: number
  openingStation: string

  /** Closing control point (same as opening for closed traverse) */
  closingEasting?: number
  closingNorthing?: number
  closingStation?: string

  /** Backsight bearing (for WCB computation) */
  backsightBearingDeg: number
  backsightBearingMin: number
  backsightBearingSec: number

  /** For leveling checks */
  levelingMisclosureMm?: number
  levelingDistanceKm?: number

  /** LSA results (if available from a network adjustment) */
  sigmaZero?: number
  degreesOfFreedom?: number
}

export interface WorstLegInfo {
  /** Station name where the worst residual occurs */
  station: string
  /** The leg from → to */
  from: string
  to: string
  /** Residual magnitude in mm */
  residualMm: number
  /** What this means */
  diagnosis: string
  /** What the surveyor should do */
  recommendation: string
}

export interface ToleranceCheckResult {
  /** Overall status: pass / marginal / fail / insufficient_data */
  status: ToleranceStatus

  /** Human-readable summary for the badge */
  summary: string

  /** Detailed checks (from RDM 1.1 conformance checker) */
  rdmChecks: RDMConformanceResult

  /** Achieved accuracy order (e.g., "Second Order Class II") */
  achievedOrder: string | null

  /** Required accuracy order for this survey type */
  requiredOrder: string

  /** Precision ratio (e.g., 8234 → "1:8,234") */
  precisionRatio: number | null

  /** Linear misclosure in mm */
  linearMisclosureMm: number

  /** Total traverse perimeter in km */
  perimeterKm: number

  /** The leg with the largest residual (null if can't determine) */
  worstLeg: WorstLegInfo | null

  /** LSA global test result (if applicable) */
  lsaGlobalTest?: {
    passed: boolean
    chiSquareObserved: number
    chiSquareCritical: number
    interpretation: string
  }

  /** Whether there's enough data to perform the check */
  hasEnoughData: boolean

  /** List of actionable recommendations */
  recommendations: string[]

  /** Timestamp */
  timestamp: string
}

// ─── RDM 1.1 Order Requirements per Survey Type ─────────────────────────────

/**
 * Map survey type → minimum required RDM 1.1 order.
 *
 * Source: RDM 1.1 Table 5.1 + Survey Regulations 1994 + Survey Act Cap 299
 */
const SURVEY_TYPE_REQUIREMENTS: Record<SurveyType, {
  traverseOrder: string
  levelingOrder: string
  description: string
}> = {
  cadastral: {
    traverseOrder: 'Second Order Class II',  // 1:10,000 — minimum for title surveys
    levelingOrder: 'Third Order',             // 10√K mm
    description: 'Cadastral (title) surveys require minimum Second Order Class II (1:10,000) per Survey Regulations 1994.',
  },
  engineering: {
    traverseOrder: 'Second Order Class I',   // 1:20,000 — major engineering
    levelingOrder: 'Second Order',            // 8√K mm
    description: 'Engineering surveys require minimum Second Order Class I (1:20,000) per RDM 1.1.',
  },
  topographic: {
    traverseOrder: 'Third Order',              // 1:5,000
    levelingOrder: 'Fourth Order',             // 12√K mm
    description: 'Topographic surveys require minimum Third Order (1:5,000).',
  },
  control: {
    traverseOrder: 'First Order Class II',    // 1:50,000 — secondary geodetic
    levelingOrder: 'Second Order',             // 8√K mm
    description: 'Control surveys require minimum First Order Class II (1:50,000).',
  },
  monitoring: {
    traverseOrder: 'First Order Class II',    // 1:50,000 — deformation monitoring
    levelingOrder: 'First Order',              // 4√K mm
    description: 'Deformation monitoring requires First Order Class II (1:50,000) and First Order leveling.',
  },
  leveling: {
    traverseOrder: 'Third Order',
    levelingOrder: 'Third Order',              // 10√K mm — cadastral minimum
    description: 'Leveling surveys require minimum Third Order (10√K mm).',
  },
  construction: {
    traverseOrder: 'Second Order Class I',    // 1:20,000 — setting out
    levelingOrder: 'Second Order',             // 8√K mm
    description: 'Construction setting out requires Second Order Class I (1:20,000).',
  },
}

// ─── Main Function ──────────────────────────────────────────────────────────

/**
 * Check the tolerance of the current field observations.
 *
 * This is the core function of the live tolerance checker. It runs
 * client-side, offline, in < 100ms. Call it after every shot is added
 * to the field book.
 *
 * @param input - Observations + control points + survey type
 * @returns ToleranceCheckResult with status, summary, worst-leg, recommendations
 */
export function checkTolerance(input: ToleranceCheckInput): ToleranceCheckResult {
  const requirements = SURVEY_TYPE_REQUIREMENTS[input.surveyType]
  const recommendations: string[] = []
  const timestamp = new Date().toISOString()

  // ─── Check if we have enough data ───
  const validObs = input.observations.filter(o => o.station && o.slopeDist)
  if (validObs.length < 3) {
    return {
      status: 'insufficient_data',
      summary: `Need at least 3 observations to check (have ${validObs.length}). Keep shooting.`,
      rdmChecks: { passed: false, checks: [], overallGrade: null },
      achievedOrder: null,
      requiredOrder: requirements.traverseOrder,
      precisionRatio: null,
      linearMisclosureMm: 0,
      perimeterKm: 0,
      worstLeg: null,
      hasEnoughData: false,
      recommendations: ['Continue capturing observations. The tolerance check will activate at 3+ legs.'],
      timestamp,
    }
  }

  // ─── Compute the traverse ───
  let traverseResult: TraverseComputationResult
  try {
    traverseResult = computeTraverse({
      openingEasting: input.openingEasting,
      openingNorthing: input.openingNorthing,
      openingStation: input.openingStation,
      closingEasting: input.closingEasting,
      closingNorthing: input.closingNorthing,
      closingStation: input.closingStation,
      observations: input.observations,
      backsightBearingDeg: input.backsightBearingDeg,
      backsightBearingMin: input.backsightBearingMin,
      backsightBearingSec: input.backsightBearingSec,
    })
  } catch (err) {
    return {
      status: 'fail',
      summary: `Traverse computation failed: ${err instanceof Error ? err.message : String(err)}`,
      rdmChecks: { passed: false, checks: [], overallGrade: null },
      achievedOrder: null,
      requiredOrder: requirements.traverseOrder,
      precisionRatio: null,
      linearMisclosureMm: 0,
      perimeterKm: 0,
      worstLeg: null,
      hasEnoughData: true,
      recommendations: ['Check that observations are complete and angles/distances are entered correctly.'],
      timestamp,
    }
  }

  // ─── Check RDM 1.1 traverse conformance ───
  const linearErrorM = traverseResult.linearError
  const totalDistanceM = traverseResult.totalPerimeter
  const angularErrorSec = computeAngularMisclosure(validObs)
  const numStations = validObs.length

  const rdmChecks = checkTraverseConformance(
    linearErrorM,
    totalDistanceM,
    angularErrorSec,
    numStations,
    requirements.traverseOrder,
  )

  // ─── Check leveling if provided ───
  if (input.levelingMisclosureMm !== undefined && input.levelingDistanceKm !== undefined) {
    const levelingChecks = checkLevelingConformance(
      input.levelingMisclosureMm,
      input.levelingDistanceKm,
      requirements.levelingOrder,
    )
    rdmChecks.checks.push(...levelingChecks.checks)
    rdmChecks.passed = rdmChecks.passed && levelingChecks.passed
  }

  // ─── Identify the worst leg ───
  const worstLeg = identifyWorstLeg(traverseResult)

  // ─── LSA global test (if sigmaZero + dof provided) ───
  let lsaGlobalTest: ToleranceCheckResult['lsaGlobalTest']
  if (input.sigmaZero !== undefined && input.degreesOfFreedom !== undefined && input.degreesOfFreedom > 0) {
    const test = globalChiSquareTest(input.sigmaZero, input.degreesOfFreedom, 0.05)
    lsaGlobalTest = {
      passed: test.passed,
      chiSquareObserved: test.chiSquareObserved,
      chiSquareCritical: test.chiSquareCritical,
      interpretation: test.interpretation,
    }
    if (!test.passed) {
      recommendations.push('LSA global test failed — the adjustment may contain blunders or incorrect a priori standard deviations.')
    }
  }

  // ─── Determine overall status ───
  const requiredStd = RDM_TRAVERSE_ACCURACY.find(s => s.order === requirements.traverseOrder)
  const requiredRatio = requiredStd?.ratioNumeric ?? 10000
  const achievedRatio = traverseResult.precisionRatio

  let status: ToleranceStatus
  let summary: string

  if (rdmChecks.passed && achievedRatio >= requiredRatio) {
    // Check if marginal (within 20% of the limit)
    if (achievedRatio < requiredRatio * 1.2) {
      status = 'marginal'
      summary = `Marginal: 1:${Math.round(achievedRatio).toLocaleString()} (required ≥ 1:${requiredRatio.toLocaleString()}). Passing but close — consider rechecking observations.`
      recommendations.push(`Precision ratio is within 20% of the minimum. Verify the worst leg at ${worstLeg?.station ?? 'unknown'}.`)
    } else {
      status = 'pass'
      const order = rdmChecks.overallGrade ?? 'Unknown'
      summary = `PASS — ${order} (1:${Math.round(achievedRatio).toLocaleString()}). Closure ${(traverseResult.linearError * 1000).toFixed(1)}mm over ${(totalDistanceM / 1000).toFixed(3)}km.`
    }
  } else {
    status = 'fail'
    summary = `FAIL — 1:${Math.round(achievedRatio).toLocaleString()} (required ≥ 1:${requiredRatio.toLocaleString()}). Linear misclosure ${(linearErrorM * 1000).toFixed(1)}mm.`
    if (worstLeg) {
      recommendations.push(`Recheck setup at ${worstLeg.station}. ${worstLeg.recommendation}`)
    }
    recommendations.push(`Required: ${requirements.traverseOrder} (${requirements.description})`)
  }

  // ─── Angular misclosure warning ───
  if (angularErrorSec > 10) {
    recommendations.push(`Angular misclosure is high (${angularErrorSec.toFixed(1)}″/station). Check for misread angles or instrument centering errors.`)
  }

  // ─── Courses without azimuth check ───
  if (numStations > 15) {
    recommendations.push(`${numStations} courses without azimuth check exceeds RDM 1.1 limit of 15. Add an intermediate azimuth check.`)
  }

  return {
    status,
    summary,
    rdmChecks,
    achievedOrder: rdmChecks.overallGrade,
    requiredOrder: requirements.traverseOrder,
    precisionRatio: achievedRatio,
    linearMisclosureMm: linearErrorM * 1000,
    perimeterKm: totalDistanceM / 1000,
    worstLeg,
    lsaGlobalTest,
    hasEnoughData: true,
    recommendations: recommendations.length > 0 ? recommendations : ['All checks passing. Continue to next station.'],
    timestamp,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute the angular misclosure per station.
 *
 * For a closed traverse: sum of interior angles = (n-2) × 180°
 * Misclosure = sum of measured angles - (n-2) × 180°
 * Per station = misclosure / n
 */
function computeAngularMisclosure(observations: RawObservation[]): number {
  // We need the measured angles. The RawObservation has HCL/HCR which
  // give the mean angle. For a simple check, we compute the mean angle
  // per station and check if the sum closes.
  //
  // NOTE: This is a simplified check. A full angular misclosure requires
  // knowing which angles are interior vs exterior. For the field-side
  // check, we estimate from the residuals.

  // If we can't compute it (incomplete data), return 0 (no warning)
  if (observations.length < 3) return 0

  try {
    // Compute mean angle per station
    let sumAngles = 0
    let count = 0
    for (const obs of observations) {
      const hcl = (parseInt(obs.hclDeg) || 0) + (parseInt(obs.hclMin) || 0) / 60 + (parseFloat(obs.hclSec) || 0) / 3600
      const hcr = (parseInt(obs.hcrDeg) || 0) + (parseInt(obs.hcrMin) || 0) / 60 + (parseFloat(obs.hcrSec) || 0) / 3600
      if (hcl > 0 || hcr > 0) {
        let hcrAdj = hcr + 180
        if (hcrAdj >= 360) hcrAdj -= 360
        const meanAngle = (hcl + hcrAdj) / 2
        sumAngles += meanAngle
        count++
      }
    }

    if (count < 3) return 0

    // Expected sum for a closed polygon: (n-2) × 180
    const expected = (count - 2) * 180
    const misclosure = Math.abs(sumAngles - expected)
    // Per station
    return (misclosure / count) * 3600 // convert to arc-seconds
  } catch {
    return 0
  }
}

/**
 * Identify the leg with the largest residual.
 *
 * After the Bowditch adjustment, each leg has a departure correction and
 * a latitude correction. The leg with the largest combined correction is
 * the most likely source of a blunder.
 */
function identifyWorstLeg(result: TraverseComputationResult): WorstLegInfo | null {
  if (!result.legs || result.legs.length === 0) return null

  let worstLeg = result.legs[0]
  let worstResidual = 0

  for (const leg of result.legs) {
    // Combined correction magnitude (mm)
    const residualMm = Math.sqrt(
      leg.depCorrection ** 2 + leg.latCorrection ** 2,
    ) * 1000

    if (residualMm > worstResidual) {
      worstResidual = residualMm
      worstLeg = leg
    }
  }

  if (worstResidual < 1) {
    // No significant residual — all legs are fine
    return null
  }

  // Diagnose the likely cause
  let diagnosis: string
  let recommendation: string

  const depCorr = Math.abs(worstLeg.depCorrection)
  const latCorr = Math.abs(worstLeg.latCorrection)

  if (depCorr > latCorr * 2) {
    diagnosis = `Largest departure correction (${(worstLeg.depCorrection * 1000).toFixed(1)}mm) on leg ${worstLeg.from} → ${worstLeg.to}.`
    recommendation = `Distance on this leg may be wrong. Re-measure the distance from ${worstLeg.from} to ${worstLeg.to}.`
  } else if (latCorr > depCorr * 2) {
    diagnosis = `Largest latitude correction (${(worstLeg.latCorrection * 1000).toFixed(1)}mm) on leg ${worstLeg.from} → ${worstLeg.to}.`
    recommendation = `Bearing on this leg may be wrong. Re-check the angle at ${worstLeg.from}.`
  } else {
    diagnosis = `Largest combined correction (${worstResidual.toFixed(1)}mm) on leg ${worstLeg.from} → ${worstLeg.to}.`
    recommendation = `Recheck both angle and distance at station ${worstLeg.from}.`
  }

  return {
    station: worstLeg.from,
    from: worstLeg.from,
    to: worstLeg.to,
    residualMm: worstResidual,
    diagnosis,
    recommendation,
  }
}

// ─── Badge Helpers (for the UI) ─────────────────────────────────────────────

/**
 * Get the badge color for a tolerance status.
 */
export function getToleranceBadgeColor(status: ToleranceStatus): string {
  switch (status) {
    case 'pass': return 'green'
    case 'marginal': return 'yellow'
    case 'fail': return 'red'
    case 'insufficient_data': return 'gray'
    default: return 'gray'
  }
}

/**
 * Get a short label for the badge.
 */
export function getToleranceBadgeLabel(status: ToleranceStatus): string {
  switch (status) {
    case 'pass': return 'CLOSURE OK'
    case 'marginal': return 'MARGINAL'
    case 'fail': return 'CLOSURE FAIL'
    case 'insufficient_data': return 'NEED MORE DATA'
    default: return 'UNKNOWN'
  }
}

/**
 * Get the emoji/icon for the badge (for quick visual scanning in the field).
 */
export function getToleranceIcon(status: ToleranceStatus): string {
  switch (status) {
    case 'pass': return '✓'
    case 'marginal': return '!'
    case 'fail': return '✗'
    case 'insufficient_data': return '···'
    default: return '?'
  }
}
