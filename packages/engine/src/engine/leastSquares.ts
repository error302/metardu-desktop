/**
 * Least Squares Adjustment (2D) — Weighted, iterative
 * References: standard surveying adjustment (Ghilani/Wolf; Ghilani "Adjustment Computations")
 *
 * This implementation supports mixed observation sets of:
 * - horizontal distances (m)
 * - whole-circle bearings (degrees, WCB from North)
 *
 * Notes:
 * - All computations keep full floating-point precision (no intermediate rounding).
 * - Observations use `weight = 1/σ²` (per-observation), where σ is in the observation's units.
 * - Bearings are internally handled in radians; residuals are wrapped to (-π, π].
 */

export type ObservationType = 'distance' | 'bearing' | 'angle' | 'slope_distance' | 'zenith_angle' | 'height_difference'

export interface Observation {
  type?: ObservationType
  from: string
  to: string
  distance?: number
  bearing?: number
  weight?: number
  distanceSigma?: number
  bearingSigmaArcSec?: number
  occupied?: string
  backsight?: string
  foresight?: string
  angle?: number
  angleSigmaArcSec?: number
  slopeDistance?: number
  slopeDistanceSigma?: number
  zenithAngle?: number
  zenithAngleSigmaArcSec?: number
  heightDifference?: number
  heightDiffSigma?: number
}

export interface LSAdjustmentResult {
  ok: boolean
  adjustedPoints: Array<{
    name: string
    easting: number
    northing: number
    sigmaEasting: number
    sigmaNorthing: number
    rl?: number
    sigmaRL?: number
  }>
  residuals: Array<{
    observation: string
    residual: number
    standardizedResidual: number
  }>
  referenceVariance: number
  chiSquare: number
  degreesOfFreedom: number
  globalTest?: {
    alpha: number
    lower: number
    upper: number
    passed: boolean
  }
  // ─── Baarda Reliability Analysis (H13, 2026-07-03) ───────────────────────
  // Added per audit finding H13. Each observation gets:
  //   - redundancy number r_i  (0 ≤ r_i ≤ 1; sum of r_i = degrees of freedom)
  //   - internal reliability / MDB (Minimal Detectable Bias) — the smallest
  //     bias in observation i that would be detected by the w-test at the
  //     chosen significance level
  //   - external reliability — the effect of an undetected MDB-sized bias
  //     on the adjusted coordinates (max |∇x| in meters)
  //   - w-test statistic (data snooping) — |v_i| / σ_v_i
  //
  // References:
  //   - Baarda, W. (1968) "A Testing Procedure for Use in Geodetic Networks"
  //   - Förstner, W. (1979) "On Internal and External Reliability of
  //     Photogrammetric Coordinates"
  //   - Ghilani & Wolf "Adjustment Computations" Ch. 21 (Reliability)
  reliability?: {
    observations: Array<{
      observation: string
      /** Redundancy number r_i = q_vv_i × p_i  (0=no redundancy, 1=full) */
      redundancyNumber: number
      /** Internal reliability: MDB in observation units (m or arcsec) */
      minimalDetectableBias: number
      /** External reliability: max effect on adjusted coords (m) */
      externalReliability: number
      /** w-test statistic (data snooping): |v_i| / σ_v_i */
      wTestStatistic: number
      /** True if w-test exceeds critical value (outlier suspected) */
      isOutlier: boolean
    }>
    /** Critical value for the w-test (standard normal, default 3.29 = α=0.001) */
    wTestCriticalValue: number
    /** Significance level used for MDB computation */
    alpha: number
    /** Power of test (1-β, default 0.80) */
    power: number
    /** Non-centrality parameter λ₀ for α, β */
    nonCentralityParameter: number
  }
  passed: boolean
  error?: string
}

export interface LSAdjustmentInput {
  fixedPoints: Array<{ name: string; easting: number; northing: number; rl?: number }>
  adjustablePoints: Array<{ name: string; easting: number; northing: number; rl?: number }>
  observations: Observation[]
  dimension?: '2D' | '3D'
  maxIterations?: number
  convergenceMm?: number
  standardizedResidualLimit?: number
  globalTestAlpha?: number
}

type Point = { easting: number; northing: number }

function toRadians(deg: number) {
  return (deg * Math.PI) / 180
}

function wrapAngleRad(rad: number) {
  let a = rad
  while (a <= -Math.PI) a += 2 * Math.PI
  while (a > Math.PI) a -= 2 * Math.PI
  return a
}

function zeros(rows: number, cols: number) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0))
}

function transpose(A: number[][]) {
  const rows = A.length
  const cols = A[0]?.length ?? 0
  const T = zeros(cols, rows)
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) T[j][i] = A[i][j]
  }
  return T
}

function matMul(A: number[][], B: number[][]) {
  const r = A.length
  const k = A[0]?.length ?? 0
  const c = B[0]?.length ?? 0
  const out = zeros(r, c)
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      let s = 0
      for (let t = 0; t < k; t++) s += A[i][t] * B[t][j]
      out[i][j] = s
    }
  }
  return out
}

function matVecMul(A: number[][], v: number[]) {
  const r = A.length
  const c = A[0]?.length ?? 0
  const out = new Array(r).fill(0)
  for (let i = 0; i < r; i++) {
    let s = 0
    for (let j = 0; j < c; j++) s += A[i][j] * v[j]
    out[i] = s
  }
  return out
}

function gaussianSolve(A: number[][], b: number[]) {
  const n = A.length
  const M = A.map((row, i) => [...row, b[i]])

  for (let k = 0; k < n; k++) {
    // pivot
    let pivotRow = k
    let max = Math.abs(M[k][k])
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i][k])
      if (v > max) {
        max = v
        pivotRow = i
      }
    }
    if (max === 0 || !isFinite(max)) throw new Error('Normal matrix is singular or ill-conditioned')
    if (pivotRow !== k) {
      const tmp = M[k]
      M[k] = M[pivotRow]
      M[pivotRow] = tmp
    }

    // eliminate
    const pivot = M[k][k]
    for (let j = k; j <= n; j++) M[k][j] /= pivot

    for (let i = 0; i < n; i++) {
      if (i === k) continue
      const factor = M[i][k]
      if (factor === 0) continue
      for (let j = k; j <= n; j++) M[i][j] -= factor * M[k][j]
    }
  }

  return M.map((row: any) => row[n])
}

