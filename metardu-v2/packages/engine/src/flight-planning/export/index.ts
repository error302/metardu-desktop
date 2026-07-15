/**
 * Mission export — unified entry point for all formats.
 *
 * Each format has its own module:
 *   - dji-kmz.ts        → DJI Pilot 2 / Litchi KMZ (wpml format)
 *   - ardupilot-waypoints.ts → ArduPilot / PX4 .waypoints (QGC WPL 110)
 *   - litchi-csv.ts     → Litchi CSV
 *   - sensefly-xml.ts   → senseFly eMotion XML (eBee X)
 *   - generic-kml.ts    → KML 2.2 (Google Earth, QGIS, ArcGIS)
 *
 * This module re-exports them and provides a unified `exportMission` function
 * that takes a format string and returns the bytes.
 */

import type { Waypoint } from "../waypoints.js";
import { exportDjiKmz, type DjiKmzOptions } from "./dji-kmz.js";
import { exportArduPilotWaypoints, type ArduPilotWaypointsOptions } from "./ardupilot-waypoints.js";
import { exportLitchiCsv, type LitchiCsvOptions } from "./litchi-csv.js";
import { exportSenseflyXml, type SenseflyXmlOptions } from "./sensefly-xml.js";
import { exportKml, type KmlOptions } from "./generic-kml.js";

export { exportDjiKmz, type DjiKmzOptions } from "./dji-kmz.js";
export { exportArduPilotWaypoints, type ArduPilotWaypointsOptions } from "./ardupilot-waypoints.js";
export { exportLitchiCsv, type LitchiCsvOptions } from "./litchi-csv.js";
export { exportSenseflyXml, type SenseflyXmlOptions } from "./sensefly-xml.js";
export { exportKml, type KmlOptions } from "./generic-kml.js";

/**
 * Supported mission export formats.
 */
export type MissionExportFormat =
  | "dji-kmz"
  | "ardupilot-waypoints"
  | "litchi-csv"
  | "sensefly-xml"
  | "kml";

/**
 * Union of all export option types.
 */
export type MissionExportOptions =
  | ({ format: "dji-kmz" } & DjiKmzOptions)
  | ({ format: "ardupilot-waypoints" } & ArduPilotWaypointsOptions)
  | ({ format: "litchi-csv" } & LitchiCsvOptions)
  | ({ format: "sensefly-xml" } & SenseflyXmlOptions)
  | ({ format: "kml" } & KmlOptions);

/**
 * Result of a mission export.
 *
 * For text-based formats (ArduPilot, Litchi, senseFly, KML), `text` is populated.
 * For binary formats (DJI KMZ), `bytes` is populated.
 */
export interface MissionExportResult {
  format: MissionExportFormat;
  /** File extension including the dot, e.g., ".kmz", ".waypoints", ".csv" */
  fileExtension: string;
  /** IANA MIME type */
  mimeType: string;
  /** Text content (for text-based formats) */
  text?: string;
  /** Binary content (for binary formats like KMZ) */
  bytes?: Uint8Array;
}

/**
 * Export a mission in the specified format.
 *
 * @param waypoints Array of waypoints to export
 * @param options Format-specific options, with `format` field selecting the export type
 */
export async function exportMission(
  waypoints: Waypoint[],
  options: MissionExportOptions
): Promise<MissionExportResult> {
  switch (options.format) {
    case "dji-kmz": {
      const { format, ...opts } = options;
      const bytes = await exportDjiKmz(waypoints, opts);
      return {
        format: "dji-kmz",
        fileExtension: ".kmz",
        mimeType: "application/vnd.google-earth.kmz",
        bytes,
      };
    }

    case "ardupilot-waypoints": {
      const { format, ...opts } = options;
      const text = exportArduPilotWaypoints(waypoints, opts);
      return {
        format: "ardupilot-waypoints",
        fileExtension: ".waypoints",
        mimeType: "text/plain",
        text,
      };
    }

    case "litchi-csv": {
      const { format, ...opts } = options;
      const text = exportLitchiCsv(waypoints, opts);
      return {
        format: "litchi-csv",
        fileExtension: ".csv",
        mimeType: "text/csv",
        text,
      };
    }

    case "sensefly-xml": {
      const { format, ...opts } = options;
      const text = exportSenseflyXml(waypoints, opts);
      return {
        format: "sensefly-xml",
        fileExtension: ".xml",
        mimeType: "application/xml",
        text,
      };
    }

    case "kml": {
      const { format, ...opts } = options;
      const text = exportKml(waypoints, opts);
      return {
        format: "kml",
        fileExtension: ".kml",
        mimeType: "application/vnd.google-earth.kml+xml",
        text,
      };
    }

    default: {
      const _exhaustive: never = options;
      throw new Error(`Unknown export format: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * List all supported export formats with metadata.
 */
export const SUPPORTED_EXPORT_FORMATS: ReadonlyArray<{
  format: MissionExportFormat;
  label: string;
  description: string;
  fileExtension: string;
  platforms: string[];
}> = [
  {
    format: "dji-kmz",
    label: "DJI KMZ (wpml)",
    description: "DJI Pilot 2 and Litchi-compatible waypoint mission file (KMZ = ZIP with template.kml + wml.waypoints)",
    fileExtension: ".kmz",
    platforms: ["DJI Mavic 3 Enterprise", "DJI Phantom 4 RTK", "DJI Matrice 350", "Litchi"],
  },
  {
    format: "ardupilot-waypoints",
    label: "ArduPilot .waypoints (QGC WPL 110)",
    description: "Plain-text waypoint file compatible with Mission Planner and QGroundControl for Pixhawk-based drones",
    fileExtension: ".waypoints",
    platforms: ["ArduPilot", "PX4", "Pixhawk"],
  },
  {
    format: "litchi-csv",
    label: "Litchi CSV",
    description: "CSV waypoint file for the Litchi app (alternative to DJI Pilot for Mavic/Phantom/Mini)",
    fileExtension: ".csv",
    platforms: ["Litchi", "DJI Mavic", "DJI Phantom", "DJI Mini"],
  },
  {
    format: "sensefly-xml",
    label: "senseFly eMotion XML",
    description: "XML mission file for senseFly eMotion (eBee X fixed-wing survey drones)",
    fileExtension: ".xml",
    platforms: ["senseFly eBee X", "senseFly eBee Plus"],
  },
  {
    format: "kml",
    label: "Generic KML 2.2",
    description: "Universal KML file for Google Earth, QGIS, ArcGIS, and any GIS application. Does not upload to drones.",
    fileExtension: ".kml",
    platforms: ["Google Earth", "QGIS", "ArcGIS", "Any KML-compatible app"],
  },
] as const;
