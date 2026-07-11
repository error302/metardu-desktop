/**
 * Cassini ↔ UTM — Exact Projection Chain
 *
 * Full mathematical projection chain as an ALTERNATIVE to the empirical Helmert
 * 4-parameter transformation.
 *
 * Chain:  Cassini (E,N) feet on Clarke 1858
 *         → feet→metres
 *         → Inverse Cassini-Soldner → (φ, λ) on Clarke 1858
 *         → [optional datum shift] → (φ, λ) on Clarke 1880
 *         → Forward Transverse Mercator → UTM (E, N) on Clarke 1880
 *
 * [!] Without a datum shift, this differs from Helmert by 100–300m.
 * cassiniFeetToUTMExactWithDatum() adds a Molodensky 3-param shift to fix this.
 */

import { FT_TO_M } from './constants'
import type { CassiniFeetPoint, UTMPoint, ConversionResult, BursaWolfParams } from './types'
import { applyConformalCorrection } from './helmert'
import {
  molodenskyTransform,
  bursaWolfTransform,
  getMolodenskyParams,
  KENYA_BURSA_WOLF,
  CLARKE_1858_ELL,
  CLARKE_1880_ELL,
} from './datum'
import { cassiniInverse, cassiniForward, tmForward, tmInverse } from './projection'
import { utmToWGS84, toDMS } from './verify'

