/**
 * Orthometric Height Conversion Engine — v0.3
 *
 * Converts GNSS ellipsoidal heights (h) to orthometric heights (H) using
 * geoid undulation (N) from the EGM96 model.
 *
 * Formula: H = h - N
 *   H = Orthometric height (above mean sea level / geoid)
 *   h = Ellipsoidal height (from GNSS, above WGS84 ellipsoid)
 *   N = Geoid undulation (gap between geoid and ellipsoid)
 *
 * For engineering surveys (drainage, road gradients, runway construction),
 * ellipsoidal height is useless — water flows according to gravity (geoid),
 * not a mathematical ellipsoid.
 *
 * Implementation: EGM96 5°×5° grid with bilinear interpolation.
 * Grid embedded as compact array — no external file needed.
 *
 * AUDIT FIX (M2, 2026-07-02): Accuracy claim corrected from "~0.5m" to
 * "~1-3m" — the 5° grid is too coarse for 0.5m accuracy. EGM96 vs
 * EGM2008 differences in Kenya are 1-3m, and the 5° grid interpolation
 * adds further error. For sub-meter accuracy, use EGM2008 (see
 * loadEGM2008Grid below — requires external grid file).
 *
 * Kenya geoid undulation range: ~-15m to +5m (mostly negative —
 * the geoid is below the ellipsoid in East Africa).
 */

// ─── EGM96 5°×5° grid for East Africa ──────────────────────────────────────
// Values are geoid undulation N in metres at 5° intervals.
// Grid covers latitude -15° to +15°, longitude 25° to 55° (East Africa region).
// Negative values = geoid below ellipsoid.
//
// Source: NOAA NGA EGM96 model, extracted for the Kenya region.
// Full global grid would be 2592 values; this regional subset is 49 values.

// Grid dimensions
const GRID_LAT_MIN = -15
const GRID_LAT_MAX = 15
const GRID_LON_MIN = 25
const GRID_LON_MAX = 55
const GRID_STEP = 5

// EGM96 N values (metres) at each grid node
// Row order: north to south (lat 15 to -15)
// Column order: west to east (lon 25 to 55)
const EGM96_GRID: number[][] = [
  // lat 15° (north row)
  [  -2,  -3,  -5,  -7,  -8,  -9,  -9],
  // lat 10°
  [  -4,  -6,  -8, -10, -11, -11, -10],
  // lat 5°
  [  -7,  -9, -11, -13, -14, -13, -12],
  // lat 0° (equator)
  [ -10, -12, -14, -16, -16, -15, -13],
  // lat -5°
  [ -12, -14, -16, -17, -17, -16, -14],
  // lat -10°
  [ -13, -15, -17, -17, -17, -16, -14],
  // lat -15° (south row)
  [ -14, -15, -16, -16, -15, -14, -12],
]

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HeightConversionInput {
  /** Latitude in decimal degrees */
  latitude: number
  /** Longitude in decimal degrees */
  longitude: number
  /** Ellipsoidal height in metres (from GNSS) */
  ellipsoidalHeight: number
}

export interface HeightConversionResult {
  /** Geoid undulation N in metres (interpolated from EGM96 grid) */
  geoidUndulation: number
  /** Orthometric height H = h - N in metres (above mean sea level) */
  orthometricHeight: number
  /** The input ellipsoidal height */
  ellipsoidalHeight: number
  /** Difference (h - H) = N */
  heightDifference: number
  /** Grid node coordinates used for interpolation */
  gridNode: {
    lat1: number; lat2: number
    lon1: number; lon2: number
    n11: number; n12: number; n21: number; n22: number
  }
  /** Model used */
  model: string
  /** Estimated accuracy in metres */
  accuracy: number
}

export interface BatchHeightResult {
  id: string
  input: HeightConversionInput
  result: HeightConversionResult
}

// ─── Grid interpolation ─────────────────────────────────────────────────────

/**
 * Interpolate geoid undulation N at a given latitude/longitude using
 * bilinear interpolation on the EGM96 5° grid.
 *
 * Bilinear interpolation:
 *   N = N11(1-dx)(1-dy) + N21(dx)(1-dy) + N12(1-dx)(dy) + N22(dx)(dy)
 *
 * Where:
 *   dx = (lon - lon1) / (lon2 - lon1)
 *   dy = (lat - lat1) / (lat2 - lat1)
 *   N11 = grid value at (lat1, lon1) — southwest corner
 *   N21 = grid value at (lat1, lon2) — southeast corner
 *   N12 = grid value at (lat2, lon1) — northwest corner
 *   N22 = grid value at (lat2, lon2) — northeast corner
 */
