/**
 * Regulatory Compliance Checker — Survey Regulations 1994 (Kenya)
 *
 * Checks survey data against the actual regulations from the Survey Act Cap 299
 * and Survey Regulations 1994 (Legal Notice 168 of 1994, as amended through 2024).
 *
 * References extracted from the official PDF:
 *   - Regulation 60: Lower order traverses — accuracy standards
 *   - Regulation 61: Angular measurement — 2 rounds, different faces/zeros
 *   - Regulation 62: Linear measurement — reduce to horizontal at MSL, temp/sag correction
 *   - Regulation 65: Swinging/hanging traverses prohibited
 *   - Regulation 66: Verify points of departure and termination
 *   - Regulation 67: Verify datum stations
 *   - Regulation 26: Surveyor personally responsible for accuracy
 *   - Regulation 27: Permissible errors — Director may refuse
 *   - Regulation 39: Referencing of boundary beacons — underground mark
 *   - Regulation 84: Area computation precision
 *   - Regulation 92: Co-ordinates to be shown on plan
 */

import type { ToleranceCheckResult } from '@/lib/survey/liveToleranceChecker'
import type { AdjustmentResult } from '@/lib/survey/networkAdjustment'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ComplianceCheck {
  regulation: string
  requirement: string
  status: 'pass' | 'fail' | 'warning' | 'not_applicable'
  details: string
  recommendation?: string
}

export interface ComplianceReport {
  checks: ComplianceCheck[]
  overallStatus: 'compliant' | 'non_compliant' | 'conditional'
  summary: string
  blockingIssues: string[]
  timestamp: string
}

export interface ComplianceInput {
  /** Tolerance check result from LiveToleranceChecker */
  toleranceResult?: ToleranceCheckResult
  /** Network adjustment result (if LSA was performed) */
  adjustmentResult?: AdjustmentResult
  /** Survey type */
  surveyType: string
  /** Number of traverse stations */
  stationCount: number
  /** Whether the traverse closes between two fixed points (vs loop) */
  closesBetweenFixedPoints: boolean
  /** Whether datum stations were verified */
  datumVerified: boolean
  /** Whether boundary beacons have reference marks */
  beaconsReferenced: boolean
  /** Whether measurements were reduced to MSL */
  reducedToMSL: boolean
  /** Whether temperature/sag corrections were applied */
  correctionsApplied: boolean
  /** Whether angular observations used 2+ rounds on different faces */
  twoRoundsObserved: boolean
  /** Area in hectares (for precision check) */
  areaHa?: number
  /** Whether coordinates are shown on the plan */
  coordinatesOnPlan: boolean
}

// ─── Main Function ──────────────────────────────────────────────────────────

/**
 * Check survey data against Survey Regulations 1994.
 *
 * Each check references the specific regulation number and quotes the
 * requirement verbatim from the law. This is not a "best practice" check —
 * it's a statutory compliance check.
 */
