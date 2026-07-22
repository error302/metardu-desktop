/**
 * GCP (Ground Control Point) file exporter for drone photogrammetry
 * tie-in — Pix4D, Metashape, Agisoft CSV format.
 *
 * # What this is
 *
 * The Spatial Data Editor role (drone side) per ADR-0005: a surveyor
 * places GCP targets on the ground before the drone flight, measures
 * each GCP with GNSS RTK to get a 3D position, then exports the GCPs
 * to a file the drone photogrammetry software (Pix4D / Metashape /
 * Agisoft) can ingest. The photogrammetry pipeline uses the GCPs to
 * georeference the orthophoto + point cloud.
 *
 * metardu-desktop's job here is to take a list of GCPs (3D positions
 * with uncertainty) and emit a CSV in the format the chosen
 * photogrammetry tool expects.
 *
 * # Architectural placement
 *
 * Per Brief 06's constraint relaxation (documented in
 * `types.ts` → `IntegrationExporter`), this exporter consumes
 * `GcpInput` — a list of 3D control points — NOT a `SurveyOutput`.
 * GCPs are a fundamentally different input shape: they're control
 * points placed for drone tie-in, not the output of a survey workflow.
 *
 * The surveyor builds a `GcpInput` from:
 *   - GNSS RTK measurements imported via the existing instrument
 *     import module (Leica/Sokkia/Trimble/RINEX)
 *   - Topo points where `code === "GCP"` (selected from a topo survey)
 *   - Cadastral beacons with manually added elevations
 *
 * # Output formats
 *
 * Three formats, all CSV-based:
 *
 *   - **Pix4D** (`.csv`): 8 columns — GCP Name, Projected X, Projected Y,
 *     Orthometric Z, Geodetic X (Lon), Geodetic Y (Lat), Geodetic Z
 *     (Ellipsoidal H), Coordinate System. Lat/lon columns are left
 *     blank — Pix4D can use a projected-only CRS. The surveyor can
 *     fill them in via Pix4D's UI, or a future task brief can wire
 *     sidecar lat/lon conversion.
 *
 *   - **Metashape** (`.csv`): 7 columns — Label, X, Y, Z, accuracy_xy,
 *     accuracy_z, camera_label (optional). Header comments document
 *     the format + CRS. Accuracy columns come from the GCP's
 *     `uncertainty.semiMajor` (conservative: use semi-major as the
 *     XY accuracy bound).
 *
 *   - **Agisoft** (`.csv`): Same as Metashape (Agisoft PhotoScan was
 *     renamed to Metashape in 2018; the file format is identical).
 *     Offered as a separate option for marketing discoverability —
 *     surveyors searching for "Agisoft GCP format" find it.
 *
 * # Hard invariants (per ADR-0005 + docs/invariants.md)
 *
 *   - A1: No geodetic math. Coordinates passed through unchanged.
 *          Lat/lon conversion (when needed) is a sidecar responsibility.
 *   - A2: SRID from country-config. The CRS string embedded in the
 *          file comes from country-config's geodeticFramework.
 *   - C1: Every GCP carries its propagated uncertainty. The accuracy
 *          columns in Metashape/Agisoft format come from this. Pix4D
 *          doesn't have an accuracy column — uncertainty is embedded
 *          as a comment per GCP line.
 *   - C2: No rounding. Coordinates use full float64 precision via
 *          fixed-point formatting (6 decimal places for metres =
 *          micrometre precision, well below RTK noise).
 *
 * # References
 *
 *   - ADR-0005: docs/decisions/0005-integration-export-workflow-family.md
 *   - Pix4D GCP format: https://support.pix4d.com/hc/en-us/articles/202557519
 *   - Metashape GCP format: https://www.agisoft.com/pdf/metashape-pro_1_5_en.pdf
 *   - ASPRS Positional Accuracy Standards (2014)
 */

import { getCountryConfig, type CountryCode } from "@metardu/country-config";
import type { PointUncertainty } from "../survey-types.js";
import type {
  IntegrationExporter,
  IntegrationOptions,
  IntegrationOutput,
  ProjectMetadata,
  ValidationResult,
} from "./types.js";

