/**
 * Cassini ↔ UTM — Datum Transformations
 *
 * 3-parameter Molodensky and 7-parameter Bursa-Wolf datum transformations
 * between the Clarke 1858 and Clarke 1880 ellipsoids within the Arc 1960 datum.
 * Also exposes pre-computed EllipsoidParams objects and cached Molodensky params.
 */

import {
  CLARKE_1858_A_M,
  CLARKE_1858_B_M,
  CLARKE_1858_F,
  CLARKE_1880_A_M,
  CLARKE_1880_B_M,
  CLARKE_1880_F,
  FT_TO_M,
} from './constants'
import type {
  BursaWolfParams,
  CommonPoint,
  MolodenskyParams,
} from './types'
// ponytail: type-only import from projection — breaks the runtime cycle.
import { cassiniInverse, tmInverse, tmForward } from './projection'

// ─── Ellipsoid Parameter Helper ───────────────────────────────────────────────

export interface EllipsoidParams {
  a: number
  b: number
  e2: number
  ep2: number
  e: number
  A0: number
  A2: number
  A4: number
  A6: number
}

function makeEllipsoid(a: number, b: number): EllipsoidParams {
  const e2 = (a * a - b * b) / (a * a)
  const ep2 = (a * a - b * b) / (b * b)
  const e = Math.sqrt(e2)
  const e4 = e2 * e2
  const e6 = e4 * e2
  const A0 = 1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256
  const A2 = 3 / 8 * (e2 + e4 / 4 + 15 * e6 / 128)
  const A4 = 15 / 256 * (e4 + 3 * e6 / 16)
  const A6 = 35 * e6 / 3072
  return { a, b, e2, ep2, e, A0, A2, A4, A6 }
}

export const CLARKE_1858_ELL: EllipsoidParams = makeEllipsoid(CLARKE_1858_A_M, CLARKE_1858_B_M)
export const CLARKE_1880_ELL: EllipsoidParams = makeEllipsoid(CLARKE_1880_A_M, CLARKE_1880_B_M)

// ─── Molodensky Datum Transformation ─────────────────────────────────────────

export function molodenskyTransform(
  lat: number,
  lon: number,
  h: number,
  dX: number,
  dY: number,
  dZ: number,
): { lat: number; lon: number; h: number } {
  const a1 = CLARKE_1858_ELL.a
  const e1sq = CLARKE_1858_ELL.e2
  const a2 = CLARKE_1880_ELL.a
  const f1 = CLARKE_1858_F
  const f2 = CLARKE_1880_F

  const da = a2 - a1
  const df = f2 - f1

  const sinPhi = Math.sin(lat)
  const cosPhi = Math.cos(lat)
  const sinLambda = Math.sin(lon)
  const cosLambda = Math.cos(lon)
  const sin2Phi = sinPhi * sinPhi

  const W1 = Math.sqrt(1 - e1sq * sin2Phi)
  const N1 = a1 / W1
  const M1 = a1 * (1 - e1sq) / (W1 * W1 * W1)

  const dPhi = (1 / (M1 + h)) * (
    (dX * sinPhi * cosLambda + dY * sinPhi * sinLambda - dZ * cosPhi)
    + da * N1 * e1sq * sinPhi * cosPhi / a1
    + df * (M1 + N1 * sin2Phi) * sinPhi * cosPhi
  )

  const cosPhiSafe = Math.abs(cosPhi) > 1e-10 ? cosPhi : (cosPhi >= 0 ? 1e-10 : -1e-10)
  const dLambda = (1 / ((N1 + h) * cosPhiSafe)) * (
    -dX * sinLambda + dY * cosLambda
  )

  const dh = (dX * cosPhi * cosLambda + dY * cosPhi * sinLambda - dZ * sinPhi)
    + da * (N1 / a1) * (1 - e1sq * sin2Phi)
    - df * a1 * sin2Phi

  return {
    lat: lat + dPhi,
    lon: lon + dLambda,
    h: h + dh,
  }
}

// ─── 7-Parameter Bursa-Wolf Datum Transformation ─────────────────────────────

export const KENYA_BURSA_WOLF: BursaWolfParams = {
  dX: -160, dY: -6, dZ: -302,
  rx: -0.807, ry: 0.339, rz: -1.619,
  ds: -2.554,
}

