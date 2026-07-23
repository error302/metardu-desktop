/**
 * Integration & Export — barrel.
 *
 * Re-exports the shared IntegrationExporter interface and all registered
 * exporters. The Electron main process (or any other consumer) imports
 * from here:
 *
 *   import { geoJsonExporter } from "@metardu/engine-flight-planning";
 *
 * New exporters (GeoPackage, PyQGIS, QGS, GCP, OSM) plug in by adding
 * their barrel entry here — the export-menu UI iterates over a list
 * populated from this module.
 *
 * Per ADR-0005: every exporter implements IntegrationExporter. The
 * contract is the gate — no new exporter ships without it.
 */

export type {
  IntegrationExporter,
  IntegrationOptions,
  IntegrationOutput,
  ProjectMetadata,
  SurveyOutput,
  ValidationResult,
} from "./types.js";

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

/**
 * Registry of all currently-registered integration exporters.
 *
 * Heterogeneous — each exporter may consume a different input type
 * (SurveyOutput for GeoJSON/GeoPackage/PyQGIS/QGS, GcpInput for the
 * GCP exporter, OsmInput for the OSM changeset exporter). The export
 * menu UI dispatches based on the `format` field.
 * `IntegrationExporter<any, any, any>` is the registry's element type —
 * type safety is preserved at each exporter's own declaration site.
 */
import { geoJsonExporter } from "./geojson-export.js";
import { geoPackageExporter } from "./geopackage-export.js";
import { pyQgisScriptExporter } from "./pyqgis-script-generator.js";
import { gcpExporter } from "./gcp-export.js";
import { qgsProjectExporter } from "./qgs-project-generator.js";
import { osmChangesetExporter } from "./osm-changeset-export.js";
import type { IntegrationExporter } from "./types.js";

// Use `any` for the registry element type so heterogeneous exporters
// (SurveyOutput consumers + GcpInput consumer + OsmInput consumer) can
// coexist. Type safety is preserved at each exporter's own declaration
// site, not at the registry level.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const INTEGRATION_EXPORTERS: ReadonlyArray<IntegrationExporter<any, any, any>> = [
  geoJsonExporter,
  geoPackageExporter,
  pyQgisScriptExporter,
  gcpExporter,
  qgsProjectExporter,
  osmChangesetExporter,
];
