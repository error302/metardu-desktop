/**
 * Topographic workflow — field data → TIN → contours → plan.
 *
 * Master plan Section 6.1. Consumes raw field data (point cloud or
 * total station points), generates a bounded draft TIN, and extracts
 * contours at the explicitly supplied interval. This module does not
 * adjust observations or establish a statutory topographic plan.
 *
 * # Pipeline
 *
 *   1. Import field points (CSV, GSI, SDR, JOB, RINEX)
 *   2. Generate a bounded draft TIN in the Rust sidecar
 *   3. Compute slope + aspect (optional, for the plan)
 *   4. Generate contours at the country-specified interval (sidecar
 *      gdal_contour, or the engine's own marching-squares fallback)
 *   5. Generate spot heights + feature annotations
 *   6. Output topographic plan (PDF + DXF)
 *
 * # Country config dependencies
 *
 *   - contourInterval: read from the active country's config (or
 *     passed explicitly by the caller)
 *   - srid: read from the active country's config
 *   - toleranceTable: topographic horizontal tolerance for QC
 *
 * # What's NOT here yet
 *
 *   - DXF output (PDF only for v0.3.0)
 *   - Cross-section / long-section extraction (Phase 9B engineering)
 *   - Drone orthophoto import (Phase 11+)
 *
 * # References
 *
 *   - Master plan Section 6.1
 *   - LSB Topographical Survey Guidelines (Kenya, pending filing)
 *   - RICS Measured Surveys 3rd ed. (UK)
 */

import type { CountrySurveyConfig } from "@metardu/country-config";
import type { PointUncertainty } from "../survey-types.js";
import { validateNonEmptyString, validateNonNaN, validatePoints, validatePositive } from "./validation.js";

/** Per-request sidecar ceiling; limits memory while supporting real survey sets. */
export const MAX_TOPOGRAPHIC_TIN_POINTS = 100_000;
/** Bound contour extraction work for interactive desktop use. */
export const MAX_TOPOGRAPHIC_CONTOUR_WORK_ITEMS = 20_000_000;

// ─── Types ───────────────────────────────────────────────────────

/** A 3D field point (easting, northing, elevation) in metres. */
export interface TopoPoint {
  /** Point ID from the field instrument (e.g. "1", "PT101"). */
  id: string;
  /** Point code (feature code, e.g. "TOP", "BOT", "FENCE", "TREE"). */
  code?: string;
  easting: number;
  northing: number;
  elevation: number;
}

/** TIN — Triangulated Irregular Network. */
export interface TIN {
  /** Vertices (same as the input points, deduplicated). */
  vertices: TopoPoint[];
  /** Triangles as vertex indices. */
  triangles: [number, number, number][];
}

/** A contour line. */
export interface Contour {
  /** Elevation in metres. */
  elevation: number;
  /** Polyline of [easting, northing] points (closed if the contour loops back). */
  coordinates: [number, number][];
  /** True if the contour is closed (loops back on itself). */
  closed: boolean;
}

/** Spot height annotation. */
export interface SpotHeight {
  easting: number;
  northing: number;
  elevation: number;
}

/** User-declared project context; this workflow does not independently verify it. */
export interface TopographicCoordinateContext {
  horizontalCrsEpsg: number;
  horizontalCrsLabel: string;
  horizontalUnits: "m";
  verticalReference: string;
  referenceStatus: "user-declared-unverified";
}

/** Input to the topographic workflow. */
export interface TopoWorkflowInput {
  /** Field points to triangulate. */
  points: TopoPoint[];
  /** Triangle indices returned by the Rust sidecar for this exact point order. */
  tinTriangles: [number, number, number][];
  /** Contour interval in metres (e.g. 0.5 for 50cm contours). */
  contourInterval: number;
  /** Optional: minimum elevation for the contour range (defaults to min of points). */
  minElevation?: number;
  /** Optional: maximum elevation (defaults to max of points). */
  maxElevation?: number;
  /** Spot height density (every Nth point). Default 10. */
  spotHeightEvery?: number;
  /** Optional active country config for a jurisdictional tolerance profile. */
  country?: CountrySurveyConfig;
  /** Project reference metadata supplied by the caller and retained with the draft. */
  coordinateContext?: TopographicCoordinateContext;
  /** Parcel metadata for the plan title block. */
  planTitle?: string;
  /** Surveyor info. */
  surveyor?: {
    name: string;
    regNo: string;
    dateOfSurvey: string;
  };
}

