/**
 * Deformation Monitoring Engine — repeat-epoch comparison + alerting
 *
 * THE PROBLEM
 * -----------
 * For dam monitoring, landslide monitoring, and repeat-epoch boundary work,
 * a surveyor needs to compare coordinates from different observation epochs
 * and determine whether a monument has ACTUALLY MOVED — vs. just drifted
 * due to tectonic plate motion or measurement noise.
 *
 * Doing this by hand in Excel across months of readings is exactly the kind
 * of tedious, error-prone work an engineer will pay to never do again. This
 * module automates it.
 *
 * WHAT IT DOES
 * ------------
 * 1. Takes two (or more) adjustment results from different epochs
 * 2. Propagates both to a common epoch (using the epoch manager — plate
 *    velocity propagation) so tectonic drift is removed
 * 3. Computes the deformation vector (dE, dN, dH) per monument
 * 4. Runs a statistical significance test (is the movement real, or just
 *    measurement noise at the monument's accuracy level?)
 * 5. Flags monuments that have moved beyond the project's tolerance
 * 6. Produces a time-series analysis (trend, velocity, acceleration) when
 *    multiple epochs are available
 *
 * USAGE
 * -----
 *   import { compareEpochs, analyzeTimeSeries } from '@/lib/survey/deformationMonitoring'
 *
 *   const report = compareEpochs({
 *     baseline: { epoch: 2024.0, monuments: [...] },
 *     current: { epoch: 2025.5, monuments: [...] },
 *     tolerance: { horizontal: 0.005, vertical: 0.003 }, // 5mm H, 3mm V
 *     confidenceLevel: 0.95,
 *   })
 *
 *   if (report.alerts.length > 0) {
 *     // "Monument DM-07 has moved 8.2mm north (exceeds 5mm tolerance)."
 *   }
 */

import {
  propagateToEpoch,
  type EpochCoordinate,
  type ReferenceFrame,
} from '@/lib/geo/epochManager'
import { propagateToEpochRigorous } from '@/lib/geo/epochManagerRigorous'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MonumentObservation {
  /** Monument ID (e.g., 'DM-07' for Dam Monument 7) */
  monumentId: string
  /** Latitude (WGS84 degrees) */
  latitude: number
  /** Longitude (WGS84 degrees) */
  longitude: number
  /** Ellipsoidal height (meters) */
  height: number
  /** Reference frame */
  frame: ReferenceFrame
  /** Decimal year epoch (e.g., 2024.5 = July 2024) */
  epoch: number
  /** Standard deviation in East (meters) */
  sigmaE?: number
  /** Standard deviation in North (meters) */
  sigmaN?: number
  /** Standard deviation in Height (meters) */
  sigmaH?: number
  /** Covariance E-N (meters²) */
  sigmaEN?: number
}

export interface EpochSet {
  /** Epoch label (e.g., 'Baseline 2024-01', 'Q2 2025') */
  label: string
  /** Decimal year */
  epoch: number
  /** Monument observations for this epoch */
  monuments: MonumentObservation[]
}

export interface DeformationVector {
  monumentId: string
  /** Displacement East (meters) — positive = eastward movement */
  deltaE: number
  /** Displacement North (meters) — positive = northward movement */
  deltaN: number
  /** Displacement Up (meters) — positive = uplift */
  deltaH: number
  /** Horizontal displacement magnitude (meters) */
  horizontalDisplacement: number
  /** Bearing of movement (degrees, 0=N, 90=E) */
  bearing: number
  /** Whether the movement is statistically significant */
  isSignificant: boolean
  /** Whether the movement exceeds the tolerance */
  exceedsTolerance: boolean
  /** The statistical test result (if sigma values were available) */
  significance?: {
    testStatistic: number
    criticalValue: number
    passed: boolean
    interpretation: string
  }
}

export interface DeformationTolerance {
  /** Horizontal movement tolerance (meters). Default: 0.005 (5mm) */
  horizontal?: number
  /** Vertical movement tolerance (meters). Default: 0.003 (3mm) */
  vertical?: number
}

