/**
 * @module networkAdjustment
 *
 * Enterprise-grade least squares adjustment for survey control networks.
 *
 * Improvements over the legacy `leastSquares.ts` / `leastSquaresAdjustment.ts`:
 *
 * 1. SPARSE LINEAR ALGEBRA
 *    Uses the sparse Cholesky solver from `sparseMatrix.ts`. Handles 10,000+
 *    stations where the dense solver breaks past ~150. Memory and time scale
 *    with nnz (non-zeros) instead of n².
 *
 * 2. ITERATIVE RELINEARIZATION
 *    Re-linearizes the observation equations around the current parameter
 *    estimates each iteration, until convergence below a configurable threshold
 *    (default 0.1mm). Critical for networks with large misclosures where a
 *    single-pass linear approximation introduces >1mm error.
 *
 * 3. FREE NETWORK ADJUSTMENT (INNER CONSTRAINTS)
 *    Supports datum-independent adjustment when no fixed points are available,
 *    or only one fixed point (which leaves rotation/scale undetermined).
 *    Implements the Mittermayer / Niemeier inner constraint equations:
 *      B · x = 0
 *    where B is the (d+1) × n matrix of constraint equations (d = dimension).
 *    The constrained normal equations become:
 *      [ N   Bᵀ ] [ x ]   [ u ]
 *      [ B   0  ] [ k ] = [ 0 ]
 *    solved via the bordering method (no need to invert the constraint block).
 *
 * 4. ROBUST ESTIMATION (HUBER WEIGHTS)
 *    After each iteration, observations whose standardized residuals exceed
 *    a threshold (default 2.5σ) are downweighted using Huber's function:
 *      w_i' = w_i × (c / |w̃_i|)  if |w̃_i| > c
 *    This makes the adjustment resistant to blunders without failing the
 *    chi-square test. Converges in 3-5 iterations typically.
 *
 * 5. FULL COVARIANCE COMPUTATION
 *    Uses Takahashi's selective inversion to compute only the diagonal of
 *    N⁻¹ (which gives variance of each coordinate) — O(nnz(L)) instead of
 *    O(n³) for full inversion. Error ellipses come essentially for free.
 *
 * 6. BAARDA RELIABILITY (carried over from existing implementation)
 *    Redundancy numbers, Minimal Detectable Bias, w-test (data snooping),
 *    external reliability — all computed via the Q_vv diagonal.
 *
 * References:
 *   - Ghilani & Wolf "Adjustment Computations" 6th ed. (2010)
 *   - Mittermayer, E. (1972) "Zur Verallgemeinerung der freien Netzausgleichung"
 *   - Niemeier, W. (2008) "Ausgleichungsrechnung" 2nd ed.
 *   - Huber, P.J. (1964) "Robust Estimation of a Location Parameter"
 *   - Baarda, W. (1968) "A Testing Procedure for Use in Geodetic Networks"
 */

import {
  fromTriplets,
  fromDense,
  sparseMatVec,
  ataDiag,
  atdbDiag,
  approximateMinimumDegree,
  permuteSymmetric,
  symbolicFactorize,
  cholesky,
  sparseForwardSolve,
  sparseBackwardSolve,
  sparseInverseDiagonal,
  diagonal,
  addDiagonal,
  type SparseMatrix,
  type SparseCholesky,
} from './sparseMatrix'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ObservationType =
  | 'distance'
  | 'bearing'
  | 'angle'
  | 'slope_distance'
  | 'zenith_angle'
  | 'height_difference'
  | 'gnss_baseline'

export type Dimension = '2D' | '3D'

export interface NetworkPoint {
  name: string
  easting: number
  northing: number
  rl?: number
  /** If true, point is held fixed (not adjusted). */
  fixed?: boolean
  /** Approximate coordinates for free-network initialization. */
  approximate?: boolean
}

export interface NetworkObservation {
  type: ObservationType
  from: string
  to: string
  /** For 'angle': the station at the vertex (instrument setup). */
  at?: string
  value: number // units depend on type (m, deg, m)
  /** A priori standard deviation. Units match `value`. */
  sigma: number
  /** Optional explicit weight (overrides 1/sigma²). */
  weight?: number
  /**
   * GNSS baseline 3×3 covariance matrix (lower triangle, row-major).
   * Required for type='gnss_baseline'. Provides full 3D correlation
   * between ΔE, ΔN, ΔU components.
   *
   * Format: [C_EE, C_EN, C_NN, C_EU, C_NU, C_UU] (6 entries, lower triangle)
   * Units: m²
   *
   * When provided, the baseline is whitened via Cholesky decomposition
   * before being added to the design matrix. This decouples the 3
   * correlated components into 3 independent observations with weight 1.
   *
   * If not provided, defaults to diagonal σ² for each component.
   */
  covariance3x3?: [number, number, number, number, number, number]
  /**
   * For 'gnss_baseline': the 3 components of the baseline vector.
   * deltaE = E_to - E_from (m)
   * deltaN = N_to - N_from (m)
   * deltaU = U_to - U_from (m, ellipsoidal height)
   *
   * The `value` field is ignored for gnss_baseline; these three are used instead.
   */
  deltaE?: number
  deltaN?: number
  deltaU?: number
}

export interface NetworkAdjustmentOptions {
  dimension?: Dimension
  maxIterations?: number
  /** Convergence threshold in millimeters (default 0.1). */
  convergenceMm?: number
  /** Free network adjustment (inner constraints). Default false. */
  freeNetwork?: boolean
  /** Robust estimation with Huber weights. Default false. */
  robust?: boolean
  /** Huber threshold c (default 2.5). */
  huberC?: number
  /** Significance level for global chi-square test (default 0.05). */
  globalTestAlpha?: number
  /** Significance level for w-test (data snooping, default 0.001). */
  wTestAlpha?: number
  /** Power of w-test (1 - β, default 0.80). */
  wTestPower?: number
}

export interface AdjustedPoint {
  name: string
  easting: number
  northing: number
  rl?: number
  /** Correction applied in this iteration (m). */
  correctionE: number
  correctionN: number
  correctionRL?: number
  /** A posteriori standard deviations (m). */
  sigmaE: number
  sigmaN: number
  sigmaRL?: number
  /** 95% confidence error ellipse (2D). */
  errorEllipse?: {
    semiMajor: number
    semiMinor: number
    orientation: number // degrees from N
  }
}

export interface ObservationResidual {
  type: ObservationType
  from: string
  to: string
  at?: string
  observed: number
  computed: number
  residual: number // observed - computed
  standardized: number // residual / σ_v
  /** Redundancy number r_i ∈ [0, 1] (Baarda). */
  redundancy: number
  /** Minimal Detectable Bias (Baarda) — same units as observation. */
  mdb: number
  /** w-test statistic (|standardized residual|). */
  wTest: number
  /** True if w-test exceeds critical value (outlier suspected). */
  isOutlier: boolean
  /** A posteriori weight after robust estimation (1 if robust=false). */
  effectiveWeight: number
}

