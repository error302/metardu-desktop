/**
 * Cassini ↔ UTM — Sheet Tables & Common Control Points
 *
 * Common control points for Series 148 sheets and the pre-loaded
 * KENYA_TOPO_SHEETS table (226 sheets).
 */

import { ALL_KENYA_SHEETS } from '../kenya_sheets'
import { computeABCoefficients } from './helmert'
import type { TopoSheetParams, CommonPoint } from './types'

export const COMMON_POINTS_148_1: CommonPoint[] = [
  { station: 'SKP209', cassN: -348685.6, cassE: -130490.6, utmN: 9_893_875.453, utmE: 237_730.756 },
  { station: '149S3',  cassN: -533392.5, cassE: 22_492.0,   utmN: 9_837_592.78,  utmE: 284_419.1 },
  { station: 'SKP208', cassN: -514849.9, cassE: -132_480.9, utmN: 9_843_205.245, utmE: 237_160.304 },
]

export const COMMON_POINTS_148_2: CommonPoint[] = [
  { station: '149S3',  cassN: -533392.5, cassE: 22_492.0,   utmN: 9_837_592.78,  utmE: 284_419.1 },
  { station: 'SKP208', cassN: -514849.9, cassE: -132_480.9, utmN: 9_843_205.245, utmE: 237_160.304 },
  { station: '134S3',  cassN: -350246.1, cassE: -36_272.8,  utmN: 9_893_417.308, utmE: 266_460.401 },
]

export const COMMON_POINTS_148_2_1: CommonPoint[] = [
  { station: 'SKP208', cassN: -514849.9, cassE: -132_480.9, utmN: 9_843_205.245, utmE: 237_160.304 },
  { station: 'SKP216', cassN: -413209.9, cassE: 93_421.4,   utmN: 9_874_247.916, utmE: 306_011.964 },
  { station: 'SKP108', cassN: -227515.2, cassE: -107_093.2, utmN: 9_930_827.74,  utmE: 244_847.96 },
]

export const COMMON_POINTS_148_3: CommonPoint[] = [
  { station: 'SKP208', cassN: -514849.9, cassE: -132_480.9, utmN: 9_843_205.245, utmE: 237_160.304 },
  { station: 'SKP110', cassN: -332053.0, cassE: -202_412.9, utmN: 9_898_935.545, utmE: 215_793.802 },
  { station: 'SKP216', cassN: -413209.9, cassE: 93_421.4,   utmN: 9_874_247.916, utmE: 306_011.964 },
]

export const COMMON_POINTS_148_4 = COMMON_POINTS_148_2

export const COMMON_POINTS_148_4_1: CommonPoint[] = [
  { station: 'SKP209', cassN: -348685.6, cassE: -130_490.6, utmN: 9_893_875.453, utmE: 237_730.756 },
  { station: 'SKP216', cassN: -413209.9, cassE: 93_421.4,   utmN: 9_874_247.916, utmE: 306_011.964 },
  { station: 'SKP39',  cassN: -720628.41, cassE: -93_529.74, utmN: 9_780_469.731, utmE: 249_103.7 },
]

// ponytail: IIFE runs at module load. Phase 3b will convert to lazy `await import()`.
export const KENYA_TOPO_SHEETS: TopoSheetParams[] = (() => {
  const sheets: TopoSheetParams[] = [...ALL_KENYA_SHEETS]

  const xls148Overrides: TopoSheetParams[] = [
    { id: '148/1', name: 'Sheet 148/1', description: 'Kenya topographic sheet 148/1. Common points: SKP209, 149S3, SKP208. XLS-derived.',
      P: 0.3048343321606808, Q: 4.862535115535138e-05, Cx: 277474.6045159159, Cy: 10000198.35386753,
      A: -2.1449579352267323e-10, B: 5.44633158017227e-11, commonPoints: COMMON_POINTS_148_1 },
    { id: '148/2', name: 'Sheet 148/2', description: 'Kenya topographic sheet 148/2. Common points: 149S3, SKP208, 134S3. XLS-derived.',
      P: 0.30483331557479687, Q: 1.0342419045628048e-05, Cx: 277484.8274610074, Cy: 10000196.999482632,
      A: -2.507197995223198e-10, B: 5.163220545556513e-11, commonPoints: COMMON_POINTS_148_2 },
    { id: '148/2.1', name: 'Sheet 148/2.1', description: 'Kenya topographic sheet 148/2.1. Common points: SKP208, SKP216, SKP108. XLS-derived.',
      P: 0.30485564547893773, Q: 1.9017478052774095e-05, Cx: 277483.5511268431, Cy: 10000201.694547474,
      A: -2.364228563356968e-10, B: 2.738988810063736e-11, commonPoints: COMMON_POINTS_148_2_1 },
    { id: '148/3', name: 'Sheet 148/3', description: 'Kenya topographic sheet 148/3. Common points: SKP208, SKP110, SKP216. XLS-derived.',
      P: 0.30487306409668236, Q: 2.264994600409409e-05, Cx: 277482.61733914545, Cy: 10000205.906371474,
      A: -2.3172737079885097e-10, B: 8.818206581606702e-12, commonPoints: COMMON_POINTS_148_3 },
    { id: '148/4', name: 'Sheet 148/4', description: 'Kenya topographic sheet 148/4. Common points: 149S3, SKP208, 134S3 (same as 148/2). XLS-derived.',
      P: 0.30483331557479687, Q: 1.0342419045628048e-05, Cx: 277484.8274610074, Cy: 10000196.999482632,
      A: -2.507197995223198e-10, B: 5.163220545556513e-11, commonPoints: COMMON_POINTS_148_4 },
    { id: '148/4.1', name: 'Sheet 148/4.1', description: 'Kenya topographic sheet 148/4.1. Common points: SKP209, SKP216, SKP39. XLS-derived.',
      P: 0.30488487554066523, Q: 2.193208223388865e-05, Cx: 277482.6158913227, Cy: 10000207.770590663,
      A: -2.350673110481337e-10, B: -8.622103465222297e-12, commonPoints: COMMON_POINTS_148_4_1 },
  ]

  for (const override of xls148Overrides) {
    const idx = sheets.findIndex(s => s.id === override.id)
    if (idx >= 0) sheets[idx] = override
    else sheets.push(override)
  }

  for (const sheet of sheets) {
    if (sheet.A === undefined && sheet.B === undefined && sheet.commonPoints.length >= 3) {
      const ab = computeABCoefficients(sheet)
      if (ab !== null) {
        sheet.A = ab.A
        sheet.B = ab.B
      }
    }
  }

  return sheets
})()

export function findTopoSheet(sheetId: string): TopoSheetParams | undefined {
  return KENYA_TOPO_SHEETS.find((s) => s.id === sheetId)
}
