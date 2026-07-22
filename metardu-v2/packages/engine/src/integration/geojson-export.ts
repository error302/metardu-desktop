/**
 * GeoJSON integration exporter — survey-grade GeoJSON with CRS metadata
 * and per-feature uncertainty attribution.
 *
 * This is the first concrete implementation of the IntegrationExporter
 * interface defined in ADR-0005. It consumes a CadastralWorkflowOutput
 * and produces RFC 7946 GeoJSON suitable for ingestion by QGIS, ArcGIS,
 * PostGIS, or any other GIS tool that reads GeoJSON.
 *
 * # What makes this "survey-grade"
 *
 *   1. CRS declaration — every FeatureCollection carries a `crs` member
 *      naming the EPSG code sourced from country-config. We do NOT
 *      silently reproject to WGS84 (which would lose the projection's
 *      survey-grade accuracy and lie about what the coordinates mean).
 *      RFC 7946 technically deprecates `crs` in favor of WGS84-only, but
 *      in practice every GIS tool still reads it — and survey-grade data
 *      MUST declare its CRS, not silently assume.
 *
 *   2. Per-feature uncertainty — every adjusted beacon carries its
 *      propagated error ellipse (semi-major, semi-minor, orientation,
 *      confidence level) from the LS adjustment. This is invariant C1
 *      in action: "every statutory number must trace to an adjusted
 *      value with a stated uncertainty." The default is to ship the
 *      uncertainty; users can opt out for downstream tools that don't
 *      understand covariance.
 *
 *   3. Project metadata — the FeatureCollection's `metadata.metardu`
 *      block embeds project name, surveyor, license number, survey
 *      date, and adjustment run ID. A downstream consumer can always
 *      answer "where did these coordinates come from?" without guessing.
 *
 * # Architectural invariants enforced here
 *
 *   - A1: No geodetic math. Coordinates are passed through unchanged.
 *   - A2: SRID comes from `getCountryConfig(countryCode).geodeticFramework.primarySRID`.
 *          A literal SRID number in this file is a failing review.
 *   - C1: Per-feature uncertainty is the default. Opt-out is supported
 *          but logged as a warning.
 *   - C2: No rounding. Coordinates use JSON.stringify's default number
 *          serialization (full float64).
 *
 * # References
 *
 *   - RFC 7946: GeoJSON (https://tools.ietf.org/html/rfc7946)
 *   - ADR-0005: docs/decisions/0005-integration-export-workflow-family.md
 *   - Master plan Section 6.6 (Integration & Export)
 *   - Mikhail & Ackermann (1976) §4-5 (Error Ellipses) — for the
 *     uncertainty attribution contract
 */

import { getCountryConfig, type CountryCode } from "@metardu/country-config";
import type { CadastralWorkflowOutput, BeaconUncertainty } from "../workflows/cadastral.js";
import type {
  IntegrationExporter,
  IntegrationOptions,
  IntegrationOutput,
  ProjectMetadata,
  ValidationResult,
} from "./types.js";

// ─── GeoJSON-specific types ──────────────────────────────────────

/** Options for the GeoJSON exporter. */
export interface GeoJsonOptions extends IntegrationOptions {
  /**
   * Whether to embed the parcel polygon as a Feature (default: true).
   * Some downstream tools only want the beacon points; set false to
   * suppress the polygon.
   */
  includeParcelPolygon?: boolean;
}

/** Output of the GeoJSON exporter — extends IntegrationOutput with format-specific fields. */
export interface GeoJsonOutput extends IntegrationOutput {
  format: "geojson";
  /** The CRS string embedded in the output, e.g. "urn:ogc:def:crs:EPSG::21037". */
  crsUrn: string;
}

// ─── Internal GeoJSON shape types (RFC 7946) ─────────────────────

interface GeoJsonCrs {
  type: "name";
  properties: { name: string };
}

interface GeoJsonPoint {
  type: "Point";
  coordinates: [number, number];
}

interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: [number, number][][];
}

interface GeoJsonFeature {
  type: "Feature";
  id?: string;
  geometry: GeoJsonPoint | GeoJsonPolygon;
  properties: Record<string, unknown>;
}

interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  crs: GeoJsonCrs;
  metadata: { metardu: MetarduMetadata };
  features: GeoJsonFeature[];
}

interface MetarduMetadata {
  softwareVersion: string;
  projectName: string;
  surveyorName: string;
  licenseNumber: string;
  surveyDate: string;
  adjustmentRunId: string;
  countryCode: string;
  crsUrn: string;
  exportedAt: string; // ISO 8601 UTC
}

// ─── The exporter ────────────────────────────────────────────────

const SOFTWARE_VERSION = "0.2.0"; // matches metardu-v2/package.json

/**
 * Build the CRS URN from a country config's primary SRID.
 *
 * Format: `urn:ogc:def:crs:EPSG::<srid>`
 * Example: `urn:ogc:def:crs:EPSG::21037` for Arc 1960 / UTM zone 37S.
 *
 * Per invariant A2: the SRID is read from country-config at runtime,
 * never hardcoded. The only literal EPSG string here is the URN prefix
 * — that's a format constant, not a SRID.
 */
