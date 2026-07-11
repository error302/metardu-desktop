/**
 * Combined Scale Factor (CSF) Engine — v0.3
 *
 * Solves the grid-vs-ground area discrepancy that is a legal timebomb in Kenya.
 * Nairobi is at ~1,600m elevation. UTM Zone 37S central meridian is at 39°E.
 * A 100ha parcel can have a 0.3-0.5ha discrepancy between grid area and
 * physical ground area. The deed plan must state the correct area.
 *
 * CSF = k × Fh
 *   k  = Grid Scale Factor (UTM projection distortion at the given longitude)
 *   Fh = Elevation Factor (height above ellipsoid / Earth radius)
 *
 * Ground Area = Grid Area / CSF²
 *
 * Sources:
 * - UTM grid scale factor: k = 0.9996 / cosh(asinh(tan(φ)) - atanh(e·sin(φ))·e) ... simplified
 *   For practical purposes, k ≈ 0.9996 + (x_offset / R)² / 2 where x_offset is
 *   distance from central meridian in metres.
 * - Elevation factor: Fh = R / (R + h) where R = 6,371,000m, h = ellipsoidal height
 *
 * For Kenya UTM zones:
 *   Zone 36S: central meridian = 33°E
 *   Zone 37S: central meridian = 39°E
 */

import { shoelaceArea } from '@/lib/engine/area'

// ─── Constants ──────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000 // Mean Earth radius (spherical approximation)
const UTM_SCALE_AT_CENTRAL_MERIDIAN = 0.9996 // Standard UTM scale factor

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ScaleFactorInput {
  /** Latitude in decimal degrees */
  latitude: number
  /** Longitude in decimal degrees */
  longitude: number
  /** UTM zone (36 or 37 for Kenya) */
  utmZone: number
  /** Ellipsoidal height in metres (from GNSS, NOT orthometric) */
  ellipsoidalHeight: number
}

export interface ScaleFactorResult {
  /** Grid scale factor (UTM projection distortion) */
  gridScaleFactor: number
  /** Elevation factor (height above ellipsoid) */
  elevationFactor: number
  /** Combined scale factor = grid × elevation */
  combinedScaleFactor: number
  /** Distance from central meridian in metres */
  distanceFromCentralMeridian: number
  /** Central meridian longitude in degrees */
  centralMeridian: number
  /** Scale factor as a ratio (e.g., 1:1.0004) */
  scaleRatio: string
  /** Percentage distortion */
  percentDistortion: number
}

export interface AreaConversionResult {
  /** Area computed from grid coordinates (shoelace formula) */
  gridAreaSqM: number
  /** Area converted to ground (physical surface) */
  groundAreaSqM: number
  /** Area in hectares (ground) */
  groundAreaHa: number
  /** Area in acres (ground) */
  groundAreaAcres: number
  /** The CSF used for conversion */
  csf: number
  /** Difference in m² */
  differenceSqM: number
  /** Difference in hectares */
  differenceHa: number
  /** Percentage difference */
  percentDifference: number
}

// ─── Scale factor computation ───────────────────────────────────────────────

/**
 * Compute the Combined Scale Factor for a point at a given location and elevation.
 *
 * @param input Location + elevation
 * @returns Scale factor breakdown
 */
export function computeCombinedScaleFactor(input: ScaleFactorInput): ScaleFactorResult {
  const { latitude, longitude, utmZone, ellipsoidalHeight } = input

  // AUDIT FIX (M5, 2026-07-02): Replaced spherical approximation with
  // the rigorous ellipsoidal point scale factor formula. The old code
  // used EARTH_RADIUS_M = 6,371,000 (mean sphere) and
  // mPerDegLon = 111,320 × cos(φ) — both spherical approximations that
  // introduce ~0.1-0.3 ppm error at Nairobi distances. The rigorous
  // formula uses the ellipsoidal meridional and prime-vertical radii.

  // WGS84 / Arc 1960 ellipsoid parameters (Clarke 1880 for Arc 1960
  // is very close to WGS84 for scale factor purposes — the difference
  // is sub-ppm at Kenya latitudes)
  const a = 6_378_137.0           // Semi-major axis (metres)
  const f = 1 / 298.257223563     // Inverse flattening (WGS84)
  const e2 = 2 * f - f * f        // First eccentricity squared
  const ePrime2 = e2 / (1 - e2)   // Second eccentricity squared

  const latRad = (latitude * Math.PI) / 180
  const sinLat = Math.sin(latRad)
  const cosLat = Math.cos(latRad)
  const sinLat2 = sinLat * sinLat
  const cosLat2 = cosLat * cosLat

  // Radii of curvature (ellipsoidal)
  // ρ = a(1-e²) / (1-e²sin²φ)^(3/2)  — meridional radius
  // ν = a / √(1-e²sin²φ)              — prime vertical radius
  // Rm = √(ρ·ν)                        — geometric mean radius
  const oneMinusE2Sin2 = 1 - e2 * sinLat2
  const rho = (a * (1 - e2)) / Math.pow(oneMinusE2Sin2, 1.5)
  const nu = a / Math.sqrt(oneMinusE2Sin2)
  const Rm = Math.sqrt(rho * nu)

  // Central meridian for this UTM zone
  const centralMeridian = utmZone * 6 - 183 // Zone 36 → 33°, Zone 37 → 39°

  // Distance from central meridian in metres — use the ellipsoidal
  // prime-vertical radius (not the spherical 111,320 m/°):
  // dE = (λ - λ₀) × ν × cos(φ)   (in radians)
  const lonDiffRad = ((longitude - centralMeridian) * Math.PI) / 180
  const distanceFromCM = Math.abs(lonDiffRad * nu * cosLat)

  // Grid scale factor (UTM projection) — rigorous 2nd-order formula:
  // k = k₀ × (1 + E'²/(2Rm²) × (1 + e'²cos²φ) + E'⁴/(24Rm⁴))
  // where E' is the distance from the central meridian
  const Eprime2 = distanceFromCM * distanceFromCM
  const Eprime4 = Eprime2 * Eprime2
  const Rm2 = Rm * Rm
  const Rm4 = Rm2 * Rm2

  const gridScaleFactor = UTM_SCALE_AT_CENTRAL_MERIDIAN * (
    1 +
    (Eprime2 / (2 * Rm2)) * (1 + ePrime2 * cosLat2) +
    (Eprime4 / (24 * Rm4))
  )

  // Elevation factor — use the ellipsoidal prime-vertical radius (not
  // the mean Earth radius). At 1800m elevation (Nairobi), this gives
  // Fh = ν / (ν + h) ≈ 0.99972 (vs 0.99972 for spherical — the
  // difference is sub-ppm at this elevation, but it's the correct formula).
  const elevationFactor = nu / (nu + ellipsoidalHeight)

  // Combined scale factor
  const combinedScaleFactor = gridScaleFactor * elevationFactor

  // Scale ratio (e.g., 1:1.0004 → "1 : 1.0004")
  const scaleRatio = `1 : ${combinedScaleFactor.toFixed(6)}`

  // Percentage distortion
  const percentDistortion = ((combinedScaleFactor - 1) * 100)

  return {
    gridScaleFactor,
    elevationFactor,
    combinedScaleFactor,
    distanceFromCentralMeridian: distanceFromCM,
    centralMeridian,
    scaleRatio,
    percentDistortion,
  }
}

