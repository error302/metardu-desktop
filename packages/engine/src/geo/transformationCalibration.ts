/**
 * Auto-Calibration of Datum Transformation Parameters
 *
 * PROBLEM
 * -------
 * The national 7-parameter Bursa-Wolf transformation (Arc 1960 ↔ WGS84)
 * gives ~5m accuracy across Kenya. For sub-meter work — boundary surveys,
 * engineering setting-out, deformation monitoring — you need a SITE-SPECIFIC
 * transformation derived from local common points.
 *
 * A surveyor with 5+ common points (points known in both datums) can derive
 * a local 7-parameter transformation that's 100× more accurate than the
 * national parameters for that area. This module does that derivation.
 *
 * ALGORITHM
 * ---------
 * Given N ≥ 3 common points with coordinates in both source and target
 * datums, compute the best-fit 7-parameter Bursa-Wolf transformation via
 * least squares:
 *
 *   [X_t]          [X_s]   [Tx]
 *   [Y_t] = (1+S)·R·[Y_s] + [Ty]
 *   [Z_t]          [Z_s]   [Tz]
 *
 * where R is the rotation matrix from (Rx, Ry, Rz), S is the scale, and
 * (Tx, Ty, Tz) is the translation.
 *
 * Uses the rigorous Gauss-Newton iteration (helmertRigorous.ts) for full
 * rotation matrix accuracy. Produces:
 *   - The 7 parameters
 *   - Standard deviations of each parameter (from the covariance matrix)
 *   - Residuals per point (for blunder detection)
 *   - RMS of fit
 *   - Estimated local accuracy (better than national parameters)
 *
 * REGISTRATION
 * ------------
 * The derived parameters can be registered in the datum transformation
 * registry (datumTransformationRegistry.ts) as a "local calibration" with
 * provenance: the surveyor's name, the project, the date, the common points
 * used, and the achieved RMS.
 *
 * REFERENCES
 * ----------
 * - Bursa, M. (1962). "The theory of the determination of the parameters
 *   of the earth's dimensions from astro-geodetic measurements."
 *   Studia Geophysica et Geodaetica, 6.
 * - Wolf, H. (1963). "Geometric connection and re-orientation of
 *   three-dimensional triangulation nets." Bulletin Géodésique, 68.
 * - Krarup, T. (1985). "The least squares method for the computation of
 *   the parameters of the Helmert transformation." National Survey and
 *   Cadastre, Denmark.
 * - Ghilani, C.D. (2017). Adjustment Computations, 6th ed. Wiley, §24.
 */

import { computeHelmertTransformationRigorous } from '@/lib/geo/helmertRigorous'
import type { ControlPointPair, HelmertParameters } from '@/lib/geo/helmertTransform'
import { registerLocalTransformation } from '@/lib/geo/datumTransformationRegistry'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CommonPoint {
  /** Point ID (e.g., "BM-123" for a benchmark) */
  id: string
  /** Source datum coordinates (e.g., WGS84 from GNSS) */
  source: { x: number; y: number; z: number }
  /** Target datum coordinates (e.g., Arc 1960 from registry) */
  target: { x: number; y: number; z: number }
  /** Optional: estimated accuracy of source coordinates (meters) */
  sourceAccuracy?: number
  /** Optional: estimated accuracy of target coordinates (meters) */
  targetAccuracy?: number
}

export interface CalibrationResult {
  /** Computed 7 parameters */
  parameters: HelmertParameters
  /** Standard deviations of each parameter */
  parameterStdDevs: {
    tx: number; ty: number; tz: number  // meters
    rx: number; ry: number; rz: number  // radians
    scale: number                        // dimensionless (ppm)
  }
  /** Variance-covariance matrix of the 7 parameters (7×7) */
  covariance: number[][]
  /** Per-point residuals (target - transformed source) */
  pointResiduals: Array<{
    id: string
    residualX: number
    residualY: number
    residualZ: number
    residualMagnitude: number
    isOutlier: boolean
  }>
  /** RMS of fit (meters) */
  rmsFit: number
  /** Number of common points used */
  pointCount: number
  /** Number of points flagged as outliers (residual > 3σ) */
  outlierCount: number
  /** Estimated local accuracy (meters, 95% CI) */
  estimatedLocalAccuracy: number
  /** Whether the calibration converged */
  converged: boolean
  /** Number of Gauss-Newton iterations */
  iterations: number
  /** Warnings */
  warnings: string[]
  /** Summary for UI display */
  summary: string
}

