/**
 * Cassini ↔ UTM — Verification & WGS84 Output
 */

import { proj4, WGS84_DEF, ARC1960_UTM37S_DEF, ARC1960_UTM36S_DEF } from './constants'
import type { TopoSheetParams, VerificationResult } from './types'
import { cassiniFeetToUTM } from './helmert'

export function verifyWithCommonPoints(params: TopoSheetParams): VerificationResult[] {
  return params.commonPoints.map((cp) => {
    const points = cassiniFeetToUTM(
      [{ id: cp.station, easting: cp.cassE, northing: cp.cassN }],
      params,
    )
    const computed = points[0]
    return {
      station: cp.station,
      expectedE: cp.utmE,
      computedE: computed.utmE,
      residualE: Math.round((computed.utmE - cp.utmE) * 1000) / 1000,
      expectedN: cp.utmN,
      computedN: computed.utmN,
      residualN: Math.round((computed.utmN - cp.utmN) * 1000) / 1000,
    }
  })
}

export function utmToWGS84(utmE: number, utmN: number, zone: number = 37): { lat: number; lon: number } {
  const utmDef = zone === 36 ? ARC1960_UTM36S_DEF : ARC1960_UTM37S_DEF
  const [lon, lat] = proj4(utmDef, WGS84_DEF, [utmE, utmN])
  return { lat, lon }
}

export function toDMS(decimal: number, isLat: boolean): string {
  const abs = Math.abs(decimal)
  const deg = Math.floor(abs)
  const minFloat = (abs - deg) * 60
  const min = Math.floor(minFloat)
  const sec = ((minFloat - min) * 60).toFixed(2)
  const dir = isLat ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W')
  return `${String(deg).padStart(2, '0')}° ${String(min).padStart(2, '0')}' ${sec.padStart(5, ' ')}" ${dir}`
}

export function estimateSheetAccuracy(params: TopoSheetParams): { rmseM: number; rmseMM: number; grade: string } {
  if (params.commonPoints.length < 2) {
    return { rmseM: NaN, rmseMM: NaN, grade: 'UNKNOWN' }
  }
  const verifications = verifyWithCommonPoints(params)
  const ssr = verifications.reduce((s, v) => s + v.residualE ** 2 + v.residualN ** 2, 0)
  const n = verifications.length
  const dof = n > 2 ? n - 1 : n
  const rmseM = Math.sqrt(ssr / (2 * dof))
  const rmseMM = rmseM * 1000
  const grade = rmseMM <= 10 ? 'EXCELLENT' : rmseMM <= 100 ? 'GOOD' : rmseMM <= 1000 ? 'MODERATE' : 'LOW'
  return { rmseM: Math.round(rmseM * 10000) / 10000, rmseMM: Math.round(rmseMM * 10) / 10, grade }
}
