/**
 * Cassini ↔ UTM — Projection Primitives
 *
 * Low-level projection functions (Cassini-Soldner and Transverse Mercator,
 * forward and inverse) plus the meridional-arc / footpoint-latitude helpers.
 *
 * Shared by:
 *   - exact.ts (the public exact-chain functions)
 *   - datum.ts (for deriveMolodenskyParams, which needs cassiniInverse + tmInverse + tmForward)
 *
 * Reference: Snyder, "Map Projections — A Working Manual" (USGS PP 1395)
 */

import type { EllipsoidParams } from './datum'

// ─── Meridional Arc ────────────────────────────────────────────────────────────

export function meridionalArc(phi: number, ell: EllipsoidParams): number {
  const { a, A0, A2, A4, A6 } = ell
  return a * (A0 * phi - A2 * Math.sin(2 * phi) + A4 * Math.sin(4 * phi) - A6 * Math.sin(6 * phi))
}

// ─── Footpoint Latitude ───────────────────────────────────────────────────────

export function footpointLatitude(M: number, ell: EllipsoidParams): number {
  const { a, e2 } = ell
  const oneMinusE2 = 1 - e2

  let phi = M / (a * ell.A0)

  for (let i = 0; i < 50; i++) {
    const sinPhi = Math.sin(phi)
    const sin2Phi = sinPhi * sinPhi
    const M1 = meridionalArc(phi, ell)
    const dM = M - M1
    const denominator = a * oneMinusE2 / Math.pow(1 - e2 * sin2Phi, 1.5)
    const dPhi = dM / denominator
    phi += dPhi
    if (Math.abs(dPhi) < 1e-12) break
  }

  return phi
}

// ─── Inverse Cassini-Soldner ───────────────────────────────────────────────────

