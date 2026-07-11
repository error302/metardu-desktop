/**
 * Cassini ↔ UTM — Sub-sheets & Universal Converters
 *
 * 6-param affine + 12-param polynomial solvers, sub-sheet definition builder,
 * sub-sheet grid lookup, and the universal convertCassiniToUTM /
 * convertUTMToCassini dispatchers.
 */

// ponytail: moved to data/cassini/ to keep src/ lean (was 388k LOC of JSON in src/lib/geo/)
// Phase 3b will convert this to a lazy `await import()` so the IIFE doesn't run on every cold load.
import SUBSHEET_CORNERS_RAW from '../../../../data/cassini/merged_subsheets.json'
import { applyConformalCorrection, cassiniFeetToUTM, utmToCassiniFeet, computeHelmert4Params } from './helmert'
import { cassiniFeetToUTMExact7Param } from './exact'
import { estimateSheetAccuracy } from './verify'
import type {
  Affine6Params, CassiniFeetPoint, CommonPoint, ConversionResult, Poly12Params,
  SubSheetDef, TopoSheetParams, TransformMethod, UTMPoint, VerificationResult,
} from './types'

type SubSheetCornersJSON = Record<string, Record<string, { cassX: number; cassY: number; utmE: number; utmN: number }[]>>

// ─── General NxN Gaussian Elimination ───────────────────────────────────────

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length
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
      throw new Error(`Singular matrix at column ${col} in linear solve`)
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

function solveLeastSquares(A: number[][], b: number[]): number[] {
  const m = A.length
  const n = A[0].length
  const ATA = Array.from({ length: n }, () => new Array(n).fill(0))
  const ATb = new Array(n).fill(0)

  for (let r = 0; r < m; r++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        ATA[i][j] += A[r][i] * A[r][j]
      }
      ATb[i] += A[r][i] * b[r]
    }
  }
  return solveLinearSystem(ATA, ATb)
}

// ─── 6-Param Affine Solver ─────────────────────────────────────────────────

export function computeAffine6Params(commonPoints: CommonPoint[]): Affine6Params {
  if (commonPoints.length < 3) {
    throw new Error(`computeAffine6Params requires at least 3 common points; got ${commonPoints.length}`)
  }

  const A = commonPoints.map(cp => [1, cp.cassE, cp.cassN])
  const bE = commonPoints.map(cp => cp.utmE)
  const xE = solveLeastSquares(A, bE)

  const bN = commonPoints.map(cp => cp.utmN)
  const xN = solveLeastSquares(A, bN)

  return {
    id: 'computed-affine6',
    name: 'Computed Affine 6-Param',
    method: 'affine6',
    a: xE[0], b: xE[1], c: xE[2],
    d: xN[0], e: xN[1], f: xN[2],
    commonPoints,
  }
}

// ─── 12-Param Quadratic Polynomial Solver ──────────────────────────────────

export function computePoly12Params(commonPoints: CommonPoint[]): Poly12Params {
  if (commonPoints.length < 6) {
    throw new Error(`computePoly12Params requires at least 6 common points; got ${commonPoints.length}`)
  }

  const A = commonPoints.map(cp => {
    const x = cp.cassE
    const y = cp.cassN
    return [1, x, y, x * x, y * y, x * y]
  })

  const bE = commonPoints.map(cp => cp.utmE)
  const xE = solveLeastSquares(A, bE)

  const bN = commonPoints.map(cp => cp.utmN)
  const xN = solveLeastSquares(A, bN)

  return {
    id: 'computed-poly12',
    name: 'Computed Poly 12-Param',
    method: 'poly12',
    a: xE[0], b: xE[1], c: xE[2], l: xE[3], m: xE[4], n: xE[5],
    d: xN[0], e: xN[1], f: xN[2], p: xN[3], q: xN[4], r: xN[5],
    commonPoints,
  }
}

// ─── Build Sub-sheet Definitions ───────────────────────────────────────────