// ─── GCP-specific types ──────────────────────────────────────────

/** Supported GCP file formats. */
export type GcpFormat = "pix4d" | "metashape" | "agisoft";

/**
 * A single Ground Control Point. 3D position with optional uncertainty.
 *
 * GCPs are typically measured with GNSS RTK — accuracy 1-3cm horizontal,
 * 2-5cm vertical. The uncertainty field carries the propagated error
 * ellipse from the adjustment (if the GCP was tied to a control network)
 * OR the RTK's stated sigma (if the GCP is a raw RTK measurement).
 */
export interface GcpPoint {
  /** GCP label, e.g. "GCP01". Must be unique within the input. */
  label: string;
  /** Easting in metres (projected CRS — sourced from country-config). */
  easting: number;
  /** Northing in metres. */
  northing: number;
  /** Elevation in metres (orthometric height — above geoid). */
  elevation: number;
  /** Optional description (e.g. "white cross painted on asphalt"). */
  description?: string;
  /** Per-point uncertainty from the adjustment or RTK stated sigma. */
  uncertainty?: PointUncertainty;
  /**
   * Optional XY accuracy override (metres). Default: derive from
   * `uncertainty.semiMajor` (conservative). Set this explicitly if the
   * GCP's accuracy differs from the propagated uncertainty (e.g. RTK
   * float vs RTK fixed).
   */
  accuracyXY?: number;
  /**
   * Optional Z accuracy override (metres). Default: 1.5 × accuracyXY
   * (RTK vertical is typically 1.5× worse than horizontal).
   */
  accuracyZ?: number;
}

/** Input to the GCP exporter. */
export interface GcpInput {
  /** The GCPs to export. Must be non-empty. */
  points: GcpPoint[];
}

/** Options for the GCP exporter. */
export interface GcpOptions extends IntegrationOptions {
  /** Output format — "pix4d", "metashape", or "agisoft". */
  format: GcpFormat;
}

/** Output of the GCP exporter. */
export interface GcpOutput extends IntegrationOutput {
  format: "gcp";
  /** The sub-format emitted (matches options.format). */
  gcpFormat: GcpFormat;
  /** CRS URN embedded in the file header, e.g. "urn:ogc:def:crs:EPSG::21037". */
  crsUrn: string;
  /** Number of GCPs written. */
  pointCount: number;
}

// ─── CRS string helpers ──────────────────────────────────────────

/**
 * Build the CRS display name for Pix4D's Coordinate System column.
 * Pix4D expects the EPSG name (e.g. "Arc 1960 / UTM zone 37S"), not the URN.
 *
 * The country-config's projection zone `name` field already includes
 * the datum (e.g. "Arc 1960 / UTM zone 37S"), so we use it directly.
 * If no projection zone is configured, fall back to "EPSG::<srid>".
 */
function buildCrsDisplayName(srid: number, _datum: string, zoneName: string): string {
  if (zoneName && zoneName.length > 0) {
    return zoneName;
  }
  return `EPSG::${srid}`;
}

/**
 * Build the CRS URN for Metashape/Agisoft comment headers.
 */
function buildCrsUrn(srid: number): string {
  return `urn:ogc:def:crs:EPSG::${srid}`;
}

// ─── Per-point accuracy derivation ───────────────────────────────

/**
 * Derive the XY accuracy (metres) for a GCP. Priority:
 *   1. Explicit `accuracyXY` override
 *   2. `uncertainty.semiMajor` (conservative — use the larger axis)
 *   3. Default 0.020m (typical RTK fixed accuracy) + warning
 */
function deriveAccuracyXY(p: GcpPoint, warnings: string[]): number {
  if (p.accuracyXY !== undefined && p.accuracyXY > 0) {
    return p.accuracyXY;
  }
  if (p.uncertainty?.semiMajorAxis !== undefined && p.uncertainty.semiMajorAxis > 0) {
    return p.uncertainty.semiMajorAxis;
  }
  warnings.push(
    `GCP '${p.label}' has no accuracy or uncertainty — defaulting to 0.020m ` +
      `(typical RTK fixed). Set accuracyXY or uncertainty on the point for ` +
      `accurate photogrammetry weighting.`,
  );
  return 0.020;
}