export interface DeformationAlert {
  monumentId: string
  severity: 'info' | 'warning' | 'critical'
  message: string
  /** Movement magnitude in mm */
  magnitudeMm: number
  /** Direction of movement */
  direction: string
}

export interface DeformationReport {
  /** Per-monument deformation vectors */
  vectors: DeformationVector[]

  /** Monuments that have moved beyond tolerance */
  alerts: DeformationAlert[]

  /** Monuments that are stable (within tolerance) */
  stable: string[]

  /** Monuments present in baseline but missing in current epoch */
  missingMonuments: string[]

  /** Monuments present in current but not in baseline (new monuments) */
  newMonuments: string[]

  /** Epochs compared */
  baselineEpoch: number
  currentEpoch: number
  commonEpoch: number

  /** Tolerances used */
  tolerance: Required<DeformationTolerance>

  /** Overall verdict */
  verdict: 'STABLE' | 'DEFORMING' | 'INCONCLUSIVE'
  /** Human-readable summary */
  summary: string

  /** Timestamp */
  timestamp: string
}

// ─── Time-Series Types ──────────────────────────────────────────────────────

export interface TimeSeriesPoint {
  epoch: number
  /** Position at this epoch (after propagation to common frame) */
  latitude: number
  longitude: number
  height: number
  /** Displacement from the first epoch (meters) */
  deltaE: number
  deltaN: number
  deltaH: number
  horizontalDisplacement: number
}

export interface TimeSeriesAnalysis {
  monumentId: string
  /** All epochs in the series */
  points: TimeSeriesPoint[]

  /** Linear trend (velocity) — meters per year */
  velocityE: number
  velocityN: number
  velocityH: number
  velocityHorizontal: number
  velocityBearing: number

  /** Acceleration (change in velocity) — meters per year² */
  accelerationHorizontal: number

  /** Whether the trend is statistically significant */
  trendSignificant: boolean

  /** R² of the linear fit (0-1) */
  rSquared: number

  /** Projected position 1 year from the last epoch */
  projectedDeltaE: number
  projectedDeltaN: number
  projectedDeltaH: number
  projectedHorizontalDisplacement: number

  /** Whether the projected movement will exceed tolerance */
  projectedExceedsTolerance: boolean

  /** Interpretation for display */
  interpretation: string
}

// ─── Main: Compare Two Epochs ───────────────────────────────────────────────

/**
 * Compare monument positions between two epochs and detect deformation.
 *
 * This is the core function for dam/boundary monitoring. It:
 *   1. Matches monuments by ID between the two epochs
 *   2. Propagates both to a common epoch (removing tectonic plate drift)
 *   3. Computes the deformation vector per monument
 *   4. Runs a statistical significance test (if accuracy data available)
 *   5. Flags monuments that exceed tolerance
 *
 * @returns DeformationReport with per-monument vectors + alerts
 */
