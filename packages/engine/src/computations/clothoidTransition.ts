// METARDU Clothoid Transition Curve Engine
// Source: RDM 1.3 Section 5.2.4 (Kenya, August 2023)
// Source: Schofield & Breach, Engineering Surveying 7th Ed., Chapter 11
// Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Chapter 24
// Source: AASHTO A Policy on Geometric Design of Highways and Streets

// ─── TYPES ─────────────────────────────────────────────────────────────────────

export interface ClothoidInput {
  /** Circular curve radius (m) */
  radius: number
  /** Design speed (km/h) */
  designSpeed: number
  /** Total deflection angle (radians) — the intersection angle */
  deflectionAngleRad: number
  /** Chainage of the IP (m) */
  ipChainage: number
  /** Desired transition length Ls (m). If omitted, computed from RDM 1.3 criteria */
  transitionLength?: number
  /** Design superelevation (decimal, e.g. 0.07 for 7%). If omitted, computed from speed/radius */
  superelevation?: number
  /** Superelevation rate of change (%/m, default 1/240 from RDM 1.3) */
  rateOfChange?: number
  /** Set-out interval along spiral (m, default 10) */
  setOutInterval?: number
}

export interface SpiralPoint {
  /** Arc length from TS/ST along spiral */
  arcLength: number
  /** Chainage at this point */
  chainage: number
  /** Local X coordinate (along TS tangent) */
  x: number
  /** Local Y coordinate (perpendicular to TS tangent) */
  y: number
  /** Spiral angle at this point (radians) */
  theta: number
  /** Deflection angle from TS tangent (radians) — for setting out */
  deflection: number
  /** Chord from TS to this point (m) */
  chord: number
}

export interface ClothoidResult {
  // ── Spiral Parameters ──
  /** Spiral parameter A = sqrt(R * Ls) */
  spiralParamA: number
  /** Spiral angle at end of transition (radians) — τ = Ls/(2R) */
  spiralAngleTau: number
  spiralAngleTauDeg: number
  /** Tangent offset at TS — distance from TS to point where circular curve is shifted */
  tangentOffsetQ: number
  /** Curve shift p — how much the circular curve shifts inward from the tangent */
  curveShiftP: number

  // ── Key Chainages ──
  /** Tangent to Spiral point chainage */
  tsChainage: number
  /** Spiral to Curve point chainage */
  scChainage: number
  /** Curve to Spiral point chainage */
  csChainage: number
  /** Spiral to Tangent point chainage */
  stChainage: number

  // ── Modified Circular Curve ──
  /** Modified tangent length: Ts = (R+p)*tan(Δ/2) + q */
  modifiedTangent: number
  /** Circular arc length: Lc = R*(Δ - 2τ) */
  circularArcLength: number
  /** Total curve length: L_total = 2*Ls + Lc */
  totalCurveLength: number
  /** External distance: Es = (R+p)*sec(Δ/2) - (R+p) */
  externalDistance: number

  // ── Spiral Set-Out Points ──
  /** Points along the entry spiral (TS → SC) */
  spiralInPoints: SpiralPoint[]
  /** Points along the exit spiral (CS → ST), mirrored */
  spiralOutPoints: SpiralPoint[]

  // ── Validation ──
  /** Minimum required transition length from RDM 1.3 criteria */
  minTransitionLength: number
  /** Criteria breakdown for minimum length */
  minLengthCriteria: {
    /** From rate of change of centripetal acceleration */
    acceleration: number
    /** From rate of change of superelevation */
    superElevation: number
    /** From minimum travel time (3 seconds) */
    travelTime: number
  }
  /** Is the provided (or computed) transition length adequate? */
  isLengthAdequate: boolean

  // ── Derivation Steps ──
  steps: Array<{ description: string; formula: string; value: string }>
}

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────

/** RDM 1.3: Rate of change of centripetal acceleration (m/s³) */
const CENTRIPETAL_RATE = 0.3

/** RDM 1.3: Minimum travel time on transition (seconds) */
const MIN_TRAVEL_TIME = 3.0

/** Default superelevation rate of change (%/m) — RDM 1.3 Table 5.3 */
const DEFAULT_RATE_OF_CHANGE = 1 / 240