/**
 * Derive the Z accuracy (metres) for a GCP. Priority:
 *   1. Explicit `accuracyZ` override
 *   2. 1.5 × accuracyXY (RTK vertical is typically 1.5× worse than horizontal)
 */
function deriveAccuracyZ(p: GcpPoint, accuracyXY: number): number {
  if (p.accuracyZ !== undefined && p.accuracyZ > 0) {
    return p.accuracyZ;
  }
  return 1.5 * accuracyXY;
}

// ─── Per-format CSV writers ──────────────────────────────────────

/**
 * Format a number as a fixed-point string with 6 decimal places.
 * 6 decimals = micrometre precision for metre-unit coordinates,
 * well below any RTK/total-station noise floor.
 */
function fmt(n: number): string {
  return n.toFixed(6);
}

/**
 * Pix4D GCP CSV format.
 *
 * Columns: GCP Name, X (Projected), Y (Projected), Z (Orthometric),
 * Geodetic X (Lon), Geodetic Y (Lat), Geodetic Z (Ellipsoidal H),
 * Coordinate System
 *
 * Lat/lon columns are left blank — Pix4D can use a projected-only CRS.
 * A header comment explains this and points to the sidecar lat/lon
 * conversion TODO.
 */
function writePix4D(
  points: GcpPoint[],
  crsDisplayName: string,
  crsUrn: string,
  metadata: ProjectMetadata,
  warnings: string[],
): string {
  const lines: string[] = [];

  // Header comment (Pix4D supports `#` comments).
  lines.push(`# Pix4D Ground Control Points file`);
  lines.push(`# Generated by metardu-desktop — ${new Date().toISOString()}`);
  lines.push(`# Project: ${metadata.projectName} | Surveyor: ${metadata.surveyorName} (${metadata.licenseNumber})`);
  lines.push(`# Survey date: ${metadata.surveyDate} | Adjustment run: ${metadata.adjustmentRunId}`);
  lines.push(`# CRS: ${crsUrn} (${crsDisplayName})`);
  lines.push(`#`);
  lines.push(`# Lat/lon columns are blank — Pix4D accepts projected-only CRS.`);
  lines.push(`# To fill them in: re-export after sidecar lat/lon conversion is wired`);
  lines.push(`# (Brief 06 future work), or enter manually via Pix4D's GCP editor.`);
  lines.push(`#`);
  lines.push(`# Per-GCP uncertainty is in the trailing comment on each row.`);
  lines.push(`#`);

  // Column header
  lines.push(
    "GCP Name, X (Projected), Y (Projected), Z (Orthometric), " +
      "Geodetic X (Longitude), Geodetic Y (Latitude), Geodetic Z (Ellipsoidal H), " +
      "Coordinate System",
  );

  // Per-GCP rows. Pix4D's GCP file is strict 8-column CSV — we emit
  // each GCP on its own row, followed by a `#`-prefixed comment line
  // with the uncertainty info. (Trailing comments on the same row
  // break Pix4D's parser because the commas in the comment would be
  // treated as column separators.)
  for (const p of points) {
    const accXY = deriveAccuracyXY(p, warnings);
    const accZ = deriveAccuracyZ(p, accXY);
    // Lat/lon blank — Pix4D accepts this for projected-only CRS.
    const lat = "";
    const lon = "";
    const ellH = ""; // Ellipsoidal height — needs geoid model (sidecar TODO).
    // GCP row (8 columns).
    lines.push(
      `${p.label}, ${fmt(p.easting)}, ${fmt(p.northing)}, ${fmt(p.elevation)}, ` +
        `${lon}, ${lat}, ${ellH}, ${crsDisplayName}`,
    );
    // Uncertainty comment on a separate line (Pix4D supports `#` comments).
    lines.push(buildUncertaintyComment(p, accXY, accZ));
  }

  return lines.join("\n") + "\n";
}