function buildSubSheets(): SubSheetDef[] {
  const raw = SUBSHEET_CORNERS_RAW as unknown as SubSheetCornersJSON
  const result: SubSheetDef[] = []

  for (const sheetId of Object.keys(raw)) {
    const subs = raw[sheetId]
    for (const subId of Object.keys(subs)) {
      const corners = subs[subId]

      if (corners.length < 3) continue

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const c of corners) {
        if (c.cassX < minX) minX = c.cassX
        if (c.cassX > maxX) maxX = c.cassX
        if (c.cassY < minY) minY = c.cassY
        if (c.cassY > maxY) maxY = c.cassY
      }

      const cp: CommonPoint[] = corners.map((c, i) => ({
        station: `${sheetId}/${subId}/C${i + 1}`,
        cassN: c.cassY,
        cassE: c.cassX,
        utmN: c.utmN,
        utmE: c.utmE,
      }))

      const fullId = `${sheetId}/${subId}`

      try {
        const helmertRaw = computeHelmert4Params(cp)
        const helmertParams: TopoSheetParams = {
          id: fullId,
          name: `Sub-sheet ${fullId} (Helmert)`,
          description: `Auto-computed Helmert 4-param from ${cp.length} corners.`,
          P: helmertRaw.P,
          Q: helmertRaw.Q,
          Cx: helmertRaw.Cx,
          Cy: helmertRaw.Cy,
          commonPoints: cp,
        }

        const affineParams = computeAffine6Params(cp)
        affineParams.id = fullId
        affineParams.name = `Sub-sheet ${fullId} (Affine)`

        result.push({
          sheetId, subId, fullId,
          corners,
          bounds: { minX, maxX, minY, maxY },
          helmertParams,
          affineParams,
        })
      } catch {
        // Skip sub-sheets with degenerate geometry
      }
    }
  }

  return result
}

// ponytail: IIFE runs at module load. Phase 3b will lazy-load.
export const KENYA_SUB_SHEETS: SubSheetDef[] = buildSubSheets()

export const SHEETS_WITH_SUBSHEETS = new Set(KENYA_SUB_SHEETS.map(ss => ss.sheetId))

export function getUtmZone(sheetId: string): number {
  const zone36Sheets = ['105/3']
  if (zone36Sheets.includes(sheetId)) return 36
  return 37
}

// ─── Sub-sheet Auto-detection ──────────────────────────────────────────────

export function getSubSheetGrid(sheetId: string): (SubSheetDef | null)[][] {
  const subs = KENYA_SUB_SHEETS.filter(ss => ss.sheetId === sheetId)
  if (subs.length === 0) return []
  const grid: (SubSheetDef | null)[][] = Array.from({ length: 5 }, () => Array(5).fill(null))
  for (const sub of subs) {
    const idx = parseInt(sub.subId) - 1
    if (idx >= 0 && idx < 25) {
      const row = Math.floor(idx / 5)
      const col = idx % 5
      grid[row][col] = sub
    }
  }
  return grid
}

export function findSubSheet(sheetId: string, cassX: number, cassY: number): SubSheetDef | undefined {
  const subsForSheet = KENYA_SUB_SHEETS.filter(ss => ss.sheetId === sheetId)
  for (const ss of subsForSheet) {
    const { minX, maxX, minY, maxY } = ss.bounds
    if (cassX >= minX && cassX <= maxX && cassY >= minY && cassY <= maxY) {
      return ss
    }
  }
  return undefined
}

// ─── Universal Forward Conversion ───────────────────────────────────────────

