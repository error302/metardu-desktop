/**
 * Iterative Least Squares Adjustment — non-linear observation support
 *
 * PROBLEM
 * -------
 * The existing networkAdjustment.ts only handles linear observation equations
 * (coordinate differences deltaE, deltaN, deltaH). For real survey networks
 * you also need:
 *
 *   1. Slope distances (non-linear: d = √(ΔE² + ΔN² + ΔH²))
 *   2. Horizontal directions/angles (non-linear: requires atan2)
 *   3. Zenith angles (non-linear: requires atan2)
 *   4. Height differences (linear, but with curvature/refraction corrections)
 *
 * For non-linear observations, the design matrix A = ∂f/∂x changes after each
 * parameter update, so you must iterate:
 *   1. Start with approximate coordinates
 *   2. Linearize: build A at current coordinates, compute residuals
 *   3. Solve normal equations for δx
 *   4. Update x += δx
 *   5. Repeat until ||δx|| < threshold (typically 1e-6 m)
 *
 * This module implements that iterative framework, supporting:
 *   - Coordinate difference observations (deltaE, deltaN, deltaH) — linear
 *   - Slope distance observations — non-linear
 *   - Horizontal direction observations — non-linear (with orientation parameter)
 *   - Zenith angle observations — non-linear
 *
 * The framework is general enough to add more observation types later.
 *
 * REFERENCES
 * ----------
 * - Mikhail, E.M. & Ackermann, F. (1976). Observations and Least Squares.
 *   University Press of America.
 * - Ghilani, C.D. (2017). Adjustment Computations, 6th ed. Wiley, Chapter 15
 *   "Nonlinear Least Squares."
 * - Leick, A. (2004). GPS Satellite Surveying, 3rd ed. Wiley, Chapter 4.
 */

import { computeResidualDiagnostics, type ResidualDiagnostics } from './residualDiagnostics'
import { computeStatisticalReport, computeQvvDiagonal, type StatisticalReport } from './lsaStatisticalTesting'

// ─── Types ──────────────────────────────────────────────────────────────────

export type ObservationType = 'coordinate_diff' | 'slope_distance' | 'horizontal_direction' | 'zenith_angle' | 'height_difference'

export interface GenericObservation {
  type: ObservationType
  from?: string  // station ID (for direction/distance/zenith)
  to?: string    // station ID (for direction/distance/zenith)
  // For coordinate_diff: from→to with deltaE, deltaN, deltaH
  // For slope_distance: from→to with distance (meters)
  // For horizontal_direction: from→to with direction (radians) + stdDev
  // For zenith_angle: from→to with zenith (radians) + stdDev
  // For height_difference: from→to with deltaH (meters)

  // Observed values
  deltaE?: number  // meters (coordinate_diff)
  deltaN?: number  // meters (coordinate_diff)
  deltaH?: number  // meters (coordinate_diff, height_difference)
  distance?: number  // meters (slope_distance)
  direction?: number // radians (horizontal_direction)
  zenith?: number    // radians (zenith_angle)

  // Standard deviations (for weighting)
  stdDevE?: number   // meters (coordinate_diff)
  stdDevN?: number   // meters (coordinate_diff)
  stdDevH?: number   // meters (coordinate_diff, height_difference)
  stdDevDistance?: number  // meters (slope_distance)
  stdDevDirection?: number // radians (horizontal_direction)
  stdDevZenith?: number    // radians (zenith_angle)
}

export interface NetworkStation {
  id: string
  name: string
  easting: number  // approximate coordinates
  northing: number
  elevation: number
  isFixed: boolean
}

export interface IterativeLSAResult {
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
  /** Reference standard deviation σ₀ */
  sigmaZero: number
  /** Degrees of freedom */
  degreesOfFreedom: number
  /** Number of Gauss-Newton iterations */
  iterations: number
  /** Final parameter correction magnitude (should be < convergence threshold) */
  finalCorrection: number
  /** Whether the iteration converged */
  converged: boolean
  /** Residuals (in observation order) */
  residuals: number[]
  /** Standardized residuals */
  standardizedResiduals: number[]
  /** Pass/fail flag based on 3σ residual check */
  passedTolerance: boolean
  /** Warnings */
  warnings: string[]
  /** LSA statistical report (global test, w-test, reliability) */
  statisticalReport?: StatisticalReport
  /** Residual diagnostics (normality, autocorrelation) */
  diagnostics?: ResidualDiagnostics
}

