import {
  getRoadReserveWidth,
  checkRoadReserveCompliance,
  computeCorridorBoundary,
  estimateAcquisitionArea,
  determineAcquisitionType,
  ROAD_RESERVE_STANDARDS,
} from '../roadReserve'

// ─── ROAD_RESERVE_STANDARDS ─────────────────────────────────────────────────

describe('ROAD_RESERVE_STANDARDS', () => {
  const classes = ['A', 'B', 'C', 'D', 'E', 'F', 'G']

  it('should define all 7 road classes (A through G)', () => {
    for (const cls of classes) {
      expect(ROAD_RESERVE_STANDARDS[cls]).toBeDefined()
    }
  })

  it('should have each class with all required properties', () => {
    for (const cls of classes) {
      const std = ROAD_RESERVE_STANDARDS[cls]
      expect(std).toHaveProperty('class')
      expect(std).toHaveProperty('description')
      expect(std).toHaveProperty('reserveWidthMin')
      expect(std).toHaveProperty('reserveWidthStd')
      expect(std).toHaveProperty('carriagewayStd')
      expect(std).toHaveProperty('shoulderStd')
    }
  })

  it('should have decreasing widths from Class A to Class G', () => {
    const aMin = ROAD_RESERVE_STANDARDS.A.reserveWidthMin
    const gMin = ROAD_RESERVE_STANDARDS.G.reserveWidthMin
    expect(aMin).toBeGreaterThan(gMin)

    const aStd = ROAD_RESERVE_STANDARDS.A.reserveWidthStd
    const gStd = ROAD_RESERVE_STANDARDS.G.reserveWidthStd
    expect(aStd).toBeGreaterThan(gStd)
  })

  it('should have standard width >= minimum width for every class', () => {
    for (const cls of classes) {
      const std = ROAD_RESERVE_STANDARDS[cls]
      expect(std.reserveWidthStd).toBeGreaterThanOrEqual(std.reserveWidthMin)
    }
  })
})

// ─── getRoadReserveWidth ────────────────────────────────────────────────────

describe('getRoadReserveWidth', () => {
  it('should return Class A: min=40, standard=60', () => {
    const result = getRoadReserveWidth('A')
    expect(result.min).toBe(40)
    expect(result.standard).toBe(60)
    expect(result.description).toContain('National Trunk')
  })

  it('should return Class D: min=20, standard=25', () => {
    const result = getRoadReserveWidth('D')
    expect(result.min).toBe(20)
    expect(result.standard).toBe(25)
    expect(result.description).toContain('County Trunk')
  })

  it('should return Class G: min=8, standard=10', () => {
    const result = getRoadReserveWidth('G')
    expect(result.min).toBe(8)
    expect(result.standard).toBe(10)
    expect(result.description).toContain('Special Purpose')
  })

  it('should return defaults for an unknown road class', () => {
    const result = getRoadReserveWidth('Z')
    expect(result.min).toBe(0)
    expect(result.standard).toBe(0)
    expect(result.description).toBe('Unknown road class')
  })

  it('should include carriageway and shoulder standards', () => {
    const result = getRoadReserveWidth('A')
    expect(result.carriagewayStd).toBeCloseTo(7.0, 1)
    expect(result.shoulderStd).toBeCloseTo(2.5, 1)
  })
})

// ─── checkRoadReserveCompliance ─────────────────────────────────────────────

describe('checkRoadReserveCompliance', () => {
  it('should be compliant when proposed=60 meets Class A standard', () => {
    const result = checkRoadReserveCompliance('A', 60)
    expect(result.compliant).toBe(true)
    expect(result.deficit).toBe(0)
    expect(result.required).toBe(40) // minimum
  })

  it('should be non-compliant with deficit when proposed=30 for Class A', () => {
    const result = checkRoadReserveCompliance('A', 30)
    expect(result.compliant).toBe(false)
    expect(result.deficit).toBeCloseTo(10, 1) // 40 - 30 = 10
    expect(result.required).toBe(40)
    expect(result.proposed).toBe(30)
  })

  it('should be compliant when proposed=40 meets Class A minimum exactly', () => {
    const result = checkRoadReserveCompliance('A', 40)
    expect(result.compliant).toBe(true)
    expect(result.deficit).toBe(0)
  })

  it('should be non-compliant for unknown class', () => {
    const result = checkRoadReserveCompliance('X', 50)
    expect(result.compliant).toBe(false)
  })

  it('should be compliant for Class G with proposed=10', () => {
    const result = checkRoadReserveCompliance('G', 10)
    expect(result.compliant).toBe(true)
    expect(result.deficit).toBe(0)
  })
})

// ─── computeCorridorBoundary ────────────────────────────────────────────────

