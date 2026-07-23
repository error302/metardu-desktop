/**
 * Integration & Export — shared types for the IntegrationExporter pattern.
 *
 * Per ADR-0005 (Integration & Export workflow family), metardu-desktop is
 * a survey-grade source of truth that feeds downstream tools (QGIS, AutoCAD,
 * Pix4D/Metashape, OSM). Every integration exporter implements one shared
 * `IntegrationExporter` interface so new formats can be added without
 * touching workflow code, country-config code, or the UI.
 *
 * # Architectural placement
 *
 *   packages/engine/src/integration/
 *   ├── types.ts                  ← this file
 *   ├── geojson-export.ts         ← first concrete exporter
 *   ├── geopackage-export.ts      ← future (task brief 03)
 *   ├── pyqgis-script-generator.ts← future (task brief 04)
 *   ├── qgis-project-generator.ts ← future (task brief 05)
 *   ├── gcp-export.ts             ← future (task brief 06)
 *   ├── osm-changeset-export.ts   ← future (task brief 07)
 *   └── index.ts                  ← barrel
 *
 * # Hard invariants (from docs/invariants.md)
 *
 *   - A1: Sidecar owns the math. Integration modules do NOT recompute
 *     coordinates — they serialize what the workflow produced.
 *   - A2: SRID comes from country-config. A literal SRID number anywhere
 *     in integration/ is a failing review.
 *   - C1: Every statutory number traces to an adjusted value with stated
 *     uncertainty. The default is `includeUncertainty: true` so the
 *     propagated error ellipse ships with every adjusted feature.
 *   - C2: Rounding only at display time. Exported coordinates use full
 *     float64 precision via JSON.stringify's default serialization.
 *
 * # References
 *
 *   - ADR-0005: docs/decisions/0005-integration-export-workflow-family.md
 *   - RFC 7946: GeoJSON
 *   - OGC 12-128r14: GeoPackage
 *   - Master plan Section 6.6 (new — added by ADR-0005)
 */

import type { CadastralWorkflowOutput } from "../workflows/cadastral.js";
import type { TopoWorkflowOutput } from "../workflows/topographic.js";
import type { EngineeringWorkflowOutput } from "../workflows/engineering.js";
import type { SectionalWorkflowOutput } from "../workflows/sectional.js";
import type { SettingOutWorkflowOutput } from "../workflows/setting-out.js";
import type { CorridorResult } from "../workflows/corridor-design.js";
import type { ProcessingResult } from "../workflows/drone-processing.js";
import type { ClassificationResult } from "../workflows/lidar-classification.js";
import type { SurfaceComparisonResult } from "../workflows/surface-comparison.js";
import type { UtilitySurveyPlan } from "../workflows/utility-mapping.js";

/**
 * Survey output that an integration exporter can consume.
 *
 * Union of all workflow outputs that surface a `pointUncertainty`
 * (or `uncertainty`) field per invariant C1. Extended from 3 types
 * (Briefs 01-02) to all 10 types (this task) per the Brief 02 pattern.
 *
 * Discriminator: `detectSurveyType()` in `survey-type-detection.ts`
 * uses duck-typing via characteristic fields unique to each type.
 */
export type SurveyOutput =
  | CadastralWorkflowOutput
  | TopoWorkflowOutput
  | EngineeringWorkflowOutput
  | SectionalWorkflowOutput
  | SettingOutWorkflowOutput
  | CorridorResult
  | ProcessingResult
  | ClassificationResult
  | SurfaceComparisonResult
  | UtilitySurveyPlan;

/**
 * Project-level metadata embedded in every export for traceability.
 *
 * Per invariant C1: every statutory number must trace to an adjusted value.
 * Embedding the project metadata in the export means a downstream consumer
 * (GIS analyst, CAD technician, photogrammetry pipeline) can always answer
 * "where did these coordinates come from?" without guessing.
 *
 * All fields are required — refusing to export anonymous data is the
 * traceability gate.
 */
export interface ProjectMetadata {
  projectName: string;
  surveyorName: string;
  licenseNumber: string;
  /** ISO 8601 date — e.g. "2026-07-23" */
  surveyDate: string;
  /** Unique ID of the adjustment run that produced the adjusted coordinates. */
  adjustmentRunId: string;
}

/**
 * Options shared by every integration exporter.
 *
 * Concrete exporters extend this with format-specific options (e.g. layer
 * naming for GeoPackage, script-template path for PyQGIS).
 */
