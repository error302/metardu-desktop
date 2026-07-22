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

/**
 * Registry of all currently-registered integration exporters.
 *
 * The export-menu UI iterates over this list to build its options. To
 * add a new format: implement IntegrationExporter, add an entry here.
 */
import { geoJsonExporter } from "./geojson-export.js";
import { geoPackageExporter } from "./geopackage-export.js";
import { pyQgisScriptExporter } from "./pyqgis-script-generator.js";
import type { IntegrationExporter } from "./types.js";

export const INTEGRATION_EXPORTERS: ReadonlyArray<IntegrationExporter> = [
  geoJsonExporter,
  geoPackageExporter,
  pyQgisScriptExporter,
];
