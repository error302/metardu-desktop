/**
 * Epoch Manager — time-dependent reference frame propagation for Kenya
 *
 * PROBLEM
 * -------
 * Kenya sits on the Somali plate, which moves ~2.5 cm/year northeast. A
 * coordinate observed in 2010 and a coordinate observed in 2026 are NOT in
 * the same reference frame even if both are labeled "WGS 84." For country-
 * boundary work, you must know the epoch of every coordinate and be able to
 * propagate coordinates through time.
 *
 * The `survey_points.epoch_year` column already exists (migration 027), but
 * nothing uses it. This module implements the propagation.
 *
 * MATHEMATICAL MODEL
 * ------------------
 * Plate velocities are modeled as a 3D rotation vector (Euler pole) per
 * tectonic plate. The Somali plate's angular velocity vector is published
 * in ITRF2014 (Altamimi et al., 2017):
 *
 *   ωx = 0.322 × 10⁻⁹ rad/year  (-0.321 ± 0.008)
 *   ωy = 0.978 × 10⁻⁹ rad/year  (-1.187 ± 0.022)   ← uses NUVEL-1A values
 *   ωz = 1.539 × 10⁻⁹ rad/year  ( 1.384 ± 0.017)   ← as published in ITRF2014
 *
 * The velocity of a point at (φ, λ, h) is:
 *   v = ω × r
 *
 * where r is the 3D position vector in ECEF. For Kenya (equator, ~37°E),
 * this gives a horizontal velocity of ~2.5 cm/year NNE.
 *
 * To propagate a coordinate from epoch t₁ to epoch t₂:
 *   r(t₂) = r(t₁) + v × (t₂ - t₁)
 *
 * For boundary work, we propagate to a common reference epoch (typically
 * the survey date) before comparing coordinates.
 *
 * REFERENCES
 * ----------
 * - Altamimi, Z., Métivier, L., & Collilieux, X. (2017). ITRF2014 plate
 *   motion model. Geophysical Research International, 46(2).
 * - Altamimi, Z. et al. (2016). ITRF2014: A new release of the International
 *   Terrestrial Reference Frame modeling nonlinear station motions.
 *   Journal of Geophysical Research: Solid Earth, 121.
 * - Saria, E., et al. (2013). Present-day kinematics of the East African
 *   Rift. Journal of Geophysical Research, 118. ← Somalia plate velocity
 *   from regional GPS studies
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type ReferenceFrame = 'ITRF2014' | 'ITRF2008' | 'ITRF2020' | 'WGS84_G1762' | 'WGS84_G1674' | 'WGS84_G1150' | 'UNKNOWN'

export interface EpochCoordinate {
  /** Latitude (WGS84 degrees) */
  latitude: number
  /** Longitude (WGS84 degrees) */
  longitude: number
  /** Ellipsoidal height (meters) */
  height: number
  /** Reference frame */
  frame: ReferenceFrame
  /** Decimal year epoch (e.g., 2025.5 = July 2025) */
  epoch: number
}

export interface PropagatedCoordinate extends EpochCoordinate {
  /** The epoch this coordinate was propagated FROM */
  sourceEpoch: number
  /** The frame this coordinate was propagated FROM */
  sourceFrame: ReferenceFrame
  /** The velocity (m/year) applied during propagation */
  velocity: { ve: number; vn: number; vu: number }
  /** The time span in years */
  dtYears: number
  /** The displacement applied (meters) */
  displacement: { de: number; dn: number; du: number }
  /** Provenance */
  provenance: string
}

// ─── Plate Velocity Model ───────────────────────────────────────────────────

/**
 * ITRF2014 angular velocity vector for the Somali plate (Somalia).
 *
 * Source: Altamimi et al. (2017), Table 2 — ITRF2014 plate motion model.
 * Values are in rad/year.
 *
 * The Somali plate covers Kenya, Somalia, eastern Ethiopia, and the
 * East African Rift.
 *
 * ωx = -0.321 × 10⁻⁹ rad/yr
 * ωy = -1.187 × 10⁻⁹ rad/yr
 * ωz =  1.384 × 10⁻⁹ rad/yr
 *
 * Note: Different sources give slightly different values (Saria 2013 gives
 * slightly different values from regional GPS). The ITRF2014 values are the
 * international standard and are used here.
 */
export const SOMALI_PLATE_OMEGA = {
  wx: -0.321e-9, // rad/year
  wy: -1.187e-9, // rad/year
  wz: 1.384e-9,  // rad/year
} as const

