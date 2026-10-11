/**
 * Geoid-grid interpolation and height conversion.
 *
 * This module does not bundle a geoid model. A computed height is only as
 * defensible as the caller-supplied, versioned grid and its vertical datum.
 * No approximate or out-of-coverage fallback is permitted.
 */

/** Metadata that must travel with a loaded, authoritative model grid. */
export interface GeoidModel {
  id: string;
  name: string;
  version: string;
  source: string;
  checksumSha256: string;
  referenceEllipsoid: string;
  verticalDatum: string;
  /** Only populate when the model authority states an accuracy for this use. */
  accuracyM?: number;
}

/**
 * Metadata catalog of grids bundled or installed and ready for computation.
 * It is intentionally empty until METARDU has verified model packages.
 */
export const GEOID_MODELS: Readonly<Record<string, GeoidModel>> = Object.freeze({});

/**
 * A regular grid with its provenance and reference surfaces.
 * Values are metres, row-major from the north-west corner.
 */
export interface GeoidGrid extends GeoidModel {
  /** South edge (degrees). */
  south: number;
  /** West edge (degrees). */
  west: number;
  /** Positive grid spacing in latitude (degrees). */
  latStep: number;
  /** Positive grid spacing in longitude (degrees). */
  lngStep: number;
  rows: number;
  cols: number;
  values: Float64Array;
}

function validateGrid(grid: GeoidGrid): void {
  if (!grid || typeof grid !== "object") {
    throw new TypeError("A verified geoid grid is required");
  }
  if (
    !grid.id?.trim() ||
    !grid.name?.trim() ||
    !grid.version?.trim() ||
    !grid.source?.trim() ||
    !/^[a-f0-9]{64}$/i.test(grid.checksumSha256) ||
    !grid.referenceEllipsoid?.trim() ||
    !grid.verticalDatum?.trim()
  ) {
    throw new TypeError("Geoid grid provenance and reference metadata are required");
  }
  if (grid.accuracyM !== undefined && (!Number.isFinite(grid.accuracyM) || grid.accuracyM <= 0)) {
    throw new RangeError("Declared geoid accuracy must be a positive finite value");
  }
  if (
    !Number.isInteger(grid.rows) ||
    !Number.isInteger(grid.cols) ||
    grid.rows < 2 ||
    grid.cols < 2 ||
    !Number.isFinite(grid.south) ||
    !Number.isFinite(grid.west) ||
    !Number.isFinite(grid.latStep) ||
    !Number.isFinite(grid.lngStep) ||
    grid.latStep <= 0 ||
    grid.lngStep <= 0 ||
    grid.values.length !== grid.rows * grid.cols
  ) {
    throw new RangeError("Geoid grid dimensions or spacing are invalid");
  }
}

/**
 * Interpolate geoid undulation at a point using bilinear interpolation.
 * Returns null outside the grid. Invalid grid metadata or nodata in the
 * interpolation cell throws; it never substitutes zero or another model.
 */
export function interpolateUndulation(
  grid: GeoidGrid,
  lat: number,
  lng: number,
): number | null {
  validateGrid(grid);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new RangeError("Latitude and longitude must be finite geographic coordinates");
  }

  const north = grid.south + (grid.rows - 1) * grid.latStep;
  const east = grid.west + (grid.cols - 1) * grid.lngStep;
  if (lat < grid.south || lat > north || lng < grid.west || lng > east) {
    return null;
  }

  const rowFrac = (north - lat) / grid.latStep;
  const colFrac = (lng - grid.west) / grid.lngStep;
  const row0 = Math.min(Math.floor(rowFrac), grid.rows - 2);
  const col0 = Math.min(Math.floor(colFrac), grid.cols - 2);
  const dr = rowFrac - row0;
  const dc = colFrac - col0;

  const i00 = row0 * grid.cols + col0;
  const i10 = i00 + 1;
  const i01 = (row0 + 1) * grid.cols + col0;
  const i11 = i01 + 1;
  const corners = [grid.values[i00], grid.values[i10], grid.values[i01], grid.values[i11]];
  if (corners.some((value) => value === undefined || !Number.isFinite(value))) {
    throw new RangeError("Geoid grid interpolation cell contains nodata or non-finite values");
  }
  const [f00, f10, f01, f11] = corners as [number, number, number, number];

  return (
    (1 - dc) * (1 - dr) * f00 +
    dc * (1 - dr) * f10 +
    (1 - dc) * dr * f01 +
    dc * dr * f11
  );
}

/** Convert ellipsoidal height to orthometric height: H = h - N. */
export function ellipsoidalToOrthometric(
  ellipsoidalHeight: number,
  undulation: number,
): number {
  if (!Number.isFinite(ellipsoidalHeight) || !Number.isFinite(undulation)) {
    throw new RangeError("Height and geoid undulation must be finite values");
  }
  return ellipsoidalHeight - undulation;
}

/** Convert orthometric height to ellipsoidal height: h = H + N. */
export function orthometricToEllipsoidal(
  orthometricHeight: number,
  undulation: number,
): number {
  if (!Number.isFinite(orthometricHeight) || !Number.isFinite(undulation)) {
    throw new RangeError("Height and geoid undulation must be finite values");
  }
  return orthometricHeight + undulation;
}

/**
 * Convert using a caller-supplied grid. The caller is responsible for
 * validating the grid bytes and its CRS/vertical-datum applicability before
 * constructing GeoidGrid. Outside-grid and nodata cases fail closed.
 */
export function convertHeight(
  lat: number,
  lng: number,
  ellipsoidalHeight: number,
  grid: GeoidGrid,
): {
  orthometric: number;
  undulation: number;
  model: GeoidModel;
} {
  if (!Number.isFinite(ellipsoidalHeight)) {
    throw new RangeError("Ellipsoidal height must be finite");
  }
  const undulation = interpolateUndulation(grid, lat, lng);
  if (undulation === null) {
    throw new RangeError(`Coordinate is outside geoid grid ${grid.id}; no fallback is available`);
  }
  return {
    orthometric: ellipsoidalToOrthometric(ellipsoidalHeight, undulation),
    undulation,
    model: {
      id: grid.id,
      name: grid.name,
      version: grid.version,
      source: grid.source,
      checksumSha256: grid.checksumSha256,
      referenceEllipsoid: grid.referenceEllipsoid,
      verticalDatum: grid.verticalDatum,
      ...(grid.accuracyM === undefined ? {} : { accuracyM: grid.accuracyM }),
    },
  };
}

/**
 * Legacy placeholder retained to turn old callers into an explicit failure.
 * METARDU does not contain an EGM2008 grid or a validated approximation.
 * @deprecated Load a versioned GeoidGrid and call convertHeight instead.
 */
export function egm2008Approximate(_lat: number, _lng: number): never {
  throw new Error("EGM2008 grid data is not installed; approximate geoid output is disabled");
}

/** Legacy Kenya city offsets were illustrative, not authoritative grid values. */
export const KENYA_GEOID_VALUES: Readonly<Record<string, { lat: number; lng: number; undulation: number }>> = Object.freeze({});