describe('computeCorridorBoundary', () => {
  it('should compute boundaries for a straight east-west line with 40m reserve', () => {
    const centreline = [
      { easting: 0, northing: 0 },
      { easting: 100, northing: 0 },
    ]
    const result = computeCorridorBoundary(centreline, 40)

    // Half width = 20; perpendicular to east direction is north/south
    expect(result.leftBoundary).toHaveLength(2)
    expect(result.rightBoundary).toHaveLength(2)

    // Left boundary (north, positive northing)
    expect(result.leftBoundary[0].easting).toBeCloseTo(0, 3)
    expect(result.leftBoundary[0].northing).toBeCloseTo(20, 3)
    expect(result.leftBoundary[1].easting).toBeCloseTo(100, 3)
    expect(result.leftBoundary[1].northing).toBeCloseTo(20, 3)

    // Right boundary (south, negative northing)
    expect(result.rightBoundary[0].easting).toBeCloseTo(0, 3)
    expect(result.rightBoundary[0].northing).toBeCloseTo(-20, 3)
    expect(result.rightBoundary[1].easting).toBeCloseTo(100, 3)
    expect(result.rightBoundary[1].northing).toBeCloseTo(-20, 3)
  })

  it('should have the same number of boundary points as input centreline points', () => {
    const centreline = [
      { easting: 0, northing: 0 },
      { easting: 50, northing: 20 },
      { easting: 100, northing: 0 },
    ]
    const result = computeCorridorBoundary(centreline, 40)

    expect(result.leftBoundary).toHaveLength(3)
    expect(result.rightBoundary).toHaveLength(3)
  })

  it('should return empty boundaries for a single-point centreline', () => {
    const result = computeCorridorBoundary(
      [{ easting: 0, northing: 0 }],
      40,
    )

    expect(result.leftBoundary).toHaveLength(0)
    expect(result.rightBoundary).toHaveLength(0)
  })

  it('should compute correct perpendicular for a north-south line', () => {
    // Northward line
    const centreline = [
      { easting: 50, northing: 0 },
      { easting: 50, northing: 100 },
    ]
    const result = computeCorridorBoundary(centreline, 30)

    // Perpendicular to north is east/west
    // Left (west, negative easting)
    expect(result.leftBoundary[0].easting).toBeCloseTo(35, 3) // 50 - 15
    expect(result.leftBoundary[0].northing).toBeCloseTo(0, 3)

    // Right (east, positive easting)
    expect(result.rightBoundary[0].easting).toBeCloseTo(65, 3) // 50 + 15
    expect(result.rightBoundary[0].northing).toBeCloseTo(0, 3)
  })
})

// ─── estimateAcquisitionArea ────────────────────────────────────────────────

describe('estimateAcquisitionArea', () => {
  it('should compute correct areas for Length=1000, Reserve=60, Existing=20', () => {
    const result = estimateAcquisitionArea(1000, 60, 20)

    // Total reserve = 1000 × 60 = 60,000 m²
    expect(result.totalReserveArea).toBeCloseTo(60000, 1)

    // New acquisition = 1000 × (60 - 20) = 40,000 m²
    expect(result.newAcquisitionArea).toBeCloseTo(40000, 1)

    // Total acres = 60000 / 4046.86 ≈ 14.826
    expect(result.totalAcres).toBeCloseTo(60000 / 4046.86, 1)

    // Total hectares = 60000 / 10000 = 6.0
    expect(result.totalHectares).toBeCloseTo(6.0, 1)
  })

  it('should return zero new acquisition when existing width meets reserve', () => {
    const result = estimateAcquisitionArea(1000, 40, 40)
    expect(result.newAcquisitionArea).toBe(0)
  })

  it('should return zero new acquisition when existing width exceeds reserve', () => {
    const result = estimateAcquisitionArea(1000, 30, 50)
    expect(result.newAcquisitionArea).toBe(0)
  })

  it('should scale linearly with road length', () => {
    const r1 = estimateAcquisitionArea(500, 40, 20)
    const r2 = estimateAcquisitionArea(1000, 40, 20)

    expect(r2.totalReserveArea).toBeCloseTo(r1.totalReserveArea * 2, 1)
    expect(r2.newAcquisitionArea).toBeCloseTo(r1.newAcquisitionArea * 2, 1)
  })
})

// ─── determineAcquisitionType ──────────────────────────────────────────────

describe('determineAcquisitionType', () => {
  it('should return "none" for 0% overlap', () => {
    expect(determineAcquisitionType(0, false)).toBe('none')
    expect(determineAcquisitionType(0, true)).toBe('none')
  })

  it('should return "full" for >80% overlap', () => {
    expect(determineAcquisitionType(90, false)).toBe('full')
    expect(determineAcquisitionType(81, false)).toBe('full')
  })

  it('should return "full" for any overlap when isBuilding=true (code: isBuilding → full)', () => {
    expect(determineAcquisitionType(90, true)).toBe('full')
    expect(determineAcquisitionType(50, true)).toBe('full')
    expect(determineAcquisitionType(10, true)).toBe('full')
  })

  it('should return "partial" for 20-80% overlap with no building', () => {
    expect(determineAcquisitionType(50, false)).toBe('partial')
    expect(determineAcquisitionType(20, false)).toBe('partial')
    expect(determineAcquisitionType(80, false)).toBe('partial')
  })

  it('should return "wayleave" for <20% overlap with no building', () => {
    expect(determineAcquisitionType(10, false)).toBe('wayleave')
    expect(determineAcquisitionType(1, false)).toBe('wayleave')
    expect(determineAcquisitionType(19, false)).toBe('wayleave')
  })

  it('should return "full" for exactly 100% overlap', () => {
    expect(determineAcquisitionType(100, false)).toBe('full')
  })
})
