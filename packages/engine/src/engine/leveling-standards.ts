/**
 * Country-aware leveling standards — closures, C-factor, two-peg test.
 *
 * Reference:
 *   USACE EM 1110-1-1005 Table 4-2 (leveling closure)
 *   USACE EM 1110-1-1005 §3-4 (C-factor tables)
 *   USACE EM 1110-1-1005 §3-6 (two-peg test — 30" threshold)
 *   Kenya Survey Reg 63 (direct/indirect leveling tolerances)
 *   Bahrain CSD (field round tolerances)
 */

import type { SurveyingCountry } from '@/lib/country/standards'
import { getCountryStandard } from '@/lib/country/standards'
import { twoPegTest } from './twoPegTest'

// ─── LEVELING CLOSURE ORDERS (USACE Table 4-2) ────────────────────────────────

export interface LevelingOrder {
  order: string
  closureFormula: string   // e.g. "0.013·√M ft" or "3·√K mm/km"
  closureMetres: number    // per km (mm√km expressed in metres)
  closureFeet: number      // per mile
  description: string
  regulation: string
}

export const LEVELING_ORDERS: LevelingOrder[] = [
  {
    order: 'first_order',
    closureFormula: '0.013·√M ft  |  3·√K mm/km',
    closureMetres: 0.003,  // 3mm/√km
    closureFeet: 0.017,    // 0.013ft/√mile
    description: 'First Order — benchmarks, reference frames',
    regulation: 'USACE EM 1110-1-1005 Table 4-2 / FGCC 1984',
  },
  {
    order: 'second_order_class_i',
    closureFormula: '0.017·√M ft  |  6·√K mm/km',
    closureMetres: 0.006,  // 6mm/√km
    closureFeet: 0.025,
    description: 'Second Order Class I — major engineering, datum control',
    regulation: 'USACE EM 1110-1-1005 Table 4-2',
  },
  {
    order: 'second_order_class_ii',
    closureFormula: '0.035·√M ft  |  8·√K mm/km',
    closureMetres: 0.008,  // 8mm/√km
    closureFeet: 0.035,
    description: 'Second Order Class II — secondary control, engineering',
    regulation: 'USACE EM 1110-1-1005 Table 4-2',
  },
  {
    order: 'third_order',
    closureFormula: '0.050·√M ft  |  10·√K mm/km',
    closureMetres: 0.010,  // Kenya RDM 1.1 Table 5.1: 10mm/√km
    closureFeet: 0.050,
    description: 'Third Order — detail surveys, construction setting-out',
    regulation: 'Kenya RDM 1.1 Table 5.1 / USACE EM 1110-1-1005',
  },
  {
    order: 'fourth_order',
    closureFormula: '0.067·√M ft  |  24·√K mm/km',
    closureMetres: 0.024,  // 24mm/√km
    closureFeet: 0.067,
    description: 'Fourth Order / Construction — rough grading, layout',
    regulation: 'USACE EM 1110-1-1005 Table 4-2',
  },
]

// ─── C-FACTOR LIMITS (USACE §3-4) ─────────────────────────────────────────────
// C = max error / distance  (K = 1/contour_interval)
// K=1/100 → C ≤ 0.004   |   K=1/200 → C ≤ 0.007   |   K=1/333 → C ≤ 0.010

export interface CFactorEntry {
  kValue: number          // 1/contour_interval
  contourInterval: number  // same units as distance
  maxCFactor: number
  description: string
  regulation: string
}

export const C_FACTOR_TABLE: CFactorEntry[] = [
  {
    kValue: 1/100,
    contourInterval: 100,
    maxCFactor: 0.004,
    description: 'K=1/100 — smooth, bare terrain, clear sight',
    regulation: 'USACE EM 1110-1-1005 §3-4 Table',
  },
  {
    kValue: 1/200,
    contourInterval: 200,
    maxCFactor: 0.007,
    description: 'K=1/200 — average terrain, moderate cover',
    regulation: 'USACE EM 1110-1-1005 §3-4 Table',
  },
  {
    kValue: 1/333,
    contourInterval: 333,
    maxCFactor: 0.010,
    description: 'K=1/333 — rough terrain, dense vegetation, steep slopes',
    regulation: 'USACE EM 1110-1-1005 §3-4 Table',
  },
]

// ─── LEVELING CLOSURE VALIDATION ─────────────────────────────────────────────

export interface LevelingClosureInput {
  misclosureMetres: number
  distanceKm: number
  country: SurveyingCountry
  environment?: 'first_order' | 'second_order_i' | 'second_order_ii' | 'third_order' | 'fourth_order' | 'default'
}