export interface IntegrationOptions {
  /** ISO 3166-1 alpha-2 country code — drives SRID + precision lookup. */
  countryCode: string;
  /**
   * Whether to include the full covariance per feature (default: true).
   * Downstream GIS tools that don't understand covariance can opt out,
   * but the default is "ship the uncertainty" per invariant C1.
   */
  includeUncertainty?: boolean;
  /** Project metadata — embedded in the export for traceability. */
  projectMetadata?: ProjectMetadata;
  /**
   * Optional: async function that converts projected coordinates to
   * WGS84 (EPSG:4326) lat/lon. When provided, exporters that need WGS84
   * (GCP Pix4D lat/lon columns, OSM exporter) will call it automatically.
   * When not provided, those exporters emit warnings and leave the WGS84
   * fields blank or require manual pre-conversion.
   *
   * The callback takes (easting, northing, srid) and returns
   * { lat, lon } in WGS84 decimal degrees.
   *
   * Per ADR-0005 invariant A1: the actual projection math lives in
   * the sidecar (Rust). This callback is the bridge — the Electron
   * main process wires it to the sidecar's `geodesy.utm_inverse` (or
   * `geodesy.tm_inverse`) IPC handler, resolving SRID → UTM zone +
   * ellipsoid via country-config. The engine never does projection
   * math itself.
   *
   * @example
   * // Electron main process wiring:
   * const options = {
   *   countryCode: "KE",
   *   projectMetadata,
   *   projectToWgs84: async (easting, northing, srid) => {
   *     const config = getCountryConfig("KE");
   *     const zone = config.geodeticFramework.projectionZones
   *       .find(z => z.srid === srid);
   *     const result = await sidecarClient.call("geodesy.utm_inverse", {
   *       easting, northing,
   *       zone: zone.utmZone,
   *       is_southern: zone.hemisphere === "S",
   *       ellipsoid: zone.ellipsoid,
   *     });
   *     return { lat: result.lat, lon: result.lon };
   *   }
   * };
   */
  projectToWgs84?: (
    easting: number,
    northing: number,
    srid: number,
  ) => Promise<{ lat: number; lon: number }>;
  /**
   * Optional: when true AND `projectToWgs84` callback is provided,
   * exporters that emit spatial features (GeoJSON, GeoPackage, QGS)
   * will reproject all coordinates from the survey's projected CRS to
   * WGS84 (EPSG:4326) before serialization. The output CRS declaration
   * changes from the projected SRID to 4326.
   *
   * When false (default): exporters emit in the survey's native CRS.
   * When true but no callback: exporters emit a warning and fall back
   * to the native CRS (no silent reprojection).
   */
  outputWgs84?: boolean;
}

/**
 * Result of validating an export request before serializing.
 *
 * `export()` must throw (or return a rejected promise) when `ok === false`.
 * Warnings are non-fatal — the export proceeds but the warnings are surfaced
 * in `IntegrationOutput.warnings` for the audit trail.
 */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Bytes produced by an integration exporter.
 *
 * `bytes` is always UTF-8 encoded for text formats (GeoJSON, QGS, OSM XML,
 * PyQGIS scripts) and binary for binary formats (GeoPackage). The
 * `mimeType` field on the exporter tells the caller which.
 */
export interface IntegrationOutput {
  /** Format identifier — matches `IntegrationExporter.format`. */
  format: string;
  /** UTF-8 (text formats) or binary (binary formats) bytes. */
  bytes: Uint8Array;
  /** Number of features written. */
  featureCount: number;
  /**
   * Non-fatal warnings emitted during export — e.g. "feature X has no
   * uncertainty because it predates the adjustment engine; exported
   * without." Surfaced in the UI and stored in the project log.
   */
  warnings: string[];
}

/**
 * Every integration exporter implements this interface.
 *
 * The contract is intentionally minimal: validate → export → bytes. New
 * exporters (GeoPackage, PyQGIS, QGS, GCP, OSM, DXF extension) plug into
 * the same export-menu UI by registering here.
 *
 * # Brief 06 constraint relaxation
 *
 * Originally constrained `TInput extends SurveyOutput` so all exporters
 * consumed workflow outputs. Brief 06 (GCP exporter for drone
 * photogrammetry) introduces `GcpInput` — a list of 3D control points
 * that's not a workflow output. Per master plan Section 0's "STOP and
 * report the conflict" principle, the constraint is relaxed: `TInput`
 * is now unconstrained. The 3 existing exporters (GeoJSON, GeoPackage,
 * PyQGIS) still type their `TInput` as `SurveyOutput` explicitly, so
 * they retain full type safety. The GCP exporter types its `TInput` as
 * `GcpInput`. The registry (`INTEGRATION_EXPORTERS`) is heterogeneous —
 * the export menu UI dispatches based on the `format` field.
 *
 * @template TInput  — the input type this exporter consumes (SurveyOutput,
 *                     GcpInput, or future types)
 * @template TOptions — format-specific options, extending IntegrationOptions
 * @template TOutput — format-specific output, extending IntegrationOutput
 */
export interface IntegrationExporter<
  TInput = SurveyOutput,
  TOptions extends IntegrationOptions = IntegrationOptions,
  TOutput extends IntegrationOutput = IntegrationOutput,
> {
  /** Format identifier — "geojson", "geopackage", "pyqgis-script", "gcp", ... */
  readonly format: string;
  /** IANA / OGC MIME type for the produced artifact. */
  readonly mimeType: string;
  /** File extension without leading dot — "geojson", "gpkg", "py", "csv", ... */
  readonly fileExtension: string;
  /** Human-readable one-liner for the export menu. */
  readonly description: string;
  /**
   * Validate input before serializing. Refuses to export if a statutory
   * number is missing its uncertainty trace (when includeUncertainty is
   * true), if the country code is unknown, or if project metadata is
   * incomplete.
   */
  validate(input: TInput, options: TOptions): ValidationResult;
  /** Serialize to bytes. Must throw on validation failure. */
  export(input: TInput, options: TOptions): Promise<TOutput>;
}