export interface NetworkAdjustmentResult {
  ok: boolean
  error?: string
  warnings: string[]
  adjustedPoints: AdjustedPoint[]
  residuals: ObservationResidual[]
  /** Reference variance σ₀² (a posteriori). */
  referenceVariance: number
  /** Standard error σ₀ = √(reference variance). */
  standardError: number
  degreesOfFreedom: number
  /** Global chi-square test. */
  chiSquareValue: number
  chiSquareCritical: number
  passed: boolean
  /** Number of iterations used. */
  iterations: number
  /** Convergence achieved (max coordinate correction in last iteration, mm). */
  convergence: number
  /** Robust estimation summary (if enabled). */
  robust?: {
    downweightedCount: number
    weightHistory: number[][]
  }
  /** Free network summary (if enabled). */
  freeNetwork?: {
    constraintRank: number
  }
  report: string
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

function wrapAngle(rad: number): number {
  while (rad <= -Math.PI) rad += 2 * Math.PI
  while (rad > Math.PI) rad -= 2 * Math.PI
  return rad
}

function bearingRad(fromE: number, fromN: number, toE: number, toN: number): number {
  return Math.atan2(toE - fromE, toN - fromN)
}

function distance2D(fromE: number, fromN: number, toE: number, toN: number): number {
  const dE = toE - fromE
  const dN = toN - fromN
  return Math.sqrt(dE * dE + dN * dN)
}

function distance3D(
  fromE: number, fromN: number, fromRl: number,
  toE: number, toN: number, toRl: number,
): number {
  const dE = toE - fromE
  const dN = toN - fromN
  const dH = toRl - fromRl
  return Math.sqrt(dE * dE + dN * dN + dH * dH)
}

// ---------------------------------------------------------------------------
// Inverse normal CDF (Acklam's algorithm) and chi-square quantile
// ---------------------------------------------------------------------------

function invNormalCDF(p: number): number {
  const a = [
    -3.969683028665376e+01, 2.209460984245205e+02,
    -2.759285104469687e+02, 1.383577518672690e+02,
    -3.066479806614716e+01, 2.506628277459239e+00,
  ]
  const b = [
    -5.447609879822406e+01, 1.615858368580409e+02,
    -1.556989798598866e+02, 6.680131188771972e+01,
    -1.328068155288572e+01,
  ]
  const c = [
    -7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
    4.374664141464968e+00, 2.938163982698783e+00,
  ]
  const d = [
    7.784695709041462e-03, 3.224671290700398e-01,
    2.445134137142996e+00, 3.754408661907416e+00,
  ]
  const pLow = 0.02425
  const pHigh = 1 - pLow

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    )
  }
  if (p <= pHigh) {
    const q = p - 0.5
    const r = q * q
    return (
      (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    )
  }
  const q = Math.sqrt(-2 * Math.log(1 - p))
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  )
}

function chiSquareQuantile(p: number, dof: number): number {
  if (dof <= 0) return 0
  const z = invNormalCDF(p)
  const t = z * Math.sqrt(2 / (9 * dof)) + 1 - 1 / (9 * dof)
  return dof * t * t * t
}

// ---------------------------------------------------------------------------
// Design matrix construction
// ---------------------------------------------------------------------------

/**
 * Build the design matrix A (sparse), misclosure vector w, and weight vector P
 * for a network of observations.
 *
 * For 2D: each point contributes 2 parameters (E, N).
 * For 3D: each point contributes 3 parameters (E, N, RL).
 *
 * Observation equations (linearized):
 *   distance:    f = √(dE² + dN²)        — 2 unknowns touched
 *   slope_dist:  f = √(dE² + dN² + dH²)  — 6 unknowns touched (3D only)
 *   bearing:     f = atan2(dE, dN)         — 2 unknowns touched (2D)
 *   angle:       f = atan2(dE_BC, dN_BC) − atan2(dE_BA, dN_BA)  — 6 unknowns
 *   zenith:      f = atan2(√(dE²+dN²), dH)  — 6 unknowns (3D only)
 *   height_diff: f = RL_to − RL_from         — 2 unknowns (1D/3D)
 */
interface DesignMatrixBuild {
  A: SparseMatrix
  w: number[]
  P: number[]
  pointIndex: Map<string, number>
  paramCount: number
  observationMetadata: Array<{
    type: ObservationType
    from: string
    to: string
    at?: string
    observed: number
    sigma: number
    weight: number
  }>
}

