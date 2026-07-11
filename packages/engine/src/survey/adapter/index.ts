/**
 * Survey Engine Adapter
 * 
 * Bridges the new survey computation engine (src/lib/survey/) to the
 * existing app's component interfaces. This adapter layer:
 * 
 * 1. Translates between old and new type systems
 * 2. Provides drop-in replacement functions that existing components can call
 * 3. Adds the correction pipeline to observation processing
 * 4. Maintains backward compatibility while migrating
 * 
 * Migration strategy:
 * - Components import from this adapter instead of directly from old engine
 * - Adapter delegates to survey engine where possible
 * - Falls back to old engine only where survey engine lacks features
 * - Over time, survey engine fills gaps and old engine calls are removed
 */

// ─── Re-export everything from the survey engine for convenience ──
export {
  processObservation,
  processObservations,
  generateCorrectionReport,
  KENYA_DEFAULT_CONFIG,
} from '../pipeline/correction-pipeline';

export type {
  RawObservation as SurveyRawObservation,
  ProcessedObservation,
  PipelineConfig,
  CorrectionStageLog,
} from '../pipeline/correction-pipeline';

export {
  applyAtmosphericCorrection,
  quickAtmosphericCorrection,
  getAtmosphericPPM,
  validateAtmosphericConditions,
} from '../corrections/atmospheric';

export type {
  AtmosphericConditions,
  AtmosphericCorrectionResult,
} from '../corrections/atmospheric';

export {
  applyCurvatureRefractionCorrection,
  quickCRCorrection,
  computeMeanEarthRadius,
} from '../corrections/curvature-refraction';

export {
  computeUTMPointScaleFactor,
  computeLineScaleFactor,
  applyGridScaleFactor,
  computeGridConvergence,
  UTM_ZONES,
} from '../corrections/grid-scale-factor';

export type {
  PointScaleFactorResult,
  LineScaleFactorResult,
} from '../corrections/grid-scale-factor';

export {
  applySeaLevelReduction,
  quickSeaLevelReduction,
  getKenyaGeoidUndulation,
} from '../corrections/sea-level-reduction';

export {
  reduceSlopeByAngle,
  reduceSlopeByHeight,
  quickSlopeReduction,
} from '../corrections/slope-reduction';

export {
  computeConvergence,
  gridBearingToTrue,
  trueBearingToGrid,
} from '../corrections/projection-convergence';

export {
  bowditchAdjustment as surveyBowditchAdjustment,
  computeBearing,
  computeDistance,
} from '../traverse/engine';

export {
  leastSquaresAdjustment,
  computeErrorEllipse,
} from '../traverse/least-squares';

export type {
  LSResult,
  LSStation,
  LSObservation,
} from '../traverse/least-squares';

export {
  computeAreaByShoelace,
  computeAreaByDMD,
  computeAreaByRadial,
} from '../area/computation';

export type {
  AreaResult,
} from '../area/computation';

// ─── Adapter-specific types and functions ──────────────────────────

import { processObservation, KENYA_DEFAULT_CONFIG } from '../pipeline/correction-pipeline';
import type { RawObservation, ProcessedObservation, PipelineConfig } from '../pipeline/correction-pipeline';
import { reduceSlopeByAngle } from '../corrections/slope-reduction';
import { applySeaLevelReduction } from '../corrections/sea-level-reduction';
import { applyGridScaleFactor } from '../corrections/grid-scale-factor';
import { applyAtmosphericCorrection } from '../corrections/atmospheric';

/**
 * EDM Reduction Result — compatible with old slopeFromEDM() interface
 * but powered by the survey engine's rigorous correction pipeline.
 */