function invertMatrix(A: number[][]) {
  const n = A.length
  const I = zeros(n, n)
  for (let i = 0; i < n; i++) I[i][i] = 1

  // Solve A * X = I column-by-column
  const inv = zeros(n, n)
  for (let col = 0; col < n; col++) {
    const e = I.map((row: any) => row[col])
    const x = gaussianSolve(A.map((r) => [...r]), [...e])
    for (let i = 0; i < n; i++) inv[i][col] = x[i]
  }
  return inv
}

function dot(a: number[], b: number[]) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function normalQuantile(p: number) {
  // Acklam's inverse normal CDF approximation (sufficient for chi-square quantile approximation).
  if (!(p > 0 && p < 1) || !Number.isFinite(p)) return NaN

  const a = [
    -3.969683028665376e+01,
    2.209460984245205e+02,
    -2.759285104469687e+02,
    1.383577518672690e+02,
    -3.066479806614716e+01,
    2.506628277459239e+00,
  ]
  const b = [
    -5.447609879822406e+01,
    1.615858368580409e+02,
    -1.556989798598866e+02,
    6.680131188771972e+01,
    -1.328068155288572e+01,
  ]
  const c = [
    -7.784894002430293e-03,
    -3.223964580411365e-01,
    -2.400758277161838e+00,
    -2.549732539343734e+00,
    4.374664141464968e+00,
    2.938163982698783e+00,
  ]
  const d = [
    7.784695709041462e-03,
    3.224671290700398e-01,
    2.445134137142996e+00,
    3.754408661907416e+00,
  ]

  const plow = 0.02425
  const phigh = 1 - plow

  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    )
  }

  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    )
  }

  const q = p - 0.5
  const r = q * q
  return (
    (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  )
}

function chiSquareQuantileApprox(p: number, dof: number) {
  // Wilson–Hilferty transform approximation.
  if (!(dof > 0) || !(p > 0 && p < 1)) return NaN
  const z = normalQuantile(p)
  const a = 2 / (9 * dof)
  return dof * Math.pow(1 - a + z * Math.sqrt(a), 3)
}

