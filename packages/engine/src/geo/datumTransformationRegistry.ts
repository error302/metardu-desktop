/**
 * Datum Transformation Registry — provenance-tracked datum transformations
 *
 * PROBLEM
 * -------
 * The existing datumTransformer.ts uses the national-standard 7-parameter
 * Bursa-Wolf (EPSG:1165) for ALL transformations. This is correct for
 * general use, but for country-boundary and high-accuracy work, surveyors
 * need:
 *   1. Locally-calibrated transformations (derived from control points in
 *      the project area) that are more accurate than the national average
 *   2. Provenance tracking — every transformed coordinate records WHICH
 *      transformation was used, its source, and its expected accuracy
 *   3. Multiple realizations of WGS84 (G1150, G1674, G1762) which differ
 *      by centimeters — matters for boundary work
 *
 * SOLUTION
 * --------
 * A registry of transformation parameter sets. Each set has:
 *   - id (unique identifier)
 *   - name (human-readable)
 *   - method ('7param' | '3param' | 'grid')
 *   - parameters (dx, dy, dz, rx, ry, rz, ds)
 *   - source (citation — e.g., "EPSG:1165", "SoK 1994 adjustment",
 *     "Local calibration, Nairobi CBD, 2024-03-15")
 *   - accuracy (expected accuracy in meters, e.g., 5.0 for national, 0.05 for local)
 *   - validArea (bounding box or description)
 *   - createdAt / createdBy
 *
 * Every transform call returns the coordinate PLUS a ProvenanceRecord
 * describing which transformation was used. This record can be stored in
 * the database and displayed in the UI so a surveyor can always answer
 * "where did this coordinate come from?"
 *
 * REFERENCES
 * ----------
 * - EPSG:1165 — Arc 1960 → WGS84, Kenya, 7-parameter Bursa-Wolf
 * - EPSG:1314 — Bursa-Wolf transformation method
 * - Survey of Kenya, "The Geodetic Network of Kenya" (1994)
 * - Clarke 1880 (RGS) ellipsoid: a=6378249.145, 1/f=293.465
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type TransformMethod = '7param' | '3param' | 'grid' | 'identity'

export interface TransformParameters {
  /** Translation in X (meters) */
  dx: number
  /** Translation in Y (meters) */
  dy: number
  /** Translation in Z (meters) */
  dz: number
  /** Rotation about X (arc-seconds) */
  rx: number
  /** Rotation about Y (arc-seconds) */
  ry: number
  /** Rotation about Z (arc-seconds) */
  rz: number
  /** Scale change (ppm) */
  ds: number
}

export interface TransformationSet {
  /** Unique identifier (e.g., 'EPSG:1165', 'local-nairobi-cbd-2024') */
  id: string
  /** Human-readable name */
  name: string
  /** Transformation method */
  method: TransformMethod
  /** 7-parameter values (rx/ry/rz/ds are 0 for 3-param) */
  parameters: TransformParameters
  /** Source citation */
  source: string
  /** Expected accuracy in meters (95% confidence) */
  accuracy: number
  /** Area where this transformation is valid */
  validArea: {
    description: string
    /** Bounding box [minLon, minLat, maxLon, maxLat] or null if national */
    bbox?: [number, number, number, number]
  }
  /** When this parameter set was created/published */
  publishedAt: string
  /** Who created it (organization) */
  publishedBy: string
}

export interface ProvenanceRecord {
  /** Which transformation set was used */
  transformationId: string
  /** Human-readable name (for UI display) */
  transformationName: string
  /** Source citation */
  source: string
  /** Expected accuracy at 95% confidence */
  accuracyM: number
  /** Source CRS */
  fromCrs: string
  /** Target CRS */
  toCrs: string
  /** When the transform was applied */
  timestamp: string
  /** Who applied it */
  userId?: string
}

export interface TransformedCoordinate {
  /** The transformed coordinate */
  easting: number
  northing: number
  height?: number
  /** The CRS of the output */
  crs: string
  /** Provenance — which transformation was used */
  provenance: ProvenanceRecord
}

// ─── Registry ───────────────────────────────────────────────────────────────

/**
 * The registry of known transformation parameter sets.
 *
 * T1.5c FIX (2026-07-10): The national-standard 7-parameter (EPSG:1165) is
 * registered as the default. Projects can add locally-calibrated sets via
 * registerLocalTransformation().
 */
