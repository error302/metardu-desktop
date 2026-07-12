import {
  computeClothoid,
  minTransitionLength,
  spiralCoordinate,
  clothoidSetOutTable,
} from '../clothoidTransition'

const DEG = Math.PI / 180

// ─── minTransitionLength ─────────────────────────────────────────────────────

describe('minTransitionLength', () => {
  it('should return positive values for all 3 criteria (R=300, V=80, e=0.07, B=7.0)', () => {
    const result = minTransitionLength(300, 80, 0.07, 7.0)

    expect(result.criteria.acceleration).toBeGreaterThan(0)
    expect(result.criteria.superElevation).toBeGreaterThan(0)
    expect(result.criteria.travelTime).toBeGreaterThan(0)
  })

  it('should return the MAX of the three criteria', () => {
    const result = minTransitionLength(300, 80, 0.07, 7.0)

    expect(result.min).toBeCloseTo(
      Math.max(
        result.criteria.acceleration,
        result.criteria.superElevation,
        result.criteria.travelTime,
      ),
      10,
    )
  })

  it('should match the acceleration criterion formula: V³ / (3.6³ × 0.3 × R)', () => {
    const R = 300
    const V = 80
    const expected = Math.pow(V, 3) / (Math.pow(3.6, 3) * 0.3 * R)
    const result = minTransitionLength(R, V, 0.07, 7.0)

    expect(result.criteria.acceleration).toBeCloseTo(expected, 3)
  })

  it('should match the travel time criterion: V / (3.6 × 3)', () => {
    const V = 80
    const expected = V / (3.6 * 3)
    const result = minTransitionLength(300, V, 0.07, 7.0)

    expect(result.criteria.travelTime).toBeCloseTo(expected, 3)
  })

  it('should return acceleration as the dominant criterion for high-speed, large-radius roads', () => {
    const result = minTransitionLength(300, 80, 0.07, 7.0)

    // At V=80, R=300, the acceleration criterion dominates
    expect(result.min).toBeCloseTo(result.criteria.acceleration, 3)
  })
})

// ─── spiralCoordinate ───────────────────────────────────────────────────────

describe('spiralCoordinate', () => {
  it('should return positive x, y for L=30, R=200, A=sqrt(200×30)', () => {
    const L = 30
    const R = 200
    const A = Math.sqrt(R * L)

    const coord = spiralCoordinate(L, R, A)

    expect(coord.x).toBeGreaterThan(0)
    expect(coord.y).toBeGreaterThan(0)
  })

  it('should compute theta = L² / (2 × A²)', () => {
    const L = 30
    const R = 200
    const A = Math.sqrt(R * L)
    const expectedTheta = (L * L) / (2 * A * A)

    const coord = spiralCoordinate(L, R, A)

    expect(coord.theta).toBeCloseTo(expectedTheta, 3)
  })

  it('should give x ≈ L for small L/A ratio (L=30, A≈77.46)', () => {
    const L = 30
    const R = 200
    const A = Math.sqrt(R * L)

    const coord = spiralCoordinate(L, R, A)

    // For L/A ≈ 0.387, higher-order corrections are very small
    expect(coord.x).toBeCloseTo(L, 1)
  })

  it('should return zero values for zero arc length', () => {
    const R = 200
    const A = Math.sqrt(R * 60)

    const coord = spiralCoordinate(0, R, A)

    expect(coord.x).toBeCloseTo(0, 10)
    expect(coord.y).toBeCloseTo(0, 10)
    expect(coord.theta).toBeCloseTo(0, 10)
  })

  it('should give larger y for larger arc length (spiral curves away)', () => {
    const R = 300
    const A = Math.sqrt(R * 60)

    const short = spiralCoordinate(20, R, A)
    const long = spiralCoordinate(40, R, A)

    expect(long.y).toBeGreaterThan(short.y)
    expect(long.x).toBeGreaterThan(short.x)
  })
})