export function leastSquaresAdjustment(
  fixedPoints: Array<{ name: string; easting: number; northing: number }>,
  unknownPoints: Array<{ name: string; eastingApprox: number; northingApprox: number }>,
  observations: Observation[],
  options?: {
    maxIterations?: number
    convergenceMm?: number
    standardizedResidualLimit?: number
    globalTestAlpha?: number
  }
): LSAdjustmentResult {
  const maxIterations = options?.maxIterations ?? 20
  const convergenceMm = options?.convergenceMm ?? 0.001
  const standardizedResidualLimit = options?.standardizedResidualLimit ?? 3.0
  const globalTestAlpha = options?.globalTestAlpha ?? 0.05

  if (fixedPoints.length < 1) {
    return {
      ok: false,
      adjustedPoints: [],
      residuals: [],
      referenceVariance: 0,
      chiSquare: 0,
      degreesOfFreedom: 0,
      passed: false,
      error: 'Least squares requires at least 1 fixed control point'
    }
  }

  // Warn if only 1 fixed point — cadastral surveys require 2 per Survey Regulations Reg 60 & 67
  const lsqWarnings: string[] = []
  if (fixedPoints.length < 2) {
    lsqWarnings.push('Only 1 fixed control point provided. Per Survey Regulations Reg. 60(2)(c) and Reg. 67, cadastral traverses must close between two previously fixed stations. A single fixed point creates a swinging traverse — prohibited for cadastral surveys.')
  }

  const hasAtLeastOneBearing = observations.some((o) => typeof o.bearing === 'number')
  if (!hasAtLeastOneBearing && fixedPoints.length < 2) {
    return {
      ok: false,
      adjustedPoints: [],
      residuals: [],
      referenceVariance: 0,
      chiSquare: 0,
      degreesOfFreedom: 0,
      passed: false,
      error: 'With distance-only observations, at least 2 fixed points are required to prevent rotation'
    }
  }

  const unknownIndex = new Map<string, number>()
  unknownPoints.forEach((p, i) => unknownIndex.set(p.name, i))

  const fixed = new Map<string, Point>()
  fixedPoints.forEach((p) => fixed.set(p.name, { easting: p.easting, northing: p.northing }))

  const x: number[] = new Array(unknownPoints.length * 2)
  for (let i = 0; i < unknownPoints.length; i++) {
    x[2 * i] = unknownPoints[i].eastingApprox
    x[2 * i + 1] = unknownPoints[i].northingApprox
  }

  const getPoint = (name: string): Point | null => {
    const f = fixed.get(name)
    if (f) return f
    const idx = unknownIndex.get(name)
    if (idx === undefined) return null
    return { easting: x[2 * idx], northing: x[2 * idx + 1] }
  }

  const activeObservations = observations.filter((o) => o.distance !== undefined || o.bearing !== undefined)
  const m = activeObservations.length
  const n = unknownPoints.length * 2
  if (m <= n) {
    return {
      ok: false,
      adjustedPoints: [],
      residuals: [],
      referenceVariance: 0,
      chiSquare: 0,
      degreesOfFreedom: 0,
      passed: false,
      error: `Insufficient redundancy: observations=${m}, unknowns=${n}`
    }
  }

  let lastDxMax = Infinity

  let A: number[][] = []
  let w: number[] = []
  let Pdiag: number[] = []
  let computedResiduals: Array<{ key: string; residual: number; weight: number; aRow: number[] }> = []

  for (let iter = 0; iter < maxIterations; iter++) {
    A = zeros(m, n)
    w = new Array(m).fill(0)
    Pdiag = new Array(m).fill(0)
    computedResiduals = []

    for (let i = 0; i < m; i++) {
      const obs = activeObservations[i]
      const from = getPoint(obs.from)
      const to = getPoint(obs.to)
      if (!from || !to) {
        return {
          ok: false,
          adjustedPoints: [],
          residuals: [],
          referenceVariance: 0,
          chiSquare: 0,
          degreesOfFreedom: 0,
          passed: false,
          error: `Unknown point referenced in observation: ${obs.from} -> ${obs.to}`
        }
      }

      const dE = to.easting - from.easting
      const dN = to.northing - from.northing
      const r2 = dE * dE + dN * dN
      const r = Math.sqrt(r2)

      const fromUnknown = unknownIndex.get(obs.from)
      const toUnknown = unknownIndex.get(obs.to)

      let row = new Array(n).fill(0)
      let residual = 0

      if (obs.distance !== undefined) {
        if (r === 0) {
          return {
            ok: false,
            adjustedPoints: [],
            residuals: [],
            referenceVariance: 0,
            chiSquare: 0,
            degreesOfFreedom: 0,
            passed: false,
            error: `Zero distance geometry in observation: ${obs.from} -> ${obs.to}`
          }
        }

        // f = sqrt(dE^2 + dN^2)
        // partials w.r.t coords of from/to
        const dfdE = dE / r
        const dfdN = dN / r

        if (fromUnknown !== undefined) {
          row[2 * fromUnknown] = -dfdE
          row[2 * fromUnknown + 1] = -dfdN
        }
        if (toUnknown !== undefined) {
          row[2 * toUnknown] = dfdE
          row[2 * toUnknown + 1] = dfdN
        }

        residual = obs.distance - r
      } else if (obs.bearing !== undefined) {
        if (r2 === 0) {
          return {
            ok: false,
            adjustedPoints: [],
            residuals: [],
            referenceVariance: 0,
            chiSquare: 0,
            degreesOfFreedom: 0,
            passed: false,
            error: `Zero bearing geometry in observation: ${obs.from} -> ${obs.to}`
          }
        }

        const theta = Math.atan2(dE, dN) // WCB, radians
        const l = toRadians(obs.bearing)
        residual = wrapAngleRad(l - theta)

        // θ = atan2(dE, dN)
        // ∂θ/∂dE = dN / (dE^2 + dN^2)
        // ∂θ/∂dN = -dE / (dE^2 + dN^2)
        const dtdE = dN / r2
        const dtdN = -dE / r2

        if (fromUnknown !== undefined) {
          row[2 * fromUnknown] = -(-dtdE) // because dE = E_to - E_from
          row[2 * fromUnknown + 1] = -(-dtdN) // dN = N_to - N_from
          // Simplify: θ depends on dE,dN; with respect to E_from: ∂θ/∂E_from = -∂θ/∂dE
          row[2 * fromUnknown] = -dtdE
          row[2 * fromUnknown + 1] = -dtdN
        }
        if (toUnknown !== undefined) {
          row[2 * toUnknown] = dtdE
          row[2 * toUnknown + 1] = dtdN
        }
      }

      A[i] = row
      w[i] = residual
      const weightFromSigmas = () => {
        if (obs.distance !== undefined && typeof obs.distanceSigma === 'number' && obs.distanceSigma > 0) {
          return 1 / (obs.distanceSigma * obs.distanceSigma)
        }
        if (obs.bearing !== undefined && typeof obs.bearingSigmaArcSec === 'number' && obs.bearingSigmaArcSec > 0) {
          const sigmaRad = (obs.bearingSigmaArcSec * Math.PI) / (180 * 3600)
          return 1 / (sigmaRad * sigmaRad)
        }
        return 1
      }

      const weight = typeof obs.weight === 'number' && obs.weight > 0 ? obs.weight : weightFromSigmas()
      Pdiag[i] = weight

      computedResiduals.push({
        key: `${obs.from}->${obs.to}:${obs.distance !== undefined ? 'D' : 'B'}`,
        residual,
        weight,
        aRow: row,
      })
    }

    // Build normal equations: N = A^T P A, u = A^T P w
    const At = transpose(A)

    const PA = zeros(m, n)
    const Pw = new Array(m).fill(0)
    for (let i = 0; i < m; i++) {
      const p = Pdiag[i]
      Pw[i] = p * w[i]
      for (let j = 0; j < n; j++) PA[i][j] = p * A[i][j]
    }

    const Nmat = matMul(At, PA)
    const u = matVecMul(At, Pw)

    let dx: number[]
    try {
      dx = gaussianSolve(Nmat.map((r) => [...r]), u)
    } catch (e: unknown) {
      return {
        ok: false,
        adjustedPoints: [],
        residuals: [],
        referenceVariance: 0,
        chiSquare: 0,
        degreesOfFreedom: 0,
        passed: false,
        error: (e instanceof Error ? (e as Error).message : String(e)),
      }
    }

    let dxMax = 0
    for (let i = 0; i < dx.length; i++) {
      x[i] += dx[i]
      dxMax = Math.max(dxMax, Math.abs(dx[i]))
    }

    lastDxMax = dxMax
    if (dxMax * 1000 <= convergenceMm) break
    if (!isFinite(dxMax)) break
  }

  if (!isFinite(lastDxMax)) {
    return {
      ok: false,
      adjustedPoints: [],
      residuals: [],
      referenceVariance: 0,
      chiSquare: 0,
      degreesOfFreedom: 0,
      passed: false,
      error: 'Adjustment diverged',
    }
  }

  // Rebuild design matrix at final estimates (for covariance + residual tests).
  A = zeros(m, n)
  w = new Array(m).fill(0)
  Pdiag = new Array(m).fill(0)
  computedResiduals = []

  for (let i = 0; i < m; i++) {
    const obs = activeObservations[i]
    const from = getPoint(obs.from)
    const to = getPoint(obs.to)
    if (!from || !to) {
      return {
        ok: false,
        adjustedPoints: [],
        residuals: [],
        referenceVariance: 0,
        chiSquare: 0,
        degreesOfFreedom: 0,
        passed: false,
        error: `Unknown point referenced in observation: ${obs.from} -> ${obs.to}`,
      }
    }

    const dE = to.easting - from.easting
    const dN = to.northing - from.northing
    const r2 = dE * dE + dN * dN
    const r = Math.sqrt(r2)

    const fromUnknown = unknownIndex.get(obs.from)
    const toUnknown = unknownIndex.get(obs.to)

    let row = new Array(n).fill(0)
    let residual = 0

    if (obs.distance !== undefined) {
      if (r === 0) {
        return {
          ok: false,
          adjustedPoints: [],
          residuals: [],
          referenceVariance: 0,
          chiSquare: 0,
          degreesOfFreedom: 0,
          passed: false,
          error: `Zero distance geometry in observation: ${obs.from} -> ${obs.to}`,
        }
      }

      const dfdE = dE / r
      const dfdN = dN / r

      if (fromUnknown !== undefined) {
        row[2 * fromUnknown] = -dfdE
        row[2 * fromUnknown + 1] = -dfdN
      }
      if (toUnknown !== undefined) {
        row[2 * toUnknown] = dfdE
        row[2 * toUnknown + 1] = dfdN
      }

      residual = obs.distance - r
    } else if (obs.bearing !== undefined) {
      if (r2 === 0) {
        return {
          ok: false,
          adjustedPoints: [],
          residuals: [],
          referenceVariance: 0,
          chiSquare: 0,
          degreesOfFreedom: 0,
          passed: false,
          error: `Zero bearing geometry in observation: ${obs.from} -> ${obs.to}`,
        }
      }

      const theta = Math.atan2(dE, dN)
      const l = toRadians(obs.bearing)
      residual = wrapAngleRad(l - theta)

      const dtdE = dN / r2
      const dtdN = -dE / r2

      if (fromUnknown !== undefined) {
        row[2 * fromUnknown] = -dtdE
        row[2 * fromUnknown + 1] = -dtdN
      }
      if (toUnknown !== undefined) {
        row[2 * toUnknown] = dtdE
        row[2 * toUnknown + 1] = dtdN
      }
    }

      A[i] = row
      w[i] = residual
      const weightFromSigmas = () => {
        if (obs.distance !== undefined && typeof obs.distanceSigma === 'number' && obs.distanceSigma > 0) {
          return 1 / (obs.distanceSigma * obs.distanceSigma)
        }
        if (obs.bearing !== undefined && typeof obs.bearingSigmaArcSec === 'number' && obs.bearingSigmaArcSec > 0) {
          const sigmaRad = (obs.bearingSigmaArcSec * Math.PI) / (180 * 3600)
          return 1 / (sigmaRad * sigmaRad)
        }
        return 1
      }

      const weight = typeof obs.weight === 'number' && obs.weight > 0 ? obs.weight : weightFromSigmas()
      Pdiag[i] = weight
      computedResiduals.push({
        key: `${obs.from}->${obs.to}:${obs.distance !== undefined ? 'D' : 'B'}`,
        residual,
        weight,
        aRow: row,
      })
  }

  // Compute final residuals:
  // w_final = l - f(x̂); v = -w_final.
  const v = new Array(m).fill(0)
  const obsLabel: string[] = new Array(m).fill('')
  for (let i = 0; i < m; i++) {
    const obs = activeObservations[i]
    const from = getPoint(obs.from)!
    const to = getPoint(obs.to)!
    const dE = to.easting - from.easting
    const dN = to.northing - from.northing
    const r2 = dE * dE + dN * dN
    const r = Math.sqrt(r2)

    if (obs.distance !== undefined) {
      v[i] = -(obs.distance - r)
      obsLabel[i] = `${obs.from}→${obs.to} distance`
    } else if (obs.bearing !== undefined) {
      const theta = Math.atan2(dE, dN)
      const l = toRadians(obs.bearing)
      v[i] = -wrapAngleRad(l - theta)
      obsLabel[i] = `${obs.from}→${obs.to} bearing`
    }
  }

  const dof = m - n
  const vPv = v.reduce((sum, vi, i) => sum + Pdiag[i] * vi * vi, 0)
  const referenceVariance = dof > 0 ? vPv / dof : 0

  // Parameter covariance: Σxx = σ0^2 * N^{-1}
  let Ninv: number[][]
  try {
    // Rebuild N at final for covariance
    const At = transpose(A)
    const PA = zeros(m, n)
    for (let i = 0; i < m; i++) {
      const p = Pdiag[i]
      for (let j = 0; j < n; j++) PA[i][j] = p * A[i][j]
    }
    const Nmat = matMul(At, PA)
    Ninv = invertMatrix(Nmat)
  } catch {
    Ninv = zeros(n, n)
  }

  const adjustedPoints = unknownPoints.map((p, i) => {
    const varE = referenceVariance * (Ninv[2 * i]?.[2 * i] ?? 0)
    const varN = referenceVariance * (Ninv[2 * i + 1]?.[2 * i + 1] ?? 0)
    return {
      name: p.name,
      easting: x[2 * i],
      northing: x[2 * i + 1],
      sigmaEasting: varE > 0 ? Math.sqrt(varE) : 0,
      sigmaNorthing: varN > 0 ? Math.sqrt(varN) : 0,
    }
  })

  // Residual covariance diagonal: qvv_i = 1/weight - a_i^T Qxx a_i
  const residuals = computedResiduals.map((r, i) => {
    const a = r.aRow
    const Qxx = Ninv
    const Qa = matVecMul(Qxx, a)
    const aTQa = dot(a, Qa)

    const qll = 1 / r.weight
    const qvv = Math.max(0, qll - aTQa)
    const denom = Math.sqrt((referenceVariance || 1) * (qvv || qll || 1))

    return {
      observation: obsLabel[i] || r.key,
      residual: v[i],
      standardizedResidual: denom > 0 ? v[i] / denom : 0,
    }
  })

  const passed = residuals.every(r => Math.abs(r.standardizedResidual) <= standardizedResidualLimit)

  const globalTest =
    dof > 0 && globalTestAlpha > 0 && globalTestAlpha < 1
      ? (() => {
          const lower = chiSquareQuantileApprox(globalTestAlpha / 2, dof)
          const upper = chiSquareQuantileApprox(1 - globalTestAlpha / 2, dof)
          const globalPassed = Number.isFinite(lower) && Number.isFinite(upper) ? vPv >= lower && vPv <= upper : true
          return { alpha: globalTestAlpha, lower, upper, passed: globalPassed }
        })()
      : undefined

  return {
    ok: true,
    adjustedPoints,
    residuals,
    referenceVariance,
    chiSquare: vPv,
    degreesOfFreedom: dof,
    globalTest,
    passed,
  }
}

