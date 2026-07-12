/**
 * Tests for verticalCurveDesigner.ts
 *
 * Verifies:
 *   - AASHTO SSD lookup and formula
 *   - K-factor compliance (pass / warn / fail tiers)
 *   - Multi-VIP alignment chaining
 *   - Curve overlap clipping and tangent warnings
 *   - Station interpolation across tangents and curves
 *   - CSV export round-trip
 */

import {
  computeSSD,
  getDesignSpeedEntry,
  checkCurveCompliance,
  computeVerticalAlignment,
  stationAtChainage,
  stationAlignment,
  alignmentToCSV,
  complianceToCSV,
  DESIGN_SPEED_TABLE,
  type VIPInput,
} from '../verticalCurveDesigner'
import { computeVerticalCurve } from '../vertical'

describe('computeSSD', () => {
  it('matches AASHTO Green Book 2018 SSD table for 80 km/h on level grade', () => {
    const ssd = computeSSD(80, 0)
    // AASHTO 2018 Exhibit 3-2: SSD for 80 km/h = 130 m
    expect(ssd).toBeGreaterThan(125)
    expect(ssd).toBeLessThan(135)
  })

  it('matches AASHTO SSD for 50 km/h on level grade', () => {
    const ssd = computeSSD(50, 0)
    // AASHTO 2018: SSD for 50 km/h = 65 m
    expect(ssd).toBeGreaterThan(60)
    expect(ssd).toBeLessThan(70)
  })

  it('reduces SSD on uphill grade (positive gradePercent)', () => {
    const level = computeSSD(80, 0)
    const uphill = computeSSD(80, 6)
    expect(uphill).toBeLessThan(level)
  })

  it('increases SSD on downhill grade (negative gradePercent)', () => {
    const level = computeSSD(80, 0)
    const downhill = computeSSD(80, -6)
    expect(downhill).toBeGreaterThan(level)
  })

  it('clamps extreme downhill grade to avoid divide-by-zero', () => {
    const ssd = computeSSD(80, -50)
    expect(Number.isFinite(ssd)).toBe(true)
    expect(ssd).toBeGreaterThan(0)
  })
})

describe('getDesignSpeedEntry', () => {
  it('returns exact match when speed exists', () => {
    expect(getDesignSpeedEntry(80).speed).toBe(80)
    expect(getDesignSpeedEntry(80).kCrestMin).toBe(26)
    expect(getDesignSpeedEntry(80).kSagMin).toBe(16)
  })

  it('falls back to nearest lower speed for non-standard speed', () => {
    // 75 km/h falls back to 70
    const entry = getDesignSpeedEntry(75)
    expect(entry.speed).toBe(70)
  })

  it('falls back to lowest speed for speeds below the table', () => {
    const entry = getDesignSpeedEntry(10)
    expect(entry.speed).toBe(20)
  })
})

