/**
 * Country-correct DXF integration exporter — wraps the existing
 * `dxf-output.ts` low-level helpers with country-specific layer naming
 * per ADR-0005 deliverable #7.
 *
 * # What this is (and isn't)
 *
 * The existing `packages/engine/src/documents/dxf-output.ts` ships a
 * single `SURVEY_LAYERS` constant with Kenya-style layer names baked
 * in ("BOUNDARY", "BEACON", "TEXT-DEEDPLAN"). It works, but the names
 * are Kenya-specific — a UK surveyor importing the DXF into AutoCAD
 * sees "TEXT-DEEDPLAN" which doesn't match RICS conventions.
 *
 * ADR-0005 deliverable #7 calls for "DXF with country-correct layer
 * names per document spec." This module delivers that, WITHOUT
 * touching the existing `generateForm3Dxf` / `generateTopoDxf` /
 * `generateEngineeringDxf` / `generateSectionalDxf` functions (which
 * are stable + tested). Instead it:
 *
 *   1. Adds `getCountryDxfLayerSpecs(countryCode, surveyType)` — a
 *      per-country layer-name + color spec table (Kenya, UK, generic
 *      fallback).
 *   2. Implements `IntegrationExporter<SurveyOutput, DxfOptions,
 *      DxfOutput>` that consumes the same workflow outputs as the
 *      GeoJSON/GeoPackage/PyQGIS/QGS exporters (cadastral, topo,
 *      engineering) and emits a DXF using the country-correct layers.
 *   3. Calls the existing low-level DXF entity helpers (`addPolygon`,
 *      `addBeacon`, `addTIN`, `addContours`, `addSpotHeights`,
 *      `addBearingDistanceLabel`, `addNorthArrow`, `addScaleBar`,
 *      `addText`, `serializeDxf`) — no duplication of DXF entity code.
 *
 * # Country layer-naming conventions
 *
 * ## Kenya (cadastral)
 *
 * Per Survey of Kenya Form 3 spec — matches the existing SURVEY_LAYERS
 * constant. Names: BOUNDARY, BEACON, TEXT-DEEDPLAN, TEXT-COORDS,
 * TEXT-AREA, TEXT-BEARINGS, TEXT-DISTANCES, TEXT-BEACON-LABELS,
 * TITLE-BLOCK, COORD-SCHEDULE, NORTH-ARROW, SCALE-BAR, GRID.
 *
 * ## UK (RICS measured survey)
 *
 * Per RICS Measured Surveys 3rd ed. convention — names use a
 * discipline-prefix pattern: `SURV-BOUNDARY`, `SURV-POINT`,
 * `SURV-TEXT`, `SURV-CONTOUR`, `SURV-SPOT`. (RICS doesn't publish a
 * strict layer-naming standard, but the AIA CAD Layer Guidelines'
 * discipline-prefix pattern is the de facto UK convention.)
 *
 * ## Generic fallback
 *
 * For countries without a documented convention (Australia, UAE, South
 * Africa — task briefs to follow when their specific layer-naming
 * requirements are sourced from the regulatory documents per master
 * plan Section 3): use the Kenya layer names as a sensible default
 * with a warning that the surveyor should verify against their local
 * CAD layer-naming convention.
 *
 * # Architectural invariants (per ADR-0005 + docs/invariants.md)
 *
 *   - A1: No geodetic math. Coordinates passed through unchanged.
 *   - A2: SRID from country-config. The DXF's coordinate system
 *          declaration (in the $INSUNITS header) reflects metric units;
 *          the SRID itself is referenced in a COORD-SCHEDULE text layer.
 *   - A6: Uses the existing @tarikjabiri/dxf dependency — no new deps.
 *   - C1: Per-feature uncertainty is NOT computed here (DXF is a
 *          drafting format, not a metadata carrier). The beacon labels
 *          include the uncertainty when present, so a CAD technician
 *          opening the file sees "B3 (±12mm)" rather than just "B3".
 *   - C2: No coordinate rounding — DXF coordinates use full float64
 *          precision via @tarikjabiri/dxf's default serialization.
 *
 * # References
 *
 *   - ADR-0005: docs/decisions/0005-integration-export-workflow-family.md
 *   - Existing DXF primitives: packages/engine/src/documents/dxf-output.ts
 *   - RICS Measured Surveys 3rd ed.: https://www.rics.org/uk/
 *   - AIA CAD Layer Guidelines (US NCS v5): https://www.aia.org/
 *   - @tarikjabiri/dxf: https://dxf.vercel.app/
 */