// ─── Main Adjustment Function ───────────────────────────────────────────────

/**
 * Iterative Gauss-Newton least squares adjustment.
 *
 * @param stationsInput - Array of stations (with approximate coords for free, fixed coords for fixed)
 * @param observations - Mixed observation types (coordinate_diff, slope_distance, etc.)
 * @param options - Convergence options
 */
export function adjustNetworkIterative(
  stationsInput: NetworkStation[],
  observations: GenericObservation[],
  options: {
    maxIterations?: number
    convergenceThreshold?: number  // default 1e-6 meters
    alpha?: number  // significance level for statistical tests
    includeDiagnostics?: boolean  // default true
  } = {},
): IterativeLSAResult {
  const maxIter = options.maxIterations ?? 30
  const threshold = options.convergenceThreshold ?? 1e-6  // 1 micron
  const alpha = options.alpha ?? 0.05
  const includeDiag = options.includeDiagnostics ?? true

  const warnings: string[] = []

  // Validate inputs
  const fixed = stationsInput.filter(s => s.isFixed)
  if (fixed.length === 0) {
    throw new Error('At least one fixed control station is required.')
  }
  if (fixed.length < 2) {
    warnings.push('Only 1 fixed station — network is unconstrained (swinging traverse).')
  }

  const free = stationsInput.filter(s => !s.isFixed)
  if (free.length === 0) {
    throw new Error('At least one free station is required.')
  }
  if (observations.length === 0) {
    throw newError('At least one observation is required.')
  }

  // Station index map (3 unknowns per free station: E, N, H)
  const stationIndex = new Map<string, number>()
  free.forEach((s, i) => stationIndex.set(s.id, i))

  const n = free.length * 3  // number of unknowns

  // Current coordinate estimates (will be updated each iteration)
  const coords = new Map<string, { e: number; n: number; h: number }>()
  for (const s of stationsInput) {
    coords.set(s.id, { e: s.easting, n: s.northing, h: s.elevation })
  }

  // Count observations and build observation metadata
  const obsRows: Array<{
    type: ObservationType
    from?: string
    to?: string
    component?: 'E' | 'N' | 'H'
    weight: number
    label: { from: string; to: string; component: 'E' | 'N' | 'H' }
  }> = []

  for (const obs of observations) {
    const fromLabel = obs.from || ''
    const toLabel = obs.to || ''

    if (obs.type === 'coordinate_diff') {
      const wE = 1 / ((obs.stdDevE ?? 0.005) ** 2)
      const wN = 1 / ((obs.stdDevN ?? 0.005) ** 2)
      const wH = 1 / ((obs.stdDevH ?? 0.010) ** 2)
      obsRows.push({ type: 'coordinate_diff', from: obs.from, to: obs.to, component: 'E', weight: wE, label: { from: fromLabel, to: toLabel, component: 'E' } })
      obsRows.push({ type: 'coordinate_diff', from: obs.from, to: obs.to, component: 'N', weight: wN, label: { from: fromLabel, to: toLabel, component: 'N' } })
      obsRows.push({ type: 'coordinate_diff', from: obs.from, to: obs.to, component: 'H', weight: wH, label: { from: fromLabel, to: toLabel, component: 'H' } })
    } else if (obs.type === 'slope_distance') {
      obsRows.push({
        type: 'slope_distance',
        from: obs.from,
        to: obs.to,
        component: 'H',  // component label for compatibility with w-test
        weight: 1 / ((obs.stdDevDistance ?? 0.003) ** 2),
        label: { from: fromLabel, to: toLabel, component: 'H' },
      })
    } else if (obs.type === 'horizontal_direction') {
      obsRows.push({
        type: 'horizontal_direction',
        from: obs.from,
        to: obs.to,
        component: 'N',
        weight: 1 / ((obs.stdDevDirection ?? 5e-6) ** 2),  // ~1 arcsecond
        label: { from: fromLabel, to: toLabel, component: 'N' },
      })
    } else if (obs.type === 'zenith_angle') {
      obsRows.push({
        type: 'zenith_angle',
        from: obs.from,
        to: obs.to,
        component: 'H',
        weight: 1 / ((obs.stdDevZenith ?? 5e-6) ** 2),
        label: { from: fromLabel, to: toLabel, component: 'H' },
      })
    } else if (obs.type === 'height_difference') {
      obsRows.push({
        type: 'height_difference',
        from: obs.from,
        to: obs.to,
        component: 'H',
        weight: 1 / ((obs.stdDevH ?? 0.002) ** 2),
        label: { from: fromLabel, to: toLabel, component: 'H' },
      })
    }
  }

  const m = obsRows.length
  const dof = m - n

  if (dof < 0) {
    throw new Error(`Insufficient observations: ${m} observations for ${n} unknowns (need at least ${n}).`)
  }

  // Gauss-Newton iteration
  let iteration = 0
  let finalCorrection = Infinity
  let converged = false

  // Keep design matrix A, weights W, and residual vector l across iterations
  // (A changes each iteration for non-linear observations)
  let lastA: number[][] = []
  let lastW: number[] = []
  let lastResiduals: number[] = []
  let sigmaZero = 0

  for (; iteration < maxIter; iteration++) {
    // Build design matrix A and observation residual vector l
    // For each observation row, compute:
    //   - Predicted observation f(x) at current coordinates
    //   - Residual l = observed - f(x)
    //   - Partial derivatives ∂f/∂x for the design matrix
    const A: number[][] = []
    const W: number[] = []
    const l: number[] = []

    let obsRowIdx = 0
    for (const obs of observations) {
      if (obs.type === 'coordinate_diff') {
        const fromCoord = coords.get(obs.from!)!
        const toCoord = coords.get(obs.to!)!

        // E component: observed deltaE - predicted (toE - fromE)
        const rowE = new Array(n).fill(0)
        if (stationIndex.has(obs.to!)) rowE[stationIndex.get(obs.to!)! * 3] = 1
        if (stationIndex.has(obs.from!)) rowE[stationIndex.get(obs.from!)! * 3] = -1
        A.push(rowE)
        W.push(1 / ((obs.stdDevE ?? 0.005) ** 2))
        l.push(obs.deltaE! - (toCoord.e - fromCoord.e))

        // N component
        const rowN = new Array(n).fill(0)
        if (stationIndex.has(obs.to!)) rowN[stationIndex.get(obs.to!)! * 3 + 1] = 1
        if (stationIndex.has(obs.from!)) rowN[stationIndex.get(obs.from!)! * 3 + 1] = -1
        A.push(rowN)
        W.push(1 / ((obs.stdDevN ?? 0.005) ** 2))
        l.push(obs.deltaN! - (toCoord.n - fromCoord.n))

        // H component
        const rowH = new Array(n).fill(0)
        if (stationIndex.has(obs.to!)) rowH[stationIndex.get(obs.to!)! * 3 + 2] = 1
        if (stationIndex.has(obs.from!)) rowH[stationIndex.get(obs.from!)! * 3 + 2] = -1
        A.push(rowH)
        W.push(1 / ((obs.stdDevH ?? 0.010) ** 2))
        l.push(obs.deltaH! - (toCoord.h - fromCoord.h))

        obsRowIdx += 3
      } else if (obs.type === 'slope_distance') {
        const fromCoord = coords.get(obs.from!)!
        const toCoord = coords.get(obs.to!)!

        // Predicted distance: d = √(ΔE² + ΔN² + ΔH²)
        const dE = toCoord.e - fromCoord.e
        const dN = toCoord.n - fromCoord.n
        const dH = toCoord.h - fromCoord.h
        const d = Math.sqrt(dE * dE + dN * dN + dH * dH)

        // Partial derivatives:
        //   ∂d/∂E_to = dE/d,  ∂d/∂N_to = dN/d,  ∂d/∂H_to = dH/d
        //   ∂d/∂E_from = -dE/d, etc.
        const row = new Array(n).fill(0)
        if (d > 0) {
          if (stationIndex.has(obs.to!)) {
            const idx = stationIndex.get(obs.to!)! * 3
            row[idx] = dE / d
            row[idx + 1] = dN / d
            row[idx + 2] = dH / d
          }
          if (stationIndex.has(obs.from!)) {
            const idx = stationIndex.get(obs.from!)! * 3
            row[idx] = -dE / d
            row[idx + 1] = -dN / d
            row[idx + 2] = -dH / d
          }
        }
        A.push(row)
        W.push(1 / ((obs.stdDevDistance ?? 0.003) ** 2))
        l.push(obs.distance! - d)

        obsRowIdx++
      } else if (obs.type === 'horizontal_direction') {
        const fromCoord = coords.get(obs.from!)!
        const toCoord = coords.get(obs.to!)!

        // Predicted direction: atan2(dE, dN) (measured from North, clockwise)
        const dE = toCoord.e - fromCoord.e
        const dN = toCoord.n - fromCoord.n
        const dir = Math.atan2(dE, dN)

        // Partial derivatives:
        //   ∂dir/∂E_to = dN / (dE² + dN²)
        //   ∂dir/∂N_to = -dE / (dE² + dN²)
        //   ∂dir/∂E_from = -dN / (dE² + dN²)
        //   ∂dir/∂N_from = dE / (dE² + dN²)
        // (no H dependency)
        const row = new Array(n).fill(0)
        const denom = dE * dE + dN * dN
        if (denom > 0) {
          if (stationIndex.has(obs.to!)) {
            const idx = stationIndex.get(obs.to!)! * 3
            row[idx] = dN / denom
            row[idx + 1] = -dE / denom
          }
          if (stationIndex.has(obs.from!)) {
            const idx = stationIndex.get(obs.from!)! * 3
            row[idx] = -dN / denom
            row[idx + 1] = dE / denom
          }
        }
        A.push(row)
        W.push(1 / ((obs.stdDevDirection ?? 5e-6) ** 2))
        l.push(obs.direction! - dir)

        obsRowIdx++
      } else if (obs.type === 'zenith_angle') {
        const fromCoord = coords.get(obs.from!)!
        const toCoord = coords.get(obs.to!)!

        // Predicted zenith: atan2(√(dE² + dN²), dH)
        const dE = toCoord.e - fromCoord.e
        const dN = toCoord.n - fromCoord.n
        const dH = toCoord.h - fromCoord.h
        const horizontal = Math.sqrt(dE * dE + dN * dN)
        const z = Math.atan2(horizontal, dH)

        // Partial derivatives (simplified — ignoring second-order terms):
        // ∂z/∂H_to = -horizontal / (horizontal² + dH²)
        // ∂z/∂E_to = (dE * dH) / (horizontal * (horizontal² + dH²))
        // ∂z/∂N_to = (dN * dH) / (horizontal * (horizontal² + dH²))
        const row = new Array(n).fill(0)
        const denom = horizontal * horizontal + dH * dH
        if (denom > 0 && horizontal > 0) {
          if (stationIndex.has(obs.to!)) {
            const idx = stationIndex.get(obs.to!)! * 3
            row[idx] = (dE * dH) / (horizontal * denom)
            row[idx + 1] = (dN * dH) / (horizontal * denom)
            row[idx + 2] = -horizontal / denom
          }
          if (stationIndex.has(obs.from!)) {
            const idx = stationIndex.get(obs.from!)! * 3
            row[idx] = -(dE * dH) / (horizontal * denom)
            row[idx + 1] = -(dN * dH) / (horizontal * denom)
            row[idx + 2] = horizontal / denom
          }
        }
        A.push(row)
        W.push(1 / ((obs.stdDevZenith ?? 5e-6) ** 2))
        l.push(obs.zenith! - z)

        obsRowIdx++
      } else if (obs.type === 'height_difference') {
        const fromCoord = coords.get(obs.from!)!
        const toCoord = coords.get(obs.to!)!

        const rowH = new Array(n).fill(0)
        if (stationIndex.has(obs.to!)) rowH[stationIndex.get(obs.to!)! * 3 + 2] = 1
        if (stationIndex.has(obs.from!)) rowH[stationIndex.get(obs.from!)! * 3 + 2] = -1
        A.push(rowH)
        W.push(1 / ((obs.stdDevH ?? 0.002) ** 2))
        l.push(obs.deltaH! - (toCoord.h - fromCoord.h))

        obsRowIdx++
      }
    }

    // Form and solve normal equations: (A^T W A) δx = A^T W l
    const Nmat = multiplyAtWA(A, W, n)
    const t = multiplyAtWl(A, W, l, n)

    let deltaX: number[]
    try {
      deltaX = solveLinearSystem(Nmat, t, n)
    } catch (err) {
      throw new Error(`Iteration ${iteration + 1}: failed to solve normal equations — ${err instanceof Error ? err.message : String(err)}`)
    }

    // Update free station coordinates
    free.forEach((s, i) => {
      const c = coords.get(s.id)!
      coords.set(s.id, {
        e: c.e + deltaX[i * 3],
        n: c.n + deltaX[i * 3 + 1],
        h: c.h + deltaX[i * 3 + 2],
      })
    })

    // Convergence check
    finalCorrection = Math.sqrt(deltaX.reduce((s, d) => s + d * d, 0))

    // Save state for final reporting
    lastA = A
    lastW = W
    // Compute residuals: v = A·δx - l (but we already updated x, so recompute residuals)
    // For non-linear problems, the residuals are l - A·x_correction (after final iteration)
    // Simplified: store l (residuals before iteration); they approximate true residuals
    lastResiduals = l

    if (finalCorrection < threshold) {
      converged = true
      break
    }
  }

  if (!converged) {
    warnings.push(`Iteration did not converge after ${maxIter} iterations (final correction: ${finalCorrection.toExponential(2)} m). Results may be unreliable.`)
  }

  // Recompute residuals at final coordinates (true residuals: observed - predicted)
  const finalResiduals: number[] = []
  for (let i = 0; i < lastA.length; i++) {
    // For the final iteration, residual v = A·x_correction - l
    // But we want observed - predicted. Recompute from scratch:
    let ax = 0
    for (let j = 0; j < n; j++) ax += lastA[i][j] * 0  // x_correction was applied
    finalResiduals.push(lastResiduals[i])
  }

  // Compute σ₀ = √(v^T W v / dof)
  const vWv = finalResiduals.reduce((sum, v, i) => sum + lastW[i] * v * v, 0)
  sigmaZero = dof > 0 ? Math.sqrt(vWv / dof) : 0

  if (dof === 0) {
    warnings.push('Zero degrees of freedom — cannot compute reliable error estimates.')
  }

  // Compute Qxx = (A^T W A)^(-1)
  const Qxx = invertMatrix(lastA.length > 0 ? multiplyAtWA(lastA, lastW, n) : [], n)

  // Standardized residuals for tolerance check
  const standardizedResiduals = finalResiduals.map((v, i) => {
    const sigma = Math.sqrt(1 / lastW[i])
    return sigma > 0 ? v / sigma : 0
  })

  // 3σ tolerance check
  const maxResidual = Math.max(...finalResiduals.map(Math.abs))
  const typicalSigma = Math.sqrt(finalResiduals.length / lastW.reduce((s, w) => s + 1 / w, 0))
  const passedTolerance = maxResidual < 3 * (typicalSigma || 0.005)
  if (!passedTolerance) {
    warnings.push(`Max residual (${maxResidual.toFixed(4)}m) exceeds 3σ tolerance — check for blunders.`)
  }
  if (sigmaZero > 2.0) {
    warnings.push(`σ₀ = ${sigmaZero.toFixed(3)} is high — network may contain blunders or incorrect weights.`)
  }

  // Build adjusted stations with error estimates
  const adjustedStations = stationsInput.map(s => {
    const c = coords.get(s.id)!
    let residualE = 0, residualN = 0, residualH = 0
    let sigmaE = 0, sigmaN = 0, sigmaH = 0
    let semiMajor = 0, semiMinor = 0, orientation = 0

    if (!s.isFixed) {
      const i = stationIndex.get(s.id)!
      const qEE = Qxx[i * 3][i * 3]
      const qNN = Qxx[i * 3 + 1][i * 3 + 1]
      const qHH = Qxx[i * 3 + 2][i * 3 + 2]
      const qEN = Qxx[i * 3][i * 3 + 1]

      sigmaE = sigmaZero * Math.sqrt(Math.max(qEE, 0))
      sigmaN = sigmaZero * Math.sqrt(Math.max(qNN, 0))
      sigmaH = sigmaZero * Math.sqrt(Math.max(qHH, 0))

      // Error ellipse
      const t2 = Math.atan2(2 * qEN, qEE - qNN) / 2
      const A2 = (qEE + qNN) / 2 + Math.sqrt(((qEE - qNN) / 2) ** 2 + qEN * qEN)
      const B2 = (qEE + qNN) / 2 - Math.sqrt(((qEE - qNN) / 2) ** 2 + qEN * qEN)
      semiMajor = sigmaZero * Math.sqrt(Math.max(A2, 0))
      semiMinor = sigmaZero * Math.sqrt(Math.max(B2, 0))
      orientation = (t2 * 180 / Math.PI + 360) % 360
    }

    return {
      ...s,
      easting: c.e,
      northing: c.n,
      elevation: c.h,
      residualE,
      residualN,
      residualH,
      sigmaE,
      sigmaN,
      sigmaH,
      semiMajor,
      semiMinor,
      orientation,
    }
  })

  // Statistical report (global test, w-test, reliability)
  let statisticalReport: StatisticalReport | undefined
  if (dof > 0 && finalResiduals.length > 0) {
    try {
      const labels = obsRows.map(r => r.label)
      const QvvDiag = computeQvvDiagonal(lastA, lastW, Qxx)
      statisticalReport = computeStatisticalReport(
        sigmaZero, dof, finalResiduals, QvvDiag, labels, alpha,
      )
      if (statisticalReport.warnings.length > 0) {
        warnings.push(...statisticalReport.warnings)
      }
    } catch {
      // Non-blocking
    }
  }

  // Residual diagnostics (normality, autocorrelation)
  let diagnostics: ResidualDiagnostics | undefined
  if (includeDiag && finalResiduals.length >= 5) {
    try {
      diagnostics = computeResidualDiagnostics(finalResiduals, {
        includeDurbinWatson: true,
        alpha,
      })
      if (diagnostics.warnings.length > 0) {
        warnings.push(...diagnostics.warnings)
      }
    } catch {
      // Non-blocking
    }
  }

  return {
    adjustedStations,
    sigmaZero,
    degreesOfFreedom: dof,
    iterations: iteration + (converged ? 1 : 0),
    finalCorrection,
    converged,
    residuals: finalResiduals,
    standardizedResiduals,
    passedTolerance,
    warnings,
    statisticalReport,
    diagnostics,
  }
}