export interface AdaptedEDMResult {
  /** Slope distance input (meters) */
  slopeDistance: number;
  /** Horizontal distance after slope reduction (meters) */
  horizontalDistance: number;
  /** Distance after sea level reduction (meters) */
  seaLevelDistance: number;
  /** Distance after grid scale factor (meters) — this is the final grid distance */
  gridDistance: number;
  /** Atmospheric correction in ppm */
  atmosphericPPM: number;
  /** Sea level reduction in ppm */
  seaLevelPPM: number;
  /** Line scale factor applied */
  lineScaleFactor: number;
  /** Grid convergence (decimal degrees) */
  convergence: number;
  /** C&R correction (meters) */
  crCorrection: number;
  /** All warnings from the pipeline */
  warnings: string[];
  /** Full audit trail */
  correctionLog: Array<{
    stage: string;
    input: number;
    output: number;
    correction: number;
    unit: string;
  }>;
}

/**
 * Drop-in replacement for the old `slopeFromEDM()` + `seaLevelCorrection()` + `gridCorrection()` chain.
 * 
 * Before (old engine — 3 separate calls, different formulas):
 *   const slopeOut = slopeFromEDM({ slopeDistanceMetres: sd, verticalAngle: va })
 *   const seaOut = seaLevelCorrection({ horizontalDistance: slopeOut.horizontalDistance, meanElevationMetres: elev })
 *   const gridOut = gridCorrection({ seaLevelDistance: seaOut.seaLevelDistance, scaleFactor: 0.9996 })
 * 
 * After (survey engine — single pipeline call, IAG/ISO standard):
 *   const result = reduceEDMObservation({ slopeDistance: sd, verticalAngle: va, ... })
 *   result.gridDistance // final corrected grid distance
 * 
 * This uses the full correction pipeline with IAG/ISO atmospheric correction,
 * WGS84 ellipsoid-based Earth radius, proper geoid undulation, and
 * Simpson's rule line scale factor.
 */
export function reduceEDMObservation(params: {
  /** Raw slope distance (meters) */
  slopeDistance: number;
  /** Vertical angle / zenith distance (decimal degrees, 90° = horizontal) */
  verticalAngle?: number;
  /** Temperature in °C */
  temperature?: number;
  /** Pressure in hPa */
  pressure?: number;
  /** Humidity in % */
  humidity?: number;
  /** Mean height above ellipsoid (meters) */
  heightAboveEllipsoid?: number;
  /** Orthometric height / MSL height (meters) — converted using geoid undulation */
  orthometricHeight?: number;
  /** Latitude (decimal degrees) */
  latitude?: number;
  /** Longitude (decimal degrees) */
  longitude?: number;
  /** From station easting (UTM, meters) */
  fromEasting?: number;
  /** From station northing (UTM, meters) */
  fromNorthing?: number;
  /** To station easting (UTM, meters) */
  toEasting?: number;
  /** To station northing (UTM, meters) */
  toNorthing?: number;
  /** EDM wavelength in μm (default: 0.850 for IR) */
  edmWavelength?: 0.6328 | 0.850 | 0.910;
  /** EDM constant in meters */
  edmConstant?: number;
  /** EDM PPM setting */
  ppmSetting?: number;
  /** Instrument height (meters) */
  instrumentHeight?: number;
  /** Target height (meters) */
  targetHeight?: number;
  /** UTM projection zone */
  projection?: 'UTM36S' | 'UTM37S';
  /** Whether to skip certain corrections */
  skipAtmospheric?: boolean;
  skipSeaLevel?: boolean;
  skipGridScale?: boolean;
  skipConvergence?: boolean;
}): AdaptedEDMResult {
  const config: PipelineConfig = {
    ...KENYA_DEFAULT_CONFIG,
    projection: params.projection ?? 'UTM37S',
    centralMeridian: params.projection === 'UTM36S' ? 33 : 39,
    applyAtmospheric: !params.skipAtmospheric,
    applySeaLevelReduction: !params.skipSeaLevel,
    applyGridScaleFactor: !params.skipGridScale,
    applyConvergence: !params.skipConvergence,
  };

  const observation: RawObservation = {
    fromStation: '',
    toStation: '',
    rawSlopeDistance: params.slopeDistance,
    verticalAngle: params.verticalAngle,
    temperature: params.temperature,
    pressure: params.pressure,
    humidity: params.humidity,
    heightAboveEllipsoid: params.heightAboveEllipsoid,
    orthometricHeight: params.orthometricHeight,
    latitude: params.latitude,
    longitude: params.longitude,
    fromEasting: params.fromEasting,
    fromNorthing: params.fromNorthing,
    toEasting: params.toEasting,
    toNorthing: params.toNorthing,
    edmWavelength: params.edmWavelength,
    edmConstant: params.edmConstant,
    ppmSetting: params.ppmSetting,
    instrumentHeight: params.instrumentHeight,
    targetHeight: params.targetHeight,
  };

  const processed = processObservation(observation, config);

  return {
    slopeDistance: processed.rawSlopeDistance,
    horizontalDistance: processed.horizontalDistance,
    seaLevelDistance: processed.afterSeaLevel,
    gridDistance: processed.gridDistance,
    atmosphericPPM: processed.atmosphericPPM ?? 0,
    seaLevelPPM: processed.seaLevelPPM ?? 0,
    lineScaleFactor: processed.lineScaleFactor ?? 1.0,
    convergence: processed.convergence ?? 0,
    crCorrection: processed.correctionLog.find(l => l.stage === 'Curvature & Refraction')?.correction ?? 0,
    warnings: processed.warnings,
    correctionLog: processed.correctionLog,
  };
}

