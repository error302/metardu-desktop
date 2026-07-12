/**
 * As-Built Comparison Engine — batch comparison of field shots vs design
 *
 * PROBLEM
 * -------
 * The existing checkCoordinate() in settingOutEngine.ts compares ONE
 * observation to ONE design point. For the setting-out loop, we need to:
 *   1. Take a batch of as-built field shots (from the total station)
 *   2. Match each to the nearest design point (by ID or by proximity)
 *   3. Compute dE, dN, dH for each
 *   4. Flag anything outside tolerance — BEFORE the crew leaves site
 *   5. Produce a summary: "47/50 points within ±25mm. 3 points flagged."
 *
 * This is the "no stress" closer: the surveyor captures as-built shots,
 * and the app immediately says green/red per point, before they leave site.
 *
 * USAGE
 * -----
 *   import { compareAsBuiltToDesign } from '@/lib/survey/asBuiltComparison'
 *
 *   const report = compareAsBuiltToDesign({
 *     designPoints: [...],
 *     asBuiltPoints: [...],
 *     toleranceH: 0.025,  // ±25mm horizontal
 *     toleranceV: 0.015,  // ±15mm vertical
 *   })
 *
 *   if (report.failedPoints.length > 0) {
 *     // "3 points flagged. Re-stake before leaving site."
 *   }
 */

import type { DesignPoint } from '@/lib/computations/settingOutEngine'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AsBuiltPoint {
  /** Point ID — should match a design point ID for automatic matching */
  id?: string
  /** Easting (meters) */
  e: number
  /** Northing (meters) */
  n: number
  /** Reduced level / elevation (meters) */
  rl?: number
  /** Description */
  description?: string
}

export interface ComparisonRow {
  /** Design point ID */
  designId: string
  /** As-built point ID (if matched by ID) */
  asBuiltId?: string
  /** Design coordinates */
  designE: number
  designN: number
  designRL: number
  /** As-built coordinates */
  asBuiltE: number
  asBuiltN: number
  asBuiltRL: number | null
  /** Offsets */
  deltaE: number  // meters
  deltaN: number
  deltaRL: number | null
  /** Horizontal offset (sqrt(dE² + dN²)) */
  horizontalOffset: number
  /** Status flags */
  hStatus: 'PASS' | 'FAIL'
  vStatus: 'PASS' | 'FAIL' | 'N/A'
  /** Whether this point is within tolerance */
  passed: boolean
  /** Matching method used */
  matchedBy: 'id' | 'proximity' | 'unmatched'
}

export interface ComparisonReport {
  /** Per-point comparison results */
  rows: ComparisonRow[]
  /** Points that passed all tolerance checks */
  passedPoints: ComparisonRow[]
  /** Points that failed horizontal or vertical tolerance */
  failedPoints: ComparisonRow[]
  /** Design points that were not matched to any as-built shot */
  unmatchedDesignPoints: DesignPoint[]
  /** As-built points that were not matched to any design point */
  unmatchedAsBuiltPoints: AsBuiltPoint[]

  /** Summary statistics */
  totalDesignPoints: number
  totalAsBuiltPoints: number
  totalMatched: number
  totalPassed: number
  totalFailed: number

  /** Overall verdict */
  verdict: 'PASS' | 'FAIL' | 'INCOMPLETE'
  /** Human-readable summary */
  summary: string

  /** Tolerances used */
  toleranceH: number
  toleranceV: number

  /** Timestamp */
  timestamp: string
}

export interface ComparisonInput {
  designPoints: DesignPoint[]
  asBuiltPoints: AsBuiltPoint[]
  /** Horizontal tolerance in meters (default: 0.025 = 25mm, RDM 1.1 Table 5.2) */
  toleranceH?: number
  /** Vertical tolerance in meters (default: 0.015 = 15mm, RDM 1.1 Table 5.2) */
  toleranceV?: number
  /** Max distance for proximity matching in meters (default: 5.0) */
  proximityMaxM?: number
}

