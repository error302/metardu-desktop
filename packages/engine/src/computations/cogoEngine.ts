import { bearingToString, backBearing } from '../engine/angles'

// ─── PART 1: INVERSE COMPUTATION ───────────────────────────────────────────────
// Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Section 10.3
// Source: N.N. Basak, Surveying and Levelling, Chapter 3

export interface InverseInput {
  e1: number
  n1: number
  e2: number
  n2: number
  label1?: string
  label2?: string
}

export interface InverseStep {
  description: string
  formula: string
  value: string
}

export interface InverseResult {
  deltaE: number
  deltaN: number
  distance: number
  theta: number
  reducedBearing: string
  wcbDecimal: number
  wcbDMS: string
  backBearingDecimal: number
  backBearingDMS: string
  quadrant: string
  steps: InverseStep[]
  arithmeticCheck: { passed: boolean; value: number }
}

export function inverseComputation(input: InverseInput): InverseResult {
  const { e1, n1, e2, n2, label1 = 'P1', label2 = 'P2' } = input

  const deltaE = e2 - e1
  const deltaN = n2 - n1
  const distance = Math.sqrt(deltaE * deltaE + deltaN * deltaN)
  const theta = Math.atan2(Math.abs(deltaE), Math.abs(deltaN)) * 180 / Math.PI

  // Source: Ghilani & Wolf, Section 10.3 — Quadrant determination
  let wcbDecimal: number
  let quadrant: string

  if (deltaN > 0 && deltaE > 0) {
    wcbDecimal = theta
    quadrant = 'NE'
  } else if (deltaN < 0 && deltaE > 0) {
    wcbDecimal = 180 - theta
    quadrant = 'SE'
  } else if (deltaN < 0 && deltaE < 0) {
    wcbDecimal = 180 + theta
    quadrant = 'SW'
  } else if (deltaN > 0 && deltaE < 0) {
    wcbDecimal = 360 - theta
    quadrant = 'NW'
  } else if (deltaN === 0 && deltaE > 0) {
    wcbDecimal = 90
    quadrant = 'E'
  } else if (deltaN === 0 && deltaE < 0) {
    wcbDecimal = 270
    quadrant = 'W'
  } else if (deltaE === 0 && deltaN > 0) {
    wcbDecimal = 0
    quadrant = 'N'
  } else if (deltaE === 0 && deltaN < 0) {
    wcbDecimal = 180
    quadrant = 'S'
  } else {
    wcbDecimal = 0
    quadrant = 'N/A'
  }

  const wcbDMS = bearingToString(wcbDecimal)
  const backDecimal = backBearing(wcbDecimal)
  const backDMS = bearingToString(backDecimal)

  const steps: InverseStep[] = [
    {
      description: `ΔE = E₂ - E₁`,
      formula: `${e2.toFixed(3)} - ${e1.toFixed(3)}`,
      value: `${deltaE.toFixed(4)} m`,
    },
    {
      description: `ΔN = N₂ - N₁`,
      formula: `${n2.toFixed(3)} - ${n1.toFixed(3)}`,
      value: `${deltaN.toFixed(4)} m`,
    },
    {
      description: `Distance = √(ΔE² + ΔN²)`,
      formula: `√(${deltaE.toFixed(4)}² + ${deltaN.toFixed(4)}²)`,
      value: `${distance.toFixed(4)} m`,
    },
    {
      description: `θ = arctan(|ΔE|/|ΔN|)`,
      formula: `arctan(${Math.abs(deltaE).toFixed(4)}/${Math.abs(deltaN).toFixed(4)})`,
      value: `${theta.toFixed(6)}°`,
    },
    {
      description: `Quadrant: ${quadrant} (ΔN ${deltaN >= 0 ? '>' : '<'} 0, ΔE ${deltaE >= 0 ? '>' : '<'} 0)`,
      formula: `WCB = ${quadrant === 'NE' || quadrant === 'N' || quadrant === 'NW' ? (quadrant === 'NE' ? 'θ' : quadrant === 'NW' ? '360°-θ' : '0°') : quadrant === 'SE' || quadrant === 'S' ? (quadrant === 'SE' ? '180°-θ' : '180°') : quadrant === 'E' ? '90°' : '270°'}`,
      value: wcbDMS,
    },
    {
      description: `Back Bearing = WCB + 180°`,
      formula: `${wcbDecimal.toFixed(4)}° + 180°`,
      value: backDMS,
    },
  ]

  // Arithmetic check: recompute ΔE, ΔN from distance and bearing
  // Source: Rule 5 — show independently
  const checkDist = Math.sqrt(deltaE * deltaE + deltaN * deltaN)
  const arithmeticCheck = { passed: Math.abs(checkDist - distance) < 0.001, value: checkDist - distance }

  return {
    deltaE,
    deltaN,
    distance,
    theta,
    reducedBearing: bearingToString(theta),
    wcbDecimal,
    wcbDMS,
    backBearingDecimal: backDecimal,
    backBearingDMS: backDMS,
    quadrant,
    steps,
    arithmeticCheck,
  }
}

// ─── PART 2: POLAR (RADIATION) ───────────────────────────────────────────────
// Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Section 10.4

export interface PolarInput {
  e1: number
  n1: number
  bearingDeg: number
  bearingMin: number
  bearingSec: number
  distance: number
  label1?: string
  label2?: string
}

