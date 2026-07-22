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

// ─── Surveying & GNSS modules (Phase 1.1 — re-export fix) ───────────────
// These modules were added in earlier commits but never re-exported from the
// package root, causing 42 gnss tests to fail with "X is not a function".
// See docs/audits/phase-0-baseline.md defect #2.

// GNSS — survey-grade satellite positioning, NMEA/RTCM/NTRIP/RINEX, datum transforms
export * from "./gnss/index.js";

// Surveying modules — post-field-data computation primitives
export * from "./surveying/leveling.js";
export * from "./surveying/road-alignment.js";
export * from "./surveying/cross-section.js";
export * from "./surveying/as-built.js";
export * from "./surveying/feature-coding.js";
export * from "./surveying/error-ellipse.js";
export * from "./surveying/site-calibration.js";
export * from "./surveying/stakeout.js";

// Geodesy — CRS database, geoid models
export * from "./geodesy/crs-database.js";
export * from "./geodesy/geoid.js";

// Documents — statutory document renderers (Phase 6) + DXF output (Phase 10+)
export {
  generateForm3Pdf,
  type Form3Input,
  type Form3Output,
  type Form3Parcel,
  type Form3Beacon,
  type Form3Surveyor,
  type Form3Point,
} from "./documents/form-3.js";

// DXF output module — CAD-compatible DXF for all survey plans (Phase 10+)
export {
  createSurveyDxf,
  addPolygon,
  addBeacon,
  addText,
  addBearingDistanceLabel,
  addNorthArrow,
  addScaleBar,
  addTIN,
  addContours,
  addSpotHeights,
  generateForm3Dxf,
  generateTopoDxf,
  generateEngineeringDxf,
  generateSectionalDxf,
  serializeDxf,
  SURVEY_LAYERS,
  type DxfPoint,
  type DxfLayerDef,
} from "./documents/dxf-output.js";

// Workflows — vertical slices tying sidecar + country-config + renderers
// (Phase 6 cadastral + Phase 9 topo/engineering/setting-out/sectional)
export {
  runCadastralWorkflow,
  type CadastralWorkflowInput,
  type CadastralWorkflowOutput,
  type DistanceObservation,
  // Topographic (Phase 9A)
  runTopographicWorkflow,
  type TopoPoint,
  type TIN,
  type Contour,
  type SpotHeight,
  type TopoWorkflowInput,
  type TopoWorkflowOutput,
  // Engineering (Phase 9B)
  runEngineeringWorkflow,
  type DesignSurface,
  type Alignment,
  type CrossSection,
  type EngineeringWorkflowInput,
  type EngineeringWorkflowOutput,
  // Construction Setting-Out (Phase 9C)
  runSettingOutWorkflow,
  type DesignPoint,
  type ControlPoint,
  type StakeoutMethod,
  type StakeoutInstruction,
  type AsBuiltObservation,
  type AsBuiltResult,
  type SettingOutWorkflowInput,
  type SettingOutWorkflowOutput,
  // Sectional Properties (Phase 9D)
  runSectionalWorkflow,
  type Polygon,
  type BuildingLevel,
  type SectionalUnit,
  type SectionalWorkflowInput,
  type SectionalWorkflowOutput,
  // Drone data processing (photogrammetry)
  validatePhotos,
  computeGsd,
  classifyAsprs,
  estimateOverlap,
  generateProcessingReport,
  type DronePhoto,
  type GCP,
  type ProcessingQuality,
  type ProcessingResult,
  type DroneProcessingInput,
} from "./workflows/index.js";

// Instrument import — THE killer feature (Leica GSI, Trimble DC, Sokkia SDR, RINEX)
export {
  importFieldData,
  parseLeicaGSI,
  parseSokkiaSDR,
  parseTrimbleDC,
  parseRinexHeader,
  type FieldObservation,
  type ImportResult,
} from "./import/instrument-import.js";

// UK Measured Survey Plan renderer (RICS-compliant)
export {
  generateUkMeasuredSurveyPdf,
  type UkSurveyPoint,
  type UkMeasuredSurveyInput,
  type UkMeasuredSurveyOutput,
} from "./documents/uk-measured-survey.js";

// Surface comparison + stockpile volumes + construction progress
export {
  compareSurfaces,
  computeStockpileVolume,
  computeConstructionProgress,
  type SurfaceComparisonResult,
  type StockpileResult,
} from "./workflows/surface-comparison.js";

// LiDAR point cloud classification (DSM → DTM ground extraction)
export {
  classifyLidarPoints,
  sampleGridElevation,
  generateContoursFromGrid,
  type LidarPoint,
  type LidarClass,
  type ClassificationResult,
  type GridSurface,
  type ClassificationParams,
} from "./workflows/lidar-classification.js";

// Sync with metardu web
export {
  SyncClient,
  type SyncConfig,
  type SyncProject,
  type SyncQueueItem,
  type SyncConflict,
  type SyncStatus,
} from "./sync/sync-client.js";

// Multi-user collaboration
export {
  TeamManager,
  type TeamRole,
  type TeamMember,
  type Team,
  type ProjectVisibility,
  type SharedProject,
  type ActivityEvent,
  type ProjectComment,
} from "./sync/team-collaboration.js";

// Corridor/alignment design
export {
  generateCorridor,
  STANDARD_TEMPLATES,
  type HorizontalElement,
  type VerticalElement,
  type CrossSectionTemplate,
  type CorridorDesign,
  type DesignCrossSection,
  type CorridorResult,
} from "./workflows/corridor-design.js";

// GPR/utility mapping
export {
  importGprData,
  generateUtilitySurveyPlan,
  UTILITY_COLORS,
  UTILITY_LABELS,
  type UtilityType,
  type GprDetection,
  type GprImportResult,
  type UtilitySurveyPlan,
  type UtilityRun,
  type UtilityCrossing,
} from "./workflows/utility-mapping.js";

// Digital signature + seal
export {
  generateKeyPair,
  exportPublicKeyBase64,
  importPublicKeyBase64,
  exportPrivateKeyBase64,
  importPrivateKeyBase64,
  signContent,
  verifySignature,
  generateSealText,
  createIdentity,
  type SurveyorIdentity,
  type DigitalSignature,
  type VerificationResult,
} from "./signing/digital-signature.js";

// Integration & Export (ADR-0005) — survey-grade source of truth that
// feeds downstream GIS/CAD/photogrammetry tools.
export {
  geoJsonExporter,
  geoPackageExporter,
  pyQgisScriptExporter,
  INTEGRATION_EXPORTERS,
  type IntegrationExporter,
  type IntegrationOptions,
  type IntegrationOutput,
  type GeoJsonOptions,
  type GeoJsonOutput,
  type GeoPackageOptions,
  type GeoPackageOutput,
  type PyQgisOptions,
  type PyQgisOutput,
  type ProjectMetadata,
  type SurveyOutput,
  type ValidationResult,
} from "./integration/index.js";

// Version
export const ENGINE_VERSION = "0.5.0";