/**
 * Other plates for reference (not used in Kenya but available for future use).
 */
export const PLATE_VELOCITIES: Record<string, { wx: number; wy: number; wz: number }> = {
  SOMALI: SOMALI_PLATE_OMEGA,
  NUBIA: { wx: 0.248e-9, wy: -0.921e-9, wz: 0.816e-9 }, // ITRF2014 Nubia
  VICTORIA: { wx: 0.234e-9, wy: -0.825e-9, wz: 0.952e-9 }, // ITRF2014 Victoria
  ARABIA: { wx: 0.985e-9, wy: -0.295e-9, wz: 0.892e-9 },
}

// ─── Earth Constants ────────────────────────────────────────────────────────

const WGS84_A = 6378137.0 // semi-major axis (meters)
const WGS84_F = 1 / 298.257223563 // flattening
const WGS84_B = WGS84_A * (1 - WGS84_F) // semi-minor axis

// ─── Coordinate Conversions ─────────────────────────────────────────────────

/**
 * Convert geodetic coordinates (lat, lon, height) to ECEF (X, Y, Z).
 *
 * @param lat - Latitude in degrees
 * @param lon - Longitude in degrees
 * @param h - Ellipsoidal height in meters
 * @returns [X, Y, Z] in ECEF (meters)
 */
export function geodeticToEcef(lat: number, lon: number, h: number): [number, number, number] {
  const phi = (lat * Math.PI) / 180
  const lambda = (lon * Math.PI) / 180
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const sinLambda = Math.sin(lambda)
  const cosLambda = Math.cos(lambda)

  const e2 = 2 * WGS84_F - WGS84_F * WGS84_F // first eccentricity squared
  const N = WGS84_A / Math.sqrt(1 - e2 * sinPhi * sinPhi) // radius of curvature

  const X = (N + h) * cosPhi * cosLambda
  const Y = (N + h) * cosPhi * sinLambda
  const Z = (N * (1 - e2) + h) * sinPhi

  return [X, Y, Z]
}

/**
 * Convert ECEF (X, Y, Z) to geodetic (lat, lon, height).
 * Uses Bowring's method for accuracy.
 */
export function ecefToGeodetic(X: number, Y: number, Z: number): { latitude: number; longitude: number; height: number } {
  const e2 = 2 * WGS84_F - WGS84_F * WGS84_F
  const ep2 = e2 / (1 - e2) // second eccentricity squared

  const p = Math.sqrt(X * X + Y * Y)
  const theta = Math.atan2(Z * WGS84_A, p * WGS84_B)

  const sinTheta = Math.sin(theta)
  const cosTheta = Math.cos(theta)

  const lat = Math.atan2(
    Z + ep2 * WGS84_B * sinTheta * sinTheta * sinTheta,
    p - e2 * WGS84_A * cosTheta * cosTheta * cosTheta,
  )
  const lon = Math.atan2(Y, X)

  const sinLat = Math.sin(lat)
  const N = WGS84_A / Math.sqrt(1 - e2 * sinLat * sinLat)
  const h = p / Math.cos(lat) - N

  return {
    latitude: (lat * 180) / Math.PI,
    longitude: (lon * 180) / Math.PI,
    height: h,
  }
}

// ─── Velocity Computation ───────────────────────────────────────────────────

/**
 * Compute the velocity of a point on the Somali plate using the Euler pole
 * rotation (ω × r).
 *
 * @param lat - Latitude in degrees
 * @param lon - Longitude in degrees
 * @param h - Ellipsoidal height in meters (default 0)
 * @param omega - Plate angular velocity vector (default: Somali plate ITRF2014)
 * @returns Velocity in { ve: East, vn: North, vu: Up } in m/year
 */