/** Output of the topographic workflow. */
export interface TopoWorkflowOutput {
  /** Generated TIN. */
  tin: TIN;
  /** Generated contours. */
  contours: Contour[];
  /** Selected spot heights (one every Nth point). */
  spotHeights: SpotHeight[];
  /** Min elevation across the points. */
  minElevation: number;
  /** Max elevation across the points. */
  maxElevation: number;
  /** Mean slope across the TIN (degrees). */
  meanSlope: number;
  /** Number of triangles in the TIN. */
  triangleCount: number;
  /** QC: topographic horizontal tolerance from the country config. */
  topographicToleranceM: number | null;
  /** No residual check is currently run; null means not computed. */
  maxResidualM: number | null;
  /** Raw field points are interpolated without least-squares adjustment. */
  evidenceStatus: "computed-draft-unadjusted";
  /** Declared project context; the workflow does not validate CRS or vertical datum. */
  coordinateContext?: TopographicCoordinateContext;
  /**
   * Per-point uncertainty, keyed by point ID. Per master plan Section
   * 5.3 invariant C1: every survey point must carry its propagated
   * uncertainty.
   *
   * The current topographic workflow does NOT run an LS adjustment —
   * it triangulates raw field points directly. So every point gets
   * `{ adjusted: false, reason: "field-data" }` by default. When a
   * future task brief wires the topo control points through the
   * sidecar's LS adjustment, this field gets the real error ellipses.
   *
   * Downstream consumers (GeoJSON exporter, plan renderer) MUST
   * surface this honestly — a topo point with no LS adjustment is a
   * field reading, not a statutory coordinate.
   */
  pointUncertainty: Record<string, PointUncertainty>;
}

// ─── TIN validation (construction is performed by the Rust sidecar) ──

function validateTinTriangles(points: TopoPoint[], triangles: [number, number, number][]): TIN {
  if (points.length > MAX_TOPOGRAPHIC_TIN_POINTS) {
    throw new Error(`Topographic TIN supports at most ${MAX_TOPOGRAPHIC_TIN_POINTS} points; received ${points.length}.`);
  }
  const maximumFaceCount = Math.max(0, 2 * points.length - 5);
  if (!Array.isArray(triangles) || triangles.length === 0 || triangles.length > maximumFaceCount) {
    throw new Error("Topographic sidecar returned an invalid or empty triangle list.");
  }

  const seen = new Set<string>();
  const vertexUse = new Uint8Array(points.length);
  for (const [index, triangle] of triangles.entries()) {
    if (!Array.isArray(triangle) || triangle.length !== 3) {
      throw new Error(`Topographic sidecar triangle ${index} must contain exactly 3 vertex indices.`);
    }
    const [a, b, c] = triangle;
    if (![a, b, c].every((value) => Number.isSafeInteger(value) && value >= 0 && value < points.length)) {
      throw new Error(`Topographic sidecar triangle ${index} contains an out-of-range vertex index.`);
    }
    if (a === b || b === c || c === a) {
      throw new Error(`Topographic sidecar triangle ${index} repeats a vertex index.`);
    }
    const key = [a, b, c].sort((left, right) => left - right).join(":");
    if (seen.has(key)) throw new Error(`Topographic sidecar returned duplicate triangle ${key}.`);
    seen.add(key);
    vertexUse[a] = 1;
    vertexUse[b] = 1;
    vertexUse[c] = 1;
  }
  if (vertexUse.some((used) => used === 0)) {
    throw new Error("Topographic sidecar triangulation did not include every input point.");
  }
  return { vertices: points, triangles };
}

// ─── Contour generation (marching squares) ───────────────────────

/**
 * Generate contours from the TIN at the specified interval.
 *
 * For each contour elevation, we walk every triangle and check if the
 * contour crosses it. If yes, we extract the crossing line segment
 * via linear interpolation along the triangle edges.
 *
 * This is a simplified marching-squares implementation. The full
 * version chains connected segments into polylines — we return
 * individual segments here for simplicity. Phase 11 can add segment
 * chaining.
 */
function generateContours(tin: TIN, interval: number, minE: number, maxE: number): Contour[] {
  if (interval <= 0 || tin.triangles.length === 0) return [];

  // Round min/max to the nearest interval multiple.
  const startE = Math.ceil(minE / interval) * interval;
  const endE = Math.floor(maxE / interval) * interval;
  const levelCount = Math.max(0, Math.floor((endE - startE) / interval) + 1);
  if (!Number.isFinite(levelCount) || levelCount > 10_000) {
    throw new Error(`Contour interval would generate ${levelCount} levels; maximum supported is 10,000.`);
  }
  const workItems = levelCount * tin.triangles.length;
  if (!Number.isSafeInteger(workItems) || workItems > MAX_TOPOGRAPHIC_CONTOUR_WORK_ITEMS) {
    throw new Error(`Contour request would inspect ${workItems.toLocaleString()} triangle-level combinations; reduce the elevation range or increase the interval (maximum ${MAX_TOPOGRAPHIC_CONTOUR_WORK_ITEMS.toLocaleString()}).`);
  }

  const contours: Contour[] = [];

  for (let levelIndex = 0; levelIndex < levelCount; levelIndex++) {
    const elev = startE + levelIndex * interval;
    const segments: [number, number][][] = [];

    for (const tri of tin.triangles) {
      const a = tin.vertices[tri[0]]!;
      const b = tin.vertices[tri[1]]!;
      const c = tin.vertices[tri[2]]!;

      const crossings = edgeCrossings(a, b, c, elev);
      if (crossings.length === 2) {
        segments.push([crossings[0]!, crossings[1]!]);
      }
    }

    // Each segment becomes its own contour "line" (simplified — full
    // implementation would chain them).
    for (const seg of segments) {
      contours.push({
        elevation: elev,
        coordinates: seg,
        closed: false,
      });
    }
  }

  return contours;
}

