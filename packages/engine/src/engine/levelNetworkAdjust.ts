/**
 * Level Network Adjustment Engine (Least Squares)
 * Phase A3 — Metardu Professional Engine
 *
 * Performs a 1D least squares adjustment of interconnected leveling loops.
 *
 * Observation Equation:
 * v = h_j - h_i - \Delta h_{ij}
 * where:
 *   h_i, h_j are the unknown elevations of stations i and j
 *   \Delta h_{ij} is the observed elevation difference from i to j
 *
 * Weighting:
 * w = 1 / L  (where L is distance in km) OR w = 1 / \sigma^2
 */

import { z } from 'zod'

export const LevelStationSchema = z.object({
  id: z.string().min(1, 'Station ID is required'),
  elevation: z.number().finite().default(0), // Approx if free, fixed if isFixed
  isFixed: z.boolean().default(false),
})

export type LevelStation = z.infer<typeof LevelStationSchema>

export const LevelObservationSchema = z.object({
  from: z.string().min(1, 'From station is required'),
  to: z.string().min(1, 'To station is required'),
  deltaH: z.number().finite(),
  distanceKm: z.number().positive().default(1),
})

export type LevelObservation = z.infer<typeof LevelObservationSchema>

export interface AdjustedLevelStation extends LevelStation {
  adjustedElevation: number
  residual: number
  stdDev: number
}

export interface LevelAdjustmentResult {
  adjustedStations: AdjustedLevelStation[]
  sigmaZero: number
  degreesOfFreedom: number
  passed: boolean
  warnings: string[]
  residuals: Array<{
    from: string
    to: string
    observedDelta: number
    adjustedDelta: number
    residual: number
    standardizedResidual: number
  }>
}

export function adjustLevelNetwork(
  stations: LevelStation[],
  observations: LevelObservation[]
): LevelAdjustmentResult {
  const stationValidation = LevelStationSchema.array().safeParse(stations)
  if (!stationValidation.success) {
    throw new Error('Invalid stations: ' + stationValidation.error.message)
  }
  const obsValidation = LevelObservationSchema.array().safeParse(observations)
  if (!obsValidation.success) {
    throw new Error('Invalid observations: ' + obsValidation.error.message)
  }

  const warnings: string[] = []

  const fixed = stations.filter(s => s.isFixed)
  if (fixed.length === 0) {
    throw new Error('At least one fixed benchmark is required.')
  }

  const free = stations.filter(s => !s.isFixed)
  const n = free.length
  const m = observations.length
  const dof = m - n

  if (dof < 0) {
    throw new Error(`Insufficient observations. Need at least ${n} runs for ${n} free stations.`)
  }

  const stationIndex = new Map<string, number>()
  free.forEach((s, i) => stationIndex.set(s.id, i))

  const elevations = new Map<string, number>()
  stations.forEach(s => elevations.set(s.id, s.elevation))

  // Estimate initial elevations if missing (using a simple spanning tree approach could be better, but we assume approximations or 0 are provided)
  // The system is linear, so initial approximations don't affect convergence, only the size of dx.

  const A: number[][] = []
  const W: number[] = []
  const l: number[] = []

  for (const obs of observations) {
    const fromH = elevations.get(obs.from) ?? 0
    const toH = elevations.get(obs.to) ?? 0
    
    // Weight inversely proportional to distance (km)
    // Variance is proportional to distance, so w = 1/var \propto 1/L
    const w = 1 / obs.distanceKm

    const row = new Array(n).fill(0)
    if (stationIndex.has(obs.to)) row[stationIndex.get(obs.to)!] = 1
    if (stationIndex.has(obs.from)) row[stationIndex.get(obs.from)!] = -1

    const obsH = toH - fromH
    A.push(row)
    W.push(w)
    l.push(obs.deltaH - obsH)
  }

  const N = multiplyAtWA(A, W, n)
  const t = multiplyAtWl(A, W, l, n)
  
  let x: number[]
  try {
    x = solveLinearSystem(N, t)
  } catch (err: unknown) {
    throw new Error('Failed to solve network equations: ' + (err as Error).message)
  }

  free.forEach((s, i) => {
    elevations.set(s.id, (elevations.get(s.id) ?? 0) + x[i])
  })

  const v: number[] = []
  for (let i = 0; i < m; i++) {
    let ax = 0
    for (let j = 0; j < n; j++) ax += A[i][j] * x[j]
    v.push(ax - l[i])
  }

  const vWv = v.reduce((sum, res, i) => sum + W[i] * res * res, 0)
  const sigmaZero = dof > 0 ? Math.sqrt(vWv / dof) : 0

  if (dof === 0) {
    warnings.push('Zero degrees of freedom — cannot compute reliable error estimates.')
  }

  const Qxx = invertMatrix(N, n)

  const residualsOut = observations.map((obs, i) => {
    const qll = 1 / W[i]
    let aTQa = 0
    const aRow = A[i]
    for (let row = 0; row < n; row++) {
      let sum = 0
      for (let col = 0; col < n; col++) {
        sum += Qxx[row][col] * aRow[col]
      }
      aTQa += aRow[row] * sum
    }
    const qvv = Math.max(0, qll - aTQa)
    const stdRes = qvv > 0 ? v[i] / (sigmaZero * Math.sqrt(qvv)) : 0

    return {
      from: obs.from,
      to: obs.to,
      observedDelta: obs.deltaH,
      adjustedDelta: obs.deltaH + v[i],
      residual: v[i],
      standardizedResidual: stdRes
    }
  })

  const passed = residualsOut.every(r => Math.abs(r.standardizedResidual) < 3.0)
  if (!passed) {
    warnings.push('One or more standardized residuals exceed 3.0. Check for blunders in leveling runs.')
  }

  const adjustedStations: AdjustedLevelStation[] = stations.map(s => {
    const adjH = elevations.get(s.id)!
    let stdDev = 0
    let res = 0

    if (!s.isFixed) {
      const idx = stationIndex.get(s.id)!
      res = x[idx]
      const qHH = Qxx[idx][idx]
      stdDev = sigmaZero * Math.sqrt(Math.max(qHH, 0))
    }

    return {
      ...s,
      adjustedElevation: adjH,
      residual: res,
      stdDev
    }
  })

  return {
    adjustedStations,
    sigmaZero,
    degreesOfFreedom: dof,
    passed,
    warnings,
    residuals: residualsOut
  }
}

// Re-using matrix functions
function multiplyAtWA(A: number[][], W: number[], n: number): number[][] {
  const result = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < A.length; k++)
        result[i][j] += A[k][i] * W[k] * A[k][j]
  return result
}

function multiplyAtWl(A: number[][], W: number[], l: number[], n: number): number[] {
  const result = new Array(n).fill(0)
  for (let i = 0; i < n; i++)
    for (let k = 0; k < A.length; k++)
      result[i] += A[k][i] * W[k] * l[k]
  return result
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let maxRow = col
    for (let row = col + 1; row < n; row++)
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row
    ;[M[col], M[maxRow]] = [M[maxRow], M[col]]
    if (Math.abs(M[col][col]) < 1e-12)
      throw new Error('Singular normal equation matrix — check network geometry.')
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
  const M = A.map((row, i) => {
    const aug = [...row, ...new Array(n).fill(0)]
    aug[n + i] = 1
    return aug
  })
  for (let col = 0; col < n; col++) {
    let maxRow = col
    for (let row = col + 1; row < n; row++)
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row
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