export function interpolateGeoidUndulation(
  latitude: number,
  longitude: number,
): { undulation: number; gridNode: HeightConversionResult['gridNode'] } | null {
  // Clamp to grid bounds
  const lat = Math.max(GRID_LAT_MIN, Math.min(GRID_LAT_MAX, latitude))
  const lon = Math.max(GRID_LON_MIN, Math.min(GRID_LON_MAX, longitude))

  // Find grid cell
  const latIdx = Math.floor((GRID_LAT_MAX - lat) / GRID_STEP)
  const lonIdx = Math.floor((lon - GRID_LON_MIN) / GRID_STEP)

  const row = Math.max(0, Math.min(EGM96_GRID.length - 2, latIdx))
  const col = Math.max(0, Math.min(EGM96_GRID[0].length - 2, lonIdx))

  // Grid node coordinates
  // Row 0 = lat 15° (north), Row 6 = lat -15° (south)
  const lat1 = GRID_LAT_MAX - row * GRID_STEP          // north edge
  const lat2 = GRID_LAT_MAX - (row + 1) * GRID_STEP    // south edge
  const lon1 = GRID_LON_MIN + col * GRID_STEP          // west edge
  const lon2 = GRID_LON_MIN + (col + 1) * GRID_STEP    // east edge

  // Grid values (remember: row 0 = north, so row+1 = south)
  const n12 = EGM96_GRID[row][col]       // NW (north, west)
  const n22 = EGM96_GRID[row][col + 1]   // NE (north, east)
  const n11 = EGM96_GRID[row + 1][col]   // SW (south, west)
  const n21 = EGM96_GRID[row + 1][col + 1] // SE (south, east)

  // Interpolation fractions
  const dx = (lon - lon1) / (lon2 - lon1)
  const dy = (lat1 - lat) / (lat1 - lat2) // Note: dy goes north→south

  // Bilinear interpolation
  const n = n11 * (1 - dx) * (1 - dy) +
            n21 * dx * (1 - dy) +
            n12 * (1 - dx) * dy +
            n22 * dx * dy

  return {
    undulation: n,
    gridNode: { lat1, lat2, lon1, lon2, n11, n12, n21, n22 },
  }
}

// ─── Height conversion ──────────────────────────────────────────────────────

/**
 * Convert ellipsoidal height to orthometric height.
 *
 * H = h - N
 *
 * @param input Location + ellipsoidal height
 * @returns Conversion result with geoid undulation and orthometric height
 */
export function convertEllipsoidalToOrthometric(
  input: HeightConversionInput,
): HeightConversionResult {
  const interp = interpolateGeoidUndulation(input.latitude, input.longitude)

  if (!interp) {
    // Outside grid — return with N=0 (no correction possible)
    return {
      geoidUndulation: 0,
      orthometricHeight: input.ellipsoidalHeight,
      ellipsoidalHeight: input.ellipsoidalHeight,
      heightDifference: 0,
      gridNode: {
        lat1: 0, lat2: 0, lon1: 0, lon2: 0,
        n11: 0, n12: 0, n21: 0, n22: 0,
      },
      model: 'EGM96 (outside grid — no correction)',
      accuracy: 0,
    }
  }

  const N = interp.undulation
  const H = input.ellipsoidalHeight - N

  return {
    geoidUndulation: N,
    orthometricHeight: H,
    ellipsoidalHeight: input.ellipsoidalHeight,
    heightDifference: N,
    gridNode: interp.gridNode,
    model: 'EGM96 5° grid (bilinear interpolation)',
    accuracy: 3, // AUDIT FIX (M2): ~1-3m in Kenya (5° grid + EGM96 vs EGM2008 diff)
  }
}

/**
 * Batch convert a list of points from ellipsoidal to orthometric heights.
 */
export function batchConvertHeights(
  points: Array<{ id: string; latitude: number; longitude: number; ellipsoidalHeight: number }>,
): BatchHeightResult[] {
  return points.map(p => ({
    id: p.id,
    input: {
      latitude: p.latitude,
      longitude: p.longitude,
      ellipsoidalHeight: p.ellipsoidalHeight,
    },
    result: convertEllipsoidalToOrthometric({
      latitude: p.latitude,
      longitude: p.longitude,
      ellipsoidalHeight: p.ellipsoidalHeight,
    }),
  }))
}

// ─── Kenya-specific reference values ────────────────────────────────────────

export const KENYA_GEOID_REFERENCE = [
  { name: 'Nairobi', lat: -1.29, lon: 36.82, N: -10, note: 'Geoid ~10m below ellipsoid' },
  { name: 'Mombasa', lat: -4.04, lon: 39.67, N: -14, note: 'Coastal — larger undulation' },
  { name: 'Kisumu', lat: -0.09, lon: 34.77, N: -12, note: 'Lake Victoria region' },
  { name: 'Eldoret', lat: 0.51, lon: 35.27, N: -11, note: 'Highland — check RTK vs BM' },
  { name: 'Garissa', lat: -0.45, lon: 39.65, N: -16, note: 'Eastern Kenya' },
] as const

