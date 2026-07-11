/**
 * Country-aware survey math — bridges the math engine with national standards.
 *
 * Each function takes a country + optional environment/survey-type and
 * returns the appropriate standard for validation, formatting, or correction.
 *
 * Usage:
 *   import { getTraverseValidation, formatAreaByCountry } from '@/lib/engine/country-math'
 *   const result = getTraverseValidation('kenya', linearError, totalDist, 'urban')
 */

import type { SurveyingCountry, SurveyEnvironment } from '@/lib/country/standards'
import {
  getCountryStandard,
  getTraverseOrderForEnvironment,
  getAreaDecimalPlaces,
  getSlopeRule,
  getBeaconRule,
  getFieldNoteRule,
  getSurveyorReportRequirement,
} from '@/lib/country/standards'
import { getTopoConfigForCountry } from './topographic'

// ─── TRAVERSE VALIDATION ──────────────────────────────────────────────────────

export interface TraverseValidationInput {
  country: SurveyingCountry
  environment: SurveyEnvironment
  linearError: number
  totalDistance: number
}

export interface TraverseValidationOutput {
  isAcceptable: boolean
  achievedRatio: number
  requiredRatio: number
  orderLabel: string
  linearError: number
  totalDistance: number
  surplusPercent: number
  warnings: string[]
  regulation: string
  jurisdiction: string
}

export function getTraverseValidation(input: TraverseValidationInput): TraverseValidationOutput {
  const { country, environment, linearError, totalDistance } = input
  const order = getTraverseOrderForEnvironment(country, environment)

  if (!order) {
    return {
      isAcceptable: false,
      achievedRatio: 0,
      requiredRatio: 0,
      orderLabel: 'Unknown',
      linearError,
      totalDistance,
      surplusPercent: 0,
      warnings: [`No traverse order defined for ${country} / ${environment}`],
      regulation: '',
      jurisdiction: country,
    }
  }

  const achievedRatio = linearError > 0 ? totalDistance / linearError : Infinity
  let requiredRatio = order.minPrecision
  const warnings: string[] = []

  // Bahrain: traverse closure = min(0.0015/Lm, 1:20000)
  // Lm = totalDistance in km. Convert: 0.0015/Lm = 0.0015/(D/1000) = 1.5/D
  // requiredRatio = min(1.5/D, 20000)
  // At which D does 1.5/D = 20000?  D = 1.5/20000 = 0.000075km = 0.075m  (always use 20000)
  // Actually the formula is: required linear error ≤ 0.0015 * Lm (Lm in km, result in metres)
  // or equivalently: requiredRatio ≥ max(D/0.0015, 20000)  [D in metres, so D/(0.0015*1000)]
  // Required Ratio = max(totalDistance / (0.0015 * 1000), 20000) = max(totalDistance / 1.5, 20000)
  if (country === 'bahrain' && environment === 'detail') {
    requiredRatio = 5_000  // Bahrain CSD detail survey: 1:5,000
  } else if (country === 'bahrain' && (environment === 'default' || environment === 'urban')) {
    const byFormula = totalDistance / 1.5  // D/0.0015 where D is in metres
    requiredRatio = Math.max(byFormula, 20_000)
    const maxLinearError = totalDistance / 20000  // error at 1:20000
    const formulaError = 0.0015 * (totalDistance / 1000)  // error at 0.0015/Lm
    if (achievedRatio >= requiredRatio) {
      warnings.push(
        `Bahrain CSD §F: Closure ${linearError.toFixed(4)}m across ${totalDistance.toFixed(0)}m — passes min(0.0015/Lm, 1:20,000). ` +
        `Max at 1:20,000: ${maxLinearError.toFixed(4)}m. Max at 0.0015/Lm: ${formulaError.toFixed(4)}m.`
      )
    }
  }

  if (environment === 'urban' && country === 'kenya' && achievedRatio < 20_000) {
    warnings.push(
      `Kenya Reg 60 (3rd order urban): Built-up traverses require 1:20,000 precision. Achieved 1:${Math.round(achievedRatio).toLocaleString()}.`
    )
  }
  if ((environment === 'rural' || environment === 'default') && country === 'kenya' && achievedRatio < 10_000) {
    warnings.push(
      `Kenya Reg 60 (4th order): Rural traverses require 1:10,000 precision. Achieved 1:${Math.round(achievedRatio).toLocaleString()}.`
    )
  }
  if (environment === 'transmission_line' && country === 'kenya' && achievedRatio < 10_000) {
    warnings.push(
      `KETRACO Annex 6: Transmission line control requires 1:10,000. Achieved 1:${Math.round(achievedRatio).toLocaleString()}.`
    )
  }
  if (linearError === 0 && totalDistance > 0) {
    warnings.push('Perfect closure — verify this is not a zero-length traverse.')
  }

  const surplusPercent = requiredRatio > 0 ? ((achievedRatio - requiredRatio) / requiredRatio) * 100 : 100

  return {
    isAcceptable: achievedRatio >= requiredRatio,
    achievedRatio,
    requiredRatio,
    orderLabel: order.order,
    linearError,
    totalDistance,
    surplusPercent,
    warnings,
    regulation: order.regulation,
    jurisdiction: country,
  }
}

// ─── AREA FORMATTING BY COUNTRY ───────────────────────────────────────────────

export interface AreaFormattingOutput {
  hectares: number
  sqMetres: number
  decimalPlaces: number
  formattedHa: string
  formattedM2: string
  regulation: string
  warnings: string[]
}