describe('checkCurveCompliance', () => {
  it('marks a crest curve with K above required as pass', () => {
    // 80 km/h, crest: K_min = 26. Need A<0 (crest). g1=+2, g2=-2 → A=-4.
    const curve = computeVerticalCurve({
      g1: 2,
      g2: -2,
      length: 200, // A=-4, K = 200/4 = 50
      pvcElevation: 100,
      pvcChainage: 1000,
    })
    expect(curve.curveType).toBe('crest')
    const c = checkCurveCompliance(curve, 80)
    expect(c.severity).toBe('ok')
    expect(c.passes).toBe(true)
    expect(c.kRequired).toBe(26)
    expect(c.kActual).toBe(50)
  })

  it('marks a crest curve with K between 0.75× and 1× required as warn', () => {
    // 80 km/h crest, K_min = 26. Need A<0. g1=+1, g2=-1 → A=-2, K=22 (0.846×).
    const curve = computeVerticalCurve({
      g1: 1,
      g2: -1,
      length: 44, // A=-2, K=22
      pvcElevation: 100,
      pvcChainage: 1000,
    })
    expect(curve.curveType).toBe('crest')
    const c = checkCurveCompliance(curve, 80)
    expect(c.severity).toBe('warn')
    expect(c.passes).toBe(false)
    expect(c.kActual).toBe(22)
  })

  it('marks a crest curve with K below 0.75× required as fail', () => {
    // 80 km/h crest, K_min = 26. Need A<0. g1=+1, g2=-1 → A=-2, K=15 (0.577×).
    const curve = computeVerticalCurve({
      g1: 1,
      g2: -1,
      length: 30, // A=-2, K=15
      pvcElevation: 100,
      pvcChainage: 1000,
    })
    expect(curve.curveType).toBe('crest')
    const c = checkCurveCompliance(curve, 80)
    expect(c.severity).toBe('fail')
    expect(c.passes).toBe(false)
  })

  it('uses sag K table for sag curves (positive A)', () => {
    // 80 km/h sag: K_min = 16. Build K = 30 → pass.
    const curve = computeVerticalCurve({
      g1: 2,
      g2: 5, // A = +3, sag
      length: 90, // K = 30
      pvcElevation: 100,
      pvcChainage: 1000,
    })
    const c = checkCurveCompliance(curve, 80)
    expect(curve.curveType).toBe('sag')
    expect(c.kRequired).toBe(16)
    expect(c.passes).toBe(true)
  })

  it('exposes SSD and available sight distance values', () => {
    const curve = computeVerticalCurve({
      g1: -3,
      g2: 3,
      length: 200, // A=6, K=33.3
      pvcElevation: 100,
      pvcChainage: 1000,
    })
    const c = checkCurveCompliance(curve, 80)
    expect(c.ssd).toBe(130) // matches AASHTO table for 80 km/h
    expect(c.availableSightDistance).toBeGreaterThan(0)
  })
})