/**
 * Unified 2D/3D Least Squares Network Adjustment
 *
 * Supports 6 observation types: distance, bearing, angle, slope_distance,
 * zenith_angle, height_difference. Angle observations are modeled as
 * the difference of two direction observations (Ghilani/Wolf Ch.14).
 *
 * 3D mode adds RL as a third unknown per point and handles slope distances,
 * zenith angles, and height differences.
 */
export function adjustNetwork(input: LSAdjustmentInput): LSAdjustmentResult {
  const is3D = input.dimension === '3D'
  const dim = is3D ? 3 : 2
  const maxIter = input.maxIterations ?? 20
  const convMm = input.convergenceMm ?? 0.001
  const stdResLimit = input.standardizedResidualLimit ?? 3.0
  const globalAlpha = input.globalTestAlpha ?? 0.05

  if (input.fixedPoints.length < 1) {
    return failResult('At least 1 fixed control point required')
  }

  const unknownIdx = new Map<string, number>()
  input.adjustablePoints.forEach((p, i) => unknownIdx.set(p.name, i))

  const fixedCoords = new Map<string, { e: number; n: number; h: number }>()
  for (const fp of input.fixedPoints) {
    fixedCoords.set(fp.name, { e: fp.easting, n: fp.northing, h: fp.rl ?? 0 })
  }

  // Working coordinate array: per unknown point, [E, N, (RL)]
  const nPts = input.adjustablePoints.length
  const nUnknowns = nPts * dim
  const x = new Array(nUnknowns).fill(0)
  for (let i = 0; i < nPts; i++) {
    x[dim * i] = input.adjustablePoints[i].easting
    x[dim * i + 1] = input.adjustablePoints[i].northing
    if (is3D) x[dim * i + 2] = input.adjustablePoints[i].rl ?? 0
  }

  function getCoord(name: string): { e: number; n: number; h: number } | null {
    const f = fixedCoords.get(name)
    if (f) return f
    const idx = unknownIdx.get(name)
    if (idx === undefined) return null
    return { e: x[dim * idx], n: x[dim * idx + 1], h: is3D ? x[dim * idx + 2] : 0 }
  }

  // Classify observations into active set
  const active = input.observations.filter((o) => {
    if (o.type === 'angle') return o.occupied && o.backsight && o.foresight && typeof o.angle === 'number'
    if (o.type === 'slope_distance') return o.from && o.to && typeof o.slopeDistance === 'number'
    if (o.type === 'zenith_angle') return o.from && o.to && typeof o.zenithAngle === 'number'
    if (o.type === 'height_difference') return o.from && o.to && typeof o.heightDifference === 'number'
    return (typeof o.distance === 'number') || (typeof o.bearing === 'number')
  })

  const m = active.length
  if (m < 1) {
    return failResult('No valid observations')
  }

  // Under-determined systems (m < nUnknowns) are handled via Tikhonov regularization.
  // This produces the minimum-norm solution (free network / inner constraint adjustment).
  // It keeps adjusted values close to their initial approximations for unconstrained params.

  let lastDxMax = Infinity
  let finalA: number[][] = zeros(m, nUnknowns)
  let finalW: number[] = new Array(m).fill(0)
  let finalP: number[] = new Array(m).fill(0)
  let finalLabels: string[] = new Array(m).fill('')
  let finalObsList: unknown[] = []

  for (let iter = 0; iter < maxIter; iter++) {
    const A = zeros(m, nUnknowns)
    const w = new Array(m).fill(0)
    const P = new Array(m).fill(0)
    let hasNaN = false

    for (let i = 0; i < m; i++) {
      const obs = active[i]
      const result = buildObservationRow(obs, getCoord, unknownIdx, dim, is3D)
      if (!result) { hasNaN = true; break }

      A[i] = result.row
      w[i] = result.residual
      P[i] = result.weight
    }

    if (hasNaN) break

    // Normal equations: N = A^T P A, u = A^T P w
    const At = transpose(A)
    const PA = zeros(m, nUnknowns)
    const Pw = new Array(m).fill(0)
    for (let i = 0; i < m; i++) {
      Pw[i] = P[i] * w[i]
      for (let j = 0; j < nUnknowns; j++) PA[i][j] = P[i] * A[i][j]
    }
    const Nmat = matMul(At, PA)
    const u = matVecMul(At, Pw)

    // Tikhonov regularization for near-singular or under-determined systems.
    // Adds a tiny diagonal term so the matrix is always positive-definite.
    // This implements free-network (inner constraint) adjustment per Ghilani Ch.15.
    const regAlpha = 1e-10
    for (let i = 0; i < nUnknowns; i++) {
      Nmat[i][i] += regAlpha
    }

    let dx: number[]
    try {
      dx = gaussianSolve(Nmat.map((r) => [...r]), u)
    } catch {
      return failResult('Normal matrix singular or ill-conditioned')
    }

    let dxMax = 0
    for (let i = 0; i < dx.length; i++) {
      x[i] += dx[i]
      if (isFinite(dx[i])) dxMax = Math.max(dxMax, Math.abs(dx[i]))
    }
    lastDxMax = dxMax
    if (dxMax * 1000 <= convMm) break
    if (!isFinite(dxMax)) break

    // Save final iteration data
    finalA = A
    finalW = w
    finalP = P
    finalObsList = active
    for (let i = 0; i < m; i++) {
      const obs = active[i]
      finalLabels[i] = obsLabel(obs)
    }
  }

  if (!isFinite(lastDxMax)) {
    return failResult('Adjustment diverged')
  }

  // Rebuild at final estimates for residuals and covariance
  const A = zeros(m, nUnknowns)
  const w = new Array(m).fill(0)
  const P = new Array(m).fill(0)

  for (let i = 0; i < m; i++) {
    const obs = active[i]
    const result = buildObservationRow(obs, getCoord, unknownIdx, dim, is3D)
    if (!result) continue
    A[i] = result.row
    w[i] = result.residual
    P[i] = result.weight
    finalLabels[i] = obsLabel(obs)
  }

  // Compute residuals v = -w (misclosure at final estimate)
  const v = w.map(wi => -wi)
  const dof = m - nUnknowns
  const vPv = v.reduce((s, vi, i) => s + P[i] * vi * vi, 0)
  const refVar = dof > 0 ? vPv / dof : 0

  // Covariance
  let Ninv: number[][] = zeros(nUnknowns, nUnknowns)
  try {
    const At = transpose(A)
    const PA = zeros(m, nUnknowns)
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < nUnknowns; j++) PA[i][j] = P[i] * A[i][j]
    }
    Ninv = invertMatrix(matMul(At, PA))
  } catch {
    // Ninv stays as zeros
  }

  // Build adjusted points with sigmas
  const adjustedPoints = input.adjustablePoints.map((p, i) => {
    const varE = refVar * (Ninv[dim * i]?.[dim * i] ?? 0)
    const varN = refVar * (Ninv[dim * i + 1]?.[dim * i + 1] ?? 0)
    const pt: any = {
      name: p.name,
      easting: x[dim * i],
      northing: x[dim * i + 1],
      sigmaEasting: varE > 0 ? Math.sqrt(varE) : 0,
      sigmaNorthing: varN > 0 ? Math.sqrt(varN) : 0,
    }
    if (is3D) {
      const varH = refVar * (Ninv[dim * i + 2]?.[dim * i + 2] ?? 0)
      pt.rl = x[dim * i + 2]
      pt.sigmaRL = varH > 0 ? Math.sqrt(varH) : 0
    }
    return pt
  })

  // Standardized residuals
  const residuals = v.map((vi, i) => {
    const aRow = A[i]
    const Qa = matVecMul(Ninv, aRow)
    const aTQa = dot(aRow, Qa)
    const qll = P[i] > 0 ? 1 / P[i] : 1
    const qvv = Math.max(0, qll - aTQa)
    const denom = Math.sqrt((refVar || 1) * (qvv || qll || 1))
    return {
      observation: finalLabels[i],
      residual: vi,
      standardizedResidual: denom > 0 ? vi / denom : 0,
    }
  })

  const passed = residuals.every(r => Math.abs(r.standardizedResidual) <= stdResLimit)

  const globalTest =
    dof > 0 && globalAlpha > 0 && globalAlpha < 1
      ? (() => {
          const lower = chiSquareQuantileApprox(globalAlpha / 2, dof)
          const upper = chiSquareQuantileApprox(1 - globalAlpha / 2, dof)
          const gp = Number.isFinite(lower) && Number.isFinite(upper) ? vPv >= lower && vPv <= upper : true
          return { alpha: globalAlpha, lower, upper, passed: gp }
        })()
      : undefined

  // ─── Baarda Reliability Analysis (H13, 2026-07-03) ───────────────────────
  //
  // For each observation i, compute:
  //   1. Redundancy number:  r_i = q_vv_i × p_i = 1 - (a_iᵀ · Qxx · a_i) × p_i
  //      where q_vv_i is the diagonal of Qvv = P⁻¹ - A·Qxx·Aᵀ
  //   2. w-test (data snooping):  w_i = |v_i| / √(σ̂₀² · q_vv_i)
  //      Reject H0 if w_i > z_{1-α/2}  (critical value from standard normal)
  //   3. Internal reliability (MDB):  ∇₀_i = (σ̂₀ · √(λ₀)) / √(p_i · r_i)
  //      where λ₀ is the non-centrality parameter for α, β
  //   4. External reliability:  ∇x_i = (Aᵀ·P·A)⁻¹ · a_iᵀ · p_i · ∇₀_i
  //      (max absolute coordinate effect)
  //
  // The non-centrality parameter λ₀ depends on α (significance) and β (power):
  //   λ₀ = (z_{1-α/2} + z_{1-β})²
  // For α=0.001, β=0.20 (power=0.80):  λ₀ = (3.29 + 0.84)² ≈ 17.07
  const reliability = (() => {
    if (dof <= 0 || !A || A.length === 0) return undefined

    const alpha = 0.001  // Baarda's standard α for the w-test
    const beta = 0.20    // 1-β = 0.80 power
    const power = 1 - beta
    // normalQuantile is the inverse standard normal CDF (Acklam's approx)
    const zAlpha = normalQuantile(1 - alpha / 2)  // ≈ 3.2905
    const zBeta = normalQuantile(power)            // ≈ 0.8416
    const lambda0 = Math.pow(zAlpha + zBeta, 2)    // ≈ 17.075
    const s0 = Math.sqrt(Math.max(refVar, 1e-15))

    const obsReliability = v.map((vi, i) => {
      const aRow = A[i]
      const pi = P[i]
      const qll = pi > 0 ? 1 / pi : 1
      const Qa = matVecMul(Ninv, aRow)
      const aTQa = dot(aRow, Qa)
      const qvv = Math.max(0, qll - aTQa)

      // 1. Redundancy number
      const r_i = qvv * pi

      // 2. w-test statistic
      const sigmaVi = Math.sqrt(Math.max(refVar, 1e-15) * qvv)
      const w_i = sigmaVi > 0 ? Math.abs(vi) / sigmaVi : 0

      // 3. Internal reliability (MDB) — guard against r_i → 0
      const mdb = r_i > 1e-10
        ? (s0 * Math.sqrt(lambda0)) / Math.sqrt(pi * r_i)
        : Infinity

      // 4. External reliability — max coordinate effect
      //    ∇x = Qxx · a_iᵀ · p_i · ∇₀_i, take max abs component
      let extRel = 0
      if (r_i > 1e-10 && isFinite(mdb)) {
        const gradX = matVecMul(Ninv, aRow).map(c => c * pi * mdb)
        extRel = Math.max(...gradX.map(Math.abs))
      }

      return {
        observation: finalLabels[i],
        redundancyNumber: Math.max(0, Math.min(1, r_i)),
        minimalDetectableBias: isFinite(mdb) ? mdb : Infinity,
        externalReliability: isFinite(extRel) ? extRel : Infinity,
        wTestStatistic: w_i,
        isOutlier: w_i > zAlpha,
      }
    })

    return {
      observations: obsReliability,
      wTestCriticalValue: zAlpha,
      alpha,
      power,
      nonCentralityParameter: lambda0,
    }
  })()

  return {
    ok: true,
    adjustedPoints,
    residuals,
    referenceVariance: refVar,
    chiSquare: vPv,
    degreesOfFreedom: dof,
    globalTest,
    reliability,
    passed,
  }
}

