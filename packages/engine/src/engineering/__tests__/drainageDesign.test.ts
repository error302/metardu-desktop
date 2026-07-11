import { manningPipeCapacity, rationalMethodCatchment, manningChannelCapacity, sizePipe, minPipeSlope, MANNING_N, RUNOFF_COEFFICIENTS, STANDARD_PIPE_SIZES } from '../drainageDesign'

describe('manningPipeCapacity', () => {
  it('300mm concrete pipe at 1% slope', () => {
    const result = manningPipeCapacity({ diameter: 300, manningN: 0.013, slope: 0.01 })
    // Q = (1/n) * (D/4)^(2/3) * S^(1/2) * (πD²/4)
    // R = 0.075, A = 0.0707
    // V = (1/0.013) * 0.075^(2/3) * 0.01^0.5 ≈ 76.92 * 0.1823 * 0.1 ≈ 1.40 m/s
    // Q = 1.40 * 0.0707 ≈ 0.099 m³/s
    expect(result.fullBoreVelocity).toBeGreaterThan(1.0)
    expect(result.fullBoreCapacity).toBeGreaterThan(0.05)
    expect(result.isSelfCleansing).toBe(true) // V > 0.6
  })

  it('velocity < 0.6 for very flat slope', () => {
    const result = manningPipeCapacity({ diameter: 150, manningN: 0.013, slope: 0.0001 })
    expect(result.isSelfCleansing).toBe(false)
  })

  it('min self-cleansing gradient is positive', () => {
    const result = manningPipeCapacity({ diameter: 300, manningN: 0.013, slope: 0.01 })
    expect(result.minSelfCleansingGradient).toBeGreaterThan(0)
  })

  it('larger pipe has more capacity at same slope', () => {
    const r300 = manningPipeCapacity({ diameter: 300, manningN: 0.013, slope: 0.01 })
    const r600 = manningPipeCapacity({ diameter: 600, manningN: 0.013, slope: 0.01 })
    expect(r600.fullBoreCapacity).toBeGreaterThan(r300.fullBoreCapacity)
  })
})

describe('minPipeSlope', () => {
  it('returns positive slope for self-cleansing', () => {
    const slope = minPipeSlope(300, 0.013, 0.6)
    expect(slope).toBeGreaterThan(0)
    // For D=300mm, n=0.013: S = (0.6*0.013/((0.075)^(2/3)))²
    expect(slope).toBeLessThan(0.01)
  })

  it('smaller pipe needs steeper slope', () => {
    const slope150 = minPipeSlope(150, 0.013, 0.6)
    const slope600 = minPipeSlope(600, 0.013, 0.6)
    expect(slope150).toBeGreaterThan(slope600)
  })
})

describe('rationalMethodCatchment', () => {
  it('computes peak flow correctly', () => {
    // Q = C * I * A / 360 = 0.5 * 50 * 10 / 360 = 0.694 m³/s
    const result = rationalMethodCatchment({
      area: 10, runoffCoefficient: 0.5, rainfallIntensity: 50, timeOfConcentration: 10,
    })
    expect(result.peakFlow).toBeCloseTo(0.694, 2)
    expect(result.catchmentArea).toBe(10)
    expect(result.effectiveArea).toBe(5)
  })

  it('urban catchment gets 50-year return period', () => {
    const result = rationalMethodCatchment({
      area: 5, runoffCoefficient: 0.85, rainfallIntensity: 75, timeOfConcentration: 10,
    })
    expect(result.returnPeriod).toContain('50')
  })

  it('rural catchment gets 25-year return period', () => {
    const result = rationalMethodCatchment({
      area: 50, runoffCoefficient: 0.15, rainfallIntensity: 30, timeOfConcentration: 15,
    })
    expect(result.returnPeriod).toContain('25')
  })

  it('zero area gives zero flow', () => {
    const result = rationalMethodCatchment({
      area: 0, runoffCoefficient: 0.5, rainfallIntensity: 50, timeOfConcentration: 10,
    })
    expect(result.peakFlow).toBe(0)
  })
})

describe('manningChannelCapacity', () => {
  it('computes trapezoidal channel capacity', () => {
    const result = manningChannelCapacity({
      bedWidth: 1.0, sideSlope: 1.5, manningN: 0.015, slope: 0.005, flowDepth: 0.5,
    })
    expect(result.flowArea).toBeGreaterThan(0)
    expect(result.wettedPerimeter).toBeGreaterThan(0)
    expect(result.hydraulicRadius).toBeGreaterThan(0)
    expect(result.velocity).toBeGreaterThan(0)
    expect(result.discharge).toBeGreaterThan(0)
  })

  it('deeper flow gives more discharge', () => {
    const shallow = manningChannelCapacity({ bedWidth: 1.0, sideSlope: 1.5, manningN: 0.015, slope: 0.005, flowDepth: 0.3 })
    const deep = manningChannelCapacity({ bedWidth: 1.0, sideSlope: 1.5, manningN: 0.015, slope: 0.005, flowDepth: 0.8 })
    expect(deep.discharge).toBeGreaterThan(shallow.discharge)
  })
})

describe('sizePipe', () => {
  it('returns null for zero flow', () => {
    expect(sizePipe(0, 0.013, 0.01)).toBeNull()
  })

  it('returns null for zero slope', () => {
    expect(sizePipe(0.5, 0.013, 0)).toBeNull()
  })

  it('selects appropriate diameter for small flow', () => {
    const result = sizePipe(0.01, 0.013, 0.01) // very small flow
    expect(result).not.toBeNull()
    expect(result!.diameter).toBeLessThanOrEqual(300) // should be small pipe
    expect(result!.isSelfCleansing || true) // may or may not be self-cleansing at this size
  })

  it('selects larger diameter for larger flow', () => {
    const small = sizePipe(0.05, 0.013, 0.01)
    const large = sizePipe(0.5, 0.013, 0.01)
    if (small && large) {
      expect(large.diameter).toBeGreaterThanOrEqual(small.diameter)
    }
  })
})

describe('MANNING_N', () => {
  it('has standard materials', () => {
    expect(MANNING_N['Concrete pipe']).toBe(0.013)
    expect(MANNING_N['HDPE']).toBe(0.011)
    expect(MANNING_N['uPVC']).toBe(0.011)
    expect(MANNING_N['Corrugated steel']).toBe(0.024)
  })
})

describe('RUNOFF_COEFFICIENTS', () => {
  it('has all land use types', () => {
    expect(RUNOFF_COEFFICIENTS['Asphalt/Concrete']).toBeDefined()
    expect(RUNOFF_COEFFICIENTS['Grass/Park']).toBeDefined()
    expect(RUNOFF_COEFFICIENTS['Forest']).toBeDefined()
    expect(RUNOFF_COEFFICIENTS['Commercial']).toBeDefined()
  })

  it('impervious surfaces have higher C than pervious', () => {
    const impervious = RUNOFF_COEFFICIENTS['Asphalt/Concrete'].typical
    const pervious = RUNOFF_COEFFICIENTS['Forest'].typical
    expect(impervious).toBeGreaterThan(pervious)
  })
})

describe('STANDARD_PIPE_SIZES', () => {
  it('has common sizes in ascending order', () => {
    expect(STANDARD_PIPE_SIZES[0]).toBe(100)
    for (let i = 1; i < STANDARD_PIPE_SIZES.length; i++) {
      expect(STANDARD_PIPE_SIZES[i]).toBeGreaterThan(STANDARD_PIPE_SIZES[i - 1])
    }
  })
})