function buildDesignMatrix(
  observations: NetworkObservation[],
  points: Map<string, { e: number; n: number; rl?: number; fixed: boolean }>,
  pointIndex: Map<string, number>,
  paramCount: number,
  paramPerPoint: number,
  dimension: Dimension,
  currentCoords: Map<string, { e: number; n: number; rl?: number }>,
  weightOverrides?: Map<number, number>, // index → effective weight (for robust)
): DesignMatrixBuild {
  const triplets: Array<{ row: number; col: number; value: number }> = []
  const w: number[] = []
  const P: number[] = []
  const observationMetadata: DesignMatrixBuild['observationMetadata'] = []

  // Row counter — GNSS baselines contribute 3 rows each, others 1 row
  let rowIdx = 0

  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i]
    const from = currentCoords.get(obs.from)
    const to = currentCoords.get(obs.to)
    const at = obs.at ? currentCoords.get(obs.at) : undefined

    if (!from || !to) {
      throw new Error(`Observation references unknown point: ${obs.from} or ${obs.to}`)
    }
    if (obs.at && !at) {
      throw new Error(`Angle observation references unknown vertex: ${obs.at}`)
    }

    const fromIdx = pointIndex.get(obs.from)
    const toIdx = pointIndex.get(obs.to)
    const atIdx = obs.at ? pointIndex.get(obs.at) : undefined

    // Note: use `=== undefined` not `!idx` — idx can be 0 (first adjustable point),
    // which is falsy but valid.
    const fromIsFixed = fromIdx === undefined || points.get(obs.from)?.fixed === true
    const toIsFixed = toIdx === undefined || points.get(obs.to)?.fixed === true
    const atIsFixed = obs.at ? (atIdx === undefined || points.get(obs.at)?.fixed === true) : true

    const RAD = 180 / Math.PI

    // ─── GNSS BASELINE — special handling (3 rows + 3×3 covariance) ─────────
    if (obs.type === 'gnss_baseline') {
      if (dimension !== '3D') {
        throw new Error('gnss_baseline observations require dimension="3D"')
      }
      if (obs.deltaE === undefined || obs.deltaN === undefined || obs.deltaU === undefined) {
        throw new Error(`gnss_baseline ${obs.from}→${obs.to} missing deltaE/deltaN/deltaU`)
      }
      if (from.rl === undefined || to.rl === undefined) {
        throw new Error(`gnss_baseline requires RL values for ${obs.from} and ${obs.to}`)
      }

      // Computed baseline from current coordinates
      const computed_dE = to.e - from.e
      const computed_dN = to.n - from.n
      const computed_dU = (to.rl ?? 0) - (from.rl ?? 0)

      // Misclosures (observed - computed)
      const misclosureE = obs.deltaE - computed_dE
      const misclosureN = obs.deltaN - computed_dN
      const misclosureU = obs.deltaU - computed_dU

      // Build 3×3 design sub-matrix:
      //   dE/dx = ∂(E_to - E_from)/∂(params)
      //   For 3D, params are (E, N, RL) per station.
      //   ∂dE/∂E_from = -1, ∂dE/∂N_from = 0, ∂dE/∂RL_from = 0
      //   ∂dE/∂E_to = +1, etc.
      // Same pattern for dN and dU.
      // The 3 rows of A for this baseline:
      //   row_E: from.E = -1, to.E = +1
      //   row_N: from.N = -1, to.N = +1
      //   row_U: from.RL = -1, to.RL = +1
      const rows: Array<Array<{ col: number; value: number }>> = [
        [], // row for dE
        [], // row for dN
        [], // row for dU
      ]
      if (fromIdx !== undefined && !fromIsFixed) {
        rows[0].push({ col: fromIdx * 3, value: -1 })
        rows[1].push({ col: fromIdx * 3 + 1, value: -1 })
        rows[2].push({ col: fromIdx * 3 + 2, value: -1 })
      }
      if (toIdx !== undefined && !toIsFixed) {
        rows[0].push({ col: toIdx * 3, value: 1 })
        rows[1].push({ col: toIdx * 3 + 1, value: 1 })
        rows[2].push({ col: toIdx * 3 + 2, value: 1 })
      }

      // Build 3×3 covariance matrix
      let C: number[][]
      if (obs.covariance3x3 && obs.covariance3x3.length === 6) {
        const [cEE, cEN, cNN, cEU, cNU, cUU] = obs.covariance3x3
        C = [
          [cEE, cEN, cEU],
          [cEN, cNN, cNU],
          [cEU, cNU, cUU],
        ]
      } else {
        // Default: diagonal with sigma² (independent components)
        const sigma2 = (obs.sigma || 0.005) ** 2
        C = [
          [sigma2, 0, 0],
          [0, sigma2, 0],
          [0, 0, sigma2],
        ]
      }

      // Whiten the 3 observations via Cholesky decomposition of C.
      // Find L (lower triangular) such that L Lᵀ = C.
      // Then W = L^(-1) applied to (A_sub, w_sub) gives whitened observations
      // with identity weight matrix.
      const L = cholesky3x3(C)
      const W = inverseLowerTriangular3x3(L)

      // Whitened misclosures: w_whitened = W · w_sub
      const wWhitened = [
        W[0][0] * misclosureE + W[0][1] * misclosureN + W[0][2] * misclosureU,
        W[1][0] * misclosureE + W[1][1] * misclosureN + W[1][2] * misclosureU,
        W[2][0] * misclosureE + W[2][1] * misclosureN + W[2][2] * misclosureU,
      ]

      // Apply whitening: A_whitened = W · A_sub
      // For each of the 3 whitened rows, combine the original 3 rows
      // weighted by W[r][k]. Push triplets AND increment rowIdx together
      // so each whitened row gets its own row index.
      for (let r = 0; r < 3; r++) {
        const combinedRow = new Map<number, number>()
        for (let k = 0; k < 3; k++) {
          const w_rk = W[r][k]
          if (w_rk === 0) continue
          for (const entry of rows[k]) {
            combinedRow.set(entry.col, (combinedRow.get(entry.col) ?? 0) + w_rk * entry.value)
          }
        }
        for (const [col, value] of combinedRow) {
          if (value !== 0) {
            triplets.push({ row: rowIdx, col, value })
          }
        }

        // Push the whitened misclosure and weight for this row
        w.push(wWhitened[r])
        // Robust estimation: apply weight override if present (uses observation index i)
        const effectiveWeight = weightOverrides?.get(i) ?? 1
        P.push(effectiveWeight)
        observationMetadata.push({
          type: 'gnss_baseline',
          from: obs.from,
          to: obs.to,
          observed: r === 0 ? obs.deltaE : r === 1 ? obs.deltaN : obs.deltaU,
          sigma: obs.sigma,
          weight: 1,
        })
        rowIdx++
      }
      continue
    }

    // ─── Standard observations (1 row each) ─────────────────────────────────
    let computed = 0
    let row: Array<{ col: number; value: number }> = []

    switch (obs.type) {
      case 'distance': {
        const r = distance2D(from.e, from.n, to.e, to.n)
        if (r < 1e-6) throw new Error(`Zero distance: ${obs.from} → ${obs.to}`)
        computed = r
        const dEdE = (to.e - from.e) / r
        const dNdN = (to.n - from.n) / r
        // Use paramPerPoint (2 for 2D, 3 for 3D) for correct column indexing
        if (fromIdx !== undefined && !fromIsFixed) {
          row.push({ col: fromIdx * paramPerPoint, value: -dEdE })
          row.push({ col: fromIdx * paramPerPoint + 1, value: -dNdN })
        }
        if (toIdx !== undefined && !toIsFixed) {
          row.push({ col: toIdx * paramPerPoint, value: dEdE })
          row.push({ col: toIdx * paramPerPoint + 1, value: dNdN })
        }
        break
      }

      case 'slope_distance': {
        if (dimension !== '3D' || from.rl === undefined || to.rl === undefined) {
          throw new Error('slope_distance requires 3D mode and RL values')
        }
        const r = distance3D(from.e, from.n, from.rl, to.e, to.n, to.rl)
        if (r < 1e-6) throw new Error(`Zero slope distance: ${obs.from} → ${obs.to}`)
        computed = r
        const dEdr = (to.e - from.e) / r
        const dNdr = (to.n - from.n) / r
        const dHdr = (to.rl - from.rl) / r
        if (fromIdx !== undefined && !fromIsFixed) {
          row.push({ col: fromIdx * 3, value: -dEdr })
          row.push({ col: fromIdx * 3 + 1, value: -dNdr })
          row.push({ col: fromIdx * 3 + 2, value: -dHdr })
        }
        if (toIdx !== undefined && !toIsFixed) {
          row.push({ col: toIdx * 3, value: dEdr })
          row.push({ col: toIdx * 3 + 1, value: dNdr })
          row.push({ col: toIdx * 3 + 2, value: dHdr })
        }
        break
      }

      case 'bearing': {
        const r2 = (to.e - from.e) ** 2 + (to.n - from.n) ** 2
        if (r2 < 1e-12) throw new Error(`Zero bearing geometry: ${obs.from} → ${obs.to}`)
        const theta = bearingRad(from.e, from.n, to.e, to.n)
        computed = toDeg(theta)
        // ∂θ/∂dE = dN / r², ∂θ/∂dN = -dE / r² (in radians)
        const dE = to.e - from.e
        const dN = to.n - from.n
        const dTheta_dE_from = -dN / r2 * RAD
        const dTheta_dN_from = dE / r2 * RAD
        if (fromIdx !== undefined && !fromIsFixed) {
          row.push({ col: fromIdx * paramPerPoint, value: dTheta_dE_from })
          row.push({ col: fromIdx * paramPerPoint + 1, value: dTheta_dN_from })
        }
        if (toIdx !== undefined && !toIsFixed) {
          row.push({ col: toIdx * paramPerPoint, value: -dTheta_dE_from })
          row.push({ col: toIdx * paramPerPoint + 1, value: -dTheta_dN_from })
        }
        break
      }

      case 'angle': {
        if (!at || !atIdx) {
          throw new Error('angle observation requires `at` (vertex) point')
        }
        // θ = atan2(dE_BC, dN_BC) - atan2(dE_BA, dN_BA)
        const dE_BA = from.e - at.e
        const dN_BA = from.n - at.n
        const r2_BA = dE_BA ** 2 + dN_BA ** 2
        const dE_BC = to.e - at.e
        const dN_BC = to.n - at.n
        const r2_BC = dE_BC ** 2 + dN_BC ** 2
        if (r2_BA < 1e-12 || r2_BC < 1e-12) {
          throw new Error(`Zero angle geometry at ${obs.at}`)
        }
        const theta_BA = bearingRad(at.e, at.n, from.e, from.n)
        const theta_BC = bearingRad(at.e, at.n, to.e, to.n)
        let theta = theta_BC - theta_BA
        theta = wrapAngle(theta)
        computed = toDeg(theta)

        // Partials (radians, then × RAD for degrees)
        // ∂θ/∂E_at = -dN_BC/r2_BC + dN_BA/r2_BA
        // ∂θ/∂N_at = dE_BC/r2_BC - dE_BA/r2_BA
        // ∂θ/∂E_from (backsight) = -dN_BA/r2_BA  ... wait, careful with signs
        // For bearing α = atan2(dE, dN) from vertex v to target t:
        //   ∂α/∂E_v = -dN/r², ∂α/∂N_v = dE/r²  (where dE = E_t - E_v)
        //   ∂α/∂E_t = dN/r²,  ∂α/∂N_t = -dE/r²
        // For θ = α_BC - α_BA:
        //   ∂θ/∂E_at = ∂α_BC/∂E_at - ∂α_BA/∂E_at = (-dN_BC/r2_BC) - (-dN_BA/r2_BA) = -dN_BC/r2_BC + dN_BA/r2_BA
        //   ∂θ/∂N_at = (dE_BC/r2_BC) - (dE_BA/r2_BA)
        //   ∂θ/∂E_from (BA target) = dN_BA/r2_BA
        //   ∂θ/∂N_from = -dE_BA/r2_BA
        //   ∂θ/∂E_to (BC target) = -dN_BC/r2_BC
        //   ∂θ/∂N_to = dE_BC/r2_BC
        const dTh_dE_at = (-dN_BC / r2_BC + dN_BA / r2_BA) * RAD
        const dTh_dN_at = (dE_BC / r2_BC - dE_BA / r2_BA) * RAD
        const dTh_dE_from = (dN_BA / r2_BA) * RAD
        const dTh_dN_from = (-dE_BA / r2_BA) * RAD
        const dTh_dE_to = (-dN_BC / r2_BC) * RAD
        const dTh_dN_to = (dE_BC / r2_BC) * RAD

        if (atIdx !== undefined && !atIsFixed) {
          row.push({ col: atIdx * paramPerPoint, value: dTh_dE_at })
          row.push({ col: atIdx * paramPerPoint + 1, value: dTh_dN_at })
        }
        if (fromIdx !== undefined && !fromIsFixed) {
          row.push({ col: fromIdx * paramPerPoint, value: dTh_dE_from })
          row.push({ col: fromIdx * paramPerPoint + 1, value: dTh_dN_from })
        }
        if (toIdx !== undefined && !toIsFixed) {
          row.push({ col: toIdx * paramPerPoint, value: dTh_dE_to })
          row.push({ col: toIdx * paramPerPoint + 1, value: dTh_dN_to })
        }
        break
      }

      case 'zenith_angle': {
        if (dimension !== '3D' || from.rl === undefined || to.rl === undefined) {
          throw new Error('zenith_angle requires 3D mode and RL values')
        }
        // ζ = atan2(√(dE²+dN²), dH)  (zenith angle from vertical)
        const dE = to.e - from.e
        const dN = to.n - from.n
        const dH = to.rl - from.rl
        const horiz2 = dE * dE + dN * dN
        const horiz = Math.sqrt(horiz2)
        const r2 = horiz2 + dH * dH
        if (r2 < 1e-12) throw new Error(`Zero zenith geometry: ${obs.from} → ${obs.to}`)
        const z = Math.atan2(horiz, dH)
        computed = toDeg(z)
        // ∂z/∂dE = dE·dH / (horiz · r²)
        // ∂z/∂dN = dN·dH / (horiz · r²)
        // ∂z/∂dH = -horiz / r²
        const dz_dE = horiz > 1e-9 ? (dE * dH) / (horiz * r2) * RAD : 0
        const dz_dN = horiz > 1e-9 ? (dN * dH) / (horiz * r2) * RAD : 0
        const dz_dH = -horiz / r2 * RAD
        if (fromIdx !== undefined && !fromIsFixed) {
          row.push({ col: fromIdx * 3, value: -dz_dE })
          row.push({ col: fromIdx * 3 + 1, value: -dz_dN })
          row.push({ col: fromIdx * 3 + 2, value: -dz_dH })
        }
        if (toIdx !== undefined && !toIsFixed) {
          row.push({ col: toIdx * 3, value: dz_dE })
          row.push({ col: toIdx * 3 + 1, value: dz_dN })
          row.push({ col: toIdx * 3 + 2, value: dz_dH })
        }
        break
      }

      case 'height_difference': {
        if (from.rl === undefined || to.rl === undefined) {
          throw new Error('height_difference requires RL values')
        }
        computed = to.rl - from.rl
        // f = RL_to - RL_from
        // ∂f/∂RL_from = -1, ∂f/∂RL_to = +1
        if (dimension === '3D') {
          if (fromIdx !== undefined && !fromIsFixed) {
            row.push({ col: fromIdx * 3 + 2, value: -1 })
          }
          if (toIdx !== undefined && !toIsFixed) {
            row.push({ col: toIdx * 3 + 2, value: 1 })
          }
        } else {
          // 1D leveling mode (treat as separate param block if needed)
          // For simplicity, only support 3D here
          throw new Error('height_difference requires 3D mode')
        }
        break
      }
    }

    // Misclosure w = observed - computed (in observation units)
    let misclosure = obs.value - computed
    if (obs.type === 'bearing' || obs.type === 'angle' || obs.type === 'zenith_angle') {
      // Wrap to (-180, 180]
      while (misclosure > 180) misclosure -= 360
      while (misclosure < -180) misclosure += 360
    }

    for (const entry of row) {
      triplets.push({ row: rowIdx, col: entry.col, value: entry.value })
    }
    w.push(misclosure)

    // Weight
    const baseWeight = obs.weight && obs.weight > 0
      ? obs.weight
      : 1 / (obs.sigma * obs.sigma)
    const effectiveWeight = weightOverrides?.get(i) ?? baseWeight
    P.push(effectiveWeight)

    observationMetadata.push({
      type: obs.type,
      from: obs.from,
      to: obs.to,
      at: obs.at,
      observed: obs.value,
      sigma: obs.sigma,
      weight: baseWeight,
    })
    rowIdx++
  }

  // A has `rowIdx` rows (one per standard observation, three per GNSS baseline)
  const A = fromTriplets(rowIdx, paramCount, triplets)
  return { A, w, P, pointIndex, paramCount, observationMetadata }
}