// ─── Internal helpers for adjustNetwork ──────────────────────────────────────

function failResult(error: string): LSAdjustmentResult {
  return {
    ok: false, adjustedPoints: [], residuals: [],
    referenceVariance: 0, chiSquare: 0, degreesOfFreedom: 0,
    passed: false, error,
  }
}

interface ObsRowResult {
  row: number[]
  residual: number
  weight: number
}

function buildObservationRow(
  obs: any,
  getCoord: (name: string) => { e: number; n: number; h: number } | null,
  unknownIdx: Map<string, number>,
  dim: number,
  is3D: boolean,
): ObsRowResult | null {
  const type = obs.type
  const row = new Array(unknownIdx.size * dim).fill(0)
  let residual = 0
  let weight = 1

  if (type === 'angle') {
    return buildAngleRow(obs, getCoord, unknownIdx, dim)
  }

  if (type === 'slope_distance') {
    const from = getCoord(obs.from)
    const to = getCoord(obs.to)
    if (!from || !to) return null

    const dE = to.e - from.e
    const dN = to.n - from.n
    const dH = to.h - from.h
    const SD = Math.sqrt(dE * dE + dN * dN + dH * dH)
    if (SD === 0) return null

    const fromU = unknownIdx.get(obs.from)
    const toU = unknownIdx.get(obs.to)

    if (fromU !== undefined) {
      row[dim * fromU] = -dE / SD
      row[dim * fromU + 1] = -dN / SD
      if (is3D) row[dim * fromU + 2] = -dH / SD
    }
    if (toU !== undefined) {
      row[dim * toU] = dE / SD
      row[dim * toU + 1] = dN / SD
      if (is3D) row[dim * toU + 2] = dH / SD
    }

    residual = obs.slopeDistance - SD
    if (typeof obs.slopeDistanceSigma === 'number' && obs.slopeDistanceSigma > 0) {
      weight = 1 / (obs.slopeDistanceSigma * obs.slopeDistanceSigma)
    }
    return { row, residual, weight }
  }

  if (type === 'zenith_angle') {
    const from = getCoord(obs.from)
    const to = getCoord(obs.to)
    if (!from || !to) return null

    const dE = to.e - from.e
    const dN = to.n - from.n
    const dH = to.h - from.h
    const horiz = Math.sqrt(dE * dE + dN * dN)
    const SD = Math.sqrt(dE * dE + dN * dN + dH * dH)
    if (SD === 0) return null

    // Zenith angle from vertical: Z = atan2(horiz, dH) (radians)
    const Z = Math.atan2(horiz, dH)
    const obsZ = toRadians(obs.zenithAngle)
    residual = wrapAngleRad(obsZ - Z)

    // Partials of Z w.r.t. dE, dN, dH
    // Z = atan2(horiz, dH)
    // ∂Z/∂dH = -horiz / SD²
    // ∂Z/∂horiz = dH / SD²
    // ∂Z/∂dE = (dH / SD²) * (dE / horiz)
    // ∂Z/∂dN = (dH / SD²) * (dN / horiz)

    const fromU = unknownIdx.get(obs.from)
    const toU = unknownIdx.get(obs.to)

    const dZdE = horiz > 1e-12 ? (dH / (SD * SD)) * (dE / horiz) : 0
    const dZdN = horiz > 1e-12 ? (dH / (SD * SD)) * (dN / horiz) : 0
    const dZdH = -horiz / (SD * SD)

    if (fromU !== undefined) {
      row[dim * fromU] = -dZdE
      row[dim * fromU + 1] = -dZdN
      if (is3D) row[dim * fromU + 2] = -dZdH
    }
    if (toU !== undefined) {
      row[dim * toU] = dZdE
      row[dim * toU + 1] = dZdN
      if (is3D) row[dim * toU + 2] = dZdH
    }

    if (typeof obs.zenithAngleSigmaArcSec === 'number' && obs.zenithAngleSigmaArcSec > 0) {
      const sigmaRad = (obs.zenithAngleSigmaArcSec * Math.PI) / (180 * 3600)
      weight = 1 / (sigmaRad * sigmaRad)
    }
    return { row, residual, weight }
  }

  if (type === 'height_difference') {
    const from = getCoord(obs.from)
    const to = getCoord(obs.to)
    if (!from || !to) return null

    const dH = to.h - from.h
    residual = obs.heightDifference - dH

    const fromU = unknownIdx.get(obs.from)
    const toU = unknownIdx.get(obs.to)

    if (fromU !== undefined && is3D) {
      row[dim * fromU + 2] = -1
    }
    if (toU !== undefined && is3D) {
      row[dim * toU + 2] = 1
    }

    if (typeof obs.heightDiffSigma === 'number' && obs.heightDiffSigma > 0) {
      weight = 1 / (obs.heightDiffSigma * obs.heightDiffSigma)
    }
    return { row, residual, weight }
  }

  // Legacy: distance or bearing (no explicit type)
  if (typeof obs.distance === 'number') {
    const from = getCoord(obs.from)
    const to = getCoord(obs.to)
    if (!from || !to) return null

    const dE = to.e - from.e
    const dN = to.n - from.n
    const r = Math.sqrt(dE * dE + dN * dN)
    if (r === 0) return null

    const fromU = unknownIdx.get(obs.from)
    const toU = unknownIdx.get(obs.to)

    if (fromU !== undefined) {
      row[dim * fromU] = -dE / r
      row[dim * fromU + 1] = -dN / r
    }
    if (toU !== undefined) {
      row[dim * toU] = dE / r
      row[dim * toU + 1] = dN / r
    }

    residual = obs.distance - r
    if (typeof obs.distanceSigma === 'number' && obs.distanceSigma > 0) {
      weight = 1 / (obs.distanceSigma * obs.distanceSigma)
    }
    return { row, residual, weight }
  }

  if (typeof obs.bearing === 'number') {
    const from = getCoord(obs.from)
    const to = getCoord(obs.to)
    if (!from || !to) return null

    const dE = to.e - from.e
    const dN = to.n - from.n
    const r2 = dE * dE + dN * dN
    if (r2 === 0) return null

    const theta = Math.atan2(dE, dN)
    const obsRad = toRadians(obs.bearing)
    residual = wrapAngleRad(obsRad - theta)

    const dtdE = dN / r2
    const dtdN = -dE / r2

    const fromU = unknownIdx.get(obs.from)
    const toU = unknownIdx.get(obs.to)

    if (fromU !== undefined) {
      row[dim * fromU] = -dtdE
      row[dim * fromU + 1] = -dtdN
    }
    if (toU !== undefined) {
      row[dim * toU] = dtdE
      row[dim * toU + 1] = dtdN
    }

    if (typeof obs.bearingSigmaArcSec === 'number' && obs.bearingSigmaArcSec > 0) {
      const sigmaRad = (obs.bearingSigmaArcSec * Math.PI) / (180 * 3600)
      weight = 1 / (sigmaRad * sigmaRad)
    }
    return { row, residual, weight }
  }

  return null
}