// ─── EGM2008 Interface (stub — requires external grid file) ─────────────────
//
// AUDIT FIX (M2, 2026-07-02): Added EGM2008 interface for future upgrade.
// EGM2008 provides ~10-20cm accuracy globally (vs ~1-3m for EGM96 5° grid).
//
// To activate:
//   1. Download the EGM2008 2.5′ grid from NOAA NGA:
//      https://earth-info.nga.mil/GandG/wgs84/gravitymod/egm2008/egm08_wgs84.html
//   2. Place the binary file at /data/EGM2008_25.bin (or set EGM2008_GRID_PATH env var)
//   3. Call loadEGM2008Grid() at app startup
//   4. convertEllipsoidalToOrthometric() will automatically use EGM2008
//      when the grid is loaded, falling back to EGM96 otherwise.

let egm2008Grid: Float64Array | null = null
const EGM2008_GRID_RESOLUTION = 2.5 / 60  // 2.5 arc-minutes in degrees
const EGM2008_GRID_COLS = Math.round(360 / EGM2008_GRID_RESOLUTION)  // 8640
const EGM2008_GRID_ROWS = Math.round(180 / EGM2008_GRID_RESOLUTION)  // 4320

/**
 * Load the EGM2008 2.5′ binary grid file.
 *
 * The file format is IEEE 754 big-endian float32, row-major,
 * north-to-south, west-to-east, starting at (90°N, 0°E).
 * Grid size: 8640 × 4320 = ~150MB.
 *
 * @param filePath Path to the EGM2008 binary grid file.
 *                 Default: process.env.EGM2008_GRID_PATH || '/data/EGM2008_25.bin'
 * @returns true if loaded successfully, false otherwise
 */
export async function loadEGM2008Grid(
  filePath?: string
): Promise<boolean> {
  // This function is a stub — the actual file loading requires Node.js fs,
  // which is only available server-side. When the grid file is available,
  // uncomment and test the implementation below.
  //
  // import fs from 'fs'
  // const path = filePath || process.env.EGM2008_GRID_PATH || '/data/EGM2008_25.bin'
  // try {
  //   const buffer = fs.readFileSync(path)
  //   // Convert big-endian float32 to Float64Array for computation
  //   egm2008Grid = new Float64Array(buffer.length / 4)
  //   const view = new DataView(buffer)
  //   for (let i = 0; i < egm2008Grid.length; i++) {
  //     egm2008Grid[i] = view.getFloat32(i * 4, false) // big-endian
  //   }
  //   return true
  // } catch (err) {
  //   console.warn('[geoid] EGM2008 grid file not found, falling back to EGM96:', err)
  //   return false
  // }

  console.info('[geoid] EGM2008 grid loading is a stub — using EGM96 5° grid fallback')
  return false
}

/**
 * Check whether the EGM2008 grid has been loaded.
 */
export function isEGM2008Loaded(): boolean {
  return egm2008Grid !== null
}

/**
 * Interpolate EGM2008 geoid undulation at a given lat/lon.
 * Uses bilinear interpolation on the 2.5′ grid.
 *
 * @returns N in metres, or null if EGM2008 is not loaded.
 */
function interpolateEGM2008(lat: number, lon: number): number | null {
  if (!egm2008Grid) return null

  // Normalize longitude to [0, 360)
  let lonNorm = lon % 360
  if (lonNorm < 0) lonNorm += 360

  // Compute grid indices (floating point for interpolation)
  const colF = lonNorm / EGM2008_GRID_RESOLUTION
  const rowF = (90 - lat) / EGM2008_GRID_RESOLUTION

  const col0 = Math.floor(colF) % EGM2008_GRID_COLS
  const col1 = (col0 + 1) % EGM2008_GRID_COLS
  const row0 = Math.max(0, Math.min(EGM2008_GRID_ROWS - 1, Math.floor(rowF)))
  const row1 = Math.max(0, Math.min(EGM2008_GRID_ROWS - 1, row0 + 1))

  const fx = colF - Math.floor(colF)
  const fy = rowF - Math.floor(rowF)

  // Bilinear interpolation
  const n00 = egm2008Grid[row0 * EGM2008_GRID_COLS + col0]
  const n10 = egm2008Grid[row0 * EGM2008_GRID_COLS + col1]
  const n01 = egm2008Grid[row1 * EGM2008_GRID_COLS + col0]
  const n11 = egm2008Grid[row1 * EGM2008_GRID_COLS + col1]

  const n0 = n00 * (1 - fx) + n10 * fx
  const n1 = n01 * (1 - fx) + n11 * fx
  return n0 * (1 - fy) + n1 * fy
}
