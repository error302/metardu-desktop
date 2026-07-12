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

// Package version
export const ENGINE_VERSION = '0.1.0';
export const ENGINE_PROVENANCE = 'Reused verbatim from error302/metardu @ v1.0.1';
