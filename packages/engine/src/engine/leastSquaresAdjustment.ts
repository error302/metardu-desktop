/**
 * @module leastSquaresAdjustment
 *
 * Least Squares Adjustment for survey control networks
 *
 * Implements parametric (indirect observations) least squares adjustment:
 * 1. Set up observation equations: L + V = A·X
 * 2. Form normal equations: (AᵀP A)·X = AᵀP L
 * 3. Solve for corrections: X = (AᵀP A)⁻¹ · AᵀP L
 * 4. Compute residuals, standard error, confidence ellipses
 *
 * For traverse networks:
 * - Observations: angles, distances
 * - Parameters: station coordinates (E, N)
 * - Weight matrix: P = diag(1/σ²)
 *
 * Reference: "Adjustment Computations" by Ghilani & Wolf (6th edition)
 *
 * This is needed for high-precision control surveys where Bowditch
 * (compass rule) is insufficient — it doesn't properly weight
 * different observation types.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ControlStation {
  id: string
  name: string
  easting: number
  northing: number
  isFixed: boolean  // known control point (not adjusted)
}

export interface AngleObservation {
  id: string
  fromStationId: string
  toStationId: string
  /**
   * The station at the vertex of the angle (where the instrument is set up).
   * The angle is measured clockwise from the backsight (fromStation) to the
   * foresight (toStation), as observed at the atStation.
   *
   * If atStationId is omitted, the observation is treated as a bearing
   * (direction) from fromStation to toStation — NOT an interior angle.
   *
   * AUDIT FIX (2026-07-03): Added atStationId so the engine can compute
   * true interior angles (θ = α_BC − α_BA) instead of treating every
   * "angle" as a bearing. The page collects from/at/to for a reason.
   */
  atStationId?: string
  angle: number  // decimal degrees
  stdDev: number // seconds
}

export interface DistanceObservation {
  id: string
  fromStationId: string
  toStationId: string
  distance: number  // meters
  stdDev: number    // meters (e.g., 0.002 + 2ppm)
}

export interface TraverseObservations {
  stations: ControlStation[]
  angles: AngleObservation[]
  distances: DistanceObservation[]
}

export interface AdjustedStation {
  id: string
  name: string
  adjustedEasting: number
  adjustedNorthing: number
  correctionE: number  // adjustment in Easting
  correctionN: number  // adjustment in Northing
  stdDevE: number     // standard error in E
  stdDevN: number     // standard error in N
  errorEllipse: {
    semiMajor: number  // meters
    semiMinor: number  // meters
    orientation: number  // degrees from N
  }
}

export interface Residual {
  observationId: string
  type: 'angle' | 'distance'
  observed: number
  computed: number
  residual: number  // observed - computed
  standardized: number  // v / √(q_vv · σ₀²)
  /** AUDIT FIX (H13, 2026-07-02): Baarda redundancy number r_i = q_vv_i × P_i.
   * Range [0, 1]. r_i = 0 means fully controlled (no check), r_i = 1 means
   * fully redundant. Observations with r_i < 0.1 are weakly controlled. */
  redundancy?: number
  /** AUDIT FIX (H13, 2026-07-02): Minimal Detectable Bias (MDB).
   * The smallest blunder that can be detected at the chosen α/β.
   * In the same units as the observation (metres for distance, degrees for angle). */
  mdb?: number
}

export interface LSAResult {
  adjustedStations: AdjustedStation[]
  residuals: Residual[]
  referenceVariance: number  // σ₀²
  degreesOfFreedom: number
  standardError: number  // σ₀ (a posteriori)
  passed: boolean  // chi-square test
  chiSquareValue: number
  chiSquareCritical: number
  report: string
}

// ---------------------------------------------------------------------------
// Matrix operations (minimal implementation)
// ---------------------------------------------------------------------------

type Matrix = number[][]
type Vector = number[]

function transpose(A: Matrix): Matrix {
  const rows = A.length
  const cols = A[0].length
  const result: Matrix = Array(cols).fill(null).map(() => Array(rows).fill(0))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j][i] = A[i][j]
    }
  }
  return result
}

function multiply(A: Matrix, B: Matrix): Matrix {
  const rowsA = A.length
  const colsA = A[0].length
  const colsB = B[0].length
  const result: Matrix = Array(rowsA).fill(null).map(() => Array(colsB).fill(0))
  for (let i = 0; i < rowsA; i++) {
    for (let j = 0; j < colsB; j++) {
      for (let k = 0; k < colsA; k++) {
        result[i][j] += A[i][k] * B[k][j]
      }
    }
  }
  return result
}