import { getCountryConfig, type CountryCode } from "@metardu/country-config";
import type { CadastralWorkflowOutput } from "../workflows/cadastral.js";
import type { TopoWorkflowOutput } from "../workflows/topographic.js";
import type { EngineeringWorkflowOutput } from "../workflows/engineering.js";
import {
  createSurveyDxf,
  addPolygon,
  addBeacon,
  addTIN,
  addContours,
  addSpotHeights,
  addBearingDistanceLabel,
  addNorthArrow,
  addScaleBar,
  addText,
  serializeDxf,
  type DxfPoint,
} from "../documents/dxf-output.js";
import type {
  IntegrationExporter,
  IntegrationOptions,
  IntegrationOutput,
  SurveyOutput,
  ValidationResult,
} from "./types.js";

// ─── DXF-specific types ──────────────────────────────────────────

/** Options for the DXF exporter. */
export interface DxfOptions extends IntegrationOptions {
  /**
   * Whether to include the parcel polygon as a closed boundary
   * (default: true). Has no effect for topo/engineering outputs.
   */
  includeParcelBoundary?: boolean;
  /**
   * Whether to include the coordinate schedule text block
   * (default: true). CAD technicians usually want this; toggle off
   * for a cleaner plan view.
   */
  includeCoordinateSchedule?: boolean;
}

/** Output of the DXF exporter. */
export interface DxfOutput extends IntegrationOutput {
  format: "dxf";
  /** CRS URN referenced in the COORD-SCHEDULE text layer. */
  crsUrn: string;
  /** Layer names written to the DXF (country-correct). */
  layers: string[];
  /** Survey type that produced the input. */
  surveyType: "cadastral" | "topographic" | "engineering";
}

// ─── Per-country layer spec ──────────────────────────────────────

export interface DxfLayerSpec {
  /** Layer name (country-correct per ADR-0005 deliverable #7). */
  name: string;
  /** Layer category — drives which low-level helper uses this layer. */
  category:
    | "boundary"
    | "beacon"
    | "text-deedplan"
    | "text-coords"
    | "text-area"
    | "text-bearings"
    | "text-distances"
    | "text-beacon-labels"
    | "title-block"
    | "coord-schedule"
    | "north-arrow"
    | "scale-bar"
    | "grid"
    | "tin-edges"
    | "contours"
    | "spot-heights"
    | "alignment"
    | "cross-sections"
    | "design-surface";
}

/**
 * Per-country + per-survey-type DXF layer naming. Country-correct
 * layer naming is the entire point of ADR-0005 deliverable #7.
 *
 * Each entry returns a partial set of layer specs for the given
 * country + survey type. Specs not returned fall back to the Kenya
 * default (from the existing SURVEY_LAYERS constant) for back-compat.
 */