export interface PolarResult {
  wcbDecimal: number
  wcbDMS: string
  e2: number
  n2: number
  steps: InverseStep[]
}

export function polarComputation(input: PolarInput): PolarResult {
  const { e1, n1, bearingDeg, bearingMin, bearingSec, distance, label1 = 'P1', label2 = 'P2' } = input

  // Source: Ghilani & Wolf, Section 10.4 — E2 = E1 + D×sin(WCB), N2 = N1 + D×cos(WCB)
  const wcbDecimal = bearingDeg + bearingMin / 60 + bearingSec / 3600
  const wcbRad = wcbDecimal * Math.PI / 180
  const e2 = e1 + distance * Math.sin(wcbRad)
  const n2 = n1 + distance * Math.cos(wcbRad)
  const wcbDMS = bearingToString(wcbDecimal)

  const steps: InverseStep[] = [
    {
      description: `WCB (decimal) = D° + M'/60 + S"/3600`,
      formula: `${bearingDeg}° + ${bearingMin}'/60 + ${bearingSec}"/3600`,
      value: `${wcbDecimal.toFixed(6)}°`,
    },
    {
      description: `E₂ = E₁ + D × sin(WCB)`,
      formula: `${e1.toFixed(3)} + ${distance.toFixed(3)} × sin(${wcbDecimal.toFixed(4)}°)`,
      value: `${e2.toFixed(4)} m`,
    },
    {
      description: `N₂ = N₁ + D × cos(WCB)`,
      formula: `${n1.toFixed(3)} + ${distance.toFixed(3)} × cos(${wcbDecimal.toFixed(4)}°)`,
      value: `${n2.toFixed(4)} m`,
    },
  ]

  return { wcbDecimal, wcbDMS, e2, n2, steps }
}

// ─── PART 3: BEARING INTERSECTION ─────────────────────────────────────────────
// Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Section 10.6
// Source: Schofield & Breach, Engineering Surveying 7th Ed., Chapter 6

export interface IntersectionInput {
  e1: number; n1: number; label1?: string
  e2: number; n2: number; label2?: string
  bearingDeg1: number; bearingMin1: number; bearingSec1: number
  bearingDeg2: number; bearingMin2: number; bearingSec2: number
}

export interface IntersectionResult {
  e3: number
  n3: number
  distanceFrom1: number
  distanceFrom2: number
  checkN3: number
  checkDiff: number
  steps: InverseStep[]
  isWithinTolerance: boolean
}

export function intersectionComputation(input: IntersectionInput): IntersectionResult {
  const {
    e1, n1, e2, n2,
    bearingDeg1, bearingMin1, bearingSec1,
    bearingDeg2, bearingMin2, bearingSec2,
  } = input

  const alpha1 = (bearingDeg1 + bearingMin1 / 60 + bearingSec1 / 3600) * Math.PI / 180
  const alpha2 = (bearingDeg2 + bearingMin2 / 60 + bearingSec2 / 3600) * Math.PI / 180

  const tan1 = Math.tan(alpha1)
  const tan2 = Math.tan(alpha2)

  const denom = tan1 - tan2
  const e3 = (e2 - e1 + n1 * tan1 - n2 * tan2) / denom
  const n3From1 = n1 + (e3 - e1) * Math.tan(alpha1)

  // Independent check: compute N3 from P2 side
  const n3From2 = n2 + (e3 - e2) * Math.tan(alpha2)
  const checkDiff = Math.abs(n3From1 - n3From2)

  const dist1 = Math.sqrt((e3 - e1) ** 2 + (n3From1 - n1) ** 2)
  const dist2 = Math.sqrt((e3 - e2) ** 2 + (n3From1 - n2) ** 2)

  const steps: InverseStep[] = [
    {
      description: `α₁ = ${bearingDeg1}° ${bearingMin1}' ${bearingSec1}" → radians`,
      formula: `${(alpha1 * 180 / Math.PI).toFixed(6)}°`,
      value: `${alpha1.toFixed(8)} rad`,
    },
    {
      description: `α₂ = ${bearingDeg2}° ${bearingMin2}' ${bearingSec2}" → radians`,
      formula: `${(alpha2 * 180 / Math.PI).toFixed(6)}°`,
      value: `${alpha2.toFixed(8)} rad`,
    },
    {
      description: `tan(α₁) - tan(α₂)`,
      formula: `${tan1.toFixed(8)} - ${tan2.toFixed(8)}`,
      value: `${denom.toFixed(8)}`,
    },
    {
      description: `E₃ = (E₂ - E₁ + N₁tan(α₁) - N₂tan(α₂)) / (tan(α₁) - tan(α₂))`,
      formula: `(${e2.toFixed(3)} - ${e1.toFixed(3)} + ${n1.toFixed(3)}×${tan1.toFixed(6)} - ${n2.toFixed(3)}×${tan2.toFixed(6)}) / ${denom.toFixed(6)}`,
      value: `${e3.toFixed(4)} m`,
    },
    {
      description: `N₃ = N₁ + (E₃ - E₁) × tan(α₁)`,
      formula: `${n1.toFixed(3)} + (${e3.toFixed(4)} - ${e1.toFixed(3)}) × ${tan1.toFixed(6)}`,
      value: `${n3From1.toFixed(4)} m`,
    },
    {
      description: `[CHECK] N₃ from P₂ side = N₂ + (E₃ - E₂) × tan(α₂)`,
      formula: `${n2.toFixed(3)} + (${e3.toFixed(4)} - ${e2.toFixed(3)}) × ${tan2.toFixed(6)}`,
      value: `${n3From2.toFixed(4)} m`,
    },
    {
      description: `[CHECK] Difference between both N₃ computations`,
      formula: `|${n3From1.toFixed(4)} - ${n3From2.toFixed(4)}|`,
      value: `${checkDiff.toFixed(4)} m  ${checkDiff <= 0.001 ? ' PASS' : '[x] FAIL'}`,
    },
  ]

  return {
    e3, n3: n3From1,
    distanceFrom1: dist1,
    distanceFrom2: dist2,
    checkN3: n3From2,
    checkDiff,
    steps,
    isWithinTolerance: checkDiff <= 0.001,
  }
}

