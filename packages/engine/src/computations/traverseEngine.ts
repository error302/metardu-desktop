// METARDU Traverse Computation Engine
// Source: N.N. Basak, Surveying and Levelling, Chapters 10-11
// Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Chapters 10, 12
// Source: RDM 1.1 Kenya 2025, Table 2.4 — Accuracy Classification
// Source: Survey Regulations 1994, Cap 299, Regulation 97

import { dmsToDecimal, bearingToString } from '../engine/angles'

function dmsStr(d: number, m: number, s: number): string {
  return `${String(Math.floor(Math.abs(d))).padStart(3,'0')}° ${String(Math.floor(Math.abs(m))).padStart(2,'0')}' ${Math.abs(s).toFixed(3)}"`
}

function angleDMS(angleDeg: number): string {
  const norm = ((angleDeg % 360) + 360) % 360
  const d = Math.floor(norm)
  const mFloat = (norm - d) * 60
  const m = Math.floor(mFloat)
  const s = (mFloat - m) * 60
  return `${String(d).padStart(3,'0')}° ${String(m).padStart(2,'0')}' ${s.toFixed(1)}"`
}

export interface RawObservation {
  station: string
  bs: string
  fs: string
  hclDeg: string
  hclMin: string
  hclSec: string
  hcrDeg: string
  hcrMin: string
  hcrSec: string
  slopeDist: string
  vaDeg: string
  vaMin: string
  vaSec: string
  ih: string
  th: string
  remarks?: string
}

export interface ReducedObservation {
  station: string
  hcl: number
  hcr: number
  meanAngle: number
  meanAngleDMS: string
  slopeDist: number
  verticalAngle: number
  verticalAngleRad: number
  horizontalDist: number
  deltaH: number
  ih: number
  th: number
  remarks?: string
}

export interface TraverseComputationLeg {
  from: string
  to: string
  meanAngle: number
  meanAngleDMS: string
  wcb: number
  wcbDMS: string
  sd: number
  hd: number
  departure: number
  latitude: number
  depCorrection: number
  latCorrection: number
  adjDep: number
  adjLat: number
}

export interface TraverseComputationResult {
  rawObservations: RawObservation[]
  observations: ReducedObservation[]
  legs: TraverseComputationLeg[]
  coordinates: Array<{ station: string; easting: number; northing: number; rl?: number }>
  totalPerimeter: number
  sumDepartures: number
  sumLatitudes: number
  linearError: number
  precisionRatio: number
  accuracyOrder: string
  C_mm: number
  K_km: number
  formula: string
  allowable: number
  openingPoint: { easting: number; northing: number; rl?: number }
  closingPoint?: { easting: number; northing: number }
  isClosed: boolean
}

export interface AccuracyClass {
  order: string
  C_mm: number
  K_km: number
  allowable: number
  formula: string
  pass: boolean
}