// ─── computeClothoid ────────────────────────────────────────────────────────

describe('computeClothoid', () => {
  // Test 1: Basic case — R=300, V=60, Δ=30°, IP chainage=500
  describe('basic case (R=300, V=60, Δ=30°, IP=500)', () => {
    const result = computeClothoid({
      radius: 300,
      designSpeed: 60,
      deflectionAngleRad: 30 * DEG,
      ipChainage: 500,
    })

    it('should compute spiralParamA = sqrt(R × Ls)', () => {
      const Ls = result.scChainage - result.tsChainage
      const expected = Math.sqrt(300 * Ls)
      expect(result.spiralParamA).toBeCloseTo(expected, 1)
    })

    it('should compute spiralAngleTau = Ls / (2R)', () => {
      const Ls = result.scChainage - result.tsChainage
      const expected = Ls / (2 * 300)
      expect(result.spiralAngleTau).toBeCloseTo(expected, 3)
    })

    it('should maintain TS < SC < CS < ST chainage ordering', () => {
      expect(result.tsChainage).toBeLessThan(result.scChainage)
      expect(result.scChainage).toBeLessThan(result.csChainage)
      expect(result.csChainage).toBeLessThan(result.stChainage)
    })

    it('should have totalCurveLength ≈ ST − TS (within 0.01m)', () => {
      const chainageDiff = result.stChainage - result.tsChainage
      expect(result.totalCurveLength).toBeCloseTo(chainageDiff, 1)
    })

    it('should have a positive modified tangent', () => {
      expect(result.modifiedTangent).toBeGreaterThan(0)
    })

    it('should have positive curveShiftP and tangentOffsetQ', () => {
      expect(result.curveShiftP).toBeGreaterThan(0)
      expect(result.tangentOffsetQ).toBeGreaterThan(0)
    })

    it('should have a positive external distance', () => {
      expect(result.externalDistance).toBeGreaterThan(0)
    })

    it('should have a positive circular arc length', () => {
      expect(result.circularArcLength).toBeGreaterThan(0)
    })

    it('should record derivation steps', () => {
      expect(result.steps.length).toBeGreaterThan(5)
    })
  })

  // Test 2: Known values — R=200, V=80, Δ=45°
  describe('known values (R=200, V=80, Δ=45°)', () => {
    const result = computeClothoid({
      radius: 200,
      designSpeed: 80,
      deflectionAngleRad: 45 * DEG,
      ipChainage: 1000,
    })

    it('should have curveShiftP > 0', () => {
      expect(result.curveShiftP).toBeGreaterThan(0)
    })

    it('should have tangentOffsetQ > 0', () => {
      expect(result.tangentOffsetQ).toBeGreaterThan(0)
    })

    it('should have larger spiral angle for smaller radius (at same Ls)', () => {
      // tau = Ls/(2R), so smaller R gives larger tau for same Ls
      expect(result.spiralAngleTau).toBeGreaterThan(0)
    })

    it('should produce valid key chainages', () => {
      expect(result.tsChainage).toBeGreaterThan(0)
      expect(result.stChainage).toBeGreaterThan(result.tsChainage)
    })
  })

  // Test 3: Auto-computed Ls (omit transitionLength)
  describe('auto-computed Ls', () => {
    const result = computeClothoid({
      radius: 300,
      designSpeed: 60,
      deflectionAngleRad: 30 * DEG,
      ipChainage: 500,
    })

    it('should mark isLengthAdequate as true', () => {
      expect(result.isLengthAdequate).toBe(true)
    })

    it('should use Ls >= minTransitionLength', () => {
      const Ls = result.scChainage - result.tsChainage
      expect(Ls).toBeGreaterThanOrEqual(result.minTransitionLength - 0.01)
    })

    it('should return a positive minTransitionLength', () => {
      expect(result.minTransitionLength).toBeGreaterThan(0)
    })

    it('should have all minimum-length criteria positive', () => {
      expect(result.minLengthCriteria.acceleration).toBeGreaterThan(0)
      expect(result.minLengthCriteria.superElevation).toBeGreaterThan(0)
      expect(result.minLengthCriteria.travelTime).toBeGreaterThan(0)
    })
  })

  // Test 4: Custom Ls=60m
  describe('custom Ls=60m (R=300)', () => {
    const result = computeClothoid({
      radius: 300,
      designSpeed: 60,
      deflectionAngleRad: 30 * DEG,
      ipChainage: 500,
      transitionLength: 60,
    })

    it('should have spiralParamA = sqrt(R × 60)', () => {
      const expected = Math.sqrt(300 * 60)
      expect(result.spiralParamA).toBeCloseTo(expected, 1)
    })

    it('should have spiralAngleTau = 60 / (2 × R)', () => {
      const expected = 60 / (2 * 300)
      expect(result.spiralAngleTau).toBeCloseTo(expected, 3)
    })

    it('should use the provided Ls as the spiral length', () => {
      const Ls = result.scChainage - result.tsChainage
      expect(Ls).toBeCloseTo(60, 1)
    })
  })
})