const registry = new Map<string, TransformationSet>()

// ─── Built-in: National Standard (EPSG:1165) ───────────────────────────────

const EPSG_1165: TransformationSet = {
  id: 'EPSG:1165',
  name: 'Arc 1960 → WGS84 (Kenya National Standard)',
  method: '7param',
  parameters: {
    dx: -160,
    dy: -6,
    dz: -302,
    rx: -0.807,
    ry: 0.339,
    rz: -1.619,
    ds: -2.554,
  },
  source: 'EPSG Geodetic Parameter Registry, transformation 1165. Arc 1960 to WGS 84 (7-parameter Bursa-Wolf per EPSG:1314). Published by Survey of Kenya.',
  accuracy: 5.0,
  validArea: {
    description: 'Kenya — national coverage',
    bbox: [33.5, -5.0, 42.0, 4.5],
  },
  publishedAt: '1994-01-01',
  publishedBy: 'Survey of Kenya',
}

// ─── Built-in: 3-parameter fallback (for legacy compatibility) ─────────────

const EPSG_1164_3PARAM: TransformationSet = {
  id: 'EPSG:1164-3param',
  name: 'Arc 1960 → WGS84 (3-parameter fallback)',
  method: '3param',
  parameters: {
    dx: -160,
    dy: -6,
    dz: -302,
    rx: 0,
    ry: 0,
    rz: 0,
    ds: 0,
  },
  source: 'EPSG transformation 1164 (3-parameter, translation only). Lower accuracy than 1165 — use only when 7-parameter is unavailable.',
  accuracy: 10.0,
  validArea: {
    description: 'Kenya — national coverage (approximate)',
    bbox: [33.5, -5.0, 42.0, 4.5],
  },
  publishedAt: '1994-01-01',
  publishedBy: 'Survey of Kenya',
}

// Register built-in sets
registry.set(EPSG_1165.id, EPSG_1165)
registry.set(EPSG_1164_3PARAM.id, EPSG_1164_3PARAM)

// ─── Registry API ───────────────────────────────────────────────────────────

/**
 * Get a transformation set by ID.
 * @throws Error if not found
 */
export function getTransformation(id: string): TransformationSet {
  const set = registry.get(id)
  if (!set) {
    throw new Error(`[datumRegistry] Unknown transformation: ${id}. Registered: ${Array.from(registry.keys()).join(', ')}`)
  }
  return set
}

/**
 * List all registered transformation sets.
 */
export function listTransformations(): TransformationSet[] {
  return Array.from(registry.values())
}

/**
 * Register a locally-calibrated transformation.
 *
 * This is for project-specific calibrations derived from control points
 * in the project area. The local set should be more accurate than the
 * national standard for that area.
 *
 * @example
 * registerLocalTransformation({
 *   id: 'local-nairobi-cbd-2024',
 *   name: 'Nairobi CBD Local Calibration (Mar 2024)',
 *   parameters: { dx: -159.2, dy: -5.8, dz: -301.1, rx: -0.79, ry: 0.34, rz: -1.62, ds: -2.55 },
 *   source: 'Local calibration using 8 SoK control points in Nairobi CBD, adjusted 2024-03-15',
 *   accuracy: 0.05,
 *   validArea: { description: 'Nairobi CBD (approx 5km radius)', bbox: [36.8, -1.3, 36.85, -1.25] },
 *   publishedAt: '2024-03-15',
 *   publishedBy: 'Survey firm XYZ',
 * })
 */
export function registerLocalTransformation(set: Omit<TransformationSet, 'method'> & { method?: TransformMethod }): void {
  const fullSet: TransformationSet = {
    ...set,
    method: set.method || '7param',
  }
  registry.set(fullSet.id, fullSet)
}

/**
 * Remove a locally-calibrated transformation (built-ins cannot be removed).
 */
export function unregisterTransformation(id: string): boolean {
  if (id === 'EPSG:1165' || id === 'EPSG:1164-3param') {
    return false // cannot remove built-ins
  }
  return registry.delete(id)
}

// ─── Provenance-tracked transform ───────────────────────────────────────────

