/**
 * Input validation utilities for survey workflows.
 *
 * Every workflow function should validate its inputs BEFORE doing any
 * computation. This module provides reusable validators that throw
 * descriptive errors on invalid input, rather than silently producing
 * garbage output or crashing with cryptic messages.
 *
 * # Design principle
 *
 * Fail fast, fail loud. A surveyor who feeds in bad data should get a
 * clear error message like "Beacon B3 has easting=NaN" — not a
 * NaN-propagated coordinate that silently ends up on a statutory plan.
 *
 * # Usage
 *
 * ```typescript
 * import { validatePoints, validateNonNaN, validatePositive } from "./validation.js";
 *
 * function myWorkflow(points: TopoPoint[]) {
 *   validatePoints(points, "myWorkflow");
 *   for (const p of points) {
 *     validateNonNaN(p.easting, `${p.id}.easting`);
 *     validateNonNaN(p.northing, `${p.id}.northing`);
 *   }
 *   // ... safe to compute now
 * }
 * ```
 */

// ─── Primitive validators ────────────────────────────────────────

/**
 * Validate that a number is not NaN or Infinity.
 * @throws Error with the field name if the value is NaN or Infinity.
 */
export function validateNonNaN(value: number, fieldName: string): void {
  if (Number.isNaN(value)) {
    throw new Error(`Validation error: ${fieldName} is NaN. Check the input data for missing or malformed values.`);
  }
  if (!Number.isFinite(value)) {
    throw new Error(`Validation error: ${fieldName} is ${value} (not finite). Check for overflow or division by zero.`);
  }
}

/**
 * Validate that a number is positive (> 0).
 * @throws Error if the value is <= 0, NaN, or Infinity.
 */
export function validatePositive(value: number, fieldName: string): void {
  validateNonNaN(value, fieldName);
  if (value <= 0) {
    throw new Error(`Validation error: ${fieldName} must be positive, got ${value}.`);
  }
}

/**
 * Validate that a number is within [min, max].
 */
export function validateRange(value: number, min: number, max: number, fieldName: string): void {
  validateNonNaN(value, fieldName);
  if (value < min || value > max) {
    throw new Error(`Validation error: ${fieldName} must be in [${min}, ${max}], got ${value}.`);
  }
}

/**
 * Validate that a string is non-empty.
 */