function classifyAccuracy(C_mm: number, K_km: number): AccuracyClass {
  // Source: RDM 1.1 Kenya 2025, Table 2.4 — Accuracy Classification
  // m = C/√K (mm/√km), where C = closing error in mm, K = perimeter in km
  // Source: Ghilani & Wolf, Chapter 12 — Traverse accuracy standards
  //
  // FIXED: Previous version computed m = C_mm/1000 (metres) but compared against
  // allowable values in mm — units mismatch made everything classify as 1st Order.
  // Now correctly computes m in mm/√km and compares against RDM 1.1 coefficients.
  const K = K_km
  const m = K > 0 ? C_mm / Math.sqrt(K) : 0  // mm/√km — the RDM 1.1 classification metric

  // Source: RDM 1.1 Table 2.4 — allowable m values in mm/√km for each order
  const allow1a = 0.5   // First Order Class I: m ≤ 0.5 mm/√km
  const allow1b = 0.7   // First Order Class II: m ≤ 0.7 mm/√km
  const allow2a = 1.0   // Second Order Class I: m ≤ 1.0 mm/√km
  const allow2b = 1.3   // Second Order Class II: m ≤ 1.3 mm/√km
  const allow3 = 2.0    // Third Order: m ≤ 2.0 mm/√km

  // The allowable closing error in mm = coefficient × √K
  let order: string
  let allowableCoeff: number
  if (m <= allow1a) {
    order = 'FIRST ORDER CLASS I'
    allowableCoeff = allow1a
  } else if (m <= allow1b) {
    order = 'FIRST ORDER CLASS II'
    allowableCoeff = allow1b
  } else if (m <= allow2a) {
    order = 'SECOND ORDER CLASS I'
    allowableCoeff = allow2a
  } else if (m <= allow2b) {
    order = 'SECOND ORDER CLASS II'
    allowableCoeff = allow2b
  } else if (m <= allow3) {
    order = 'THIRD ORDER'
    allowableCoeff = allow3
  } else {
    order = 'FOURTH ORDER'
    allowableCoeff = allow3
  }

  const allowableMm = allowableCoeff * Math.sqrt(K)  // allowable closing error in mm

  return {
    order,
    C_mm,
    K_km: K,
    allowable: allowableMm,
    formula: `m = ${m.toFixed(2)} mm/√km, C = ${C_mm.toFixed(2)} mm, K = ${K.toFixed(3)} km, Allowable C = ${allowableMm.toFixed(2)} mm (${allowableCoeff} mm/√km × √${K.toFixed(3)})`,
    pass: m <= allow3,
  }
}

