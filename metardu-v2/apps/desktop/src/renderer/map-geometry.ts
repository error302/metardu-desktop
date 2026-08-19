/**
 * map-geometry.ts — extract plottable geometry from a survey workflow output.
 *
 * The MapView needs to draw the ACTIVE project's real survey geometry on the
 * OpenLayers basemap. Survey outputs are a union of many workflow shapes
 * (cadastral, topographic, engineering, sectional, setting-out), each with
 * its own field naming. This module normalizes the common patterns into a
 * single `MapGeometry` shape the MapView can render.
 *
 * It is deliberately a pure function (no Electron, no React, no ol imports)
 * so it can be unit-tested in isolation and reused by any view.
 *
 * # Supported shapes (best-effort, defensive)
 *
 *   - Beacons (labeled points):
 *       allBeacons[]        → { label, position: { easting, northing } }
 *       parcel.beacons[]    → same shape (Form 3 parcel)
 *   - Boundaries (closed rings / polylines):
 *       parcel.boundary.vertices[]  → cadastral parcel outline
 *       boundary.vertices[]         → generic top-level boundary
 *       alignment.points[]          → engineering centerline polyline
 *       (cadastral allBeacons[≥3]   → closed ring through the beacons)
 *   - Field points (unlabeled survey points):
 *       tin.vertices[]  → topographic TIN vertices (easting/northing/elevation)
 *       spotHeights[]   → topographic spot heights
 *       designPoints[]  → setting-out design points (id/easting/northing)
 *       controlPoints[] → setting-out control points
 *
 * Unrecognized outputs return an empty geometry (honest — nothing to plot).
 */

/**
 * Per-point uncertainty (2D error ellipse) from an LS adjustment, attached
 * to beacon MapPoints so the MapView can draw the ellipse and report it on
 * click. Mirrors the canonical PointUncertainty shape in the engine
 * (packages/engine survey-types.ts) — only the fields the map display
 * needs, defensively normalized from whatever the workflow emitted.
 */
export interface MapUncertainty {
  /** True if this point's coordinates were adjusted by an LS fit. */
  adjusted: boolean;
  /** Semi-major axis of the error ellipse, in metres. */
  semiMajorAxis?: number;
  /** Semi-minor axis of the error ellipse, in metres. */
  semiMinorAxis?: number;
  /** Orientation of the semi-major axis, degrees clockwise from north. */
  orientation?: number;
  /** Confidence level (0–1). Default 0.95 (95% confidence ellipse). */
  confidenceLevel?: number;
  /** A posteriori variance factor the ellipse was scaled by. */
  sigma_0_sq?: number;
  /** Why the ellipse is absent: "fixed-control" | "field-data" | … */
  reason?: string;
}

export interface MapPoint {
  label: string;
  easting: number;
  northing: number;
  /**
   * Error ellipse when the point was LS-adjusted (undefined for fixed /
   * known points, or when the output carried no uncertainty record).
   */
  uncertainty?: MapUncertainty;
}

export interface MapBoundary {
  /** Label for the boundary (e.g. "Parcel", "Alignment"). */
  label: string;
  /** Vertices in order; closed rings repeat the first vertex at the end. */
  vertices: MapPoint[];
}

export interface MapGeometry {
  /** Labeled point markers (beacons, control points). */
  beacons: MapPoint[];
  /** Polygons / polylines to outline. */
  boundaries: MapBoundary[];
  /** Unlabeled survey points (TIN vertices, design points, …). */
  fieldPoints: MapPoint[];
  /**
   * Contour lines from a topographic TIN extraction (elevation-tagged
   * polylines — the shape SurveyCanvas renders). Drawn on the map overlay
   * and the 300 DPI plan sheet so the printed plan matches the canvas.
   */
  contours: MapContour[];
}

/** A contour line extracted from a topographic output. */
export interface MapContour {
  /** Elevation of the contour line, metres. */
  elevation: number;
  /** Vertices along the line (open polyline or closed ring). */
  vertices: MapPoint[];
  /** True when the contour is a closed ring. */
  closed: boolean;
}

/** Empty geometry — returned when the output has nothing plottable. */
export function emptyMapGeometry(): MapGeometry {
  return { beacons: [], boundaries: [], fieldPoints: [], contours: [] };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Extract { easting, northing } from a point-shaped object (or null). */
function pointCoords(value: unknown): { easting: number; northing: number } | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const e = num(rec.easting);
  const n = num(rec.northing);
  if (e === null || n === null) return null;
  return { easting: e, northing: n };
}