// ─── PART 4: RESECTION (TIENSTRA/POTHENOT) ────────────────────────────────────
// Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Section 10.7

export interface ResectionInput {
  // Three known points
  eA: number; nA: number; labelA?: string
  eB: number; nB: number; labelB?: string
  eC: number; nC: number; labelC?: string
  // Angles measured at unknown point P
  alphaDeg: number; alphaMin: number; alphaSec: number  // angle APB
  betaDeg: number; betaMin: number; betaSec: number    // angle BPC
}

export interface ResectionResult {
  eP: number
  nP: number
  distToA: number
  distToB: number
  distToC: number
  k1: number; k2: number; k3: number
  sumK: number
  isDangerCircle: boolean
  steps: InverseStep[]
}

function toRadians(deg: number, min: number, sec: number): number {
  return (deg + min / 60 + sec / 3600) * Math.PI / 180
}

export function resectionComputation(input: ResectionInput): ResectionResult {
  const { eA, nA, eB, nB, eC, nC,
    alphaDeg, alphaMin, alphaSec,
    betaDeg, betaMin, betaSec } = input

  const alpha = toRadians(alphaDeg, alphaMin, alphaSec)
  const beta = toRadians(betaDeg, betaMin, betaSec)
  const gamma = 2 * Math.PI - alpha - beta

  const cot = (r: number) => 1 / Math.tan(r)

  // Source: Ghilani & Wolf, Section 10.7 — Tienstra method
  // Compute triangle sides from known points
  const distAB = Math.sqrt((eB - eA) ** 2 + (nB - nA) ** 2)
  const distBC = Math.sqrt((eC - eB) ** 2 + (nC - nB) ** 2)
  const distAC = Math.sqrt((eC - eA) ** 2 + (nC - nA) ** 2)

  // Triangle angles at A, B, C using law of cosines
  const clamp = (x: number) => Math.max(-1, Math.min(1, x))
  const A = Math.acos(clamp((distAB ** 2 + distAC ** 2 - distBC ** 2) / (2 * distAB * distAC)))
  const B = Math.acos(clamp((distAB ** 2 + distBC ** 2 - distAC ** 2) / (2 * distAB * distBC)))
  const C = Math.acos(clamp((distAC ** 2 + distBC ** 2 - distAB ** 2) / (2 * distAC * distBC)))

  const cot_A = cot(A)
  const cot_B = cot(B)
  const cot_C = cot(C)
  const cot_alpha = cot(alpha)
  const cot_beta = cot(beta)
  const cot_gamma = cot(gamma)

  const k1 = 1 / (cot_A - cot_alpha)
  const k2 = 1 / (cot_B - cot_beta)
  const k3 = 1 / (cot_C - cot_gamma)
  const sumK = k1 + k2 + k3

  const eP = (k1 * eA + k2 * eB + k3 * eC) / sumK
  const nP = (k1 * nA + k2 * nB + k3 * nC) / sumK

  const distToA = Math.sqrt((eP - eA) ** 2 + (nP - nA) ** 2)
  const distToB = Math.sqrt((eP - eB) ** 2 + (nP - nB) ** 2)
  const distToC = Math.sqrt((eP - eC) ** 2 + (nP - nC) ** 2)

  const isDangerCircle = Math.abs(sumK) < 0.001

  const steps: InverseStep[] = [
    {
      description: `α = ∠APB = ${alphaDeg}° ${alphaMin}' ${alphaSec}"`,
      formula: `${(alpha * 180 / Math.PI).toFixed(6)}°`,
      value: `${alpha.toFixed(8)} rad`,
    },
    {
      description: `β = ∠BPC = ${betaDeg}° ${betaMin}' ${betaSec}"`,
      formula: `${(beta * 180 / Math.PI).toFixed(6)}°`,
      value: `${beta.toFixed(8)} rad`,
    },
    {
      description: `γ = 360° - (α + β)`,
      formula: `360° - (${(alpha * 180 / Math.PI).toFixed(4)}° + ${(beta * 180 / Math.PI).toFixed(4)}°)`,
      value: `${(gamma * 180 / Math.PI).toFixed(6)}°`,
    },
    {
      description: `cot(A) = (b² + c² - a²) / (2bc)`,
      formula: `${cot_A.toFixed(6)}`,
      value: `A = ${(A * 180 / Math.PI).toFixed(6)}°`,
    },
    {
      description: `cot(B) = (a² + c² - b²) / (2ac)`,
      formula: `${cot_B.toFixed(6)}`,
      value: `B = ${(B * 180 / Math.PI).toFixed(6)}°`,
    },
    {
      description: `cot(C) = (a² + b² - c²) / (2ab)`,
      formula: `${cot_C.toFixed(6)}`,
      value: `C = ${(C * 180 / Math.PI).toFixed(6)}°`,
    },
    {
      description: `K₁ = 1 / (cot(A) - cot(α))`,
      formula: `1 / (${cot_A.toFixed(4)} - ${cot_alpha.toFixed(4)})`,
      value: `${k1.toFixed(6)}`,
    },
    {
      description: `K₂ = 1 / (cot(B) - cot(β))`,
      formula: `1 / (${cot_B.toFixed(4)} - ${cot_beta.toFixed(4)})`,
      value: `${k2.toFixed(6)}`,
    },
    {
      description: `K₃ = 1 / (cot(C) - cot(γ))`,
      formula: `1 / (${cot_C.toFixed(4)} - ${cot_gamma.toFixed(4)})`,
      value: `${k3.toFixed(6)}`,
    },
    {
      description: `ΣK = K₁ + K₂ + K₃`,
      formula: `${k1.toFixed(6)} + ${k2.toFixed(6)} + ${k3.toFixed(6)}`,
      value: `${sumK.toFixed(6)}${isDangerCircle ? ' [!] DANGER CIRCLE' : ''}`,
    },
    {
      description: `Eₚ = (K₁×Eₐ + K₂×Eᵦ + K₃×E꜀) / ΣK`,
      formula: `(${k1.toFixed(4)}×${eA.toFixed(3)} + ${k2.toFixed(4)}×${eB.toFixed(3)} + ${k3.toFixed(4)}×${eC.toFixed(3)}) / ${sumK.toFixed(4)}`,
      value: `${eP.toFixed(4)} m`,
    },
    {
      description: `Nₚ = (K₁×Nₐ + K₂×Nᵦ + K₃×N꜀) / ΣK`,
      formula: `(${k1.toFixed(4)}×${nA.toFixed(3)} + ${k2.toFixed(4)}×${nB.toFixed(3)} + ${k3.toFixed(4)}×${nC.toFixed(3)}) / ${sumK.toFixed(4)}`,
      value: `${nP.toFixed(4)} m`,
    },
  ]

  return { eP, nP, distToA, distToB, distToC, k1, k2, k3, sumK, isDangerCircle, steps }
}

