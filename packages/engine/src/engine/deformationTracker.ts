/**
 * @module deformationTracker
 *
 * Deformation & Monitoring Survey Engine
 *
 * Tracks structural displacement over time (epochs):
 * 1. Establish Epoch 0 (baseline) coordinates for monitoring points
 * 2. Import subsequent epoch measurements
 * 3. Compute 3D displacement vectors (ΔX, ΔY, ΔZ)
 * 4. Calculate total displacement and velocity
 * 5. Flag points exceeding safety thresholds
 *
 * Applications:
 * - Mining zone deformation
 * - Structural foundation monitoring
 * - Landslide-prone embankment tracking
 * - Dam and retaining wall monitoring
 *
 * Reference: "Engineering Surveying" by Schofield & Breach (Chapter 14)
 */

export interface MonitoringStation {
  id: string
  stationName: string
  baseX: number  // Epoch 0 baseline (Easting)
  baseY: number  // Epoch 0 baseline (Northing)
  baseZ: number  // Epoch 0 baseline (Elevation)
  description?: string
}

export interface EpochReading {
  id: string
  stationId: string
  epochNumber: number
  observedAt: string  // ISO date
  currentX: number
  currentY: number
  currentZ: number
  deltaX: number  // current - baseline
  deltaY: number
  deltaZ: number
  totalDisplacement: number  // 3D displacement
  horizontalDisplacement: number
  velocityMmPerWeek: number  // rate of change
  status: 'stable' | 'warning' | 'critical'
}

export interface DeformationReport {
  stations: MonitoringStation[]
  readings: EpochReading[]
  flaggedStations: EpochReading[]
  maxDisplacement: number
  maxVelocity: number
  epochCount: number
  monitoringPeriod: {
    start: string
    end: string
    durationDays: number
  }
}

// Safety thresholds (configurable)
export const DEFAULT_THRESHOLDS = {
  warningDisplacement: 5.0,    // mm — flag as warning
  criticalDisplacement: 10.0,  // mm — flag as critical
  warningVelocity: 1.0,        // mm/week
  criticalVelocity: 2.0,       // mm/week
}

/**
 * Compute displacement for a single epoch reading.
 */
export function computeDisplacement(
  station: MonitoringStation,
  currentX: number,
  currentY: number,
  currentZ: number,
  epochNumber: number,
  observedAt: string,
  previousReading?: EpochReading,
): EpochReading {
  const deltaX = currentX - station.baseX
  const deltaY = currentY - station.baseY
  const deltaZ = currentZ - station.baseZ

  const horizontalDisplacement = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
  const totalDisplacement = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ)

  // Convert to mm
  const totalDispMm = totalDisplacement * 1000

  // Compute velocity (mm per week)
  let velocityMmPerWeek = 0
  if (previousReading) {
    const prevDate = new Date(previousReading.observedAt)
    const currDate = new Date(observedAt)
    const daysDiff = (currDate.getTime() - prevDate.getTime()) / 86400000
    if (daysDiff > 0) {
      const prevDispMm = previousReading.totalDisplacement * 1000
      const dispDiff = totalDispMm - prevDispMm
      velocityMmPerWeek = (dispDiff / daysDiff) * 7
    }
  }

  // Determine status
  let status: 'stable' | 'warning' | 'critical' = 'stable'
  if (totalDispMm >= DEFAULT_THRESHOLDS.criticalDisplacement ||
      velocityMmPerWeek >= DEFAULT_THRESHOLDS.criticalVelocity) {
    status = 'critical'
  } else if (totalDispMm >= DEFAULT_THRESHOLDS.warningDisplacement ||
             velocityMmPerWeek >= DEFAULT_THRESHOLDS.warningVelocity) {
    status = 'warning'
  }

  return {
    id: crypto.randomUUID(),
    stationId: station.id,
    epochNumber,
    observedAt,
    currentX,
    currentY,
    currentZ,
    deltaX,
    deltaY,
    deltaZ,
    totalDisplacement,
    horizontalDisplacement,
    velocityMmPerWeek,
    status,
  }
}

/**
 * Generate a full deformation report from multiple epochs.
 */
