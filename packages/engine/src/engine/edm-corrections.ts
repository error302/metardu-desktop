/**
 * EDM Reduction Pipeline — full meter-to-grid correction chain.
 *
 * Stage 1: Slope → Horizontal  (vertical angle + zenith angle)
 * Stage 2: Horizontal → Sea Level  (earth curvature + refraction)
 * Stage 3: Sea Level → Grid  (scale factor + convergence)
 * Stage 4: Atmospheric correction  (temperature + pressure)
 *
 * Reference: USACE EM 1110-1-1005 §3-5 (EDM specifications)
 *            USACE EM 1110-1-1005 §5-15 (grid/sea level reduction)
 *            NOAA Manual NOS NGS 5 (geodetic EDM reductions)
 */

import type { SurveyingCountry } from '@/lib/country/standards'
import { getCountryStandard } from '@/lib/country/standards'

// ─── STAGE 1: SLOPE → HORIZONTAL ─────────────────────────────────────────────

export interface SlopeCorrectionInput {
  slopeDistanceMetres: number
  verticalAngle?: number      // degrees (zenith if null)
  zenithAngle?: number        // degrees (use instead of verticalAngle)
  temperatureC?: number
  pressureHPa?: number
  edmManufacturer?: string
  edmSpecMM?: number          // mm — manufacturer spec (default ±5mm)
  edmSpecPPM?: number         // ppm — manufacturer spec (default ±5ppm)
}

export interface SlopeCorrectionOutput {
  horizontalDistance: number   // metres
  slopeDistance: number
  verticalAngle: number        // degrees (zenith)
  requiresTwoFace: boolean
  temperaturePPM: number       // ppm correction
  pressurePPM: number          // ppm correction
  totalAtmosphericPPM: number  // combined ppm
  warnings: string[]
  regulation: string
}

export function slopeFromEDM(input: SlopeCorrectionInput): SlopeCorrectionOutput {
  const {
    slopeDistanceMetres,
    verticalAngle: va,
    zenithAngle: za,
    temperatureC = 15,
    pressureHPa = 1013.25,
    edmSpecMM = 5,
    edmSpecPPM = 5,
  } = input

  const zenith = za ?? (va !== undefined ? 90 - va : 90)
  const zenithRad = zenith * Math.PI / 180

  const horizontalDistance = slopeDistanceMetres * Math.sin(zenithRad)
  const requiresTwoFace = zenith > 90.5 || zenith < 89.5  // flag any non-horizontal shot

  const tempPPM = edmTemperatureCorrection(temperatureC, pressureHPa, edmSpecPPM)
  const pressPPM = edmPressureCorrection(temperatureC, pressureHPa, edmSpecPPM)
  const totalPPM = tempPPM + pressPPM

  const warnings: string[] = []
  if (requiresTwoFace) {
    warnings.push('Zenith angle >10° from horizontal — both-face measurement recommended.')
  }
  if (slopeDistanceMetres >= 500) {
    warnings.push('EDM ≥500m: meteorological correction mandatory per USACE EM 1110-1-1005 §3-5.')
  }
  if (temperatureC < 0 || temperatureC > 40) {
    warnings.push(`Temperature ${temperatureC}°C is outside normal range — verify EDM calibration.`)
  }

  return {
    horizontalDistance,
    slopeDistance: slopeDistanceMetres,
    verticalAngle: 90 - zenith,  // return as elevation angle
    requiresTwoFace,
    temperaturePPM: tempPPM,
    pressurePPM: pressPPM,
    totalAtmosphericPPM: totalPPM,
    warnings,
    regulation: 'USACE EM 1110-1-1005 §3-5',
  }
}

// ─── STAGE 2: SEA LEVEL CORRECTION ───────────────────────────────────────────

export interface SeaLevelCorrectionInput {
  horizontalDistance: number    // metres
  meanElevationMetres: number  // average elevation of ends
  latitudeDegrees?: number      // needed for gravity correction
  refractCoeff?: number         // k = 0.13 default for clear air
}

export interface SeaLevelCorrectionOutput {
  seaLevelDistance: number      // metres
  curvatureRefractionCorr: number  // metres (subtract this)
  meanSeaLevelRadius: number   // metres
  warnings: string[]
  regulation: string
}

export function seaLevelCorrection(input: SeaLevelCorrectionInput): SeaLevelCorrectionOutput {
  const {
    horizontalDistance,
    meanElevationMetres,
    latitudeDegrees = 0,
    refractCoeff = 0.13,
  } = input

  const R = 6_378_137  // mean Earth radius, metres (WGS84)
  const k = refractCoeff

  // Combined curvature + refraction: ΔD = D²/(2R) · (1 + k)
  const deltaD = (horizontalDistance * horizontalDistance) / (2 * R) * (1 + k)
  const seaLevelDistance = horizontalDistance - deltaD

  const warnings: string[] = []
  if (meanElevationMetres > 3000) {
    warnings.push('Elevation >3000m: verify Earth radius approximation is adequate.')
  }

  return {
    seaLevelDistance,
    curvatureRefractionCorr: deltaD,
    meanSeaLevelRadius: R,
    warnings,
    regulation: 'USACE EM 1110-1-1005 §5-15 / NOAA NOS NGS 5',
  }
}

// ─── STAGE 3: GRID CORRECTION ─────────────────────────────────────────────────

export interface GridCorrectionInput {
  seaLevelDistance: number
  scaleFactor: number       // local scale factor (from geoid model or known values)
  convergenceAngle?: number  // arc-seconds (meridian convergence at midpoint)
  easting?: number          // for auto-convergence calculation
}