export function convertCassiniToUTM(
  points: CassiniFeetPoint[],
  params: TopoSheetParams | Affine6Params | Poly12Params | SubSheetDef,
  method?: TransformMethod,
): ConversionResult[] {
  if ('fullId' in params) {
    const m = method ?? 'affine6'
    if (m === 'affine6') return convertCassiniToUTM(points, params.affineParams, 'affine6')
    return convertCassiniToUTM(points, params.helmertParams, 'helmert4')
  }

  if ('method' in params && params.method === 'affine6') {
    const p = params as Affine6Params
    return points.map(pt => {
      try {
        const cassE = pt.easting
        const cassN = pt.northing
        const utmE = p.a + p.b * cassE + p.c * cassN
        const utmN = p.d + p.e * cassE + p.f * cassN
        return {
          id: pt.id,
          cassiniE: Math.round(cassE * 10) / 10,
          cassiniN: Math.round(cassN * 10) / 10,
          conformalE: Math.round(applyConformalCorrection(cassE) * 10) / 10,
          utmE: Math.round(utmE * 1000) / 1000,
          utmN: Math.round(utmN * 1000) / 1000,
        }
      } catch (err) {
        return {
          id: pt.id,
          cassiniE: pt.easting,
          cassiniN: pt.northing,
          conformalE: applyConformalCorrection(pt.easting),
          utmE: 0, utmN: 0,
          warning: `Affine conversion failed: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    })
  }

  if ('method' in params && params.method === 'poly12') {
    const p = params as Poly12Params
    return points.map(pt => {
      try {
        const x = pt.easting
        const y = pt.northing
        const utmE = p.a + p.b * x + p.c * y + p.l * x * x + p.m * y * y + p.n * x * y
        const utmN = p.d + p.e * x + p.f * y + p.p * x * x + p.q * y * y + p.r * x * y
        return {
          id: pt.id,
          cassiniE: Math.round(x * 10) / 10,
          cassiniN: Math.round(y * 10) / 10,
          conformalE: Math.round(applyConformalCorrection(x) * 10) / 10,
          utmE: Math.round(utmE * 1000) / 1000,
          utmN: Math.round(utmN * 1000) / 1000,
        }
      } catch (err) {
        return {
          id: pt.id,
          cassiniE: pt.easting,
          cassiniN: pt.northing,
          conformalE: applyConformalCorrection(pt.easting),
          utmE: 0, utmN: 0,
          warning: `Poly conversion failed: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    })
  }

  if (method === 'exactDatum7') {
    return cassiniFeetToUTMExact7Param(points)
  }

  return cassiniFeetToUTM(points, params as TopoSheetParams)
}

// ─── Universal Inverse Conversion ───────────────────────────────────────────

export function convertUTMToCassini(
  points: UTMPoint[],
  params: TopoSheetParams | Affine6Params | Poly12Params | SubSheetDef,
  method?: TransformMethod,
): ConversionResult[] {
  if ('fullId' in params) {
    const m = method ?? 'affine6'
    if (m === 'affine6') return convertUTMToCassini(points, params.affineParams, 'affine6')
    return convertUTMToCassini(points, params.helmertParams, 'helmert4')
  }

  if ('method' in params && params.method === 'affine6') {
    const p = params as Affine6Params
    return points.map(pt => {
      try {
        const utmE = pt.easting
        const utmN = pt.northing
        const dE = utmE - p.a
        const dN = utmN - p.d
        const det = p.b * p.f - p.c * p.e
        if (Math.abs(det) < 1e-20) {
          throw new Error('Singular affine matrix')
        }
        const cassE = (p.f * dE - p.c * dN) / det
        const cassN = (-p.e * dE + p.b * dN) / det
        return {
          id: pt.id,
          cassiniE: Math.round(cassE * 10) / 10,
          cassiniN: Math.round(cassN * 10) / 10,
          conformalE: Math.round(applyConformalCorrection(cassE) * 10) / 10,
          utmE: Math.round(utmE * 1000) / 1000,
          utmN: Math.round(utmN * 1000) / 1000,
        }
      } catch (err) {
        return {
          id: pt.id,
          cassiniE: 0, cassiniN: 0, conformalE: 0,
          utmE: pt.easting, utmN: pt.northing,
          warning: `Affine inverse failed: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    })
  }

  if ('method' in params && params.method === 'poly12') {
    const p = params as Poly12Params
    return points.map(pt => {
      try {
        const targetE = pt.easting
        const targetN = pt.northing
        const det0 = p.b * p.f - p.c * p.e
        if (Math.abs(det0) < 1e-20) throw new Error('Singular poly matrix (linear part)')
        let cassE = (p.f * (targetE - p.a) - p.c * (targetN - p.d)) / det0
        let cassN = (-p.e * (targetE - p.a) + p.b * (targetN - p.d)) / det0

        for (let iter = 0; iter < 10; iter++) {
          const x = cassE, y = cassN
          const fwdE = p.a + p.b * x + p.c * y + p.l * x * x + p.m * y * y + p.n * x * y
          const fwdN = p.d + p.e * x + p.f * y + p.p * x * x + p.q * y * y + p.r * x * y
          const resE = targetE - fwdE
          const resN = targetN - fwdN
          if (Math.abs(resE) < 1e-6 && Math.abs(resN) < 1e-6) break
          const J = [
            [p.b + 2 * p.l * x + p.n * y, p.c + 2 * p.m * y + p.n * x],
            [p.e + 2 * p.p * x + p.r * y, p.f + 2 * p.q * y + p.r * x],
          ]
          const detJ = J[0][0] * J[1][1] - J[0][1] * J[1][0]
          if (Math.abs(detJ) < 1e-20) throw new Error('Singular Jacobian in poly inverse')
          cassE += (J[1][1] * resE - J[0][1] * resN) / detJ
          cassN += (-J[1][0] * resE + J[0][0] * resN) / detJ
        }

        return {
          id: pt.id,
          cassiniE: Math.round(cassE * 10) / 10,
          cassiniN: Math.round(cassN * 10) / 10,
          conformalE: Math.round(applyConformalCorrection(cassE) * 10) / 10,
          utmE: Math.round(targetE * 1000) / 1000,
          utmN: Math.round(targetN * 1000) / 1000,
        }
      } catch (err) {
        return {
          id: pt.id,
          cassiniE: 0, cassiniN: 0, conformalE: 0,
          utmE: pt.easting, utmN: pt.northing,
          warning: `Poly inverse failed: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    })
  }

  return utmToCassiniFeet(points, params as TopoSheetParams)
}

// ─── Sub-sheet Accuracy Estimation ─────────────────────────────────────────

export function estimateSubSheetAccuracy(subSheet: SubSheetDef): { rmseMM: number; grade: string } {
  try {
    const acc = estimateSheetAccuracy(subSheet.helmertParams)
    return { rmseMM: acc.rmseMM, grade: acc.grade }
  } catch {
    return { rmseMM: NaN, grade: 'UNKNOWN' }
  }
}

// ─── Verify Affine6 & Poly12 Params ─────────────────────────────────────────

export function verifyAffine6Params(params: Affine6Params): VerificationResult[] {
  return params.commonPoints.map(cp => {
    const computedE = params.a + params.b * cp.cassE + params.c * cp.cassN
    const computedN = params.d + params.e * cp.cassE + params.f * cp.cassN
    return {
      station: cp.station,
      expectedE: cp.utmE,
      computedE: Math.round(computedE * 1000) / 1000,
      residualE: Math.round((computedE - cp.utmE) * 1000) / 1000,
      expectedN: cp.utmN,
      computedN: Math.round(computedN * 1000) / 1000,
      residualN: Math.round((computedN - cp.utmN) * 1000) / 1000,
    }
  })
}

export function verifyPoly12Params(params: Poly12Params): VerificationResult[] {
  return params.commonPoints.map(cp => {
    const x = cp.cassE, y = cp.cassN
    const computedE = params.a + params.b * x + params.c * y + params.l * x * x + params.m * y * y + params.n * x * y
    const computedN = params.d + params.e * x + params.f * y + params.p * x * x + params.q * y * y + params.r * x * y
    return {
      station: cp.station,
      expectedE: cp.utmE,
      computedE: Math.round(computedE * 1000) / 1000,
      residualE: Math.round((computedE - cp.utmE) * 1000) / 1000,
      expectedN: cp.utmN,
      computedN: Math.round(computedN * 1000) / 1000,
      residualN: Math.round((computedN - cp.utmN) * 1000) / 1000,
    }
  })
}
