/**
 * @module stakingTable
 *
 * Batch staking table + alignment chainage table generation.
 *
 * Generates the two most common engineering survey deliverables:
 *   1. Staking table: chainage + offset (L/R) + elevation for setting out
 *   2. Chainage table: IP/TP/midpoint chainage schedule for an alignment
 *
 * References:
 *   - "Route Surveying" by Meyer & Gibson, Chapter 6
 *   - RDM 1.3 (Kenya Road Design Manual)
 *   - "Surveying" by B.C. Punmia, Chapter 13
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HorizontalCurveData {
  /** Intersection Point (IP) easting */
  ipE: number
  /** Intersection Point (IP) northing */
  ipN: number
  /** Deflection angle in decimal degrees */
  deflectionAngle: number
  /** Curve radius in metres */
  radius: number
  /** Chainage of the IP (if known) */
  ipChainage?: number
  /** Bearing of the incoming tangent (decimal degrees) */
  incomingBearing?: number
}

export interface CurveElements {
  /** Tangent length (T) in metres */
  tangent: number
  /** Curve length (L) in metres */
  curveLength: number
  /** External distance (E) in metres */
  external: number
  /** Mid-ordinate (M) in metres */
  midOrdinate: number
  /** Chainage of Tangent Point 1 (start of curve) */
  tp1Chainage: number
  /** Chainage of Tangent Point 2 (end of curve) */
  tp2Chainage: number
  /** Chainage of curve midpoint */
  midPointChainage: number
  /** Deflection angle per degree of arc (for setting out) */
  deflectionPerDegree: number
}

export interface StakingPoint {
  /** Chainage in metres (e.g., 14420 = KM 14+420) */
  chainage: number
  /** Formatted chainage label (e.g., "KM 14+420") */
  chainageLabel: string
  /** Offset left in metres (negative = left of centerline) */
  offsetLeft: number
  /** Offset right in metres (positive = right of centerline) */
  offsetRight: number
  /** Easting coordinate */
  easting: number
  /** Northing coordinate */
  northing: number
  /** Elevation (if design surface available, otherwise null) */
  elevation: number | null
  /** Bearing at this chainage (decimal degrees) */
  bearing: number
  /** Which segment this point is on (tangent1, curve, tangent2) */
  segment: 'tangent1' | 'curve' | 'tangent2'
}

// ─── Curve Element Computation ──────────────────────────────────────────────

/**
 * Compute horizontal curve elements from IP data.
 *
 * Formulas:
 *   T = R × tan(Δ/2)         (tangent length)
 *   L = R × Δ_rad            (curve length)
 *   E = R × (sec(Δ/2) - 1)   (external distance)
 *   M = R × (1 - cos(Δ/2))   (mid-ordinate)
 *
 * @param data IP coordinates, deflection angle, radius
 * @returns Curve elements + chainage of key points
 */
export function computeCurveElements(data: HorizontalCurveData): CurveElements {
  const deltaRad = (Math.abs(data.deflectionAngle) * Math.PI) / 180
  const halfDelta = deltaRad / 2

  const T = data.radius * Math.tan(halfDelta)
  const L = data.radius * deltaRad
  const E = data.radius * (1 / Math.cos(halfDelta) - 1)
  const M = data.radius * (1 - Math.cos(halfDelta))

  const ipChainage = data.ipChainage ?? 0

  // TP1 = IP chainage - T (chainage decreases going back from IP)
  const tp1Chainage = ipChainage - T
  // TP2 = TP1 + L (chainage increases along the curve)
  const tp2Chainage = tp1Chainage + L
  // Midpoint = TP1 + L/2
  const midPointChainage = tp1Chainage + L / 2

  // Deflection angle per degree of arc (for staking by deflection angles)
  // δ = (1718.87 × R^-1) minutes per metre of arc
  const deflectionPerDegree = (180 / Math.PI) / (2 * data.radius)

  return {
    tangent: T,
    curveLength: L,
    external: E,
    midOrdinate: M,
    tp1Chainage,
    tp2Chainage,
    midPointChainage,
    deflectionPerDegree,
  }
}

// ─── Chainage Table ─────────────────────────────────────────────────────────

export interface ChainageTableEntry {
  point: string
  description: string
  chainage: number
  chainageLabel: string
  easting: number
  northing: number
  bearing: number
}