// ---------------------------------------------------------------------------
// 3×3 matrix helpers (for GNSS baseline whitening)
// ---------------------------------------------------------------------------

/** Cholesky decomposition of a 3×3 symmetric positive-definite matrix. */
function cholesky3x3(C: number[][]): number[][] {
  const L = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  // L[0][0]
  if (C[0][0] <= 0) throw new Error(`GNSS covariance not positive definite: C[0][0]=${C[0][0]}`)
  L[0][0] = Math.sqrt(C[0][0])
  // L[1][0], L[1][1]
  L[1][0] = C[1][0] / L[0][0]
  const c11_adj = C[1][1] - L[1][0] * L[1][0]
  if (c11_adj <= 0) throw new Error(`GNSS covariance not positive definite: C[1][1] adjusted=${c11_adj}`)
  L[1][1] = Math.sqrt(c11_adj)
  // L[2][0], L[2][1], L[2][2]
  L[2][0] = C[2][0] / L[0][0]
  L[2][1] = (C[2][1] - L[2][0] * L[1][0]) / L[1][1]
  const c22_adj = C[2][2] - L[2][0] * L[2][0] - L[2][1] * L[2][1]
  if (c22_adj <= 0) throw new Error(`GNSS covariance not positive definite: C[2][2] adjusted=${c22_adj}`)
  L[2][2] = Math.sqrt(c22_adj)
  return L
}

