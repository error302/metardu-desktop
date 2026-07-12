/**
 * Beacon Reference Database — Offline-Cached Spatial Lookup
 * =========================================================
 *
 * A spatial query layer over the Survey of Kenya beacon database
 * (trig beacons, bench marks, control points). Optimized for field
 * use: the full database is cached locally so queries work without
 * internet, and spatial queries use accurate haversine distance
 * (not bounding-box approximation).
 *
 * Why this exists
 * ---------------
 * Surveyors spend hours searching SoK archives for nearby control
 * points when starting a new survey. A built-in lookup that works
 * offline saves that time. The existing src/lib/online/benchmarks.ts
 * uses bounding-box distance (Pythagorean on lat/lon degrees) which
 * is fine for filtering but inaccurate for distance reporting. This
 * module adds proper haversine distance and a local cache.
 *
 * What lives here
 * ---------------
 *   - Haversine distance (accurate great-circle distance on the
 *     ellipsoid, ±0.3% vs Vincenty)
 *   - Spatial nearest-K query: "find the 5 nearest trig beacons
 *     to this coordinate, within 10 km"
 *   - Offline cache: the full database is held in memory; queries
 *     never hit the network. Future work: persist to IndexedDB
 *     for cross-session offline use.
 *   - Bearing computation: "what bearing is the nearest BM from
 *     my current position?" — helps surveyors locate physical marks.
 *
 * Usage
 * -----
 *   import { findNearestBeacons } from '@/lib/survey/beaconLookup'
 *
 *   const results = await findNearestBeacons({
 *     latitude: -1.2921,
 *     longitude: 36.8219,
 *     radiusKm: 10,
 *     limit: 5,
 *     types: ['TRIG', 'BM'],
 *   })
 *
 *   for (const beacon of results.beacons) {
 *     console.log(`${beacon.name}: ${beacon.distanceKm.toFixed(2)} km at ${beacon.bearingDeg.toFixed(0)}°`)
 *   }
 */

import { BENCHMARK_DATABASE, type Benchmark } from '@/lib/online/benchmarks'

// ─── Types ──────────────────────────────────────────────────────────────

export type BeaconType = 'BM' | 'CP' | 'TRIG' | 'TIDAL'

export interface BeaconSearchParams {
  latitude: number
  longitude: number
  /** Maximum distance in kilometres. Default: 50 km. */
  radiusKm?: number
  /** Maximum number of results to return (sorted nearest first). Default: 10. */
  limit?: number
  /** Filter by beacon type. Omit to include all types. */
  types?: BeaconType[]
  /** Filter by country (case-insensitive). Omit for all countries. */
  country?: string
}

export interface BeaconSearchResult {
  /** Beacon with distance and bearing from the search point. */
  beacon: Benchmark
  /** Distance from search point in kilometres (haversine). */
  distanceKm: number
  /** Initial bearing from search point to beacon, in degrees (0-360). */
  bearingDeg: number
}

export interface BeaconSearchResponse {
  beacons: BeaconSearchResult[]
  total: number
  searchPoint: { latitude: number; longitude: number }
  radiusKm: number
  /** Time spent on the query, in milliseconds. */
  elapsedMs: number
  /** True if results came from the local cache (always true for now). */
  fromCache: boolean
}

// ─── Haversine distance ────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI
}

/**
 * Haversine great-circle distance between two lat/lon points.
 * Accurate to ±0.3% vs Vincenty's formulae — more than enough for
 * beacon location (we're not doing geodesy here, just navigation).
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}

/**
 * Initial bearing (forward azimuth) from point 1 to point 2.
 * Returns degrees 0-360, where 0 = north, 90 = east.
 *
 * Uses the standard spherical bearing formula. The bearing is
 * "initial" — it changes as you travel along the great circle.
 * For short distances (< 100 km) the change is negligible.
 */
export function bearingDegrees(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = toRadians(lat1)
  const φ2 = toRadians(lat2)
  const Δλ = toRadians(lon2 - lon1)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (toDegrees(Math.atan2(y, x)) + 360) % 360
}

// ─── Cache ──────────────────────────────────────────────────────────────

/**
 * In-memory cache of beacons with lat/lon coordinates.
 * Beacons without coordinates are excluded (can't do spatial search).
 *
 * Future work: persist to IndexedDB for cross-session offline use.
 * For now, the in-memory cache is populated on first query and
 * survives for the lifetime of the process.
 */
