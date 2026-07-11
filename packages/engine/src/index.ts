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

// Re-export the most commonly used modules for easy IPC handler access
export * as traverse from './engine/traverse.js';
export * as cogo from './engine/cogo.js';
export * as area from './engine/area.js';
export * as curves from './engine/curves.js';
export * as leastSquares from './engine/leastSquares.js';
export * as robustEstimation from './engine/robustEstimation.js';
export * as networkAdjustment from './engine/networkAdjustment.js';
export * as contours from './engine/contours.js';
export * as subdivision from './engine/subdivision.js';

export * as cassiniSoldner from './geo/cassiniSoldner/index.js';
export * as datumTransforms from './geo/datumTransforms/index.js';

export * as tin from './topo/tin/index.js';
export * as featureCodes from './topo/featureCodes/index.js';

export * as roadDesign from './engineering/road/index.js';
export * as earthworks from './engineering/earthworks/index.js';
export * as leveling from './engineering/leveling/index.js';

export * as importers from './importers/index.js';
export * as exporters from './export/index.js';
export * as documents from './documents/index.js';

// Package version
export const ENGINE_VERSION = '0.1.0';
export const ENGINE_PROVENANCE = 'Reused verbatim from error302/metardu @ v1.0.1';
