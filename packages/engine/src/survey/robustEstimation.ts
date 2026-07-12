/**
 * Robust Estimation — Iteratively Reweighted Least Squares (IRLS)
 *
 * PROBLEM
 * -------
 * Standard least-squares is the BLUE (Best Linear Unbiased Estimator) when
 * residuals are Gaussian — but a single blunder can drag adjusted coordinates
 * by centimeters without being detected by the w-test. Real survey networks
 * often contain 2-5% gross errors (misread angles, swapped face, bust shots,
 * wrong target height, etc.).
 *
 * Robust estimators down-weight observations with large residuals, making
 * the adjustment RESISTANT to blunders. The adjusted coordinates converge
 * to the "clean" solution even when 10-20% of observations are contaminated.
 *
 * THREE WEIGHT FUNCTIONS IMPLEMENTED
 * ----------------------------------
 *
 * 1. HUBER (most common, good default)
 *    w(u) = 1                    if |u| ≤ c
 *    w(u) = c/|u|                if |u| > c
 *    where u = v/σ, c = 1.345 (95% efficiency under normality)
 *
 * 2. IGG3 (Institute of Geodesy and Geophysics, China — used by Chinese
 *    geodetic networks, more aggressive than Huber)
 *    w(u) = 1                       if |u| ≤ k0
 *    w(u) = (k0/|u|)·((k1 - |u|)/(k1 - k0))²  if k0 < |u| ≤ k1
 *    w(u) = 0                       if |u| > k1
 *    where k0 = 1.5, k1 = 2.5 (standard IGG3 constants)
 *
 * 3. TUKEY BIWEIGHT (most aggressive, fully rejects outliers)
 *    w(u) = (1 - (u/c)²)²          if |u| ≤ c
 *    w(u) = 0                       if |u| > c
 *    where c = 4.685 (95% efficiency under normality)
 *
 * ALGORITHM (IRLS)
 * ----------------
 * 1. Start with standard LSA (all weights = 1)
 * 2. Compute residuals v_i and standardize: u_i = v_i / (σ₀·√(q_vv_ii))
 * 3. Compute new weights w_i = f(u_i) using the chosen weight function
 * 4. Re-run LSA with new weights
 * 5. Repeat until weights converge (typically 5-15 iterations)
 *
 * The final weights identify blunders: w_i ≈ 0 means observation i is a blunder.
 *
 * REFERENCES
 * ----------
 * - Huber, P.J. (1964). "Robust Estimation of a Location Parameter."
 *   Annals of Mathematical Statistics, 35(1).
 * - Huber, P.J. (1981). Robust Statistics. Wiley.
 * - Zhou, J. (1989). "Classical theory of robustness and IGG scheme."
 *   Acta Geodaetica et Cartographica Sinica, 18(2). (IGG3 origin)
 * - Beaton, A.E. & Tukey, J.W. (1974). "The Fitting of Power Series,
 *   Meaning Polynomials, Illustrated on Band-Spectroscopic Data."
 *   Technometrics, 16(2). (Tukey biweight)
 * - Ghilani, C.D. (2017). Adjustment Computations, 6th ed. Wiley, §11.
 */

import { adjustNetworkIterative, type NetworkStation, type GenericObservation } from './lsaIterative'

// ─── Types ──────────────────────────────────────────────────────────────────

export type WeightFunction = 'huber' | 'igg3' | 'tukey'

export interface RobustLSAOptions {
  /** Weight function (default: 'huber') */
  weightFunction?: WeightFunction
  /** Tuning constant c for Huber (default: 1.345 — 95% efficiency) */
  huberC?: number
  /** IGG3 lower threshold k0 (default: 1.5) */
  igg3K0?: number
  /** IGG3 upper threshold k1 (default: 2.5) */
  igg3K1?: number
  /** Tukey biweight constant c (default: 4.685 — 95% efficiency) */
  tukeyC?: number
  /** Max IRLS iterations (default: 20) */
  maxIterations?: number
  /** Weight convergence threshold (default: 1e-4) */
  convergenceThreshold?: number
  /** Alpha for statistical tests (default: 0.05) */
  alpha?: number
}

