/**
 * Cassini ↔ UTM — Helmert 4-Parameter Transformation
 *
 * The Kenyan Survey Department's 4-parameter Helmert Similarity transformation
 * to convert legacy Cassini-Soldner coordinates (FEET on Clarke 1858) to UTM
 * coordinates (METRES on Clarke 1880 / Arc 1960).
 */

import {
  CLARKE_1858_A_FT,
  CLARKE_1858_B_FT,
} from './constants'
import type {
  CassiniFeetPoint,
  UTMPoint,
  TopoSheetParams,
  CommonPoint,
  ConversionResult,
} from './types'

// ─── Conformal Correction ─────────────────────────────────────────────────

/**
 * Apply conformal correction to Cassini easting.
 * Formula:  E_conformal = E + E³/(6·a·b) + E⁵/(24·a²·b²)
 */
export function applyConformalCorrection(easting: number): number {
  const E = easting
  const a = CLARKE_1858_A_FT
  const b = CLARKE_1858_B_FT

  const ab = a * b
  const E3 = E * E * E
  const E5 = E3 * E * E

  const correction = E3 / (6 * ab) + E5 / (24 * ab * ab)

  return E + correction
}

// ─── A/B Polynomial Coefficient Solver ──────────────────────────────────

export function computeABCoefficients(
  params: TopoSheetParams,
): { A: number; B: number } | null {
  const n = params.commonPoints.length
  if (n < 3) return null

  let sumE4 = 0
  let sumE2N2 = 0
  let sumN4 = 0
  let sumE2res = 0
  let sumN2res = 0

  for (const cp of params.commonPoints) {
    const E_conf = applyConformalCorrection(cp.cassE)
    const N = cp.cassN

    const predE = params.P * E_conf + params.Q * N + params.Cx
    const residualE = cp.utmE - predE

    const E2 = E_conf * E_conf
    const N2 = N * N

    sumE4 += E2 * E2
    sumE2N2 += E2 * N2
    sumN4 += N2 * N2
    sumE2res += E2 * residualE
    sumN2res += N2 * residualE
  }

  const det = sumE4 * sumN4 - sumE2N2 * sumE2N2
  if (Math.abs(det) < 1e-60) return null

  const A = (sumN4 * sumE2res - sumE2N2 * sumN2res) / det
  const B = (sumE4 * sumN2res - sumE2N2 * sumE2res) / det

  return { A, B }
}

// ─── Least-Squares Helmert 4-Parameter Solver ─────────────────────────────

export function computeHelmert4Params(
  commonPoints: CommonPoint[],
): Omit<TopoSheetParams, 'commonPoints' | 'A' | 'B'> & { commonPoints: CommonPoint[] } {
  if (commonPoints.length < 2) {
    throw new Error(
      `computeHelmert4Params requires at least 2 common points; got ${commonPoints.length}`,
    )
  }

  const n = commonPoints.length

  const rows: number[][] = []
  const obs: number[] = []

  for (const cp of commonPoints) {
    const Econf = applyConformalCorrection(cp.cassE)
    const Nabs = cp.cassN

    rows.push([Econf,  Nabs, 1, 0])
    obs.push(cp.utmE)

    rows.push([Nabs, -Econf, 0, 1])
    obs.push(cp.utmN)
  }

  const cols = 4
  const MTM = Array.from({ length: cols }, () => new Array(cols).fill(0))
  const MTab = new Array(cols).fill(0)

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    for (let c1 = 0; c1 < cols; c1++) {
      for (let c2 = 0; c2 < cols; c2++) {
        MTM[c1][c2] += rows[rIdx][c1] * rows[rIdx][c2]
      }
      MTab[c1] += rows[rIdx][c1] * obs[rIdx]
    }
  }

  const x = solveLinear4x4(MTM, MTab)

  return {
    id: 'computed',
    name: 'Computed Parameters',
    description: `Helmert parameters computed from ${n} common points via least-squares.`,
    P: x[0],
    Q: x[1],
    Cx: x[2],
    Cy: x[3],
    commonPoints,
  }
}

function solveLinear4x4(A: number[][], b: number[]): number[] {
  const n = 4
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
      throw new Error('Singular matrix in Helmert parameter computation')
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

// ─── Forward Transformation: Cassini Feet → UTM Metres ───────────────────

export function cassiniFeetToUTM(
  points: CassiniFeetPoint[],
  params: TopoSheetParams,
): ConversionResult[] {
  return points.map((pt) => {
    try {
      const cassE = pt.easting
      const cassN = pt.northing

      const E_conf = applyConformalCorrection(cassE)
      const N_abs = cassN

      let utmE = params.P * E_conf + params.Q * N_abs + params.Cx
      const utmN = -params.Q * E_conf + params.P * N_abs + params.Cy

      if (params.A !== undefined && params.B !== undefined) {
        utmE += params.A * E_conf * E_conf + params.B * N_abs * N_abs
      }

      const roundedCassE = Math.round(cassE * 10) / 10
      const roundedCassN = Math.round(cassN * 10) / 10
      const roundedUtmE = Math.round(utmE * 1000) / 1000
      const roundedUtmN = Math.round(utmN * 1000) / 1000
      const roundedE_conf = Math.round(E_conf * 10) / 10

      return {
        id: pt.id,
        cassiniE: roundedCassE,
        cassiniN: roundedCassN,
        conformalE: roundedE_conf,
        utmE: roundedUtmE,
        utmN: roundedUtmN,
      }
    } catch (err) {
      return {
        id: pt.id,
        cassiniE: pt.easting,
        cassiniN: pt.northing,
        conformalE: applyConformalCorrection(pt.easting),
        utmE: 0,
        utmN: 0,
        warning: `Conversion failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })
}

// ─── Inverse Transformation: UTM Metres → Cassini Feet ────────────────────

export function utmToCassiniFeet(
  utmPoints: UTMPoint[],
  params: TopoSheetParams,
): ConversionResult[] {
  return utmPoints.map((pt) => {
    try {
      const utmE = pt.easting
      const utmN = pt.northing

      const dE = utmE - params.Cx
      const dN = utmN - params.Cy

      const det = params.P * params.P + params.Q * params.Q

      const E_conf = (params.P * dE - params.Q * dN) / det
      const N_abs = (params.Q * dE + params.P * dN) / det

      let cassE = E_conf
      for (let iter = 0; iter < 3; iter++) {
        const ab = CLARKE_1858_A_FT * CLARKE_1858_B_FT
        const correction = (cassE * cassE * cassE) / (6 * ab)
          + (cassE ** 5) / (24 * ab * ab)
        cassE = E_conf - correction
      }

      const cassN = -N_abs

      const roundedCassE = Math.round(cassE * 10) / 10
      const roundedCassN = Math.round(cassN * 10) / 10
      const roundedUtmE = Math.round(utmE * 1000) / 1000
      const roundedUtmN = Math.round(utmN * 1000) / 1000
      const roundedE_conf = Math.round(E_conf * 10) / 10

      return {
        id: pt.id,
        cassiniE: roundedCassE,
        cassiniN: roundedCassN,
        conformalE: roundedE_conf,
        utmE: roundedUtmE,
        utmN: roundedUtmN,
        warning: 'Approximate inverse — conformal correction removed iteratively. Verify for cadastral use.',
      }
    } catch (err) {
      return {
        id: pt.id,
        cassiniE: 0,
        cassiniN: 0,
        conformalE: 0,
        utmE: pt.easting,
        utmN: pt.northing,
        warning: `Inverse conversion failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })
}