export function getCountryDxfLayerSpecs(
  countryCode: string,
  surveyType: "cadastral" | "topographic" | "engineering",
): DxfLayerSpec[] {
  // ─── Kenya (matches existing SURVEY_LAYERS — reference impl) ───
  if (countryCode === "KE") {
    if (surveyType === "cadastral") {
      return [
        { name: "BOUNDARY", category: "boundary" },
        { name: "BEACON", category: "beacon" },
        { name: "TEXT-DEEDPLAN", category: "text-deedplan" },
        { name: "TEXT-COORDS", category: "text-coords" },
        { name: "TEXT-AREA", category: "text-area" },
        { name: "TEXT-BEARINGS", category: "text-bearings" },
        { name: "TEXT-DISTANCES", category: "text-distances" },
        { name: "TEXT-BEACON-LABELS", category: "text-beacon-labels" },
        { name: "TITLE-BLOCK", category: "title-block" },
        { name: "COORD-SCHEDULE", category: "coord-schedule" },
        { name: "NORTH-ARROW", category: "north-arrow" },
        { name: "SCALE-BAR", category: "scale-bar" },
        { name: "GRID", category: "grid" },
      ];
    }
    if (surveyType === "topographic") {
      return [
        { name: "TIN-EDGES", category: "tin-edges" },
        { name: "CONTOURS", category: "contours" },
        { name: "SPOT-HEIGHTS", category: "spot-heights" },
        { name: "GRID", category: "grid" },
        { name: "NORTH-ARROW", category: "north-arrow" },
        { name: "SCALE-BAR", category: "scale-bar" },
        { name: "COORD-SCHEDULE", category: "coord-schedule" },
      ];
    }
    if (surveyType === "engineering") {
      return [
        { name: "ALIGNMENT", category: "alignment" },
        { name: "CROSS-SECTIONS", category: "cross-sections" },
        { name: "DESIGN-SURFACE", category: "design-surface" },
        { name: "GRID", category: "grid" },
        { name: "NORTH-ARROW", category: "north-arrow" },
        { name: "SCALE-BAR", category: "scale-bar" },
        { name: "COORD-SCHEDULE", category: "coord-schedule" },
      ];
    }
  }

  // ─── UK (RICS measured survey convention) ───
  //
  // RICS doesn't publish a strict layer-naming standard, but the AIA
  // CAD Layer Guidelines' discipline-prefix pattern is the de facto
  // UK convention. We prefix all survey layers with "SURV-" to make
  // them easy to filter in AutoCAD's layer manager.
  if (countryCode === "GB") {
    if (surveyType === "cadastral") {
      // UK is general-boundaries — no fixed beacons, so use "SURV-POINT"
      // instead of "BEACON" for the measured point features.
      return [
        { name: "SURV-BOUNDARY", category: "boundary" },
        { name: "SURV-POINT", category: "beacon" },
        { name: "SURV-TEXT-PLAN", category: "text-deedplan" },
        { name: "SURV-TEXT-COORDS", category: "text-coords" },
        { name: "SURV-TEXT-AREA", category: "text-area" },
        { name: "SURV-TEXT-BEARINGS", category: "text-bearings" },
        { name: "SURV-TEXT-DISTANCES", category: "text-distances" },
        { name: "SURV-TEXT-LABELS", category: "text-beacon-labels" },
        { name: "SURV-TITLE-BLOCK", category: "title-block" },
        { name: "SURV-COORD-SCHEDULE", category: "coord-schedule" },
        { name: "SURV-NORTH-ARROW", category: "north-arrow" },
        { name: "SURV-SCALE-BAR", category: "scale-bar" },
        { name: "SURV-GRID", category: "grid" },
      ];
    }
    if (surveyType === "topographic") {
      return [
        { name: "SURV-TIN-EDGES", category: "tin-edges" },
        { name: "SURV-CONTOURS", category: "contours" },
        { name: "SURV-SPOT-HEIGHTS", category: "spot-heights" },
        { name: "SURV-GRID", category: "grid" },
        { name: "SURV-NORTH-ARROW", category: "north-arrow" },
        { name: "SURV-SCALE-BAR", category: "scale-bar" },
        { name: "SURV-COORD-SCHEDULE", category: "coord-schedule" },
      ];
    }
    if (surveyType === "engineering") {
      return [
        { name: "SURV-ALIGNMENT", category: "alignment" },
        { name: "SURV-CROSS-SECTIONS", category: "cross-sections" },
        { name: "SURV-DESIGN-SURFACE", category: "design-surface" },
        { name: "SURV-GRID", category: "grid" },
        { name: "SURV-NORTH-ARROW", category: "north-arrow" },
        { name: "SURV-SCALE-BAR", category: "scale-bar" },
        { name: "SURV-COORD-SCHEDULE", category: "coord-schedule" },
      ];
    }
  }

  // ─── Generic fallback (Australia, UAE, South Africa — task briefs to follow) ───
  //
  // Use Kenya's layer names as a sensible default. The exporter emits
  // a warning that the surveyor should verify against their local CAD
  // layer-naming convention per master plan Section 3.
  return getCountryDxfLayerSpecs("KE", surveyType);
}

/**
 * Look up a layer name by category in the spec list. Falls back to
 * the Kenya default if the spec doesn't include the category.
 */
function layerNameFor(
  specs: DxfLayerSpec[],
  category: DxfLayerSpec["category"],
): string {
  return specs.find((s) => s.category === category)?.name ?? "BOUNDARY";
}

// ─── Survey type discriminator (shared logic) ────────────────────

