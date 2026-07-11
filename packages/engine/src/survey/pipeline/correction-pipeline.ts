/**
 * Correction Pipeline — Unified Observation Processing
 * 
 * This is the heart of the survey computation engine. It applies ALL
 * corrections in the correct order to transform raw field observations
 * into corrected, grid-level observations ready for traverse computation.
 * 
 * Processing order (this order matters!):
 * 1. EDM Instrument Constant     → Add constant to raw distance
 * 2. Atmospheric Correction       → Correct slope distance for temp/pressure/humidity
 * 3. Slope Reduction              → Convert slope distance to horizontal
 * 4. Curvature & Refraction       → Correct height difference
 * 5. Sea Level Reduction          → Reduce horizontal distance to ellipsoid
 * 6. Grid Scale Factor            → Scale ellipsoid distance to grid distance
 * 7. Grid Convergence             → Correct bearings for projection convergence
 * 
 * Each stage logs what was applied for the full audit trail.
 */

import { applyAtmosphericCorrection, type AtmosphericConditions, type EDMInstrument } from '../corrections/atmospheric';
import { applyCurvatureRefractionCorrection, type CurvatureRefractionInput, KENYA_REFRACTION_COEFFICIENT } from '../corrections/curvature-refraction';
import { computeLineScaleFactor, applyGridScaleFactor, type ProjectionType } from '../corrections/grid-scale-factor';
import { applySeaLevelReduction, type SeaLevelReductionInput } from '../corrections/sea-level-reduction';
import { reduceSlopeByAngle, reduceSlopeByHeight, type SlopeReductionResult } from '../corrections/slope-reduction';
import { computeConvergence, applyConvergenceToBearing } from '../corrections/projection-convergence';

// ─── Types ───────────────────────────────────────────────────────

export interface RawObservation {
  /** From station name */
  fromStation: string;
  /** To station name */
  toStation: string;
  
  // Raw measurements
  /** Raw slope distance measured by EDM (meters) */
  rawSlopeDistance: number;
  /** Horizontal angle (decimal degrees, measured clockwise from reference) */
  horizontalAngle?: number;
  /** Vertical angle / zenith distance (decimal degrees, 90° = horizontal) */
  verticalAngle?: number;
  
  // EDM data
  /** EDM instrument constant (meters, additive) */
  edmConstant?: number;
  /** PPM setting on instrument */
  ppmSetting?: number;
  /** EDM carrier wavelength (μm): 0.6328 (HeNe) or 0.850 (IR) */
  edmWavelength?: 0.6328 | 0.850 | 0.910;
  
  // Atmospheric conditions at time of measurement
  temperature?: number;      // °C
  pressure?: number;         // hPa
  humidity?: number;         // %
  
  // Heights
  instrumentHeight?: number; // meters
  targetHeight?: number;     // meters
  heightAboveEllipsoid?: number; // Mean height of line (for sea level reduction)
  orthometricHeight?: number;    // Height above MSL
  
  // Coordinates (for scale factor and convergence)
  fromEasting?: number;
  fromNorthing?: number;
  toEasting?: number;
  toNorthing?: number;
  
  // Location
  latitude?: number;         // decimal degrees (for Earth radius)
  longitude?: number;        // decimal degrees (for convergence)
  
  // Bearing data
  trueBearing?: number;      // True (astronomic) bearing if observed
}

export interface CorrectionStageLog {
  stage: string;
  input: number;
  output: number;
  correction: number;
  unit: string;
}

export interface ProcessedObservation {
  /** From station name */
  fromStation: string;
  /** To station name */
  toStation: string;
  
  // Corrected distances
  /** Raw slope distance (meters) */
  rawSlopeDistance: number;
  /** After EDM constant (meters) */
  afterEdmConstant: number;
  /** After atmospheric correction (meters) */
  afterAtmospheric: number;
  /** Horizontal distance after slope reduction (meters) */
  horizontalDistance: number;
  /** After sea level reduction (meters) */
  afterSeaLevel: number;
  /** After grid scale factor — final grid distance (meters) */
  gridDistance: number;
  