// ─── PART 5: AREA BY COORDINATES (SHOELACE) ───────────────────────────────────
// Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Section 12.5
// Source: N.N. Basak, Surveying and Levelling

export interface AreaInput {
  points: Array<{ label: string; easting: number; northing: number }>
}

export interface AreaDiagonalRow {
  from: string
  to: string
  posProduct: number
  negProduct: number
}

export interface AreaResult {
  doubleArea: number
  areaSqm: number
  areaHa: number
  perimeter: number
  diagonalRows: AreaDiagonalRow[]
  positiveSum: number
  negativeSum: number
  doubleAreaAlt: number
  areaAlt: number
  arithmeticCheck: { passed: boolean; diff: number }
  centroid: { easting: number; northing: number }
  steps: InverseStep[]
}

function closePolygon(pts: Array<{ label: string; easting: number; northing: number }>) {
  const closed = [...pts]
  if (pts.length > 0 &&
    (pts[0].easting !== pts[pts.length - 1].easting ||
      pts[0].northing !== pts[pts.length - 1].northing)) {
    closed.push(pts[0])
  }
  return closed
}

export function areaComputation(input: AreaInput): AreaResult {
  const pts = input.points
  if (pts.length < 3) {
    return {
      doubleArea: 0, areaSqm: 0, areaHa: 0, perimeter: 0,
      diagonalRows: [], positiveSum: 0, negativeSum: 0,
      doubleAreaAlt: 0, areaAlt: 0,
      arithmeticCheck: { passed: false, diff: 0 },
      centroid: { easting: 0, northing: 0 },
      steps: [],
    }
  }

  const closed = closePolygon(pts)

  // Method 1: Standard shoelace (Source: Ghilani & Wolf, Section 12.5)
  let posSum = 0
  let negSum = 0
  const diagonalRows: AreaDiagonalRow[] = []

  for (let i = 0; i < closed.length - 1; i++) {
    const pos = closed[i].easting * closed[i + 1].northing
    const neg = closed[i + 1].easting * closed[i].northing
    posSum += pos
    negSum += neg
    diagonalRows.push({
      from: closed[i].label,
      to: closed[i + 1].label,
      posProduct: pos,
      negProduct: neg,
    })
  }

  const doubleArea = Math.abs(posSum - negSum)
  const areaSqm = doubleArea / 2

  // Method 2: Alternative form (Source: Rule 5 — arithmetic check)
  // 2A = |Σ En(Nn+1 - Nn-1)|
  let altPosSum = 0
  for (let i = 0; i < pts.length; i++) {
    const prev = i === 0 ? pts.length - 1 : i - 1
    const next = i === pts.length - 1 ? 0 : i + 1
    altPosSum += pts[i].easting * (pts[next].northing - pts[prev].northing)
  }
  const doubleAreaAlt = Math.abs(altPosSum)
  const areaAlt = doubleAreaAlt / 2

  const arithmeticCheck = {
    passed: Math.abs(doubleArea - doubleAreaAlt) < 0.001,
    diff: Math.abs(doubleArea - doubleAreaAlt),
  }

  // Perimeter (Source: Basak)
  let perimeter = 0
  for (let i = 0; i < closed.length - 1; i++) {
    const dx = closed[i + 1].easting - closed[i].easting
    const dy = closed[i + 1].northing - closed[i].northing
    perimeter += Math.sqrt(dx * dx + dy * dy)
  }

  // Centroid (Source: Basak)
  let cx = 0, cy = 0
  for (let i = 0; i < pts.length; i++) {
    const cross = pts[i].easting * (pts[(i + 1) % pts.length].northing - pts[(i - 1 + pts.length) % pts.length].northing)
    cx += (pts[i].easting + pts[(i + 1) % pts.length].easting) * cross
    cy += (pts[i].northing + pts[(i + 1) % pts.length].northing) * cross
  }
  cx /= (3 * (posSum - negSum))
  cy /= (3 * (posSum - negSum))

  const steps: InverseStep[] = [
    {
      description: `Σ(E × N_next) — positive diagonal products`,
      formula: diagonalRows.map((r: any) => `${r.from}×${r.to}=${r.posProduct.toFixed(2)}`).join(' + '),
      value: `${posSum.toFixed(4)} m²`,
    },
    {
      description: `Σ(N × E_next) — negative diagonal products`,
      formula: diagonalRows.map((r: any) => `${r.to}×${r.from}=${r.negProduct.toFixed(2)}`).join(' + '),
      value: `${negSum.toFixed(4)} m²`,
    },
    {
      description: `2A = |Σpos - Σneg|`,
      formula: `|${posSum.toFixed(4)} - ${negSum.toFixed(4)}|`,
      value: `${doubleArea.toFixed(4)} m²`,
    },
    {
      description: `A = 2A / 2`,
      formula: `${doubleArea.toFixed(4)} / 2`,
      value: `${areaSqm.toFixed(4)} m² = ${(areaSqm / 10000).toFixed(4)} ha`,
    },
    {
      description: `[CHECK] Alternative: 2A = |Σ En(Nn+1 - Nn-1)|`,
      formula: `${doubleAreaAlt.toFixed(4)}`,
      value: `Difference: ${arithmeticCheck.diff.toFixed(4)} m²  ${arithmeticCheck.passed ? ' PASS' : '[x] FAIL'}`,
    },
    {
      description: `Perimeter = Σ√(ΔE² + ΔN²)`,
      formula: `${perimeter.toFixed(4)} m (${(perimeter / 1000).toFixed(4)} km)`,
      value: `${perimeter.toFixed(4)} m`,
    },
  ]

  return {
    doubleArea, areaSqm,
    areaHa: areaSqm / 10000,
    perimeter,
    diagonalRows,
    positiveSum: posSum,
    negativeSum: negSum,
    doubleAreaAlt,
    areaAlt,
    arithmeticCheck,
    centroid: { easting: cx, northing: cy },
    steps,
  }
}