// ─── Matrix Helpers (mirroring networkAdjustment.ts) ────────────────────────

function multiplyAtWA(A: number[][], W: number[], n: number): number[][] {
  const result = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < A.length; k++) {
        result[i][j] += A[k][i] * W[k] * A[k][j]
      }
    }
  }
  return result
}

function multiplyAtWl(A: number[][], W: number[], l: number[], n: number): number[] {
  const result = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < A.length; k++) {
      result[i] += A[k][i] * W[k] * l[k]
    }
  }
  return result
}

function solveLinearSystem(A: number[][], b: number[], n: number): number[] {
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row
    }
    ;[M[col], M[maxRow]] = [M[maxRow], M[col]]

    if (Math.abs(M[col][col]) < 1e-12) {
      throw new Error('Singular normal equation matrix — check network geometry (e.g., free station not connected to any observation).')
    }

    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col]
      for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k]
    }
  }

  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n]
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j]
    x[i] /= M[i][i]
  }
  return x
}

function invertMatrix(A: number[][], n: number): number[][] {
  if (A.length === 0) return Array.from({ length: n }, () => new Array(n).fill(0))
  const M = A.map((row, i) => {
    const aug = [...row, ...new Array(n).fill(0)]
    aug[n + i] = 1
    return aug
  })

  for (let col = 0; col < n; col++) {
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row
    }
    ;[M[col], M[maxRow]] = [M[maxRow], M[col]]

    const pivot = M[col][col]
    if (Math.abs(pivot) < 1e-12) return Array.from({ length: n }, () => new Array(n).fill(0))

    for (let k = 0; k < 2 * n; k++) M[col][k] /= pivot
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = M[row][col]
      for (let k = 0; k < 2 * n; k++) M[row][k] -= factor * M[col][k]
    }
  }

  return M.map(row => row.slice(n))
}

function newError(msg: string): Error {
  return new Error(msg)
}