  // Corrected angles
  /** Original horizontal angle (decimal degrees) */
  rawHorizontalAngle?: number;
  /** Grid bearing (decimal degrees) */
  gridBearing?: number;
  /** True bearing (decimal degrees) */
  trueBearing?: number;
  
  // Height data
  /** Height difference after C&R correction (meters) */
  heightDifference?: number;
  
  // Correction details
  /** Line scale factor applied */
  lineScaleFactor?: number;
  /** Grid convergence at point (decimal degrees) */
  convergence?: number;
  /** Atmospheric correction ppm */
  atmosphericPPM?: number;
  /** Sea level reduction ppm */
  seaLevelPPM?: number;
  
  // Full audit trail
  correctionLog: CorrectionStageLog[];
  
  // Flags
  /** Whether any correction exceeded significance thresholds */
  warnings: string[];
}

export interface PipelineConfig {
  /** Projection type for grid computations */
  projection: ProjectionType;
  /** Central meridian for convergence computation */
  centralMeridian: number;
  /** Refraction coefficient (default: 0.13 Kenya) */
  refractionCoefficient?: number;
  /** Geoid undulation for Kenya (default: -12m) */
  geoidUndulation?: number;
  /** EDM instrument defaults */
  defaultInstrument?: Partial<EDMInstrument>;
  /** Whether to apply each correction stage */
  applyAtmospheric?: boolean;
  applyCurvatureRefraction?: boolean;
  applySeaLevelReduction?: boolean;
  applyGridScaleFactor?: boolean;
  applyConvergence?: boolean;
  /** Minimum distance (meters) to apply C&R correction */
  crThresholdDistance?: number;
}

// ─── Default Config ──────────────────────────────────────────────

export const KENYA_DEFAULT_CONFIG: PipelineConfig = {
  projection: 'UTM37S',
  centralMeridian: 39,
  refractionCoefficient: KENYA_REFRACTION_COEFFICIENT,
  geoidUndulation: -12,
  defaultInstrument: {
    wavelength: 0.850,
    referenceN: 273.82,
    constant: 0,
    ppmSetting: 0,
  },
  applyAtmospheric: true,
  applyCurvatureRefraction: true,
  applySeaLevelReduction: true,
  applyGridScaleFactor: true,
  applyConvergence: true,
  crThresholdDistance: 200, // Apply C&R for lines > 200m
};

// ─── Pipeline Function ───────────────────────────────────────────

/**
 * Process a raw observation through the full correction pipeline.
 * 
 * This is the main entry point for observation processing. It applies
 * all corrections in the correct order and produces a fully corrected
 * observation with a complete audit trail.
 * 
 * @param observation - Raw field observation
 * @param config - Pipeline configuration
 * @returns Processed observation with all corrections applied
 */