/**
 * Compute mean angle from HCL/HCR face-left/face-right readings.
 * Shared utility extracted from TraverseBook.tsx and TraverseFieldBook.tsx
 * (was duplicated in both components).
 * 
 * Source: Basak, Chapter 10 — Mean angle from face-left and face-right
 *         horizontal circle readings
 * Source: Ghilani & Wolf, Chapter 12 — HCR_adj = HCR + 180° when HCR < 180°
 * 
 * @param hclDeg - Face-left degrees
 * @param hclMin - Face-left minutes
 * @param hclSec - Face-left seconds
 * @param hcrDeg - Face-right degrees
 * @param hcrMin - Face-right minutes
 * @param hcrSec - Face-right seconds
 * @returns Mean angle as DMS string (e.g. "123°45'12.3\"") or '—' if incomplete
 */
export function computeMeanAngleDMS(
  hclDeg: string, hclMin: string, hclSec: string,
  hcrDeg: string, hcrMin: string, hcrSec: string
): string {
  const hasHCL = hclDeg !== '' || hclMin !== '' || hclSec !== ''
  const hasHCR = hcrDeg !== '' || hcrMin !== '' || hcrSec !== ''
  if (!hasHCL || !hasHCR) return '—'

  const hclDecimal = (parseInt(hclDeg) || 0) + (parseInt(hclMin) || 0) / 60 + (parseFloat(hclSec) || 0) / 3600
  const hcrDecimal = (parseInt(hcrDeg) || 0) + (parseInt(hcrMin) || 0) / 60 + (parseFloat(hcrSec) || 0) / 3600

  // Source: Basak, Eq. 10.2 — Mean angle = (HCL + HCR_adj) / 2
  // HCR_adj = HCR + 180° (to bring face-right reading to same reference as face-left)
  let hcrAdj = hcrDecimal + 180
  if (hcrAdj >= 360) hcrAdj -= 360

  const mean = (hclDecimal + hcrAdj) / 2
  const normMean = ((mean % 360) + 360) % 360

  const deg = Math.floor(normMean)
  const minFloat = (normMean - deg) * 60
  const min = Math.floor(minFloat)
  const sec = (minFloat - min) * 60

  return `${deg}°${String(min).padStart(2, '0')}'${sec.toFixed(1)}"`
}

/**
 * Quick slope reduction for field book display.
 * Returns horizontal distance from slope distance and vertical angle.
 * Uses the survey engine's rigorous slope reduction.
 */