export function computeTraverse(input: {
  openingEasting: number
  openingNorthing: number
  openingRL?: number
  openingStation: string
  closingEasting?: number
  closingNorthing?: number
  closingStation?: string
  observations: RawObservation[]
  backsightBearingDeg: number
  backsightBearingMin: number
  backsightBearingSec: number
}): TraverseComputationResult {
  const obs = input.observations.filter((o: any) => o.station && o.slopeDist)
  if (obs.length === 0) throw new Error('No valid observations')

  const reduced: ReducedObservation[] = obs.map((o: any) => {
    // Source: Basak, Chapter 10 — Mean angle from face-left and face-right horizontal circle readings
    // Source: Ghilani & Wolf, Chapter 12 — HCR_adj = HCR + 180° when HCR < 180°
    const hcl = dmsToDecimal({ degrees: parseInt(o.hclDeg) || 0, minutes: parseInt(o.hclMin) || 0, seconds: parseFloat(o.hclSec) || 0, direction: 'N' })
    const hcr = dmsToDecimal({ degrees: parseInt(o.hcrDeg) || 0, minutes: parseInt(o.hcrMin) || 0, seconds: parseFloat(o.hcrSec) || 0, direction: 'N' })
    let hcrAdj = hcr + 180
    if (hcrAdj >= 360) hcrAdj -= 360
    // Source: Basak, Eq. 10.2 — meanAngle = (HCL + HCR_adj) / 2
    const meanAngle = (hcl + hcrAdj) / 2
    const meanAngleNorm = meanAngle >= 360 ? meanAngle - 360 : meanAngle < 0 ? meanAngle + 360 : meanAngle

    const sd = parseFloat(o.slopeDist) || 0
    const vaDeg = parseFloat(o.vaDeg) || 0
    const vaMin = parseFloat(o.vaMin) || 0
    const vaSec = parseFloat(o.vaSec) || 0
    const va = dmsToDecimal({ degrees: vaDeg, minutes: vaMin, seconds: vaSec, direction: 'N' })
    const vaRad = va * Math.PI / 180
    // Source: Ghilani & Wolf, Eq. 13.1 — Horizontal Distance = SD × cos(zenith angle)
    // Source: Basak — HD from slope distance and vertical/zenith angle
    const hd = sd * Math.cos(vaRad)
    const ih = parseFloat(o.ih) || 0
    const th = parseFloat(o.th) || 0
    // Source: Ghilani & Wolf — ΔH = SD × sin(VA) + IH - TH
    const deltaH = sd * Math.sin(vaRad) + ih - th

    return {
      station: o.station,
      hcl,
      hcr,
      meanAngle: meanAngleNorm,
      meanAngleDMS: angleDMS(meanAngleNorm),
      slopeDist: sd,
      verticalAngle: va,
      verticalAngleRad: vaRad,
      horizontalDist: hd,
      deltaH,
      ih,
      th,
      remarks: o.remarks,
    }
  })

  const backsightRad = dmsToDecimal({
    degrees: input.backsightBearingDeg,
    minutes: input.backsightBearingMin,
    seconds: input.backsightBearingSec,
    direction: 'N',
  }) * Math.PI / 180

  const legs: TraverseComputationLeg[] = []
  let currentWCB = backsightRad
  const prevStation = obs[0]?.bs || input.openingStation
  let currentE = input.openingEasting
  let currentN = input.openingNorthing
  let currentRL = input.openingRL ?? 0

  const stations = [input.openingStation, ...obs.map((o: any) => o.station)]

  for (let i = 0; i < obs.length; i++) {
    // Source: Basak, Chapter 10 — WCB propagation using observed angles
    // WCB(forward) = back_bearing(previous line) + observed angle (clockwise from BS to FS)
    // back_bearing(x) = x + 180°
    // currentWCB is initialized as the backsight bearing (already a back bearing),
    // then after each iteration it is updated to the back bearing of the computed line.
    const angle = reduced[i].meanAngle * Math.PI / 180
    let wcb = currentWCB + angle
    if (wcb < 0) wcb += 2 * Math.PI
    if (wcb >= 2 * Math.PI) wcb -= 2 * Math.PI
    const wcbDeg = wcb * 180 / Math.PI
    const hd = reduced[i].horizontalDist
    // Source: Basak, Eq. 10.3 — Departure = HD × sin(WCB), Latitude = HD × cos(WCB)
    const dep = hd * Math.sin(wcb)
    const lat = hd * Math.cos(wcb)
    currentE += dep
    currentN += lat
    currentRL += reduced[i].deltaH

    legs.push({
      from: stations[i],
      to: stations[i + 1] || obs[i].fs || `T${i + 1}`,
      meanAngle: reduced[i].meanAngle,
      meanAngleDMS: reduced[i].meanAngleDMS,
      wcb: wcbDeg,
      wcbDMS: angleDMS(wcbDeg),
      sd: reduced[i].slopeDist,
      hd,
      departure: dep,
      latitude: lat,
      depCorrection: 0,
      latCorrection: 0,
      adjDep: dep,
      adjLat: lat,
    })

    // FIXED: Update currentWCB to the BACK BEARING of the line just computed.
    // Previous version set currentWCB = wcb (forward bearing), which caused all
    // subsequent WCBs to be wrong by 180°. The correct propagation requires:
    //   WCB_next = back_bearing(WCB_current) + angle_next
    // Source: Basak Ch.10, Ghilani & Wolf Ch.10
    currentWCB = wcb + Math.PI
    if (currentWCB >= 2 * Math.PI) currentWCB -= 2 * Math.PI
  }

  const closingE = input.closingEasting
  const closingN = input.closingNorthing
  const isClosed = closingE !== undefined && closingN !== undefined

  let sumDep = legs.reduce((s, l) => s + l.departure, 0)
  let sumLat = legs.reduce((s, l) => s + l.latitude, 0)

  let linearError = 0
  let precisionRatio = 0
  let C_mm = 0
  let K_km = 0

  if (isClosed && closingE !== undefined && closingN !== undefined) {
    const totalDist = legs.reduce((s, l) => s + l.hd, 0)

    // FIXED: Previous version added actualDep/actualLat to sumDep/sumLat before
    // computing corrections. This was WRONG — for a loop traverse (closing=opening),
    // it made sumDep=0, resulting in ZERO Bowditch adjustment despite misclosure.
    //
    // Correct approach (Source: Basak Ch.11, Ghilani & Wolf Ch.12):
    //   Misclosure in departure = Σdep − (Eclosing − Eopening)
    //   Misclosure in latitude  = Σlat − (Nclosing − Nopening)
    //   Bowditch correction_i = −(misclosure/ΣD) × D_i
    //
    // After correction, ΣadjDep = Eclosing − Eopening, ΣadjLat = Nclosing − Nopening
    const eDep = sumDep - (closingE - input.openingEasting)   // departure misclosure
    const eLat = sumLat - (closingN - input.openingNorthing)  // latitude misclosure
    linearError = Math.sqrt(eDep * eDep + eLat * eLat)
    K_km = totalDist / 1000
    precisionRatio = totalDist / Math.max(linearError, 1e-12)
    C_mm = linearError * 1000

    // Source: Ghilani & Wolf, Chapter 12 — Bowditch rule: correction_i = -(misclosure/ΣD) × D_i
    // Source: Basak, Chapter 11 — Bowditch correction proportional to leg distance
    for (const leg of legs) {
      leg.depCorrection = -(eDep * (leg.hd / totalDist))
      leg.latCorrection = -(eLat * (leg.hd / totalDist))
      leg.adjDep = leg.departure + leg.depCorrection
      leg.adjLat = leg.latitude + leg.latCorrection
    }

    // Verify: adjusted sums should now equal (closing − opening)
    sumDep = legs.reduce((s, l) => s + l.adjDep, 0)
    sumLat = legs.reduce((s, l) => s + l.adjLat, 0)
  }

  const coords: Array<{ station: string; easting: number; northing: number; rl?: number }> = [
    { station: input.openingStation, easting: input.openingEasting, northing: input.openingNorthing, rl: input.openingRL },
  ]

  let adjE = input.openingEasting
  let adjN = input.openingNorthing
  let adjRL = input.openingRL ?? 0

  for (let i = 0; i < legs.length; i++) {
    adjE += legs[i].adjDep
    adjN += legs[i].adjLat
    adjRL += reduced[i].deltaH
    coords.push({ station: legs[i].to, easting: adjE, northing: adjN, rl: adjRL })
  }

  const totalPerimeter = legs.reduce((s, l) => s + l.hd, 0)
  K_km = totalPerimeter / 1000
  if (isClosed) C_mm = linearError * 1000
  else C_mm = 0

  const accClass = classifyAccuracy(C_mm, K_km)

  return {
    rawObservations: obs,
    observations: reduced,
    legs,
    coordinates: coords,
    totalPerimeter,
    sumDepartures: sumDep,
    sumLatitudes: sumLat,
    linearError,
    precisionRatio,
    accuracyOrder: accClass.order,
    C_mm,
    K_km,
    formula: accClass.formula,
    allowable: accClass.allowable,
    openingPoint: { easting: input.openingEasting, northing: input.openingNorthing, rl: input.openingRL },
    closingPoint: isClosed ? { easting: closingE!, northing: closingN! } : undefined,
    isClosed,
  }
}