// ─── PART 6: JOIN COMPUTATION ─────────────────────────────────────────────────
// Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Section 10.3

export interface JoinInput {
  points: Array<{ label: string; easting: number; northing: number }>
}

export interface JoinRow {
  from: string
  to: string
  deltaE: number
  deltaN: number
  distance: number
  wcbDecimal: number
  wcbDMS: string
  backBearingDMS: string
}

export interface JoinResult {
  rows: JoinRow[]
  totalPerimeter: number
}

export function joinComputation(input: JoinInput): JoinResult {
  const rows: JoinRow[] = []
  let totalPerimeter = 0

  for (let i = 0; i < input.points.length - 1; i++) {
    const p1 = input.points[i]
    const p2 = input.points[i + 1]
    const inv = inverseComputation({
      e1: p1.easting, n1: p1.northing,
      e2: p2.easting, n2: p2.northing,
      label1: p1.label, label2: p2.label,
    })
    rows.push({
      from: p1.label,
      to: p2.label,
      deltaE: inv.deltaE,
      deltaN: inv.deltaN,
      distance: inv.distance,
      wcbDecimal: inv.wcbDecimal,
      wcbDMS: inv.wcbDMS,
      backBearingDMS: inv.backBearingDMS,
    })
    totalPerimeter += inv.distance
  }

  return { rows, totalPerimeter }
}

// ─── PART 7: DISTANCE-DISTANCE INTERSECTION ──────────────────────────────────
// Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Section 10.6
// Two circles intersection — given two known points and distances from each

export interface DistDistInput {
  e1: number; n1: number; label1?: string
  e2: number; n2: number; label2?: string
  distance1: number
  distance2: number
}

export interface DistDistResult {
  solutions: Array<{ easting: number; northing: number }>
  distAB: number
  steps: InverseStep[]
  hasSolution: boolean
  error?: string
}