function multiplyVector(A: Matrix, v: Vector): Vector {
  const rows = A.length
  const cols = A[0].length
  const result: Vector = Array(rows).fill(0)
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[i] += A[i][j] * v[j]
    }
  }
  return result
}

function multiplyDiagonal(A: Matrix, diag: Vector): Matrix {
  // Multiply Aᵀ · P where P is diagonal
  const rows = A.length
  const cols = A[0].length
  const result: Matrix = Array(rows).fill(null).map(() => Array(cols).fill(0))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[i][j] = A[i][j] * diag[i]
    }
  }
  return result
}

/**
 * Gauss-Jordan elimination to solve Ax = b and compute A⁻¹.
 */
function solveAndInvert(A: Matrix, b: Vector): { solution: Vector; inverse: Matrix } {
  const n = A.length
  // Augmented matrix [A | I | b]
  const aug: Matrix = A.map((row, i) => [...row, ...Array(n).fill(0).map((_, j) => (j === i ? 1 : 0)), b[i]])

  // Forward elimination
  for (let col = 0; col < n; col++) {
    // Pivot
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
        maxRow = row
      }
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]]

    const pivot = aug[col][col]
    if (Math.abs(pivot) < 1e-15) {
      throw new Error('Matrix is singular — check for redundant observations')
    }

    for (let j = 0; j < aug[col].length; j++) {
      aug[col][j] /= pivot
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = aug[row][col]
      for (let j = 0; j < aug[row].length; j++) {
        aug[row][j] -= factor * aug[col][j]
      }
    }
  }

  // Extract solution and inverse
  const solution: Vector = aug.map(row => row[row.length - 1])
  const inverse: Matrix = aug.map(row => row.slice(n, 2 * n))

  return { solution, inverse }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function computeBearing(fromE: number, fromN: number, toE: number, toN: number): number {
  const dE = toE - fromE
  const dN = toN - fromN
  let bearing = Math.atan2(dE, dN) * 180 / Math.PI
  if (bearing < 0) bearing += 360
  return bearing
}

function computeDistance(fromE: number, fromN: number, toE: number, toN: number): number {
  const dE = toE - fromE
  const dN = toN - fromN
  return Math.sqrt(dE * dE + dN * dN)
}

// ---------------------------------------------------------------------------
// Main Adjustment Function
// ---------------------------------------------------------------------------

/**
 * Perform least squares adjustment on a traverse network.
 *
 * @param observations - Stations, angles, and distances
 * @returns Adjustment results with adjusted coordinates, residuals, and statistics
 */