export function computeBowditchAdjustment(legs: TraverseComputationLeg[], closingE: number, closingN: number): void {
  const totalDist = legs.reduce((s, l) => s + l.hd, 0)
  if (totalDist === 0) return

  // Misclosure = closing point − computed endpoint
  // (closing point is known; sum of departures/latitudes is the computed endpoint offset from opening)
  const sumDep = legs.reduce((s, l) => s + l.departure, 0)
  const sumLat = legs.reduce((s, l) => s + l.latitude, 0)

  // Linear misclosure components
  // Source: Ghilani & Wolf, Chapter 12 — eE = Σdep − (Eclosing − Eopening)
  // Here closing coords are already offset from opening, so eE = sumDep − closingE
  // and eN = sumLat − closingN
  const eE = sumDep - closingE  // departure misclosure
  const eN = sumLat - closingN  // latitude misclosure

  // Source: Ghilani & Wolf — Bowditch correction: correction_i = −(misclosure/ΣD) × D_i
  for (const leg of legs) {
    leg.depCorrection = -(eE * (leg.hd / totalDist))
    leg.latCorrection = -(eN * (leg.hd / totalDist))
    leg.adjDep = leg.departure + leg.depCorrection
    leg.adjLat = leg.latitude + leg.latCorrection
  }
}