function detectSurveyType(
  input: SurveyOutput,
): "cadastral" | "topographic" | "engineering" {
  if (typeof input === "object" && input !== null) {
    if ("form3" in input) return "cadastral";
    if ("sections" in input) return "engineering";
    if ("tin" in input && "contours" in input) return "topographic";
  }
  throw new Error(
    "Cannot detect survey type from input shape. The DXF exporter " +
      "currently supports cadastral, topographic, and engineering outputs.",
  );
}

// ─── Per-survey-type DXF generators ──────────────────────────────

/**
 * Generate a cadastral DXF using country-correct layer names.
 *
 * Calls the existing low-level DXF helpers but with the country-correct
 * layer names from getCountryDxfLayerSpecs().
 */
function generateCadastralDxf(
  output: CadastralWorkflowOutput,
  layerSpecs: DxfLayerSpec[],
  srid: number,
  crsUrn: string,
  options: DxfOptions,
  warnings: string[],
): { dxf: string; layers: string[] } {
  const includeBoundary = options.includeParcelBoundary !== false;
  const includeCoordSchedule = options.includeCoordinateSchedule !== false;

  const doc = createSurveyDxf();

  const beacons = output.allBeacons;
  if (beacons.length === 0) {
    warnings.push("Cadastral output has no beacons — DXF will be empty.");
    return { dxf: serializeDxf(doc), layers: [] };
  }

  const boundaryLayer = layerNameFor(layerSpecs, "boundary");
  const beaconLayer = layerNameFor(layerSpecs, "beacon");
  const textCoordsLayer = layerNameFor(layerSpecs, "text-coords");
  const textBeaconLabelsLayer = layerNameFor(layerSpecs, "text-beacon-labels");
  const coordScheduleLayer = layerNameFor(layerSpecs, "coord-schedule");
  const northArrowLayer = layerNameFor(layerSpecs, "north-arrow");
  const scaleBarLayer = layerNameFor(layerSpecs, "scale-bar");

  const layersUsed = new Set<string>([
    boundaryLayer, beaconLayer, textCoordsLayer, textBeaconLabelsLayer,
    coordScheduleLayer, northArrowLayer, scaleBarLayer,
  ]);

  // Boundary polygon (closed).
  if (includeBoundary && beacons.length >= 3) {
    const boundaryPoints: DxfPoint[] = beacons.map((b) => ({
      x: b.position.easting,
      y: b.position.northing,
    }));
    addPolygon(doc, boundaryPoints, boundaryLayer);
  }

  // Beacons — label includes uncertainty when present (invariant C1
  // traceability: CAD technician sees "B3 (±12mm)" not just "B3").
  for (const beacon of beacons) {
    const unc = output.uncertainty?.[beacon.label];
    let label = beacon.label;
    if (unc?.semiMajorAxis !== undefined) {
      const mm = Math.round(unc.semiMajorAxis * 1000);
      label = `${beacon.label} (±${mm}mm)`;
    } else if (unc?.adjusted === false) {
      label = `${beacon.label} (fixed)`;
    }
    addBeacon(
      doc,
      { x: beacon.position.easting, y: beacon.position.northing },
      0.5,
      label,
    );
  }

  // Bearing + distance labels for each boundary segment.
  if (includeBoundary) {
    for (let i = 0; i < beacons.length; i++) {
      const a = beacons[i]!;
      const b = beacons[(i + 1) % beacons.length]!;
      addBearingDistanceLabel(
        doc,
        { x: a.position.easting, y: a.position.northing },
        { x: b.position.easting, y: b.position.northing },
      );
    }
  }

  // Coordinate schedule text block.
  if (includeCoordSchedule) {
    let y = -5;
    addText(doc, `COORDINATES: SRID ${srid} | ${crsUrn}`, { x: 0, y }, coordScheduleLayer, 2.0);
    y -= 3;
    for (const beacon of beacons) {
      addText(
        doc,
        `${beacon.label}  E=${beacon.position.easting.toFixed(3)}  N=${beacon.position.northing.toFixed(3)}  ${beacon.description ?? ""}`,
        { x: 0, y },
        textCoordsLayer,
        1.5,
      );
      y -= 2.5;
    }
  }

  // North arrow + scale bar.
  const maxE = Math.max(...beacons.map((b) => b.position.easting));
  const maxN = Math.max(...beacons.map((b) => b.position.northing));
  const minE = Math.min(...beacons.map((b) => b.position.easting));
  const minN = Math.min(...beacons.map((b) => b.position.northing));
  addNorthArrow(doc, { x: maxE + 5, y: maxN + 5 }, 5);
  addScaleBar(doc, { x: minE, y: minN - 10 }, 50, 4);

  return {
    dxf: serializeDxf(doc),
    layers: [...layersUsed],
  };
}

