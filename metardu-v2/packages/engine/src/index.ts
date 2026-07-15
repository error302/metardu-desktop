/**
 * MetaRDU Flight Planning Engine — public API.
 *
 * This package implements drone flight planning math for MetaRDU Desktop v2.0:
 *   - Camera sensor database (12+ survey drones)
 *   - Ground Sample Distance (GSD) and image footprint math
 *   - Lawnmower (boustrophedon) waypoint generation
 *   - Terrain-aware altitude (planned for Phase 1 Month 2)
 *   - Battery and flight time estimation (planned for Phase 1 Month 3)
 *   - Mission export in 5 formats: DJI KMZ, ArduPilot .waypoints, Litchi CSV, senseFly XML, generic KML
 *
 * All math uses SI units internally. Geodesy uses the equirectangular approximation
 * for local meters-to-WGS84 conversion (accurate for survey areas < 10 km).
 *
 * References:
 *   - Colomina & Molina (2014), "UAV photogrammetry for mapping"
 *   - ASPRS (2014), "Positional Accuracy Standards"
 *   - DJI WPML spec: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/
 *   - MAVLink protocol: https://mavlink.io/en/messages/common.html
 *
 * @example
 * ```typescript
 * import { getCameraById, computeFlightPlanParameters, generateLawnmowerWaypoints, exportMission } from "@metardu/engine-flight-planning";
 *
 * const camera = getCameraById("dji-mavic-3-enterprise");
 * const params = computeFlightPlanParameters(camera, 75, 0.75, 0.65);
 * // → { gsdCmPx: 2.12, footprintWidthM: 111.875, ... }
 *
 * const waypoints = generateLawnmowerWaypoints({
 *   params,
 *   area: { coordinates: [...] },
 * });
 *
 * const result = await exportMission(waypoints, { format: "dji-kmz" });
 * // → { format: "dji-kmz", bytes: Uint8Array, ... }
 * ```
 */

// Camera database
export {
  CAMERA_DATABASE,
  getCameraById,
  getCamerasByManufacturer,
  getCamerasByCategory,
  getManufacturers,
  pixelSizeMicrometers,
  type CameraSpec,
  type DroneCategory,
} from "./flight-planning/cameras.js";

// Footprint math
export {
  gsdMetersPerPixel,
  gsdCentimetersPerPixel,
  altitudeForGsd,
  footprintMeters,
  spacingMeters,
  computeFlightPlanParameters,
  photoAndLineCount,
  type FlightPlanParameters,
} from "./flight-planning/footprint.js";

// Waypoint generation
export {
  generateLawnmowerWaypoints,
  computeBoundingBox,
  computeMissionStats,
  offsetToLatLng,
  bearingDegrees,
  haversineMeters,
  type Waypoint,
  type SurveyArea,
  type LawnmowerOptions,
  type BoundingBox,
  type MissionStats,
} from "./flight-planning/waypoints.js";

// Terrain-aware altitude
export {
  elevationFromGrid,
  elevationFromFunction,
  makeTerrainAware,
  computeTerrainStats,
  type ElevationLookup,
  type ElevationGrid,
  type TerrainStats,
} from "./flight-planning/terrain.js";

// Battery and flight time estimation
export {
  estimateBatteryAndTime,
  type BatteryEstimationOptions,
  type BatteryEstimation,
} from "./flight-planning/battery.js";

// Flight plan summary report (PDF-ready JSON)
export {
  generateFlightPlanReport,
  reportToJson,
  checkAsprsCompliance,
  ASPRS_CLASSES,
  KENYA_COMPLIANCE,
  type FlightPlanReport,
  type ReportOptions,
  type AsprsClass,
  type KenyaComplianceCheck,
} from "./flight-planning/report.js";

// Mission export (unified entry point)
export {
  exportMission,
  SUPPORTED_EXPORT_FORMATS,
  type MissionExportFormat,
  type MissionExportOptions,
  type MissionExportResult,
} from "./flight-planning/export/index.js";

// Re-export individual format functions for advanced use
export { exportDjiKmz, type DjiKmzOptions } from "./flight-planning/export/dji-kmz.js";
export { exportArduPilotWaypoints, type ArduPilotWaypointsOptions } from "./flight-planning/export/ardupilot-waypoints.js";
export { exportLitchiCsv, type LitchiCsvOptions } from "./flight-planning/export/litchi-csv.js";
export { exportSenseflyXml, type SenseflyXmlOptions } from "./flight-planning/export/sensefly-xml.js";
export { exportKml, type KmlOptions } from "./flight-planning/export/generic-kml.js";

// Mission import (unified entry point)
export {
  importMission,
  importArduPilotWaypoints,
  importLitchiCsv,
  importSenseflyXml,
  importKml,
  importDjiKmz,
  type MissionImportFormat,
} from "./flight-planning/import/index.js";

// ═══ Surveying modules ═══