/** Find where the elevation contour crosses the edges of triangle (a, b, c). */
function edgeCrossings(a: TopoPoint, b: TopoPoint, c: TopoPoint, elev: number): [number, number][] {
  const crossings: [number, number][] = [];
  const edges: [TopoPoint, TopoPoint][] = [
    [a, b], [b, c], [c, a],
  ];
  for (const [p1, p2] of edges) {
    const cross = interpolateEdge(p1, p2, elev);
    if (cross) crossings.push(cross);
  }
  return crossings;
}

/** Interpolate the crossing point on edge p1→p2 at the given elevation. */
function interpolateEdge(p1: TopoPoint, p2: TopoPoint, elev: number): [number, number] | null {
  const e1 = p1.elevation;
  const e2 = p2.elevation;
  // Check if elev is between e1 and e2.
  if ((e1 < elev) === (e2 < elev)) return null;
  if (Math.abs(e2 - e1) < 1e-12) return null;

  const t = (elev - e1) / (e2 - e1);
  const x = p1.easting + t * (p2.easting - p1.easting);
  const y = p1.northing + t * (p2.northing - p1.northing);
  return [x, y];
}

// ─── Spot heights ────────────────────────────────────────────────

function selectSpotHeights(points: TopoPoint[], every: number): SpotHeight[] {
  if (every <= 0) return [];
  const result: SpotHeight[] = [];
  for (let i = 0; i < points.length; i += every) {
    const p = points[i]!;
    result.push({ easting: p.easting, northing: p.northing, elevation: p.elevation });
  }
  return result;
}

// ─── Mean slope ──────────────────────────────────────────────────

function computeMeanSlope(tin: TIN): number {
  if (tin.triangles.length === 0) return 0;
  let totalSlope = 0;
  for (const tri of tin.triangles) {
    const a = tin.vertices[tri[0]]!;
    const b = tin.vertices[tri[1]]!;
    const c = tin.vertices[tri[2]]!;
    // Triangle edge lengths (3D)
    const d1 = Math.sqrt((b.easting - a.easting) ** 2 + (b.northing - a.northing) ** 2 + (b.elevation - a.elevation) ** 2);
    const d2 = Math.sqrt((c.easting - b.easting) ** 2 + (c.northing - b.northing) ** 2 + (c.elevation - b.elevation) ** 2);
    const d3 = Math.sqrt((a.easting - c.easting) ** 2 + (a.northing - c.northing) ** 2 + (a.elevation - c.elevation) ** 2);
    // Triangle area (Heron's formula)
    const s = (d1 + d2 + d3) / 2;
    const area3D = Math.sqrt(Math.max(0, s * (s - d1) * (s - d2) * (s - d3)));
    // Projected area (XY only)
    const d1xy = Math.sqrt((b.easting - a.easting) ** 2 + (b.northing - a.northing) ** 2);
    const d2xy = Math.sqrt((c.easting - b.easting) ** 2 + (c.northing - b.northing) ** 2);
    const d3xy = Math.sqrt((a.easting - c.easting) ** 2 + (a.northing - c.northing) ** 2);
    const sxy = (d1xy + d2xy + d3xy) / 2;
    const areaXY = Math.sqrt(Math.max(0, sxy * (sxy - d1xy) * (sxy - d2xy) * (sxy - d3xy)));
    if (areaXY < 1e-9) continue;
    // Slope = acos(areaXY / area3D)
    const cosSlope = Math.min(1, areaXY / area3D);
    totalSlope += Math.acos(cosSlope);
  }
  return (totalSlope / tin.triangles.length) * (180 / Math.PI);
}

// ─── Main entry point ────────────────────────────────────────────

/**
 * Run the topographic workflow.
 *
 * @throws if fewer than 3 points are provided.
 */