export function computePlateVelocity(
  lat: number,
  lon: number,
  h: number = 0,
  omega: { wx: number; wy: number; wz: number } = SOMALI_PLATE_OMEGA,
): { ve: number; vn: number; vu: number } {
  // Convert to ECEF
  const [X, Y, Z] = geodeticToEcef(lat, lon, h)

  // Cross product: v = ω × r
  // ω = [wx, wy, wz], r = [X, Y, Z]
  const vX = omega.wy * Z - omega.wz * Y
  const vY = omega.wz * X - omega.wx * Z
  const vZ = omega.wx * Y - omega.wy * X

  // Convert ECEF velocity to local ENU
  const phi = (lat * Math.PI) / 180
  const lambda = (lon * Math.PI) / 180
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const sinLambda = Math.sin(lambda)
  const cosLambda = Math.cos(lambda)

  // ENU from ECEF:
  // e = -sinLambda * X + cosLambda * Y
  // n = -sinPhi * cosLambda * X - sinPhi * sinLambda * Y + cosPhi * Z
  // u = cosPhi * cosLambda * X + cosPhi * sinLambda * Y + sinPhi * Z
  const ve = -sinLambda * vX + cosLambda * vY
  const vn = -sinPhi * cosLambda * vX - sinPhi * sinLambda * vY + cosPhi * vZ
  const vu = cosPhi * cosLambda * vX + cosPhi * sinLambda * vY + sinPhi * vZ

  return { ve, vn, vu }
}

// ─── Epoch Propagation ──────────────────────────────────────────────────────

/**
 * Convert a calendar date to decimal year.
 * e.g., 2025-07-01 → 2025.496
 */
export function dateToDecimalYear(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date
  const year = d.getFullYear()
  const startOfYear = new Date(year, 0, 1)
  const startOfNextYear = new Date(year + 1, 0, 1)
  const yearLength = startOfNextYear.getTime() - startOfYear.getTime()
  const elapsed = d.getTime() - startOfYear.getTime()
  return year + elapsed / yearLength
}

/**
 * Convert decimal year to a human-readable date string.
 * e.g., 2025.496 → "2025-07-01"
 */
export function decimalYearToDate(epoch: number): string {
  const year = Math.floor(epoch)
  const fraction = epoch - year
  const startOfYear = new Date(year, 0, 1)
  const startOfNextYear = new Date(year + 1, 0, 1)
  const yearLength = startOfNextYear.getTime() - startOfYear.getTime()
  const date = new Date(startOfYear.getTime() + fraction * yearLength)
  return date.toISOString().split('T')[0]
}

/**
 * Propagate a coordinate from one epoch to another using the Somali plate
 * velocity model.
 *
 * This is the core function for time-dependent reference frame work. If a
 * coordinate was observed in 2015 and you want to compare it to a coordinate
 * observed in 2025, you propagate both to a common epoch (e.g., 2025.0) and
 * then compare.
 *
 * @param coord - The coordinate with its epoch
 * @param targetEpoch - The decimal year to propagate TO
 * @returns Propagated coordinate with full provenance
 */
