/**
 * Survey Computation Engine — Main Entry Point
 * 
 * All corrections, computations, and transformations in one import.
 */

// ─── Corrections ─────────────────────────────────────────────────
export {
  applyAtmosphericCorrection,
  quickAtmosphericCorrection,
  getAtmosphericPPM,
  computeVaporPressure,
  computeGroupRefractivity,
  validateAtmosphericConditions,
  STANDARD_CONDITIONS,
  KENYA_CONDITIONS,
} from './corrections/atmospheric';

export type {
  AtmosphericConditions,
  AtmosphericCorrectionResult,
  EDMInstrument,
  EDMWavelength,
} from './corrections/atmospheric';

export {
  applyCurvatureRefractionCorrection,
  computeCRCorrection,
  quickCRCorrection,
  computeMeanEarthRadius,
  maxDistanceWithoutCR,
  WGS84_A,
  WGS84_B,
  WGS84_E2,
  KENYA_REFRACTION_COEFFICIENT,
} from './corrections/curvature-refraction';

export type {
  CurvatureRefractionInput,
  CurvatureRefractionResult,
} from './corrections/curvature-refraction';

export {
  computeUTMPointScaleFactor,
  computeLineScaleFactor,
  applyGridScaleFactor,
  computeGridConvergence,
  UTM_ZONES,
} from './corrections/grid-scale-factor';

export type {
  ProjectionType,
  PointScaleFactorResult,
  LineScaleFactorResult,
  UTMZone,
} from './corrections/grid-scale-factor';

export {
  applySeaLevelReduction,
  quickSeaLevelReduction,
  computeReductionFactor,
  getKenyaGeoidUndulation,
  expandToGroundDistance,
  KENYA_GEOID_UNDULATION,
} from './corrections/sea-level-reduction';

export type {
  SeaLevelReductionInput,
  SeaLevelReductionResult,
} from './corrections/sea-level-reduction';

export {
  reduceSlopeByAngle,
  reduceSlopeByHeight,
  quickSlopeReduction,
} from './corrections/slope-reduction';

export type {
  SlopeReductionByAngle,
  SlopeReductionByHeight,
  SlopeReductionResult,
} from './corrections/slope-reduction';

export {
  computeConvergence,
  gridBearingToTrue,
  trueBearingToGrid,
  applyConvergenceToBearing,
} from './corrections/projection-convergence';

export type {
  ConvergenceInput,
  ConvergenceResult,
} from './corrections/projection-convergence';

// ─── Correction Pipeline ─────────────────────────────────────────
export {
  processObservation,
  processObservations,
  generateCorrectionReport,
  KENYA_DEFAULT_CONFIG,
} from './pipeline/correction-pipeline';

export type {
  RawObservation,
  ProcessedObservation,
  CorrectionStageLog,
  PipelineConfig,
} from './pipeline/correction-pipeline';

// ─── Traverse ────────────────────────────────────────────────────
export {
  bowditchAdjustment,
  computeBearing,
  computeDistance,
  ORDER_REQUIREMENTS,
  ORDER_STDS,
} from './traverse/engine';

export type {
  TraverseStation,
  TraverseLeg,
  TraverseResult,
  AdjustedStation,
} from './traverse/engine';

export {
  leastSquaresAdjustment,
  computeErrorEllipse,
} from './traverse/least-squares';

export type {
  LSObservation,
  LSStation,
  LSResult,
} from './traverse/least-squares';

// ─── COGO ────────────────────────────────────────────────────────
export {
  computeBearingAndDistance,
  computePoint,
  lineLineIntersection,
  lineCircleIntersection,
  circleCircleIntersection,
  inverse,
  forward,
} from './cogo/engine';

export type {
  Point,
  BearingDistance,
  IntersectionResult,
} from './cogo/engine';

// ─── Area ────────────────────────────────────────────────────────
export {
  computeAreaByShoelace,
  computeAreaByDMD,
  computeAreaByRadial,
  convertArea,
} from './area/computation';

export type {
  AreaResult,
} from './area/computation';

// ─── Error Propagation ───────────────────────────────────────────
export {
  propagateSum,
  propagateScale,
  propagateGeneral,
  propagateCoordinate,
  propagateArea,
} from './error-propagation/engine';

export type {
  UncertainValue,
  PropagationResult,
} from './error-propagation/engine';

// ─── Coordinates ─────────────────────────────────────────────────
export {
  geodeticToCartesian,
  cartesianToGeodetic,
  applyHelmert7,
  arc1960ToWGS84,
  wgs84ToArc1960,
  computeUTMZone,
  geodeticToUTM,
  CLARKE_1880_MODIFIED,
  WGS84,
  ARC1960_TO_WGS84_3PARAM,
  ARC1960_TO_WGS84_7PARAM,
} from './coordinates/transform';

export type {
  GeodeticCoords,
  CartesianCoords,
  Helmert7Param,
  UTMCoords,
} from './coordinates/transform';

// ─── Curves ──────────────────────────────────────────────────────
export {
  computeCircularCurve,
  computeCurveFromTangent,
  computeCurveFromDegree,
  computeCurveStations,
} from './curves/circular';

export type {
  CircularCurveParams,
  CircularCurveResult,
  CurveStationResult,
} from './curves/circular';

export {
  computeVerticalCurve,
  computeVerticalCurveStations,
} from './curves/vertical';

export type {
  VerticalCurveInput,
  VerticalCurveResult,
  VerticalCurveStationResult,
} from './curves/vertical';

export {
  computeSpiralCurve,
} from './curves/transition';

export type {
  SpiralCurveInput,
  SpiralCurveResult,
} from './curves/transition';

// ─── Volumes ─────────────────────────────────────────────────────
export {
  computeEndAreaVolume,
  computeTotalVolumes,
  computePrismoidalVolume,
} from './volumes/end-area';

export type {
  CrossSection,
  VolumeResult,
  TotalVolumeResult,
} from './volumes/end-area';
