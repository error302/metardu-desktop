/**
 * Spiral-to-Curve Alignment Engine
 *
 * Roadmap reference: docs/ROADMAP.md → Tier 2 → "Spiral-to-curve alignment
 * engine". Implements a full TS → SC → CS → ST alignment with clothoid
 * transition spirals on both ends of a circular curve.
 *
 * Stationing convention (Schofield / AASHTO):
 *
 *   TS (Tangent-to-Spiral)    start of entry spiral
 *   SC (Spiral-to-Curve)      end of entry spiral / start of circular curve
 *   CS (Curve-to-Spiral)      end of circular curve / start of exit spiral
 *   ST (Spiral-to-Tangent)    end of exit spiral
 *
 * Geometry (per AASHTO Green Book 2018 §3-Exhibit 3-22):
 *
 *   Δ     = intersection angle between approach and departure tangents (rad)
 *   R     = circular curve radius (m)
 *   Ls    = spiral length (m)
 *   θs    = Ls / (2R)              spiral angle (rad)
 *   p     = y - R·(1 - cos θs)     tangent shift (offset of curve from tangent)
 *   k     = x - R·sin θs           tangent extension (TS to shifted PI)
 *   T     = k + (R + p)·tan(Δ/2)   total tangent distance TS → PI
 *   Lc    = R·(Δ - 2θs)            circular curve length (m)
 *
 * The clothoid spiral coordinates (relative to TS, tangent along +X) are
 * computed via the standard series expansion (used by `transition.ts`).
 *
 * Output is a full station table plus a coordinate array that can be fed
 * directly to OpenLayers `LineString` or any other rendering layer.
 *
 * References:
 *   - Schofield, W. (2001) "Engineering Surveying", Chapter 12
 *   - AASHTO Green Book (2018), Chapter 3 — Horizontal Alignment
 *   - KeNHA Road Design Manual, Part 4 — Horizontal Curves
 */

import { computeSpiralCurve, type SpiralCurveInput, type SpiralCurveResult } from './transition'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SpiralAlignmentInput {
  /** Radius of the circular curve (metres). */
  radius: number
  /**
   * Intersection angle Δ in decimal degrees. This is the deflection
   * between the approach and departure tangents — i.e., 180° minus the
   * interior angle at the PI.
   */
  intersectionAngleDeg: number
  /** Spiral length Ls in metres (both spirals assumed equal). */
  spiralLength: number
  /** Chainage of the PI (Point of Intersection) in metres. */
  piChainage: number
  /**
   * Bearing of the approach tangent in decimal degrees (0° = North, clockwise).
   * Used to compute world coordinates; defaults to 0 (North).
   */
  approachBearingDeg?: number
  /** Easting of the PI (optional, for world-coordinate output). */
  piEasting?: number
  /** Northing of the PI (optional, for world-coordinate output). */
  piNorthing?: number
}

export interface SpiralAlignmentResult {
  /** Echoed input. */
  input: SpiralAlignmentInput
  /** Underlying spiral math (single spiral, applied symmetrically). */
  spiral: SpiralCurveResult
  /** Intersection angle in radians. */
  deltaRad: number
  /** Spiral angle θs in radians. */
  thetaSRad: number
  /** Tangent shift p (m). */
  p: number
  /** Tangent extension k (m, TS to shifted PI). */
  k: number
  /** Total tangent distance T (m, TS to PI). */
  T: number
  /** Circular curve length Lc (m, SC to CS). */
  Lc: number
  /** Total alignment length (m, TS to ST). Ls + Lc + Ls. */
  totalLength: number
  /** Chainage at TS. */
  tsChainage: number
  /** Chainage at SC. */
  scChainage: number
  /** Chainage at CS. */
  csChainage: number
  /** Chainage at ST. */
  stChainage: number
  /** World coordinates of TS (if PI coords supplied). */
  tsCoord: { easting: number; northing: number } | null
  /** World coordinates of SC. */
  scCoord: { easting: number; northing: number } | null
  /** World coordinates of CS. */
  csCoord: { easting: number; northing: number } | null
  /** World coordinates of ST. */
  stCoord: { easting: number; northing: number } | null
  /** World coordinates of PI (echoed). */
  piCoord: { easting: number; northing: number } | null
}