export function processObservation(
  observation: RawObservation,
  config: PipelineConfig = KENYA_DEFAULT_CONFIG
): ProcessedObservation {
  const log: CorrectionStageLog[] = [];
  const warnings: string[] = [];
  
  let currentDistance = observation.rawSlopeDistance;
  
  // ─── Stage 1: EDM Instrument Constant ─────────────────────
  const edmConstant = observation.edmConstant ?? config.defaultInstrument?.constant ?? 0;
  const afterEdmConstant = currentDistance + edmConstant;
  log.push({
    stage: 'EDM Instrument Constant',
    input: currentDistance,
    output: afterEdmConstant,
    correction: edmConstant,
    unit: 'meters',
  });
  currentDistance = afterEdmConstant;
  
  // ─── Stage 2: Atmospheric Correction ──────────────────────
  let afterAtmospheric = currentDistance;
  let atmosphericPPM = 0;
  
  if (config.applyAtmospheric && observation.temperature !== undefined && observation.pressure !== undefined) {
    const conditions: AtmosphericConditions = {
      temperature: observation.temperature,
      pressure: observation.pressure,
      humidity: observation.humidity ?? 50,
    };
    
    const atmResult = applyAtmosphericCorrection(currentDistance, conditions, {
      wavelength: observation.edmWavelength ?? config.defaultInstrument?.wavelength,
      referenceN: config.defaultInstrument?.referenceN,
      ppmSetting: observation.ppmSetting ?? config.defaultInstrument?.ppmSetting,
    });
    
    afterAtmospheric = atmResult.correctedDistance;
    atmosphericPPM = atmResult.ppmCorrection;
    
    log.push({
      stage: 'Atmospheric Correction',
      input: currentDistance,
      output: afterAtmospheric,
      correction: atmResult.correctionMeters,
      unit: 'meters',
    });
    
    if (Math.abs(atmosphericPPM) > 30) {
      warnings.push(`Atmospheric correction of ${atmosphericPPM.toFixed(1)} ppm is large — verify temperature/pressure readings`);
    }
    
    currentDistance = afterAtmospheric;
  } else if (config.applyAtmospheric) {
    warnings.push('Atmospheric correction skipped — missing temperature/pressure data');
  }
  
  // ─── Stage 3: Slope Reduction ─────────────────────────────
  let horizontalDistance = currentDistance;
  let heightDifference: number | undefined;
  let slopeResult: SlopeReductionResult | undefined;
  
  if (observation.verticalAngle !== undefined) {
    slopeResult = reduceSlopeByAngle({
      slopeDistance: currentDistance,
      verticalAngle: observation.verticalAngle,
    });
    horizontalDistance = slopeResult.horizontalDistance;
    heightDifference = slopeResult.verticalComponent;
    
    // Add instrument/target height to height difference
    if (observation.instrumentHeight !== undefined && observation.targetHeight !== undefined) {
      heightDifference += (observation.instrumentHeight - observation.targetHeight);
    }
    
    log.push({
      stage: 'Slope Reduction',
      input: currentDistance,
      output: horizontalDistance,
      correction: currentDistance - horizontalDistance,
      unit: 'meters',
    });
  }
  
  // ─── Stage 4: Curvature & Refraction ─────────────────────
  let correctedHeightDiff = heightDifference;
  
  if (config.applyCurvatureRefraction && observation.verticalAngle !== undefined && slopeResult) {
    const latitude = observation.latitude ?? 0;
    const refractionK = config.refractionCoefficient ?? KENYA_REFRACTION_COEFFICIENT;
    
    const crResult = applyCurvatureRefractionCorrection({
      slopeDistance: afterAtmospheric,
      verticalAngle: observation.verticalAngle,
      instrumentHeight: observation.instrumentHeight ?? 0,
      targetHeight: observation.targetHeight ?? 0,
      latitude,
      refractionCoefficient: refractionK,
    });
    
    correctedHeightDiff = crResult.correctedHeightDifference;
    
    log.push({
      stage: 'Curvature & Refraction',
      input: heightDifference ?? 0,
      output: correctedHeightDiff,
      correction: crResult.crCorrection,
      unit: 'meters',
    });
    
    if (crResult.isSignificant) {
      warnings.push(crResult.warning!);
    }
  }
  
  // ─── Stage 5: Sea Level Reduction ────────────────────────
  let afterSeaLevel = horizontalDistance;
  let seaLevelPPM = 0;
  
  if (config.applySeaLevelReduction) {
    const h = observation.heightAboveEllipsoid ?? (observation.orthometricHeight !== undefined
      ? observation.orthometricHeight + (config.geoidUndulation ?? 0)
      : undefined);
    
    if (h !== undefined) {
      const slrResult = applySeaLevelReduction({
        horizontalDistance,
        heightAboveEllipsoid: h,
        latitude: observation.latitude ?? 0,
        geoidUndulation: config.geoidUndulation ?? 0,
      });
      
      afterSeaLevel = slrResult.ellipsoidalDistance;
      seaLevelPPM = slrResult.reductionPPM;
      
      log.push({
        stage: 'Sea Level Reduction',
        input: horizontalDistance,
        output: afterSeaLevel,
        correction: slrResult.reductionMeters,
        unit: 'meters',
      });
      
      if (slrResult.reductionPPM > 100) {
        warnings.push(`Sea level reduction of ${slrResult.reductionPPM.toFixed(1)} ppm is significant at height ${h.toFixed(0)}m`);
      }
    } else {
      warnings.push('Sea level reduction skipped — no height data provided');
    }
  }
  
  // ─── Stage 6: Grid Scale Factor ──────────────────────────
  let gridDistance = afterSeaLevel;
  let lineScaleFactor: number | undefined;
  
  if (config.applyGridScaleFactor && observation.fromEasting !== undefined && observation.toEasting !== undefined) {
    // Grid scale factor currently supports UTM only
    const utmProjection = config.projection === 'UTM36S' || config.projection === 'UTM37S'
      ? config.projection
      : 'UTM37S'; // Default fallback
    
    const gsfResult = applyGridScaleFactor(
      afterSeaLevel,
      observation.fromEasting,
      observation.fromNorthing ?? 0,
      observation.toEasting,
      observation.toNorthing ?? 0,
      utmProjection
    );
    
    gridDistance = gsfResult.gridDistance;
    lineScaleFactor = gsfResult.lineScaleFactor;
    
    log.push({
      stage: 'Grid Scale Factor',
      input: afterSeaLevel,
      output: gridDistance,
      correction: gridDistance - afterSeaLevel,
      unit: 'meters',
    });
  }
  
  // ─── Stage 7: Grid Convergence (Bearing Correction) ──────
  let gridBearing: number | undefined;
  let convergence: number | undefined;
  
  if (config.applyConvergence && observation.trueBearing !== undefined && observation.longitude !== undefined) {
    const convResult = computeConvergence({
      latitude: observation.latitude ?? 0,
      longitude: observation.longitude,
      centralMeridian: config.centralMeridian,
    });
    
    convergence = convResult.convergence;
    gridBearing = applyConvergenceToBearing(observation.trueBearing, convergence);
    
    log.push({
      stage: 'Grid Convergence',
      input: observation.trueBearing,
      output: gridBearing,
      correction: convergence,
      unit: 'degrees',
    });
    
    if (convResult.isSignificant) {
      warnings.push(`Grid convergence of ${convResult.arcSeconds.toFixed(1)}" exceeds 30" threshold`);
    }
  }
  
  return {
    fromStation: observation.fromStation,
    toStation: observation.toStation,
    rawSlopeDistance: observation.rawSlopeDistance,
    afterEdmConstant,
    afterAtmospheric,
    horizontalDistance,
    afterSeaLevel,
    gridDistance,
    rawHorizontalAngle: observation.horizontalAngle,
    gridBearing,
    trueBearing: observation.trueBearing,
    heightDifference: correctedHeightDiff,
    lineScaleFactor,
    convergence,
    atmosphericPPM,
    seaLevelPPM,
    correctionLog: log,
    warnings,
  };
}