export function compareEpochs(
  baseline: EpochSet,
  current: EpochSet,
  tolerance: DeformationTolerance = {},
  confidenceLevel: number = 0.95,
): DeformationReport {
  const tolH = tolerance.horizontal ?? 0.005  // 5mm default
  const tolV = tolerance.vertical ?? 0.003    // 3mm default
  const commonEpoch = Math.max(baseline.epoch, current.epoch)

  // Build lookup maps
  const baselineMap = new Map<string, MonumentObservation>()
  for (const m of baseline.monuments) {
    baselineMap.set(m.monumentId, m)
  }

  const currentMap = new Map<string, MonumentObservation>()
  for (const m of current.monuments) {
    currentMap.set(m.monumentId, m)
  }

  // Find common, missing, and new monuments
  const commonIds = [...baselineMap.keys()].filter(id => currentMap.has(id))
  const missingIds = [...baselineMap.keys()].filter(id => !currentMap.has(id))
  const newIds = [...currentMap.keys()].filter(id => !baselineMap.has(id))

  const vectors: DeformationVector[] = []
  const alerts: DeformationAlert[] = []
  const stable: string[] = []

  for (const id of commonIds) {
    const baseMon = baselineMap.get(id)!
    const currMon = currentMap.get(id)!

    // Propagate both to the common epoch (remove tectonic drift)
    // Use the RIGOROUS Rodrigues' rotation formula (no linearization error)
    // — critical for dam monitoring where sub-mm precision is needed.
    const baseProp = propagateToEpochRigorous(
      {
        latitude: baseMon.latitude,
        longitude: baseMon.longitude,
        height: baseMon.height,
        frame: baseMon.frame,
        epoch: baseMon.epoch,
      },
      commonEpoch,
    )

    const currProp = propagateToEpochRigorous(
      {
        latitude: currMon.latitude,
        longitude: currMon.longitude,
        height: currMon.height,
        frame: currMon.frame,
        epoch: currMon.epoch,
      },
      commonEpoch,
    )

    // Compute deformation vector
    // Convert lat/lon differences to meters (local ENU approximation)
    const lat0 = baseProp.latitude * Math.PI / 180
    const cosLat = Math.cos(lat0)
    const R = 6371000 // Earth radius in meters

    const deltaLat = currProp.latitude - baseProp.latitude
    const deltaLon = currProp.longitude - baseProp.longitude
    const deltaH = currProp.height - baseProp.height

    const deltaN = deltaLat * R * Math.PI / 180
    const deltaE = deltaLon * R * Math.PI / 180 * cosLat
    const horizontalDisplacement = Math.sqrt(deltaE ** 2 + deltaN ** 2)
    const bearing = (Math.atan2(deltaE, deltaN) * 180 / Math.PI + 360) % 360

    // Statistical significance test (if sigma values available)
    let significance: DeformationVector['significance']
    let isSignificant = false

    if (baseMon.sigmaE !== undefined && currMon.sigmaE !== undefined &&
        baseMon.sigmaN !== undefined && currMon.sigmaN !== undefined) {
      // Combined standard deviation (error propagation: σ_diff = √(σ1² + σ2²))
      const sigmaE_combined = Math.sqrt(baseMon.sigmaE ** 2 + currMon.sigmaE ** 2)
      const sigmaN_combined = Math.sqrt(baseMon.sigmaN ** 2 + currMon.sigmaN ** 2)

      // Test statistic: horizontal displacement / combined sigma
      const sigmaH_combined = Math.sqrt(sigmaE_combined ** 2 + sigmaN_combined ** 2)
      const testStatistic = sigmaH_combined > 0 ? horizontalDisplacement / sigmaH_combined : 0

      // Critical value: for 2D, 95% confidence → 2.45 (chi-square 2D)
      const criticalValue = confidenceLevel === 0.99 ? 3.03 : 2.45
      isSignificant = testStatistic > criticalValue

      significance = {
        testStatistic,
        criticalValue,
        passed: !isSignificant,
        interpretation: isSignificant
          ? `Movement is statistically significant at ${(confidenceLevel * 100).toFixed(0)}% confidence (test stat ${testStatistic.toFixed(2)} > ${criticalValue}). This is real movement, not measurement noise.`
          : `Movement is NOT statistically significant at ${(confidenceLevel * 100).toFixed(0)}% confidence (test stat ${testStatistic.toFixed(2)} ≤ ${criticalValue}). Likely measurement noise.`,
      }
    }

    const exceedsTolerance = horizontalDisplacement > tolH || Math.abs(deltaH) > tolV

    const vector: DeformationVector = {
      monumentId: id,
      deltaE,
      deltaN,
      deltaH,
      horizontalDisplacement,
      bearing,
      isSignificant,
      exceedsTolerance,
      significance,
    }
    vectors.push(vector)

    // Generate alert if exceeds tolerance AND is significant (or no sigma data)
    if (exceedsTolerance && (isSignificant || !significance)) {
      const severity = horizontalDisplacement > tolH * 3 || Math.abs(deltaH) > tolV * 3
        ? 'critical'
        : 'warning'

      const directionStr = formatBearing(bearing)
      const magMm = horizontalDisplacement * 1000

      alerts.push({
        monumentId: id,
        severity,
        message: `${id} has moved ${magMm.toFixed(1)}mm ${directionStr}` +
          (Math.abs(deltaH) > tolV ? ` and ${(deltaH * 1000).toFixed(1)}mm ${deltaH > 0 ? 'up' : 'down'}` : '') +
          ` (tolerance: ${tolH * 1000}mm H / ${tolV * 1000}mm V).` +
          (significance ? ` ${significance.interpretation}` : ''),
        magnitudeMm: magMm,
        direction: directionStr,
      })
    } else {
      stable.push(id)
    }
  }

  // Overall verdict
  let verdict: 'STABLE' | 'DEFORMING' | 'INCONCLUSIVE'
  let summary: string

  if (vectors.length === 0) {
    verdict = 'INCONCLUSIVE'
    summary = 'No common monuments between epochs. Cannot compare.'
  } else if (alerts.length === 0) {
    verdict = 'STABLE'
    summary = `All ${stable.length} monuments stable within tolerance (±${tolH * 1000}mm H / ±${tolV * 1000}mm V) between ${baseline.label} and ${current.label}.`
  } else {
    verdict = 'DEFORMING'
    const criticalCount = alerts.filter(a => a.severity === 'critical').length
    summary = `${alerts.length} monument(s) exceeded tolerance between ${baseline.label} and ${current.label}.` +
      (criticalCount > 0 ? ` ${criticalCount} CRITICAL.` : '') +
      ` Affected: ${alerts.map(a => a.monumentId).join(', ')}.`
  }

  return {
    vectors,
    alerts,
    stable,
    missingMonuments: missingIds,
    newMonuments: newIds,
    baselineEpoch: baseline.epoch,
    currentEpoch: current.epoch,
    commonEpoch,
    tolerance: { horizontal: tolH, vertical: tolV },
    verdict,
    summary,
    timestamp: new Date().toISOString(),
  }
}