export function quickHorizontalDistance(
  slopeDistance: number,
  verticalAngle: number
): number {
  return reduceSlopeByAngle({ slopeDistance, verticalAngle }).horizontalDistance;
}

/**
 * Batch-process a traverse's EDM observations through the correction pipeline.
 * Takes the same observation format as the computations/traverseEngine
 * and returns corrected grid distances for each leg.
 * 
 * This is the key integration point: the traverse engine computes
 * horizontal distances internally (SD × cos(VA)), but does NOT apply
 * atmospheric, sea level, or grid scale factor corrections. This function
 * adds all those corrections and returns the corrected results.
 */
export function processTraverseObservations(
  legs: Array<{
    fromStation: string;
    toStation: string;
    slopeDistance: number;
    verticalAngle?: number;
    fromEasting?: number;
    fromNorthing?: number;
    toEasting?: number;
    toNorthing?: number;
    temperature?: number;
    pressure?: number;
    humidity?: number;
    instrumentHeight?: number;
    targetHeight?: number;
    heightAboveEllipsoid?: number;
  }>,
  config?: Partial<PipelineConfig>
): Array<ProcessedObservation & { legIndex: number }> {
  const fullConfig: PipelineConfig = { ...KENYA_DEFAULT_CONFIG, ...config };

  return legs.map((leg, index) => {
    const observation: RawObservation = {
      fromStation: leg.fromStation,
      toStation: leg.toStation,
      rawSlopeDistance: leg.slopeDistance,
      verticalAngle: leg.verticalAngle,
      fromEasting: leg.fromEasting,
      fromNorthing: leg.fromNorthing,
      toEasting: leg.toEasting,
      toNorthing: leg.toNorthing,
      temperature: leg.temperature,
      pressure: leg.pressure,
      humidity: leg.humidity,
      instrumentHeight: leg.instrumentHeight,
      targetHeight: leg.targetHeight,
      heightAboveEllipsoid: leg.heightAboveEllipsoid,
    };

    const processed = processObservation(observation, fullConfig);
    return { ...processed, legIndex: index };
  });
}

/**
 * Convert a bearing in DMS string format to decimal degrees.
 * Handles: "123°45'12.3\"", "123 45 12.3", "123.456"
 */
export function parseBearingDMS(bearingStr: string): number {
  if (!bearingStr) return 0;
  // Try DMS format with degree/minute/second symbols
  const dmsMatch = String(bearingStr).match(/(\d+)[°\-\s](\d+)['\-\s](\d+\.?\d*)/);
  if (dmsMatch) {
    const [, d, m, s] = dmsMatch.map(Number);
    return d + m / 60 + s / 3600;
  }
  // Try degree-minute format "123°45'"
  const dmMatch = String(bearingStr).match(/(\d+)[°](\d+)['"]/);
  if (dmMatch) {
    const [, d, m] = dmMatch.map(Number);
    return d + m / 60;
  }
  return parseFloat(String(bearingStr)) || 0;
}

/**
 * Format a decimal degree bearing as DMS string.
 */
export function bearingToDMS(bearing: number): string {
  const norm = ((bearing % 360) + 360) % 360;
  const d = Math.floor(norm);
  const mFloat = (norm - d) * 60;
  const m = Math.floor(mFloat);
  const s = (mFloat - m) * 60;
  return `${String(d).padStart(3, '0')}° ${String(m).padStart(2, '0')}' ${s.toFixed(1)}"`;
}

// ─── Atmospheric Defaults ─────────────────────────────────────────
export {
  getAtmosphericDefaults,
  autoDetectUTMZone,
  findNearestPreset,
  findPresetByCounty,
  icaoPressure,
  fetchRealtimeWeather,
  computeAtmosphericErrorImpact,
  validateAtmosphericDefaults,
  KENYA_LOCATION_PRESETS,
} from './atmosphericDefaults';

export type {
  AtmosphericDefaults,
  AtmosphericSource,
  ProjectAtmosphericSettings,
  KenyaLocationPreset,
} from './atmosphericDefaults';