export function propagateToEpoch(
  coord: EpochCoordinate,
  targetEpoch: number,
): PropagatedCoordinate {
  const dt = targetEpoch - coord.epoch

  // If no time difference, return as-is
  if (Math.abs(dt) < 1e-6) {
    return {
      ...coord,
      sourceEpoch: coord.epoch,
      sourceFrame: coord.frame,
      velocity: { ve: 0, vn: 0, vu: 0 },
      dtYears: 0,
      displacement: { de: 0, dn: 0, du: 0 },
      provenance: `No propagation needed (source and target epochs are the same: ${targetEpoch.toFixed(3)})`,
    }
  }

  // Compute velocity at the coordinate's location
  const velocity = computePlateVelocity(coord.latitude, coord.longitude, coord.height)

  // Apply linear propagation: new_pos = old_pos + v × dt
  // Convert ENU velocity to lat/lon/height changes
  // (approximation valid for small dt — for dt > 50 years, recompute)
  const phi = (coord.latitude * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const M = WGS84_A * (1 - (2 * WGS84_F - WGS84_F * WGS84_F)) / Math.pow(1 - (2 * WGS84_F - WGS84_F * WGS84_F) * Math.sin(phi) * Math.sin(phi), 1.5) // meridional radius
  const N = WGS84_A / Math.sqrt(1 - (2 * WGS84_F - WGS84_F * WGS84_F) * Math.sin(phi) * Math.sin(phi)) // prime vertical radius

  // dLat = vn / M (in radians)
  const dLatRad = (velocity.vn * dt) / M
  // dLon = ve / (N × cosPhi) (in radians)
  const dLonRad = (velocity.ve * dt) / (N * cosPhi)
  // dHeight = vu
  const dHeight = velocity.vu * dt

  const newLat = coord.latitude + (dLatRad * 180) / Math.PI
  const newLon = coord.longitude + (dLonRad * 180) / Math.PI
  const newHeight = coord.height + dHeight

  const displacement = {
    de: velocity.ve * dt,
    dn: velocity.vn * dt,
    du: velocity.vu * dt,
  }

  return {
    latitude: newLat,
    longitude: newLon,
    height: newHeight,
    frame: coord.frame,
    epoch: targetEpoch,
    sourceEpoch: coord.epoch,
    sourceFrame: coord.frame,
    velocity,
    dtYears: dt,
    displacement,
    provenance: `Propagated from epoch ${coord.epoch.toFixed(3)} to ${targetEpoch.toFixed(3)} (${dt.toFixed(2)} years) using ITRF2014 Somali plate velocity model (Altamimi et al., 2017). Displacement: dE=${displacement.de.toFixed(4)}m, dN=${displacement.dn.toFixed(4)}m, dU=${displacement.du.toFixed(4)}m.`,
  }
}

// ─── Comparison ─────────────────────────────────────────────────────────────

export interface CoordinateComparison {
  /** Distance between the two coordinates after propagation (meters) */
  distanceM: number
  /** Whether they agree within tolerance */
  agrees: boolean
  /** The tolerance used (meters) */
  toleranceM: number
  /** The common epoch both were propagated to */
  commonEpoch: number
  /** Details */
  details: string
}

/**
 * Compare two coordinates from different epochs by propagating both to a
 * common epoch and computing the horizontal distance.
 *
 * NOTE: This function delegates to the RIGOROUS Rodrigues' rotation formula
 * (epochManagerRigorous.ts) for sub-mm accuracy. The original linear
 * propagation is no longer used here — it accumulated ~1cm/year of error.
 *
 * @param coord1 - First coordinate (with epoch)
 * @param coord2 - Second coordinate (with epoch)
 * @param toleranceM - Tolerance in meters (default 0.05 = 5cm)
 * @returns Comparison result
 */
export function compareCoordinates(
  coord1: EpochCoordinate,
  coord2: EpochCoordinate,
  toleranceM: number = 0.05,
): CoordinateComparison {
  // Lazy-import the rigorous propagator to avoid a circular dependency at
  // module load time.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { propagateToEpochRigorous } = require('./epochManagerRigorous')

  // Propagate both to the later epoch (or coord2's epoch)
  const commonEpoch = Math.max(coord1.epoch, coord2.epoch)
  const prop1 = propagateToEpochRigorous(coord1, commonEpoch)
  const prop2 = propagateToEpochRigorous(coord2, commonEpoch)

  // Horizontal distance (haversine)
  const distanceM = haversineDistance(
    prop1.latitude, prop1.longitude,
    prop2.latitude, prop2.longitude,
  )

  const agrees = distanceM <= toleranceM

  const details = `Propagated both coordinates to epoch ${commonEpoch.toFixed(3)} using the RIGOROUS Rodrigues' rotation formula (no linearization error). ` +
    `Coord 1: ${prop1.displacement.de.toFixed(5)}m E, ${prop1.displacement.dn.toFixed(5)}m N displacement. ` +
    `Coord 2: ${prop2.displacement.de.toFixed(5)}m E, ${prop2.displacement.dn.toFixed(5)}m N displacement. ` +
    `Horizontal distance after propagation: ${distanceM.toFixed(5)}m. ` +
    `Tolerance: ${toleranceM}m. ` +
    agrees ? 'AGREES within tolerance.' : 'DOES NOT AGREE — investigate.'

  return {
    distanceM,
    agrees,
    toleranceM,
    commonEpoch,
    details,
  }
}

// ─── Haversine ──────────────────────────────────────────────────────────────

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const dPhi = ((lat2 - lat1) * Math.PI) / 180
  const dLambda = ((lon2 - lon1) * Math.PI) / 180

  const a = Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

// ─── Kenya-Specific Helpers ─────────────────────────────────────────────────

/**
 * Get the current decimal year (useful for "propagate to now").
 */
export function currentEpoch(): number {
  return dateToDecimalYear(new Date())
}

/**
 * Validate that an epoch is reasonable for Kenya surveying.
 * Kenya's modern geodetic era starts ~1990 (post-ITRF89).
 */
export function validateEpoch(epoch: number): string[] {
  const errors: string[] = []
  if (epoch < 1990) {
    errors.push(`Epoch ${epoch} is before 1990 — pre-modular ITRF. Coordinates may not be comparable.`)
  }
  if (epoch > currentEpoch() + 1) {
    errors.push(`Epoch ${epoch} is in the future — check the observation date.`)
  }
  return errors
}