/** Extract { easting, northing } from a [easting, northing] number pair (or null). */
function pairCoords(value: unknown): { easting: number; northing: number } | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const e = num(value[0]);
  const n = num(value[1]);
  if (e === null || n === null) return null;
  return { easting: e, northing: n };
}

/**
 * Defensively normalize a raw uncertainty record into a MapUncertainty.
 * Returns null when the record isn't a well-formed uncertainty object
 * (missing the required boolean `adjusted` flag).
 */
function normalizeUncertainty(rec: Record<string, unknown>): MapUncertainty | null {
  if (typeof rec.adjusted !== "boolean") return null;
  const out: MapUncertainty = { adjusted: rec.adjusted };
  for (const key of ["semiMajorAxis", "semiMinorAxis", "orientation", "confidenceLevel", "sigma_0_sq"] as const) {
    const v = rec[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  if (typeof rec.reason === "string") out.reason = rec.reason;
  return out;
}

/** A beacon-like object: { label, position: {easting, northing} } or { label, easting, northing }. */
function beaconPoint(value: unknown, fallbackLabel: string): MapPoint | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const label = typeof rec.label === "string" ? rec.label
    : typeof rec.id === "string" ? rec.id
    : fallbackLabel;
  const pos = pointCoords(rec.position) ?? pointCoords(rec);
  if (!pos) return null;
  const point: MapPoint = { label, easting: pos.easting, northing: pos.northing };
  // Inline per-beacon uncertainty (e.g. GCP-style records). The top-level
  // uncertainty / pointUncertainty maps are merged in extractMapGeometry
  // and never override an inline record.
  const inline = asRecord(rec.uncertainty);
  if (inline) {
    const nu = normalizeUncertainty(inline);
    if (nu) point.uncertainty = nu;
  }
  return point;
}

/**
 * Extract plottable geometry from any survey workflow output.
 * Returns empty geometry for null, non-object, or unrecognized outputs.
 */
export function extractMapGeometry(output: unknown): MapGeometry {
  const rec = asRecord(output);
  if (!rec) return emptyMapGeometry();

  const beacons: MapPoint[] = [];
  const boundaries: MapBoundary[] = [];
  const fieldPoints: MapPoint[] = [];
  const contours: MapContour[] = [];

  // ─── Beacons (labeled points) ───────────────────────────────────
  // Cadastral: allBeacons[] or parcel.beacons[] → { label, position }.
  // Some workflows carry the same beacon set in both places (allBeacons AND
  // parcel.beacons) — dedupe by label so markers never double-draw.
  const seenBeaconLabels = new Set<string>();
  for (const list of [rec.allBeacons, asRecord(rec.parcel)?.beacons]) {
    for (const b of asArray(list)) {
      const p = beaconPoint(b, "B");
      if (p && !seenBeaconLabels.has(p.label)) {
        seenBeaconLabels.add(p.label);
        beacons.push(p);
      }
    }
  }

  // ─── Boundaries ─────────────────────────────────────────────────
  // Generic parcel outline: parcel.boundary.vertices[].
  const parcelRec = asRecord(rec.parcel);
  const parcelBoundary = asRecord(parcelRec?.boundary);
  if (parcelBoundary) {
    const vertices = asArray(parcelBoundary.vertices)
      .map((v, i) => beaconPoint(v, `V${i + 1}`))
      .filter((v): v is MapPoint => v !== null);
    if (vertices.length >= 3) boundaries.push({ label: "Parcel", vertices });
  }
  // Top-level boundary: boundary.vertices[].
  const topBoundary = asRecord(rec.boundary);
  if (topBoundary) {
    const vertices = asArray(topBoundary.vertices)
      .map((v, i) => beaconPoint(v, `V${i + 1}`))
      .filter((v): v is MapPoint => v !== null);
    if (vertices.length >= 3) boundaries.push({ label: "Boundary", vertices });
  }
  // Engineering centerline: alignment.points[] (open polyline).
  const alignment = asRecord(rec.alignment);
  if (alignment) {
    const points = asArray(alignment.points)
      .map((p, i) => beaconPoint(p, `A${i + 1}`))
      .filter((p): p is MapPoint => p !== null);
    if (points.length >= 2) boundaries.push({ label: "Alignment", vertices: points });
  }
  // Multi-parcel subdivisions: an explicit `parcels[]` array (each with its
  // own boundary — the Form 4 / mutation-plan shape) becomes one boundary
  // per parcel, labeled from the parcel's label or number.
  const parcelsRaw = asArray(rec.parcels);
  if (parcelsRaw.length > 0) {
    parcelsRaw.forEach((p, i) => {
      const prec = asRecord(p);
      const pBoundary = asRecord(prec?.boundary);
      const label =
        typeof prec?.label === "string" ? prec.label
        : typeof prec?.parcelNo === "string" || typeof prec?.parcelNo === "number" ? String(prec.parcelNo)
        : `Parcel ${i + 1}`;
      const vertices = asArray(pBoundary?.vertices)
        .map((v, j) => beaconPoint(v, `V${j + 1}`))
        .filter((v): v is MapPoint => v !== null);
      if (vertices.length >= 3) boundaries.push({ label, vertices });
    });
  }

  // Cadastral fallback: if we have ≥3 beacons and no explicit boundary,
  // close a ring through them (they are ordered B1..Bn in the schedule).
  // Guarded against an explicit parcels[] list — a subdivision's beacons
  // would otherwise produce a phantom whole-parcel ring on top of the real
  // per-parcel boundaries.
  if (boundaries.length === 0 && parcelsRaw.length === 0 && beacons.length >= 3) {
    boundaries.push({
      label: "Parcel",
      vertices: [...beacons, { ...beacons[0]! }], // closed ring
    });
  }

  // ─── Field points (unlabeled survey points) ─────────────────────
  // Topographic TIN vertices: tin.vertices[] → {easting, northing, elevation}.
  const tin = asRecord(rec.tin);
  if (tin) {
    asArray(tin.vertices).forEach((v, i) => {
      const p = pointCoords(v);
      if (p) fieldPoints.push({ label: `T${i + 1}`, ...p });
    });
  }
  // Topographic spot heights: spotHeights[].
  asArray(rec.spotHeights).forEach((s, i) => {
    const p = pointCoords(s);
    if (p) fieldPoints.push({ label: `S${i + 1}`, ...p });
  });
  // Setting-out: designPoints[] + controlPoints[].
  asArray(rec.designPoints).forEach((d, i) => {
    const p = pointCoords(d);
    if (p) fieldPoints.push({ label: `D${i + 1}`, ...p });
  });
  asArray(rec.controlPoints).forEach((c, i) => {
    const p = beaconPoint(c, `C${i + 1}`);
    if (p) beacons.push(p);
  });

  // ─── Topographic contours ───────────────────────────────────────
  // result.contours[] → { elevation, coordinates: [[e,n], …], closed }
  // (the exact shape SurveyCanvas renders in TopographicView). Also
  // accepts output.tin.contours as an alternate location, and defensive
  // object-shaped vertices ({ easting, northing }) alongside the pair form.
  const contoursSrc =
    asArray(rec.contours).length > 0
      ? asArray(rec.contours)
      : asArray(asRecord(rec.tin)?.contours);
  for (const c of contoursSrc) {
    const crec = asRecord(c);
    if (!crec) continue;
    const elevation = num(crec.elevation);
    if (elevation === null) continue;
    const rawCoords = asArray(crec.coordinates);
    if (rawCoords.length < 2) continue;
    const vertices: MapPoint[] = [];
    let clean = true;
    for (const raw of rawCoords) {
      const pair = pairCoords(raw) ?? pointCoords(raw);
      if (!pair) {
        clean = false;
        break;
      }
      vertices.push({ label: `C${elevation.toFixed(1)}`, ...pair });
    }
    if (clean && vertices.length >= 2) {
      contours.push({
        elevation,
        vertices,
        closed: crec.closed === true || isClosedRing(vertices),
      });
    }
  }

  // ─── Per-beacon uncertainty (error ellipse) ─────────────────────
  // Merged AFTER every beacon source (allBeacons, parcel.beacons,
  // controlPoints) has been collected. Cadastral workflows emit
  // uncertainty: Record<label, PointUncertainty> (Form 3 output);
  // topo/engineering emit pointUncertainty keyed by index/label. An
  // inline per-beacon uncertainty (read in beaconPoint) always wins.
  const uncByLabel = asRecord(rec.uncertainty) ?? asRecord(rec.pointUncertainty);
  if (uncByLabel) {
    for (const b of beacons) {
      if (b.uncertainty) continue;
      const u = asRecord(uncByLabel[b.label]);
      if (u) {
        const nu = normalizeUncertainty(u);
        if (nu) b.uncertainty = nu;
      }
    }
  }

  return { beacons, boundaries, fieldPoints, contours };
}

/** True if a boundary ring is closed (first vertex repeats at the end). */
function isClosedRing(vertices: MapPoint[]): boolean {
  if (vertices.length < 4) return false;
  const a = vertices[0]!;
  const b = vertices[vertices.length - 1]!;
  return a.easting === b.easting && a.northing === b.northing;
}

/**
 * A single parcel/section plan within a project (for batch export).
 */
export interface MapParcel {
  label: string;
  geometry: MapGeometry;
}

/**
 * Split a survey output into one plan per parcel for batch export.
 *
 * Strategy (honest, defensive):
 *   1. An explicit `parcels[]` array in the output (the Form 4 /
 *      mutation-plan subdivision shape) wins — each parcel keeps its own
 *      boundary (+ its own beacons if provided, else the shared set).
 *   2. Otherwise, if the extracted geometry carries ≥2 closed rings, one
 *      plan per ring (a subdivision expressed as multiple boundaries).
 *   3. Otherwise a single parcel plan covering the whole geometry.
 *
 * Open polylines (engineering alignments) are never split.
 */
export function splitGeometryIntoParcels(
  output: unknown,
  geometry: MapGeometry,
): MapParcel[] {
  const rec = asRecord(output);
  const parcelsRaw = asArray(rec?.parcels);

  // Path 1: explicit parcels[] (subdivision output).
  if (parcelsRaw.length >= 2) {
    const parcels: MapParcel[] = [];
    parcelsRaw.forEach((p, i) => {
      const prec = asRecord(p);
      const label =
        typeof prec?.label === "string" ? prec.label
        : typeof prec?.parcelNo === "string" || typeof prec?.parcelNo === "number" ? String(prec.parcelNo)
        : `Parcel ${i + 1}`;
      const pBoundary = asRecord(prec?.boundary);
      const vertices = asArray(pBoundary?.vertices)
        .map((v, j) => beaconPoint(v, `V${j + 1}`))
        .filter((v): v is MapPoint => v !== null);
      // Parcel-local beacons when present, else the shared beacon set.
      const pBeacons = asArray(prec?.beacons)
        .map((b, j) => beaconPoint(b, `B${j + 1}`))
        .filter((b): b is MapPoint => b !== null);
      parcels.push({
        label,
        geometry: {
          beacons: pBeacons.length > 0 ? pBeacons : geometry.beacons,
          boundaries: vertices.length >= 3 ? [{ label, vertices }] : [],
          fieldPoints: geometry.fieldPoints,
          contours: geometry.contours,
        },
      });
    });
    if (parcels.length >= 2) return parcels;
  }

  // Path 2: ≥2 closed rings in the geometry → one plan per ring.
  const closed = geometry.boundaries.filter((b) => isClosedRing(b.vertices));
  if (closed.length >= 2) {
    return closed.map((b) => ({
      label: b.label,
      geometry: {
        beacons: geometry.beacons,
        boundaries: [b],
        fieldPoints: geometry.fieldPoints,
        contours: geometry.contours,
      },
    }));
  }

  // Path 3: single plan for the whole geometry.
  return [{ label: "Parcel", geometry }];
}

/**
 * Auto-export decision for a survey output.
 *
 * - "skip"    → nothing plottable (no beacons/boundaries/field points)
 * - "booklet" → ≥2 parcels/sections (subdivision / mutation-plan output)
 * - "png"     → a single plan sheet covers the whole geometry
 *
 * Pure so workflow views + the main process agree on what to produce
 * without sharing logic across the IPC boundary.
 */
export function detectAutoExportKind(output: unknown): "png" | "booklet" | "skip" {
  const geometry = extractMapGeometry(output);
  if (
    geometry.beacons.length === 0 &&
    geometry.boundaries.length === 0 &&
    geometry.fieldPoints.length === 0 &&
    geometry.contours.length === 0
  ) {
    return "skip";
  }
  return splitGeometryIntoParcels(output, geometry).length >= 2 ? "booklet" : "png";
}

/** Human-readable summary of the extracted geometry for the map status line. */
export function summarizeGeometry(geo: MapGeometry): string {
  const parts: string[] = [];
  if (geo.beacons.length > 0) parts.push(`${geo.beacons.length} beacon${geo.beacons.length === 1 ? "" : "s"}`);
  if (geo.boundaries.length > 0) parts.push(`${geo.boundaries.length} boundar${geo.boundaries.length === 1 ? "y" : "ies"}`);
  if (geo.fieldPoints.length > 0) parts.push(`${geo.fieldPoints.length} field point${geo.fieldPoints.length === 1 ? "" : "s"}`);
  if (geo.contours.length > 0) parts.push(`${geo.contours.length} contour${geo.contours.length === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" · ") : "no plottable geometry";
}