export function cassiniInverse(
  E_m: number,
  N_m: number,
  ell: EllipsoidParams,
  lon0: number = 37 * Math.PI / 180,
): { lat: number; lon: number } {
  const { a, e2, ep2 } = ell
  const oneMinusE2 = 1 - e2

  const phi1 = footpointLatitude(N_m, ell)

  const sinPhi1 = Math.sin(phi1)
  const cosPhi1 = Math.cos(phi1)
  const tanPhi1 = sinPhi1 / cosPhi1
  const sin2Phi1 = sinPhi1 * sinPhi1
  const tan2Phi1 = tanPhi1 * tanPhi1

  const C1 = 1 - e2 * sin2Phi1
  const N1 = a / Math.sqrt(C1)
  const R1 = a * oneMinusE2 / Math.pow(C1, 1.5)

  const D = E_m / N1
  const D2 = D * D
  const D3 = D2 * D
  const D4 = D3 * D
  const D5 = D4 * D
  const D6 = D5 * D

  const coef1 = (N1 * tanPhi1) / R1
  const phi = phi1 - coef1 * (
    D2 / 2
    - (5 + 3 * tan2Phi1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D4 / 24
    + (61 + 90 * tan2Phi1 + 298 * C1 + 45 * tan2Phi1 * tan2Phi1
       - 252 * ep2 - 3 * C1 * C1) * D6 / 720
  )

  const lon = lon0 + (
    D
    - (1 + 2 * tan2Phi1 + C1) * D3 / 6
    + (5 - 2 * C1 + 28 * tan2Phi1 - 3 * C1 * C1 + 8 * ep2 + 24 * tan2Phi1 * tan2Phi1) * D5 / 120
  ) / cosPhi1

  return { lat: phi, lon }
}

// ─── Forward Transverse Mercator ───────────────────────────────────────────────

export function tmForward(
  lat: number,
  lon: number,
  ell: EllipsoidParams,
  lon0: number,
  k0: number,
  FE: number,
  FN: number,
): { E: number; N: number } {
  const { a, e2, ep2 } = ell

  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const tanLat = sinLat / cosLat
  const sin2Lat = sinLat * sinLat
  const tan2Lat = tanLat * tanLat

  const dlon = lon - lon0

  const N = a / Math.sqrt(1 - e2 * sin2Lat)
  const T = tan2Lat
  const C = ep2 * cosLat * cosLat
  const A = dlon * cosLat
  const A2 = A * A
  const A3 = A2 * A
  const A4 = A3 * A
  const A5 = A4 * A
  const A6 = A5 * A

  const M = meridionalArc(lat, ell)

  const E = k0 * N * (
    A
    + (1 - T + C) * A3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5 / 120
  ) + FE

  const Nout = k0 * (
    M
    + N * tanLat * (
      A2 / 2
      + (5 - T + 9 * C + 4 * C * C) * A4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6 / 720
    )
  ) + FN

  return { E, N: Nout }
}

// ─── Inverse Transverse Mercator ─────────────────────────────────────────────

export function tmInverse(
  E: number,
  N: number,
  ell: EllipsoidParams,
  lon0: number,
  k0: number,
  FE: number,
  FN: number,
): { lat: number; lon: number } {
  const { a, e2, ep2 } = ell
  const oneMinusE2 = 1 - e2

  const E1 = E - FE
  const N1 = N - FN

  const M1 = N1 / k0
  const mu1 = footpointLatitude(M1, ell)

  const sinMu1 = Math.sin(mu1)
  const cosMu1 = Math.cos(mu1)
  const tanMu1 = sinMu1 / cosMu1
  const sin2Mu1 = sinMu1 * sinMu1
  const tan2Mu1 = tanMu1 * tanMu1

  const C1 = ep2 * cosMu1 * cosMu1
  const R1 = a * oneMinusE2 / Math.pow(1 - e2 * sin2Mu1, 1.5)
  const N1r = a / Math.sqrt(1 - e2 * sin2Mu1)
  const T1 = tan2Mu1

  const D = E1 / (N1r * k0)
  const D2 = D * D
  const D3 = D2 * D
  const D4 = D3 * D
  const D5 = D4 * D
  const D6 = D5 * D

  const lat = mu1 - (N1r * tanMu1 / R1) * (
    D2 / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1
       - 252 * ep2 - 3 * C1 * C1) * D6 / 720
  )

  const cosLat = Math.cos(lat)
  const lon = lon0 + (
    D
    - (1 + 2 * T1 + C1) * D3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D5 / 120
  ) / cosLat

  return { lat, lon }
}

// ─── Forward Cassini-Soldner ────────────────────────────────────────────────

export function cassiniForward(
  lat: number,
  lon: number,
  ell: EllipsoidParams,
  lon0: number = 37 * Math.PI / 180,
): { E_m: number; N_m: number } {
  const { a, e2, ep2 } = ell
  const oneMinusE2 = 1 - e2

  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const tanLat = sinLat / cosLat
  const sin2Lat = sinLat * sinLat
  const tan2Lat = tanLat * tanLat

  const dlon = lon - lon0

  const N1 = a / Math.sqrt(1 - e2 * sin2Lat)
  const T1 = tan2Lat
  const C1 = ep2 * cosLat * cosLat
  const R1 = a * oneMinusE2 / Math.pow(1 - e2 * sin2Lat, 1.5)

  const A = cosLat * dlon
  const A2 = A * A
  const A3 = A2 * A
  const A4 = A3 * A
  const A5 = A4 * A

  const M = meridionalArc(lat, ell)

  const E_m = N1 * (
    A
    - (1 - T1 + C1) * A3 / 6
    + (5 - 18 * T1 + T1 * T1 + 72 * C1 - 58 * ep2) * A5 / 120
  )

  const N_m = M + N1 * tanLat * (A2 / 2 + (5 - T1 + 9 * C1 + 4 * C1 * C1) * A4 / 24)

  return { E_m, N_m }
}