export interface LevelBookRow {
  station: string
  bs?: number
  is?: number
  fs?: number
  hi?: number
  rl?: number
  rise?: number
  fall?: number
  distance?: number
  remarks?: string
}

export interface LevelBookResult {
  rows: LevelBookRow[]
  method: 'rise_and_fall' | 'height_of_collimation'
  sumBS: number
  sumFS: number
  sumRise: number
  sumFall: number
  arithmeticCheck: number
  arithmeticPass: boolean
  misclosure: number
  allowableMisclosure: number
  isAcceptable: boolean
  openingRL: number
  closingRL?: number
  distanceKm: number
  formula: string
}

export function computeLevelBook(input: {
  openingRL: number
  closingRL?: number
  distanceKm: number
  method: 'rise_and_fall' | 'height_of_collimation'
  rows: Array<{ station: string; bs?: number; is?: number; fs?: number; distance?: number; remarks?: string }>
}): LevelBookResult {
  const { openingRL, closingRL, distanceKm, method, rows } = input
  const result: LevelBookRow[] = []

  let sumBS = 0, sumFS = 0, sumRise = 0, sumFall = 0
  let hi: number | null = null
  let currentRL = openingRL
  let lastBS: number | null = null

  for (const row of rows) {
    const out: LevelBookRow = { station: row.station, distance: row.distance, remarks: row.remarks }

    if (row.bs !== undefined && row.bs !== null) {
      out.bs = row.bs
      sumBS += row.bs
      hi = currentRL + row.bs
      out.hi = hi
      out.rl = hi
      lastBS = row.bs
    }

    if (row.is !== undefined && row.is !== null && hi !== null) {
      out.is = row.is
      const rl = hi - row.is
      out.rl = rl
      if (method === 'rise_and_fall') {
        const prevRL = result.length > 0 ? (result[result.length - 1].rl ?? currentRL) : currentRL
        // FIXED: Previous version had diff = prevRL - rl, which inverted rise/fall.
        // Convention: Rise = current RL > previous RL (ground goes UP)
        //             Fall = current RL < previous RL (ground goes DOWN)
        // Source: Basak, Chapter 5 — Rise and Fall method
        const diff = rl - prevRL
        if (diff >= 0) { out.rise = diff; sumRise += diff }
        else { out.fall = Math.abs(diff); sumFall += Math.abs(diff) }
      }
      currentRL = rl
    }

    if (row.fs !== undefined && row.fs !== null && hi !== null) {
      out.fs = row.fs
      sumFS += row.fs
      const rl = hi - row.fs
      out.rl = rl
      if (method === 'rise_and_fall') {
        const prevRL = result.length > 0 ? (result[result.length - 1].rl ?? currentRL) : currentRL
        // FIXED: Same rise/fall sign correction as IS case above
        const diff = rl - prevRL
        if (diff >= 0) { out.rise = diff; sumRise += diff }
        else { out.fall = Math.abs(diff); sumFall += Math.abs(diff) }
      }
      currentRL = rl
      hi = null
    }

    result.push(out)
  }

  const arithmeticCheck = (sumBS - sumFS) - (currentRL - openingRL)
  const arithmeticPass = Math.abs(arithmeticCheck) < 0.001

  const misclosure = closingRL !== undefined ? Math.abs(currentRL - closingRL) : 0
  const allowable = (10 * Math.sqrt(distanceKm)) / 1000 // Kenya RDM 1.1 Table 5.1: 10√K mm
  const isAcceptable = closingRL !== undefined ? misclosure <= allowable : true

  return {
    rows: result,
    method,
    sumBS,
    sumFS,
    sumRise,
    sumFall,
    arithmeticCheck,
    arithmeticPass,
    misclosure,
    allowableMisclosure: allowable,
    isAcceptable,
    openingRL,
    closingRL,
    distanceKm,
    formula: `Allowable = 10√K = 10√${distanceKm.toFixed(3)} = ${allowable.toFixed(3)} m (RDM 1.1 Table 5.1)`,
  }
}