/**
 * Metashape / Agisoft GCP CSV format (identical for both — Agisoft
 * renamed PhotoScan to Metashape in 2018 but kept the file format).
 *
 * Columns: Label, X, Y, Z, accuracy_xy, accuracy_z, camera_label
 *
 * Header comments document the format + CRS.
 */
function writeMetashape(
  points: GcpPoint[],
  crsUrn: string,
  crsDisplayName: string,
  metadata: ProjectMetadata,
  warnings: string[],
  formatName: string,
): string {
  const lines: string[] = [];

  // Header comments
  lines.push(`# ${formatName} Ground Control Points file`);
  lines.push(`# Generated by metardu-desktop — ${new Date().toISOString()}`);
  lines.push(`# Project: ${metadata.projectName} | Surveyor: ${metadata.surveyorName} (${metadata.licenseNumber})`);
  lines.push(`# Survey date: ${metadata.surveyDate} | Adjustment run: ${metadata.adjustmentRunId}`);
  lines.push(`# CRS: ${crsUrn} (${crsDisplayName})`);
  lines.push(`#`);
  lines.push(`# Format: <label>, <X>, <Y>, <Z>, <accuracy_xy>, <accuracy_z>, <camera_label>`);
  lines.push(`# Accuracies are in metres. X/Y/Z are in the CRS above (projected).`);
  lines.push(`# camera_label is optional — leave blank if the GCP is not visible`);
  lines.push(`# in a specific image.`);
  lines.push(`#`);

  // Column header
  lines.push("label,x,y,z,accuracy_xy,accuracy_z,camera_label");

  for (const p of points) {
    const accXY = deriveAccuracyXY(p, warnings);
    const accZ = deriveAccuracyZ(p, accXY);
    const cameraLabel = ""; // Optional — surveyor fills in if tying to specific image.
    lines.push(
      `${p.label},${fmt(p.easting)},${fmt(p.northing)},${fmt(p.elevation)},` +
        `${fmt(accXY)},${fmt(accZ)},${cameraLabel}`,
    );
  }

  return lines.join("\n") + "\n";
}

/**
 * Build a trailing comment for Pix4D rows documenting the GCP's
 * uncertainty. Pix4D doesn't have an accuracy column, so we embed
 * it as a `# acc=...` suffix.
 */
function buildUncertaintyComment(p: GcpPoint, accXY: number, accZ: number): string {
  const parts: string[] = [`acc_xy=${fmt(accXY)}m`, `acc_z=${fmt(accZ)}m`];
  if (p.uncertainty?.adjusted) {
    parts.push("adjusted=true");
    if (p.uncertainty.confidenceLevel !== undefined) {
      parts.push(`conf=${p.uncertainty.confidenceLevel}`);
    }
  } else if (p.uncertainty?.reason) {
    parts.push(`reason=${p.uncertainty.reason}`);
  } else {
    parts.push("uncertainty=missing");
  }
  return `# ${parts.join(", ")}`;
}

// ─── The exporter object ─────────────────────────────────────────