export function runTopographicWorkflow(input: TopoWorkflowInput): TopoWorkflowOutput {
  if (input.points.length < 3) {
    throw new Error(`Topographic workflow requires at least 3 points; got ${input.points.length}.`);
  }
  if (input.points.length > MAX_TOPOGRAPHIC_TIN_POINTS) {
    throw new Error(`Topographic TIN supports at most ${MAX_TOPOGRAPHIC_TIN_POINTS} points per request; received ${input.points.length}.`);
  }
  // Rust applies exact-position duplicate and robust collinearity checks.
  // The shared TypeScript validator rounds duplicates to 1e-4 and uses a
  // fixed area tolerance, which must not pre-empt that project-neutral test.
  validatePoints(input.points, "Topographic workflow", { checkDuplicates: false, checkCollinear: false });
  validatePositive(input.contourInterval, "Topographic workflow.contourInterval");
  const pointIds = new Set<string>();
  for (const [index, point] of input.points.entries()) {
    validateNonEmptyString(point.id, `Topographic workflow.points[${index}].id`);
    if (pointIds.has(point.id)) {
      throw new Error(`Topographic workflow has duplicate point ID '${point.id}'. Point IDs must be unique.`);
    }
    pointIds.add(point.id);
  }
  if (input.spotHeightEvery !== undefined && (!Number.isInteger(input.spotHeightEvery) || input.spotHeightEvery <= 0)) {
    throw new Error(`Topographic workflow.spotHeightEvery must be a positive integer; got ${input.spotHeightEvery}.`);
  }
  if (input.coordinateContext) {
    if (!Number.isInteger(input.coordinateContext.horizontalCrsEpsg) || input.coordinateContext.horizontalCrsEpsg <= 0) {
      throw new Error("Topographic workflow.coordinateContext.horizontalCrsEpsg must be a positive integer.");
    }
    validateNonEmptyString(input.coordinateContext.horizontalCrsLabel, "Topographic workflow.coordinateContext.horizontalCrsLabel");
    validateNonEmptyString(input.coordinateContext.verticalReference, "Topographic workflow.coordinateContext.verticalReference");
    if (input.coordinateContext.horizontalUnits !== "m" || input.coordinateContext.referenceStatus !== "user-declared-unverified") {
      throw new Error("Topographic workflow coordinate context must explicitly declare metre units and an unverified vertical reference.");
    }
  }

  // The sidecar is the only production source for Delaunay topology.
  const tin = validateTinTriangles(input.points, input.tinTriangles);

  // Compute min/max elevation.
  let observedMinElevation = Number.POSITIVE_INFINITY;
  let observedMaxElevation = Number.NEGATIVE_INFINITY;
  for (const point of input.points) {
    observedMinElevation = Math.min(observedMinElevation, point.elevation);
    observedMaxElevation = Math.max(observedMaxElevation, point.elevation);
  }
  const minE = input.minElevation ?? observedMinElevation;
  const maxE = input.maxElevation ?? observedMaxElevation;
  validateNonNaN(minE, "Topographic workflow.minElevation");
  validateNonNaN(maxE, "Topographic workflow.maxElevation");
  if (minE > maxE) throw new Error(`Topographic workflow.minElevation (${minE}) must not exceed maxElevation (${maxE}).`);

  // Generate contours.
  const contours = generateContours(tin, input.contourInterval, minE, maxE);

  // Select spot heights.
  const spotHeights = selectSpotHeights(input.points, input.spotHeightEvery ?? 10);

  // Compute mean slope.
  const meanSlope = computeMeanSlope(tin);

  // QC: get the topographic horizontal tolerance from the country config.
  // (If no specific topo tolerance, fall back to engineering standard.)
  const topoRule = input.country?.toleranceTable.find(
    (r) => r.surveyType === "Topographic" && r.toleranceType === "horizontal_position",
  );
  const topographicToleranceM = topoRule ? topoRule.compute({}) : null;

  // A TIN interpolates input vertices by construction; that is not an
  // independent residual or accuracy check, so the metric remains unknown.
  const maxResidualM = null;

  // Per-point uncertainty: the current topographic workflow does NOT run
  // an LS adjustment — it triangulates raw field points directly. So every
  // point gets { adjusted: false, reason: "field-data" } by default. When
  // a future task brief wires topo control points through the sidecar's
  // LS adjustment, this gets the real error ellipses. Per invariant C1,
  // we surface the gap honestly rather than hiding it.
  const pointUncertainty: Record<string, PointUncertainty> = {};
  for (const p of input.points) {
    pointUncertainty[p.id] = { adjusted: false, reason: "field-data" };
  }

  return {
    tin,
    contours,
    spotHeights,
    minElevation: minE,
    maxElevation: maxE,
    meanSlope,
    triangleCount: tin.triangles.length,
    topographicToleranceM,
    maxResidualM,
    evidenceStatus: "computed-draft-unadjusted",
    ...(input.coordinateContext ? { coordinateContext: input.coordinateContext } : {}),
    pointUncertainty,
  };
}
