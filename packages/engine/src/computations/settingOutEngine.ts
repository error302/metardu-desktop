// METARDU Setting Out Engine
// Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Chapter 23
// Source: Schofield & Breach, Engineering Surveying 7th Ed., Chapter 9
// Source: RDM 1.1 Kenya 2025, Table 5.2

// ─── PART 1: DATA TYPES ──────────────────────────────────────────────────────

export interface InstrumentStation {
  e: number
  n: number
  rl: number
  ih: number
}

export interface Backsight {
  e: number
  n: number
}

export interface DesignPoint {
  id: string
  e: number
  n: number
  rl: number
  th: number
  description?: string
}

export interface SettingOutRow {
  id: string
  designE: number
  designN: number
  designRL: number
  HzAngle: string        // DMS string
  HzDecimal: number      // decimal degrees
  HD: number            // horizontal distance
  VA: string            // DMS string with sign
  VA_Rad: number       // radians
  SD: number            // slope distance
  TH: number            // target height
  heightDiff: number    // vertical difference
  steps: Array<{ description: string; formula: string; value: string }>
}

export interface SettingOutResult {
  instrumentStation: InstrumentStation
  backsight: Backsight
  bsBearing: string
  bsBearingDecimal: number
  rows: SettingOutRow[]
  totalPoints: number
}

// ─── PART 2: ANGLE/DISTANCE COMPUTATIONS ──────────────────────────────────────

function bearingToString(wcb: number): string {
  const d = Math.floor(wcb)
  const mFloat = (wcb - d) * 60
  const m = Math.floor(mFloat)
  const s = (mFloat - m) * 60
  return `${String(d).padStart(3, '0')}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"`
}

function arithToDMS(angle: number): { d: number; m: number; s: number } {
  const d = Math.floor(Math.abs(angle))
  const mFloat = (Math.abs(angle) - d) * 60
  const m = Math.floor(mFloat)
  const s = (mFloat - m) * 60
  return { d, m, s }
}

function angleDiff(a: number, b: number): number {
  let diff = a - b
  while (diff < 0) diff += 360
  while (diff >= 360) diff -= 360
  return diff
}

function inverseBearing(e1: number, n1: number, e2: number, n2: number): number {
  // Source: Ghilani & Wolf, Section 10.3
  const dE = e2 - e1
  const dN = n2 - n1
  const theta = Math.atan2(Math.abs(dE), Math.abs(dN)) * 180 / Math.PI
  if (dN >= 0 && dE >= 0) return theta
  if (dN < 0 && dE >= 0) return 180 - theta
  if (dN < 0 && dE < 0) return 180 + theta
  return 360 - theta
}

function horizontalAngle(fromBearing: number, toBearing: number): number {
  // Source: Ghilani & Wolf, Section 23
  let angle = toBearing - fromBearing
  if (angle < 0) angle += 360
  if (angle > 360) angle -= 360
  return angle
}

// ─── PART 3: SETTING OUT COMPUTATION ──────────────────────────────────────────