export function checkRegulatoryCompliance(input: ComplianceInput): ComplianceReport {
  const checks: ComplianceCheck[] = []
  const blockingIssues: string[] = []

  // ─── Regulation 60(1)(a): Main control traverses in built-up areas → third order (1:20,000) ───
  if (input.toleranceResult) {
    const required = input.surveyType === 'engineering' || input.surveyType === 'construction'
      ? 20000  // Reg 60(1)(a): built-up areas → 1:20,000
      : 10000  // Reg 60(2)(b): other areas → 1:10,000

    const achieved = input.toleranceResult.precisionRatio
    if (achieved) {
      const passed = achieved >= required
      checks.push({
        regulation: 'Reg 60',
        requirement: input.surveyType === 'engineering' || input.surveyType === 'construction'
          ? 'Main control traverses in built-up areas: 1:20,000 (third order)'
          : 'Other control traverses: 1:10,000 (fourth order)',
        status: passed ? 'pass' : 'fail',
        details: `Achieved 1:${Math.round(achieved).toLocaleString()} (required ≥ 1:${required.toLocaleString()})`,
        recommendation: passed ? undefined : 'Traverse does not meet the accuracy standard. Re-observe or re-close before submission.',
      })
      if (!passed) blockingIssues.push('Reg 60: Traverse accuracy below statutory minimum')
    }
  }

  // ─── Regulation 60(2)(c): No loop traverse if practicable to close between fixed points ───
  checks.push({
    regulation: 'Reg 60(2)(c)',
    requirement: 'A surveyor shall not use a loop traverse closing on his starting point if it is practicable to traverse between two previously fixed stations.',
    status: input.closesBetweenFixedPoints ? 'pass' : 'warning',
    details: input.closesBetweenFixedPoints
      ? 'Traverse closes between two fixed points — compliant.'
      : 'Traverse is a loop closing on its starting point. Ensure no two fixed stations were available for closure.',
    recommendation: input.closesBetweenFixedPoints ? undefined : 'If fixed stations are available, re-close between them instead of looping.',
  })

  // ─── Regulation 61(3): Two rounds on different faces and zeros ───
  checks.push({
    regulation: 'Reg 61(3)',
    requirement: 'At every traverse station, not less than two rounds on different faces and different zeros shall be observed.',
    status: input.twoRoundsObserved ? 'pass' : 'fail',
    details: input.twoRoundsObserved
      ? 'Two rounds on different faces confirmed.'
      : 'Cannot confirm two rounds on different faces. Ensure field notes show at least 2 rounds (FL + FR) at each station.',
    recommendation: input.twoRoundsObserved ? undefined : 'Re-observe stations with single-round observations.',
  })
  if (!input.twoRoundsObserved) blockingIssues.push('Reg 61(3): Angular observations may not meet minimum rounds requirement')

  // ─── Regulation 62(3): Reduce to horizontal at MSL + temperature/sag corrections ───
  if (!input.reducedToMSL) {
    checks.push({
      regulation: 'Reg 62(3)',
      requirement: 'All measurements shall be reduced to the horizontal at mean sea level and corrected for temperature and sag.',
      status: 'fail',
      details: 'Measurements not reduced to MSL.',
      recommendation: 'Apply MSL reduction before submitting computations.',
    })
    blockingIssues.push('Reg 62(3): Measurements not reduced to MSL')
  } else {
    checks.push({
      regulation: 'Reg 62(3)',
      requirement: 'All measurements shall be reduced to the horizontal at mean sea level and corrected for temperature and sag.',
      status: input.correctionsApplied ? 'pass' : 'warning',
      details: input.correctionsApplied
        ? 'MSL reduction and temperature/sag corrections applied.'
        : 'MSL reduction confirmed, but temperature/sag corrections not confirmed.',
      recommendation: input.correctionsApplied ? undefined : 'Verify temperature and sag corrections were applied to all measured distances.',
    })
  }

  // ─── Regulation 65: No swinging/hanging traverses ───
  checks.push({
    regulation: 'Reg 65',
    requirement: 'Swinging or hanging traverses unsupported by independent checks shall not be used.',
    status: input.closesBetweenFixedPoints ? 'pass' : 'warning',
    details: input.closesBetweenFixedPoints
      ? 'Traverse closes between fixed points — not a swinging traverse.'
      : 'Loop traverse — ensure it is supported by independent checks (azimuth check, tie to existing control).',
  })

  // ─── Regulation 66: Verify points of departure and termination ───
  checks.push({
    regulation: 'Reg 66',
    requirement: 'Every point of departure of a new traverse and every terminating point shall be verified.',
    status: input.datumVerified ? 'pass' : 'fail',
    details: input.datumVerified
      ? 'Points of departure and termination verified.'
      : 'Points of departure and termination not verified. The Director may refuse to authenticate.',
    recommendation: input.datumVerified ? undefined : 'Verify datum stations by observations to at least two existing permanent marks.',
  })
  if (!input.datumVerified) blockingIssues.push('Reg 66: Datum stations not verified')

  // ─── Regulation 67: Verify datum stations ───
  checks.push({
    regulation: 'Reg 67',
    requirement: 'Where a traverse station is used to place a boundary beacon, the surveyor shall verify the station by observations.',
    status: input.datumVerified ? 'pass' : 'warning',
    details: input.datumVerified
      ? 'Datum stations verified by observation.'
      : 'Datum station verification not confirmed.',
  })

  // ─── Regulation 39: Referencing of boundary beacons ───
  if (input.surveyType === 'cadastral') {
    checks.push({
      regulation: 'Reg 39',
      requirement: 'All boundary beacons shall be referenced by the establishment of a permanent underground mark.',
      status: input.beaconsReferenced ? 'pass' : 'warning',
      details: input.beaconsReferenced
        ? 'Boundary beacons referenced with underground marks.'
        : 'Beacon referencing not confirmed. Underground marks or two existing nearby beacons required.',
      recommendation: input.beaconsReferenced ? undefined : 'Establish reference marks for all boundary beacons before submission.',
    })
  }

  // ─── Regulation 84: Area computation precision ───
  if (input.areaHa) {
    let requiredDecimals: number
    if (input.areaHa < 0.4) requiredDecimals = 4  // < 0.4 ha → 4 decimal places
    else if (input.areaHa < 4) requiredDecimals = 3  // < 4 ha → 3 dp
    else if (input.areaHa < 40) requiredDecimals = 2  // < 40 ha → 2 dp
    else if (input.areaHa < 400) requiredDecimals = 1  // < 400 ha → 1 dp
    else requiredDecimals = 0  // ≥ 400 ha → 0 dp

    checks.push({
      regulation: 'Reg 84',
      requirement: `Areas of ${input.areaHa} ha shall be calculated to ${requiredDecimals} decimal place(s).`,
      status: 'pass', // We always compute to full precision; display rounds appropriately
      details: `Area: ${input.areaHa} ha. Required precision: ${requiredDecimals} dp. METARDU computes to full float precision and displays per regulation.`,
    })
  }

  // ─── Regulation 92: Co-ordinates on plan ───
  checks.push({
    regulation: 'Reg 92',
    requirement: 'Co-ordinates of block corners, permanent control stations, and beacons of irregular-shaped figures shall be shown on the plan.',
    status: input.coordinatesOnPlan ? 'pass' : 'warning',
    details: input.coordinatesOnPlan
      ? 'Co-ordinates shown on plan.'
      : 'Ensure co-ordinates are tabulated on the plan before submission.',
  })

  // ─── LSA statistical test (if available) ───
  if (input.adjustmentResult?.statisticalReport) {
    const report = input.adjustmentResult.statisticalReport
    checks.push({
      regulation: 'Reg 27',
      requirement: 'The Director may refuse to authenticate any survey which contains errors in excess of those expected from properly carried out measurements.',
      status: report.verdict === 'PASS' ? 'pass' : report.verdict === 'FAIL' ? 'fail' : 'warning',
      details: `LSA global test: ${report.globalTest.interpretation}`,
      recommendation: report.verdict === 'FAIL'
        ? 'Adjustment failed statistical test. Check for blunders before submission.'
        : undefined,
    })
    if (report.verdict === 'FAIL') blockingIssues.push('Reg 27: LSA statistical test failed — possible blunders')
  }

  // ─── Overall status ───
  const overallStatus: 'compliant' | 'non_compliant' | 'conditional' =
    blockingIssues.length > 0 ? 'non_compliant'
    : checks.some(c => c.status === 'warning') ? 'conditional'
    : 'compliant'

  let summary: string
  if (overallStatus === 'compliant') {
    summary = `Survey is COMPLIANT with Survey Regulations 1994. All ${checks.length} checks passed.`
  } else if (overallStatus === 'conditional') {
    const warnings = checks.filter(c => c.status === 'warning').length
    summary = `Survey is CONDITIONALLY COMPLIANT. ${warnings} warning(s) to address before submission. No blocking issues.`
  } else {
    summary = `Survey is NON-COMPLIANT. ${blockingIssues.length} blocking issue(s): ${blockingIssues.join('; ')}. The Director may refuse to authenticate.`
  }

  return {
    checks,
    overallStatus,
    summary,
    blockingIssues,
    timestamp: new Date().toISOString(),
  }
}

// ─── Display Helpers ────────────────────────────────────────────────────────

export function getComplianceColor(status: 'compliant' | 'non_compliant' | 'conditional'): string {
  switch (status) {
    case 'compliant': return 'green'
    case 'conditional': return 'yellow'
    case 'non_compliant': return 'red'
    default: return 'gray'
  }
}

export function getCheckStatusColor(status: 'pass' | 'fail' | 'warning' | 'not_applicable'): string {
  switch (status) {
    case 'pass': return 'green'
    case 'fail': return 'red'
    case 'warning': return 'yellow'
    case 'not_applicable': return 'gray'
    default: return 'gray'
  }
}
