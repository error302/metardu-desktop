/**
 * As-Built Deviation Guard — v0.3
 *
 * Compares as-built survey points against design elevations along a road
 * alignment. Flags deviations with green/amber/red based on KeNHA tolerances.
 *
 * Uses linear referencing: for each as-built point at a given chainage,
 * interpolates the design elevation at that chainage and computes ΔZ.
 *
 * KeNHA tolerance bands (RDM 1.1 / Road Design Manual):
 *   Subbase: ±10mm
 *   Base course: ±5mm
 *   Concrete pavement: ±5mm
 *   Bituminous: ±5mm
 *   Earthworks: ±20mm
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type DeviationStatus = 'pass' | 'marginal' | 'fail'

export interface DesignStation {
  /** Chainage in metres */
  chainage: number
  /** Design elevation (reduced level) in metres */
  elevation: number
}

export interface AsBuiltPoint {
  id: string
  /** Chainage in metres */
  chainage: number
  /** Measured (as-built) elevation in metres */
  elevation: number
  /** Optional: offset from centerline (metres, negative=left, positive=right) */
  offset?: number
  /** Optional: description (e.g., "left edge", "centreline") */
  description?: string
}

export interface DeviationResult {
  pointId: string
  chainage: number
  asBuiltElevation: number
  designElevation: number
  /** ΔZ = as-built - design (positive = too high, negative = too low) */
  deltaZ: number
  /** Absolute deviation in mm */
  deviationMm: number
  status: DeviationStatus
  offset?: number
  description?: string
}

export interface DeviationReport {
  results: DeviationResult[]
  stats: {
    total: number
    pass: number
    marginal: number
    fail: number
    maxDeviationMm: number
    avgDeviationMm: number
    passRate: number // percentage
  }
  tolerance: ToleranceBand
}

export interface ToleranceBand {
  label: string
  /** Maximum allowable deviation in mm (absolute) */
  passLimit: number
  /** Marginal zone: between passLimit and marginalLimit */
  marginalLimit: number
}

// ─── KeNHA tolerance presets ────────────────────────────────────────────────

export const KENHA_TOLERANCES: ToleranceBand[] = [
  { label: 'Earthworks (±20mm)', passLimit: 20, marginalLimit: 25 },
  { label: 'Subbase (±10mm)', passLimit: 10, marginalLimit: 15 },
  { label: 'Base course (±5mm)', passLimit: 5, marginalLimit: 8 },
  { label: 'Concrete pavement (±5mm)', passLimit: 5, marginalLimit: 8 },
  { label: 'Bituminous surface (±5mm)', passLimit: 5, marginalLimit: 8 },
  { label: 'Custom', passLimit: 10, marginalLimit: 15 },
]

// ─── Linear referencing: interpolate design elevation at any chainage ───────

/**
 * Interpolate design elevation at a given chainage using linear interpolation
 * between the two nearest design stations.
 *
 * If chainage is before the first station or after the last, extrapolates
 * using the nearest segment's gradient.
 */
export function interpolateDesignElevation(
  designStations: DesignStation[],
  chainage: number,
): number | null {
  if (designStations.length === 0) return null
  if (designStations.length === 1) return designStations[0].elevation

  // Sort by chainage
  const sorted = [...designStations].sort((a, b) => a.chainage - b.chainage)

  // Before first station — extrapolate
  if (chainage <= sorted[0].chainage) {
    const s0 = sorted[0]
    const s1 = sorted[1]
    const gradient = (s1.elevation - s0.elevation) / (s1.chainage - s0.chainage)
    return s0.elevation + gradient * (chainage - s0.chainage)
  }

  // After last station — extrapolate
  if (chainage >= sorted[sorted.length - 1].chainage) {
    const sn = sorted[sorted.length - 1]
    const sn1 = sorted[sorted.length - 2]
    const gradient = (sn.elevation - sn1.elevation) / (sn.chainage - sn1.chainage)
    return sn.elevation + gradient * (chainage - sn.chainage)
  }

  // Between two stations — interpolate
  for (let i = 0; i < sorted.length - 1; i++) {
    const s0 = sorted[i]
    const s1 = sorted[i + 1]
    if (chainage >= s0.chainage && chainage <= s1.chainage) {
      const t = (chainage - s0.chainage) / (s1.chainage - s0.chainage)
      return s0.elevation + t * (s1.elevation - s0.elevation)
    }
  }

  return null // should not reach here
}

// ─── Main deviation check ───────────────────────────────────────────────────

/**
 * Compare as-built points against design elevations and flag deviations.
 *
 * @param designStations Design centerline stations (chainage + elevation)
 * @param asBuiltPoints Surveyed as-built points
 * @param tolerance KeNHA tolerance band
 * @returns Deviation report with per-point results and summary stats
 */
export function checkDeviations(
  designStations: DesignStation[],
  asBuiltPoints: AsBuiltPoint[],
  tolerance: ToleranceBand,
): DeviationReport {
  const results: DeviationResult[] = []

  for (const point of asBuiltPoints) {
    const designElevation = interpolateDesignElevation(designStations, point.chainage)

    if (designElevation === null) {
      // Can't compute — skip or flag as fail
      results.push({
        pointId: point.id,
        chainage: point.chainage,
        asBuiltElevation: point.elevation,
        designElevation: 0,
        deltaZ: 0,
        deviationMm: 0,
        status: 'fail',
        offset: point.offset,
        description: 'No design data — cannot check',
      })
      continue
    }

    const deltaZ = point.elevation - designElevation
    const deviationMm = Math.abs(deltaZ) * 1000

    let status: DeviationStatus
    if (deviationMm <= tolerance.passLimit) {
      status = 'pass'
    } else if (deviationMm <= tolerance.marginalLimit) {
      status = 'marginal'
    } else {
      status = 'fail'
    }

    results.push({
      pointId: point.id,
      chainage: point.chainage,
      asBuiltElevation: point.elevation,
      designElevation,
      deltaZ,
      deviationMm,
      status,
      offset: point.offset,
      description: point.description,
    })
  }

  // Compute stats
  const pass = results.filter(r => r.status === 'pass').length
  const marginal = results.filter(r => r.status === 'marginal').length
  const fail = results.filter(r => r.status === 'fail').length
  const maxDeviationMm = Math.max(0, ...results.map(r => r.deviationMm))
  const avgDeviationMm = results.length > 0
    ? results.reduce((sum, r) => sum + r.deviationMm, 0) / results.length
    : 0

  return {
    results,
    stats: {
      total: results.length,
      pass,
      marginal,
      fail,
      maxDeviationMm,
      avgDeviationMm,
      passRate: results.length > 0 ? (pass / results.length) * 100 : 0,
    },
    tolerance,
  }
}

// ─── Status colors (for UI) ─────────────────────────────────────────────────

export function getStatusColor(status: DeviationStatus): string {
  switch (status) {
    case 'pass': return 'var(--success)'
    case 'marginal': return 'var(--warning)'
    case 'fail': return 'var(--error)'
  }
}

export function getStatusLabel(status: DeviationStatus): string {
  switch (status) {
    case 'pass': return 'PASS'
    case 'marginal': return 'MARGINAL'
    case 'fail': return 'FAIL'
  }
}