/** Default carriageway width (m) — typical two-lane road */
const DEFAULT_CARRIAGEWAY_WIDTH = 7.0

/** Default set-out interval (m) */
const DEFAULT_SET_OUT_INTERVAL = 10

// ─── HELPERS ───────────────────────────────────────────────────────────────────

const DEG = 180 / Math.PI
const RAD = Math.PI / 180

/** Round to a given number of decimal places */
function r(value: number, dp: number = 3): number {
  const f = 10 ** dp
  return Math.round(value * f) / f
}

/** Format angle in degrees as D°M'S" */
function formatDMS(rad: number): string {
  let totalSec = Math.abs(rad * DEG) * 3600
  const sign = rad < 0 ? '-' : ''
  const d = Math.floor(totalSec / 3600)
  totalSec -= d * 3600
  const m = Math.floor(totalSec / 60)
  const s = r(totalSec - m * 60, 2)
  return `${sign}${d}°${m.toString().padStart(2, '0')}'${s.toString().padStart(5, '0')}"`
}

// ─── CORE FUNCTIONS ────────────────────────────────────────────────────────────

/**
 * Compute the minimum transition length from RDM 1.3 criteria.
 * Returns the MAXIMUM of three criteria:
 * 1. Centripetal acceleration: Ls >= V³ / (3.6³ * C * R), C = 0.3 m/s³
 * 2. Superelevation runoff:  Ls >= (e * B) / (2 * p), p = rate (%/m as decimal)
 * 3. Travel time:            Ls >= V / (3.6 * 3)  (3 seconds minimum)
 */
export function minTransitionLength(
  radius: number,
  speedKmh: number,
  superelevation: number,
  carriagewayWidth: number = DEFAULT_CARRIAGEWAY_WIDTH,
  rateOfChange: number = DEFAULT_RATE_OF_CHANGE,
): { min: number; criteria: { acceleration: number; superElevation: number; travelTime: number } } {
  const V = speedKmh

  // Criterion 1: Rate of change of centripetal acceleration
  // Ls >= V³ / (3.6³ · C · R) where C = 0.3 m/s³
  const acceleration = Math.pow(V, 3) / (Math.pow(3.6, 3) * CENTRIPETAL_RATE * radius)

  // Criterion 2: Rate of change of superelevation (AASHTO / RDM 1.3)
  // Ls >= (e · B) / (2 · p) where p = rate of change (%/m as decimal)
  const superElevation = (superelevation * carriagewayWidth) / (2 * rateOfChange)

  // Criterion 3: Minimum travel time
  // Ls >= V / (3.6 · t) where t = 3 s
  const travelTime = V / (3.6 * MIN_TRAVEL_TIME)

  return {
    min: Math.max(acceleration, superElevation, travelTime),
    criteria: { acceleration, superElevation, travelTime },
  }
}

/**
 * Compute spiral coordinates at a given arc length L using Fresnel integral series.
 *
 *   x = L · (1 − L⁴/(40·A⁴) + L⁸/(3456·A⁸))
 *   y = L · (L²/(6·A²) − L⁶/(336·A⁶) + L¹⁰/(42240·A¹⁰))
 *   θ = L² / (2·A²) = L / (2·R)
 *
 * These series converge rapidly for typical road spirals.
 */
export function spiralCoordinate(
  L: number,
  R: number,
  A: number,
): { x: number; y: number; theta: number } {
  const A2 = A * A
  const A4 = A2 * A2
  const A6 = A4 * A2
  const A8 = A4 * A4
  const A10 = A8 * A2
  const L2 = L * L
  const L4 = L2 * L2
  const L6 = L4 * L2
  const L8 = L4 * L4
  const L10 = L8 * L2

  const x = L * (1 - L4 / (40 * A4) + L8 / (3456 * A8))
  const y = L * (L2 / (6 * A2) - L6 / (336 * A6) + L10 / (42240 * A10))
  const theta = L2 / (2 * A2) // equivalent to L / (2R)

  return { x, y, theta }
}

/**
 * Compute full clothoid transition curve with set-out data.
 *
 * @param input All curve design parameters
 * @returns Complete clothoid result including spiral points and validation
 */