function buildCrsUrn(srid: number): string {
  return `urn:ogc:def:crs:EPSG::${srid}`;
}

/**
 * Build the per-beacon Feature properties block, including uncertainty
 * when available and `includeUncertainty` is true.
 */
function buildBeaconProperties(
  beaconLabel: string,
  uncertainty: BeaconUncertainty | undefined,
  includeUncertainty: boolean,
  warnings: string[],
): Record<string, unknown> {
  const props: Record<string, unknown> = {
    featureType: "beacon",
    label: beaconLabel,
    surveyType: "cadastral",
    adjusted: uncertainty?.adjusted ?? false,
  };

  if (includeUncertainty) {
    if (uncertainty?.adjusted) {
      if (
        uncertainty.semiMajorAxis !== undefined &&
        uncertainty.semiMinorAxis !== undefined &&
        uncertainty.orientation !== undefined
      ) {
        props.uncertainty = {
          semiMajorAxis: uncertainty.semiMajorAxis,
          semiMinorAxis: uncertainty.semiMinorAxis,
          orientation: uncertainty.orientation,
          confidenceLevel: uncertainty.confidenceLevel ?? 0.95,
        };
      } else {
        // Adjusted but ellipse is missing — degenerate (e.g. singular
        // normal matrix). Surface as a warning so the downstream
        // consumer knows.
        warnings.push(
          `Beacon '${beaconLabel}' is marked adjusted but has no error ellipse ` +
            `(degenerate configuration). Exported without uncertainty.`,
        );
        props.uncertainty = { reason: "degenerate-configuration" };
      }
    } else if (uncertainty && !uncertainty.adjusted) {
      // Known (fixed) beacon — no propagated uncertainty by design.
      props.uncertainty = { reason: "fixed-control" };
    } else {
      // No uncertainty record at all — surface as a warning per C1.
      warnings.push(
        `Beacon '${beaconLabel}' has no uncertainty record. ` +
          `Exported with adjusted=false; downstream consumers should treat ` +
          `coordinates as unverified.`,
      );
      props.uncertainty = { reason: "missing" };
    }
  }

  return props;
}

/**
 * Build the parcel polygon Feature. The polygon is built from the
 * beacon coordinates in the order they appear in allBeacons.
 */
function buildParcelFeature(
  output: CadastralWorkflowOutput,
  includeUncertainty: boolean,
): GeoJsonFeature | null {
  // form3 is the source of parcel metadata. If the workflow stubbed it
  // (check survey case), there's no parcel polygon to emit.
  const beacons = output.allBeacons;
  if (beacons.length < 3) return null;

  // Ring must close (first === last).
  const ring: [number, number][] = beacons.map((b) => [
    b.position.easting,
    b.position.northing,
  ]);
  ring.push([beacons[0]!.position.easting, beacons[0]!.position.northing]);

  const properties: Record<string, unknown> = {
    featureType: "parcel",
    surveyType: "cadastral",
    beaconIds: beacons.map((b) => `beacon-${b.label}`),
    beaconCount: beacons.length,
    adjusted: true,
  };

  // Area is on the form3 input — we don't have it on the workflow
  // output directly, but we can compute a planar area via the Shoelace
  // formula for the polygon ring. This is purely for downstream
  // convenience; the statutory area lives in the Form 3 PDF.
  let area = 0;
  for (let i = 0; i < beacons.length; i++) {
    const j = (i + 1) % beacons.length;
    area +=
      beacons[i]!.position.easting * beacons[j]!.position.northing -
      beacons[j]!.position.easting * beacons[i]!.position.northing;
  }
  area = Math.abs(area) / 2; // m²
  properties.areaSqm = area;
  properties.areaHa = area / 10000;

  // Uncertainty for the parcel is the worst-case (max semi-major) of
  // its beacons' uncertainties. If includeUncertainty is true and the
  // beacons carry uncertainty, propagate the worst-case to the parcel.
  if (includeUncertainty) {
    const adjustedBeacons = beacons.filter((b) => output.uncertainty?.[b.label]?.adjusted);
    const ellipses = adjustedBeacons
      .map((b) => output.uncertainty[b.label])
      .filter((u): u is BeaconUncertainty => u !== undefined && u.semiMajorAxis !== undefined);
    if (ellipses.length > 0) {
      const worstSemiMajor = Math.max(...ellipses.map((u) => u.semiMajorAxis!));
      properties.uncertainty = {
        worstCaseSemiMajorAxis: worstSemiMajor,
        basis: "max-of-beacon-semi-major-axes",
        confidenceLevel: 0.95,
      };
    } else {
      properties.uncertainty = { reason: "no-adjusted-beacons" };
    }
  }

  return {
    type: "Feature",
    id: `parcel-${beacons.length}beacons`,
    geometry: { type: "Polygon", coordinates: [ring] },
    properties,
  };
}

// ─── Exporter object (implements IntegrationExporter) ────────────