export interface AlignmentStation {
  /** Chainage (m). */
  chainage: number
  /** Distance from TS (m). */
  distanceFromTS: number
  /** Easting (m, world coords if PI supplied, else local). */
  easting: number
  /** Northing (m, world coords if PI supplied, else local). */
  northing: number
  /** Elevation/offset from tangent (m, +left of tangent). */
  offset: number
  /** Current segment. */
  segment: 'entry-spiral' | 'circular' | 'exit-spiral' | 'before' | 'after'
  /** Deflection angle from TS (decimal degrees, clockwise from approach tangent). */
  deflectionDeg: number
}

// ─── Math Helpers ───────────────────────────────────────────────────────────

const DEG = Math.PI / 180

/**
 * Compute a full TS → SC → CS → ST spiral alignment.
 *
 * The approach tangent is assumed to run from TS towards PI along the
 * +X axis (local coordinates). The departure tangent rotates by Δ
 * clockwise (right-hand curve). For a left-hand curve, supply a
 * negative intersection angle.
 */
export function computeSpiralAlignment(
  input: SpiralAlignmentInput
): SpiralAlignmentResult {
  const {
    radius,
    intersectionAngleDeg,
    spiralLength,
    piChainage,
    approachBearingDeg = 0,
    piEasting,
    piNorthing,
  } = input

  if (radius <= 0) throw new Error('Radius must be positive')
  if (spiralLength < 0) throw new Error('Spiral length must be non-negative')
  if (Math.abs(intersectionAngleDeg) < 1e-6) {
    throw new Error('Intersection angle must be non-zero')
  }

  // Single-spiral math (symmetric entry/exit)
  const spiralInput: SpiralCurveInput = {
    radius,
    designSpeed: 80, // placeholder, not used when Ls is derived externally
    c: 0.3,
  }
  const spiral = computeSpiralCurve(spiralInput)
  // Override the spiral length with the user-supplied value
  // (computeSpiralCurve derives Ls from speed; we override for direct control)
  const Ls = spiralLength
  const thetaS = Ls / (2 * radius)
  const deltaRad = Math.abs(intersectionAngleDeg) * DEG

  if (2 * thetaS >= deltaRad) {
    throw new Error(
      `Spiral angle ${thetaS / DEG}° × 2 ≥ intersection angle ${intersectionAngleDeg}° — no room for circular curve. Reduce Ls or increase Δ.`
    )
  }

  // Series expansion coordinates (Schofeld Eq. 12.8)
  const x = Ls * (1 - Math.pow(thetaS, 2) / 10 + Math.pow(thetaS, 4) / 216)
  const y = Ls * (thetaS / 3 - Math.pow(thetaS, 3) / 42 + Math.pow(thetaS, 5) / 1320)

  const p = y - radius * (1 - Math.cos(thetaS))
  const k = x - radius * Math.sin(thetaS)
  const T = k + (radius + p) * Math.tan(deltaRad / 2)
  const Lc = radius * (deltaRad - 2 * thetaS)
  const totalLength = 2 * Ls + Lc

  // Chainages
  const tsChainage = piChainage - T
  const scChainage = tsChainage + Ls
  const csChainage = scChainage + Lc
  const stChainage = csChainage + Ls

  // World coordinates (if PI supplied)
  let tsCoord: { easting: number; northing: number } | null = null
  let scCoord: { easting: number; northing: number } | null = null
  let csCoord: { easting: number; northing: number } | null = null
  let stCoord: { easting: number; northing: number } | null = null
  const piCoord =
    piEasting !== undefined && piNorthing !== undefined
      ? { easting: piEasting, northing: piNorthing }
      : null

  if (piCoord) {
    // Approach tangent direction (from TS to PI): approachBearing reversed
    const approachBrng = approachBearingDeg * DEG
    // TS is "behind" the PI along the approach tangent
    const dx = -T * Math.sin(approachBrng)
    const dy = -T * Math.cos(approachBrng)
    tsCoord = { easting: piCoord.easting + dx, northing: piCoord.northing + dy }

    // SC = TS + (x, y) in local frame, rotated by approachBearing
    // For a right-hand curve (positive Δ), Y points LEFT of the tangent
    scCoord = localToWorld(tsCoord, x, y, approachBrng)

    // CS = SC + circular arc (Δ - 2θs) along R
    // Center of circular curve is at distance (R + p) perpendicular to the
    // approach tangent, on the curve side. For right-hand curve, +Y direction.
    // Center = SC + R * (direction from curve to center)
    // Direction from SC to center: rotate tangent direction by 90° toward curve side
    // For right-hand curve: tangent +X, curve side +Y, center is at angle (90° + θs) from tangent at SC
    // Simpler: compute CS as SC rotated about center by (Δ - 2θs)
    const arcAngle = deltaRad - 2 * thetaS
    // Center of circular curve in local frame:
    // At SC, the tangent direction is rotated by θs from the original tangent.
    // The center is perpendicular to that, at distance R, on the inside of the curve.
    // For right-hand curve: center is at angle (90° + θs) from original tangent at TS.
    const centerLocalX = x - radius * Math.sin(thetaS)
    const centerLocalY = y + radius * Math.cos(thetaS)
    const centerWorld = localToWorld(tsCoord, centerLocalX, centerLocalY, approachBrng)
    // SC relative to center: rotate by -arcAngle to get CS (for right-hand curve, clockwise)
    // Vector from center to SC (local frame)
    const scRelCx = x - centerLocalX
    const scRelCy = y - centerLocalY
    // Rotate by -arcAngle (clockwise for right-hand curve)
    const csRelCx = scRelCx * Math.cos(-arcAngle) - scRelCy * Math.sin(-arcAngle)
    const csRelCy = scRelCx * Math.sin(-arcAngle) + scRelCy * Math.cos(-arcAngle)
    const csLocalX = centerLocalX + csRelCx
    const csLocalY = centerLocalY + csRelCy
    csCoord = localToWorld(tsCoord, csLocalX, csLocalY, approachBrng)

    // ST = CS + exit spiral (mirror of entry spiral)
    // At CS, tangent direction is rotated by (Δ - θs) from original.
    // Exit spiral mirrors entry: it curves in the opposite rotational sense,
    // starting from CS and ending at ST.
    // ST in local frame: reflect entry spiral about the perpendicular bisector.
    // Simplification: ST = PI + T * (departure tangent direction)
    const departureBrng = approachBrng + deltaRad // right-hand
    const stDx = T * Math.sin(departureBrng)
    const stDy = T * Math.cos(departureBrng)
    stCoord = { easting: piCoord.easting + stDx, northing: piCoord.northing + stDy }
  }

  return {
    input,
    spiral: { ...spiral, spiralLength: Ls, spiralAngle: (thetaS * 180) / Math.PI },
    deltaRad,
    thetaSRad: thetaS,
    p,
    k,
    T,
    Lc,
    totalLength,
    tsChainage,
    scChainage,
    csChainage,
    stChainage,
    tsCoord,
    scCoord,
    csCoord,
    stCoord,
    piCoord,
  }
}