export function computeClothoid(input: ClothoidInput): ClothoidResult {
  const {
    radius: R,
    designSpeed: V,
    deflectionAngleRad: delta,
    ipChainage,
    transitionLength: inputLs,
    superelevation: inputE,
    rateOfChange: pRate = DEFAULT_RATE_OF_CHANGE,
    setOutInterval: interval = DEFAULT_SET_OUT_INTERVAL,
  } = input

  const steps: Array<{ description: string; formula: string; value: string }> = []

  // ── 0. Superelevation from speed and radius (RDM 1.3 Table 5.2) ─────────
  // e + f = V² / (127·R) ; typical split: e = 0.6·(V²/127R), f = 0.4·(...)
  const totalEplusF = (V * V) / (127 * R)
  const e = inputE ?? Math.min(r(0.6 * totalEplusF, 4), 0.07) // cap at 7%
  steps.push({
    description: 'Design superelevation',
    formula: inputE ? 'Provided' : 'e = 0.6·V²/(127·R), capped at 0.07',
    value: `e = ${(e * 100).toFixed(2)}%`,
  })

  // ── 1. Compute or validate transition length Ls ─────────────────────────
  const ml = minTransitionLength(R, V, e, DEFAULT_CARRIAGEWAY_WIDTH, pRate)
  const Ls = inputLs ?? ml.min
  const isLengthAdequate = Ls >= ml.min

  steps.push({
    description: 'Minimum transition length (3 criteria)',
    formula: 'max( V³/(3.6³·0.3·R), e·B·V/(3.6·p), V/(3.6·3) )',
    value: `acc=${r(ml.criteria.acceleration)}m, sup=${r(ml.criteria.superElevation)}m, time=${r(ml.criteria.travelTime)}m → min=${r(ml.min)}m`,
  })
  steps.push({
    description: 'Transition length Ls',
    formula: inputLs ? 'Provided' : 'Adopted = min required',
    value: `Ls = ${r(Ls)} m (adequate: ${isLengthAdequate})`,
  })

  // ── 2. Spiral parameter ────────────────────────────────────────────────
  const A = Math.sqrt(R * Ls)
  steps.push({
    description: 'Spiral parameter A',
    formula: 'A = √(R · Ls)',
    value: `A = √(${r(R)} × ${r(Ls)}) = ${r(A)}`,
  })

  // ── 3. Spiral angle τ = Ls / (2R) ─────────────────────────────────────
  const tau = Ls / (2 * R)
  const tauDeg = tau * DEG
  steps.push({
    description: 'Spiral angle at SC/CS',
    formula: 'τ = Ls / (2R)',
    value: `τ = ${r(Ls)} / (2 × ${r(R)}) = ${r(tau)} rad = ${r(tauDeg, 4)}°`,
  })

  // ── 4. Spiral end coordinates (Fresnel series in terms of τ) ───────────
  //    Xs ≈ Ls · (1 − τ²/10 + τ⁴/216 − τ⁵/9360)
  //    Ys ≈ Ls · (τ/3 − τ³/42 + τ⁵/1320)
  const Xs = Ls * (1 - (tau * tau) / 10 + (tau ** 4) / 216 - (tau ** 5) / 9360)
  const Ys = Ls * (tau / 3 - (tau ** 3) / 42 + (tau ** 5) / 1320)
  steps.push({
    description: 'Spiral end coordinates (SC/CS)',
    formula: 'Xs ≈ Ls(1−τ²/10+τ⁴/216−τ⁵/9360), Ys ≈ Ls(τ/3−τ³/42+τ⁵/1320)',
    value: `Xs = ${r(Xs)}, Ys = ${r(Ys)}`,
  })

  // ── 5. Tangent offset q and curve shift p ───────────────────────────────
  const q = Xs - R * Math.sin(tau)
  const p = Ys - R * (1 - Math.cos(tau))
  steps.push({
    description: 'Tangent offset q',
    formula: 'q = Xs − R·sin(τ)',
    value: `q = ${r(Xs)} − ${r(R)}·sin(${r(tau)}) = ${r(q)}`,
  })
  steps.push({
    description: 'Curve shift p',
    formula: 'p = Ys − R·(1 − cos(τ))',
    value: `p = ${r(Ys)} − ${r(R)}·(1 − cos(${r(tau)})) = ${r(p)}`,
  })

  // ── 6. Modified tangent length Ts ───────────────────────────────────────
  const Ts = (R + p) * Math.tan(delta / 2) + q
  steps.push({
    description: 'Modified tangent length',
    formula: 'Ts = (R + p)·tan(Δ/2) + q',
    value: `Ts = (${r(R)} + ${r(p)})·tan(${r(delta / 2)}) + ${r(q)} = ${r(Ts)}`,
  })

  // ── 7. Key chainages ───────────────────────────────────────────────────
  const tsChainage = ipChainage - Ts
  const scChainage = tsChainage + Ls
  const Lc = R * (delta - 2 * tau)
  const csChainage = scChainage + Lc
  const stChainage = csChainage + Ls
  const totalCurveLength = 2 * Ls + Lc

  steps.push({
    description: 'Circular arc length',
    formula: 'Lc = R·(Δ − 2τ)',
    value: `Lc = ${r(R)} × (${r(delta)} − 2×${r(tau)}) = ${r(Lc)} m`,
  })
  steps.push({
    description: 'Key chainages',
    formula: 'TS = IP − Ts; SC = TS + Ls; CS = SC + Lc; ST = CS + Ls',
    value: `TS=${r(tsChainage)}, SC=${r(scChainage)}, CS=${r(csChainage)}, ST=${r(stChainage)}`,
  })

  // ── 8. External distance ───────────────────────────────────────────────
  const externalDistance = (R + p) / Math.cos(delta / 2) - (R + p)
  steps.push({
    description: 'External distance',
    formula: 'Es = (R+p)·sec(Δ/2) − (R+p)',
    value: `Es = ${r(externalDistance)}`,
  })

  // ── 9. Generate spiral set-out points (entry: TS → SC) ─────────────────
  const spiralInPoints: SpiralPoint[] = []

  // Always include TS (arc length = 0)
  spiralInPoints.push({
    arcLength: 0,
    chainage: tsChainage,
    x: 0,
    y: 0,
    theta: 0,
    deflection: 0,
    chord: 0,
  })

  // Generate intermediate points at set-out intervals
  let nextChainage = Math.ceil(tsChainage / interval) * interval
  while (nextChainage < scChainage - 0.001) {
    const arcLen = nextChainage - tsChainage
    const coord = spiralCoordinate(arcLen, R, A)
    const chord = Math.sqrt(coord.x * coord.x + coord.y * coord.y)
    // Deflection angle ≈ θ/3 for short spirals; more accurately: arctan(y/x)
    const deflection = Math.atan2(coord.y, coord.x)

    spiralInPoints.push({
      arcLength: r(arcLen),
      chainage: r(nextChainage),
      x: r(coord.x),
      y: r(coord.y),
      theta: r(coord.theta),
      deflection: r(deflection),
      chord: r(chord),
    })

    nextChainage += interval
  }

  // Always include SC (end of spiral)
  const scCoord = spiralCoordinate(Ls, R, A)
  const scChord = Math.sqrt(scCoord.x * scCoord.x + scCoord.y * scCoord.y)
  const scDeflection = Math.atan2(scCoord.y, scCoord.x)
  spiralInPoints.push({
    arcLength: r(Ls),
    chainage: r(scChainage),
    x: r(scCoord.x),
    y: r(scCoord.y),
    theta: r(scCoord.theta),
    deflection: r(scDeflection),
    chord: r(scChord),
  })

  steps.push({
    description: 'Entry spiral set-out points',
    formula: `${spiralInPoints.length} points (interval ${interval}m)`,
    value: `TS to SC, lengths 0 to ${r(Ls)} m`,
  })

  // ── 10. Mirror for exit spiral (CS → ST) ──────────────────────────────
  // Exit spiral is identical in shape but traversed from ST backwards.
  // Local coordinates are mirrored: x_exit = Xs − x_entry, y_exit = Ys − y_entry
  // (reflected about the CS–ST direction)
  const spiralOutPoints: SpiralPoint[] = spiralInPoints.map((pt) => {
    const mirrorArcLen = Ls - pt.arcLength
    return {
      arcLength: r(mirrorArcLen),
      chainage: r(csChainage + mirrorArcLen),
      // Mirror coordinates: measured from ST end of spiral looking back
      x: r(scCoord.x - pt.x),
      y: r(scCoord.y - pt.y),
      theta: r(tau - pt.theta),
      deflection: r(Math.atan2(scCoord.y - pt.y, scCoord.x - pt.x)),
      chord: r(Math.sqrt((scCoord.x - pt.x) ** 2 + (scCoord.y - pt.y) ** 2)),
    }
  }).reverse() // Now ordered from CS → ST

  // ── Assemble result ─────────────────────────────────────────────────────
  return {
    spiralParamA: r(A),
    spiralAngleTau: r(tau),
    spiralAngleTauDeg: r(tauDeg, 4),
    tangentOffsetQ: r(q),
    curveShiftP: r(p),

    tsChainage: r(tsChainage),
    scChainage: r(scChainage),
    csChainage: r(csChainage),
    stChainage: r(stChainage),

    modifiedTangent: r(Ts),
    circularArcLength: r(Lc),
    totalCurveLength: r(totalCurveLength),
    externalDistance: r(externalDistance),

    spiralInPoints,
    spiralOutPoints,

    minTransitionLength: r(ml.min),
    minLengthCriteria: {
      acceleration: r(ml.criteria.acceleration),
      superElevation: r(ml.criteria.superElevation),
      travelTime: r(ml.criteria.travelTime),
    },
    isLengthAdequate,

    steps,
  }
}