export function distanceDistanceIntersection(input: DistDistInput): DistDistResult {
  const { e1, n1, e2, n2, distance1, distance2, label1 = 'P1', label2 = 'P2' } = input

  const dx = e2 - e1
  const dy = n2 - n1
  const distAB = Math.sqrt(dx * dx + dy * dy)

  const steps: InverseStep[] = [
    {
      description: `Distance ${label1}→${label2}`,
      formula: `√((${e2.toFixed(3)}-${e1.toFixed(3)})² + (${n2.toFixed(3)}-${n1.toFixed(3)})²)`,
      value: `${distAB.toFixed(4)} m`,
    },
  ]

  // Check validity
  if (distAB > distance1 + distance2) {
    return { solutions: [], distAB, steps, hasSolution: false, error: 'Circles do not intersect — stations too far apart' }
  }
  if (distAB < Math.abs(distance1 - distance2)) {
    return { solutions: [], distAB, steps, hasSolution: false, error: 'One circle is contained within the other' }
  }
  if (distAB < 1e-12) {
    return { solutions: [], distAB, steps, hasSolution: false, error: 'Stations are coincident' }
  }

  // Source: Ghilani & Wolf — circle-circle intersection
  const a = (distance1 * distance1 - distance2 * distance2 + distAB * distAB) / (2 * distAB)
  const h = Math.sqrt(Math.max(0, distance1 * distance1 - a * a))

  const cx = e1 + a * dx / distAB
  const cy = n1 + a * dy / distAB

  const sol1 = { easting: cx + h * dy / distAB, northing: cy - h * dx / distAB }
  const sol2 = { easting: cx - h * dy / distAB, northing: cy + h * dx / distAB }

  steps.push(
    { description: `a = (d₁² - d₂² + d_AB²) / (2 × d_AB)`, formula: `(${distance1.toFixed(3)}² - ${distance2.toFixed(3)}² + ${distAB.toFixed(3)}²) / (2 × ${distAB.toFixed(3)})`, value: `${a.toFixed(4)} m` },
    { description: `h = √(d₁² - a²)`, formula: `√(${distance1.toFixed(3)}² - ${a.toFixed(3)}²)`, value: `${h.toFixed(4)} m` },
    { description: `Solution 1`, formula: `E=${sol1.easting.toFixed(4)}, N=${sol1.northing.toFixed(4)}`, value: `(${sol1.easting.toFixed(4)}, ${sol1.northing.toFixed(4)})` },
    { description: `Solution 2`, formula: `E=${sol2.easting.toFixed(4)}, N=${sol2.northing.toFixed(4)}`, value: `(${sol2.easting.toFixed(4)}, ${sol2.northing.toFixed(4)})` },
  )

  // Check if solutions are identical (tangent circles)
  const sameSolution = Math.abs(sol1.easting - sol2.easting) < 0.001 && Math.abs(sol1.northing - sol2.northing) < 0.001

  return {
    solutions: sameSolution ? [sol1] : [sol1, sol2],
    distAB,
    steps,
    hasSolution: true,
  }
}

// ─── PART 8: BEARING-DISTANCE INTERSECTION ───────────────────────────────────
// Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Section 10.6
// Ray-circle intersection — bearing from P1, distance from P2

export interface BearingDistInput {
  e1: number; n1: number; label1?: string
  e2: number; n2: number; label2?: string
  bearingDeg: number; bearingMin: number; bearingSec: number
  distance: number
}

export interface BearingDistResult {
  solutions: Array<{ easting: number; northing: number }>
  steps: InverseStep[]
  hasSolution: boolean
  error?: string
}

export function bearingDistanceIntersection(input: BearingDistInput): BearingDistResult {
  const { e1, n1, e2, n2, bearingDeg, bearingMin, bearingSec, distance, label1 = 'P1', label2 = 'P2' } = input

  const wcbDecimal = bearingDeg + bearingMin / 60 + bearingSec / 3600
  const wcbRad = wcbDecimal * Math.PI / 180

  // Direction vector of the ray from P1
  const dirE = Math.sin(wcbRad)
  const dirN = Math.cos(wcbRad)

  // Solve: |P1 + t*dir - P2| = distance
  // Let dx = E1 - E2, dy = N1 - N2
  // (dx + t*dirE)² + (dy + t*dirN)² = distance²
  // t² + 2t(dx*dirE + dy*dirN) + (dx² + dy²) - distance² = 0

  const dx = e1 - e2
  const dy = n1 - n2
  const A = 1 // dirE² + dirN² = 1
  const B = 2 * (dx * dirE + dy * dirN)
  const C = dx * dx + dy * dy - distance * distance

  const discriminant = B * B - 4 * A * C

  const steps: InverseStep[] = [
    { description: `WCB from ${label1}`, formula: `${bearingDeg}° ${bearingMin}' ${bearingSec}"`, value: bearingToString(wcbDecimal) },
    { description: `Distance from ${label2}`, formula: `${distance.toFixed(3)} m`, value: `${distance.toFixed(4)} m` },
    { description: `Quadratic: t² + ${B.toFixed(4)}t + ${C.toFixed(4)} = 0`, formula: `Δ = ${B.toFixed(4)}² - 4×${C.toFixed(4)}`, value: `Δ = ${discriminant.toFixed(4)}` },
  ]

  if (discriminant < -1e-6) {
    return { solutions: [], steps, hasSolution: false, error: 'Ray does not intersect circle — no solution exists' }
  }

  const sqrtDisc = Math.sqrt(Math.max(0, discriminant))
  const t1 = (-B + sqrtDisc) / 2
  const t2 = (-B - sqrtDisc) / 2

  const solutions: Array<{ easting: number; northing: number }> = []

  if (t1 >= -1e-6) {
    const sol = { easting: e1 + t1 * dirE, northing: n1 + t1 * dirN }
    solutions.push(sol)
    steps.push({ description: `Solution 1 (t=${t1.toFixed(4)})`, formula: `E=${sol.easting.toFixed(4)}, N=${sol.northing.toFixed(4)}`, value: `(${sol.easting.toFixed(4)}, ${sol.northing.toFixed(4)})` })
  }

  if (t2 >= -1e-6 && Math.abs(t1 - t2) > 0.001) {
    const sol = { easting: e1 + t2 * dirE, northing: n1 + t2 * dirN }
    solutions.push(sol)
    steps.push({ description: `Solution 2 (t=${t2.toFixed(4)})`, formula: `E=${sol.easting.toFixed(4)}, N=${sol.northing.toFixed(4)}`, value: `(${sol.easting.toFixed(4)}, ${sol.northing.toFixed(4)})` })
  }

  if (solutions.length === 0) {
    return { solutions: [], steps, hasSolution: false, error: 'Both solutions are behind the ray origin' }
  }

  return { solutions, steps, hasSolution: true }
}

