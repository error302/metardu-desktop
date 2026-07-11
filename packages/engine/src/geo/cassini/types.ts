/** Cassini ↔ UTM — Type Definitions */

export interface CassiniFeetPoint {
  id?: string
  easting: number
  northing: number
}

export interface UTMPoint {
  id?: string
  easting: number
  northing: number
}

export interface TopoSheetParams {
  id: string
  name: string
  description: string
  P: number
  Q: number
  Cx: number
  Cy: number
  A?: number
  B?: number
  commonPoints: CommonPoint[]
}

export interface CommonPoint {
  station: string
  cassN: number
  cassE: number
  utmN: number
  utmE: number
}

export interface ConversionResult {
  id?: string
  cassiniE: number
  cassiniN: number
  conformalE: number
  utmE: number
  utmN: number
  warning?: string
}

export interface VerificationResult {
  station: string
  expectedE: number
  computedE: number
  residualE: number
  expectedN: number
  computedN: number
  residualN: number
}

export interface BursaWolfParams {
  dX: number; dY: number; dZ: number
  rx: number; ry: number; rz: number
  ds: number
}

export interface MolodenskyParams {
  dX: number; dY: number; dZ: number
  residuals: Array<{ station: string; dE: number; dN: number }>
  rmse: number
}

export type TransformMethod = 'helmert4' | 'affine6' | 'poly12' | 'exactDatum7'

export interface Affine6Params {
  id: string; name: string; method: 'affine6'
  a: number; b: number; c: number
  d: number; e: number; f: number
  commonPoints: CommonPoint[]
}

export interface Poly12Params {
  id: string; name: string; method: 'poly12'
  a: number; b: number; c: number; l: number; m: number; n: number
  d: number; e: number; f: number; p: number; q: number; r: number
  commonPoints: CommonPoint[]
}

export interface CornerPoint {
  cassX: number; cassY: number
  utmE: number; utmN: number
}

export interface SubSheetDef {
  sheetId: string
  subId: string
  fullId: string
  corners: CornerPoint[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  helmertParams: TopoSheetParams
  affineParams: Affine6Params
}
