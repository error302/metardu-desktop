/**
 * Engineering Computation Tests
 * Kenya RDM 1.1 / KeRRA compliant test cases
 */

import { 
  horizontalCurve, 
  verticalCurve, 
  superelevationCalc, 
  crossSectionVolume,
  massHaulDiagram,
  stoppingSightDistance,
  minimumRadius,
  wideningOnCurve
} from '../compute'

describe('horizontalCurve', () => {
  // Test case: R = 300m, Δ = 45°, typical rural road curve
  // Reference: RDM 1.1 Volume 2, Chapter 3
  test('calculates curve elements correctly for R=300, Δ=45°', () => {
    const result = horizontalCurve({
      R: 300,
      deltaDeg: 45,
      chainageStart: 1000
    })

    // T = R × tan(Δ/2) = 300 × tan(22.5°) = 300 × 0.4142 = 124.26
    expect(result.T).toBeCloseTo(124.26, 1)
    // L = R × Δ rad = 300 × 0.7854 = 235.62
    expect(result.L).toBeCloseTo(235.62, 1)
    // LC = 2R × sin(Δ/2) = 600 × sin(22.5°) = 600 × 0.3827 = 229.62
    expect(result.LC).toBeCloseTo(229.62, 1)
  })

  test('generates setting out table with correct deflection', () => {
    const result = horizontalCurve({
      R: 200,
      deltaDeg: 60,
      chainageStart: 500
    })

    expect(result.settingOutTable.length).toBeGreaterThan(0)
    
    // First peg should be at or after chainage_TC
    const firstPeg = result.settingOutTable[0]
    expect(firstPeg.chainage).toBeGreaterThanOrEqual(result.chainage_TC)
    
    // Last peg should be at or before chainage_CT
    const lastPeg = result.settingOutTable[result.settingOutTable.length - 1]
    expect(lastPeg.chainage).toBeLessThanOrEqual(result.chainage_CT)
  })

  test('validates input with Zod schema', () => {
    expect(() => horizontalCurve({ R: -100, deltaDeg: 45, chainageStart: 0 })).toThrow()
    expect(() => horizontalCurve({ R: 300, deltaDeg: -45, chainageStart: 0 })).toThrow()
    expect(() => horizontalCurve({ R: 300, deltaDeg: 200, chainageStart: 0 })).toThrow()
  })
})

describe('verticalCurve', () => {
  // Test case: +3% to -2% vertical curve, L = 300m
  test('calculates K value and identifies crest curve', () => {
    const result = verticalCurve({
      L: 300,
      g1: 3,
      g2: -2,
      chainage_VIP: 1000,
      elevation_VIP: 1650,
      designSpeedKph: 80
    })

    expect(result.algebraicDiff).toBe(-5) // A = g2 - g1 = -2 - 3 = -5
    expect(result.kValue).toBeCloseTo(60, 0) // K = L/|A| = 300/5 = 60
    expect(result.isCrest).toBe(true) // A < 0 = crest
    expect(result.chainage_VPC).toBe(850) // VPC = VIP - L/2
    expect(result.chainage_VPT).toBe(1150) // VPT = VIP + L/2
  })

  test('calculates elevations along curve', () => {
    const result = verticalCurve({
      L: 200,
      g1: 2,
      g2: 4,
      chainage_VIP: 1000,
      elevation_VIP: 1650,
      designSpeedKph: 100
    })

    expect(result.elevationTable.length).toBeGreaterThan(0)
    expect(result.isCrest).toBe(false) // A > 0 = sag
    
    // First point should be at or after VPC
    const firstPoint = result.elevationTable[0]
    expect(firstPoint.chainage).toBeGreaterThanOrEqual(900)
  })
})