/**
 * Process multiple observations through the pipeline.
 * Applies the same configuration to all observations.
 */
export function processObservations(
  observations: RawObservation[],
  config: PipelineConfig = KENYA_DEFAULT_CONFIG
): ProcessedObservation[] {
  return observations.map(obs => processObservation(obs, config));
}

/**
 * Generate a summary report of all corrections applied.
 * Useful for the computation sheet and audit trail.
 */
export function generateCorrectionReport(
  processed: ProcessedObservation[]
): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════');
  lines.push('       CORRECTION PIPELINE AUDIT REPORT        ');
  lines.push('═══════════════════════════════════════════════');
  lines.push('');
  
  for (const obs of processed) {
    lines.push(`─ ${obs.fromStation} → ${obs.toStation} ─`);
    lines.push(`  Raw slope distance:   ${obs.rawSlopeDistance.toFixed(4)} m`);
    
    for (const log of obs.correctionLog) {
      lines.push(`  ${log.stage}:`);
      lines.push(`    Input:     ${log.input.toFixed(6)} ${log.unit}`);
      lines.push(`    Output:    ${log.output.toFixed(6)} ${log.unit}`);
      lines.push(`    Correction:${log.correction >= 0 ? '+' : ''}${log.correction.toFixed(6)} ${log.unit}`);
    }
    
    lines.push(`  Final grid distance:  ${obs.gridDistance.toFixed(4)} m`);
    
    if (obs.warnings.length > 0) {
      lines.push('  [!] WARNINGS:');
      for (const w of obs.warnings) {
        lines.push(`    - ${w}`);
      }
    }
    lines.push('');
  }
  
  return lines.join('\n');
}
