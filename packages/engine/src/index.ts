/**
 * @metardu/engine — Surveying engine libraries
 *
 * Reused verbatim from error302/metardu (https://github.com/error302/metardu).
 * These libraries are framework-agnostic: no Next.js, no React, no DOM-only APIs.
 * They run in the Electron main process and are exposed to the renderer via IPC.
 *
 * Subpackages:
 *   - engine/        Traverse (Bowditch/Transit), COGO, LSA, network adjustment
 *   - geo/            Cassini-Soldner, Arc 1960 ↔ WGS84, Helmert transforms
 *   - geodesy/        Geodetic computations, datum registry
 *   - topo/           TIN (constrained Delaunay), contours, feature coding
 *   - engineering/    Road design, leveling, earthworks, mass-haul
 *   - gnss/           NTRIP RTK client, GNSS processing
 *   - importers/      CSV, Leica GSI, JobXML, RW5, South, LAS/LAZ, RINEX
 *   - export/         LandXML 1.2, DXF, Shapefile, NLIMS JSON, machine-control
 *   - documents/      Form No. 4 deed plan, beacon certs, mutation, workbook
 *   - submission/     NLIMS/ArdhiSasa submission preparation
 *   - survey/         Beacon registry, mutation, parcel management
 */

// Direct exports for the most-used functions (so IPC handlers can import them by name)
export {
  bowditchAdjustment,
  transitAdjustment,
  forwardTraverse,
  evaluateTraverseClosure,
  TRAVERSE_PRECISION_STANDARDS,
  angularClosureTolerance,
  type SurveyTypeKey,
  type TraverseInput,
  type ForwardTraverseInput,
  type ForwardTraverseResult,
} from './engine/traverse';

export {
  radiation,
  bearingIntersection,
  tienstraResection,
} from './engine/cogo';

export { propagateToEpoch, geodeticToEcef, ecefToGeodetic } from './geo/epochManager';

export { DEED_PLAN_TEMPLATE } from './documents/templates/deed-plan';
export { FORM_NO4_TEMPLATE } from './documents/templates/form-no4';
export type { DeedPlanTemplateData, DeedPlanPoint, DeedPlanBoundary } from './documents/templates/deed-plan';
export type { FormNo4Data } from './documents/templates/form-no4';
export {
  registerTemplate,
  getTemplate,
  getAllTemplates,
  hasTemplate,
  type DocumentType,
  type DocumentTemplate,
} from './documents/templates/registry';

// NLIMS export (M3)
export {
  exportToNLIMS,
  validateNLIMSExport,
  calculateAreaSqM,
  calculatePerimeterM,
  sqMToHectares,
  calculateAreaHectares,
  computeIntegrityHash,
  type NLIMSSubmissionPayload,
  type NLIMSExportParams,
  type NLIMSValidationResult,
  type ParcelInput,
  type BeaconInput,
} from './export/nlimsExporter';

// Mutation form (M3)
export { generateMutationForm } from './submission/generators/mutationForm';
export type { MutationFormInput } from './submission/generators/mutationForm';

// Topographic (M4) — TIN, contours, IDW, feature codes
export { buildTIN, interpolateZ, computeCutFill } from './survey/surfaceTIN';
export type { SurfacePoint, Triangle, TIN, CutFillResult } from './survey/surfaceTIN';
export { buildBreaklineTIN, checkContourSanity } from './topo/breaklineTIN';
export type { Breakline, BreaklineTINResult, ContourSanityResult } from './topo/breaklineTIN';
export { generateContours } from './topo/contourGenerator';
export type { ContourLine, ContourGeneratorOptions } from './topo/contourGenerator';
export { runIDW, runIDWSync, gridToFlat } from './topo/idwEngine';
export type { IDWSample, IDWGrid, IDWOptions } from './topo/idwEngine';
export { getFeatureCode, getCodesByCategory, getAllGroups, mapPointsToLayers, joinFeatureLines, KENYA_TOPO_CODES, ACI_COLORS, aciToHex, DXF_LINE_TYPE_PATTERNS } from './topo/featureCodes';
export type { FeatureCodeDef, FeatureCodeGroup, FeatureCategory, DXFLineType, PointSymbol, LayerMappingResult } from './topo/featureCodes';

// Importers (M4) — RINEX, LAS/LAZ, CSV, GSI, JobXML, RW5, South
export { parseRinexHeader } from './importers/parsers/rinex';
export type { RinexHeader, RinexObservation } from './importers/parsers/rinex';

// Exporters (M4) — DXF, LandXML, GeoJSON, Shapefile
export { generateDXF } from './export/generateDXF';
export type { DXFExportOptions } from './export/generateDXF';
export { generateLandXML } from './export/generateLandXML';
export type { LandXMLProject, LandXMLPoint } from './export/generateLandXML';
export { generateGeoJSON } from './export/generateGeoJSON';
export { generateShapefileZip } from './export/generateShapefile';
export type { ParcelData, BoundaryLine, BeaconData } from './export/generateShapefile';

// ─── Engineering (M6) ──────────────────────────────────────────────────
export {
  horizontalCurve, verticalCurve, superelevationCalc,
  crossSectionVolume, massHaulDiagram, wideningOnCurve,
} from './engineering/compute';
export { simpleCircularCurve } from './engineering/curves';
export { riseAndFall, heightOfCollimation } from './engine/leveling';
export { optimizeMassHaul } from './engineering/massHaulOptimization';
export { manningPipeCapacity } from './engineering/drainageDesign';

// ─── Machine control (M6) ──────────────────────────────────────────────
export {
  generateMachineControlExport, generateAlignmentLandXML,
  generateStakeoutCSV, generate3DDXFFromTIN,
} from './export/machineControl';
export {
  exportTrimbleCSV, exportLeicaGSI, exportTopconCSV, exportGenericCSV,
} from './export/machineControlExport';

// Package version
export const ENGINE_VERSION = '0.1.0';
export const ENGINE_PROVENANCE = 'Reused verbatim from error302/metardu @ v1.0.1';