let cachedBeacons: Benchmark[] | null = null

function getCachedBeacons(): Benchmark[] {
  if (cachedBeacons === null) {
    cachedBeacons = BENCHMARK_DATABASE.filter(
      (b: Benchmark) =>
        b.latitude !== undefined && b.longitude !== undefined
    )
  }
  return cachedBeacons as Benchmark[]
}

/**
 * Force a cache rebuild on next query. Useful after database updates.
 */
export function invalidateBeaconCache(): void {
  cachedBeacons = null
}

/**
 * Get cache statistics (for UI display / debugging).
 */
export function getCacheStats(): {
  totalBeacons: number
  beaconsWithCoordinates: number
  isCached: boolean
} {
  const all = BENCHMARK_DATABASE
  const withCoords = all.filter(
    (b: Benchmark) => b.latitude !== undefined && b.longitude !== undefined
  )
  return {
    totalBeacons: all.length,
    beaconsWithCoordinates: withCoords.length,
    isCached: cachedBeacons !== null,
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Find the nearest beacons to a coordinate.
 *
 * Uses haversine distance for accuracy. Results are sorted nearest-first.
 * Filters by radius, type, and country before sorting.
 *
 * @returns beacons within radiusKm, sorted nearest-first, limited to `limit`
 */
export async function findNearestBeacons(
  params: BeaconSearchParams
): Promise<BeaconSearchResponse> {
  const startTime = Date.now()
  const {
    latitude,
    longitude,
    radiusKm = 50,
    limit = 10,
    types,
    country,
  } = params

  const allBeacons = getCachedBeacons()

  // Filter + compute distance
  const results: BeaconSearchResult[] = []
  for (const beacon of allBeacons) {
    // Type filter
    if (types && !types.includes(beacon.type as BeaconType)) continue

    // Country filter
    if (country && beacon.country.toLowerCase() !== country.toLowerCase()) continue

    const distanceKm = haversineDistanceKm(
      latitude,
      longitude,
      beacon.latitude!,
      beacon.longitude!
    )

    // Radius filter
    if (distanceKm > radiusKm) continue

    const bearingDeg = bearingDegrees(
      latitude,
      longitude,
      beacon.latitude!,
      beacon.longitude!
    )

    results.push({ beacon, distanceKm, bearingDeg })
  }

  // Sort nearest-first
  results.sort((a, b) => a.distanceKm - b.distanceKm)

  // Limit
  const limited = results.slice(0, limit)

  return {
    beacons: limited,
    total: results.length,
    searchPoint: { latitude, longitude },
    radiusKm,
    elapsedMs: Date.now() - startTime,
    fromCache: true,
  }
}

/**
 * Get a single beacon by ID. Returns null if not found.
 */
export async function getBeaconById(id: string): Promise<Benchmark | null> {
  return BENCHMARK_DATABASE.find((b: Benchmark) => b.id === id) ?? null
}

/**
 * Format a beacon search result as a human-readable summary.
 * Useful for display in the UI or for a surveyor's field sheet.
 */
export function formatBeaconResults(response: BeaconSearchResponse): string {
  if (response.beacons.length === 0) {
    return `No beacons found within ${response.radiusKm} km of ${response.searchPoint.latitude.toFixed(4)}, ${response.searchPoint.longitude.toFixed(4)}.`
  }

  const lines: string[] = [
    `${response.total} beacon(s) within ${response.radiusKm} km (showing nearest ${response.beacons.length}, ${response.elapsedMs}ms):`,
    '',
  ]

  for (const { beacon, distanceKm, bearingDeg } of response.beacons) {
    const bearingLabel = formatBearing(bearingDeg)
    lines.push(
      `  ${beacon.name} (${beacon.type}): ${distanceKm.toFixed(2)} km ${bearingLabel} — ${beacon.elevation.toFixed(3)} m ${beacon.datum}`
    )
  }

  return lines.join('\n')
}

/**
 * Convert a bearing in degrees to a 16-point compass label.
 * 0° = N, 22.5° = NNE, 45° = NE, etc.
 */
function formatBearing(bearingDeg: number): string {
  const labels = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ]
  const idx = Math.round(bearingDeg / 22.5) % 16
  return `${labels[idx]} (${bearingDeg.toFixed(0)}°)`
}