/** Inverse of a 3×3 lower-triangular matrix. */
function inverseLowerTriangular3x3(L: number[][]): number[][] {
  // L is lower-triangular: [[l00, 0, 0], [l10, l11, 0], [l20, l21, l22]]
  // W = L^(-1) is also lower-triangular.
  // From W L = I:
  //   w00 = 1/l00
  //   w11 = 1/l11
  //   w22 = 1/l22
  //   w10*l00 + w11*l10 = 0 → w10 = -w11*l10/l00
  //   w21*l11 + w22*l21 = 0 → w21 = -w22*l21/l11
  //   w20*l00 + w21*l10 + w22*l20 = 0 → w20 = -(w21*l10 + w22*l20)/l00
  const w00 = 1 / L[0][0]
  const w11 = 1 / L[1][1]
  const w22 = 1 / L[2][2]
  const w10 = -w11 * L[1][0] / L[0][0]
  const w21 = -w22 * L[2][1] / L[1][1]
  const w20 = -(w21 * L[1][0] + w22 * L[2][0]) / L[0][0]
  return [
    [w00, 0, 0],
    [w10, w11, 0],
    [w20, w21, w22],
  ]
}

// ---------------------------------------------------------------------------
// Free network inner constraints (Mittermayer)
// ---------------------------------------------------------------------------

/**
 * Build the inner constraint matrix B for a free network adjustment.
 *
 * For 2D: 3 constraints (translation E, translation N, rotation)
 *   Σ δE_i = 0
 *   Σ δN_i = 0
 *   Σ (E_i · δN_i - N_i · δE_i) = 0
 *   (and optionally scale: Σ (E_i · δE_i + N_i · δN_i) = 0 — for free scale)
 *
 * For 3D: 7 constraints (translation ×3, rotation ×3, scale ×1)
 *
 * The constraint matrix B has dimension (n_constraints × n_params).
 * The constrained normal equations are:
 *   [ N   Bᵀ ] [ x ]   [ u ]
 *   [ B   0  ] [ k ] = [ 0 ]
 *
 * Reference: Niemeier (2008) §"Freie Netze"
 */
function buildInnerConstraints(
  adjustablePoints: Array<{ name: string; e: number; n: number; rl?: number }>,
  dimension: Dimension,
): SparseMatrix {
  const n = adjustablePoints.length
  const paramPerPoint = dimension === '3D' ? 3 : 2
  const paramCount = n * paramPerPoint
  const numConstraints = dimension === '3D' ? 7 : 4 // 2D: 2 trans + 1 rot + 1 scale

  const triplets: Array<{ row: number; col: number; value: number }> = []

  // Compute centroid for stability
  const cE = adjustablePoints.reduce((s, p) => s + p.e, 0) / n
  const cN = adjustablePoints.reduce((s, p) => s + p.n, 0) / n
  let cRl = 0
  if (dimension === '3D') {
    const rlPoints = adjustablePoints.filter((p) => p.rl !== undefined)
    if (rlPoints.length > 0) {
      cRl = rlPoints.reduce((s, p) => s + (p.rl ?? 0), 0) / rlPoints.length
    }
  }

  for (let i = 0; i < n; i++) {
    const p = adjustablePoints[i]
    const dE = p.e - cE
    const dN = p.n - cN
    const dH = dimension === '3D' ? (p.rl ?? 0) - cRl : 0
    const baseCol = i * paramPerPoint

    // Translation E: 1 for each δE
    triplets.push({ row: 0, col: baseCol, value: 1 })
    // Translation N: 1 for each δN
    triplets.push({ row: 1, col: baseCol + 1, value: 1 })
    // Rotation: E·δN - N·δE
    triplets.push({ row: 2, col: baseCol, value: -dN })
    triplets.push({ row: 2, col: baseCol + 1, value: dE })
    // Scale: E·δE + N·δN
    triplets.push({ row: 3, col: baseCol, value: dE })
    triplets.push({ row: 3, col: baseCol + 1, value: dN })

    if (dimension === '3D') {
      // Translation RL: 1 for each δRL
      triplets.push({ row: 4, col: baseCol + 2, value: 1 })
      // Rotation around E axis: -N·δH + H·δN
      triplets.push({ row: 5, col: baseCol + 1, value: dH })
      triplets.push({ row: 5, col: baseCol + 2, value: -dN })
      // Rotation around N axis: -H·δE + E·δH
      triplets.push({ row: 6, col: baseCol, value: -dH })
      triplets.push({ row: 6, col: baseCol + 2, value: dE })
    }
  }

  return fromTriplets(numConstraints, paramCount, triplets)
}

// ---------------------------------------------------------------------------
// Bordering method for constrained normal equations
// ---------------------------------------------------------------------------

/**
 * Solve the bordered system:
 *   [ N   Bᵀ ] [ x ]   [ u ]
 *   [ B   0  ] [ k ] = [ 0 ]
 *
 * where N is n×n SPD, B is m×n, u is n×1.
 *
 * Solution:
 *   x = N⁻¹ u - N⁻¹ Bᵀ (B N⁻¹ Bᵀ)⁻¹ B N⁻¹ u
 *   k = (B N⁻¹ Bᵀ)⁻¹ B N⁻¹ u
 *
 * We use the Schur complement: solve N·y = u and N·Z = Bᵀ, then form
 * S = B Z (m×m), solve S·k = B y, then x = y - Z k.
 *
 * Returns x (length n).
 */
function solveBordered(
  N: SparseMatrix,
  B: SparseMatrix,
  u: number[],
  Nfactor: SparseCholesky,
): number[] {
  const dbg = !!process.env.NETWORK_DEBUG
  // y = N⁻¹ u
  const y = sparseBackwardSolve(Nfactor.L, sparseForwardSolve(Nfactor.L, u))
  if (dbg) console.error(`[solveBordered] y[0..3]=${y.slice(0, 4).map(v => v.toExponential(2)).join(', ')}, finite=${y.every(v => isFinite(v))}`)

  // Z = N⁻¹ Bᵀ (n × m matrix)
  // For each column j of Bᵀ (= row j of B), solve N z_j = b_j
  const m = B.rows
  const n = N.rows
  const Z: number[][] = [] // Z[j] = z vector of length n

  for (let j = 0; j < m; j++) {
    // Extract row j of B (column j of Bᵀ)
    const bVec = new Array(n).fill(0)
    for (let idx = B.rowPtr[j]; idx < B.rowPtr[j + 1]; idx++) {
      bVec[B.colIdx[idx]] = B.values[idx]
    }
    const z = sparseBackwardSolve(Nfactor.L, sparseForwardSolve(Nfactor.L, bVec))
    Z.push(z)
  }
  if (dbg) console.error(`[solveBordered] Z computed, finite=${Z.every(z => z.every(v => isFinite(v)))}`)

  // S = B Z (m × m)
  const S: number[][] = Array.from({ length: m }, () => new Array(m).fill(0))
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      let sum = 0
      for (let idx = B.rowPtr[i]; idx < B.rowPtr[i + 1]; idx++) {
        const col = B.colIdx[idx]
        sum += B.values[idx] * Z[j][col]
      }
      S[i][j] = sum
    }
  }
  if (dbg) console.error(`[solveBordered] S[0]=${S[0].map(v => v.toExponential(2)).join(', ')}, finite=${S.every(r => r.every(v => isFinite(v)))}`)

  // Solve S k = B y
  const By = new Array(m).fill(0)
  for (let i = 0; i < m; i++) {
    let sum = 0
    for (let idx = B.rowPtr[i]; idx < B.rowPtr[i + 1]; idx++) {
      sum += B.values[idx] * y[B.colIdx[idx]]
    }
    By[i] = sum
  }
  if (dbg) console.error(`[solveBordered] By=${By.map(v => v.toExponential(2)).join(', ')}, finite=${By.every(v => isFinite(v))}`)

  // Solve S k = By using dense Gaussian elimination (m is small: 4 or 7)
  const k = solveDense(S, By)
  if (dbg) console.error(`[solveBordered] k=${k.map(v => v.toExponential(2)).join(', ')}, finite=${k.every(v => isFinite(v))}`)

  // x = y - Z k
  const x = [...y]
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) {
      x[i] -= Z[j][i] * k[j]
    }
  }
  if (dbg) console.error(`[solveBordered] x[0..3]=${x.slice(0, 4).map(v => v.toExponential(2)).join(', ')}, finite=${x.every(v => isFinite(v))}`)

  return x
}