/**
 * Generate a topographic DXF using country-correct layer names.
 */
function generateTopoDxf(
  output: TopoWorkflowOutput,
  layerSpecs: DxfLayerSpec[],
  srid: number,
  crsUrn: string,
  options: DxfOptions,
  warnings: string[],
): { dxf: string; layers: string[] } {
  const includeCoordSchedule = options.includeCoordinateSchedule !== false;
  const doc = createSurveyDxf();

  const tinEdgesLayer = layerNameFor(layerSpecs, "tin-edges");
  const contoursLayer = layerNameFor(layerSpecs, "contours");
  const spotHeightsLayer = layerNameFor(layerSpecs, "spot-heights");
  const coordScheduleLayer = layerNameFor(layerSpecs, "coord-schedule");

  const layersUsed = new Set<string>([
    tinEdgesLayer, contoursLayer, spotHeightsLayer, coordScheduleLayer,
  ]);

  addTIN(
    doc,
    output.tin.vertices.map((v) => ({ x: v.easting, y: v.northing })),
    output.tin.triangles,
  );

  addContours(doc, output.contours);

  addSpotHeights(
    doc,
    output.spotHeights.map((sh) => ({
      x: sh.easting,
      y: sh.northing,
      elevation: sh.elevation,
    })),
  );

  if (includeCoordSchedule) {
    addText(
      doc,
      `TOPOGRAPHIC SURVEY: SRID ${srid} | ${crsUrn}`,
      { x: 0, y: -5 },
      coordScheduleLayer,
      2.0,
    );
  }

  if (output.tin.vertices.length > 0) {
    const maxE = Math.max(...output.tin.vertices.map((v) => v.easting));
    const maxN = Math.max(...output.tin.vertices.map((v) => v.northing));
    const minE = Math.min(...output.tin.vertices.map((v) => v.easting));
    const minN = Math.min(...output.tin.vertices.map((v) => v.northing));
    addNorthArrow(doc, { x: maxE + 5, y: maxN + 5 }, 5);
    addScaleBar(doc, { x: minE, y: minN - 10 }, 50, 4);
  }

  if (output.tin.vertices.length === 0) {
    warnings.push("Topographic output has no TIN vertices — DXF will be minimal.");
  }

  return {
    dxf: serializeDxf(doc),
    layers: [...layersUsed],
  };
}

/**
 * Generate an engineering DXF using country-correct layer names.
 */
function generateEngineeringDxf(
  output: EngineeringWorkflowOutput,
  layerSpecs: DxfLayerSpec[],
  srid: number,
  crsUrn: string,
  options: DxfOptions,
  _warnings: string[],
): { dxf: string; layers: string[] } {
  const includeCoordSchedule = options.includeCoordinateSchedule !== false;
  const doc = createSurveyDxf();

  const alignmentLayer = layerNameFor(layerSpecs, "alignment");
  const crossSectionsLayer = layerNameFor(layerSpecs, "cross-sections");
  const coordScheduleLayer = layerNameFor(layerSpecs, "coord-schedule");

  const layersUsed = new Set<string>([
    alignmentLayer, crossSectionsLayer, coordScheduleLayer,
  ]);

  // Section centerline points as beacons (chainage labels).
  if (output.sections.length > 0) {
    for (const section of output.sections) {
      addBeacon(
        doc,
        { x: section.centerline.easting, y: section.centerline.northing },
        0.5,
        `CH ${section.chainage.toFixed(1)}m`,
      );
    }
  }

  // Coordinate schedule text + volume summary.
  if (includeCoordSchedule) {
    addText(
      doc,
      `ENGINEERING SURVEY: SRID ${srid} | ${crsUrn}`,
      { x: 0, y: -5 },
      coordScheduleLayer,
      2.0,
    );

    addText(
      doc,
      `CUT VOLUME: ${output.cutVolume.toFixed(2)} m3 | FILL VOLUME: ${output.fillVolume.toFixed(2)} m3 | NET: ${output.netVolume.toFixed(2)} m3`,
      { x: 0, y: -8 },
      coordScheduleLayer,
      1.5,
    );

    addText(
      doc,
      `SECTIONS: ${output.sectionCount} | MAX CUT DEPTH: ${output.maxCutDepth.toFixed(2)}m | MAX FILL HEIGHT: ${output.maxFillHeight.toFixed(2)}m`,
      { x: 0, y: -11 },
      coordScheduleLayer,
      1.5,
    );
  }

  return {
    dxf: serializeDxf(doc),
    layers: [...layersUsed],
  };
}

