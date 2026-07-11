import { computeESA, classifyTraffic, classifySubgrade, designPavement, computeLayerQuantities } from '../pavementDesign'

describe('computeESA', () => {
  it('computes ESA for known values with zero growth', () => {
    const result = computeESA({
      aadt: 10000, heavyVehiclePercentage: 20, growthRate: 0,
      designPeriod: 20, directionalSplit: 0.5, laneFactor: 1.0,
      numberOfLanes: 2, vehicleDamageFactor: 1.0,
    })
    // 10000 * 0.20 * 0.5 * 1.0 * 1.0 * 365 * 20 = 7,300,000
    expect(result.esa).toBeCloseTo(7300000, -4)
    expect(result.esaMillions).toBeCloseTo(7.3, 1)
  })

  it('ESA increases with growth rate', () => {
    const noGrowth = computeESA({
      aadt: 5000, heavyVehiclePercentage: 15, growthRate: 0,
      designPeriod: 20, directionalSplit: 0.5, laneFactor: 1.0, numberOfLanes: 2,
    })
    const withGrowth = computeESA({
      aadt: 5000, heavyVehiclePercentage: 15, growthRate: 5,
      designPeriod: 20, directionalSplit: 0.5, laneFactor: 1.0, numberOfLanes: 2,
    })
    expect(withGrowth.esa).toBeGreaterThan(noGrowth.esa)
  })
})

describe('classifyTraffic', () => {
  it('classifies correctly at boundaries', () => {
    expect(classifyTraffic(50)).toBe('T1')   // > 30
    expect(classifyTraffic(15)).toBe('T2')   // > 10
    expect(classifyTraffic(5)).toBe('T3')    // > 3
    expect(classifyTraffic(2)).toBe('T4')    // > 1
    expect(classifyTraffic(0.5)).toBe('T5')  // > 0.3
    expect(classifyTraffic(0.1)).toBe('T6')  // < 0.3
  })
})

describe('classifySubgrade', () => {
  it('classifies correctly at boundaries', () => {
    expect(classifySubgrade(20)).toBe('SG1')  // > 15
    expect(classifySubgrade(10)).toBe('SG2')  // > 7
    expect(classifySubgrade(5)).toBe('SG3')   // > 3
    expect(classifySubgrade(2)).toBe('SG4')   // < 3
  })
})

describe('designPavement', () => {
  it('T1-SG4 returns thick structure', () => {
    const result = designPavement({
      aadt: 50000, heavyVehiclePercentage: 30, growthRate: 5,
      designPeriod: 20, directionalSplit: 0.5, laneFactor: 0.85,
      numberOfLanes: 4, vehicleDamageFactor: 2.0,
    }, { cbr: 2 })
    expect(result.trafficClass).toBe('T1')
    expect(result.subgradeClass).toBe('SG4')
    expect(result.layers.length).toBeGreaterThanOrEqual(4)
    expect(result.totalThickness).toBeGreaterThan(600)
  })

  it('T6-SG1 returns thin structure', () => {
    const result = designPavement({
      aadt: 200, heavyVehiclePercentage: 10, growthRate: 2,
      designPeriod: 10, directionalSplit: 0.5, laneFactor: 1.0,
      numberOfLanes: 2, vehicleDamageFactor: 0.5,
    }, { cbr: 25 })
    expect(result.trafficClass).toBe('T6')
    expect(result.subgradeClass).toBe('SG1')
    expect(result.layers.length).toBe(1)
    expect(result.totalThickness).toBe(150)
  })

  it('all layer thicknesses are positive', () => {
    const results = [
      designPavement({ aadt: 50000, heavyVehiclePercentage: 30, growthRate: 5, designPeriod: 20, directionalSplit: 0.5, laneFactor: 0.85, numberOfLanes: 4, vehicleDamageFactor: 2.0 }, { cbr: 5 }),
      designPavement({ aadt: 5000, heavyVehiclePercentage: 15, growthRate: 4, designPeriod: 20, directionalSplit: 0.5, laneFactor: 0.85, numberOfLanes: 2, vehicleDamageFactor: 1.5 }, { cbr: 8 }),
      designPavement({ aadt: 500, heavyVehiclePercentage: 10, growthRate: 3, designPeriod: 15, directionalSplit: 0.5, laneFactor: 1.0, numberOfLanes: 2, vehicleDamageFactor: 1.0 }, { cbr: 12 }),
    ]
    for (const r of results) {
      for (const layer of r.layers) {
        expect(layer.thicknessMm).toBeGreaterThan(0)
      }
      expect(r.totalThickness).toBe(r.layers.reduce((s, l) => s + l.thicknessMm, 0))
    }
  })

  it('returns correct traffic class for mid-range traffic', () => {
    const result = designPavement({
      aadt: 3000, heavyVehiclePercentage: 20, growthRate: 4,
      designPeriod: 20, directionalSplit: 0.5, laneFactor: 0.85,
      numberOfLanes: 2, vehicleDamageFactor: 1.5,
    }, { cbr: 10 })
    // 3000 * 0.20 * 0.5 * 0.85 * 1.5 * 365 * 20 * growth factor ≈ several million
    expect(['T2', 'T3', 'T4']).toContain(result.trafficClass)
  })
})

describe('computeLayerQuantities', () => {
  it('computes correct volumes', () => {
    const layers = [
      { name: 'AC', material: 'Asphalt Concrete (AC14)', thicknessMm: 50, description: '', color: '' },
      { name: 'Base', material: 'Crushed Stone (G40)', thicknessMm: 150, description: '', color: '' },
    ]
    const quantities = computeLayerQuantities(layers, 1000, 7.0)
    expect(quantities).toHaveLength(2)
    // AC: 1000 * 7.0 * 0.050 = 350 m³
    expect(quantities[0].volumeM3).toBe(350)
    // Base: 1000 * 7.0 * 0.150 = 1050 m³
    expect(quantities[1].volumeM3).toBe(1050)
  })

  it('computes positive tonnage', () => {
    const layers = [{ name: 'AC', material: 'Asphalt Concrete (AC14)', thicknessMm: 40, description: '', color: '' }]
    const q = computeLayerQuantities(layers, 500, 6.5)
    expect(q[0].tonnage).toBeGreaterThan(0)
    expect(q[0].density).toBe(2400)
  })
})