export interface RobustLSAResult {
  /** Adjusted stations (same as standard LSA) */
  adjustedStations: Array<NetworkStation & {
    residualE: number
    residualN: number
    residualH: number
    sigmaE: number
    sigmaN: number
    sigmaH: number
    semiMajor: number
    semiMinor: number
    orientation: number
  }>
  /** Reference standard deviation σ₀ (robust) */
  sigmaZero: number
  /** Degrees of freedom */
  degreesOfFreedom: number
  /** Number of IRLS iterations */
  iterations: number
  /** Whether IRLS converged */
  converged: boolean
  /** Final weights per observation (1 = full weight, 0 = rejected) */
  finalWeights: number[]
  /** Observations flagged as blunders (weight ≈ 0) */
  blunders: Array<{
    index: number
    type: GenericObservation['type']
    from?: string
    to?: string
    component?: string
    residual: number
    standardizedResidual: number
    finalWeight: number
  }>
  /** Number of blunders detected */
  blunderCount: number
  /** Method used ('huber' | 'igg3' | 'tukey') */
  method: WeightFunction
  /** Warnings */
  warnings: string[]
  /** Summary for UI display */
  summary: string
}

// ─── Weight Functions ───────────────────────────────────────────────────────

/**
 * Compute the robust weight for a standardized residual u.
 *
 * @param u - Standardized residual (v / (σ₀·√(q_vv)))
 * @param fn - Weight function name
 * @param params - Tuning constants
 */
export function computeRobustWeight(
  u: number,
  fn: WeightFunction,
  params: { huberC?: number; igg3K0?: number; igg3K1?: number; tukeyC?: number } = {},
): number {
  const absU = Math.abs(u)

  if (fn === 'huber') {
    const c = params.huberC ?? 1.345
    return absU <= c ? 1 : c / absU
  }

  if (fn === 'igg3') {
    const k0 = params.igg3K0 ?? 1.5
    const k1 = params.igg3K1 ?? 2.5
    if (absU <= k0) return 1
    if (absU > k1) return 0
    // w = (k0/|u|) · ((k1 - |u|)/(k1 - k0))²
    return (k0 / absU) * Math.pow((k1 - absU) / (k1 - k0), 2)
  }

  if (fn === 'tukey') {
    const c = params.tukeyC ?? 4.685
    if (absU > c) return 0
    const t = 1 - (u / c) ** 2
    return t * t
  }

  return 1 // fallback
}

// ─── Robust LSA via IRLS ────────────────────────────────────────────────────

/**
 * Iteratively Reweighted Least Squares adjustment.
 *
 * This wraps the existing iterative LSA with an outer IRLS loop that
 * down-weights observations with large residuals. After convergence,
 * observations with weight ≈ 0 are flagged as blunders.
 *
 * @param stations - Network stations (with approximate coords for free, fixed for fixed)
 * @param observations - Mixed observation types
 * @param options - Robust LSA options
 */
