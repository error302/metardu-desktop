import { z } from 'zod'

export const StationSchema = z.object({
  id: z.string().min(1, 'Station ID is required'),
  name: z.string().min(1, 'Station name is required'),
  easting: z.number().finite(),
  northing: z.number().finite(),
  elevation: z.number().finite(),
  isFixed: z.boolean(),
})

export type Station = z.infer<typeof StationSchema>

export const ObservationSchema = z.object({
  from: z.string().min(1, 'From station is required'),
  to: z.string().min(1, 'To station is required'),
  deltaE: z.number().finite(),
  deltaN: z.number().finite(),
  deltaH: z.number().finite(),
  stdDevE: z.number().positive().max(1).default(0.005),
  stdDevN: z.number().positive().max(1).default(0.005),
  stdDevH: z.number().positive().max(1).default(0.010),
})

export type Observation = z.infer<typeof ObservationSchema>

let dbClient: any = null

async function logNetworkAdjustment(stations: Station[], observations: Observation[]) {
  if (typeof window === 'undefined') return
  try {
    const { createClient } = await import('@/lib/api-client/client')
    dbClient = createClient()
    await dbClient.from('network_adjustments').insert({
      stations,
      observations,
      status: 'pending',
    })
  } catch {
    // Non-blocking
  }
}

export interface AdjustedStation extends Station {
  residualE: number
  residualN: number
  residualH: number
  semiMajor: number
  semiMinor: number
  orientation: number
  sigmaE: number
  sigmaN: number
  sigmaH: number
}

export interface AdjustmentResult {
  adjustedStations: AdjustedStation[]
  sigmaZero: number
  degreesOfFreedom: number
  iterations: number
  passedTolerance: boolean
  warnings: string[]
  /** T1.5g: LSA statistical report (global test, w-test, reliability) */
  statisticalReport?: import('./lsaStatisticalTesting').StatisticalReport
}