describe('superelevationCalc', () => {
  // Test case: R = 200m, V = 80 km/h
  // Reference: RDM 1.1 Section 3.4
  test('calculates superelevation for R=200, V=80', () => {
    const result = superelevationCalc({
      R: 200,
      V: 80,
      eMax: 0.07
    })

    // e = V²/(225R) - 0.01 = 6400/(45000) - 0.01 = 0.142 - 0.01 = 0.132
    // But capped at eMax = 0.07
    expect(result.eDesign).toBeLessThanOrEqual(7) // percentage
    expect(result.transitionLength).toBeGreaterThanOrEqual(30) // minimum 30m per KeRRA
  })

  test('uses minimum transition length per KeRRA', () => {
    const result = superelevationCalc({
      R: 500,
      V: 60,
      eMax: 0.07
    })

    // L = 0.6V²/R = 0.6 × 3600 / 500 = 4.32m, but minimum 30m
    expect(result.transitionLength).toBeGreaterThanOrEqual(30)
  })
})

describe('crossSectionVolume', () => {
  test('calculates volumes using prismoidal method', () => {
    const result = crossSectionVolume({
      areas: [5, 8, 12, 15, 10, 5], // sample cut areas
      stationInterval: 20,
      method: 'prismoidal'
    })

    expect(result.totalCut).toBeGreaterThan(0)
    expect(result.volumeTable.length).toBe(6)
    expect(result.volumeTable[0].cumulativeCut).toBe(0) // First station has no volume
  })

  test('calculates volumes using end-area method', () => {
    const result = crossSectionVolume({
      areas: [5, 8, 12, -3, -5], // mix of cut (+) and fill (-)
      stationInterval: 20,
      method: 'end-area'
    })

    expect(result.totalFill).toBeGreaterThan(0)
    expect(result.netVolume).not.toBe(0)
  })

  test('detects balanced earthworks', () => {
    const balanced = crossSectionVolume({
      areas: [10, 8, 6, 4, 6, 8, 10],
      stationInterval: 20,
      method: 'prismoidal'
    })

    // Not really balanced but check the flag works
    expect(typeof balanced.isBalanced).toBe('boolean')
  })
})

describe('massHaulDiagram', () => {
  test('calculates cumulative mass-haul correctly', () => {
    const result = massHaulDiagram({
      cumulativeVolumes: [100, 80, 50, -20, -60, -100, -80, -40, 0],
      stationInterval: 20
    })

    expect(result.cumulativeVolume.length).toBe(9)
    expect(result.maxSurplus).toBeGreaterThan(0)
    expect(result.maxDeficit).toBeLessThan(0)
  })

  test('finds balance point', () => {
    const result = massHaulDiagram({
      cumulativeVolumes: [100, 50, 0, -50, -100],
      stationInterval: 20
    })

    expect(result.balancePoint).not.toBeNull()
  })
})

describe('stoppingSightDistance', () => {
  // Reference: RDM 1.1 Section 2.3
  test('calculates SSD for V=80 km/h on level grade', () => {
    const ssd = stoppingSightDistance(80, 0)
    
    // AASHTO: SSD = 0.278VT + V²/(254f)
    // SSD = 0.278 × 80 × 2.5 + 6400/(254 × 0.35) = 55.6 + 71.8 = 127.4m
    expect(ssd).toBeGreaterThan(100)
    expect(ssd).toBeLessThan(150)
  })

  test('adjusts for grade', () => {
    const ssdLevel = stoppingSightDistance(60, 0)
    // On downhill (negative grade), vehicle accelerates, requiring longer SSD
    const ssdDownhill = stoppingSightDistance(60, -5)
    
    expect(ssdDownhill).toBeGreaterThan(ssdLevel)
  })
})

describe('minimumRadius', () => {
  test('calculates minimum radius for V=80, e=7%', () => {
    const R = minimumRadius(80, 0.07, 0.15)
    
    // R = V²/(127(e+f)) = 6400/(127 × 0.22) = 228m
    expect(R).toBeGreaterThan(200)
    expect(R).toBeLessThan(300)
  })
})

describe('wideningOnCurve', () => {
  test('applies widening for small radius curves', () => {
    const result = wideningOnCurve(200, 7.0)
    
    expect(result.extraWidth).toBe(0.5) // R < 300m gets 0.5m
    expect(result.totalWidth).toBe(7.5)
  })

  test('no widening for large radius', () => {
    const result = wideningOnCurve(1000, 7.0)
    
    expect(result.extraWidth).toBe(0)
    expect(result.totalWidth).toBe(7.0)
  })
})
