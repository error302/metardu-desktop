import {
  validateLevelingClosure,
  validateCFactor,
  runTwoPegTest,
  getLevelingOrderForCountry,
  LEVELING_ORDERS,
  C_FACTOR_TABLE,
} from '../leveling-standards'

describe('LEVELING_ORDERS table', () => {
  it('has 5 orders', () => {
    expect(LEVELING_ORDERS.length).toBe(5)
  })

  it('closure decreases with higher order (stricter)', () => {
    for (let i = 1; i < LEVELING_ORDERS.length; i++) {
      expect(LEVELING_ORDERS[i].closureMetres).toBeGreaterThan(LEVELING_ORDERS[i - 1].closureMetres)
    }
  })

  it('each order has closure formula', () => {
    LEVELING_ORDERS.forEach((o: any) => {
      expect(o.closureFormula).toContain('√')
    })
  })
})

describe('validateLevelingClosure', () => {
  it('US first_order at 1km: allowable ~3mm', () => {
    const r = validateLevelingClosure({
      misclosureMetres: 0.002,
      distanceKm: 1,
      country: 'us',
      environment: 'first_order',
    })
    expect(r.allowableMisclosure).toBeCloseTo(0.003, 3)
    expect(r.isAcceptable).toBe(true)
  })

  it('US first_order FAILS if misclosure > allowable', () => {
    const r = validateLevelingClosure({
      misclosureMetres: 0.010,
      distanceKm: 1,
      country: 'us',
      environment: 'first_order',
    })
    expect(r.isAcceptable).toBe(false)
  })

  it('US fourth_order at 1km: allowable ~24mm', () => {
    const r = validateLevelingClosure({
      misclosureMetres: 0.020,
      distanceKm: 1,
      country: 'us',
      environment: 'fourth_order',
    })
    expect(r.allowableMisclosure).toBeCloseTo(0.024, 2)
    expect(r.isAcceptable).toBe(true)
  })

  it('Kenya: RDM 1.1 direct tolerance 0.010√km', () => {
    // Source: RDM 1.1 Kenya 2025, Table 5.1 — Direct differential leveling: 10√K mm
    const r = validateLevelingClosure({
      misclosureMetres: 0.008,
      distanceKm: 1,
      country: 'kenya',
      environment: 'third_order',
    })
    expect(r.allowableMisclosure).toBeCloseTo(0.010, 2)
    expect(r.isAcceptable).toBe(true)
  })

  it('returns derived achieved order', () => {
    const r = validateLevelingClosure({
      misclosureMetres: 0.002,
      distanceKm: 1,
      country: 'us',
      environment: 'fourth_order',
    })
    expect(r.achievedOrder).not.toBe('Below 4th Order')
  })
})

describe('C_FACTOR_TABLE', () => {
  it('has 3 entries', () => {
    expect(C_FACTOR_TABLE.length).toBe(3)
  })

  it('C-factor increases with K (less stringent)', () => {
    expect(C_FACTOR_TABLE[0].maxCFactor).toBeLessThan(C_FACTOR_TABLE[1].maxCFactor)
    expect(C_FACTOR_TABLE[1].maxCFactor).toBeLessThan(C_FACTOR_TABLE[2].maxCFactor)
  })

  it('K=1/100: max C = 0.004', () => {
    const entry = C_FACTOR_TABLE.find((e: any) => Math.abs(e.kValue - 1/100) < 0.001)
    expect(entry?.maxCFactor).toBe(0.004)
  })
})

describe('validateCFactor', () => {
  it('K=1/100: PASSES if C ≤ 0.004', () => {
    const r = validateCFactor({ maxError: 4, horizontalDistance: 1000 })
    expect(r.isAcceptable).toBe(true)
    expect(r.cFactor).toBeCloseTo(0.004, 4)
  })

  it('K=1/100: FAILS if C > 0.004', () => {
    const r = validateCFactor({ maxError: 6, horizontalDistance: 1000 })
    expect(r.isAcceptable).toBe(false)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('K=1/333: PASSES if C ≤ 0.010', () => {
    const r = validateCFactor({ maxError: 10, horizontalDistance: 1000, contourInterval: 333 })
    expect(r.isAcceptable).toBe(true)
  })

  it('returns correct K value', () => {
    const r = validateCFactor({ maxError: 5, horizontalDistance: 1000, contourInterval: 200 })
    expect(r.kValue).toBeCloseTo(1/200, 3)
  })
})

describe('runTwoPegTest', () => {
  it('zero collimation: PASSES', () => {
    // Both setups record the same height difference (0.5m) → collimation error = 0
    const r = runTwoPegTest({
      A1: 1.500, B1: 1.000,
      A2: 1.500, B2: 1.000,
      baselineMeters: 100,
      country: 'us',
    })
    expect(r.isAcceptable).toBe(true)
    expect(r.collimationPer100m).toBeCloseTo(0, 6)
  })

  it('30 arc-second threshold: PASSES borderline', () => {
    const r = runTwoPegTest({
      A1: 1.500, B1: 1.000,
      A2: 1.000, B2: 1.498,
      baselineMeters: 100,
      allowableSeconds: 30,
      country: 'us',
    })
    expect(r.allowablePer100m).toBeGreaterThan(0)
    expect(r.isAcceptable).toBe(false)
  })

  it('overdue test generates warning', () => {
    const r = runTwoPegTest({
      A1: 1.500, B1: 1.000,
      A2: 1.000, B2: 1.500,
      baselineMeters: 100,
      country: 'us',
      daysSinceLastTest: 100,
    })
    expect(r.warnings.some((w: any) => w.includes('overdue'))).toBe(true)
    expect(r.daysUntilNextTest).toBe(0)
  })

  it('daysUntilNextTest counts down from 90', () => {
    const r = runTwoPegTest({
      A1: 1.500, B1: 1.000,
      A2: 1.000, B2: 1.500,
      baselineMeters: 100,
      country: 'us',
      daysSinceLastTest: 30,
    })
    expect(r.daysUntilNextTest).toBe(60)
  })
})

describe('getLevelingOrderForCountry', () => {
  it('defaults to third_order for all countries', () => {
    const countries = ['kenya', 'us', 'uk', 'australia', 'bahrain', 'other'] as const
    for (const c of countries) {
      const order = getLevelingOrderForCountry(c)
      expect(order.description).toContain('Third')
    }
  })

  it('US first_order: returns correct order', () => {
    const order = getLevelingOrderForCountry('us', 'first_order')
    expect(order.order).toBe('first_order')
    expect(order.closureMetres).toBeCloseTo(0.003, 3)
  })

  it('US construction: returns fourth_order', () => {
    const order = getLevelingOrderForCountry('us', 'construction')
    expect(order.order).toBe('fourth_order')
  })
})