export function adjustNetwork(
  stationsInput: Station[],
  observationsInput: Observation[]
): AdjustmentResult {
  const stationValidation = StationSchema.array().safeParse(stationsInput)
  if (!stationValidation.success) {
    const issues = stationValidation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid stations: ${issues}`)
  }
  const stations = stationValidation.data

  const obsValidation = ObservationSchema.array().safeParse(observationsInput)
  if (!obsValidation.success) {
    const issues = obsValidation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid observations: ${issues}`)
  }
  const observations = obsValidation.data

  const warnings: string[] = []

  logNetworkAdjustment(stations, observations).catch(() => {})

  const fixed = stations.filter(s => s.isFixed)
  if (fixed.length === 0) {
    throw new Error('At least one fixed control station is required.')
  }
  if (fixed.length < 2) {
    warnings.push('Only 1 fixed control station provided. Per Survey Regulations Reg. 60(2)(c) and Reg. 67, cadastral traverses must close between two previously fixed stations. A single fixed point results in an unconstrained network (swinging traverse) — prohibited for cadastral surveys.')
  }
  if (observations.length === 0) {
    throw new Error('At least one baseline observation is required.')
  }

  const free = stations.filter(s => !s.isFixed)
  const n = free.length * 3 // 3D: E, N, H
  const m = observations.length * 3 // 3 equations per baseline
  const dof = m - n

  if (dof < 0) {
    throw new Error(
      `Insufficient observations. Need at least ${Math.ceil(n / 3)} baselines for ${free.length} free stations.`
    )
  }

  const stationIndex = new Map<string, number>()
  free.forEach((s, i) => stationIndex.set(s.id, i))

  const coords = new Map<string, { e: number; n: number; h: number }>()
  stations.forEach(s => coords.set(s.id, { e: s.easting, n: s.northing, h: s.elevation }))

  const A: number[][] = []
  const W: number[] = []
  const l: number[] = []

  for (const obs of observations) {
    const fromCoord = coords.get(obs.from)!
    const toCoord = coords.get(obs.to)!

    const wE = 1 / (obs.stdDevE * obs.stdDevE)
    const wN = 1 / (obs.stdDevN * obs.stdDevN)
    const wH = 1 / (obs.stdDevH * obs.stdDevH)

    // Delta Easting
    const rowE = new Array(n).fill(0)
    if (stationIndex.has(obs.to)) rowE[stationIndex.get(obs.to)! * 3] = 1
    if (stationIndex.has(obs.from)) rowE[stationIndex.get(obs.from)! * 3] = -1
    const obsE = toCoord.e - fromCoord.e
    A.push(rowE)
    W.push(wE)
    l.push(obs.deltaE - obsE)

    // Delta Northing
    const rowN = new Array(n).fill(0)
    if (stationIndex.has(obs.to)) rowN[stationIndex.get(obs.to)! * 3 + 1] = 1
    if (stationIndex.has(obs.from)) rowN[stationIndex.get(obs.from)! * 3 + 1] = -1
    const obsN = toCoord.n - fromCoord.n
    A.push(rowN)
    W.push(wN)
    l.push(obs.deltaN - obsN)

    // Delta Height
    const rowH = new Array(n).fill(0)
    if (stationIndex.has(obs.to)) rowH[stationIndex.get(obs.to)! * 3 + 2] = 1
    if (stationIndex.has(obs.from)) rowH[stationIndex.get(obs.from)! * 3 + 2] = -1
    const obsH = toCoord.h - fromCoord.h
    A.push(rowH)
    W.push(wH)
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
    const c = coords.get(s.id)!
    coords.set(s.id, { e: c.e + x[i * 3], n: c.n + x[i * 3 + 1], h: c.h + x[i * 3 + 2] })
  })

  const residuals: number[] = []
  for (let i = 0; i < A.length; i++) {
    let ax = 0
    for (let j = 0; j < n; j++) ax += A[i][j] * x[j]
    residuals.push(ax - l[i])
  }

  const vWv = residuals.reduce((sum, v, i) => sum + W[i] * v * v, 0)
  const sigmaZero = dof > 0 ? Math.sqrt(vWv / dof) : 0

  if (dof === 0) {
    warnings.push('Zero degrees of freedom — cannot compute reliable error estimates.')
  }

  const Qxx = invertMatrix(N, n)

  const maxAllowedResidualE = 3 * Math.max(...observations.map(o => o.stdDevE))
  const maxAllowedResidualN = 3 * Math.max(...observations.map(o => o.stdDevN))
  const maxAllowedResidualH = 3 * Math.max(...observations.map(o => o.stdDevH))
  
  const passedTolerance = residuals.every((r, i) => {
    const mod = i % 3
    if (mod === 0) return Math.abs(r) < maxAllowedResidualE
    if (mod === 1) return Math.abs(r) < maxAllowedResidualN
    return Math.abs(r) < maxAllowedResidualH
  })

  if (!passedTolerance) {
    warnings.push('One or more residuals exceed 3σ tolerance. Check for blunders in baseline observations.')
  }
  if (sigmaZero > 2.0) {
    warnings.push(`Reference standard deviation (σ₀ = ${sigmaZero.toFixed(3)}) is high. Network may contain blunders or incorrect standard deviations.`)
  }

  const adjustedStations: AdjustedStation[] = stations.map(s => {
    const adjusted = coords.get(s.id)!
    let residualE = 0
    let residualN = 0
    let residualH = 0
    let semiMajor = 0
    let semiMinor = 0
    let orientation = 0
    let sigmaE = 0
    let sigmaN = 0
    let sigmaH = 0

    if (!s.isFixed) {
      const i = stationIndex.get(s.id)!
      residualE = x[i * 3]
      residualN = x[i * 3 + 1]
      residualH = x[i * 3 + 2]

      const qEE = Qxx[i * 3][i * 3]
      const qNN = Qxx[i * 3 + 1][i * 3 + 1]
      const qHH = Qxx[i * 3 + 2][i * 3 + 2]
      const qEN = Qxx[i * 3][i * 3 + 1]

      sigmaE = sigmaZero * Math.sqrt(Math.max(qEE, 0))
      sigmaN = sigmaZero * Math.sqrt(Math.max(qNN, 0))
      sigmaH = sigmaZero * Math.sqrt(Math.max(qHH, 0))

      const t2 = Math.atan2(2 * qEN, qEE - qNN) / 2
      const A2 = (qEE + qNN) / 2 + Math.sqrt(Math.pow((qEE - qNN) / 2, 2) + qEN * qEN)
      const B2 = (qEE + qNN) / 2 - Math.sqrt(Math.pow((qEE - qNN) / 2, 2) + qEN * qEN)
      semiMajor = sigmaZero * Math.sqrt(Math.max(A2, 0))
      semiMinor = sigmaZero * Math.sqrt(Math.max(B2, 0))
      orientation = (t2 * 180 / Math.PI + 360) % 360
    }

    return {
      ...s,
      easting: adjusted.e,
      northing: adjusted.n,
      elevation: adjusted.h,
      residualE,
      residualN,
      residualH,
      semiMajor,
      semiMinor,
      orientation,
      sigmaE,
      sigmaN,
      sigmaH,
    }
  })

  // T1.5g FIX (2026-07-10): Compute LSA statistical report (global test + w-test + reliability)
  let statisticalReport: AdjustmentResult['statisticalReport']
  if (dof > 0 && residuals.length > 0) {
    try {
      const { computeStatisticalReport, computeQvvDiagonal } = require('./lsaStatisticalTesting')

      // Build observation labels for the w-test
      const observationLabels = observations.flatMap(obs => [
        { from: obs.from, to: obs.to, component: 'E' as const },
        { from: obs.from, to: obs.to, component: 'N' as const },
        { from: obs.from, to: obs.to, component: 'H' as const },
      ])

      // Compute Qvv diagonal (needed for w-test and reliability)
      const QvvDiag = computeQvvDiagonal(A, W, Qxx)

      statisticalReport = computeStatisticalReport(
        sigmaZero,
        dof,
        residuals,
        QvvDiag,
        observationLabels,
        0.05,
      )

      // Add statistical report warnings to the existing warnings
      if (statisticalReport && statisticalReport.warnings.length > 0) {
        warnings.push(...statisticalReport.warnings)
      }
    } catch {
      // Statistical testing is non-blocking — if it fails, the adjustment is still valid
    }
  }

  return {
    adjustedStations,
    sigmaZero,
    degreesOfFreedom: dof,
    iterations: 1,
    passedTolerance,
    warnings,
    statisticalReport,
  }
}

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