// ponytail: kept for completeness; benchmarked as WRONG params for this use case
// (152.7 m residual vs 2.9 m for Molodensky). See docs/cassini/engineering-log.md Task 5.
export const CLARKE1858_TO_CLARKE1880_BURSA: BursaWolfParams = {
  dX: 0, dY: 0, dZ: 0,
  rx: 0, ry: 0, rz: 0,
  ds: 0,
}

function geodeticToCartesian(
  lat: number, lon: number, h: number, ell: EllipsoidParams
): { X: number; Y: number; Z: number } {
  const sinPhi = Math.sin(lat)
  const cosPhi = Math.cos(lat)
  const sinLam = Math.sin(lon)
  const cosLam = Math.cos(lon)
  const e2 = ell.e2
  const a = ell.a
  const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi)
  return {
    X: (N + h) * cosPhi * cosLam,
    Y: (N + h) * cosPhi * sinLam,
    Z: ((1 - e2) * N + h) * sinPhi,
  }
}

function cartesianToGeodetic(
  X: number, Y: number, Z: number, ell: EllipsoidParams
): { lat: number; lon: number; h: number } {
  const a = ell.a
  const e2 = ell.e2
  const p = Math.sqrt(X * X + Y * Y)
  const lon = Math.atan2(Y, X)
  let phi = Math.atan2(Z, p * (1 - e2))
  for (let i = 0; i < 20; i++) {
    const sinPhi = Math.sin(phi)
    const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi)
    phi = Math.atan2(Z + e2 * N * sinPhi, p)
  }
  const sinPhi = Math.sin(phi)
  const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi)
  const h = p / Math.cos(phi) - N
  return { lat: phi, lon, h }
}

export function bursaWolfTransform(
  lat: number,
  lon: number,
  h: number,
  params: BursaWolfParams,
  sourceEll: EllipsoidParams,
  targetEll: EllipsoidParams,
): { lat: number; lon: number; h: number } {
  const xyz = geodeticToCartesian(lat, lon, h, sourceEll)

  const SEC_TO_RAD = Math.PI / (180 * 3600)
  const rx = params.rx * SEC_TO_RAD
  const ry = params.ry * SEC_TO_RAD
  const rz = params.rz * SEC_TO_RAD
  const s = 1 + params.ds * 1e-6

  const X2 = (params.dX + xyz.X * (1 + s) - xyz.Y * rz + xyz.Z * ry)
  const Y2 = (params.dY + xyz.X * rz + xyz.Y * (1 + s) - xyz.Z * rx)
  const Z2 = (params.dZ - xyz.X * ry + xyz.Y * rx + xyz.Z * (1 + s))

  return cartesianToGeodetic(X2, Y2, Z2, targetEll)
}

// ─── Molodensky Parameter Derivation ─────────────────────────────────────────