// ─── Time-Series Analysis ───────────────────────────────────────────────────

/**
 * Analyze a time series of monument positions across multiple epochs.
 *
 * Computes:
 *   - Linear trend (velocity) in E, N, H — meters per year
 *   - Acceleration (change in velocity)
 *   - R² goodness of fit
 *   - 1-year projection
 *   - Whether the projection exceeds tolerance
 *
 * @param epochs - Array of EpochSets (at least 2, ideally 3+ for trend)
 * @param monumentId - Which monument to analyze
 * @param tolerance - Movement tolerance for projection check
 */
export function analyzeTimeSeries(
  epochs: EpochSet[],
  monumentId: string,
  tolerance: DeformationTolerance = {},
): TimeSeriesAnalysis {
  const tolH = tolerance.horizontal ?? 0.005
  const tolV = tolerance.vertical ?? 0.003

  // Collect all observations of this monument across epochs
  const observations: TimeSeriesPoint[] = []
  let firstObs: { lat: number; lon: number; h: number } | null = null

  // Sort epochs chronologically
  const sortedEpochs = [...epochs].sort((a, b) => a.epoch - b.epoch)

  for (const epochSet of sortedEpochs) {
    const mon = epochSet.monuments.find(m => m.monumentId === monumentId)
    if (!mon) continue

    // Propagate to a common reference (the first epoch)
    if (!firstObs) {
      firstObs = { lat: mon.latitude, lon: mon.longitude, h: mon.height }
    }

    const commonEpoch = sortedEpochs[0].epoch
    const prop = propagateToEpochRigorous(
      {
        latitude: mon.latitude,
        longitude: mon.longitude,
        height: mon.height,
        frame: mon.frame,
        epoch: mon.epoch,
      },
      commonEpoch,
    )

    // Compute displacement from first observation
    const lat0 = firstObs.lat * Math.PI / 180
    const cosLat = Math.cos(lat0)
    const R = 6371000

    const deltaLat = prop.latitude - firstObs.lat
    const deltaLon = prop.longitude - firstObs.lon
    const deltaH = prop.height - firstObs.h

    const deltaN = deltaLat * R * Math.PI / 180
    const deltaE = deltaLon * R * Math.PI / 180 * cosLat
    const horizontalDisplacement = Math.sqrt(deltaE ** 2 + deltaN ** 2)

    observations.push({
      epoch: mon.epoch,
      latitude: prop.latitude,
      longitude: prop.longitude,
      height: prop.height,
      deltaE,
      deltaN,
      deltaH,
      horizontalDisplacement,
    })
  }

  if (observations.length < 2) {
    return {
      monumentId,
      points: observations,
      velocityE: 0,
      velocityN: 0,
      velocityH: 0,
      velocityHorizontal: 0,
      velocityBearing: 0,
      accelerationHorizontal: 0,
      trendSignificant: false,
      rSquared: 0,
      projectedDeltaE: 0,
      projectedDeltaN: 0,
      projectedDeltaH: 0,
      projectedHorizontalDisplacement: 0,
      projectedExceedsTolerance: false,
      interpretation: 'Insufficient data for trend analysis (need ≥2 epochs).',
    }
  }

  // Linear regression: displacement vs time
  // y = a + b×t, where t = epoch, y = displacement
  const t0 = observations[0].epoch
  const tValues = observations.map(o => o.epoch - t0) // years from first epoch
  const eValues = observations.map(o => o.deltaE)
  const nValues = observations.map(o => o.deltaN)
  const hValues = observations.map(o => o.deltaH)
  const hDispValues = observations.map(o => o.horizontalDisplacement)

  const { slope: velE, r2: r2E } = linearRegression(tValues, eValues)
  const { slope: velN, r2: r2N } = linearRegression(tValues, nValues)
  const { slope: velH, r2: r2H } = linearRegression(tValues, hValues)
  const { slope: velHdisp, r2: r2Hdisp } = linearRegression(tValues, hDispValues)

  const velocityHorizontal = Math.sqrt(velE ** 2 + velN ** 2)
  const velocityBearing = (Math.atan2(velE, velN) * 180 / Math.PI + 360) % 360

  // Acceleration: difference in velocity between first and second half
  let accelerationHorizontal = 0
  if (observations.length >= 4) {
    const midIdx = Math.floor(observations.length / 2)
    const firstHalf = observations.slice(0, midIdx + 1)
    const secondHalf = observations.slice(midIdx)

    const t1 = firstHalf.map(o => o.epoch - t0)
    const h1 = firstHalf.map(o => o.horizontalDisplacement)
    const t2 = secondHalf.map(o => o.epoch - t0)
    const h2 = secondHalf.map(o => o.horizontalDisplacement)

    const vel1 = linearRegression(t1, h1).slope
    const vel2 = linearRegression(t2, h2).slope

    const dt = (secondHalf[secondHalf.length - 1].epoch - firstHalf[0].epoch) / 2
    if (dt > 0) {
      accelerationHorizontal = (vel2 - vel1) / dt
    }
  }

  // R² for horizontal displacement
  const rSquared = r2Hdisp

  // Trend significance: R² > 0.7 AND velocity > tolerance/year
  const trendSignificant = rSquared > 0.7 && velocityHorizontal > tolH

  // Project 1 year from last epoch
  const lastT = tValues[tValues.length - 1]
  const projectedT = lastT + 1.0
  const projectedDeltaE = velE * projectedT
  const projectedDeltaN = velN * projectedT
  const projectedDeltaH = velH * projectedT
  const projectedHorizontalDisplacement = Math.sqrt(projectedDeltaE ** 2 + projectedDeltaN ** 2)
  const projectedExceedsTolerance = projectedHorizontalDisplacement > tolH || Math.abs(projectedDeltaH) > tolV

  // Interpretation
  let interpretation: string
  if (velocityHorizontal < tolH) {
    interpretation = `Stable: velocity ${(velocityHorizontal * 1000).toFixed(1)}mm/yr is within tolerance. No action needed.`
  } else if (trendSignificant) {
    interpretation = `DEFORMING: velocity ${(velocityHorizontal * 1000).toFixed(1)}mm/yr ${formatBearing(velocityBearing)} (R²=${rSquared.toFixed(2)}).` +
      (projectedExceedsTolerance ? ` Projected to exceed tolerance within 1 year. Investigate.` : ` Trend is significant but projection is within tolerance.`)
  } else {
    interpretation = `Marginal: velocity ${(velocityHorizontal * 1000).toFixed(1)}mm/yr but R²=${rSquared.toFixed(2)} indicates high variability. More epochs needed to confirm trend.`
  }

  return {
    monumentId,
    points: observations,
    velocityE: velE,
    velocityN: velN,
    velocityH: velH,
    velocityHorizontal,
    velocityBearing,
    accelerationHorizontal,
    trendSignificant,
    rSquared,
    projectedDeltaE,
    projectedDeltaN,
    projectedDeltaH,
    projectedHorizontalDisplacement,
    projectedExceedsTolerance,
    interpretation,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Simple linear regression: y = a + b×x
 * Returns slope (b), intercept (a), and R².
 */
function linearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
  const n = x.length
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 }

  const sumX = x.reduce((s, v) => s + v, 0)
  const sumY = y.reduce((s, v) => s + v, 0)
  const sumXY = x.reduce((s, v, i) => s + v * y[i], 0)
  const sumX2 = x.reduce((s, v) => s + v * v, 0)
  const sumY2 = y.reduce((s, v) => s + v * v, 0)

  const denom = n * sumX2 - sumX * sumX
  if (Math.abs(denom) < 1e-12) return { slope: 0, intercept: y[0], r2: 0 }

  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n

  // R²
  const meanY = sumY / n
  const ssTot = y.reduce((s, v) => s + (v - meanY) ** 2, 0)
  const ssRes = y.reduce((s, v, i) => s + (v - (intercept + slope * x[i])) ** 2, 0)
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0

  return { slope, intercept, r2 }
}