// ─── Main Function ──────────────────────────────────────────────────────────

/**
 * Compare as-built field shots to design points and flag anything outside
 * tolerance.
 *
 * Matching strategy:
 *   1. If as-built point has an ID that matches a design point ID → match by ID
 *   2. Otherwise, find the nearest design point within proximityMaxM → match by proximity
 *   3. If no match within proximity → unmatched
 *
 * @returns ComparisonReport with per-point results and overall verdict
 */
export function compareAsBuiltToDesign(input: ComparisonInput): ComparisonReport {
  const {
    designPoints,
    asBuiltPoints,
    toleranceH = 0.025,  // ±25mm per RDM 1.1 Table 5.2 (structures, buildings)
    toleranceV = 0.015,  // ±15mm
    proximityMaxM = 5.0,
  } = input

  const rows: ComparisonRow[] = []
  const matchedDesignIds = new Set<string>()
  const matchedAsBuiltIndices = new Set<number>()

  // Build a map of design points by ID for fast lookup
  const designById = new Map<string, DesignPoint>()
  for (const dp of designPoints) {
    designById.set(dp.id, dp)
  }

  // ─── Pass 1: Match by ID ───
  for (let i = 0; i < asBuiltPoints.length; i++) {
    if (matchedAsBuiltIndices.has(i)) continue
    const ab = asBuiltPoints[i]

    if (ab.id) {
      const dp = designById.get(ab.id)
      if (dp && !matchedDesignIds.has(dp.id)) {
        const row = computeRow(dp, ab, 'id', toleranceH, toleranceV)
        rows.push(row)
        matchedDesignIds.add(dp.id)
        matchedAsBuiltIndices.add(i)
      }
    }
  }

  // ─── Pass 2: Match by proximity ───
  for (let i = 0; i < asBuiltPoints.length; i++) {
    if (matchedAsBuiltIndices.has(i)) continue
    const ab = asBuiltPoints[i]

    let nearestDesign: DesignPoint | null = null
    let nearestDist = Infinity

    for (const dp of designPoints) {
      if (matchedDesignIds.has(dp.id)) continue
      const dist = Math.sqrt((dp.e - ab.e) ** 2 + (dp.n - ab.n) ** 2)
      if (dist < nearestDist && dist <= proximityMaxM) {
        nearestDist = dist
        nearestDesign = dp
      }
    }

    if (nearestDesign) {
      const row = computeRow(nearestDesign, ab, 'proximity', toleranceH, toleranceV)
      rows.push(row)
      matchedDesignIds.add(nearestDesign.id)
      matchedAsBuiltIndices.add(i)
    }
  }

  // ─── Unmatched ───
  const unmatchedDesignPoints = designPoints.filter(dp => !matchedDesignIds.has(dp.id))
  const unmatchedAsBuiltPoints = asBuiltPoints.filter((_, i) => !matchedAsBuiltIndices.has(i))

  // ─── Summary ───
  const passedPoints = rows.filter(r => r.passed)
  const failedPoints = rows.filter(r => !r.passed)

  let verdict: 'PASS' | 'FAIL' | 'INCOMPLETE'
  let summary: string

  if (rows.length === 0) {
    verdict = 'INCOMPLETE'
    summary = 'No points matched. Check that as-built point IDs match design IDs, or capture shots within 5m of design points.'
  } else if (failedPoints.length > 0) {
    verdict = 'FAIL'
    summary = `${failedPoints.length} of ${rows.length} points FAIL tolerance (${(toleranceH * 1000).toFixed(0)}mm H / ${(toleranceV * 1000).toFixed(0)}mm V). ${failedPoints.map(p => p.designId).join(', ')} — re-stake before leaving site.`
  } else if (unmatchedDesignPoints.length > 0) {
    verdict = 'INCOMPLETE'
    summary = `${passedPoints.length}/${rows.length} matched points PASS. ${unmatchedDesignPoints.length} design points not yet staked. Continue staking remaining points.`
  } else {
    verdict = 'PASS'
    summary = `All ${passedPoints.length} points within tolerance (±${(toleranceH * 1000).toFixed(0)}mm H / ±${(toleranceV * 1000).toFixed(0)}mm V). Safe to leave site.`
  }

  return {
    rows,
    passedPoints,
    failedPoints,
    unmatchedDesignPoints,
    unmatchedAsBuiltPoints,
    totalDesignPoints: designPoints.length,
    totalAsBuiltPoints: asBuiltPoints.length,
    totalMatched: rows.length,
    totalPassed: passedPoints.length,
    totalFailed: failedPoints.length,
    verdict,
    summary,
    toleranceH,
    toleranceV,
    timestamp: new Date().toISOString(),
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeRow(
  design: DesignPoint,
  asBuilt: AsBuiltPoint,
  matchedBy: 'id' | 'proximity',
  toleranceH: number,
  toleranceV: number,
): ComparisonRow {
  const deltaE = asBuilt.e - design.e
  const deltaN = asBuilt.n - design.n
  const deltaRL = asBuilt.rl !== undefined ? asBuilt.rl - design.rl : null
  const horizontalOffset = Math.sqrt(deltaE ** 2 + deltaN ** 2)

  const hStatus: 'PASS' | 'FAIL' = horizontalOffset <= toleranceH ? 'PASS' : 'FAIL'
  const vStatus: 'PASS' | 'FAIL' | 'N/A' = deltaRL === null ? 'N/A' : Math.abs(deltaRL) <= toleranceV ? 'PASS' : 'FAIL'
  const passed = hStatus === 'PASS' && (vStatus === 'PASS' || vStatus === 'N/A')

  return {
    designId: design.id,
    asBuiltId: asBuilt.id,
    designE: design.e,
    designN: design.n,
    designRL: design.rl,
    asBuiltE: asBuilt.e,
    asBuiltN: asBuilt.n,
    asBuiltRL: asBuilt.rl ?? null,
    deltaE,
    deltaN,
    deltaRL,
    horizontalOffset,
    hStatus,
    vStatus,
    passed,
    matchedBy,
  }
}

// ─── Display Helpers ────────────────────────────────────────────────────────

/**
 * Format a comparison row for display in a table.
 */
export function formatRowForDisplay(row: ComparisonRow): {
  id: string
  dE: string
  dN: string
  dH: string
  hOffset: string
  status: string
  statusColor: string
} {
  const passColor = 'green'
  const failColor = 'red'
  const naColor = 'gray'

  return {
    id: row.designId,
    dE: `${(row.deltaE * 1000).toFixed(1)}mm`,
    dN: `${(row.deltaN * 1000).toFixed(1)}mm`,
    dH: row.deltaRL !== null ? `${(row.deltaRL * 1000).toFixed(1)}mm` : '—',
    hOffset: `${(row.horizontalOffset * 1000).toFixed(1)}mm`,
    status: row.passed ? '✓ PASS' : '✗ FAIL',
    statusColor: row.passed ? passColor : failColor,
  }
}

/**
 * Get the verdict color for the report summary.
 */
export function getVerdictColor(verdict: 'PASS' | 'FAIL' | 'INCOMPLETE'): string {
  switch (verdict) {
    case 'PASS': return 'green'
    case 'FAIL': return 'red'
    case 'INCOMPLETE': return 'yellow'
    default: return 'gray'
  }
}

/**
 * Get the verdict icon.
 */
export function getVerdictIcon(verdict: 'PASS' | 'FAIL' | 'INCOMPLETE'): string {
  switch (verdict) {
    case 'PASS': return '✓'
    case 'FAIL': return '✗'
    case 'INCOMPLETE': return '!'
    default: return '?'
  }
}