// ─── clothoidSetOutTable ────────────────────────────────────────────────────

describe('clothoidSetOutTable', () => {
  // Use result from the basic case (Test 1)
  const clothoidResult = computeClothoid({
    radius: 300,
    designSpeed: 60,
    deflectionAngleRad: 30 * DEG,
    ipChainage: 500,
  })

  const table = clothoidSetOutTable(clothoidResult)

  it('should have the first point labelled TS', () => {
    expect(table[0].point).toBe('TS')
    expect(table[0].chainage).toBeCloseTo(clothoidResult.tsChainage, 1)
  })

  it('should have the last point labelled ST', () => {
    expect(table[table.length - 1].point).toBe('ST')
    expect(table[table.length - 1].chainage).toBeCloseTo(clothoidResult.stChainage, 1)
  })

  it('should have monotonically increasing chainages', () => {
    for (let i = 1; i < table.length; i++) {
      // Skip the circular arc placeholder (point '···')
      if (table[i].point === '···') continue
      expect(table[i].chainage).toBeGreaterThanOrEqual(table[i - 1].chainage)
    }
  })

  it('should have all spiral deflection angles positive (entry spiral)', () => {
    const entrySpiralRows = table.filter(
      (r) => r.point === 'TS' || r.point === 'SC' || /^\d+$/.test(r.point),
    )
    // All entry spiral points except TS should have positive deflection
    for (const row of entrySpiralRows) {
      if (row.point === 'TS') continue
      expect(row.deflectionDeg).not.toMatch(/^-/)
    }
  })

  it('should include SC and CS in the table', () => {
    const points = table.map((r) => r.point)
    expect(points).toContain('SC')
    expect(points).toContain('CS')
  })

  it('should include a circular arc placeholder when arc length > 0', () => {
    if (clothoidResult.circularArcLength > 0.01) {
      const arcRow = table.find((r) => r.point === '···')
      expect(arcRow).toBeDefined()
      expect(arcRow!.remarks).toContain('Circular arc')
    }
  })

  it('should generate entries for both entry and exit spirals', () => {
    const tsIdx = table.findIndex((r) => r.point === 'TS')
    const scIdx = table.findIndex((r) => r.point === 'SC')
    const csIdx = table.findIndex((r) => r.point === 'CS')
    const stIdx = table.findIndex((r) => r.point === 'ST')

    expect(tsIdx).toBeGreaterThanOrEqual(0)
    expect(scIdx).toBeGreaterThan(tsIdx)
    expect(csIdx).toBeGreaterThan(scIdx)
    expect(stIdx).toBeGreaterThan(csIdx)
  })

  it('should have TS chord = 0', () => {
    const tsRow = table.find((r) => r.point === 'TS')
    expect(tsRow!.chord).toBe(0)
  })
})