export function deriveMolodenskyParams(
  commonPoints: CommonPoint[],
  options?: { zone?: number; centralMeridianDeg?: number; cassiniMeridianDeg?: number },
): MolodenskyParams {
  const zone = options?.zone ?? 37
  const utmLon0 = ((options?.centralMeridianDeg ?? (6 * zone - 183)) * Math.PI) / 180
  const cassiniLon0 = ((options?.cassiniMeridianDeg ?? 37) * Math.PI) / 180
  const k0 = 0.9996
  const FE = 500_000
  const FN = 10_000_000

  const da = CLARKE_1880_ELL.a - CLARKE_1858_ELL.a
  const df = CLARKE_1880_F - CLARKE_1858_F
  const e1sq = CLARKE_1858_ELL.e2
  const a1 = CLARKE_1858_ELL.a

  const rows: number[][] = []
  const obs: number[] = []
  const pointMeta: Array<{ station: string; phi1: number; lambda1: number; N1: number; M1: number }> = []

  for (const cp of commonPoints) {
    const E_m = cp.cassE * FT_TO_M
    const N_m = cp.cassN * FT_TO_M
    const geo1858 = cassiniInverse(E_m, N_m, CLARKE_1858_ELL, cassiniLon0)
    const geo1880 = tmInverse(cp.utmE, cp.utmN, CLARKE_1880_ELL, utmLon0, k0, FE, FN)

    const phi1 = geo1858.lat
    const lambda1 = geo1858.lon
    const sinPhi = Math.sin(phi1)
    const cosPhi = Math.cos(phi1)
    const sinLambda = Math.sin(lambda1)
    const cosLambda = Math.cos(lambda1)
    const sin2Phi = sinPhi * sinPhi

    const W1 = Math.sqrt(1 - e1sq * sin2Phi)
    const N1 = a1 / W1
    const M1 = a1 * (1 - e1sq) / (W1 * W1 * W1)

    pointMeta.push({ station: cp.station, phi1, lambda1, N1, M1 })

    const dPhi_obs = geo1880.lat - phi1
    const dLambda_obs = geo1880.lon - lambda1

    const dPhi_ab = (da * N1 * e1sq * sinPhi * cosPhi / a1
      + df * (M1 + N1 * sin2Phi) * sinPhi * cosPhi) / M1

    rows.push([
      sinPhi * cosLambda / M1,
      sinPhi * sinLambda / M1,
      -cosPhi / M1,
    ])
    obs.push(dPhi_obs - dPhi_ab)

    const cosPhiSafe = Math.abs(cosPhi) > 1e-10 ? cosPhi : (cosPhi >= 0 ? 1e-10 : -1e-10)
    rows.push([
      -sinLambda / (N1 * cosPhiSafe),
      cosLambda / (N1 * cosPhiSafe),
      0,
    ])
    obs.push(dLambda_obs)
  }

  const n = 3
  const ATA = Array.from({ length: n }, () => new Array(n).fill(0))
  const ATb = new Array(n).fill(0)

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        ATA[i][j] += rows[rIdx][i] * rows[rIdx][j]
      }
      ATb[i] += rows[rIdx][i] * obs[rIdx]
    }
  }

  const x = solve3x3(ATA, ATb)
  const dX = x[0]
  const dY = x[1]
  const dZ = x[2]

  const residuals: MolodenskyParams['residuals'] = []
  let ssr = 0

  for (let i = 0; i < commonPoints.length; i++) {
    const cp = commonPoints[i]
    const meta = pointMeta[i]

    const transformed = molodenskyTransform(meta.phi1, meta.lambda1, 0, dX, dY, dZ)
    const utm = tmForward(transformed.lat, transformed.lon, CLARKE_1880_ELL, utmLon0, k0, FE, FN)

    const dE = utm.E - cp.utmE
    const dN = utm.N - cp.utmN
    residuals.push({ station: cp.station, dE, dN })
    ssr += dE * dE + dN * dN
  }

  const rmse = Math.sqrt(ssr / (2 * commonPoints.length))

  return { dX, dY, dZ, residuals, rmse }
}

function solve3x3(A: number[][], b: number[]): number[] {
  const n = 3
  const aug = A.map((row, i) => [...row, b[i]])

  for (let col = 0; col < n; col++) {
    let maxRow = col
    let maxVal = Math.abs(aug[col][col])
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col])
        maxRow = row
      }
    }
    if (maxVal < 1e-20) {
      throw new Error('Singular matrix in Molodensky parameter derivation')
    }
    if (maxRow !== col) {
      ;[aug[col], aug[maxRow]] = [aug[maxRow], aug[col]]
    }
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col]
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j]
      }
    }
  }

  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i][n]
    for (let j = i + 1; j < n; j++) {
      sum -= aug[i][j] * x[j]
    }
    x[i] = sum / aug[i][i]
  }
  return x
}

// ─── Cached Molodensky Params (derived from 148-series common points) ──────

let _cachedMolodenskyParams: MolodenskyParams | null = null

export function getMolodenskyParams(): MolodenskyParams {
  if (_cachedMolodenskyParams) return _cachedMolodenskyParams

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sheets = require('./sheets') as typeof import('./sheets')

  const allPoints = new Map<string, CommonPoint>()
  const sheetArrs = [
    sheets.COMMON_POINTS_148_1,
    sheets.COMMON_POINTS_148_2,
    sheets.COMMON_POINTS_148_2_1,
    sheets.COMMON_POINTS_148_3,
    sheets.COMMON_POINTS_148_4_1,
  ]
  for (const sheet of sheetArrs) {
    for (const cp of sheet) {
      allPoints.set(cp.station, cp)
    }
  }

  _cachedMolodenskyParams = deriveMolodenskyParams(Array.from(allPoints.values()))
  return _cachedMolodenskyParams
}