/**
 * Transform coordinates with full provenance tracking.
 *
 * Returns the transformed coordinate PLUS a ProvenanceRecord describing
 * which transformation was used. Store this record in the database alongside
 * the coordinate so a surveyor can always answer "where did this come from?"
 *
 * @param lon - Longitude (WGS84 degrees)
 * @param lat - Latitude (WGS84 degrees)
 * @param targetCrs - Target CRS (e.g., 'EPSG:21037')
 * @param transformationId - Which transformation set to use (default: 'EPSG:1165')
 * @param userId - Optional: the user applying the transform
 * @returns TransformedCoordinate with provenance
 */
export function transformWithProvenance(
  lon: number,
  lat: number,
  targetCrs: string,
  transformationId: string = 'EPSG:1165',
  userId?: string,
): TransformedCoordinate {
  const ts = getTransformation(transformationId)

  // Build the proj4 definition string with the selected parameters
  const towgs84 = `${ts.parameters.dx},${ts.parameters.dy},${ts.parameters.dz},${ts.parameters.rx},${ts.parameters.ry},${ts.parameters.rz},${ts.parameters.ds}`
  const zone = targetCrs.includes('21036') ? 36 : 37
  const projDef = `+proj=utm +zone=${zone} +south +ellps=clrk80 +towgs84=${towgs84} +units=m +no_defs`

  // Use proj4 to transform
  // We import dynamically to avoid circular deps in SSR
  const result = transformViaProj4(lon, lat, projDef)

  const provenance: ProvenanceRecord = {
    transformationId: ts.id,
    transformationName: ts.name,
    source: ts.source,
    accuracyM: ts.accuracy,
    fromCrs: 'EPSG:4326',
    toCrs: targetCrs,
    timestamp: new Date().toISOString(),
    userId,
  }

  return {
    easting: result[0],
    northing: result[1],
    crs: targetCrs,
    provenance,
  }
}

/**
 * Get the proj4 towgs84 string for a transformation set.
 * Useful when registering projections with proj4.defs().
 */
export function getTowgs84String(transformationId: string = 'EPSG:1165'): string {
  const ts = getTransformation(transformationId)
  const p = ts.parameters
  return `${p.dx},${p.dy},${p.dz},${p.rx},${p.ry},${p.rz},${p.ds}`
}

// ─── Internal: proj4 transform ──────────────────────────────────────────────

/**
 * Synchronous proj4 transform. Uses the already-imported proj4 instance.
 * If proj4 isn't loaded yet, throws — callers should ensure proj4 is
 * registered before calling (via registerProjections()).
 */
function transformViaProj4(lon: number, lat: number, targetProjDef: string): [number, number] {
  // We use the global proj4 instance that's already registered with defs.
  // This is safe because registerProjections() is called on map init.
  // For server-side use, the caller must ensure proj4 is loaded.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const proj4 = (typeof window !== 'undefined')
    ? (window as any).proj4
    : require('proj4').default || require('proj4')

  // Register the target projection temporarily
  const tempKey = `__temp_${Date.now()}`
  proj4.defs(tempKey, targetProjDef)

  try {
    const [easting, northing] = proj4('EPSG:4326', tempKey, [lon, lat])
    return [easting, northing]
  } finally {
    // Clean up temp def (proj4 doesn't have a remove, but re-defining is harmless)
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate a transformation set's parameters.
 * Returns an array of error messages (empty = valid).
 */
export function validateTransformation(set: TransformationSet): string[] {
  const errors: string[] = []
  const p = set.parameters

  if (set.method === '7param') {
    if (p.rx === 0 && p.ry === 0 && p.rz === 0 && p.ds === 0) {
      errors.push('7-parameter set has all-zero rotations and scale — should this be 3-param?')
    }
  }

  // Sanity check: translations should be in the range of a few hundred meters
  // (typical datum shifts are < 1000m)
  if (Math.abs(p.dx) > 1000 || Math.abs(p.dy) > 1000 || Math.abs(p.dz) > 1000) {
    errors.push(`Translation values seem large (dx=${p.dx}, dy=${p.dy}, dz=${p.dz}) — verify units are meters`)
  }

  // Sanity check: rotations should be < 10 arc-seconds
  if (Math.abs(p.rx) > 10 || Math.abs(p.ry) > 10 || Math.abs(p.rz) > 10) {
    errors.push(`Rotation values seem large — verify units are arc-seconds`)
  }

  // Accuracy should be positive
  if (set.accuracy <= 0) {
    errors.push('Accuracy must be positive')
  }

  return errors
}