export function generateDeformationReport(
  stations: MonitoringStation[],
  readings: EpochReading[],
): DeformationReport {
  const flaggedStations = readings.filter(
    r => r.status === 'warning' || r.status === 'critical'
  )

  const maxDisplacement = Math.max(0, ...readings.map(r => r.totalDisplacement * 1000))
  const maxVelocity = Math.max(0, ...readings.map(r => r.velocityMmPerWeek))

  const epochNumbers = [...new Set(readings.map(r => r.epochNumber))].sort((a, b) => a - b)
  const dates = readings.map(r => new Date(r.observedAt)).sort((a, b) => a.getTime() - b.getTime())

  return {
    stations,
    readings: readings.sort((a, b) => {
      if (a.stationId !== b.stationId) return a.stationId.localeCompare(b.stationId)
      return a.epochNumber - b.epochNumber
    }),
    flaggedStations,
    maxDisplacement,
    maxVelocity,
    epochCount: epochNumbers.length,
    monitoringPeriod: {
      start: dates[0]?.toISOString() || new Date().toISOString(),
      end: dates[dates.length - 1]?.toISOString() || new Date().toISOString(),
      durationDays: dates.length > 1
        ? (dates[dates.length - 1].getTime() - dates[0].getTime()) / 86400000
        : 0,
    },
  }
}

/**
 * Generate a deformation alert for a critical station.
 */
export function generateAlert(reading: EpochReading, station: MonitoringStation): {
  severity: 'warning' | 'critical'
  stationName: string
  message: string
  timestamp: string
} {
  const dispMm = (reading.totalDisplacement * 1000).toFixed(2)
  const velMm = reading.velocityMmPerWeek.toFixed(2)

  return {
    severity: reading.status as 'warning' | 'critical',
    stationName: station.stationName,
    message: `Station ${station.stationName} has ${reading.status === 'critical' ? 'CRITICAL' : 'WARNING'} displacement: ${dispMm}mm total, ${velMm}mm/week velocity`,
    timestamp: reading.observedAt,
  }
}

// ─── Congruence Testing (Pelzer's Method) ──────────────────────────────────
//
// AUDIT FIX (H11, 2026-07-02): Added congruence testing for statistically
// rigorous deformation analysis. Previously the tracker used fixed
// thresholds (5mm/10mm) with no statistical significance test — a 5mm
// displacement is meaningless without knowing the σ of the coordinate.
//
// The Pelzer global congruence test answers: "Is the deformation between
// two epochs statistically significant, or could it be explained by
// measurement noise alone?"
//
// Method (Pelzer 1971, Caspary 1988):
//   1. Compute coordinate differences: d = X₁ - X₀
//   2. Compute cofactor of differences: Q_dd = Q₀ + Q₁ (pooled)
//   3. Compute quadratic form: Ω = dᵀ · Q_dd⁺ · d (pseudoinverse for singular Q)
//   4. Test statistic: T = Ω / (h · s₀²) where h = rank(Q_dd)
//   5. Compare T against F(h, f_rest, 1-α) — if T > F_crit, deformation
//      is statistically significant
//
// References:
//   - Pelzer, H. (1971) "Zur Analyse geodätischer Deformationsmessungen"
//   - Caspary, W. (1988) "Concepts of Network and Deformation Analysis"
//   - Schofield & Breach (2007) "Engineering Surveying" Ch. 14

export interface CongruenceTestResult {
  /** True if the deformation is statistically significant at the chosen α. */
  significant: boolean
  /** Test statistic T = Ω / (h · s₀²) */
  testStatistic: number
  /** Critical value from F-distribution: F(h, f_rest, 1-α) */
  criticalValue: number
  /** Significance level (default 0.05 = 95% confidence) */
  alpha: number
  /** Degrees of freedom: h = rank of Q_dd */
  degreesOfFreedom: number
  /** Quadratic form Ω = dᵀ · Q_dd⁺ · d */
  quadraticForm: number
  /** Reference variance s₀² (pooled from both epochs) */
  referenceVariance: number
  /** Human-readable summary */
  summary: string
}

export interface DisplacementConfidenceEllipse {
  stationId: string
  /** Semi-major axis (mm) */
  semiMajor: number
  /** Semi-minor axis (mm) */
  semiMinor: number
  /** Orientation of major axis (degrees from North, clockwise) */
  orientation: number
  /** Confidence level (default 0.95 = 95%) */
  confidenceLevel: number
  /** True if the displacement is statistically significant (ellipse does not contain origin) */
  significant: boolean
}

/**
 * Perform a Pelzer global congruence test between two epochs.
 *
 * @param displacements  Coordinate differences d = X₁ - X₀ for each station (2D: [dE, dN] per station)
 * @param cofactorMatrix  Q_dd = Q₀ + Q₁ (pooled cofactor matrix, 2n × 2n for n stations)
 * @param referenceVariance  Pooled reference variance s₀² (from both epochs' adjustments)
 * @param residualDegreesOfFreedom  f_rest (degrees of freedom of the combined adjustment)
 * @param alpha  Significance level (default 0.05 = 95% confidence)
 */