export function computeSettingOut(
  station: InstrumentStation,
  backsight: Backsight,
  points: DesignPoint[]
): SettingOutResult {
  // Source: Ghilani & Wolf, Section 23 — Station setup and orientation

  // Backsight bearing
  const bsBearingDecimal = inverseBearing(station.e, station.n, backsight.e, backsight.n)
  const bsBearing = bearingToString(bsBearingDecimal)

  const rows: SettingOutRow[] = []

  for (const pt of points) {
    // Bearing to point
    const bearingToPoint = inverseBearing(station.e, station.n, pt.e, pt.n)

    // Horizontal angle
    const HzDecimal = horizontalAngle(bsBearingDecimal, bearingToPoint)
    const { d, m, s } = arithToDMS(HzDecimal)
    const HzAngle = `${String(d).padStart(3, '0')}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"`
    // Format for display (no leading zeros on degrees for angles < 90)
    const HzDisplay = `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"`

    // Horizontal distance
    const dE = pt.e - station.e
    const dN = pt.n - station.n
    const HD = Math.sqrt(dE * dE + dN * dN)

    // Vertical angle and slope distance
    // Source: Ghilani & Wolf, Section 23 — Vertical angle computation
    // height_diff = (RL_pt + TH) - (RL_station + IH)
    const heightDiff = (pt.rl + pt.th) - (station.rl + station.ih)
    const VA_Rad = Math.atan2(heightDiff, HD)
    const VA_Deg = VA_Rad * 180 / Math.PI
    const { d: vad, m: vam, s: vas } = arithToDMS(Math.abs(VA_Deg))
    const sign = heightDiff >= 0 ? '+' : '−'
    const VA = `${sign}${vad}°${String(vam).padStart(2, '0')}'${vas.toFixed(1).padStart(4, '0')}"`
    const VA_Display = `${sign}${vad}°${String(vam).padStart(2, '0')}'${vas.toFixed(1).padStart(4, '0')}"`

    // Slope distance
    const SD = HD / Math.cos(VA_Rad)

    const steps: SettingOutRow['steps'] = [
      {
        description: `ΔE = E₂ − E₁`,
        formula: `${pt.e.toFixed(3)} − ${station.e.toFixed(3)}`,
        value: `${dE.toFixed(4)} m`,
      },
      {
        description: `ΔN = N₂ − N₁`,
        formula: `${pt.n.toFixed(3)} − ${station.n.toFixed(3)}`,
        value: `${dN.toFixed(4)} m`,
      },
      {
        description: `Bearing to point`,
        formula: `tan⁻¹(ΔE/ΔN)`,
        value: bearingToString(bearingToPoint),
      },
      {
        description: `Hz angle = bearing_to_pt − BS_bearing`,
        formula: `${bearingToString(bearingToPoint)} − ${bsBearing}`,
        value: HzAngle,
      },
      {
        description: `HD = √(ΔE² + ΔN²)`,
        formula: `√(${dE.toFixed(4)}² + ${dN.toFixed(4)}²)`,
        value: `${HD.toFixed(3)} m`,
      },
      {
        description: `Height diff = (RL_p + TH) − (RL_s + IH)`,
        formula: `(${pt.rl.toFixed(3)} + ${pt.th}) − (${station.rl.toFixed(3)} + ${station.ih})`,
        value: `${heightDiff.toFixed(4)} m`,
      },
      {
        description: `VA = tan⁻¹(Δh / HD)`,
        formula: `tan⁻¹(${heightDiff.toFixed(4)} / ${HD.toFixed(3)})`,
        value: VA_Display,
      },
      {
        description: `SD = HD / cos(VA)`,
        formula: `${HD.toFixed(3)} / cos(${VA_Rad.toFixed(6)})`,
        value: `${SD.toFixed(3)} m`,
      },
    ]

    rows.push({
      id: pt.id,
      designE: pt.e,
      designN: pt.n,
      designRL: pt.rl,
      HzAngle: HzDisplay,
      HzDecimal,
      HD,
      VA: VA_Display,
      VA_Rad,
      SD,
      TH: pt.th,
      heightDiff,
      steps,
    })
  }

  return {
    instrumentStation: station,
    backsight,
    bsBearing,
    bsBearingDecimal,
    rows,
    totalPoints: points.length,
  }
}

// ─── PART 4: COORDINATE CHECK (RE-OBSERVATION) ───────────────────────────────
// Source: RDM 1.1 Kenya 2025, Table 5.2

export interface ReObservation {
  observedHz: number     // degrees decimal
  observedHD: number    // metres
  observedVA?: number   // degrees decimal (optional)
  observedSD?: number   // metres (optional)
  observedRL?: number   // metres (optional, if level observed)
}

export interface CoordinateCheckResult {
  pointId: string
  designE: number
  designN: number
  designRL: number
  computedE: number
  computedN: number
  computedRL: number | null
  deltaE: number
  deltaN: number
  deltaRL: number | null
  hAccuracy: 'GREEN' | 'RED'
  vAccuracy: 'GREEN' | 'RED'
  hTolerance: number
  vTolerance: number
  isCompliant: boolean
  messages: string[]
}

