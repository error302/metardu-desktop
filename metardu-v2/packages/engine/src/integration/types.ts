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

/**
 * Survey output that an integration exporter can consume.
 *
 * Union of the three workflow outputs that currently surface an
 * `uncertainty` (or `pointUncertainty`) field per invariant C1:
 *   - CadastralWorkflowOutput  (cadastral — beacons carry ellipses)
 *   - TopoWorkflowOutput       (topographic — TIN vertices, "field-data" reason)
 *   - EngineeringWorkflowOutput (engineering — TIN vertices + volumes)
 *
 * Setting-out, sectional, drone-processing, lidar-classification,
 * corridor-design, surface-comparison, utility-mapping will be added
 * as they gain the same `uncertainty` field per Brief 02's pattern.
 *
 * Discriminator: each member has a unique shape that the GeoJSON
 * exporter detects via `('form3' in input)` (cadastral),
 * `('tin' in input && !('sections' in input))` (topo),
 * `('sections' in input)` (engineering).
 */
export type SurveyOutput =
  | CadastralWorkflowOutput
  | TopoWorkflowOutput
  | EngineeringWorkflowOutput;

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
 * @template TInput  — the survey output type this exporter consumes
 * @template TOptions — format-specific options, extending IntegrationOptions
 * @template TOutput — format-specific output, extending IntegrationOutput
 */
export interface IntegrationExporter<
  TInput extends SurveyOutput = SurveyOutput,
  TOptions extends IntegrationOptions = IntegrationOptions,
  TOutput extends IntegrationOutput = IntegrationOutput,
> {
  /** Format identifier — "geojson", "geopackage", "pyqgis-script", ... */
  readonly format: string;
  /** IANA / OGC MIME type for the produced artifact. */
  readonly mimeType: string;
  /** File extension without leading dot — "geojson", "gpkg", "py", ... */
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
