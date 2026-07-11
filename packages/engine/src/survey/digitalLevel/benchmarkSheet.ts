/**
 * Benchmark Sheet Generator
 *
 * Generates a benchmark schedule / control point summary sheet from
 * level network adjustment results. Used for Kenya survey submissions
 * to document known control points and their adjusted RLs.
 */

import {
  LevelAdjustmentResult,
  LevelControlPoint,
  LevelObservation,
  AdjustedLevel,
  LEVEL_ORDER_LIMITS,
} from './digitalLevelTypes'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BenchmarkRow {
  pointId: string
  description?: string
  rlOriginal?: number
  rlAdjusted: number
  sigmaRL: number
  isFixed: boolean
  order?: string
}

export interface BenchmarkSheet {
  projectName?: string
  surveyor?: string
  date?: string
  order: string
  instrument?: string
  staff?: string
  totalDistanceKm: number
  misclosureMm: number
  allowableMisclosureMm: number
  passed: boolean
  referenceVariance: number
  degreesOfFreedom: number
  benchmarks: BenchmarkRow[]
  remarks?: string
}

// ─── Sheet Generation ────────────────────────────────────────────────────────

/**
 * Generate a benchmark sheet from level network adjustment results.
 *
 * @param adjustmentResult - Output from adjustLevelNetwork()
 * @param controlPoints - Original control point data (for descriptions, original RLs)
 * @param options - Sheet metadata
 */
export function generateBenchmarkSheet(
  adjustmentResult: LevelAdjustmentResult,
  controlPoints: LevelControlPoint[],
  options?: {
    projectName?: string
    surveyor?: string
    date?: string
    instrument?: string
    staff?: string
    remarks?: string
  }
): BenchmarkSheet {
  // Build CP map for descriptions and original RLs
  const cpMap = new Map<string, LevelControlPoint>()
  for (const cp of controlPoints) {
    cpMap.set(cp.id, cp)
  }

  // Build benchmark rows
  const benchmarks: BenchmarkRow[] = adjustmentResult.adjustedLevels.map(function(level: AdjustedLevel) {
    const cp = cpMap.get(level.id)
    return {
      pointId: level.id,
      description: cp ? cp.id : undefined,
      rlOriginal: cp ? cp.rl : undefined,
      rlAdjusted: level.rl,
      sigmaRL: level.sigmaRL,
      isFixed: cp ? cp.isFixed : false,
      order: adjustmentResult.order,
    }
  })

  // Sort: fixed points first, then alphabetical
  benchmarks.sort(function(a, b) {
    if (a.isFixed && !b.isFixed) return -1
    if (!a.isFixed && b.isFixed) return 1
    return a.pointId.localeCompare(b.pointId)
  })

  const orderInfo = LEVEL_ORDER_LIMITS[adjustmentResult.order] || LEVEL_ORDER_LIMITS['fourth']

  return {
    projectName: options?.projectName,
    surveyor: options?.surveyor,
    date: options?.date,
    order: adjustmentResult.order,
    instrument: options?.instrument,
    staff: options?.staff,
    totalDistanceKm: adjustmentResult.totalDistance,
    misclosureMm: adjustmentResult.misclosure,
    allowableMisclosureMm: adjustmentResult.allowableMisclosure,
    passed: adjustmentResult.passed,
    referenceVariance: adjustmentResult.referenceVariance,
    degreesOfFreedom: adjustmentResult.degreesOfFreedom,
    benchmarks,
    remarks: options?.remarks,
  }
}

/**
 * Format a benchmark sheet as plain text (for field notes or CSV export).
 */
export function formatBenchmarkSheetAsText(sheet: BenchmarkSheet): string {
  const lines: string[] = []

  lines.push('BENCHMARK SHEET / CONTROL POINT SUMMARY')
  lines.push('========================================')
  if (sheet.projectName) lines.push('Project: ' + sheet.projectName)
  if (sheet.surveyor) lines.push('Surveyor: ' + sheet.surveyor)
  if (sheet.date) lines.push('Date: ' + sheet.date)
  if (sheet.instrument) lines.push('Instrument: ' + sheet.instrument)
  if (sheet.staff) lines.push('Staff: ' + sheet.staff)
  lines.push('Order: ' + sheet.order + ' (' + (LEVEL_ORDER_LIMITS[sheet.order]?.label || '') + ')')
  lines.push('Total Distance: ' + sheet.totalDistanceKm.toFixed(3) + ' km')
  lines.push('Misclosure: ' + sheet.misclosureMm.toFixed(1) + ' mm')
  lines.push('Allowable: ' + sheet.allowableMisclosureMm.toFixed(1) + ' mm')
  lines.push('Passed: ' + (sheet.passed ? 'YES' : 'NO'))
  lines.push('Reference Variance: ' + sheet.referenceVariance.toFixed(6))
  lines.push('Degrees of Freedom: ' + sheet.degreesOfFreedom)
  lines.push('')

  // Table header
  lines.push('Point        Fixed   RL Orig     RL Adjusted  Sigma RL (m)')
  lines.push('-----------  ------  ----------  -----------  ------------')

  for (const bm of sheet.benchmarks) {
    const fixed = bm.isFixed ? 'Yes' : 'No'
    const orig = bm.rlOriginal !== undefined ? bm.rlOriginal.toFixed(4) : '---'
    const adj = bm.rlAdjusted.toFixed(4)
    const sigma = bm.sigmaRL.toFixed(6)
    lines.push(
      bm.pointId.padEnd(12) + ' ' +
      fixed.padEnd(7) + ' ' +
      orig.padEnd(11) + ' ' +
      adj.padEnd(12) + ' ' +
      sigma
    )
  }

  if (sheet.remarks) {
    lines.push('')
    lines.push('REMARKS: ' + sheet.remarks)
  }

  return lines.join('\n')
}

/**
 * Validate whether a benchmark sheet meets Kenya survey standards
 * for the declared order.
 */
export function validateBenchmarkSheet(sheet: BenchmarkSheet): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  if (sheet.benchmarks.length === 0) {
    errors.push('No benchmark points in sheet')
  }

  const fixedCount = sheet.benchmarks.filter(function(b) { return b.isFixed }).length
  if (fixedCount === 0) {
    errors.push('At least one fixed control point is required')
  }

  if (!sheet.passed) {
    errors.push(
      'Misclosure (' + sheet.misclosureMm.toFixed(1) + ' mm) exceeds allowable limit (' +
      sheet.allowableMisclosureMm.toFixed(1) + ' mm) for ' + sheet.order + ' order'
    )
  }

  // Check sigma RL for adjusted points
  for (const bm of sheet.benchmarks) {
    if (!bm.isFixed && bm.sigmaRL > 0.1) {
      warnings.push(
        'Point ' + bm.pointId + ' has large sigma RL (' +
        (bm.sigmaRL * 1000).toFixed(1) + ' mm) — check observation quality'
      )
    }
  }

  if (sheet.totalDistanceKm === 0) {
    warnings.push('Total distance is zero — verify observation distances')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