export function adjustNetworkRobust(
  stations: NetworkStation[],
  observations: GenericObservation[],
  options: RobustLSAOptions = {},
): RobustLSAResult {
  const fn = options.weightFunction ?? 'huber'
  const maxIter = options.maxIterations ?? 20
  const threshold = options.convergenceThreshold ?? 1e-4
  const alpha = options.alpha ?? 0.05

  const warnings: string[] = []

  // Step 1: Run the standard iterative LSA to get initial residuals
  let lastResult = adjustNetworkIterative(stations, observations, {
    maxIterations: 30,
    convergenceThreshold: 1e-6,
    alpha,
    includeDiagnostics: false,
  })

  // Step 2: IRLS outer loop
  // We modify the observation stdDevs to implement the reweighting:
  // w_i_new = w_robust(u_i) × w_i_old
  // Equivalent to: σ_i_new = σ_i_old / √(w_robust(u_i))
  // (because weight = 1/σ², so w_robust × (1/σ²) = 1/(σ/√w_robust)²)

  let currentWeights = observations.map(() => 1.0)  // per-observation scalar weight multiplier
  let iteration = 0
  let converged = false
  let finalWeights: number[] = []

  // We need to track weights per observation ROW (not per scalar component).
  // For coordinate_diff observations, there are 3 rows (E, N, H) but we
  // apply the same weight to all 3 components.
  for (; iteration < maxIter; iteration++) {
    // Build new observations with adjusted stdDevs based on current weights
    const reweightedObs: GenericObservation[] = observations.map((obs, i) => {
      const w = currentWeights[i]
      const scaleFactor = w > 1e-10 ? 1 / Math.sqrt(w) : 1e6  // huge σ for zero-weight obs
      return {
        ...obs,
        stdDevE: obs.stdDevE ? obs.stdDevE * scaleFactor : undefined,
        stdDevN: obs.stdDevN ? obs.stdDevN * scaleFactor : undefined,
        stdDevH: obs.stdDevH ? obs.stdDevH * scaleFactor : undefined,
        stdDevDistance: obs.stdDevDistance ? obs.stdDevDistance * scaleFactor : undefined,
        stdDevDirection: obs.stdDevDirection ? obs.stdDevDirection * scaleFactor : undefined,
        stdDevZenith: obs.stdDevZenith ? obs.stdDevZenith * scaleFactor : undefined,
      }
    })

    // Re-run LSA with reweighted observations
    lastResult = adjustNetworkIterative(stations, reweightedObs, {
      maxIterations: 30,
      convergenceThreshold: 1e-6,
      alpha,
      includeDiagnostics: false,
    })

    // Compute new weights based on per-observation residuals
    // We re-evaluate residuals from scratch for each observation by comparing
    // the observation's measured value to the predicted value (computed from
    // the adjusted coordinates).
    const newWeights: number[] = []
    const adjustedCoords = new Map<string, { e: number; n: number; h: number }>()
    for (const s of lastResult.adjustedStations) {
      adjustedCoords.set(s.id, { e: s.easting, n: s.northing, h: s.elevation })
    }

    for (let i = 0; i < observations.length; i++) {
      const obs = observations[i]

      // Compute the residual for this observation
      let residual = 0
      let sigma = 0.005

      if (obs.type === 'coordinate_diff' && obs.from && obs.to) {
        const fromC = adjustedCoords.get(obs.from)
        const toC = adjustedCoords.get(obs.to)
        if (fromC && toC) {
          // Use the E component residual (could also average all 3)
          const predictedE = toC.e - fromC.e
          residual = obs.deltaE! - predictedE
          sigma = obs.stdDevE ?? 0.005
        }
      } else if (obs.type === 'slope_distance' && obs.from && obs.to) {
        const fromC = adjustedCoords.get(obs.from)
        const toC = adjustedCoords.get(obs.to)
        if (fromC && toC) {
          const dE = toC.e - fromC.e
          const dN = toC.n - fromC.n
          const dH = toC.h - fromC.h
          const predicted = Math.sqrt(dE * dE + dN * dN + dH * dH)
          residual = obs.distance! - predicted
          sigma = obs.stdDevDistance ?? 0.003
        }
      } else if (obs.type === 'horizontal_direction' && obs.from && obs.to) {
        const fromC = adjustedCoords.get(obs.from)
        const toC = adjustedCoords.get(obs.to)
        if (fromC && toC) {
          const dE = toC.e - fromC.e
          const dN = toC.n - fromC.n
          const predicted = Math.atan2(dE, dN)
          residual = obs.direction! - predicted
          sigma = obs.stdDevDirection ?? 5e-6
        }
      } else if (obs.type === 'zenith_angle' && obs.from && obs.to) {
        const fromC = adjustedCoords.get(obs.from)
        const toC = adjustedCoords.get(obs.to)
        if (fromC && toC) {
          const dE = toC.e - fromC.e
          const dN = toC.n - fromC.n
          const dH = toC.h - fromC.h
          const predicted = Math.atan2(Math.sqrt(dE * dE + dN * dN), dH)
          residual = obs.zenith! - predicted
          sigma = obs.stdDevZenith ?? 5e-6
        }
      } else if (obs.type === 'height_difference' && obs.from && obs.to) {
        const fromC = adjustedCoords.get(obs.from)
        const toC = adjustedCoords.get(obs.to)
        if (fromC && toC) {
          const predicted = toC.h - fromC.h
          residual = obs.deltaH! - predicted
          sigma = obs.stdDevH ?? 0.002
        }
      }

      // Standardize: u = residual / (σ₀ × σ)
      const sigmaZero = lastResult.sigmaZero > 1e-10 ? lastResult.sigmaZero : 1.0
      const u = sigma > 0 ? residual / (sigmaZero * sigma) : 0

      const newW = computeRobustWeight(u, fn, {
        huberC: options.huberC,
        igg3K0: options.igg3K0,
        igg3K1: options.igg3K1,
        tukeyC: options.tukeyC,
      })

      newWeights.push(newW)
    }

    // Check convergence: max weight change
    let maxChange = 0
    for (let i = 0; i < currentWeights.length; i++) {
      maxChange = Math.max(maxChange, Math.abs(newWeights[i] - currentWeights[i]))
    }

    currentWeights = newWeights
    finalWeights = newWeights

    if (maxChange < threshold) {
      converged = true
      break
    }
  }

  if (!converged) {
    warnings.push(`IRLS did not converge after ${maxIter} iterations (final weight change: ${threshold.toFixed(4)}). Results may be less reliable.`)
  }

  // Identify blunders (weight < 0.1, i.e., 90% down-weighted)
  const blunders: RobustLSAResult['blunders'] = []
  for (let i = 0; i < observations.length; i++) {
    if (finalWeights[i] < 0.1) {
      const obs = observations[i]
      // Find the residual for this observation (first component for coord_diff)
      const numComponents = obs.type === 'coordinate_diff' ? 3 : 1
      const startIdx = observations.slice(0, i).reduce(
        (sum, o) => sum + (o.type === 'coordinate_diff' ? 3 : 1), 0,
      )
      const residual = lastResult.residuals[startIdx] ?? 0
      const stdRes = lastResult.standardizedResiduals[startIdx] ?? 0

      blunders.push({
        index: i,
        type: obs.type,
        from: obs.from,
        to: obs.to,
        component: obs.type === 'coordinate_diff' ? 'E' : undefined,
        residual,
        standardizedResidual: stdRes,
        finalWeight: finalWeights[i],
      })
    }
  }

  if (blunders.length > 0) {
    warnings.push(`${blunders.length} blunder(s) detected and down-weighted by ${fn} IRLS.`)
  }

  // Build summary
  const summary = buildSummary(fn, iteration + (converged ? 1 : 0), converged, lastResult.sigmaZero, blunders.length, lastResult.degreesOfFreedom)

  return {
    adjustedStations: lastResult.adjustedStations,
    sigmaZero: lastResult.sigmaZero,
    degreesOfFreedom: lastResult.degreesOfFreedom,
    iterations: iteration + (converged ? 1 : 0),
    converged,
    finalWeights,
    blunders,
    blunderCount: blunders.length,
    method: fn,
    warnings,
    summary,
  }
}

function buildSummary(
  method: WeightFunction,
  iterations: number,
  converged: boolean,
  sigmaZero: number,
  blunderCount: number,
  dof: number,
): string {
  const status = converged ? 'converged' : 'did NOT converge'
  const blunderText = blunderCount === 0
    ? 'No blunders detected.'
    : `${blunderCount} blunder(s) detected and down-weighted.`

  return `Robust LSA (${method.toUpperCase()}) ${status} in ${iterations} iterations. σ₀=${sigmaZero.toFixed(4)}, dof=${dof}. ${blunderText}`
}