describe('computeVerticalAlignment', () => {
  it('returns empty alignment for fewer than 2 VIPs', () => {
    const result = computeVerticalAlignment([], 80)
    expect(result.curves).toEqual([])
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('returns no curves when only 2 VIPs (no interior VIP)', () => {
    const vips: VIPInput[] = [
      { id: 'VIP0', chainage: 0, reducedLevel: 100 },
      { id: 'VIP1', chainage: 1000, reducedLevel: 110 },
    ]
    const result = computeVerticalAlignment(vips, 80)
    expect(result.curves).toEqual([])
    expect(result.startChainage).toBe(0)
    expect(result.endChainage).toBe(1000)
  })

  it('computes a single curve for 3 VIPs (one interior)', () => {
    const vips: VIPInput[] = [
      { id: 'A', chainage: 0, reducedLevel: 100 },
      { id: 'B', chainage: 500, reducedLevel: 110 }, // +2% grade in, +1% grade out → A = -1 → crest
      { id: 'C', chainage: 1000, reducedLevel: 115 },
    ]
    const result = computeVerticalAlignment(vips, 80)
    expect(result.curves).toHaveLength(1)
    const c = result.curves[0]
    expect(c.curveType).toBe('crest')
    expect(c.g1).toBeCloseTo(2.0, 4)
    expect(c.g2).toBeCloseTo(1.0, 4)
    expect(c.A).toBeCloseTo(-1.0, 4)
    expect(c.curve.pvcChainage).toBeLessThan(500)
    expect(c.curve.pvtChainage).toBeGreaterThan(500)
  })

  it('uses kOverride when supplied', () => {
    const vips: VIPInput[] = [
      { id: 'A', chainage: 0, reducedLevel: 100 },
      { id: 'B', chainage: 500, reducedLevel: 110, kOverride: 50 },
      { id: 'C', chainage: 1000, reducedLevel: 115 },
    ]
    const result = computeVerticalAlignment(vips, 80)
    const c = result.curves[0]
    // A = -1, kOverride = 50 → L = 50 × 1 = 50
    expect(c.length).toBeCloseTo(50, 1)
    expect(c.compliance.kActual).toBeCloseTo(50, 1)
  })

  it('uses lengthOverride when supplied (wins over kOverride)', () => {
    const vips: VIPInput[] = [
      { id: 'A', chainage: 0, reducedLevel: 100 },
      { id: 'B', chainage: 500, reducedLevel: 110, kOverride: 50, lengthOverride: 120 },
      { id: 'C', chainage: 1000, reducedLevel: 115 },
    ]
    const result = computeVerticalAlignment(vips, 80)
    expect(result.curves[0].length).toBeCloseTo(120, 1)
  })

  it('clips curves that would overlap the previous curve', () => {
    // Two interior VIPs very close together, both with large kOverride
    const vips: VIPInput[] = [
      { id: 'A', chainage: 0, reducedLevel: 100 },
      { id: 'B', chainage: 500, reducedLevel: 110, kOverride: 200 }, // L = 200
      { id: 'C', chainage: 520, reducedLevel: 100, kOverride: 200 }, // would overlap
      { id: 'D', chainage: 1020, reducedLevel: 90 },
    ]
    const result = computeVerticalAlignment(vips, 80)
    expect(result.curves.length).toBeGreaterThanOrEqual(1)
    // Second curve should be clipped or skipped
    const clipped = result.warnings.some(w => w.includes('clipped') || w.includes('overlaps'))
    expect(clipped).toBe(true)
  })

  it('warns about short tangents between successive curves', () => {
    // Two interior VIPs 40 m apart with small K so curves don't overlap.
    // Grades: A→B = +2%, B→C = -12.5%, C→D = -1%.
    // At B (ch=500): A = -14.5, K=3 → L = 43.5, PVT = 521.75
    // At C (ch=540): A = +11.5, K=3 → L = 34.5, PVC = 522.75
    // Tangent = 1 m → fires short-tangent warning (< 30 m).
    const vips: VIPInput[] = [
      { id: 'A', chainage: 0, reducedLevel: 100 },
      { id: 'B', chainage: 500, reducedLevel: 110, kOverride: 3 },
      { id: 'C', chainage: 540, reducedLevel: 105, kOverride: 3 },
      { id: 'D', chainage: 1040, reducedLevel: 100 },
    ]
    const result = computeVerticalAlignment(vips, 80)
    const tangentWarn = result.warnings.some(w => w.includes('Tangent between'))
    expect(tangentWarn).toBe(true)
  })

  it('reports allPass=false when any curve fails compliance', () => {
    const vips: VIPInput[] = [
      { id: 'A', chainage: 0, reducedLevel: 100 },
      { id: 'B', chainage: 500, reducedLevel: 110, kOverride: 5 }, // K=5, well below crest 26
      { id: 'C', chainage: 1000, reducedLevel: 115 },
    ]
    const result = computeVerticalAlignment(vips, 80)
    expect(result.allPass).toBe(false)
    expect(result.curves[0].compliance.severity).toBe('fail')
  })

  it('reports allPass=true when every curve passes', () => {
    const vips: VIPInput[] = [
      { id: 'A', chainage: 0, reducedLevel: 100 },
      { id: 'B', chainage: 500, reducedLevel: 110, kOverride: 80 },
      { id: 'C', chainage: 1000, reducedLevel: 115 },
    ]
    const result = computeVerticalAlignment(vips, 80)
    expect(result.allPass).toBe(true)
  })
})

describe('stationAtChainage / stationAlignment', () => {
  function buildAlignment() {
    const vips: VIPInput[] = [
      { id: 'A', chainage: 0, reducedLevel: 100 },
      { id: 'B', chainage: 500, reducedLevel: 110, kOverride: 50 },
      { id: 'C', chainage: 1000, reducedLevel: 115 },
    ]
    return computeVerticalAlignment(vips, 80)
  }

  it('returns null for chainage outside the alignment', () => {
    const a = buildAlignment()
    expect(stationAtChainage(a, -10)).toBeNull()
    expect(stationAtChainage(a, 2000)).toBeNull()
  })

  it('returns a tangent station before the curve', () => {
    const a = buildAlignment()
    const s = stationAtChainage(a, 100)
    expect(s).not.toBeNull()
    expect(s!.segment).toBe('tangent')
    expect(s!.elevation).toBeCloseTo(102, 1) // linear interp 0→100, 500→110: at ch=100, elev=102
  })

  it('returns a curve station inside the curve', () => {
    const a = buildAlignment()
    // Curve at VIP B (ch=500), L=50, A=-1 → PVC=475, PVT=525.
    // Curve is offset from VIP by |A|·L/800 = 0.0625 m (crest sits below VIP).
    // Curve elev at ch=500 = 110 - 0.0625 = 109.9375.
    const s = stationAtChainage(a, 500)
    expect(s).not.toBeNull()
    expect(s!.segment).toBe('curve')
    expect(s!.elevation).toBeCloseTo(109.9375, 2)
  })

  it('samples stations at the requested interval', () => {
    const a = buildAlignment()
    const stations = stationAlignment(a, 100)
    expect(stations.length).toBeGreaterThan(5)
    expect(stations[0].chainage).toBeCloseTo(0, 0)
    expect(stations[stations.length - 1].chainage).toBeCloseTo(1000, 0)
  })

  it('returns consistent grade continuity across PVC and PVT', () => {
    const a = buildAlignment()
    const beforePvc = stationAtChainage(a, 474)
    const atPvc = stationAtChainage(a, 475)
    const atPvt = stationAtChainage(a, 525)
    const afterPvt = stationAtChainage(a, 526)
    expect(beforePvc).not.toBeNull()
    expect(atPvc).not.toBeNull()
    expect(atPvt).not.toBeNull()
    expect(afterPvt).not.toBeNull()
    // Grade should be continuous at PVC (g1 entering = g1 in curve)
    expect(Math.abs(beforePvc!.grade - atPvc!.grade)).toBeLessThan(0.5)
    // Grade should be continuous at PVT
    expect(Math.abs(atPvt!.grade - afterPvt!.grade)).toBeLessThan(0.5)
  })
})

describe('CSV export', () => {
  it('alignmentToCSV produces a parseable CSV with header', () => {
    const vips: VIPInput[] = [
      { id: 'A', chainage: 0, reducedLevel: 100 },
      { id: 'B', chainage: 500, reducedLevel: 110, kOverride: 50 },
      { id: 'C', chainage: 1000, reducedLevel: 115 },
    ]
    const a = computeVerticalAlignment(vips, 80)
    const stations = stationAlignment(a, 100)
    const csv = alignmentToCSV(stations)
    const lines = csv.split('\n')
    expect(lines[0]).toContain('Chainage_m')
    expect(lines.length).toBe(stations.length + 1)
    // Each data row should have 7 fields
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].split(',').length).toBe(7)
    }
  })

  it('complianceToCSV includes one row per curve plus header', () => {
    const vips: VIPInput[] = [
      { id: 'A', chainage: 0, reducedLevel: 100 },
      { id: 'B', chainage: 500, reducedLevel: 110, kOverride: 50 },
      { id: 'C', chainage: 1000, reducedLevel: 115 },
    ]
    const a = computeVerticalAlignment(vips, 80)
    const csv = complianceToCSV(a)
    const lines = csv.split('\n')
    expect(lines[0]).toContain('VIP_Index,VIP_ID,Curve_Type')
    expect(lines.length).toBe(a.curves.length + 1)
  })
})

describe('DESIGN_SPEED_TABLE coverage', () => {
  it('covers speeds from 20 to 130 km/h', () => {
    const speeds = DESIGN_SPEED_TABLE.map(d => d.speed)
    expect(speeds).toContain(20)
    expect(speeds).toContain(130)
    expect(speeds.length).toBeGreaterThanOrEqual(11)
  })

  it('has monotonically increasing K values with speed', () => {
    for (let i = 1; i < DESIGN_SPEED_TABLE.length; i++) {
      expect(DESIGN_SPEED_TABLE[i].kCrestMin).toBeGreaterThanOrEqual(
        DESIGN_SPEED_TABLE[i - 1].kCrestMin
      )
      expect(DESIGN_SPEED_TABLE[i].kSagMin).toBeGreaterThanOrEqual(
        DESIGN_SPEED_TABLE[i - 1].kSagMin
      )
    }
  })
})