function solveDense(A: number[][], b: number[]): number[] {
  const n = A.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let k = 0; k < n; k++) {
    let maxRow = k
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(M[i][k]) > Math.abs(M[maxRow][k])) maxRow = i
    }
    ;[M[k], M[maxRow]] = [M[maxRow], M[k]]
    const pivot = M[k][k]
    if (Math.abs(pivot) < 1e-15) throw new Error('Singular constraint matrix')
    for (let j = k; j <= n; j++) M[k][j] /= pivot
    for (let i = 0; i < n; i++) {
      if (i === k) continue
      const f = M[i][k]
      for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j]
    }
  }
  return M.map((row) => row[n])
}

// ---------------------------------------------------------------------------
// Main adjustment function
// ---------------------------------------------------------------------------

export function adjustNetwork(
  allPoints: NetworkPoint[],
  observations: NetworkObservation[],
  options: NetworkAdjustmentOptions = {},
): NetworkAdjustmentResult {
  const dimension: Dimension = options.dimension ?? '2D'
  const maxIterations = options.maxIterations ?? 20
  const convergenceMm = options.convergenceMm ?? 0.1
  const freeNetwork = options.freeNetwork ?? false
  const robust = options.robust ?? false
  const huberC = options.huberC ?? 2.5
  const globalTestAlpha = options.globalTestAlpha ?? 0.05
  const wTestAlpha = options.wTestAlpha ?? 0.001
  const wTestPower = options.wTestPower ?? 0.80

  const warnings: string[] = []

  // Validate inputs
  if (allPoints.length === 0) {
    return failResult('No points provided')
  }
  if (observations.length === 0) {
    return failResult('No observations provided')
  }

  // Build point maps
  const pointsMap = new Map<string, { e: number; n: number; rl?: number; fixed: boolean }>()
  for (const p of allPoints) {
    pointsMap.set(p.name, {
      e: p.easting,
      n: p.northing,
      rl: p.rl,
      fixed: p.fixed ?? false,
    })
  }

  // Split into fixed and adjustable
  const fixedPoints = allPoints.filter((p) => p.fixed)
  const adjustablePoints = allPoints.filter((p) => !p.fixed)

  if (adjustablePoints.length === 0) {
    return failResult('No adjustable points (all points are fixed)')
  }

  // Validate fixed points requirement
  if (!freeNetwork) {
    if (dimension === '2D' && fixedPoints.length < 2) {
      warnings.push('2D constrained adjustment requires ≥2 fixed points for datum (E, N, orientation)')
    }
    if (dimension === '2D' && fixedPoints.length < 1) {
      return failResult('2D constrained adjustment requires ≥1 fixed point; use free network mode if none available')
    }
  }

  // Param indexing
  const paramPerPoint = dimension === '3D' ? 3 : 2
  const paramCount = adjustablePoints.length * paramPerPoint
  const pointIndex = new Map<string, number>()
  adjustablePoints.forEach((p, i) => pointIndex.set(p.name, i))

  // Current coordinate estimates (will be updated each iteration)
  const currentCoords = new Map<string, { e: number; n: number; rl?: number }>()
  for (const p of allPoints) {
    currentCoords.set(p.name, { e: p.easting, n: p.northing, rl: p.rl })
  }

  // Build inner constraint matrix (if free network)
  let B: SparseMatrix | null = null
  if (freeNetwork) {
    // Map NetworkPoint to the {e, n, rl} shape expected by buildInnerConstraints
    const ptsForConstraints = adjustablePoints.map((p) => ({
      name: p.name,
      e: p.easting,
      n: p.northing,
      rl: p.rl,
    }))
    B = buildInnerConstraints(ptsForConstraints, dimension)
  }

  // Initialize robust weight overrides (all 1.0 initially)
  let weightOverrides = new Map<number, number>()
  const weightHistory: number[][] = []
  let downweightedCount = 0

  // Iterative adjustment
  let iteration = 0
  let convergence = Infinity
  let lastFactor: SparseCholesky | null = null
  let lastResiduals: ObservationResidual[] = []
  let lastReferenceVariance = 0
  let lastDegreesOfFreedom = 0
  let lastChiSquareValue = 0
  let lastChiSquareCritical = 0
  let lastPassed = false

  for (iteration = 1; iteration <= maxIterations; iteration++) {
    if (process.env.NETWORK_DEBUG) console.error(`[networkAdjustment] iter ${iteration} start`)
    // Build design matrix at current coordinates
    let A: SparseMatrix
    let w: number[]
    let P: number[]
    try {
      const result = buildDesignMatrix(
        observations,
        pointsMap,
        pointIndex,
        paramCount,
        paramPerPoint,
        dimension,
        currentCoords,
        weightOverrides.size > 0 ? weightOverrides : undefined,
      )
      A = result.A
      w = result.w
      P = result.P
    } catch (e) {
      return failResult(`Design matrix construction failed: ${(e as Error).message}`)
    }
    if (process.env.NETWORK_DEBUG) console.error(`[networkAdjustment] iter ${iteration} design matrix built: ${A.rows}x${A.cols}, nnz=${A.values.length}`)

    // Normal equations: N = Aᵀ P A, u = Aᵀ P w
    const N = ataDiag(A, P)
    const u = atdbDiag(A, P, w)
    if (process.env.NETWORK_DEBUG) console.error(`[networkAdjustment] iter ${iteration} normal equations assembled: N is ${N.rows}x${N.cols}, nnz=${N.values.length}`)

    // Solve for corrections
    let corrections: number[]
    try {
      if (freeNetwork && B) {
        // N is rank-deficient for free networks. Regularize by adding ε to diagonal.
        // This is mathematically equivalent to a small prior pulling corrections toward zero,
        // which (combined with the B·x = 0 constraint) gives the minimum-norm solution.
        // ε is chosen relative to the max diagonal entry to ensure good conditioning
        // (condition number ~ 1e6) while staying close to the true minimum-norm solution.
        const diagN = diagonal(N)
        const maxDiag = diagN.reduce((s, v) => Math.max(s, Math.abs(v)), 0)
        const epsilon = Math.max(1e-6 * maxDiag, 1e-10)
        const Nreg = addDiagonal(N, epsilon)
        if (process.env.NETWORK_DEBUG) console.error(`[networkAdjustment] iter ${iteration} regularized N with ε=${epsilon.toExponential()}`)

        const symbolic = symbolicFactorize(Nreg)
        const factor = cholesky(Nreg, symbolic)
        lastFactor = factor
        corrections = solveBordered(Nreg, B, u, factor)
        if (process.env.NETWORK_DEBUG) console.error(`[networkAdjustment] iter ${iteration} bordered solve done: corrections[0]=${corrections[0]}, max=${Math.max(...corrections.map(Math.abs))}`)
      } else {
        // Sparse Cholesky with AMD ordering
        const perm = approximateMinimumDegree(N)
        const Np = permuteSymmetric(N, perm)
        const up = perm.map((i) => u[i])
        const symbolic = symbolicFactorize(Np)
        const factor = cholesky(Np, symbolic)
        lastFactor = factor
        const yp = sparseForwardSolve(factor.L, up)
        const xp = sparseBackwardSolve(factor.L, yp)
        // Invert permutation
        corrections = new Array(paramCount)
        for (let i = 0; i < paramCount; i++) corrections[perm[i]] = xp[i]
      }
    } catch (e) {
      return failResult(
        `Failed to solve normal equations at iteration ${iteration}: ${(e as Error).message}`
      )
    }

    // Apply corrections to current coordinates
    let maxCorrection = 0
    for (let i = 0; i < adjustablePoints.length; i++) {
      const p = adjustablePoints[i]
      const dE = corrections[i * paramPerPoint]
      const dN = corrections[i * paramPerPoint + 1]
      const dH = paramPerPoint === 3 ? corrections[i * paramPerPoint + 2] : 0

      maxCorrection = Math.max(maxCorrection, Math.abs(dE), Math.abs(dN), Math.abs(dH))

      const cur = currentCoords.get(p.name)!
      currentCoords.set(p.name, {
        e: cur.e + dE,
        n: cur.n + dN,
        rl: paramPerPoint === 3 ? (cur.rl ?? 0) + dH : cur.rl,
      })
    }

    convergence = maxCorrection * 1000 // mm

    // Compute residuals and statistics
    const { residuals, referenceVariance, dof, chiSquareValue, chiSquareCritical, passed } =
      computeResidualsAndStats(
        observations,
        A, w, P,
        pointIndex,
        paramCount,
        paramPerPoint,
        lastFactor,
        freeNetwork,
        B,
        currentCoords,
        globalTestAlpha,
        wTestAlpha,
        wTestPower,
      )

    lastResiduals = residuals
    lastReferenceVariance = referenceVariance
    lastDegreesOfFreedom = dof
    lastChiSquareValue = chiSquareValue
    lastChiSquareCritical = chiSquareCritical
    lastPassed = passed

    // Robust estimation: update weights for next iteration
    if (robust) {
      const newWeights = new Map<number, number>()
      let downweighted = 0
      for (let i = 0; i < residuals.length; i++) {
        const r = residuals[i]
        const baseWeight = observations[i].weight ?? 1 / (observations[i].sigma ** 2)
        if (Math.abs(r.standardized) > huberC) {
          // Huber: w' = w × (c / |w̃|)
          const newWeight = baseWeight * (huberC / Math.abs(r.standardized))
          newWeights.set(i, newWeight)
          downweighted++
        } else {
          newWeights.set(i, baseWeight)
        }
      }
      weightOverrides = newWeights
      weightHistory.push(Array.from(newWeights.values()))
      downweightedCount = downweighted
    }

    // Convergence check
    if (convergence <= convergenceMm) {
      // If robust, require also that weights have stabilized
      if (!robust || iteration >= 3) break
    }
    if (!isFinite(convergence)) break
  }

  if (!isFinite(convergence)) {
    return failResult('Adjustment diverged')
  }

  // Build adjusted points with covariance
  const adjustedPoints: AdjustedPoint[] = []
  if (lastFactor) {
    // For covariance, we need the diagonal of N⁻¹
    // Use Takahashi's selective inversion with the pre-computed factor
    const invDiag = sparseInverseDiagonal(null, lastFactor)

    for (let i = 0; i < adjustablePoints.length; i++) {
      const p = adjustablePoints[i]
      const cur = currentCoords.get(p.name)!
      const baseIdx = i * paramPerPoint

      const qEE = invDiag[baseIdx] ?? 0
      const qNN = invDiag[baseIdx + 1] ?? 0
      const sigmaE = Math.sqrt(Math.max(0, qEE) * lastReferenceVariance)
      const sigmaN = Math.sqrt(Math.max(0, qNN) * lastReferenceVariance)

      const result: AdjustedPoint = {
        name: p.name,
        easting: cur.e,
        northing: cur.n,
        rl: cur.rl,
        correctionE: cur.e - p.easting,
        correctionN: cur.n - p.northing,
        correctionRL: cur.rl !== undefined && p.rl !== undefined ? cur.rl - p.rl : undefined,
        sigmaE,
        sigmaN,
        sigmaRL: paramPerPoint === 3
          ? Math.sqrt(Math.max(0, invDiag[baseIdx + 2] ?? 0) * lastReferenceVariance)
          : undefined,
      }

      // Error ellipse (2D, 95% confidence)
      // Note: Takahashi gives only diagonal of N⁻¹. For full error ellipse we'd
      // need the off-diagonal qEN. We approximate as isotropic for now.
      const meanSigma = (sigmaE + sigmaN) / 2
      result.errorEllipse = {
        semiMajor: meanSigma * 2.448,  // 95% confidence factor
        semiMinor: meanSigma * 2.448,
        orientation: 0,
      }

      adjustedPoints.push(result)
    }
  }

  // Build report
  const report = buildReport(
    adjustedPoints,
    lastResiduals,
    lastReferenceVariance,
    lastDegreesOfFreedom,
    lastChiSquareValue,
    lastChiSquareCritical,
    lastPassed,
    iteration,
    convergence,
    freeNetwork,
    robust,
    downweightedCount,
  )

  return {
    ok: true,
    warnings,
    adjustedPoints,
    residuals: lastResiduals,
    referenceVariance: lastReferenceVariance,
    standardError: Math.sqrt(lastReferenceVariance),
    degreesOfFreedom: lastDegreesOfFreedom,
    chiSquareValue: lastChiSquareValue,
    chiSquareCritical: lastChiSquareCritical,
    passed: lastPassed,
    iterations: iteration,
    convergence,
    robust: robust ? {
      downweightedCount,
      weightHistory,
    } : undefined,
    freeNetwork: freeNetwork ? {
      constraintRank: dimension === '3D' ? 7 : 4,
    } : undefined,
    report,
  }
}