// Real-time stakeout
export {
  createStakeoutSession,
  StakeoutSession,
  DEFAULT_TOLERANCE,
  KENYA_TOLERANCE_PRESETS,
  type DesignPoint,
  type RoverPosition,
  type StakeoutTolerance,
  type StakeoutGuidance,
  type StakeoutStatus,
} from "./surveying/stakeout.js";

// Site calibration
export {
  computeCalibration,
  wgs84ToLocal,
  localToWgs84,
  type CalibrationPoint,
  type CalibrationResult,
} from "./surveying/site-calibration.js";

// Error ellipses
export {
  computeErrorEllipse,
  computePointErrors,
  chiSquareScale2D,
  renderErrorEllipsesSvg,
  ELLIPSE_TOLERANCE_PRESETS,
  type Covariance2D,
  type ErrorEllipse,
  type PointWithError,
} from "./surveying/error-ellipse.js";

// Leveling
export {
  computeRiseAndFall,
  computeHeightOfCollimation,
  twoPegTest,
  parseLevelCsv,
  adjustLevelNetwork,
  type LevelObservation,
  type LevelLine,
  type TwoPegTestResult,
} from "./surveying/leveling.js";

// Road alignment
export {
  centerlineAtChainage,
  offsetPoint,
  generateStakeoutTable,
  elevationAtChainage,
  type HAlignElement,
  type CenterlinePoint,
  type StakeoutPoint,
} from "./surveying/road-alignment.js";

// Feature coding
export {
  FEATURE_CODES,
  FEATURE_CODE_MAP,
  fieldToFinish,
  generateDxfLayerTable,
  type FeatureCode,
  type CodedPoint,
  type ProcessedFeature,
} from "./surveying/feature-coding.js";

// Cross-section
export {
  computeSectionArea,
  recordCrossSection,
  applyDesignTemplate,
  endAreaVolume,
  totalEarthworkVolume,
  renderCrossSectionSvg,
  type CrossSection,
  type CrossSectionPoint,
  type CrossSectionArea,
} from "./surveying/cross-section.js";

// As-built comparison
export {
  comparePoints,
  renderComparisonSvg,
  DEFAULT_COMPARISON_TOLERANCE,
  type PointComparison,
  type ComparisonSummary,
  type ComparisonTolerance,
} from "./surveying/as-built.js";

// Survey report
export {
  generateSurveyReport,
  rdmComplianceTemplate,
  type SurveyReportInput,
  type SurveyReport,
  type ComplianceCheck,
} from "./surveying/survey-report.js";

// Total station
export {
  averageFaceMeasurements,
  reduceMeasurement,
  simulateMeasurementSequence,
  INSTRUMENT_PRESETS,
  type TotalStationConfig,
  type TotalStationMeasurement,
  type AveragedMeasurement,
  type InstrumentErrors,
} from "./surveying/total-station.js";

// Map sheets
export {
  findKenyaMapSheet,
  findMapSheet,
  findSheetByName,
  SOK_SHEET_REGISTRY,
  type MapSheet,
} from "./surveying/map-sheets.js";

// Cloud sync
export {
  SyncQueue,
  computePatch,
  applyPatch,
  type SyncConfig,
  type SyncResult,
  type SyncQueueEntry,
  type JsonPatchOp,
} from "./surveying/cloud-sync.js";

// GNSS serial driver
export {
  GnssSerialDriver,
  listGnssPorts,
  RECEIVER_PRESETS as GNSS_RECEIVER_PRESETS,
  type GnssConnectionConfig,
  type GnssStreamData,
} from "./surveying/gnss-serial-driver.js";

// Total station serial driver
export {
  TotalStationSerialDriver,
  listTotalStationPorts,
  TS_RECEIVER_PRESETS,
  type TotalStationConnectionConfig,
  type TotalStationCommand,
} from "./surveying/ts-serial-driver.js";

// ═══ Geodesy modules ═══

// Geoid model
export {
  egm2008Approximate,
  convertHeight,
  ellipsoidalToOrthometric,
  orthometricToEllipsoidal,
  GEOID_MODELS,
  KENYA_GEOID_VALUES,
  type GeoidModel,
  type GeoidGrid,
} from "./geodesy/geoid.js";

// CRS database
export {
  CRS_DATABASE,
  findCrsForLocation,
  getCrsByEpsg,
  listSupportedCountries,
  type CrsDefinition,
} from "./geodesy/crs-database.js";

// ═══ LULC workflow ═══
export {
  runLulcWorkflow,
  ESRIC_LULC_CLASSES,
  reclassifyRaster,
  calculateClassAreas,
  generateBarChartSvg,
  generatePieChartSvg,
  generatePrintLayoutSvg,
  type LulcClass,
  type ClassAreaStats,
} from "./flight-planning/lulc.js";

// Version
export const ENGINE_VERSION = "2.0.0";