export interface LevelingClosureResult {
  isAcceptable: boolean
  allowableMisclosure: number  // metres
  achievedMisclosure: number   // metres
  closureRatio: number         // distance / misclosure
  achievedOrder: string
  requiredOrder: string
  warnings: string[]
  regulation: string
}

export function validateLevelingClosure(input: LevelingClosureInput): LevelingClosureResult {
  const { misclosureMetres, distanceKm, country, environment = 'third_order' } = input

  const std = getCountryStandard(country)
  const warnings: string[] = []

  let requiredOrder = environment
  let allowable = getAllowableMisclosure(distanceKm, environment)
  let requiredOrderObj = LEVELING_ORDERS.find((o: any) => o.order === requiredOrder)

  if (country === 'kenya') {
    // Source: RDM 1.1 Kenya 2025, Table 5.1 — Direct differential leveling: 10√K mm
    // Kenya Survey Regulation 63 uses different terminology:
    //   Direct: 20mm/√K (≈ indirect in older standards)
    //   Indirect: 30mm/√K
    // For RDM 1.1 compliant Kenya surveys: use 10√K mm (direct, most stringent)
    const directTolerance = 0.020 * Math.sqrt(distanceKm)
    const indirectTolerance = 0.030 * Math.sqrt(distanceKm)
    const rdm1_1Tolerance = 0.010 * Math.sqrt(distanceKm)  // RDM 1.1 Table 5.1: 10√K mm
    allowable = rdm1_1Tolerance  // Kenya RDM 1.1 surveys must use 10√K
    requiredOrderObj = LEVELING_ORDERS.find((o: any) => o.order === 'third_order')
    if (misclosureMetres > directTolerance && misclosureMetres <= indirectTolerance) {
      warnings.push('Kenya Reg 63: Misclosure within indirect leveling tolerance (30mm/√K). For RDM 1.1 compliance use 10√K mm (direct).')
    }
    if (misclosureMetres > rdm1_1Tolerance && misclosureMetres <= directTolerance) {
      warnings.push('RDM 1.1 Kenya: Misclosure exceeds 10√K mm but within 20√K mm. Consider repeat observation.')
    }
  }

  if (country === 'bahrain') {
    const bahrainT2 = 30 / 3600 * (Math.PI / 180)
    const bahrainT16 = 60 / 3600 * (Math.PI / 180)
    warnings.push(`Bahrain CSD: T2 total station field round < ${(bahrainT2 * 1000).toFixed(1)}mm per setup; T16 < ${(bahrainT16 * 1000).toFixed(1)}mm.`)
  }

  const isAcceptable = Math.abs(misclosureMetres) <= allowable
  const achievedRatio = Math.abs(misclosureMetres) > 0 ? distanceKm / Math.abs(misclosureMetres) : Infinity

  const achievedOrder = deriveLevelingOrder(Math.abs(misclosureMetres), distanceKm)

  return {
    isAcceptable,
    allowableMisclosure: allowable,
    achievedMisclosure: Math.abs(misclosureMetres),
    closureRatio: achievedRatio,
    achievedOrder,
    requiredOrder: requiredOrderObj?.description ?? requiredOrder,
    warnings,
    regulation: requiredOrderObj?.regulation ?? std.name,
  }
}

function getAllowableMisclosure(km: number, order: string): number {
  const entry = LEVELING_ORDERS.find((o: any) => o.order === order)
  return entry ? entry.closureMetres * Math.sqrt(km) : 0.010 * Math.sqrt(km) // Kenya RDM 1.1 default
}

function deriveLevelingOrder(misclosureMetres: number, km: number): string {
  for (const order of LEVELING_ORDERS) {
    const allowable = order.closureMetres * Math.sqrt(km)
    if (misclosureMetres <= allowable) return order.description
  }
  return 'Below 4th Order'
}

// ─── C-FACTOR VALIDATION ──────────────────────────────────────────────────────

export interface CFactorInput {
  maxError: number       // contour interval from DTM
  horizontalDistance: number  // metres
  contourInterval?: number   // override (metres)
}

export interface CFactorResult {
  kValue: number
  contourInterval: number
  cFactor: number
  maxCFactor: number
  isAcceptable: boolean
  surplusPercent: number
  warnings: string[]
  regulation: string
}