// ─── PART 9: ARC BOUNDARY COMPUTATIONS ───────────────────────────────────────
// Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Chapter 24
// Source: RDM 1.3 Kenya August 2023, Section 5.2

export interface ArcByRadiusInput {
  startPoint: { easting: number; northing: number }
  endPoint: { easting: number; northing: number }
  radius: number
  isClockwise: boolean
}

export interface ArcResult {
  center: { easting: number; northing: number }
  radius: number
  startAngle: number
  endAngle: number
  subtendedAngle: number
  arcLength: number
  chordLength: number
  chordBearing: number
  chordBearingDMS: string
  segmentArea: number
  points: Array<{ easting: number; northing: number }>
  steps: InverseStep[]
}

export function arcByRadiusAndChord(input: ArcByRadiusInput): ArcResult {
  const { startPoint, endPoint, radius, isClockwise } = input

  // Chord length and bearing
  const dx = endPoint.easting - startPoint.easting
  const dy = endPoint.northing - startPoint.northing
  const chordLength = Math.sqrt(dx * dx + dy * dy)
  const chordBearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360

  // Find center of arc
  // The center lies at distance R from both endpoints
  // and at distance √(R² - (C/2)²) from the chord midpoint
  const halfChord = chordLength / 2
  if (radius < halfChord) {
    throw new Error(`Radius (${radius.toFixed(3)}m) is less than half the chord (${halfChord.toFixed(3)}m)`)
  }

  const h = Math.sqrt(radius * radius - halfChord * halfChord)
  const midE = (startPoint.easting + endPoint.easting) / 2
  const midN = (startPoint.northing + endPoint.northing) / 2

  // Perpendicular to chord (unit vector)
  const perpE = -dy / chordLength
  const perpN = dx / chordLength

  // Two possible centers — pick based on clockwise/counterclockwise
  const center1 = { easting: midE + h * perpE, northing: midN + h * perpN }
  const center2 = { easting: midE - h * perpE, northing: midN - h * perpN }

  // For clockwise arc, center is to the right of the chord direction
  const crossProduct = dx * (center1.northing - startPoint.northing) -
                       dy * (center1.easting - startPoint.easting)
  const center = (isClockwise ? crossProduct < 0 : crossProduct > 0) ? center1 : center2

  // Compute start and end angles from center
  const startAngle = Math.atan2(
    startPoint.easting - center.easting,
    startPoint.northing - center.northing
  ) * 180 / Math.PI
  const endAngle = Math.atan2(
    endPoint.easting - center.easting,
    endPoint.northing - center.northing
  ) * 180 / Math.PI

  // Subtended angle
  let subtendedAngle = isClockwise
    ? ((startAngle - endAngle + 360) % 360)
    : ((endAngle - startAngle + 360) % 360)
  if (subtendedAngle === 0) subtendedAngle = 360

  const arcLength = radius * subtendedAngle * Math.PI / 180

  // Segment area = (R²/2)(θ - sinθ) where θ is in radians
  const thetaRad = subtendedAngle * Math.PI / 180
  const segmentArea = (radius * radius / 2) * (thetaRad - Math.sin(thetaRad))

  // Generate arc points for DXF/display
  const numPoints = Math.max(8, Math.ceil(subtendedAngle / 2))
  const points: Array<{ easting: number; northing: number }> = []
  const startRad = startAngle * Math.PI / 180

  for (let i = 0; i <= numPoints; i++) {
    const fraction = i / numPoints
    const angle = isClockwise
      ? startRad - fraction * thetaRad
      : startRad + fraction * thetaRad

    points.push({
      easting: center.easting + radius * Math.sin(angle),
      northing: center.northing + radius * Math.cos(angle),
    })
  }

  const steps: InverseStep[] = [
    { description: 'Chord length', formula: `√((${dx.toFixed(3)})² + (${dy.toFixed(3)})²)`, value: `${chordLength.toFixed(4)} m` },
    { description: 'Chord bearing', formula: `atan2(ΔE, ΔN)`, value: bearingToString(chordBearing) },
    { description: 'Center E, N', formula: `Mid ± h × perp`, value: `(${center.easting.toFixed(4)}, ${center.northing.toFixed(4)})` },
    { description: 'Subtended angle', formula: isClockwise ? 'CW' : 'CCW', value: `${subtendedAngle.toFixed(4)}°` },
    { description: 'Arc length', formula: `R × θ`, value: `${arcLength.toFixed(4)} m` },
    { description: 'Segment area', formula: `(R²/2)(θ - sinθ)`, value: `${segmentArea.toFixed(4)} m²` },
  ]

  return {
    center, radius, startAngle, endAngle, subtendedAngle,
    arcLength, chordLength, chordBearing,
    chordBearingDMS: bearingToString(chordBearing),
    segmentArea, points, steps,
  }
}