/**
 * Generate the full alignment chainage table.
 *
 * Produces a schedule of all key alignment points:
 *   - Start of alignment (chainage 0)
 *   - TP1 (start of curve)
 *   - Curve midpoint
 *   - TP2 (end of curve)
 *   - IP (intersection point)
 *   - End of alignment (if specified)
 *
 * @param data Curve data with IP coordinates + bearings
 * @param elements Pre-computed curve elements
 * @param endChainage Chainage of the end of alignment (optional)
 */
export function generateChainageTable(
  data: HorizontalCurveData,
  elements: CurveElements,
  endChainage?: number,
): ChainageTableEntry[] {
  const table: ChainageTableEntry[] = []
  const incomingBearing = data.incomingBearing ?? 0
  const bearingRad = (incomingBearing * Math.PI) / 180

  // Start of alignment (chainage 0 = TP1 chainage - incoming tangent)
  const startChainage = elements.tp1Chainage - 0 // Simplified: assume alignment starts at TP1

  // IP coordinates
  const ipE = data.ipE
  const ipN = data.ipN

  // TP1 = IP - T along the incoming bearing (back from IP)
  const tp1E = ipE - elements.tangent * Math.sin(bearingRad)
  const tp1N = ipN - elements.tangent * Math.cos(bearingRad)

  // TP2 = IP + T along the outgoing bearing
  const outgoingBearing = incomingBearing + data.deflectionAngle
  const outBearingRad = (outgoingBearing * Math.PI) / 180
  const tp2E = ipE + elements.tangent * Math.sin(outBearingRad)
  const tp2N = ipN + elements.tangent * Math.cos(outBearingRad)

  // Curve midpoint = center of arc between TP1 and TP2
  const midBearing = incomingBearing + data.deflectionAngle / 2
  const midBearingRad = (midBearing * Math.PI) / 180
  const midE = tp1E + (elements.curveLength / 2) * Math.sin(midBearingRad)
  const midN = tp1N + (elements.curveLength / 2) * Math.cos(midBearingRad)

  // Build the table
  table.push({
    point: 'START',
    description: 'Start of alignment',
    chainage: startChainage,
    chainageLabel: formatChainage(startChainage),
    easting: tp1E,
    northing: tp1N,
    bearing: incomingBearing,
  })

  table.push({
    point: 'TP1',
    description: 'Tangent Point 1 (start of curve)',
    chainage: elements.tp1Chainage,
    chainageLabel: formatChainage(elements.tp1Chainage),
    easting: tp1E,
    northing: tp1N,
    bearing: incomingBearing,
  })

  table.push({
    point: 'MID',
    description: 'Curve midpoint',
    chainage: elements.midPointChainage,
    chainageLabel: formatChainage(elements.midPointChainage),
    easting: midE,
    northing: midN,
    bearing: midBearing,
  })

  table.push({
    point: 'TP2',
    description: 'Tangent Point 2 (end of curve)',
    chainage: elements.tp2Chainage,
    chainageLabel: formatChainage(elements.tp2Chainage),
    easting: tp2E,
    northing: tp2N,
    bearing: outgoingBearing,
  })

  table.push({
    point: 'IP',
    description: 'Intersection Point',
    chainage: data.ipChainage ?? 0,
    chainageLabel: formatChainage(data.ipChainage ?? 0),
    easting: ipE,
    northing: ipN,
    bearing: 0, // IP has no bearing (it's a point, not a direction)
  })

  if (endChainage != null) {
    const endE = tp2E + (endChainage - elements.tp2Chainage) * Math.sin(outBearingRad)
    const endN = tp2N + (endChainage - elements.tp2Chainage) * Math.cos(outBearingRad)
    table.push({
      point: 'END',
      description: 'End of alignment',
      chainage: endChainage,
      chainageLabel: formatChainage(endChainage),
      easting: endE,
      northing: endN,
      bearing: outgoingBearing,
    })
  }

  return table
}

// ─── Batch Staking Table ────────────────────────────────────────────────────

/**
 * Generate a batch staking table for setting out along an alignment.
 *
 * Produces stakes at regular chainage intervals along the centerline,
 * with optional left/right offsets (for edge of road, shoulder, etc.).
 *
 * @param data Curve data
 * @param elements Curve elements
 * @param interval Chainage interval between stakes (metres)
 * @param startChainage Starting chainage (default: TP1)
 * @param endChainage Ending chainage (default: TP2 + tangent)
 * @param offsets Array of offset distances to stake (e.g., [-3.5, 0, 3.5] for L edge, CL, R edge)
 * @param designElevations Optional function: chainage → elevation
 */
