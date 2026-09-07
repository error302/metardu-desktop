/**
 * Integration & Export — barrel.
 *
 * Re-exports the shared IntegrationExporter interface and all registered
 * exporters.  The Electron main process (or any other consumer) imports
 * from here:
 *
 *   import { findSurveyExporter, listSurveyFormats } from "@metardu/engine-flight-planning";
 *
 * # Discriminated-union registry
 *
 * Each exporter declares `format` as a string literal (e.g. `"geojson"`).
 * The registries below are typed as discriminated unions on `format`,
 * so `findSurveyExporter("geojson")` returns
 * `IntegrationExporter<SurveyOutput, GeoJsonOptions, GeoJsonOutput>` —
 * no `any`, no casts.
 *
 * Exporters are grouped by input type:
 *   - SurveyExporters — 6 formats consuming `SurveyOutput`
 *   - GcpExporters    — 1 format consuming `GcpInput`
 *   - OsmExporters    — 1 format consuming `OsmInput`
 *
 * Per ADR-0005: every exporter implements IntegrationExporter. The
 * contract is the gate — no new exporter ships without it.
 */

// ─── Shared types ─────────────────────────────────────────────────

export type {
  IntegrationExporter,
  IntegrationOptions,
  IntegrationOutput,
  ProjectMetadata,
  SurveyOutput,
  ValidationResult,
} from "./types.js";

// ─── Individual exporter exports ──────────────────────────────────

export {
  geoJsonExporter,
  type GeoJsonOptions,
  type GeoJsonOutput,
} from "./geojson-export.js";

export {
  geoPackageExporter,
  type GeoPackageOptions,
  type GeoPackageOutput,
} from "./geopackage-export.js";

export {
  pyQgisScriptExporter,
  type PyQgisOptions,
  type PyQgisOutput,
} from "./pyqgis-script-generator.js";

export {
  gcpExporter,
  type GcpFormat,
  type GcpInput,
  type GcpOptions,
  type GcpOutput,
  type GcpPoint,
} from "./gcp-export.js";

export {
  qgsProjectExporter,
  type QgsOptions,
  type QgsOutput,
} from "./qgs-project-generator.js";

export {
  osmChangesetExporter,
  type OsmInput,
  type OsmNode,
  type OsmOptions,
  type OsmOutput,
  type OsmWay,
} from "./osm-changeset-export.js";

export {
  dxfExporter,
  type DxfLayerSpec,
  type DxfOptions,
  type DxfOutput,
} from "./dxf-export.js";
export { getCountryDxfLayerSpecs } from "./dxf-export.js";

export {
  landxmlExporter,
  type LandxmlOptions,
  type LandxmlOutput,
} from "./landxml-export.js";

// ─── Imports (for registry construction) ──────────────────────────

import { geoJsonExporter } from "./geojson-export.js";
import { geoPackageExporter } from "./geopackage-export.js";
import { pyQgisScriptExporter } from "./pyqgis-script-generator.js";
import { gcpExporter } from "./gcp-export.js";
import { qgsProjectExporter } from "./qgs-project-generator.js";
import { osmChangesetExporter } from "./osm-changeset-export.js";
import { dxfExporter } from "./dxf-export.js";
import { landxmlExporter } from "./landxml-export.js";

// ─── Discriminated-union registries ───────────────────────────────
//
// Each registry is a discriminated union on `format`.  TypeScript
// narrows the full exporter type when you look up by format literal.
// No `any` needed.

/**
 * Exporters that consume `SurveyOutput` — the union of all workflow
 * outputs (cadastral, topo, engineering, sectional, setting-out,
 * corridor, drone, lidar, surface-comparison, utility).
 */
export type SurveyExporter =
  | typeof geoJsonExporter
  | typeof geoPackageExporter
  | typeof pyQgisScriptExporter
  | typeof qgsProjectExporter
  | typeof dxfExporter
  | typeof landxmlExporter;

/** All format literals that consume `SurveyOutput`. */
export type SurveyExportFormat = SurveyExporter["format"];

/** Exporters that consume `GcpInput` (drone photogrammetry control points). */
export type GcpExporter = typeof gcpExporter;

/** Exporters that consume `OsmInput` (OpenStreetMap changesets). */
export type OsmExporter = typeof osmChangesetExporter;

/**
 * Union of all exporter types.  Use this when you don't know the input
 * type at compile time (e.g. the IPC handler).
 */
export type AnyExporter = SurveyExporter | GcpExporter | OsmExporter;