/**
 * Format a bearing in degrees as a compass direction.
 * e.g., 45° → "NE", 180° → "S", 270° → "W"
 */
function formatBearing(bearing: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const idx = Math.round(bearing / 22.5) % 16
  return `${dirs[idx]} (${bearing.toFixed(1)}°)`
}

// ─── Display Helpers ────────────────────────────────────────────────────────

/**
 * Get the verdict color for deformation status.
 */
export function getDeformationVerdictColor(verdict: 'STABLE' | 'DEFORMING' | 'INCONCLUSIVE'): string {
  switch (verdict) {
    case 'STABLE': return 'green'
    case 'DEFORMING': return 'red'
    case 'INCONCLUSIVE': return 'yellow'
    default: return 'gray'
  }
}

/**
 * Get the alert severity color.
 */
export function getAlertSeverityColor(severity: 'info' | 'warning' | 'critical'): string {
  switch (severity) {
    case 'info': return 'blue'
    case 'warning': return 'yellow'
    case 'critical': return 'red'
    default: return 'gray'
  }
}

/**
 * Format a deformation vector for display.
 */
export function formatDeformationVector(v: DeformationVector): string {
  const parts: string[] = []
  parts.push(`dE=${(v.deltaE * 1000).toFixed(1)}mm`)
  parts.push(`dN=${(v.deltaN * 1000).toFixed(1)}mm`)
  if (v.deltaH !== 0) {
    parts.push(`dH=${(v.deltaH * 1000).toFixed(1)}mm`)
  }
  parts.push(`|H|=${(v.horizontalDisplacement * 1000).toFixed(1)}mm`)
  parts.push(formatBearing(v.bearing))
  if (v.significance) {
    parts.push(v.isSignificant ? 'SIGNIFICANT' : 'not significant')
  }
  if (v.exceedsTolerance) {
    parts.push('⚠ EXCEEDS TOLERANCE')
  }
  return parts.join('  ')
}