/**
 * Transform a local-frame (x, y) point to world coordinates given a TS
 * origin and an approach bearing. Local frame: +X = along approach tangent
 * (toward PI), +Y = LEFT of tangent. Bearing convention: 0° = North, clockwise.
 */
function localToWorld(
  ts: { easting: number; northing: number },
  x: number,
  y: number,
  approachBrngRad: number
): { easting: number; northing: number } {
  // Approach tangent unit vector (TS → PI)
  const tx = Math.sin(approachBrngRad)
  const ty = Math.cos(approachBrngRad)
  // Left perpendicular (for right-hand curve, +Y is left)
  // For bearing 0 (North), tangent is (0, +1). Left of that is (-1, 0) which is West.
  // So left-perp = (-ty, tx)? Let's verify: rotate tangent 90° CCW = (-ty, tx)
  // For (0, 1) tangent, CCW 90° = (-1, 0). Yes that's West = left.
  const lx = -ty
  const ly = tx
  return {
    easting: ts.easting + x * tx + y * lx,
    northing: ts.northing + x * ty + y * ly,
  }
}

// ─── Station Interpolation ──────────────────────────────────────────────────

/**
 * Sample the spiral alignment at a fixed interval and return stations
 * with world coordinates, offsets, deflection angles, and segment labels.
 *
 * @param alignment  - Result of `computeSpiralAlignment`
 * @param interval   - Sample interval in metres (default 10)
 */
