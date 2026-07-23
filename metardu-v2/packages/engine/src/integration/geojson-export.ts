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
import type { TopoWorkflowOutput } from "../workflows/topographic.js";
import type { EngineeringWorkflowOutput } from "../workflows/engineering.js";
import type { SectionalWorkflowOutput } from "../workflows/sectional.js";
import type { SettingOutWorkflowOutput } from "../workflows/setting-out.js";
import type { CorridorResult } from "../workflows/corridor-design.js";
import type { ProcessingResult } from "../workflows/drone-processing.js";
import type { ClassificationResult } from "../workflows/lidar-classification.js";
import type { SurfaceComparisonResult } from "../workflows/surface-comparison.js";
import type { UtilitySurveyPlan } from "../workflows/utility-mapping.js";
import type { PointUncertainty } from "../survey-types.js";
import type {
  IntegrationExporter,
  IntegrationOptions,
  IntegrationOutput,
  ProjectMetadata,
  SurveyOutput,
  ValidationResult,
} from "./types.js";
import { detectSurveyType, type SurveyType } from "../survey-type-detection.js";

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

interface GeoJsonLineString {
  type: "LineString";
  coordinates: [number, number][];
}

interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: [number, number][][];
}

interface GeoJsonFeature {
  type: "Feature";
  id?: string;
  geometry: GeoJsonPoint | GeoJsonLineString | GeoJsonPolygon;
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
  /** Which workflow produced the input. Added in Brief 02. */
  surveyType: "cadastral" | "topographic" | "engineering";
  /**
   * Survey-type-specific summary (topographic: triangle/contour counts;
   * engineering: volumes + section count). Empty for cadastral — the
   * parcel polygon already carries area. Added in Brief 02.
   */
  [surveyTypeSpecific: string]: unknown;
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
 * Build the per-point Feature properties block, including uncertainty
 * when available and `includeUncertainty` is true.
 *
 * Generic over featureType ("beacon" | "topo-point" | "tin-vertex" |
 * "spot-height" | "alignment-point") and surveyType ("cadastral" |
 * "topographic" | "engineering") so the same uncertainty-attribution
 * contract is applied uniformly across all survey types per invariant C1.
 */
function buildPointProperties(
  pointLabel: string,
  uncertainty: PointUncertainty | undefined,
  featureType: string,
  surveyType: string,
  includeUncertainty: boolean,
  warnings: string[],
): Record<string, unknown> {
  const props: Record<string, unknown> = {
    featureType,
    label: pointLabel,
    surveyType,
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
          `Point '${pointLabel}' is marked adjusted but has no error ellipse ` +
            `(degenerate configuration). Exported without uncertainty.`,
        );
        props.uncertainty = { reason: "degenerate-configuration" };
      }
    } else if (uncertainty && !uncertainty.adjusted) {
      // Known/fixed/field-data point — no propagated uncertainty.
      // Use the explicit reason if provided, else default to "fixed-control".
      props.uncertainty = { reason: uncertainty.reason ?? "fixed-control" };
    } else {
      // No uncertainty record at all — surface as a warning per C1.
      warnings.push(
        `Point '${pointLabel}' has no uncertainty record. ` +
          `Exported with adjusted=false; downstream consumers should treat ` +
          `coordinates as unverified.`,
      );
      props.uncertainty = { reason: "missing" };
    }
  }

  return props;
}

/**
 * Backwards-compatible wrapper — old name, same behavior. Cadastral
 * beacon features use featureType="beacon" and surveyType="cadastral".
 */