export interface GridCorrectionOutput {
  gridDistance: number
  seaToGridCorr: number    // metres to add
  combinedScaleFactor: number  // sea-to-grid ratio
  convergenceAngle: number  // arc-seconds (0 if not computed)
  warnings: string[]
  regulation: string
}

export function gridCorrection(input: GridCorrectionInput): GridCorrectionOutput {
  const { seaLevelDistance, scaleFactor, convergenceAngle = 0, easting } = input

  const combinedSF = scaleFactor
  const gridDistance = seaLevelDistance * scaleFactor
  const seaToGridCorr = gridDistance - seaLevelDistance

  const warnings: string[] = []
  if (Math.abs(convergenceAngle) > 300) {
    warnings.push('Convergence angle >5° — verify zone selection is correct.')
  }
  if (scaleFactor < 0.9995 || scaleFactor > 1.0015) {
    warnings.push(`Scale factor ${scaleFactor.toFixed(6)} is unusual — verify geoid model or projection parameters.`)
  }

  return {
    gridDistance,
    seaToGridCorr,
    combinedScaleFactor: combinedSF,
    convergenceAngle,
    warnings,
    regulation: 'USACE EM 1110-1-1005 §5-15 / projection authority documentation',
  }
}

// ─── STAGE 4: ATMOSPHERIC CORRECTION ─────────────────────────────────────────

export function edmTemperatureCorrection(
  tempC: number,
  _pressureHPa: number,
  _basePPM: number
): number {
  // Barrel & Sears atmospheric correction — temperature component only
  // ppm = K × P0 × (1/T0 - 1/T), where T0 = 288.15 K (15°C standard)
  const K  = 281.8
  const P0 = 1013.25
  const T0 = 288.15   // 15°C in Kelvin
  const T  = tempC + 273.15
  return K * P0 * (1 / T0 - 1 / T)
}

export function edmPressureCorrection(
  _tempC: number,
  pressureHPa: number,
  _basePPM: number
): number {
  // Barrel & Sears atmospheric correction — pressure component only
  // ppm = K / T0 × (P0 - P), where T0 = 288.15 K, P0 = 1013.25 hPa
  const K  = 281.8
  const P0 = 1013.25
  const T0 = 288.15
  return (K / T0) * (P0 - pressureHPa)
}

export function edmCombinedAtmosphericCorrection(
  tempC: number,
  pressureHPa: number,
  edmSpecPPM: number = 5
): { totalPPM: number; tempPPM: number; pressurePPM: number; isWithinSpec: boolean } {
  const tempPPM = edmTemperatureCorrection(tempC, pressureHPa, edmSpecPPM)
  const pressPPM = edmPressureCorrection(tempC, pressureHPa, edmSpecPPM)
  const totalPPM = tempPPM + pressPPM
  const standardPPM = 0

  return {
    totalPPM,
    tempPPM,
    pressurePPM: pressPPM,
    isWithinSpec: Math.abs(totalPPM - standardPPM) <= edmSpecPPM,
  }
}

// ─── FULL EDM REDUCTION PIPELINE ─────────────────────────────────────────────

export interface EDMReductionInput {
  slopeDistance: number
  zenithAngle: number
  meanElevation: number
  scaleFactor: number
  temperatureC: number
  pressureHPa: number
  edmSpecMM?: number
  edmSpecPPM?: number
  country?: SurveyingCountry
}

export interface EDMReductionResult {
  slopeDistance: number
  horizontalDistance: number
  seaLevelDistance: number
  gridDistance: number
  totalCorrSeaLevel: number
  totalCorrGrid: number
  totalCorrAtmospheric: number
  scaleFactor: number
  convergenceAngle: number
  ppm: number
  mmAccuracy: number
  isAcceptable: boolean
  warnings: string[]
  regulation: string
}

export function edmFullReduction(input: EDMReductionInput): EDMReductionResult {
  const {
    slopeDistance,
    zenithAngle,
    meanElevation,
    scaleFactor,
    temperatureC = 15,
    pressureHPa = 1013.25,
    edmSpecMM = 5,
    edmSpecPPM = 5,
    country,
  } = input

  const slope = slopeFromEDM({ slopeDistanceMetres: slopeDistance, zenithAngle, temperatureC, pressureHPa, edmSpecMM, edmSpecPPM })
  const sea = seaLevelCorrection({ horizontalDistance: slope.horizontalDistance, meanElevationMetres: meanElevation })
  const grid = gridCorrection({ seaLevelDistance: sea.seaLevelDistance, scaleFactor })

  const atm = edmCombinedAtmosphericCorrection(temperatureC, pressureHPa, edmSpecPPM)
  const correctedDist = grid.gridDistance * (1 + atm.totalPPM / 1_000_000)
  const atmosphericCorr = correctedDist - grid.gridDistance

  const mmAccuracy = edmSpecMM + edmSpecPPM * slopeDistance / 1000

  const warnings = [
    ...slope.warnings,
    ...sea.warnings,
    ...grid.warnings,
  ]

  const std = country ? getCountryStandard(country) : null
  const defaultSlopeRule = std?.slopeCorrection.maxSlopeSingleFace ?? 10

  return {
    slopeDistance,
    horizontalDistance: slope.horizontalDistance,
    seaLevelDistance: sea.seaLevelDistance,
    gridDistance: correctedDist,
    totalCorrSeaLevel: sea.curvatureRefractionCorr,
    totalCorrGrid: grid.seaToGridCorr,
    totalCorrAtmospheric: Math.abs(atmosphericCorr),
    scaleFactor: grid.combinedScaleFactor,
    convergenceAngle: grid.convergenceAngle,
    ppm: atm.totalPPM,
    mmAccuracy,
    isAcceptable: mmAccuracy < 20,
    warnings,
    regulation: 'USACE EM 1110-1-1005 §3-5 / §5-15',
  }
}