export function cassiniFeetToUTMExact(
  points: CassiniFeetPoint[],
  options?: { zone?: number; centralMeridianDeg?: number; cassiniMeridianDeg?: number },
): ConversionResult[] {
  const zone = options?.zone ?? 37
  const utmLon0 = ((options?.centralMeridianDeg ?? (6 * zone - 183)) * Math.PI) / 180
  const cassiniLon0 = ((options?.cassiniMeridianDeg ?? 37) * Math.PI) / 180
  const k0 = 0.9996
  const FE = 500_000
  const FN = 10_000_000

  return points.map((pt) => {
    try {
      const cassE_ft = pt.easting
      const cassN_ft = pt.northing

      const E_m = cassE_ft * FT_TO_M
      const N_m = cassN_ft * FT_TO_M

      const geo = cassiniInverse(E_m, N_m, CLARKE_1858_ELL, cassiniLon0)
      const utm = tmForward(geo.lat, geo.lon, CLARKE_1880_ELL, utmLon0, k0, FE, FN)

      const latDeg = (geo.lat * 180) / Math.PI
      const lonDeg = (geo.lon * 180) / Math.PI

      return {
        id: pt.id,
        cassiniE: Math.round(cassE_ft * 10) / 10,
        cassiniN: Math.round(cassN_ft * 10) / 10,
        conformalE: applyConformalCorrection(cassE_ft),
        utmE: Math.round(utm.E * 1000) / 1000,
        utmN: Math.round(utm.N * 1000) / 1000,
        warning: 'Exact projection chain — no datum shift (Clarke 1858→1880 same-φλ assumption). '
          + `Geodetic: ${latDeg.toFixed(6)}°, ${lonDeg.toFixed(6)}°`,
      }
    } catch (err) {
      return {
        id: pt.id,
        cassiniE: pt.easting,
        cassiniN: pt.northing,
        conformalE: applyConformalCorrection(pt.easting),
        utmE: 0,
        utmN: 0,
        warning: `Exact projection failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })
}

export function cassiniFeetToUTMExactWithDatum(
  points: CassiniFeetPoint[],
  options?: {
    zone?: number
    centralMeridianDeg?: number
    cassiniMeridianDeg?: number
    molodenskyParams?: { dX: number; dY: number; dZ: number }
  },
): ConversionResult[] {
  const zone = options?.zone ?? 37
  const utmLon0 = ((options?.centralMeridianDeg ?? (6 * zone - 183)) * Math.PI) / 180
  const cassiniLon0 = ((options?.cassiniMeridianDeg ?? 37) * Math.PI) / 180
  const k0 = 0.9996
  const FE = 500_000
  const FN = 10_000_000

  const mold = options?.molodenskyParams ?? getMolodenskyParams()

  return points.map((pt) => {
    try {
      const cassE_ft = pt.easting
      const cassN_ft = pt.northing

      const E_m = cassE_ft * FT_TO_M
      const N_m = cassN_ft * FT_TO_M

      const geo1858 = cassiniInverse(E_m, N_m, CLARKE_1858_ELL, cassiniLon0)
      const geo1880 = molodenskyTransform(
        geo1858.lat, geo1858.lon, 0,
        mold.dX, mold.dY, mold.dZ,
      )
      const utm = tmForward(geo1880.lat, geo1880.lon, CLARKE_1880_ELL, utmLon0, k0, FE, FN)

      const latDeg1858 = (geo1858.lat * 180) / Math.PI
      const lonDeg1858 = (geo1858.lon * 180) / Math.PI
      const latDeg1880 = (geo1880.lat * 180) / Math.PI
      const lonDeg1880 = (geo1880.lon * 180) / Math.PI

      return {
        id: pt.id,
        cassiniE: Math.round(cassE_ft * 10) / 10,
        cassiniN: Math.round(cassN_ft * 10) / 10,
        conformalE: applyConformalCorrection(cassE_ft),
        utmE: Math.round(utm.E * 1000) / 1000,
        utmN: Math.round(utm.N * 1000) / 1000,
        warning: `Exact chain + Molodensky (dX=${mold.dX.toFixed(2)}, dY=${mold.dY.toFixed(2)}, dZ=${mold.dZ.toFixed(2)}). `
          + `C1858: ${latDeg1858.toFixed(6)}°, ${lonDeg1858.toFixed(6)}° → C1880: ${latDeg1880.toFixed(6)}°, ${lonDeg1880.toFixed(6)}°`,
      }
    } catch (err) {
      return {
        id: pt.id,
        cassiniE: pt.easting,
        cassiniN: pt.northing,
        conformalE: applyConformalCorrection(pt.easting),
        utmE: 0,
        utmN: 0,
        warning: `Exact+Molodensky failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })
}

export function cassiniFeetToUTMExact7Param(
  points: CassiniFeetPoint[],
  options?: {
    zone?: number
    centralMeridianDeg?: number
    cassiniMeridianDeg?: number
    bursaWolfParams?: BursaWolfParams
  },
): ConversionResult[] {
  const zone = options?.zone ?? 37
  const utmLon0 = ((options?.centralMeridianDeg ?? (6 * zone - 183)) * Math.PI) / 180
  const cassiniLon0 = ((options?.cassiniMeridianDeg ?? 37) * Math.PI) / 180
  const k0 = 0.9996
  const FE = 500_000
  const FN = 10_000_000

  const bw = options?.bursaWolfParams ?? KENYA_BURSA_WOLF

  return points.map((pt) => {
    try {
      const cassE_ft = pt.easting
      const cassN_ft = pt.northing

      const E_m = cassE_ft * FT_TO_M
      const N_m = cassN_ft * FT_TO_M

      const geo1858 = cassiniInverse(E_m, N_m, CLARKE_1858_ELL, cassiniLon0)
      const geo1880 = bursaWolfTransform(
        geo1858.lat, geo1858.lon, 0,
        bw, CLARKE_1858_ELL, CLARKE_1880_ELL,
      )
      const utm = tmForward(geo1880.lat, geo1880.lon, CLARKE_1880_ELL, utmLon0, k0, FE, FN)

      const latDeg1858 = (geo1858.lat * 180) / Math.PI
      const lonDeg1858 = (geo1858.lon * 180) / Math.PI
      const latDeg1880 = (geo1880.lat * 180) / Math.PI
      const lonDeg1880 = (geo1880.lon * 180) / Math.PI

      return {
        id: pt.id,
        cassiniE: Math.round(cassE_ft * 10) / 10,
        cassiniN: Math.round(cassN_ft * 10) / 10,
        conformalE: applyConformalCorrection(cassE_ft),
        utmE: Math.round(utm.E * 1000) / 1000,
        utmN: Math.round(utm.N * 1000) / 1000,
        warning: `Exact chain + Bursa-Wolf 7-param (dX=${bw.dX}, dY=${bw.dY}, dZ=${bw.dZ}, rx=${bw.rx}, ry=${bw.ry}, rz=${bw.rz}, ds=${bw.ds}). `
          + `C1858: ${latDeg1858.toFixed(6)}°, ${lonDeg1858.toFixed(6)}° → C1880: ${latDeg1880.toFixed(6)}°, ${lonDeg1880.toFixed(6)}°`,
      }
    } catch (err) {
      return {
        id: pt.id,
        cassiniE: pt.easting,
        cassiniN: pt.northing,
        conformalE: applyConformalCorrection(pt.easting),
        utmE: 0,
        utmN: 0,
        warning: `Exact+Bursa-Wolf failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })
}

export function utmToCassiniFeetExact(
  utmPoints: UTMPoint[],
  options?: { zone?: number; centralMeridianDeg?: number; cassiniMeridianDeg?: number },
): ConversionResult[] {
  const zone = options?.zone ?? 37
  const utmLon0 = ((options?.centralMeridianDeg ?? (6 * zone - 183)) * Math.PI) / 180
  const cassiniLon0 = ((options?.cassiniMeridianDeg ?? 37) * Math.PI) / 180
  const k0 = 0.9996
  const FE = 500_000
  const FN = 10_000_000

  return utmPoints.map((pt) => {
    try {
      const utmE = pt.easting
      const utmN = pt.northing

      const geo = tmInverse(utmE, utmN, CLARKE_1880_ELL, utmLon0, k0, FE, FN)
      const cass = cassiniForward(geo.lat, geo.lon, CLARKE_1858_ELL, cassiniLon0)

      const cassE_ft = cass.E_m / FT_TO_M
      const cassN_ft = cass.N_m / FT_TO_M

      return {
        id: pt.id,
        cassiniE: Math.round(cassE_ft * 10) / 10,
        cassiniN: Math.round(cassN_ft * 10) / 10,
        conformalE: applyConformalCorrection(cassE_ft),
        utmE: Math.round(utmE * 1000) / 1000,
        utmN: Math.round(utmN * 1000) / 1000,
        warning: 'Exact inverse projection chain — no datum shift applied.',
      }
    } catch (err) {
      return {
        id: pt.id,
        cassiniE: 0,
        cassiniN: 0,
        conformalE: 0,
        utmE: pt.easting,
        utmN: pt.northing,
        warning: `Exact inverse projection failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })
}

export function cassiniFeetToWGS84Exact(
  points: CassiniFeetPoint[],
  options?: { zone?: number; centralMeridianDeg?: number; cassiniMeridianDeg?: number },
): Array<{
  id?: string; cassiniE: number; cassiniN: number; utmE: number; utmN: number
  lat: number; lon: number; latDMS: string; lonDMS: string; warning?: string
}> {
  const zone = options?.zone ?? 37
  const utmResults = cassiniFeetToUTMExactWithDatum(points, options)
  return utmResults.map((r) => {
    const wgs84 = utmToWGS84(r.utmE, r.utmN, zone)
    return {
      id: r.id, cassiniE: r.cassiniE, cassiniN: r.cassiniN,
      utmE: r.utmE, utmN: r.utmN,
      lat: wgs84.lat, lon: wgs84.lon,
      latDMS: toDMS(wgs84.lat, true), lonDMS: toDMS(wgs84.lon, false),
      warning: r.warning,
    }
  })
}