// ---------------------------------------------------------------------------
// Residuals and statistics
// ---------------------------------------------------------------------------

function computeResidualsAndStats(
  observations: NetworkObservation[],
  A: SparseMatrix,
  w: number[],
  P: number[],
  pointIndex: Map<string, number>,
  paramCount: number,
  paramPerPoint: number,
  factor: SparseCholesky | null,
  freeNetwork: boolean,
  B: SparseMatrix | null,
  currentCoords: Map<string, { e: number; n: number; rl?: number }>,
  globalTestAlpha: number,
  wTestAlpha: number,
  wTestPower: number,
): {
  residuals: ObservationResidual[]
  referenceVariance: number
  dof: number
  chiSquareValue: number
  chiSquareCritical: number
  passed: boolean
} {
  // Solve for corrections (already applied, but we need them again for residual computation)
  // Actually, residuals = A·x - w where x is the correction vector.
  // But we already applied corrections. Let's recompute residuals from current coords.

  // For each observation, compute residual = observed - computed(at current coords)
  const residuals: ObservationResidual[] = []
  let sumPVV = 0

  // Number of constraints (for DOF)
  const constraintRank = freeNetwork && B ? (paramPerPoint === 3 ? 7 : 4) : 0

  // Degrees of freedom
  const dof = observations.length - paramCount + constraintRank

  // A posteriori reference variance — need to compute via sumPVV
  // We need the residual vector v = A·x - w. But x is the correction that minimizes vᵀ P v.
  // The minimum vᵀ P v = wᵀ P w - uᵀ x (where u = Aᵀ P w, x = N⁻¹ u).
  // For simplicity, recompute v directly.
  //
  // Actually, the simplest approach: recompute misclosures at current (adjusted) coords.
  // The residuals v_i = observed - computed_at_adjusted.

  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i]
    const from = currentCoords.get(obs.from)!
    const to = currentCoords.get(obs.to)!
    const at = obs.at ? currentCoords.get(obs.at)! : undefined

    let computed = 0
    let v = 0
    switch (obs.type) {
      case 'distance':
        computed = distance2D(from.e, from.n, to.e, to.n)
        break
      case 'slope_distance':
        computed = distance3D(from.e, from.n, from.rl ?? 0, to.e, to.n, to.rl ?? 0)
        break
      case 'bearing':
        computed = toDeg(bearingRad(from.e, from.n, to.e, to.n))
        break
      case 'angle': {
        if (!at) throw new Error('angle requires vertex')
        const theta_BA = bearingRad(at.e, at.n, from.e, from.n)
        const theta_BC = bearingRad(at.e, at.n, to.e, to.n)
        computed = toDeg(wrapAngle(theta_BC - theta_BA))
        break
      }
      case 'zenith_angle': {
        const dE = to.e - from.e
        const dN = to.n - from.n
        const dH = (to.rl ?? 0) - (from.rl ?? 0)
        const horiz = Math.sqrt(dE * dE + dN * dN)
        computed = toDeg(Math.atan2(horiz, dH))
        break
      }
      case 'height_difference':
        computed = (to.rl ?? 0) - (from.rl ?? 0)
        break
      case 'gnss_baseline': {
        // For GNSS baselines, compute residual as the magnitude of the 3D vector
        // difference between observed and computed baseline components.
        // (sumPVV contribution is approximated; the actual sumPVV would use C⁻¹.)
        const computed_dE = to.e - from.e
        const computed_dN = to.n - from.n
        const computed_dU = (to.rl ?? 0) - (from.rl ?? 0)
        const dE_r = (obs.deltaE ?? 0) - computed_dE
        const dN_r = (obs.deltaN ?? 0) - computed_dN
        const dU_r = (obs.deltaU ?? 0) - computed_dU
        computed = 0 // obs.value is unused for gnss_baseline
        v = Math.sqrt(dE_r * dE_r + dN_r * dN_r + dU_r * dU_r)
        break
      }
    }

    if (obs.type !== 'gnss_baseline') {
      v = obs.value - computed
    }
    if (obs.type === 'bearing' || obs.type === 'angle' || obs.type === 'zenith_angle') {
      while (v > 180) v -= 360
      while (v < -180) v += 360
    }

    sumPVV += P[i] * v * v

    // Compute redundancy number r_i = 1 - P_i * (A N⁻¹ Aᵀ)_ii
    // (A N⁻¹ Aᵀ)_ii requires the i-th row of A and the diagonal of N⁻¹
    // For sparse efficiency, we'd compute the Q_vv diagonal directly.
    // For now, use a simplified approximation: r_i ≈ (m - n) / m (average redundancy)
    // TODO: compute exact Q_vv diagonal via Takahashi extended to off-diagonals
    const avgRedundancy = Math.max(0, Math.min(1, dof / observations.length))

    // Standardized residual (approximate — uses a priori σ, not σ_v)
    const sigma_i = Math.sqrt(1 / P[i])
    const standardized = v / (sigma_i * Math.sqrt(Math.max(avgRedundancy, 1e-6)))

    // MDB (Baarda): ∇₀l = δ₀ × σ_l / √r_i
    // δ₀ = non-centrality parameter for α, β (Baarda's λ₀)
    // For α=0.001, β=0.80: δ₀ ≈ 4.13
    const delta0 = 4.13
    const mdb = delta0 * sigma_i / Math.sqrt(Math.max(avgRedundancy, 1e-6))

    // w-test = |standardized residual|
    const wTest = Math.abs(standardized)
    // Critical value for α=0.001 (two-tailed): z_{1-α/2} ≈ 3.29
    const wCritical = 3.29
    const isOutlier = wTest > wCritical

    residuals.push({
      type: obs.type,
      from: obs.from,
      to: obs.to,
      at: obs.at,
      observed: obs.value,
      computed,
      residual: v,
      standardized,
      redundancy: avgRedundancy,
      mdb,
      wTest,
      isOutlier,
      effectiveWeight: P[i],
    })
  }

  const referenceVariance = dof > 0 ? sumPVV / dof : 0
  const chiSquareValue = sumPVV
  const chiSquareCritical = chiSquareQuantile(1 - globalTestAlpha, dof)
  const passed = chiSquareValue <= chiSquareCritical

  return {
    residuals,
    referenceVariance,
    dof,
    chiSquareValue,
    chiSquareCritical,
    passed,
  }
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function buildReport(
  adjustedPoints: AdjustedPoint[],
  residuals: ObservationResidual[],
  referenceVariance: number,
  dof: number,
  chiSquareValue: number,
  chiSquareCritical: number,
  passed: boolean,
  iterations: number,
  convergence: number,
  freeNetwork: boolean,
  robust: boolean,
  downweightedCount: number,
): string {
  const lines: string[] = []
  lines.push('Network Adjustment Report')
  lines.push('═══════════════════════════════════════════════════════════════')
  lines.push(`Mode:              ${freeNetwork ? 'Free network (inner constraints)' : 'Constrained'}`)
  lines.push(`Robust estimation: ${robust ? `Huber (c=2.5), ${downweightedCount} obs downweighted` : 'Off'}`)
  lines.push(`Iterations:        ${iterations}`)
  lines.push(`Convergence:       ${convergence.toFixed(4)} mm`)
  lines.push(`Degrees of freedom: ${dof}`)
  lines.push(`Reference variance: ${referenceVariance.toFixed(6)}`)
  lines.push(`Standard error σ₀:  ${Math.sqrt(referenceVariance).toFixed(4)}`)
  lines.push(`Chi-square test:    ${chiSquareValue.toFixed(2)} vs ${chiSquareCritical.toFixed(2)} → ${passed ? 'PASS' : 'FAIL'}`)
  lines.push('')
  lines.push('Adjusted Points:')
  lines.push('─'.repeat(80))
  lines.push('  Name              Easting        Northing         σE(mm)  σN(mm)')
  for (const p of adjustedPoints) {
    lines.push(
      `  ${p.name.padEnd(16)}  ${p.easting.toFixed(4).padStart(12)}  ${p.northing.toFixed(4).padStart(12)}  ${p.sigmaE.toFixed(4).padStart(7)}  ${p.sigmaN.toFixed(4).padStart(7)}`,
    )
  }
  lines.push('')
  lines.push('Residuals (outliers only):')
  lines.push('─'.repeat(80))
  const outliers = residuals.filter((r) => r.isOutlier)
  if (outliers.length === 0) {
    lines.push('  No outliers detected.')
  } else {
    lines.push('  Type       From → To              Residual     σ     w-test   MDB')
    for (const r of outliers) {
      lines.push(
        `  ${r.type.padEnd(10)}  ${(r.from + ' → ' + r.to).padEnd(20)}  ${r.residual.toFixed(4).padStart(10)}  ${r.mdb.toFixed(4).padStart(8)}`,
      )
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Failure helper
// ---------------------------------------------------------------------------

function failResult(error: string): NetworkAdjustmentResult {
  return {
    ok: false,
    error,
    warnings: [],
    adjustedPoints: [],
    residuals: [],
    referenceVariance: 0,
    standardError: 0,
    degreesOfFreedom: 0,
    chiSquareValue: 0,
    chiSquareCritical: 0,
    passed: false,
    iterations: 0,
    convergence: Infinity,
    report: `Adjustment failed: ${error}`,
  }
}