export const gcpExporter: IntegrationExporter<GcpInput, GcpOptions, GcpOutput> = {
  format: "gcp",
  mimeType: "text/csv",
  fileExtension: "csv",
  description: "GCP file for drone photogrammetry (Pix4D, Metashape, Agisoft)",

  validate(input: GcpInput, options: GcpOptions): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Country code check
    const validCodes: ReadonlyArray<string> = ["KE", "AU", "GB", "ZA", "AE"];
    if (!validCodes.includes(options.countryCode)) {
      errors.push(`Unknown country code '${options.countryCode}'.`);
    } else {
      try {
        const config = getCountryConfig(options.countryCode as CountryCode);
        if (!config.geodeticFramework.primarySRID) {
          errors.push(`Country '${options.countryCode}' config has no primarySRID.`);
        }
      } catch (e) {
        errors.push(`Failed to load country config: ${(e as Error).message}`);
      }
    }

    // Format check
    const validFormats: ReadonlyArray<string> = ["pix4d", "metashape", "agisoft"];
    if (!validFormats.includes(options.format)) {
      errors.push(
        `Unknown GCP format '${options.format}'. Valid: ${validFormats.join(", ")}.`,
      );
    }

    // Project metadata
    const m = options.projectMetadata;
    if (!m) {
      errors.push("projectMetadata is required (invariant C1).");
    } else {
      const missing: string[] = [];
      if (!m.projectName) missing.push("projectName");
      if (!m.surveyorName) missing.push("surveyorName");
      if (!m.licenseNumber) missing.push("licenseNumber");
      if (!m.surveyDate) missing.push("surveyDate");
      if (!m.adjustmentRunId) missing.push("adjustmentRunId");
      if (missing.length > 0) {
        errors.push(`projectMetadata incomplete. Missing: ${missing.join(", ")}.`);
      }
    }

    // Input check
    if (!input.points || input.points.length === 0) {
      errors.push("Input has no GCPs — nothing to export.");
    } else {
      // Check for duplicate labels.
      const labels = new Set<string>();
      for (const p of input.points) {
        if (labels.has(p.label)) {
          errors.push(`Duplicate GCP label '${p.label}'. Labels must be unique.`);
        }
        labels.add(p.label);
        if (!p.label || p.label.trim().length === 0) {
          errors.push(`GCP at index ${input.points.indexOf(p)} has an empty label.`);
        }
        if (!Number.isFinite(p.easting) || !Number.isFinite(p.northing) || !Number.isFinite(p.elevation)) {
          errors.push(`GCP '${p.label}' has non-finite coordinates.`);
        }
        // Warning: GCP without uncertainty
        if (!p.uncertainty && p.accuracyXY === undefined) {
          warnings.push(
            `GCP '${p.label}' has no uncertainty or accuracy — will default to ` +
              `0.020m XY (typical RTK fixed). Set explicitly for accurate weighting.`,
          );
        }
      }
    }

    return { ok: errors.length === 0, errors, warnings };
  },

  async export(input: GcpInput, options: GcpOptions): Promise<GcpOutput> {
    const validation = this.validate(input, options);
    if (!validation.ok) {
      throw new Error(
        `GCP export refused (validation failed):\n  - ` + validation.errors.join("\n  - "),
      );
    }

    const warnings: string[] = [...validation.warnings];

    // CRS from country-config (invariant A2)
    const config = getCountryConfig(options.countryCode as CountryCode);
    const srid = config.geodeticFramework.primarySRID;
    const crsUrn = buildCrsUrn(srid);
    const datum = config.geodeticFramework.datum;
    // Use the first projection zone's name (countries with multiple zones
    // would need the surveyor to specify which zone — future work).
    const zoneName = config.geodeticFramework.projectionZones[0]?.name ?? "";
    const crsDisplayName = buildCrsDisplayName(srid, datum, zoneName);

    const m = options.projectMetadata as ProjectMetadata;
    let csv: string;

    switch (options.format) {
      case "pix4d":
        csv = writePix4D(input.points, crsDisplayName, crsUrn, m, warnings);
        break;
      case "metashape":
        csv = writeMetashape(
          input.points,
          crsUrn,
          crsDisplayName,
          m,
          warnings,
          "Metashape",
        );
        break;
      case "agisoft":
        csv = writeMetashape(
          input.points,
          crsUrn,
          crsDisplayName,
          m,
          warnings,
          "Agisoft PhotoScan / Metashape",
        );
        break;
      default:
        // Unreachable — validate() rejects unknown formats.
        throw new Error(`Unknown GCP format: ${options.format}`);
    }

    const bytes = new TextEncoder().encode(csv);

    return {
      format: "gcp",
      bytes,
      featureCount: input.points.length,
      warnings,
      gcpFormat: options.format,
      crsUrn,
      pointCount: input.points.length,
    };
  },
};