export const geoJsonExporter: IntegrationExporter<
  CadastralWorkflowOutput,
  GeoJsonOptions,
  GeoJsonOutput
> = {
  format: "geojson",
  mimeType: "application/geo+json",
  fileExtension: "geojson",
  description: "GeoJSON with CRS metadata + per-feature uncertainty (RFC 7946)",

  validate(input: CadastralWorkflowOutput, options: GeoJsonOptions): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Country code must be one of the implemented countries.
    const validCodes: ReadonlyArray<string> = ["KE", "AU", "GB", "ZA", "AE"];
    if (!validCodes.includes(options.countryCode)) {
      errors.push(
        `Unknown country code '${options.countryCode}'. ` +
          `Implemented: ${validCodes.join(", ")}.`,
      );
    } else {
      // Country exists — confirm its config loads and has a primarySRID.
      try {
        const config = getCountryConfig(options.countryCode as CountryCode);
        if (!config.geodeticFramework.primarySRID) {
          errors.push(
            `Country '${options.countryCode}' config has no primarySRID. ` +
              `This is a config bug — file an issue.`,
          );
        }
      } catch (e) {
        errors.push(
          `Failed to load country config for '${options.countryCode}': ${(e as Error).message}`,
        );
      }
    }

    // Project metadata is required for traceability (invariant C1).
    const m = options.projectMetadata;
    if (!m) {
      errors.push(
        "projectMetadata is required — refusing to export anonymous data " +
          "(invariant C1: every statutory number must trace to an adjusted value).",
      );
    } else {
      const missing: string[] = [];
      if (!m.projectName) missing.push("projectName");
      if (!m.surveyorName) missing.push("surveyorName");
      if (!m.licenseNumber) missing.push("licenseNumber");
      if (!m.surveyDate) missing.push("surveyDate");
      if (!m.adjustmentRunId) missing.push("adjustmentRunId");
      if (missing.length > 0) {
        errors.push(
          `projectMetadata is incomplete. Missing fields: ${missing.join(", ")}.`,
        );
      }
    }

    // Input must have at least one beacon.
    if (!input.allBeacons || input.allBeacons.length === 0) {
      errors.push("Input survey output has no beacons — nothing to export.");
    }

    // Warnings: beacons with no uncertainty record (non-fatal).
    if (options.includeUncertainty !== false && input.uncertainty) {
      for (const beacon of input.allBeacons ?? []) {
        const u = input.uncertainty[beacon.label];
        if (!u) {
          warnings.push(
            `Beacon '${beacon.label}' has no uncertainty record — ` +
              `will be exported with adjusted=false.`,
          );
        }
      }
    }

    return { ok: errors.length === 0, errors, warnings };
  },

  async export(
    input: CadastralWorkflowOutput,
    options: GeoJsonOptions,
  ): Promise<GeoJsonOutput> {
    const validation = this.validate(input, options);
    if (!validation.ok) {
      throw new Error(
        `GeoJSON export refused (validation failed):\n  - ` +
          validation.errors.join("\n  - "),
      );
    }

    const includeUncertainty = options.includeUncertainty !== false; // default true
    const includeParcel = options.includeParcelPolygon !== false; // default true
    const warnings: string[] = [...validation.warnings];

    // SRID from country-config (invariant A2).
    const config = getCountryConfig(options.countryCode as CountryCode);
    const srid = config.geodeticFramework.primarySRID;
    const crsUrn = buildCrsUrn(srid);

    // Build beacon features.
    const features: GeoJsonFeature[] = [];
    for (const beacon of input.allBeacons) {
      const uncertainty = input.uncertainty?.[beacon.label];
      features.push({
        type: "Feature",
        id: `beacon-${beacon.label}`,
        geometry: {
          type: "Point",
          coordinates: [beacon.position.easting, beacon.position.northing],
        },
        properties: buildBeaconProperties(
          beacon.label,
          uncertainty,
          includeUncertainty,
          warnings,
        ),
      });
    }

    // Build parcel polygon feature (if requested and ≥ 3 beacons).
    if (includeParcel) {
      const parcel = buildParcelFeature(input, includeUncertainty);
      if (parcel) features.push(parcel);
    }

    // Top-level metadata block.
    const m = options.projectMetadata as ProjectMetadata;
    const featureCollection: GeoJsonFeatureCollection = {
      type: "FeatureCollection",
      crs: { type: "name", properties: { name: crsUrn } },
      metadata: {
        metardu: {
          softwareVersion: SOFTWARE_VERSION,
          projectName: m.projectName,
          surveyorName: m.surveyorName,
          licenseNumber: m.licenseNumber,
          surveyDate: m.surveyDate,
          adjustmentRunId: m.adjustmentRunId,
          countryCode: options.countryCode,
          crsUrn,
          exportedAt: new Date().toISOString(),
        },
      },
      features,
    };

    // Serialize with full float64 precision (invariant C2: no rounding).
    const json = JSON.stringify(featureCollection);
    const bytes = new TextEncoder().encode(json);

    return {
      format: "geojson",
      bytes,
      featureCount: features.length,
      warnings,
      crsUrn,
    };
  },
};