export function stationSpiralAlignment(
  alignment: SpiralAlignmentResult,
  interval: number = 10
): AlignmentStation[] {
  const stations: AlignmentStation[] = []
  const { input, thetaSRad, deltaRad, T, tsChainage, totalLength } = alignment
  const { radius, spiralLength: Ls, approachBearingDeg = 0 } = input
  const approachBrng = approachBearingDeg * DEG

  const N = Math.floor(totalLength / interval)
  for (let i = 0; i <= N; i++) {
    const d = i * interval // distance from TS
    if (d > totalLength + 0.01) continue
    const ch = tsChainage + d
    const station = stationAtDistance(alignment, d)
    if (station) stations.push({ ...station, chainage: ch })
  }
  // Ensure final station at ST
  const last = stations[stations.length - 1]
  if (!last || Math.abs(last.distanceFromTS - totalLength) > 0.01) {
    const station = stationAtDistance(alignment, totalLength)
    if (station) stations.push({ ...station, chainage: tsChainage + totalLength })
  }

  return stations
}

/**
 * Compute the station at a given distance from TS.
 *
 * Returns null for distances outside [0, totalLength].
 */
export function stationAtDistance(
  alignment: SpiralAlignmentResult,
  distanceFromTS: number
): AlignmentStation | null {
  const { input, thetaSRad, deltaRad, T, tsChainage, totalLength, tsCoord } = alignment
  const { radius, spiralLength: Ls, approachBearingDeg = 0 } = input
  const approachBrng = approachBearingDeg * DEG

  if (distanceFromTS < -0.01 || distanceFromTS > totalLength + 0.01) return null
  const d = Math.max(0, Math.min(totalLength, distanceFromTS))

  let localX: number
  let localY: number
  let segment: AlignmentStation['segment']
  let deflectionDeg: number

  if (d < Ls) {
    // Entry spiral (TS → SC)
    segment = 'entry-spiral'
    const s = d
    const theta = (s * s) / (2 * radius * Ls) // instantaneous spiral angle at s
    // Clothoid coordinates (series expansion about s)
    localX = s * (1 - Math.pow(theta, 2) / 10 + Math.pow(theta, 4) / 216)
    localY = s * (theta / 3 - Math.pow(theta, 3) / 42 + Math.pow(theta, 5) / 1320)
    deflectionDeg = (theta * 180) / Math.PI / 3 // approximate deflection (1/3 of spiral angle)
  } else if (d < Ls + alignment.Lc) {
    // Circular curve (SC → CS)
    segment = 'circular'
    const s = d - Ls
    const arcAngle = s / radius
    // At SC, the tangent is rotated by θs from the original tangent.
    // The point on the circular curve, measured from SC, is at angle
    // (θs + arcAngle) from the original tangent at TS.
    // Center is at (x_SC - R sin θs, y_SC + R cos θs) — see alignment computation
    const xSC = Ls * (1 - Math.pow(thetaSRad, 2) / 10 + Math.pow(thetaSRad, 4) / 216)
    const ySC = Ls * (thetaSRad / 3 - Math.pow(thetaSRad, 3) / 42 + Math.pow(thetaSRad, 5) / 1320)
    const centerLocalX = xSC - radius * Math.sin(thetaSRad)
    const centerLocalY = ySC + radius * Math.cos(thetaSRad)
    // Vector from center to SC
    const scRelCx = xSC - centerLocalX
    const scRelCy = ySC - centerLocalY
    // Rotate by -arcAngle (clockwise for right-hand curve)
    const relCx = scRelCx * Math.cos(-arcAngle) - scRelCy * Math.sin(-arcAngle)
    const relCy = scRelCx * Math.sin(-arcAngle) + scRelCy * Math.cos(-arcAngle)
    localX = centerLocalX + relCx
    localY = centerLocalY + relCy
    deflectionDeg = ((thetaSRad + arcAngle) * 180) / Math.PI
  } else {
    // Exit spiral (CS → ST) — mirror of entry
    segment = 'exit-spiral'
    const sFromST = totalLength - d // distance from ST, going backwards
    const s = sFromST
    const theta = (s * s) / (2 * radius * Ls)
    // Local coords of ST relative to TS would require rotating the entire
    // exit spiral; simpler to compute ST in local frame and add the reverse
    // spiral displacement
    // ST local: PI is at (T, 0); ST is at (T + T cos Δ, T sin Δ) ... actually
    // ST is reached by traveling T along departure tangent from PI.
    const stLocalX = T + T * Math.cos(deltaRad)
    const stLocalY = T * Math.sin(deltaRad) // right-hand curve: +Y
    // Reverse spiral at ST goes backward, curving opposite to entry spiral
    // For right-hand curve, exit spiral curves from CS (which is to the LEFT
    // of departure tangent) toward ST
    // Entry spiral coords (rotated): rotate (x, y) by Δ, then mirror
    const xSpiral = s * (1 - Math.pow(theta, 2) / 10 + Math.pow(theta, 4) / 216)
    const ySpiral = s * (theta / 3 - Math.pow(theta, 3) / 42 + Math.pow(theta, 5) / 1320)
    // At ST, looking back along the approach direction (departure tangent - 180°),
    // the spiral extends to the LEFT (for right-hand curve). So in the TS-local frame:
    localX = stLocalX - (xSpiral * Math.cos(deltaRad) + ySpiral * Math.sin(deltaRad))
    localY = stLocalY - (xSpiral * Math.sin(deltaRad) - ySpiral * Math.cos(deltaRad))
    deflectionDeg = ((deltaRad - theta) * 180) / Math.PI
  }

  // Offset = perpendicular distance from approach tangent (the Y coordinate in local frame)
  const offset = localY

  // World coordinates
  let easting = localX
  let northing = localY
  if (tsCoord) {
    const world = localToWorld(tsCoord, localX, localY, approachBrng)
    easting = world.easting
    northing = world.northing
  }

  return {
    chainage: tsChainage + d,
    distanceFromTS: Math.round(d * 1000) / 1000,
    easting: Math.round(easting * 1000) / 1000,
    northing: Math.round(northing * 1000) / 1000,
    offset: Math.round(offset * 1000) / 1000,
    segment,
    deflectionDeg: Math.round(deflectionDeg * 10000) / 10000,
  }
}