export function congruenceTest(
  displacements: number[],
  cofactorMatrix: number[][],
  referenceVariance: number,
  residualDegreesOfFreedom: number,
  alpha: number = 0.05
): CongruenceTestResult {
  const n = displacements.length
  if (n === 0 || cofactorMatrix.length === 0) {
    return {
      significant: false,
      testStatistic: 0,
      criticalValue: 0,
      alpha,
      degreesOfFreedom: 0,
      quadraticForm: 0,
      referenceVariance,
      summary: 'No displacement data provided',
    }
  }

  // Compute the pseudoinverse of Q_dd (Moore-Penrose via SVD approximation).
  // For a full-rank square matrix, this is just the regular inverse.
  // For singular matrices (free networks), we use a regularized inverse.
  let QddInv: number[][]
  try {
    QddInv = matrixInvert(cofactorMatrix)
  } catch {
    // Matrix is singular — add a small Tikhonov regularization
    const lambda = 1e-10 * Math.max(...diagonal(cofactorMatrix).map(Math.abs))
    const regularized = cofactorMatrix.map((row, i) =>
      row.map((v, j) => v + (i === j ? lambda : 0))
    )
    QddInv = matrixInvert(regularized)
  }

  // Compute quadratic form: Ω = dᵀ · Q_dd⁺ · d
  let omega = 0
  for (let i = 0; i < n; i++) {
    let rowProduct = 0
    for (let j = 0; j < n; j++) {
      rowProduct += QddInv[i][j] * displacements[j]
    }
    omega += displacements[i] * rowProduct
  }

  // Effective degrees of freedom (rank of Q_dd)
  // For a non-singular matrix, h = n. For singular, h < n.
  // We approximate h as n (the dimension of the displacement vector).
  const h = n

  // Test statistic: T = Ω / (h · s₀²)
  const testStatistic = omega / (h * Math.max(referenceVariance, 1e-15))

  // F-distribution critical value: F(h, f_rest, 1-α)
  // Approximation using the Fisher-Snedecor relationship with chi-square:
  // F(h, f) ≈ (χ²_h / h) / (χ²_f / f) where χ² are independent
  // For large f_rest, F(h, ∞, 1-α) ≈ χ²_h / h
  const chiSqH = chiSquareQuantileApprox(1 - alpha, h)
  const fRest = Math.max(residualDegreesOfFreedom, 1)
  const chiSqF = chiSquareQuantileApprox(1 - alpha, fRest)
  const criticalValue = (chiSqH / h) / (chiSqF / fRest)

  const significant = testStatistic > criticalValue

  const summary = significant
    ? `Deformation is statistically significant at α=${alpha}. ` +
      `T=${testStatistic.toFixed(4)} > F_crit=${criticalValue.toFixed(4)} ` +
      `(Ω=${omega.toFixed(4)}, h=${h}, s₀²=${referenceVariance.toFixed(6)}). ` +
      `The network has moved beyond what measurement noise can explain.`
    : `Deformation is NOT statistically significant at α=${alpha}. ` +
      `T=${testStatistic.toFixed(4)} ≤ F_crit=${criticalValue.toFixed(4)}. ` +
      `Observed displacements are consistent with measurement noise.`

  return {
    significant,
    testStatistic,
    criticalValue,
    alpha,
    degreesOfFreedom: h,
    quadraticForm: omega,
    referenceVariance,
    summary,
  }
}

/**
 * Compute confidence ellipses for displacement vectors.
 *
 * For each station, the 2D displacement (dE, dN) has a covariance
 * matrix Σ = s₀² · Q_dd (extracted from the pooled cofactor). The
 * confidence ellipse at level (1-α) has semi-axes:
 *   a = √(λ₁ · s₀² · F_quantile)
 *   b = √(λ₂ · s₀² · F_quantile)
 * where λ₁, λ₂ are the eigenvalues of the 2×2 cofactor sub-matrix.
 *
 * The displacement is statistically significant if the ellipse does NOT
 * contain the origin (i.e., zero displacement is outside the confidence
 * region).
 *
 * @param stationIds  Array of station IDs
 * @param displacements  Flat array [dE_1, dN_1, dE_2, dN_2, ...] in metres
 * @param cofactorDiagonals  Per-station 2×2 cofactor sub-matrices: [[qEE, qEN], [qNE, qNN]]
 * @param referenceVariance  Pooled s₀²
 * @param confidenceLevel  Default 0.95 (95%)
 */