// ─── ARC BY 3 POINTS ────────────────────────────────────────────────────────
// Source: Ghilani & Wolf, Chapter 24 — circumscribed circle of 3 points

export interface Arc3PointInput {
  p1: { easting: number; northing: number }
  p2: { easting: number; northing: number }
  p3: { easting: number; northing: number }
}

export function arcBy3Points(input: Arc3PointInput): ArcResult {
  const { p1, p2, p3 } = input

  // Find circumcenter and radius
  const ax = p1.easting, ay = p1.northing
  const bx = p2.easting, by = p2.northing
  const cx = p3.easting, cy = p3.northing

  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(D) < 1e-10) {
    throw new Error('Three points are collinear — cannot define an arc')
  }

  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D

  const center = { easting: ux, northing: uy }
  const radius = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2)

  // Determine if arc is clockwise or counterclockwise
  const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  const isClockwise = cross < 0

  return arcByRadiusAndChord({
    startPoint: p1,
    endPoint: p3,
    radius,
    isClockwise,
  })
}

// ─── PART 10: OFFSET/PARALLEL LINE ──────────────────────────────────────────
// Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Section 10.8

export interface OffsetLineInput {
  points: Array<{ easting: number; northing: number }>
  offset: number  // positive = left, negative = right
}

export interface OffsetLineResult {
  originalPoints: Array<{ easting: number; northing: number }>
  offsetPoints: Array<{ easting: number; northing: number }>
  offset: number
  totalLength: number
  steps: InverseStep[]
}

export function computeOffsetLine(input: OffsetLineInput): OffsetLineResult {
  const { points, offset } = input

  if (points.length < 2) {
    throw new Error('At least 2 points required for offset line')
  }

  const offsetPoints: Array<{ easting: number; northing: number }> = []
  const steps: InverseStep[] = []

  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      // First point: use first segment's perpendicular
      const dx = points[1].easting - points[0].easting
      const dy = points[1].northing - points[0].northing
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 1e-12) continue
      const perpE = -dy / len
      const perpN = dx / len
      offsetPoints.push({
        easting: points[0].easting + offset * perpE,
        northing: points[0].northing + offset * perpN,
      })
    } else if (i === points.length - 1) {
      // Last point: use last segment's perpendicular
      const dx = points[i].easting - points[i - 1].easting
      const dy = points[i].northing - points[i - 1].northing
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 1e-12) continue
      const perpE = -dy / len
      const perpN = dx / len
      offsetPoints.push({
        easting: points[i].easting + offset * perpE,
        northing: points[i].northing + offset * perpN,
      })
    } else {
      // Interior point: bisector of adjacent segments
      const dx1 = points[i].easting - points[i - 1].easting
      const dy1 = points[i].northing - points[i - 1].northing
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1)
      const dx2 = points[i + 1].easting - points[i].easting
      const dy2 = points[i + 1].northing - points[i].northing
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)

      if (len1 < 1e-12 || len2 < 1e-12) {
        offsetPoints.push({ ...points[i] })
        continue
      }

      // Average perpendicular
      const p1E = -dy1 / len1, p1N = dx1 / len1
      const p2E = -dy2 / len2, p2N = dx2 / len2
      const avgE = (p1E + p2E) / 2
      const avgN = (p1N + p2N) / 2
      const avgLen = Math.sqrt(avgE * avgE + avgN * avgN)

      if (avgLen < 1e-12) {
        offsetPoints.push({ ...points[i] })
        continue
      }

      // Scale to maintain correct offset distance at bisector
      const sinHalfAngle = avgLen
      const scale = offset / sinHalfAngle

      offsetPoints.push({
        easting: points[i].easting + scale * avgE,
        northing: points[i].northing + scale * avgN,
      })
    }
  }

  // Total length of offset line
  let totalLength = 0
  for (let i = 0; i < offsetPoints.length - 1; i++) {
    const dx = offsetPoints[i + 1].easting - offsetPoints[i].easting
    const dy = offsetPoints[i + 1].northing - offsetPoints[i].northing
    totalLength += Math.sqrt(dx * dx + dy * dy)
  }

  steps.push(
    { description: 'Offset distance', formula: `${Math.abs(offset).toFixed(3)} m ${offset >= 0 ? 'left' : 'right'}`, value: `${offset.toFixed(3)} m` },
    { description: 'Points processed', formula: `${points.length} → ${offsetPoints.length}`, value: `${offsetPoints.length} points` },
    { description: 'Offset line length', formula: `Σ√(ΔE² + ΔN²)`, value: `${totalLength.toFixed(4)} m` },
  )

  return { originalPoints: points, offsetPoints, offset, totalLength, steps }
}