export function generateStakingTable(
  data: HorizontalCurveData,
  elements: CurveElements,
  interval: number = 20,
  startChainage?: number,
  endChainage?: number,
  offsets: number[] = [0],
  designElevations?: (chainage: number) => number | null,
): StakingPoint[] {
  const stakes: StakingPoint[] = []
  const incomingBearing = data.incomingBearing ?? 0
  const deltaSign = data.deflectionAngle >= 0 ? 1 : -1

  const start = startChainage ?? elements.tp1Chainage
  const end = endChainage ?? (elements.tp2Chainage + elements.tangent)

  for (let ch = start; ch <= end + 0.001; ch += interval) {
    const point = computeStakingPoint(
      ch,
      data,
      elements,
      incomingBearing,
      deltaSign,
      offsets,
      designElevations,
    )
    if (point) stakes.push(point)
  }

  return stakes
}

/**
 * Compute a single staking point at a given chainage.
 */
function computeStakingPoint(
  chainage: number,
  data: HorizontalCurveData,
  elements: CurveElements,
  incomingBearing: number,
  deltaSign: number,
  offsets: number[],
  designElevations?: (chainage: number) => number | null,
): StakingPoint | null {
  const bearingRad = (incomingBearing * Math.PI) / 180

  // TP1 coordinates
  const tp1E = data.ipE - elements.tangent * Math.sin(bearingRad)
  const tp1N = data.ipN - elements.tangent * Math.cos(bearingRad)

  let easting: number
  let northing: number
  let bearing: number
  let segment: 'tangent1' | 'curve' | 'tangent2'

  if (chainage < elements.tp1Chainage) {
    // On the incoming tangent (before curve)
    const distFromTP1 = elements.tp1Chainage - chainage
    easting = tp1E - distFromTP1 * Math.sin(bearingRad)
    northing = tp1N - distFromTP1 * Math.cos(bearingRad)
    bearing = incomingBearing
    segment = 'tangent1'
  } else if (chainage > elements.tp2Chainage) {
    // On the outgoing tangent (after curve)
    const distFromTP2 = chainage - elements.tp2Chainage
    const outBearing = incomingBearing + data.deflectionAngle
    const outRad = (outBearing * Math.PI) / 180
    const tp2E = data.ipE + elements.tangent * Math.sin(outRad)
    const tp2N = data.ipN + elements.tangent * Math.cos(outRad)
    easting = tp2E + distFromTP2 * Math.sin(outRad)
    northing = tp2N + distFromTP2 * Math.cos(outRad)
    bearing = outBearing
    segment = 'tangent2'
  } else {
    // On the curve
    const distFromTP1 = chainage - elements.tp1Chainage
    const arcAngle = distFromTP1 / data.radius // radians along the arc
    const curveBearing = incomingBearing + deltaSign * (arcAngle * 180 / Math.PI)
    const curveRad = (curveBearing * Math.PI) / 180

    // Point on curve = center + R × (sin(bearing), cos(bearing))
    // Center = TP1 + R perpendicular to incoming bearing
    const perpBearing = incomingBearing + deltaSign * 90
    const perpRad = (perpBearing * Math.PI) / 180
    const centerE = tp1E + data.radius * Math.sin(perpRad)
    const centerN = tp1N + data.radius * Math.cos(perpRad)

    // Angle from center to point on curve
    const angleFromCenter = perpBearing + 180 + deltaSign * (arcAngle * 180 / Math.PI)
    const angleRad = (angleFromCenter * Math.PI) / 180
    easting = centerE + data.radius * Math.sin(angleRad)
    northing = centerN + data.radius * Math.cos(angleRad)
    bearing = curveBearing
    segment = 'curve'
  }

  // Compute offsets (perpendicular to bearing)
  const perpBearing = bearing + 90
  const perpRad = (perpBearing * Math.PI) / 180

  let offsetLeft = 0
  let offsetRight = 0

  if (offsets.length > 0) {
    offsetLeft = Math.min(0, ...offsets) // most negative offset
    offsetRight = Math.max(0, ...offsets) // most positive offset
  }

  // If offsets are specified, compute the actual offset coordinates
  // (for now, we return the centerline coordinates + offset distances)
  const elevation = designElevations ? designElevations(chainage) : null

  return {
    chainage,
    chainageLabel: formatChainage(chainage),
    offsetLeft,
    offsetRight,
    easting,
    northing,
    elevation,
    bearing,
    segment,
  }
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function formatChainage(chainage: number): string {
  const km = Math.floor(chainage / 1000)
  const m = chainage % 1000
  return `KM ${km}+${m.toFixed(0).padStart(3, '0')}`
}