export function adjustTraverseLSA(observations: TraverseObservations): LSAResult {
  const { stations, angles, distances } = observations

  // Identify adjustable stations (not fixed)
  const adjustableStations = stations.filter(s => !s.isFixed)
  const paramCount = adjustableStations.length * 2  // E, N per station

  // Total observations
  const obsCount = angles.length + distances.length
  const degreesOfFreedom = obsCount - paramCount

  if (degreesOfFreedom <= 0) {
    throw new Error(`Insufficient observations: ${obsCount} observations for ${paramCount} parameters (${degreesOfFreedom} DOF)`)
  }

  // Build coefficient matrix A, observation vector L, and weight matrix P
  const A: Matrix = []
  const L: Vector = []
  const P: Vector = []  // diagonal weights

  const stationMap = new Map(stations.map(s => [s.id, s]))
  const adjStationMap = new Map(adjustableStations.map((s, i) => [s.id, i]))

  // Angle observation equations
  for (const angle of angles) {
    const from = stationMap.get(angle.fromStationId)  // backsight
    const to = stationMap.get(angle.toStationId)      // foresight
    if (!from || !to) continue

    const row: Vector = Array(paramCount).fill(0)

    // AUDIT FIX (2026-07-03): If atStationId is provided, compute a true
    // interior angle θ = α_BC − α_BA (bearing from vertex to foresight
    // minus bearing from vertex to backsight). If not, fall back to the
    // old bearing-only behavior for backward compatibility.
    let computedAngle: number
    let dAngle_dE_from: number, dAngle_dN_from: number
    let dAngle_dE_to: number, dAngle_dN_to: number
    let dAngle_dE_at = 0, dAngle_dN_at = 0

    if (angle.atStationId) {
      // ── True interior angle at vertex ──
      const at = stationMap.get(angle.atStationId)
      if (!at) continue

      // Bearing from vertex to backsight (BA)
      const dE_BA = from.easting - at.easting
      const dN_BA = from.northing - at.northing
      const dist_BA = Math.sqrt(dE_BA * dE_BA + dN_BA * dN_BA)
      if (dist_BA < 0.001) continue

      // Bearing from vertex to foresight (BC)
      const dE_BC = to.easting - at.easting
      const dN_BC = to.northing - at.northing
      const dist_BC = Math.sqrt(dE_BC * dE_BC + dN_BC * dN_BC)
      if (dist_BC < 0.001) continue

      // Computed bearings (degrees, 0-360)
      const alpha_BA = computeBearing(at.easting, at.northing, from.easting, from.northing)
      const alpha_BC = computeBearing(at.easting, at.northing, to.easting, to.northing)

      // Interior angle = BC − BA (normalized to 0-360)
      computedAngle = alpha_BC - alpha_BA
      while (computedAngle < 0) computedAngle += 360
      while (computedAngle >= 360) computedAngle -= 360

      // Partial derivatives of θ = α_BC − α_BA w.r.t. E/N at each station
      // ∂α/∂E_from = dN/dist²   ∂α/∂N_from = −dE/dist²  (for BA direction)
      // ∂α/∂E_to   = −dN/dist²  ∂α/∂N_to   = dE/dist²   (for BC direction)
      // ∂α/∂E_at   = (dE_BC terms − dE_BA terms) / respective dist²
      const RAD = 180 / Math.PI
      const dist_BA2 = dist_BA * dist_BA
      const dist_BC2 = dist_BC * dist_BC

      // θ = α_BC − α_BA
      // ∂θ/∂E_at = ∂α_BC/∂E_at − ∂α_BA/∂E_at = (−dN_BC/dist_BC²) − (dN_BA/dist_BA²)
      dAngle_dE_at = ((-dN_BC / dist_BC2) - (dN_BA / dist_BA2)) * RAD
      dAngle_dN_at = ((dE_BC / dist_BC2) - (-dE_BA / dist_BA2)) * RAD  // fix signs
      dAngle_dN_at = ((dE_BC / dist_BC2) + (dE_BA / dist_BA2)) * RAD

      // ∂θ/∂E_from (backsight) = dN_BA / dist_BA² (from the BA bearing derivative)
      dAngle_dE_from = (dN_BA / dist_BA2) * RAD
      dAngle_dN_from = (-dE_BA / dist_BA2) * RAD

      // ∂θ/∂E_to (foresight) = −dN_BC / dist_BC²
      dAngle_dE_to = (-dN_BC / dist_BC2) * RAD
      dAngle_dN_to = (dE_BC / dist_BC2) * RAD

    } else {
      // ── Bearing-only (backward compatible) ──
      const dist = computeDistance(from.easting, from.northing, to.easting, to.northing)
      if (dist < 0.001) continue

      computedAngle = computeBearing(from.easting, from.northing, to.easting, to.northing)

      dAngle_dE_from = (to.northing - from.northing) / (dist * dist) * 180 / Math.PI
      dAngle_dN_from = -(to.easting - from.easting) / (dist * dist) * 180 / Math.PI
      dAngle_dE_to = -(to.northing - from.northing) / (dist * dist) * 180 / Math.PI
      dAngle_dN_to = (to.easting - from.easting) / (dist * dist) * 180 / Math.PI
    }

    // Fill coefficient matrix for adjustable stations
    if (!from.isFixed) {
      const idx = adjStationMap.get(from.id)
      if (idx != null) {
        row[idx * 2] = dAngle_dE_from
        row[idx * 2 + 1] = dAngle_dN_from
      }
    }
    if (!to.isFixed) {
      const idx = adjStationMap.get(to.id)
      if (idx != null) {
        row[idx * 2] = dAngle_dE_to
        row[idx * 2 + 1] = dAngle_dN_to
      }
    }
    // Vertex station (if provided and adjustable)
    if (angle.atStationId) {
      const at = stationMap.get(angle.atStationId)
      if (at && !at.isFixed) {
        const idx = adjStationMap.get(at.id)
        if (idx != null) {
          row[idx * 2] = dAngle_dE_at
          row[idx * 2 + 1] = dAngle_dN_at
        }
      }
    }

    A.push(row)
    L.push(angle.angle - computedAngle)  // misclosure
    P.push(1 / (angle.stdDev * angle.stdDev))  // weight = 1/σ²
  }

  // Distance observation equations
  for (const dist of distances) {
    const from = stationMap.get(dist.fromStationId)
    const to = stationMap.get(dist.toStationId)
    if (!from || !to) continue

    const row: Vector = Array(paramCount).fill(0)
    const computedDist = computeDistance(from.easting, from.northing, to.easting, to.northing)

    if (computedDist < 0.001) continue

    const dDist_dE_from = -(to.easting - from.easting) / computedDist
    const dDist_dN_from = -(to.northing - from.northing) / computedDist
    const dDist_dE_to = (to.easting - from.easting) / computedDist
    const dDist_dN_to = (to.northing - from.northing) / computedDist

    if (!from.isFixed) {
      const idx = adjStationMap.get(from.id)
      if (idx != null) {
        row[idx * 2] = dDist_dE_from
        row[idx * 2 + 1] = dDist_dN_from
      }
    }
    if (!to.isFixed) {
      const idx = adjStationMap.get(to.id)
      if (idx != null) {
        row[idx * 2] = dDist_dE_to
        row[idx * 2 + 1] = dDist_dN_to
      }
    }

    A.push(row)
    L.push(dist.distance - computedDist)
    P.push(1 / (dist.stdDev * dist.stdDev))
  }

  // Form normal equations: N = Aᵀ P A, t = Aᵀ P L
  const AtP = multiplyDiagonal(transpose(A), P)
  const N = multiply(AtP, A)
  const t = multiplyVector(AtP, L)

  // Solve for corrections: X = N⁻¹ · t
  const { solution: corrections, inverse: Ninv } = solveAndInvert(N, t)

  // Compute residuals: V = A·X - L
  const computedL = multiplyVector(A, corrections)
  const residuals: Residual[] = []
  let sumPVV = 0

  // AUDIT FIX (M7, 2026-07-02): Standardized residual computation.
  // Previously: v / √(1/P) = v·√P — this is the a priori standardized
  // residual, which does NOT account for the adjustment's effect on the
  // observation. The correct form is:
  //   w_i = v_i / √(q_vv_i · σ₀²)
  // where q_vv_i is the i-th diagonal of the residual cofactor matrix
  //   Q_vv = Q_ll - A · Q_xx · Aᵀ
  // and σ₀² is the a posteriori reference variance.
  // This requires computing A · Ninv · Aᵀ for each observation.

  // First pass: compute sumPVV and raw residuals
  for (let i = 0; i < L.length; i++) {
    const v = computedL[i] - L[i]
    sumPVV += P[i] * v * v
  }

  // Reference variance (a posteriori)
  const referenceVariance = sumPVV / degreesOfFreedom
  const standardError = Math.sqrt(referenceVariance)

  // Compute Q_vv diagonal: q_vv_i = 1/P_i - (A · Ninv · Aᵀ)_ii
  // For efficiency, compute (A · Ninv) once, then for each row i,
  // q_vv_i = 1/P_i - Σ_j (A·Ninv)[i][j] · A[i][j]
  const ANinv: number[][] = []
  for (let i = 0; i < A.length; i++) {
    const row: number[] = new Array(A[i].length).fill(0)
    for (let j = 0; j < A[i].length; j++) {
      let sum = 0
      for (let k = 0; k < A[i].length; k++) {
        sum += A[i][k] * (Ninv[k]?.[j] ?? 0)
      }
      row[j] = sum
    }
    ANinv.push(row)
  }

  for (let i = 0; i < L.length; i++) {
    const v = computedL[i] - L[i]

    // Compute q_vv_i = 1/P_i - A[i] · Ninv · A[i]ᵀ
    let qvv = 1 / P[i]
    for (let j = 0; j < A[i].length; j++) {
      qvv -= ANinv[i][j] * A[i][j]
    }

    // Standardized residual: w = v / √(q_vv · σ₀²)
    // Clamp q_vv to avoid division by zero (can happen for fully constrained obs)
    const qvvClamped = Math.max(qvv, 1e-15)
    const standardized = v / Math.sqrt(qvvClamped * referenceVariance)

    // AUDIT FIX (H13, 2026-07-02): Baarda reliability analysis.
    // Redundancy number: r_i = q_vv_i × P_i
    // Range [0, 1]. Low r_i means the observation is weakly controlled.
    const redundancy = qvvClamped * P[i]

    // Minimal Detectable Bias (MDB): the smallest blunder detectable
    // at significance level α and power β.
    //   ∇₀l = δ₀ × σ_l / √(r_i)
    // where δ₀ is the non-centrality parameter (4.13 for α=0.001, β=0.80),
    // σ_l = √(1/P_i) is the a priori standard deviation of the observation.
    const delta0 = 4.13  // Baarda's non-centrality parameter (α=0.001, β=0.80)
    const sigmaL = Math.sqrt(1 / P[i])  // a priori σ of the observation
    const mdb = delta0 * sigmaL / Math.sqrt(Math.max(redundancy, 1e-15))

    residuals.push({
      observationId: i < angles.length ? angles[i].id : distances[i - angles.length].id,
      type: i < angles.length ? 'angle' : 'distance',
      observed: L[i],
      computed: L[i] + v,
      residual: v,
      standardized,
      redundancy,
      mdb,
    })
  }

  // Chi-square test
  const chiSquareValue = sumPVV
  // Critical value at 5% significance (Wilson-Hilferty approximation — more
  // accurate than the old μ+2σ approximation)
  const chiSquareCritical = chiSquareQuantileWH(0.95, degreesOfFreedom)
  const passed = chiSquareValue <= chiSquareCritical

  // Build adjusted stations with error ellipses
  const adjustedStations: AdjustedStation[] = adjustableStations.map((station, i) => {
    const corrE = corrections[i * 2]
    const corrN = corrections[i * 2 + 1]

    // Cofactor matrix for this station
    const qEE = Ninv[i * 2][i * 2]
    const qNN = Ninv[i * 2 + 1][i * 2 + 1]
    const qEN = Ninv[i * 2][i * 2 + 1]

    const stdDevE = Math.sqrt(qEE * referenceVariance)
    const stdDevN = Math.sqrt(qNN * referenceVariance)

    // Error ellipse
    const qMax = (qEE + qNN) / 2 + Math.sqrt(((qEE - qNN) / 2) ** 2 + qEN ** 2)
    const qMin = (qEE + qNN) / 2 - Math.sqrt(((qEE - qNN) / 2) ** 2 + qEN ** 2)
    const semiMajor = Math.sqrt(qMax * referenceVariance * 2.448)  // 95% confidence
    const semiMinor = Math.sqrt(qMin * referenceVariance * 2.448)

    let orientation = Math.atan2(2 * qEN, qEE - qNN) / 2 * 180 / Math.PI
    if (orientation < 0) orientation += 180

    return {
      id: station.id,
      name: station.name,
      adjustedEasting: station.easting + corrE,
      adjustedNorthing: station.northing + corrN,
      correctionE: corrE,
      correctionN: corrN,
      stdDevE,
      stdDevN,
      errorEllipse: { semiMajor, semiMinor, orientation },
    }
  })

  // Generate report
  let report = `Least Squares Adjustment Report\n`
  report += `═══════════════════════════════\n`
  report += `Observations: ${obsCount} (${angles.length} angles, ${distances.length} distances)\n`
  report += `Parameters: ${paramCount} (${adjustableStations.length} stations × 2)\n`
  report += `Degrees of freedom: ${degreesOfFreedom}\n`
  report += `Reference variance (σ₀²): ${referenceVariance.toFixed(6)}\n`
  report += `Standard error (σ₀): ${standardError.toFixed(4)}\n`
  report += `Chi-square test: ${chiSquareValue.toFixed(2)} vs ${chiSquareCritical.toFixed(2)} → ${passed ? 'PASS' : 'FAIL'}\n`
  report += `\nAdjusted Stations:\n`
  for (const s of adjustedStations) {
    report += `  ${s.name}: E:${s.adjustedEasting.toFixed(4)} N:${s.adjustedNorthing.toFixed(4)}`
    report += ` (ΔE:${s.correctionE.toFixed(4)} ΔN:${s.correctionN.toFixed(4)})`
    report += ` σE:${s.stdDevE.toFixed(4)} σN:${s.stdDevN.toFixed(4)}\n`
  }

  return {
    adjustedStations,
    residuals,
    referenceVariance,
    degreesOfFreedom,
    standardError,
    passed,
    chiSquareValue,
    chiSquareCritical,
    report,
  }
}

/**
 * Chi-square quantile function using the Wilson-Hilferty approximation.
 *
 * AUDIT FIX (M7, 2026-07-02): Replaced the crude μ+2σ approximation
 * (dof + 2·√(2·dof)) with the Wilson-Hilferty transformation, which
 * is accurate to ~0.1% for dof ≥ 3.
 *
 * Reference: Wilson, E.B. & Hilferty, M.M. (1931)
 */
function invNormalCDF(p: number): number {
  // Inverse normal CDF (Acklam's algorithm — same as in leastSquares.ts)
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

// Wilson-Hilferty transformation: χ²_p ≈ dof · (z_p · √(2/(9·dof)) + 1 - 1/(9·dof))³
function chiSquareQuantileWH(p: number, dof: number): number {
  if (dof <= 0) return 0
  const z = invNormalCDF(p)
  const t = z * Math.sqrt(2 / (9 * dof)) + 1 - 1 / (9 * dof)
  return dof * t * t * t
}