export function validateCFactor(input: CFactorInput): CFactorResult {
  const { maxError, horizontalDistance, contourInterval } = input
  // contourInterval is the denominator of K (e.g. 100 for K=1/100).
  // Default to 100 (smooth terrain) when not specified.
  const ci = contourInterval ?? 100
  const k = 1 / ci

  const entry = C_FACTOR_TABLE.find((e: any) => Math.abs(e.kValue - k) < 0.001)
    ?? C_FACTOR_TABLE[C_FACTOR_TABLE.length - 1]

  const cFactor = maxError / horizontalDistance
  const surplus = entry.maxCFactor > 0
    ? ((entry.maxCFactor - cFactor) / entry.maxCFactor) * 100
    : 0

  const warnings: string[] = []
  if (cFactor > entry.maxCFactor) {
    warnings.push(
      `C-factor ${cFactor.toFixed(4)} exceeds ${entry.maxCFactor} (K=${k.toFixed(3)}). ` +
      `Reduce contour interval or improve data collection accuracy.`
    )
  }

  return {
    kValue: k,
    contourInterval: ci,
    cFactor,
    maxCFactor: entry.maxCFactor,
    isAcceptable: cFactor <= entry.maxCFactor,
    surplusPercent: surplus,
    warnings,
    regulation: entry.regulation,
  }
}

// ─── TWO-PEG TEST (country-aware) ─────────────────────────────────────────────

export interface LevelingTwoPegResult {
  collimationError: number       // radians
  collimationPer100m: number      // mm per 100m
  allowablePer100m: number         // mm per 100m
  isAcceptable: boolean
  warnings: string[]
  regulation: string
  daysUntilNextTest: number
}

export interface TwoPegTestInput {
  A1: number   // staff reading at peg A, setup 1 (m)
  B1: number   // staff reading at peg B, setup 1 (m)
  A2: number   // staff reading at peg A, setup 2 (m)
  B2: number   // staff reading at peg B, setup 2 (m)
  baselineMeters?: number
  allowableSeconds?: number       // override (arc seconds)
  country: SurveyingCountry
  daysSinceLastTest?: number
}

export function runTwoPegTest(input: TwoPegTestInput): LevelingTwoPegResult {
  const {
    A1, B1, A2, B2,
    baselineMeters = 100,
    allowableSeconds = 30,        // USACE default: 30 arc-seconds
    country,
    daysSinceLastTest = 0,
  } = input

  const result = twoPegTest({ A1, B1, A2, B2, baselineMeters })

  const allowablePer100m = allowableSeconds * Math.PI / (180 * 3600) * 100  // arc-sec → radians → m → mm
  const isAcceptable = Math.abs(result.collimationPer100m) <= allowablePer100m

  const warnings: string[] = []
  if (!isAcceptable) {
    warnings.push(
      `Collimation error ${(result.collimationPer100m * 1000).toFixed(2)}mm/100m ` +
      `exceeds ${allowableSeconds}" (${(allowablePer100m * 1000).toFixed(2)}mm/100m threshold). ` +
      `Instrument requires adjustment before further use.`
    )
  }

  if (daysSinceLastTest > 90) {
    warnings.push(`Two-peg test is overdue. Last test was ${daysSinceLastTest} days ago. USACE EM 1110-1-1005 §3-6: repeat every 90 days.`)
  }

  return {
    collimationError: result.collimationError,
    collimationPer100m: result.collimationPer100m,
    allowablePer100m,
    isAcceptable,
    warnings,
    regulation: 'USACE EM 1110-1-1005 §3-6',
    daysUntilNextTest: Math.max(0, 90 - daysSinceLastTest),
  }
}

// ─── COUNTRY DEFAULT LEVELING ORDER ──────────────────────────────────────────

export function getLevelingOrderForCountry(
  country: SurveyingCountry,
  environment?: string
): LevelingOrder {
  if (country === 'us') {
    const envMap: Record<string, string> = {
      first_order: 'first_order',
      second_order_i: 'second_order_class_i',
      second_order_ii: 'second_order_class_ii',
      third_order: 'third_order',
      fourth_order: 'fourth_order',
      construction: 'fourth_order',
      default: 'third_order',
    }
    const orderId = envMap[environment ?? 'default'] ?? 'third_order'
    return LEVELING_ORDERS.find((o: any) => o.order === orderId) ?? LEVELING_ORDERS[2]
  }
  if (country === 'kenya') return LEVELING_ORDERS.find((o: any) => o.order === 'third_order') ?? LEVELING_ORDERS[2]
  if (country === 'uk') return LEVELING_ORDERS.find((o: any) => o.order === 'third_order') ?? LEVELING_ORDERS[2]
  if (country === 'australia') return LEVELING_ORDERS.find((o: any) => o.order === 'third_order') ?? LEVELING_ORDERS[2]
  return LEVELING_ORDERS.find((o: any) => o.order === 'third_order') ?? LEVELING_ORDERS[2]
}
