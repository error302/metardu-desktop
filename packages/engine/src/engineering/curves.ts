// All angles in decimal degrees. Distances in metres.
// Standards: KRDM 2017, KeRRA Rural Roads Design Manual

export interface SimpleCurveInput {
  radius: number          // R in metres
  deflectionAngle: number // Δ (total deflection) in decimal degrees
  chainage_IP: number     // chainage at intersection point
}

export interface SimpleCurveResult {
  radius: number
  deflectionAngle: number
  tangentLength: number       // T
  curveLength: number         // L
  longChord: number           // C
  midOrdinate: number         // M
  externalDistance: number    // E
  chainage_TC: number         // chainage at tangent-to-curve
  chainage_CC: number         // chainage at curve centre (mid)
  chainage_CT: number         // chainage at curve-to-tangent
  settingOutTable: SettingOutRow[]
}

export interface SettingOutRow {
  chainage: number
  deflectionFromTC: number    // cumulative deflection angle from TC
  chordFromTC: number         // chord from TC to this point
  chordIncrement: number      // chord from previous point
}

export function simpleCircularCurve(input: SimpleCurveInput): SimpleCurveResult {
  const { radius: R, deflectionAngle: Delta, chainage_IP } = input
  const DeltaRad = (Delta * Math.PI) / 180

  const T = R * Math.tan(DeltaRad / 2)
  const L = (Math.PI * R * Delta) / 180
  const C = 2 * R * Math.sin(DeltaRad / 2)
  const M = R * (1 - Math.cos(DeltaRad / 2))
  const E = R * (1 / Math.cos(DeltaRad / 2) - 1)

  const chainage_TC = chainage_IP - T
  const chainage_CT = chainage_TC + L
  const chainage_CC = chainage_TC + L / 2

  // Setting out table — pegs at every 20m chainage
  const pegInterval = 20
  const settingOutTable: SettingOutRow[] = []

  let peg = Math.ceil(chainage_TC / pegInterval) * pegInterval
  let prevChord = 0

  while (peg <= chainage_CT) {
    const arc = peg - chainage_TC
    const deflection = (arc / (2 * R)) * (180 / Math.PI)
    const chord = 2 * R * Math.sin((arc / R) / 2)
    const increment = chord - prevChord

    settingOutTable.push({
      chainage: peg,
      deflectionFromTC: parseFloat(deflection.toFixed(6)),
      chordFromTC: parseFloat(chord.toFixed(4)),
      chordIncrement: parseFloat(increment.toFixed(4))
    })

    prevChord = chord
    peg += pegInterval
  }

  // Always include CT
  if (settingOutTable[settingOutTable.length - 1]?.chainage !== chainage_CT) {
    const arc = L
    const deflection = Delta / 2
    const chord = C
    settingOutTable.push({
      chainage: parseFloat(chainage_CT.toFixed(3)),
      deflectionFromTC: parseFloat(deflection.toFixed(6)),
      chordFromTC: parseFloat(chord.toFixed(4)),
      chordIncrement: parseFloat((chord - prevChord).toFixed(4))
    })
  }

  return {
    radius: R,
    deflectionAngle: Delta,
    tangentLength: parseFloat(T.toFixed(4)),
    curveLength: parseFloat(L.toFixed(4)),
    longChord: parseFloat(C.toFixed(4)),
    midOrdinate: parseFloat(M.toFixed(4)),
    externalDistance: parseFloat(E.toFixed(4)),
    chainage_TC: parseFloat(chainage_TC.toFixed(3)),
    chainage_CC: parseFloat(chainage_CC.toFixed(3)),
    chainage_CT: parseFloat(chainage_CT.toFixed(3)),
    settingOutTable
  }
}

export interface VerticalCurveInput {
  gradeIn: number        // g1 in percent (e.g. +3.5 = 3.5)
  gradeOut: number       // g2 in percent
  length: number         // L in metres (must satisfy K and sight distance)
  chainage_VIP: number   // chainage at vertical intersection point
  elevation_VIP: number  // elevation at VIP
}

export interface VerticalCurveResult {
  gradeIn: number
  gradeOut: number
  algebraicDiff: number  // A = g2 - g1
  kValue: number         // K = L / A
  length: number
  isCrest: boolean
  chainage_VPC: number   // start of curve
  chainage_VPT: number   // end of curve
  elevationTable: VerticalCurvePoint[]
}

export interface VerticalCurvePoint {
  chainage: number
  elevation: number
  grade: number          // grade at this point
}

export function verticalCurve(input: VerticalCurveInput): VerticalCurveResult {
  const { gradeIn: g1, gradeOut: g2, length: L, chainage_VIP, elevation_VIP } = input

  const A = g2 - g1
  const K = Math.abs(L / A)
  const isCrest = A < 0

  const chainage_VPC = chainage_VIP - L / 2
  const chainage_VPT = chainage_VIP + L / 2
  const elevation_VPC = elevation_VIP - (g1 / 100) * (L / 2)

  const elevationTable: VerticalCurvePoint[] = []
  const step = 20

  let ch = Math.ceil(chainage_VPC / step) * step
  while (ch <= chainage_VPT) {
    const x = ch - chainage_VPC
    // Parabolic equation: y = elevation_VPC + (g1/100)*x + (A/200L)*x²
    const elevation = elevation_VPC + (g1 / 100) * x + (A / (200 * L)) * x * x
    const grade = g1 + (A / L) * x   // instantaneous grade at x
    elevationTable.push({
      chainage: parseFloat(ch.toFixed(3)),
      elevation: parseFloat(elevation.toFixed(4)),
      grade: parseFloat(grade.toFixed(4))
    })
    ch += step
  }

  return {
    gradeIn: g1,
    gradeOut: g2,
    algebraicDiff: parseFloat(A.toFixed(4)),
    kValue: parseFloat(K.toFixed(2)),
    length: L,
    isCrest,
    chainage_VPC: parseFloat(chainage_VPC.toFixed(3)),
    chainage_VPT: parseFloat(chainage_VPT.toFixed(3)),
    elevationTable
  }
}