// ─── Area conversion ────────────────────────────────────────────────────────

/**
 * Convert grid area (from UTM coordinates) to ground area (physical surface).
 *
 * Ground Area = Grid Area / CSF²
 *
 * This is the critical calculation for deed plan accuracy. The grid area
 * from the shoelace formula on UTM coordinates is NOT the physical area
 * on the ground. At Nairobi (1,600m, Zone 37S), the difference can be
 * 0.3-0.5 hectares on a 100ha parcel.
 *
 * @param gridAreaSqM Area from coordinate shoelace formula (m²)
 * @param csf Combined scale factor
 * @returns Ground area + difference
 */
export function convertGridAreaToGround(
  gridAreaSqM: number,
  csf: number,
): AreaConversionResult {
  const groundAreaSqM = gridAreaSqM / (csf * csf)
  const groundAreaHa = groundAreaSqM / 10_000
  const groundAreaAcres = groundAreaSqM / 4_046.86

  const differenceSqM = groundAreaSqM - gridAreaSqM
  const differenceHa = differenceSqM / 10_000
  const percentDifference = gridAreaSqM > 0 ? ((differenceSqM / gridAreaSqM) * 100) : 0

  return {
    gridAreaSqM,
    groundAreaSqM,
    groundAreaHa,
    groundAreaAcres,
    csf,
    differenceSqM,
    differenceHa,
    percentDifference,
  }
}

// ─── Convenience: compute area with scale factor ────────────────────────────

/**
 * Compute the shoelace area of a polygon, then apply the combined scale factor
 * to get the true ground area.
 *
 * @param coords Array of [easting, northing] UTM coordinates
 * @param csf Combined scale factor
 * @returns Both grid and ground area
 */
export function computeAreaWithScaleFactor(
  coords: [number, number][],
  csf: number,
): AreaConversionResult {
  const gridAreaSqM = shoelaceArea(coords.map(([e, n]) => ({ easting: e, northing: n })))
  return convertGridAreaToGround(gridAreaSqM, csf)
}

// computeShoelaceArea removed — now uses canonical shoelaceArea from @/lib/engine/area

// ─── Kenya-specific presets ─────────────────────────────────────────────────

export const KENYA_LOCATIONS = [
  { name: 'Nairobi', latitude: -1.2864, longitude: 36.8172, utmZone: 37, elevation: 1798 },
  { name: 'Mombasa', latitude: -4.0435, longitude: 39.6682, utmZone: 37, elevation: 50 },
  { name: 'Kisumu', latitude: -0.0917, longitude: 34.7680, utmZone: 36, elevation: 1131 },
  { name: 'Nakuru', latitude: -0.3031, longitude: 36.0800, utmZone: 37, elevation: 1850 },
  { name: 'Eldoret', latitude: 0.5143, longitude: 35.2698, utmZone: 36, elevation: 2100 },
  { name: 'Meru', latitude: 0.0463, longitude: 37.6459, utmZone: 37, elevation: 1520 },
  { name: 'Garissa', latitude: -0.4536, longitude: 39.6461, utmZone: 37, elevation: 151 },
  { name: 'Kakamega', latitude: 0.2827, longitude: 34.7519, utmZone: 36, elevation: 1535 },
  { name: 'Nyeri', latitude: -0.4201, longitude: 36.9476, utmZone: 37, elevation: 1760 },
  { name: 'Kitale', latitude: 1.0156, longitude: 35.0060, utmZone: 36, elevation: 1900 },
] as const
