/**
 * Cassini ↔ UTM — Module Index
 *
 * Re-exports everything from the cassini/ subdirectory so consumers can do:
 *   import { cassiniFeetToUTM, KENYA_TOPO_SHEETS } from '@/lib/geo/cassini'
 */

export {
  proj4, WGS84_DEF, ARC1960_UTM37S_DEF, ARC1960_UTM36S_DEF,
  CLARKE_1858_A_FT, CLARKE_1858_B_FT, CLARKE_1858_F,
  CLARKE_1880_A_M, CLARKE_1880_B_M, CLARKE_1880_F,
  FT_TO_M, DEG_TO_RAD, RAD_TO_DEG, CLARKE_1858_A_M, CLARKE_1858_B_M,
} from './constants'

export type {
  CassiniFeetPoint, UTMPoint, TopoSheetParams, CommonPoint,
  ConversionResult, VerificationResult, BursaWolfParams, MolodenskyParams,
  TransformMethod, Affine6Params, Poly12Params, CornerPoint, SubSheetDef,
} from './types'

export {
  applyConformalCorrection, computeABCoefficients, computeHelmert4Params,
  cassiniFeetToUTM, utmToCassiniFeet,
} from './helmert'

export {
  cassiniFeetToUTMExact, cassiniFeetToUTMExactWithDatum, cassiniFeetToUTMExact7Param,
  utmToCassiniFeetExact, cassiniFeetToWGS84Exact,
} from './exact'

export {
  molodenskyTransform, bursaWolfTransform, deriveMolodenskyParams, getMolodenskyParams,
  KENYA_BURSA_WOLF, CLARKE1858_TO_CLARKE1880_BURSA, CLARKE_1858_ELL, CLARKE_1880_ELL,
} from './datum'
export type { EllipsoidParams } from './datum'

export {
  COMMON_POINTS_148_1, COMMON_POINTS_148_2, COMMON_POINTS_148_2_1,
  COMMON_POINTS_148_3, COMMON_POINTS_148_4, COMMON_POINTS_148_4_1,
  KENYA_TOPO_SHEETS, findTopoSheet,
} from './sheets'

export {
  verifyWithCommonPoints, utmToWGS84, toDMS, estimateSheetAccuracy,
} from './verify'

export {
  computeAffine6Params, computePoly12Params, KENYA_SUB_SHEETS, SHEETS_WITH_SUBSHEETS,
  getUtmZone, getSubSheetGrid, findSubSheet,
  convertCassiniToUTM, convertUTMToCassini,
  estimateSubSheetAccuracy, verifyAffine6Params, verifyPoly12Params,
} from './subsheets'