// ─── Typed registries (readonly tuples) ───────────────────────────

/** All SurveyOutput-consuming exporters. */
export const SURVEY_EXPORTERS: readonly SurveyExporter[] = [
  geoJsonExporter,
  geoPackageExporter,
  pyQgisScriptExporter,
  qgsProjectExporter,
  dxfExporter,
  landxmlExporter,
] as const;

/** All GCP exporters. */
export const GCP_EXPORTERS: readonly GcpExporter[] = [gcpExporter] as const;

/** All OSM exporters. */
export const OSM_EXPORTERS: readonly OsmExporter[] = [osmChangesetExporter] as const;

/**
 * Flat list of all exporters — typed as `AnyExporter`.
 * Use `findExporter()` below for type-safe lookup.
 */
export const ALL_EXPORTERS: readonly AnyExporter[] = [
  ...SURVEY_EXPORTERS,
  ...GCP_EXPORTERS,
  ...OSM_EXPORTERS,
] as const;

// ─── Typed lookup functions ───────────────────────────────────────

/**
 * Find a SurveyOutput exporter by format literal.
 *
 * @example
 * const exporter = findSurveyExporter("geojson");
 * // typeof exporter === IntegrationExporter<SurveyOutput, GeoJsonOptions, GeoJsonOutput>
 * const result = await exporter.export(surveyOutput, options);
 */
export function findSurveyExporter<F extends SurveyExportFormat>(
  format: F,
): SurveyExporter & { format: F } {
  const found = SURVEY_EXPORTERS.find((e) => e.format === format);
  if (!found) {
    throw new Error(
      `Unknown survey export format: ${format}. Available: ${SURVEY_EXPORTERS.map((e) => e.format).join(", ")}`,
    );
  }
  return found as SurveyExporter & { format: F };
}

/**
 * Find a GCP exporter by format literal.
 */
export function findGcpExporter<F extends "gcp">(
  format: F,
): GcpExporter & { format: F } {
  const found = GCP_EXPORTERS.find((e) => e.format === format);
  if (!found) {
    throw new Error(`Unknown GCP export format: ${format}`);
  }
  return found as GcpExporter & { format: F };
}

/**
 * Find an OSM exporter by format literal.
 */
export function findOsmExporter<F extends "osm-changeset">(
  format: F,
): OsmExporter & { format: F } {
  const found = OSM_EXPORTERS.find((e) => e.format === format);
  if (!found) {
    throw new Error(`Unknown OSM export format: ${format}`);
  }
  return found as OsmExporter & { format: F };
}

/**
 * Find any exporter by format — returns `AnyExporter`.
 *
 * Use the typed variants (`findSurveyExporter`, `findGcpExporter`,
 * `findOsmExporter`) when you know the input type.  Use this when
 * the format comes from user input at runtime (IPC handler).
 */
export function findExporter(format: string): AnyExporter {
  const found = ALL_EXPORTERS.find((e) => e.format === format);
  if (!found) {
    throw new Error(
      `Unknown export format: ${format}. Available: ${ALL_EXPORTERS.map((e) => e.format).join(", ")}`,
    );
  }
  return found;
}

/**
 * List all available export formats with metadata.
 * Used by the IPC handler to populate the ExportPanel dropdown.
 */
export function listExportFormats(): Array<{
  format: string;
  description: string;
  fileExtension: string;
  inputType: "survey" | "gcp" | "osm";
}> {
  return [
    ...SURVEY_EXPORTERS.map((e) => ({
      format: e.format,
      description: e.description,
      fileExtension: e.fileExtension,
      inputType: "survey" as const,
    })),
    ...GCP_EXPORTERS.map((e) => ({
      format: e.format,
      description: e.description,
      fileExtension: e.fileExtension,
      inputType: "gcp" as const,
    })),
    ...OSM_EXPORTERS.map((e) => ({
      format: e.format,
      description: e.description,
      fileExtension: e.fileExtension,
      inputType: "osm" as const,
    })),
  ];
}

// ─── Backward compatibility ───────────────────────────────────────

/**
 * @deprecated Use `findExporter(format)` or the typed group registries
 * (`SURVEY_EXPORTERS`, `GCP_EXPORTERS`, `OSM_EXPORTERS`) instead.
 *
 * This flat array is typed as `readonly AnyExporter[]` — no more `any`.
 * Kept for code that iterates all exporters without caring about input type.
 */
export const INTEGRATION_EXPORTERS = ALL_EXPORTERS;