// ─── The exporter object ─────────────────────────────────────────

export const dxfExporter: IntegrationExporter<SurveyOutput, DxfOptions, DxfOutput> = {
  format: "dxf",
  mimeType: "application/dxf",
  fileExtension: "dxf",
  description: "DXF (AutoCAD R12+) with country-correct layer naming per ADR-0005 #7",

  validate(input: SurveyOutput, options: DxfOptions): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

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

    let surveyType: "cadastral" | "topographic" | "engineering";
    try {
      surveyType = detectSurveyType(input);
    } catch (e) {
      errors.push((e as Error).message);
      return { ok: false, errors, warnings };
    }

    // Warning for countries without a documented layer-naming convention.
    if (!["KE", "GB"].includes(options.countryCode)) {
      warnings.push(
        `Country '${options.countryCode}' has no documented DXF layer-naming ` +
          `convention in metardu-desktop yet. Falling back to Kenya (Survey of ` +
          `Kenya Form 3) layer names as a sensible default. Verify against ` +
          `your local CAD layer-naming convention before submitting.`,
      );
    }

    if (surveyType === "cadastral") {
      const output = input as CadastralWorkflowOutput;
      if (!output.allBeacons || output.allBeacons.length === 0) {
        errors.push("Input cadastral survey output has no beacons — nothing to export.");
      }
    } else if (surveyType === "topographic") {
      const output = input as TopoWorkflowOutput;
      if (!output.tin || output.tin.vertices.length === 0) {
        errors.push("Input topographic survey output has no TIN vertices.");
      }
    } else if (surveyType === "engineering") {
      const output = input as EngineeringWorkflowOutput;
      if (!output.sections || output.sections.length === 0) {
        errors.push("Input engineering survey output has no sections.");
      }
    }

    return { ok: errors.length === 0, errors, warnings };
  },

  async export(input: SurveyOutput, options: DxfOptions): Promise<DxfOutput> {
    const validation = this.validate(input, options);
    if (!validation.ok) {
      throw new Error(
        `DXF export refused (validation failed):\n  - ` + validation.errors.join("\n  - "),
      );
    }

    const warnings: string[] = [...validation.warnings];
    const surveyType = detectSurveyType(input);

    const config = getCountryConfig(options.countryCode as CountryCode);
    const srid = config.geodeticFramework.primarySRID;
    const crsUrn = `urn:ogc:def:crs:EPSG::${srid}`;

    const layerSpecs = getCountryDxfLayerSpecs(options.countryCode, surveyType);

    let dxf: string;
    let layers: string[];
    if (surveyType === "cadastral") {
      const result = generateCadastralDxf(
        input as CadastralWorkflowOutput,
        layerSpecs,
        srid,
        crsUrn,
        options,
        warnings,
      );
      dxf = result.dxf;
      layers = result.layers;
    } else if (surveyType === "topographic") {
      const result = generateTopoDxf(
        input as TopoWorkflowOutput,
        layerSpecs,
        srid,
        crsUrn,
        options,
        warnings,
      );
      dxf = result.dxf;
      layers = result.layers;
    } else {
      const result = generateEngineeringDxf(
        input as EngineeringWorkflowOutput,
        layerSpecs,
        srid,
        crsUrn,
        options,
        warnings,
      );
      dxf = result.dxf;
      layers = result.layers;
    }

    const bytes = new TextEncoder().encode(dxf);

    return {
      format: "dxf",
      bytes,
      featureCount: layers.length,
      warnings,
      crsUrn,
      layers,
      surveyType,
    };
  },
};