function buildAngleRow(
  obs: any,
  getCoord: (name: string) => { e: number; n: number; h: number } | null,
  unknownIdx: Map<string, number>,
  dim: number,
): ObsRowResult | null {
  const occ = getCoord(obs.occupied)
  const bs = getCoord(obs.backsight)
  const fs = getCoord(obs.foresight)
  if (!occ || !bs || !fs) return null

  // Direction vectors
  const dE_OF = fs.e - occ.e
  const dN_OF = fs.n - occ.n
  const r2_OF = dE_OF * dE_OF + dN_OF * dN_OF
  if (r2_OF === 0) return null

  const dE_OB = bs.e - occ.e
  const dN_OB = bs.n - occ.n
  const r2_OB = dE_OB * dE_OB + dN_OB * dN_OB
  if (r2_OB === 0) return null

  // Computed angle (radians)
  const theta_OF = Math.atan2(dE_OF, dN_OF)
  const theta_OB = Math.atan2(dE_OB, dN_OB)
  const computedAngle = wrapAngleRad(theta_OF - theta_OB)
  const obsAngle = toRadians(obs.angle)
  const residual = wrapAngleRad(obsAngle - computedAngle)

  const row = new Array(unknownIdx.size * dim).fill(0)

  // Direction partials: ∂θ_OP/∂E_P = dN / r², ∂θ_OP/∂N_P = -dE / r²
  // ∂θ_OP/∂E_O = -dN / r², ∂θ_OP/∂N_O = dE / r²
  const dtdE_OF = dN_OF / r2_OF  // ∂θ_OF/∂E_F = ∂θ_OF/∂E_occ
  const dtdN_OF = -dE_OF / r2_OF
  const dtdE_OB = dN_OB / r2_OB
  const dtdN_OB = -dE_OB / r2_OB

  // angle = θ_OF - θ_OB
  // ∂angle/∂E_occ = -dtdE_OF + dtdE_OB
  // ∂angle/∂N_occ = -dtdN_OF + dtdN_OB
  // ∂angle/∂E_bs = -dtdE_OB (affects only backsight)
  // ∂angle/∂N_bs = -dtdN_OB
  // ∂angle/∂E_fs = dtdE_OF (affects only foresight)
  // ∂angle/∂N_fs = dtdN_OF

  const occU = unknownIdx.get(obs.occupied)
  const bsU = unknownIdx.get(obs.backsight)
  const fsU = unknownIdx.get(obs.foresight)

  if (occU !== undefined) {
    row[dim * occU] = -dtdE_OF + dtdE_OB
    row[dim * occU + 1] = -dtdN_OF + dtdN_OB
  }
  if (bsU !== undefined) {
    row[dim * bsU] = -dtdE_OB
    row[dim * bsU + 1] = -dtdN_OB
  }
  if (fsU !== undefined) {
    row[dim * fsU] = dtdE_OF
    row[dim * fsU + 1] = dtdN_OF
  }

  let weight = 1
  if (typeof obs.angleSigmaArcSec === 'number' && obs.angleSigmaArcSec > 0) {
    const sigmaRad = (obs.angleSigmaArcSec * Math.PI) / (180 * 3600)
    weight = 1 / (sigmaRad * sigmaRad)
  }

  return { row, residual, weight }
}

function obsLabel(obs: any): string {
  const t = obs.type
  if (t === 'angle') return `${obs.occupied}: ${obs.backsight}→${obs.foresight} angle`
  if (t === 'slope_distance') return `${obs.from}→${obs.to} slope_dist`
  if (t === 'zenith_angle') return `${obs.from}→${obs.to} zenith`
  if (t === 'height_difference') return `${obs.from}→${obs.to} ΔH`
  if (typeof obs.distance === 'number') return `${obs.from}→${obs.to} distance`
  if (typeof obs.bearing === 'number') return `${obs.from}→${obs.to} bearing`
  return `${obs.from}→${obs.to} ?`
}

export function calculateRedundancy(unknowns: number, observations: number): number {
  return observations - unknowns * 2
}

export function getPrecisionGrade(ratio: number): string {
  if (ratio >= 5000) return 'excellent'
  if (ratio >= 3000) return 'good'
  if (ratio >= 1000) return 'acceptable'
  return 'poor'
}