export function checkCoordinate(
  station: InstrumentStation,
  bsBearingDecimal: number,
  observation: ReObservation,
  designPoint: DesignPoint
): CoordinateCheckResult {
  // Source: RDM 1.1 Table 5.2
  // Construction survey tolerance: ±25mm horizontal, ±15mm vertical
  const hTolerance = 0.025  // ±25mm
  const vTolerance = 0.015  // ±15mm

  // Hz angle is the clockwise angle shown on the total station (0-360)
  // bearing_to_point = bs_bearing + Hz (mod 360)
  // Source: Ghilani & Wolf, Section 23
  let bearingToObserved = (bsBearingDecimal + observation.observedHz) % 360
  if (bearingToObserved < 0) bearingToObserved += 360
  const computedE = station.e + observation.observedHD * Math.sin(bearingToObserved * Math.PI / 180)
  const computedN = station.n + observation.observedHD * Math.cos(bearingToObserved * Math.PI / 180)

  let computedRL: number | null = null
  let deltaRL: number | null = null
  let vAccuracy: 'GREEN' | 'RED' = 'GREEN'
  let vMsg = ''

  if (observation.observedRL !== undefined) {
    computedRL = observation.observedRL
    deltaRL = Math.abs(observation.observedRL - designPoint.rl)
    vAccuracy = deltaRL <= vTolerance ? 'GREEN' : 'RED'
    vMsg = vAccuracy === 'GREEN'
      ? `RL within ±${(vTolerance * 1000).toFixed(0)}mm`
      : `Re-set level — RL error ${(deltaRL * 1000).toFixed(1)}mm exceeds ±${(vTolerance * 1000).toFixed(0)}mm`
  }

  const deltaE = Math.abs(computedE - designPoint.e)
  const deltaN = Math.abs(computedN - designPoint.n)
  const hAccuracy = deltaE <= hTolerance && deltaN <= hTolerance ? 'GREEN' : 'RED'
  const isCompliant = hAccuracy === 'GREEN' && (deltaRL === null || vAccuracy === 'GREEN')

  const messages: string[] = []
  if (hAccuracy === 'RED') {
    messages.push(`Re-set peg — position error E=${(deltaE * 1000).toFixed(1)}mm N=${(deltaN * 1000).toFixed(1)}mm exceeds ±${(hTolerance * 1000).toFixed(0)}mm`)
  } else {
    messages.push(`Position OK — E=${(deltaE * 1000).toFixed(1)}mm N=${(deltaN * 1000).toFixed(1)}mm within ±${(hTolerance * 1000).toFixed(0)}mm`)
  }
  if (deltaRL !== null) messages.push(vMsg)

  return {
    pointId: designPoint.id,
    designE: designPoint.e,
    designN: designPoint.n,
    designRL: designPoint.rl,
    computedE,
    computedN,
    computedRL,
    deltaE,
    deltaN,
    deltaRL,
    hAccuracy,
    vAccuracy,
    hTolerance,
    vTolerance,
    isCompliant,
    messages,
  }
}

// ─── PART 5: CHAINAGE AND OFFSET TABLE ────────────────────────────────────────
// Source: RDM 1.3 Kenya August 2023, Section 5.5.3

export interface ChainageOffsetRow {
  chainage: number
  chainageFmt: string
  clRL: number
  leftOffset: number
  rightOffset: number
  leftRL: number
  rightRL: number
  cutFillAtCL: string
  cutFillDepth: number
}

export interface ChainageOffsetInput {
  chainage: number
  formationRL: number
  groundRL: number
  halfCarriageway: number
  shoulderWidth: number
  catchLeftOffset?: number
  catchRightOffset?: number
}

export function computeChainageOffset(input: ChainageOffsetInput): ChainageOffsetRow {
  const { chainage, formationRL, groundRL, halfCarriageway, shoulderWidth } = input
  const km = Math.floor(chainage / 1000)
  const m = chainage % 1000
  const chainageFmt = km > 0 ? `${km}+${m.toFixed(3)}` : `${m.toFixed(3)}`

  const halfWidth = halfCarriageway + shoulderWidth
  const leftOffset = halfWidth
  const rightOffset = halfWidth
  const cutFillDepth = groundRL - formationRL
  const cutFillAtCL = cutFillDepth > 0.005
    ? `+${cutFillDepth.toFixed(3)} CUT`
    : cutFillDepth < -0.005
    ? `${cutFillDepth.toFixed(3)} FILL`
    : '0.000 LEVEL'

  return {
    chainage,
    chainageFmt,
    clRL: groundRL,
    leftOffset,
    rightOffset,
    leftRL: formationRL,
    rightRL: formationRL,
    cutFillAtCL,
    cutFillDepth,
  }
}

// ─── PART 6: CSV PARSER ───────────────────────────────────────────────────────

export function parseSettingOutCSV(csv: string): DesignPoint[] {
  const lines = csv.trim().split('\n')
  const points: DesignPoint[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.toLowerCase().startsWith('point_id') || line.toLowerCase().startsWith('id')) continue
    const cols = line.split(',').map((c) => c.trim())
    if (cols.length < 4) continue
    const id = cols[0] || String(i + 1)
    const e = parseFloat(cols[1])
    const n = parseFloat(cols[2])
    const rl = parseFloat(cols[3])
    const th = cols[4] ? parseFloat(cols[4]) : 2.0
    const desc = cols[5] || ''
    if (isNaN(e) || isNaN(n) || isNaN(rl)) continue
    points.push({ id, e, n, rl, th, description: desc })
  }

  return points
}