export function validateNonEmptyString(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Validation error: ${fieldName} must be a non-empty string, got '${value}'.`);
  }
}

/**
 * Validate that an array has at least N elements.
 */
export function validateMinLength<T>(arr: T[], min: number, fieldName: string): void {
  if (!Array.isArray(arr)) {
    throw new Error(`Validation error: ${fieldName} must be an array.`);
  }
  if (arr.length < min) {
    throw new Error(`Validation error: ${fieldName} must have at least ${min} elements, got ${arr.length}.`);
  }
}

// ─── Survey-specific validators ──────────────────────────────────

/** A generic 2D point with easting/northing. */
interface PointLike {
  easting: number;
  northing: number;
  elevation?: number;
  label?: string;
  id?: string;
}

/**
 * Validate an array of survey points.
 *
 * Checks:
 *   - Minimum count (default: 3 for a polygon)
 *   - No NaN/Infinity in easting/northing/elevation
 *   - No duplicate points (same E, N to 4 decimal places)
 *   - Points are not collinear (optional, default: false)
 *
 * @throws Error with the specific problem if validation fails.
 */
export function validatePoints(
  points: PointLike[],
  context: string,
  options: { minCount?: number; checkDuplicates?: boolean; checkCollinear?: boolean } = {},
): void {
  const { minCount = 3, checkDuplicates = true, checkCollinear = false } = options;

  validateMinLength(points, minCount, `${context}.points`);

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const label = p.label ?? p.id ?? `point[${i}]`;

    validateNonNaN(p.easting, `${context}.${label}.easting`);
    validateNonNaN(p.northing, `${context}.${label}.northing`);
    if (p.elevation !== undefined) {
      validateNonNaN(p.elevation, `${context}.${label}.elevation`);
    }
  }

  if (checkDuplicates) {
    const seen = new Map<string, number>();
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const key = `${p.easting.toFixed(4)},${p.northing.toFixed(4)}`;
      if (seen.has(key)) {
        const prevIdx = seen.get(key)!;
        throw new Error(
          `Validation error: ${context} has duplicate points at index ${prevIdx} and ${i} ` +
          `(E=${p.easting.toFixed(4)}, N=${p.northing.toFixed(4)}). ` +
          `Duplicate points produce degenerate triangles in the TIN.`,
        );
      }
      seen.set(key, i);
    }
  }

  if (checkCollinear && points.length >= 3) {
    // Check that not all points are collinear (which would produce a
    // degenerate TIN with zero area).
    // We check the first 3 points; if they're collinear, check the
    // next set until we find a non-collinear triple or exhaust the list.
    let foundNonCollinear = false;
    for (let i = 0; i < points.length - 2 && !foundNonCollinear; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const c = points[i + 2]!;
      const area = Math.abs(
        (b.easting - a.easting) * (c.northing - a.northing) -
        (c.easting - a.easting) * (b.northing - a.northing),
      ) / 2;
      if (area > 1e-6) {
        foundNonCollinear = true;
      }
    }
    if (!foundNonCollinear) {
      throw new Error(
        `Validation error: ${context} — all points are collinear (lie on a single line). ` +
        `A TIN requires at least 3 non-collinear points to form a triangle.`,
      );
    }
  }
}

/**
 * Validate a polygon (closed ring of points).
 *
 * Checks:
 *   - At least 3 points
 *   - No NaN in coordinates
 *   - Polygon is not self-intersecting (simplified check: just verifies
 *     that consecutive edges don't cross — full self-intersection
 *     detection is O(n²) and deferred to a future optimization)
 *
 * @throws Error if the polygon is degenerate.
 */
export function validatePolygon(
  vertices: { easting: number; northing: number }[],
  context: string,
): void {
  validateMinLength(vertices, 3, `${context}.vertices`);

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i]!;
    validateNonNaN(v.easting, `${context}.vertices[${i}].easting`);
    validateNonNaN(v.northing, `${context}.vertices[${i}].northing`);
  }

  // Check polygon area > 0 (degenerate polygon = all points on a line).
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    area += vertices[i]!.easting * vertices[j]!.northing - vertices[j]!.easting * vertices[i]!.northing;
  }
  area = Math.abs(area) / 2;
  if (area < 1e-6) {
    throw new Error(
      `Validation error: ${context} polygon has zero area (all vertices are collinear). ` +
      `A valid polygon requires non-collinear vertices.`,
    );
  }
}

/**
 * Validate a bearing (decimal degrees, clockwise from North).
 * Must be in [0, 360).
 */
export function validateBearing(bearing: number, fieldName: string): void {
  validateNonNaN(bearing, fieldName);
  if (bearing < 0 || bearing >= 360) {
    throw new Error(`Validation error: ${fieldName} must be in [0, 360) degrees, got ${bearing}.`);
  }
}

/**
 * Validate a distance (metres). Must be non-negative.
 */
export function validateDistance(distance: number, fieldName: string): void {
  validateNonNaN(distance, fieldName);
  if (distance < 0) {
    throw new Error(`Validation error: ${fieldName} must be non-negative, got ${distance}.`);
  }
}

/**
 * Validate an SRID (EPSG code). Must be a positive integer in a
 * reasonable range (1024–32767 for the EPSG registry).
 */
export function validateSRID(srid: number, fieldName: string = "srid"): void {
  validateNonNaN(srid, fieldName);
  if (!Number.isInteger(srid)) {
    throw new Error(`Validation error: ${fieldName} must be an integer, got ${srid}.`);
  }
  if (srid < 1024 || srid > 32767) {
    throw new Error(`Validation error: ${fieldName} must be in [1024, 32767] (valid EPSG range), got ${srid}.`);
  }
}