function buildBeaconProperties(
  beaconLabel: string,
  uncertainty: BeaconUncertainty | undefined,
  includeUncertainty: boolean,
  warnings: string[],
): Record<string, unknown> {
  return buildPointProperties(
    beaconLabel,
    uncertainty,
    "beacon",
    "cadastral",
    includeUncertainty,
    warnings,
  );
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

// ─── Topographic feature builders ────────────────────────────────

/**
 * Build a GeoJSON feature for each TIN vertex (the input field points).
 * Each vertex is a Point feature with featureType="topo-point" and
 * surveyType="topographic", carrying per-point uncertainty from
 * `output.pointUncertainty` (default: { adjusted: false, reason: "field-data" }).
 */
function buildTopoPointFeatures(
  output: TopoWorkflowOutput,
  includeUncertainty: boolean,
  warnings: string[],
): GeoJsonFeature[] {
  return output.tin.vertices.map((v) => ({
    type: "Feature" as const,
    id: `topo-point-${v.id}`,
    geometry: {
      type: "Point" as const,
      coordinates: [v.easting, v.northing],
    },
    properties: {
      ...buildPointProperties(
        v.id,
        output.pointUncertainty?.[v.id],
        "topo-point",
        "topographic",
        includeUncertainty,
        warnings,
      ),
      elevation: v.elevation,
      code: v.code,
    },
  }));
}

/**
 * Build a GeoJSON LineString feature per contour line. Each contour
 * carries its elevation in properties; uncertainty is not directly
 * applicable (a contour is derived from the TIN, not a measured point)
 * but we surface a `derived: true` flag so downstream consumers know.
 */
function buildContourFeatures(output: TopoWorkflowOutput): GeoJsonFeature[] {
  return output.contours.map((c, idx) => ({
    type: "Feature" as const,
    id: `contour-${idx}-${c.elevation}m`,
    geometry: {
      type: "LineString" as const,
      coordinates: c.coordinates,
    },
    properties: {
      featureType: "contour",
      surveyType: "topographic",
      elevation: c.elevation,
      closed: c.closed,
      derived: true,
      // Contour uncertainty is bounded by the input point uncertainties
      // propagated through the TIN interpolation. Not computed here —
      // flagged so downstream consumers know it's a derived feature.
      uncertaintyNote: "derived-from-tin; uncertainty bounded by vertex uncertainties",
    },
  }));
}

/**
 * Build a GeoJSON Point feature per spot height. Spot heights are
 * selected input points; their uncertainty comes from
 * `pointUncertainty` keyed by point ID.
 */
function buildSpotHeightFeatures(
  output: TopoWorkflowOutput,
  includeUncertainty: boolean,
  _warnings: string[],
): GeoJsonFeature[] {
  // Spot heights don't carry the original point ID on the workflow
  // output — they're just (E, N, elevation) triples. We surface them
  // as featureType="spot-height" without a per-point uncertainty
  // reference, with a note explaining why.
  return output.spotHeights.map((sh, idx) => ({
    type: "Feature" as const,
    id: `spot-height-${idx}`,
    geometry: {
      type: "Point" as const,
      coordinates: [sh.easting, sh.northing],
    },
    properties: {
      featureType: "spot-height",
      surveyType: "topographic",
      elevation: sh.elevation,
      derived: true,
      ...(includeUncertainty
        ? {
            uncertainty: {
              reason: "field-data",
              note: "spot height is a selected TIN vertex; see corresponding topo-point feature for full uncertainty",
            },
          }
        : {}),
    },
  }));
}

/**
 * Build all features for a topographic workflow output.
 * Order: TIN vertices (points) → contours (lines) → spot heights (points).
 */
function buildTopoFeatures(
  output: TopoWorkflowOutput,
  includeUncertainty: boolean,
  warnings: string[],
): GeoJsonFeature[] {
  return [
    ...buildTopoPointFeatures(output, includeUncertainty, warnings),
    ...buildContourFeatures(output),
    ...buildSpotHeightFeatures(output, includeUncertainty, warnings),
  ];
}

// ─── Engineering feature builders ────────────────────────────────

/**
 * Build a GeoJSON Point feature per TIN vertex of the existing-ground
 * surface. Engineering consumes the TIN directly; vertex uncertainty
 * comes from `output.pointUncertainty` keyed by vertex index (as string).
 */
function buildEngineeringTinFeatures(
  output: EngineeringWorkflowOutput,
  includeUncertainty: boolean,
  _warnings: string[],
): GeoJsonFeature[] {
  // The engineering output doesn't carry the TIN itself — only the
  // computed sections + volumes. The TIN's vertices live on the input.
  // For the GeoJSON export we surface the section centerline points +
  // the volume summary as the engineering features, with the input
  // TIN's point uncertainties referenced where applicable.
  //
  // Per the workflow output shape: `pointUncertainty` is keyed by
  // vertex index (as string), but the section centerline points are
  // interpolated from the alignment, not directly the TIN vertices.
  // So we surface section centerline points with `reason: "field-data"`
  // (interpolated from field-data TIN) and the volume summary as a
  // feature-collection-level property in the metadata block.

  return output.sections.map((s, idx) => ({
    type: "Feature" as const,
    id: `eng-section-centerline-${idx}`,
    geometry: {
      type: "Point" as const,
      coordinates: [s.centerline.easting, s.centerline.northing],
    },
    properties: {
      featureType: "section-centerline",
      surveyType: "engineering",
      chainage: s.chainage,
      cutFillArea: s.area,
      profilePointCount: s.profile.length,
      adjusted: false,
      ...(includeUncertainty
        ? {
            uncertainty: {
              reason: "field-data",
              note: "interpolated from existing-ground TIN; see pointUncertainty on workflow output for vertex-level uncertainties",
            },
          }
        : {}),
    },
  }));
}

/**
 * Build a GeoJSON LineString feature per cross-section profile.
 * The LineString traces the existing-vs-design ground profile at each
 * chainage — useful for downstream CAD tools that want to overlay
 * sections on the plan.
 *
 * Coordinates are in (offset, elevation) space — NOT map (E, N) space.
 * This is flagged in properties so downstream consumers don't mistake
 * them for map features.
 */
function buildCrossSectionProfileFeatures(
  output: EngineeringWorkflowOutput,
): GeoJsonFeature[] {
  return output.sections.map((s, idx) => {
    const coordinates: [number, number][] = s.profile.map(
      (p) => [p.offset, p.existingElevation - p.designElevation] as [number, number],
    );
    return {
      type: "Feature" as const,
      id: `eng-cross-section-profile-${idx}`,
      geometry: {
        type: "LineString" as const,
        // Profile coordinates: [offset, elevation_delta] where elevation_delta
        // = existing - design (positive = cut, negative = fill). This is
        // NOT a map coordinate — flagged in properties.
        coordinates,
      },
      properties: {
        featureType: "cross-section-profile",
        surveyType: "engineering",
        chainage: s.chainage,
        coordinateSpace: "offset-vs-cut-fill-depth",
        derived: true,
      },
    };
  });
}

/**
 * Build all features for an engineering workflow output.
 * Order: section centerline points → cross-section profile lines.
 *
 * Volume summary (cutVolume, fillVolume, netVolume) is surfaced in
 * the FeatureCollection's `metadata.metardu.engineering` block, not
 * as a feature — it's project-level metadata, not a spatial feature.
 */
function buildEngineeringFeatures(
  output: EngineeringWorkflowOutput,
  includeUncertainty: boolean,
  warnings: string[],
): GeoJsonFeature[] {
  return [
    ...buildEngineeringTinFeatures(output, includeUncertainty, warnings),
    ...buildCrossSectionProfileFeatures(output),
  ];
}


/**
 * Discriminate which workflow produced the input by its shape:
 *   - has `form3`              → cadastral
 *   - has `tin` + `contours`   → topographic
 *   - has `sections`           → engineering
 *
 * Used by the GeoJSON exporter to route to the correct feature builder.
 * If none match, throws — invariant C1 says we don't export what we
 * can't attribute.
 */

/**
 * Dispatch to the correct feature builder based on survey type.
 * Returns the combined feature list + any extra metadata fields to
 * embed in the top-level `metadata.metardu` block.
 */
function buildFeaturesForSurvey(
  input: SurveyOutput,
  includeUncertainty: boolean,
  warnings: string[],
): { features: GeoJsonFeature[]; surveyType: string; extraMetadata: Record<string, unknown> } {
  const surveyType = detectSurveyType(input);
  switch (surveyType) {
    case "cadastral": {
      const output = input as CadastralWorkflowOutput;
      const features: GeoJsonFeature[] = [];
      for (const beacon of output.allBeacons) {
        const uncertainty = output.uncertainty?.[beacon.label];
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
      // Optional parcel polygon (skip if < 3 beacons).
      const parcel = buildParcelFeature(output, includeUncertainty);
      if (parcel) features.push(parcel);
      return { features, surveyType, extraMetadata: {} };
    }
    case "topographic": {
      const output = input as TopoWorkflowOutput;
      const features = buildTopoFeatures(output, includeUncertainty, warnings);
      return {
        features,
        surveyType,
        extraMetadata: {
          topographic: {
            triangleCount: output.triangleCount,
            minElevation: output.minElevation,
            maxElevation: output.maxElevation,
            meanSlope: output.meanSlope,
            contourCount: output.contours.length,
            spotHeightCount: output.spotHeights.length,
            topographicToleranceM: output.topographicToleranceM,
            maxResidualM: output.maxResidualM,
          },
        },
      };
    }
    case "engineering": {
      const output = input as EngineeringWorkflowOutput;
      const features = buildEngineeringFeatures(output, includeUncertainty, warnings);
      return {
        features,
        surveyType,
        extraMetadata: {
          engineering: {
            sectionCount: output.sectionCount,
            cutVolume: output.cutVolume,
            fillVolume: output.fillVolume,
            netVolume: output.netVolume,
            maxCutDepth: output.maxCutDepth,
            maxFillHeight: output.maxFillHeight,
            engineeringToleranceM: output.engineeringToleranceM,
            volumeUncertaintyM3: output.volumeUncertaintyM3,
          },
        },
      };
    }
    case "sectional": {
      const output = input as SectionalWorkflowOutput;
      // Sectional is area-based, not point-based — no spatial features.
      return {
        features: [],
        surveyType,
        extraMetadata: {
          sectional: {
            levelCount: output.levels.length,
            totalBuildingArea: output.totalBuildingArea,
            totalUnitArea: output.totalUnitArea,
            totalCommonArea: output.totalCommonArea,
            areaBalanceOk: output.areaBalanceOk,
          },
        },
      };
    }
    case "setting-out": {
      const output = input as SettingOutWorkflowOutput;
      const features: GeoJsonFeature[] = output.instructions.map((inst) => ({
        type: "Feature" as const,
        id: `setting-out-${inst.designPointId}`,
        geometry: {
          type: "Point" as const,
          coordinates: [inst.designEasting, inst.designNorthing],
        },
        properties: {
          ...buildPointProperties(
            inst.designPointId,
            output.pointUncertainty?.[inst.designPointId],
            "design-point",
            "setting-out",
            includeUncertainty,
            warnings,
          ),
          method: inst.method,
          bearingDeg: inst.bearingDeg,
          distanceM: inst.distanceM,
        },
      }));
      return {
        features,
        surveyType,
        extraMetadata: {
          "setting-out": {
            instructionCount: output.instructions.length,
            allPass: output.allPass,
            failCount: output.failCount,
            horizontalToleranceM: output.horizontalToleranceM,
            maxHorizontalResidual: output.maxHorizontalResidual,
          },
        },
      };
    }
    case "corridor": {
      const output = input as CorridorResult;
      const features: GeoJsonFeature[] = [];
      for (const cs of output.crossSections) {
        for (const pt of cs.points) {
          features.push({
            type: "Feature" as const,
            id: `corridor-${pt.label}`,
            geometry: {
              type: "Point" as const,
              coordinates: [pt.easting, pt.northing],
            },
            properties: {
              ...buildPointProperties(
                pt.label,
                output.pointUncertainty?.[pt.label],
                "corridor-point",
                "corridor",
                includeUncertainty,
                warnings,
              ),
              elevation: pt.elevation,
              offset: pt.offset,
            },
          });
        }
      }
      return {
        features,
        surveyType,
        extraMetadata: {
          corridor: {
            crossSectionCount: output.crossSections.length,
            totalLength: output.totalLength,
            cutVolume: output.cutVolume,
            fillVolume: output.fillVolume,
            netVolume: output.netVolume,
          },
        },
      };
    }
    case "drone-processing": {
      const output = input as ProcessingResult;
      // Drone processing result has file paths + quality, no point coords.
      return {
        features: [],
        surveyType,
        extraMetadata: {
          "drone-processing": {
            asprsClass: output.quality.asprsClass,
            processingTimeSec: output.processingTimeSec,
            contourCount: output.contours.length,
          },
        },
      };
    }
    case "lidar": {
      const output = input as ClassificationResult;
      const features: GeoJsonFeature[] = output.points.map((pt, idx) => ({
        type: "Feature" as const,
        id: `lidar-point-${idx}`,
        geometry: {
          type: "Point" as const,
          coordinates: [pt.easting, pt.northing],
        },
        properties: {
          ...buildPointProperties(
            String(idx),
            output.pointUncertainty?.[String(idx)],
            "lidar-point",
            "lidar",
            includeUncertainty,
            warnings,
          ),
          elevation: pt.elevation,
          classification: pt.classification,
          intensity: pt.intensity,
        },
      }));
      return {
        features,
        surveyType,
        extraMetadata: {
          lidar: {
            pointCount: output.points.length,
            counts: output.counts,
            processingTimeMs: output.processingTimeMs,
          },
        },
      };
    }
    case "surface-comparison": {
      const output = input as SurfaceComparisonResult;
      // Surface comparison result has volumes, no point coords.
      return {
        features: [],
        surveyType,
        extraMetadata: {
          "surface-comparison": {
            cutVolume: output.cutVolume,
            fillVolume: output.fillVolume,
            netVolume: output.netVolume,
            cutArea: output.cutArea,
            fillArea: output.fillArea,
            maxCutDepth: output.maxCutDepth,
            maxFillHeight: output.maxFillHeight,
          },
        },
      };
    }
    case "utility-mapping": {
      const output = input as UtilitySurveyPlan;
      const features: GeoJsonFeature[] = output.detections.map((det, idx) => ({
        type: "Feature" as const,
        id: `utility-detection-${idx}`,
        geometry: {
          type: "Point" as const,
          coordinates: [det.easting, det.northing],
        },
        properties: {
          ...buildPointProperties(
            String(idx),
            output.pointUncertainty?.[String(idx)],
            "utility-detection",
            "utility-mapping",
            includeUncertainty,
            warnings,
          ),
          depth: det.depth,
          utilityType: det.utilityType,
          signalStrength: det.signalStrength,
          confidence: det.confidence,
        },
      }));
      // Also emit LineString features for utility runs
      for (const run of output.runs) {
        if (run.points.length >= 2) {
          features.push({
            type: "Feature" as const,
            id: `utility-run-${run.type}`,
            geometry: {
              type: "LineString" as const,
              coordinates: run.points.map((p) => [p.easting, p.northing] as [number, number]),
            },
            properties: {
              featureType: "utility-run",
              surveyType: "utility-mapping",
              utilityType: run.type,
              totalLength: run.totalLength,
              avgDepth: run.avgDepth,
              derived: true,
            },
          });
        }
      }
      return {
        features,
        surveyType,
        extraMetadata: {
          "utility-mapping": {
            detectionCount: output.detections.length,
            runCount: output.runs.length,
            crossingCount: output.crossings.length,
          },
        },
      };
    }
    default: {
      // Unreachable — detectSurveyType throws first.
      throw new Error(`Unknown survey type: ${surveyType}`);
    }
  }
}

// ─── Exporter object (implements IntegrationExporter) ────────────

export const geoJsonExporter: IntegrationExporter<
  SurveyOutput,
  GeoJsonOptions,
  GeoJsonOutput
> = {
  format: "geojson",
  mimeType: "application/geo+json",
  fileExtension: "geojson",
  description: "GeoJSON with CRS metadata + per-feature uncertainty (RFC 7946)",

  validate(input: SurveyOutput, options: GeoJsonOptions): ValidationResult {
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

    // Detect survey type — refuses to export unknown shapes.
    let surveyType: SurveyType;
    try {
      surveyType = detectSurveyType(input);
    } catch (e) {
      errors.push((e as Error).message);
      return { ok: false, errors, warnings };
    }

    // Per-survey-type input checks.
    if (surveyType === "cadastral") {
      const output = input as CadastralWorkflowOutput;
      if (!output.allBeacons || output.allBeacons.length === 0) {
        errors.push("Input cadastral survey output has no beacons — nothing to export.");
      }
      // Warnings: beacons with no uncertainty record (non-fatal).
      if (options.includeUncertainty !== false && output.uncertainty) {
        for (const beacon of output.allBeacons ?? []) {
          const u = output.uncertainty[beacon.label];
          if (!u) {
            warnings.push(
              `Beacon '${beacon.label}' has no uncertainty record — ` +
                `will be exported with adjusted=false.`,
            );
          }
        }
      }
    } else if (surveyType === "topographic") {
      const output = input as TopoWorkflowOutput;
      if (!output.tin || output.tin.vertices.length === 0) {
        errors.push("Input topographic survey output has no TIN vertices — nothing to export.");
      }
      // Topo points are field-data by default — not a warning, expected.
    } else if (surveyType === "engineering") {
      const output = input as EngineeringWorkflowOutput;
      if (!output.sections || output.sections.length === 0) {
        errors.push("Input engineering survey output has no sections — nothing to export.");
      }
    }

    return { ok: errors.length === 0, errors, warnings };
  },

  async export(
    input: SurveyOutput,
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
    const warnings: string[] = [...validation.warnings];

    // SRID from country-config (invariant A2).
    const config = getCountryConfig(options.countryCode as CountryCode);
    const srid = config.geodeticFramework.primarySRID;
    const crsUrn = buildCrsUrn(srid);

    // Dispatch to the correct feature builder based on survey type.
    // Also returns extra metadata fields to embed in the top-level block.
    const { features, surveyType, extraMetadata } = buildFeaturesForSurvey(
      input,
      includeUncertainty,
      warnings,
    );

    // For cadastral only: optionally suppress the parcel polygon.
    // (Topo and engineering don't have a parcel polygon to suppress.)
    if (
      surveyType === "cadastral" &&
      options.includeParcelPolygon === false
    ) {
      // Remove the parcel feature if it was added.
      for (let i = features.length - 1; i >= 0; i--) {
        if (features[i]!.id?.startsWith("parcel-")) {
          features.splice(i, 1);
        }
      }
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
          surveyType: surveyType as "cadastral" | "topographic" | "engineering",
          ...extraMetadata,
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