export function formatAreaByCountry(country: SurveyingCountry, sqMetres: number): AreaFormattingOutput {
  const ha = sqMetres / 10_000
  const rule = getAreaDecimalPlaces(country, sqMetres)
  const warnings: string[] = []

  const formattedHa = ha.toFixed(rule.decimalPlaces)
  const formattedM2 = sqMetres.toFixed(Math.max(0, rule.decimalPlaces - 4))

  if (sqMetres < 1) {
    warnings.push('Parcel area is extremely small — verify this is not a data entry error.')
  }

  const std = getCountryStandard(country)
  if (std.parcelMinArea && sqMetres < std.parcelMinArea.sqMetres) {
    warnings.push(
      `${std.name}: Parcel (${sqMetres.toFixed(2)} m²) is below minimum ${std.parcelMinArea.sqMetres} m².`
    )
  }

  return {
    hectares: ha,
    sqMetres,
    decimalPlaces: rule.decimalPlaces,
    formattedHa,
    formattedM2,
    regulation: rule.regulation,
    warnings,
  }
}

// ─── SLOPE CORRECTION RULE ───────────────────────────────────────────────────

export interface SlopeRuleOutput {
  maxSlopeSingleFace: number
  requiresTwoFaces: (verticalDegrees: number) => boolean
  tempCorrection: boolean
  pressureCorrection: boolean
  sagCorrection: boolean
  regulation: string
  warnings: (verticalDegrees: number) => string[]
}

export function getSlopeRuleForCountry(country: SurveyingCountry): SlopeRuleOutput {
  const rule = getSlopeRule(country)

  return {
    maxSlopeSingleFace: rule.maxSlopeSingleFace,
    requiresTwoFaces: (deg: number) => Math.abs(deg) > rule.maxSlopeSingleFace,
    tempCorrection: rule.tempCorrection,
    pressureCorrection: rule.pressureCorrection,
    sagCorrection: rule.sagCorrection,
    regulation: rule.regulation,
    warnings: (deg: number) => {
      const w: string[] = []
      if (Math.abs(deg) > rule.maxSlopeSingleFace) {
        w.push(`${rule.regulation}: Slope ${deg.toFixed(1)}° exceeds ${rule.maxSlopeSingleFace}° — both faces required.`)
      }
      if (!rule.tempCorrection) {
        w.push(`${rule.regulation}: Temperature correction not required for this jurisdiction.`)
      }
      return w
    },
  }
}

// ─── BEACON VERIFICATION RULE ────────────────────────────────────────────────

export interface BeaconVerificationOutput {
  method: string
  mustReferenceUnderground: boolean
  regulation: string
}

export function getBeaconRuleForCountry(country: SurveyingCountry): BeaconVerificationOutput {
  const rule = getBeaconRule(country)
  return {
    method: rule.verifyMethod ?? 'traverse',
    mustReferenceUnderground: rule.mustReferenceUnderground,
    regulation: rule.regulation,
  }
}

// ─── FIELD NOTE RULE ──────────────────────────────────────────────────────────

export interface FieldNoteRuleOutput {
  noErasures: boolean
  correctionsMethod: string
  regulation: string
}

export function getFieldNoteRuleForCountry(country: SurveyingCountry): FieldNoteRuleOutput {
  const rule = getFieldNoteRule(country)
  return {
    noErasures: rule.noErasures,
    correctionsMethod: rule.correctionsMethod,
    regulation: rule.regulation,
  }
}

// ─── SURVEYOR REPORT REQUIREMENT ──────────────────────────────────────────────

export interface SurveyorReportRequirementOutput {
  required: boolean
  mustInclude: string[]
  counterSignRequired: boolean
  regulation: string
}

export function getSurveyorReportReqForCountry(
  country: SurveyingCountry
): SurveyorReportRequirementOutput {
  const req = getSurveyorReportRequirement(country)
  return {
    required: req.required,
    mustInclude: req.mustInclude,
    counterSignRequired: req.counterSignRequired,
    regulation: req.regulation,
  }
}

// ─── QUICK SUMMARY ────────────────────────────────────────────────────────────

export interface CountrySurveySummary {
  country: SurveyingCountry
  name: string
  isoCode: string
  datum: string
  ellipsoid: string
  utmZones: number[]
  defaultTraverse: string
  defaultTraverseRatio: number
  slopeCorrection: boolean
  surveyorReport: boolean
  noErasures: boolean
  topographicConfig: {
    contourInterval: number
    defaultScale: string
    rmseClass: 1 | 2 | 3
    requiresDTM: boolean
    regulation: string
  }
}

export function getCountrySurveySummary(country: SurveyingCountry): CountrySurveySummary {
  const std = getCountryStandard(country)
  const traverseOrder = getTraverseOrderForEnvironment(country, 'default')
  const slope = getSlopeRule(country)
  const report = getSurveyorReportRequirement(country)
  const fieldNote = getFieldNoteRule(country)
  const topo = getTopoConfigForCountry(country)

  return {
    country,
    name: std.name,
    isoCode: std.isoCode,
    datum: std.datum,
    ellipsoid: std.ellipsoid,
    utmZones: std.utmZones,
    defaultTraverse: traverseOrder?.description ?? 'Standard',
    defaultTraverseRatio: traverseOrder?.minPrecision ?? 5_000,
    slopeCorrection: slope.required,
    surveyorReport: report.required,
    noErasures: fieldNote.noErasures,
    topographicConfig: {
      contourInterval: topo.defaultContourInterval,
      defaultScale: topo.defaultScale,
      rmseClass: topo.rmseClass,
      requiresDTM: topo.requiresDTM,
      regulation: topo.regulation,
    },
  }
}

export function getTopoConfigForCountryEngine(country: SurveyingCountry) {
  return getTopoConfigForCountry(country)
}