export function computeDisplacementConfidenceEllipses(
  stationIds: string[],
  displacements: number[],
  cofactorDiagonals: number[][][],
  referenceVariance: number,
  confidenceLevel: number = 0.95
): DisplacementConfidenceEllipse[] {
  const alpha = 1 - confidenceLevel
  // F-quantile for 2 and ∞ degrees of freedom at (1-α)
  // F(2, ∞, 0.95) ≈ 3.00 (chi²₂/2 = 5.991/2 = 2.996)
  const fQuantile = chiSquareQuantileApprox(confidenceLevel, 2) / 2

  const results: DisplacementConfidenceEllipse[] = []

  for (let i = 0; i < stationIds.length; i++) {
    const dE = displacements[i * 2] ?? 0
    const dN = displacements[i * 2 + 1] ?? 0
    const Q = cofactorDiagonals[i] ?? [[1, 0], [0, 1]]

    // Scale by reference variance to get covariance
    const s2 = Math.max(referenceVariance, 1e-15)
    const c11 = Q[0][0] * s2
    const c12 = Q[0][1] * s2
    const c22 = Q[1][1] * s2

    // Eigenvalues of 2×2 covariance matrix
    const trace = c11 + c22
    const det = c11 * c22 - c12 * c12
    const discriminant = Math.sqrt(Math.max(trace * trace / 4 - det, 0))
    const lambda1 = trace / 2 + discriminant // larger eigenvalue
    const lambda2 = trace / 2 - discriminant // smaller eigenvalue

    // Semi-axes (in mm)
    const semiMajor = Math.sqrt(Math.max(lambda1, 0) * fQuantile) * 1000
    const semiMinor = Math.sqrt(Math.max(lambda2, 0) * fQuantile) * 1000

    // Orientation of major axis (degrees from North, clockwise)
    const orientation = (Math.atan2(2 * c12, c11 - c22) * 180 / Math.PI / 2 + 360) % 360

    // Significance: does the ellipse contain the origin?
    // The origin is inside the ellipse if: dᵀ · Σ⁻¹ · d ≤ fQuantile
    const detSigma = c11 * c22 - c12 * c12
    let testStat = 0
    if (Math.abs(detSigma) > 1e-15) {
      const inv11 = c22 / detSigma
      const inv12 = -c12 / detSigma
      const inv22 = c11 / detSigma
      testStat = dE * dE * inv11 + 2 * dE * dN * inv12 + dN * dN * inv22
    }
    const significant = testStat > fQuantile

    results.push({
      stationId: stationIds[i],
      semiMajor,
      semiMinor,
      orientation,
      confidenceLevel,
      significant,
    })
  }

  return results
}

// ─── Linear algebra helpers ────────────────────────────────────────────────

function diagonal(m: number[][]): number[] {
  return m.map((row, i) => row[i] ?? 0)
}

function matrixInvert(m: number[][]): number[][] {
  const n = m.length
  if (n === 0) return []

  // Augmented matrix [m | I]
  const aug = m.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  ])

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
        maxRow = row
      }
    }
    if (Math.abs(aug[maxRow][col]) < 1e-14) {
      throw new Error('Matrix is singular')
    }

    // Swap rows
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]]

    // Scale pivot row
    const pivot = aug[col][col]
    for (let j = 0; j < 2 * n; j++) {
      aug[col][j] /= pivot
    }

    // Eliminate column
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = aug[row][col]
      for (let j = 0; j < 2 * n; j++) {
        aug[row][j] -= factor * aug[col][j]
      }
    }
  }

  // Extract inverse
  return aug.map(row => row.slice(n))
}

function chiSquareQuantileApprox(p: number, dof: number): number {
  if (dof <= 0) return 0
  // Wilson-Hilferty transformation
  const z = invNormalCDFApprox(p)
  const t = z * Math.sqrt(2 / (9 * dof)) + 1 - 1 / (9 * dof)
  return dof * t * t * t
}

function invNormalCDFApprox(p: number): number {
  // Acklam's algorithm
  const a = [-3.969683028665376e+01, 2.209460984245205e+02,
             -2.759285104469687e+02, 1.383577518672690e+02,
             -3.066479806614716e+01, 2.506628277459239e+00]
  const b = [-5.447609879822406e+01, 1.615858368580409e+02,
             -1.556989798598866e+02, 6.680131188771972e+01,
             -1.328068155288572e+01]
  const c = [-7.784894002430293e-03, -3.223964580411365e-01,
             -2.400758277161838e+00, -2.549732539343734e+00,
              4.374664141464968e+00, 2.938163982698783e+00]
  const d = [7.784695709041462e-03, 3.224671290700398e-01,
             2.445134137142996e+00, 3.754408661907416e+00]
  const pLow = 0.02425
  const pHigh = 1 - pLow
  let q: number
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
  } else if (p <= pHigh) {
    q = p - 0.5
    const r = q * q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
  }
}