// ─── OpenLayers Geometry Helper ─────────────────────────────────────────────

/**
 * Produce a coordinate array for use with OpenLayers `LineString` or any
 * other rendering layer that expects [easting, northing] pairs.
 *
 * If the alignment was computed without PI coordinates, returns local-frame
 * coordinates (TS at origin, approach tangent along +X). Otherwise returns
 * world coordinates.
 */
export function alignmentToCoordinateArray(
  alignment: SpiralAlignmentResult,
  interval: number = 2
): Array<[number, number]> {
  const stations = stationSpiralAlignment(alignment, interval)
  return stations.map(s => [s.easting, s.northing])
}

/**
 * Convert stations to CSV for export.
 */
export function spiralAlignmentToCSV(stations: AlignmentStation[]): string {
  const header = 'Chainage_m,Distance_from_TS_m,Easting_m,Northing_m,Offset_m,Segment,Deflection_deg'
  const rows = stations.map(s =>
    [
      s.chainage.toFixed(3),
      s.distanceFromTS.toFixed(3),
      s.easting.toFixed(3),
      s.northing.toFixed(3),
      s.offset.toFixed(3),
      s.segment,
      s.deflectionDeg.toFixed(4),
    ].join(',')
  )
  return [header, ...rows].join('\n')
}