/**
 * Generate a formatted set-out table for field use.
 *
 * Returns an array of rows suitable for direct display or export,
 * covering both the entry spiral (TS→SC) and exit spiral (CS→ST).
 *
 * @param result  The ClothoidResult from computeClothoid()
 * @param interval  Override set-out interval (default: from result computation)
 */
export function clothoidSetOutTable(
  result: ClothoidResult,
  interval?: number,
): Array<{
  point: string
  chainage: number
  x: number
  y: number
  chord: number
  deflectionDeg: string
  remarks: string
}> {
  const rows: Array<{
    point: string
    chainage: number
    x: number
    y: number
    chord: number
    deflectionDeg: string
    remarks: string
  }> = []

  // ── Entry spiral (TS → SC) ─────────────────────────────────────────────
  for (let i = 0; i < result.spiralInPoints.length; i++) {
    const pt = result.spiralInPoints[i]
    let remarks = ''
    if (i === 0) remarks = 'TS — Entry spiral start'
    else if (i === result.spiralInPoints.length - 1) remarks = 'SC — Spiral to circular'
    else if (i === 1) remarks = 'First intermediate point'

    rows.push({
      point: i === 0 ? 'TS' : i === result.spiralInPoints.length - 1 ? 'SC' : `${i}`,
      chainage: pt.chainage,
      x: pt.x,
      y: pt.y,
      chord: pt.chord,
      deflectionDeg: formatDMS(pt.deflection),
      remarks,
    })
  }

  // ── Circular arc placeholder ────────────────────────────────────────────
  if (result.circularArcLength > 0.01) {
    rows.push({
      point: '···',
      chainage: r((result.scChainage + result.csChainage) / 2),
      x: 0,
      y: 0,
      chord: 0,
      deflectionDeg: '—',
      remarks: `Circular arc Lc = ${result.circularArcLength} m (see circular curve set-out)`,
    })
  }

  // ── Exit spiral (CS → ST) ──────────────────────────────────────────────
  for (let i = 0; i < result.spiralOutPoints.length; i++) {
    const pt = result.spiralOutPoints[i]
    let remarks = ''
    if (i === 0) remarks = 'CS — Circular to spiral'
    else if (i === result.spiralOutPoints.length - 1) remarks = 'ST — Exit spiral end'

    rows.push({
      point: i === 0 ? 'CS' : i === result.spiralOutPoints.length - 1 ? 'ST' : `${i}`,
      chainage: pt.chainage,
      x: pt.x,
      y: pt.y,
      chord: pt.chord,
      deflectionDeg: formatDMS(pt.deflection),
      remarks,
    })
  }

  return rows
}