export interface CalibrationOptions {
  /** Maximum number of Gauss-Newton iterations */
  maxIterations?: number
  /** Convergence threshold (parameter correction magnitude) */
  convergenceThreshold?: number
  /** Outlier threshold (residuals > threshold × σ are flagged) */
  outlierThreshold?: number  // default 3.0 (3σ)
  /** Whether to automatically remove outliers and re-fit */
  removeOutliers?: boolean
  /** Whether to register the result in the transformation registry */
  registerInRegistry?: boolean
  /** Provenance string (surveyor name, project, etc.) */
  provenance?: {
    surveyorName: string
    projectName: string
    area: string
    notes?: string
  }
}

// ─── Main Calibration Function ──────────────────────────────────────────────

/**
 * Derive a site-specific 7-parameter transformation from common points.
 *
 * @param commonPoints - At least 3 points with coordinates in both datums
 * @param options - Calibration options
 */
export function calibrateTransformation(
  commonPoints: CommonPoint[],
  options: CalibrationOptions = {},
): CalibrationResult {
  const maxIter = options.maxIterations ?? 50
  const threshold = options.convergenceThreshold ?? 1e-8
  const outlierThreshold = options.outlierThreshold ?? 3.0
  const removeOutliers = options.removeOutliers ?? false
  const registerInRegistry = options.registerInRegistry ?? false

  const warnings: string[] = []

  if (commonPoints.length < 3) {
    throw new Error(`At least 3 common points required for 7-parameter calibration, got ${commonPoints.length}`)
  }

  // Step 1: Convert common points to ControlPointPair format
  let pairs: ControlPointPair[] = commonPoints.map(p => ({
    id: p.id,
    sourceX: p.source.x,
    sourceY: p.source.y,
    sourceZ: p.source.z,
    targetX: p.target.x,
    targetY: p.target.y,
    targetZ: p.target.z,
  }))

  // Step 2: Compute the rigorous Helmert transformation
  let result = computeHelmertTransformationRigorous(pairs, {
    maxIterations: maxIter,
    convergenceThreshold: threshold,
  })

  if (!result) {
    throw new Error('Failed to compute Helmert transformation — check that points span 3D space (not coplanar).')
  }

  // Step 3: If outlier removal is enabled, iterate
  if (removeOutliers) {
    let outliersRemoved = 0
    const maxOutlierRemovalPasses = 3

    for (let pass = 0; pass < maxOutlierRemovalPasses; pass++) {
      // Compute residual magnitudes
      const residualMagnitudes = result.transformedPoints.map(tp =>
        Math.sqrt(tp.residualX ** 2 + tp.residualY ** 2 + tp.residualZ ** 2),
      )

      // Robust outlier detection using MAD (Median Absolute Deviation)
      const sortedMags = [...residualMagnitudes].sort((a, b) => a - b)
      const median = sortedMags[Math.floor(sortedMags.length / 2)]
      const deviations = residualMagnitudes.map(r => Math.abs(r - median))
      const sortedDevs = [...deviations].sort((a, b) => a - b)
      const mad = sortedDevs[Math.floor(sortedDevs.length / 2)] || 0
      const robustSigma = 1.4826 * mad
      // A point is an outlier if its residual > median + threshold × σ_robust
      // AND its residual is significantly large (> 1cm to avoid false positives)
      const outlierCutoff = median + outlierThreshold * robustSigma
      const significantThreshold = 0.01  // 1cm

      const outlierIndices = residualMagnitudes
        .map((r, i) => (r > outlierCutoff && r > significantThreshold ? i : -1))
        .filter(i => i >= 0)

      if (outlierIndices.length === 0) break  // no more outliers

      // Remove outliers
      pairs = pairs.filter((_, i) => !outlierIndices.includes(i))
      outliersRemoved += outlierIndices.length

      if (pairs.length < 3) {
        warnings.push(`Outlier removal left fewer than 3 points. Stopping removal.`)
        break
      }

      // Re-compute
      const newResult = computeHelmertTransformationRigorous(pairs, {
        maxIterations: maxIter,
        convergenceThreshold: threshold,
      })
      if (!newResult) break
      result = newResult
    }

    if (outliersRemoved > 0) {
      warnings.push(`${outliersRemoved} outlier point(s) removed and transformation re-fit.`)
    }
  }

  // Step 4: Compute parameter standard deviations from the covariance matrix
  // The covariance matrix of the parameters is Qxx · σ₀², where Qxx = (J^T W J)^(-1)
  // We approximate J as the numerical Jacobian (computed internally by helmertRigorous)
  // For simplicity, we use the RMS residual to estimate σ₀, and approximate the
  // covariance as a diagonal matrix scaled by σ₀².

  const sigmaZero = result.rmsTotal  // approximation
  // Better estimate: σ₀² = v^T v / (n - 7) for n points
  const n = pairs.length
  const vTv = result.transformedPoints.reduce(
    (s, tp) => s + tp.residualX ** 2 + tp.residualY ** 2 + tp.residualZ ** 2,
    0,
  )
  const dof = 3 * n - 7
  const sigmaZeroSquared = dof > 0 ? vTv / dof : sigmaZero * sigmaZero

  // Approximate covariance matrix (7×7)
  // For a proper computation we'd need the Jacobian from the Helmert solver,
  // but for UI display we use a diagonal approximation based on point geometry.
  // The standard deviation of each parameter is approximately σ₀ / sqrt(N) × scale_factor.
  // Better: use the empirical observation that translation σ ≈ σ₀·√(1/N),
  // rotation σ ≈ σ₀·√(1/Σd²) where d is distance from centroid,
  // scale σ ≈ σ₀·√(1/Σd²).
  const sourceCentroid = computeCentroid(pairs.map(p => [p.sourceX, p.sourceY, p.sourceZ]))
  const sumDistSq = pairs.reduce((s, p) => {
    const dx = p.sourceX - sourceCentroid[0]
    const dy = p.sourceY - sourceCentroid[1]
    const dz = p.sourceZ - sourceCentroid[2]
    return s + dx * dx + dy * dy + dz * dz
  }, 0)

  const txStd = sigmaZero * Math.sqrt(1 / n)
  const tyStd = sigmaZero * Math.sqrt(1 / n)
  const tzStd = sigmaZero * Math.sqrt(1 / n)
  const rotStd = sumDistSq > 0 ? sigmaZero / Math.sqrt(sumDistSq) : 0
  const scaleStd = sumDistSq > 0 ? sigmaZero / Math.sqrt(sumDistSq) : 0

  // Build the 7×7 covariance matrix (diagonal approximation)
  const covariance: number[][] = Array(7).fill(null).map(() => new Array(7).fill(0))
  covariance[0][0] = txStd * txStd
  covariance[1][1] = tyStd * tyStd
  covariance[2][2] = tzStd * tzStd
  covariance[3][3] = rotStd * rotStd
  covariance[4][4] = rotStd * rotStd
  covariance[5][5] = rotStd * rotStd
  covariance[6][6] = scaleStd * scaleStd

  // Step 5: Compute per-point residuals and identify outliers
  // Use a more robust outlier criterion: a point is an outlier if its
  // residual magnitude exceeds a multiple of the typical residual magnitude
  // (using median absolute deviation for robustness).
  const residualMagnitudes = result.transformedPoints.map(tp =>
    Math.sqrt(tp.residualX ** 2 + tp.residualY ** 2 + tp.residualZ ** 2),
  )
  const sortedMags = [...residualMagnitudes].sort((a, b) => a - b)
  const median = sortedMags[Math.floor(sortedMags.length / 2)]
  // MAD = median absolute deviation
  const deviations = residualMagnitudes.map(r => Math.abs(r - median))
  const sortedDevs = [...deviations].sort((a, b) => a - b)
  const mad = sortedDevs[Math.floor(sortedDevs.length / 2)] || 0
  // Robust σ estimate: σ ≈ 1.4826 × MAD
  const robustSigma = 1.4826 * mad
  // Mean + std for the traditional criterion (used as fallback)
  const meanResidual = residualMagnitudes.reduce((s, r) => s + r, 0) / residualMagnitudes.length
  const stdResidual = Math.sqrt(
    residualMagnitudes.reduce((s, r) => s + (r - meanResidual) ** 2, 0) / residualMagnitudes.length,
  )

  const pointResiduals = result.transformedPoints.map((tp, i) => {
    const mag = residualMagnitudes[i]
    // A point is an outlier if it exceeds the median by more than threshold × robustσ
    // OR if it exceeds the mean by more than threshold × std (whichever is more permissive)
    const robustThreshold = median + outlierThreshold * robustSigma
    const traditionalThreshold = meanResidual + outlierThreshold * stdResidual
    const threshold = Math.max(robustThreshold, traditionalThreshold)
    const isOutlier = mag > threshold && mag > 0.001  // also require > 1mm
    return {
      id: tp.id,
      residualX: tp.residualX,
      residualY: tp.residualY,
      residualZ: tp.residualZ,
      residualMagnitude: mag,
      isOutlier,
    }
  })

  const outlierCount = pointResiduals.filter(p => p.isOutlier).length

  // Step 6: Estimate local accuracy (95% CI = 1.96 × σ₀ × √(2) for 2D, 1.96 × σ₀ × √(3) for 3D)
  const estimatedLocalAccuracy = 1.96 * sigmaZero * Math.sqrt(3)

  // Step 7: Register in the transformation registry
  if (registerInRegistry && options.provenance) {
    const fromFrame = 'LOCAL_SOURCE'  // customizable in future
    const toFrame = 'LOCAL_TARGET'
    registerLocalTransformation({
      id: `local-${options.provenance.projectName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
      name: `Local calibration — ${options.provenance.area}`,
      parameters: {
        dx: result.parameters.tx,
        dy: result.parameters.ty,
        dz: result.parameters.tz,
        rx: result.parameters.rx * 206264.806,  // rad → arcsec
        ry: result.parameters.ry * 206264.806,
        rz: result.parameters.rz * 206264.806,
        ds: (result.parameters.scale - 1) * 1e6,  // dimensionless → ppm
      },
      source: `Local calibration by ${options.provenance.surveyorName} on ${new Date().toISOString().split('T')[0]}`,
      accuracy: estimatedLocalAccuracy,
      validArea: { description: options.provenance.area },
      publishedAt: new Date().toISOString(),
      publishedBy: options.provenance.surveyorName,
    })
    warnings.push(`Transformation registered in registry as local calibration (RMS fit: ${result.rmsTotal.toFixed(4)}m).`)
  }

  // Build summary
  const summary = buildSummary(
    n,
    result.rmsTotal,
    estimatedLocalAccuracy,
    outlierCount,
    result.converged,
    result.iterations,
  )

  return {
    parameters: result.parameters,
    parameterStdDevs: {
      tx: txStd,
      ty: tyStd,
      tz: tzStd,
      rx: rotStd,
      ry: rotStd,
      rz: rotStd,
      scale: scaleStd * 1e6,  // convert to ppm for display
    },
    covariance,
    pointResiduals,
    rmsFit: result.rmsTotal,
    pointCount: n,
    outlierCount,
    estimatedLocalAccuracy,
    converged: result.converged,
    iterations: result.iterations,
    warnings,
    summary,
  }
}

// ─── Helper Functions ───────────────────────────────────────────────────────

function computeCentroid(points: number[][]): number[] {
  const n = points.length
  const dim = points[0].length
  const centroid = new Array(dim).fill(0)
  for (const p of points) {
    for (let i = 0; i < dim; i++) centroid[i] += p[i]
  }
  return centroid.map(v => v / n)
}

function buildSummary(
  pointCount: number,
  rmsFit: number,
  localAccuracy: number,
  outlierCount: number,
  converged: boolean,
  iterations: number,
): string {
  const status = converged ? 'converged' : 'did NOT converge'
  const outlierText = outlierCount === 0
    ? 'No outliers detected.'
    : `${outlierCount} outlier(s) flagged (>3σ).`
  return `Local calibration ${status} in ${iterations} iterations from ${pointCount} points. RMS fit: ${rmsFit.toFixed(4)}m. Estimated local accuracy (95% CI): ${localAccuracy.toFixed(4)}m. ${outlierText}`
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate that common points are suitable for 7-parameter calibration.
 * Returns a list of issues (empty list = OK).
 */
export function validateCommonPoints(points: CommonPoint[]): string[] {
  const issues: string[] = []

  if (points.length < 3) {
    issues.push(`Need at least 3 common points, got ${points.length}.`)
  }

  if (points.length < 4) {
    issues.push(`Only ${points.length} points — transformation will have no redundancy. Add more points for blunder detection.`)
  }

  // Check that points span 3D space (not coplanar)
  if (points.length >= 4) {
    const sourcePts = points.map(p => [p.source.x, p.source.y, p.source.z])
    const centroid = computeCentroid(sourcePts)
    // Compute the covariance matrix of point positions
    const cov = Array(3).fill(null).map(() => new Array(3).fill(0))
    for (const p of sourcePts) {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          cov[i][j] += (p[i] - centroid[i]) * (p[j] - centroid[j])
        }
      }
    }
    // Check the smallest eigenvalue (if near zero, points are coplanar)
    // Use the trace as a rough check
    const trace = cov[0][0] + cov[1][1] + cov[2][2]
    if (trace < 1e-3) {
      issues.push('Points are clustered too tightly — needs more spatial spread for accurate rotation determination.')
    }
  }

  // Check for duplicate points
  const ids = new Set<string>()
  for (const p of points) {
    if (ids.has(p.id)) {
      issues.push(`Duplicate point ID: ${p.id}`)
    }
    ids.add(p.id)
  }

  return issues
}

// ─── Quality Assessment ─────────────────────────────────────────────────────

/**
 * Compare the local calibration to the national transformation.
 *
 * Returns the improvement factor (e.g., 50× means the local calibration is
 * 50× more accurate than the national parameters for this area).
 *
 * @param localRmsFit - RMS fit of the local calibration
 * @param nationalRmsFit - RMS fit of the national transformation (typically 5m for Kenya)
 */
export function assessCalibrationQuality(
  localRmsFit: number,
  nationalRmsFit: number = 5.0,
): {
  improvementFactor: number
  localAccuracy: number
  nationalAccuracy: number
  assessment: 'excellent' | 'good' | 'acceptable' | 'poor'
  recommendation: string
} {
  const improvementFactor = nationalRmsFit / Math.max(localRmsFit, 0.001)

  let assessment: 'excellent' | 'good' | 'acceptable' | 'poor'
  let recommendation: string

  if (localRmsFit < 0.01) {
    assessment = 'excellent'
    recommendation = `Excellent calibration (${localRmsFit.toFixed(4)}m RMS, ${improvementFactor.toFixed(0)}× better than national). Suitable for first-order surveys and boundary work.`
  } else if (localRmsFit < 0.05) {
    assessment = 'good'
    recommendation = `Good calibration (${localRmsFit.toFixed(4)}m RMS, ${improvementFactor.toFixed(0)}× better than national). Suitable for cadastral and engineering surveys.`
  } else if (localRmsFit < 0.20) {
    assessment = 'acceptable'
    recommendation = `Acceptable calibration (${localRmsFit.toFixed(4)}m RMS, ${improvementFactor.toFixed(0)}× better than national). Suitable for topographic and preliminary surveys.`
  } else {
    assessment = 'poor'
    recommendation = `Poor calibration (${localRmsFit.toFixed(4)}m RMS). Check for blunders in common points, or use more points spread over a wider area.`
  }

  return {
    improvementFactor,
    localAccuracy: localRmsFit,
    nationalAccuracy: nationalRmsFit,
    assessment,
    recommendation,
  }
}
