import {
  parseSlopeRatio,
  computeCamberProfile,
  computeSlopeIntercept,
  computeCutFillArea,
  computeFormationLine,
} from '../crossSectionGeometry'
import type { ProfilePoint, RoadTemplate } from '../crossSectionGeometry'

// ─── parseSlopeRatio ────────────────────────────────────────────────────────

describe('parseSlopeRatio', () => {
  it('should parse "1:2" → 2', () => {
    expect(parseSlopeRatio('1:2')).toBe(2)
  })

  it('should parse "1:1.5" → 1.5', () => {
    expect(parseSlopeRatio('1:1.5')).toBe(1.5)
  })

  it('should parse "1V:3H" → 3', () => {
    expect(parseSlopeRatio('1V:3H')).toBe(3)
  })

  it('should handle whitespace in format', () => {
    expect(parseSlopeRatio(' 1 : 2 ')).toBe(2)
  })

  it('should handle "1V : 2H" with spaces', () => {
    expect(parseSlopeRatio('1V : 2H')).toBe(2)
  })

  it('should throw for invalid slope format', () => {
    expect(() => parseSlopeRatio('2:1')).toThrow('Invalid slope format')
    expect(() => parseSlopeRatio('abc')).toThrow('Invalid slope format')
    expect(() => parseSlopeRatio('')).toThrow('Invalid slope format')
  })
})

// ─── computeCamberProfile ───────────────────────────────────────────────────

describe('computeCamberProfile', () => {
  it('should have centre (offset=0) level equal to formation level', () => {
    const profile = computeCamberProfile(7.0, 2.5, 100.0)
    const centre = profile.find((p) => Math.abs(p.offset) < 0.01)
    expect(centre).toBeDefined()
    expect(centre!.level).toBeCloseTo(100.0, 3)
  })

  it('should have edges at lower level than centre (camber drops outward)', () => {
    const profile = computeCamberProfile(7.0, 2.5, 100.0)
    const halfWidth = 3.5
    const leftEdge = profile.find((p) => Math.abs(p.offset - (-halfWidth)) < 0.01)
    const rightEdge = profile.find((p) => Math.abs(p.offset - halfWidth) < 0.01)

    expect(leftEdge).toBeDefined()
    expect(rightEdge).toBeDefined()
    expect(leftEdge!.level).toBeLessThan(100.0)
    expect(rightEdge!.level).toBeLessThan(100.0)
  })

  it('should be symmetric around centreline', () => {
    const profile = computeCamberProfile(7.0, 2.5, 100.0)

    for (let i = 0; i < profile.length; i++) {
      const mirrorOffset = -profile[i].offset
      const mirror = profile.find((p) => Math.abs(p.offset - mirrorOffset) < 0.001)
      if (mirror) {
        expect(profile[i].level).toBeCloseTo(mirror.level, 10)
      }
    }
  })

  it('should have the correct number of points for CW=7 at 0.5m intervals', () => {
    const profile = computeCamberProfile(7.0, 2.5, 100.0)
    // numPoints = ceil(7.0/0.5) = 14, so array length = 15
    expect(profile.length).toBe(15)
  })

  it('should compute edge levels using the parabolic camber equation', () => {
    const CW = 7.0
    const camber = 2.5
    const FL = 100.0
    const halfWidth = CW / 2

    const profile = computeCamberProfile(CW, camber, FL)

    // Camber coefficient: c = (camber/100) / halfWidth²
    const c = (camber / 100) / (halfWidth * halfWidth)
    // Edge drop at x = ±3.5: c × 3.5² = camber/100 = 0.025
    const expectedEdgeLevel = FL - c * halfWidth * halfWidth

    const leftEdge = profile.find((p) => Math.abs(p.offset - (-halfWidth)) < 0.01)
    const rightEdge = profile.find((p) => Math.abs(p.offset - halfWidth) < 0.01)

    expect(leftEdge!.level).toBeCloseTo(expectedEdgeLevel, 3)
    expect(rightEdge!.level).toBeCloseTo(expectedEdgeLevel, 3)
  })

  it('should return a single point for zero carriageway width', () => {
    const profile = computeCamberProfile(0, 2.5, 100.0)
    expect(profile.length).toBe(1)
    expect(profile[0].offset).toBeCloseTo(0, 5)
    expect(profile[0].level).toBeCloseTo(100.0, 5)
  })
})

// ─── computeSlopeIntercept ──────────────────────────────────────────────────

describe('computeSlopeIntercept', () => {
  it('should find intersection between a fill slope and ground on the right side', () => {
    // Ground profile: symmetric ridge
    const ground: ProfilePoint[] = [
      { offset: -10, level: 98 },
      { offset: -5, level: 99 },
      { offset: 0, level: 100 },
      { offset: 5, level: 99 },
      { offset: 10, level: 98 },
    ]

    // Shoulder at 3.5m offset, level 99.7
    // Fill slope 1:2 going down-right (isCut=false)
    const result = computeSlopeIntercept(3.5, 99.7, 2, false, ground)

    expect(result).not.toBeNull()
    if (result) {
      // Intersection occurs between the (0,100)→(5,99) ground segment and the
      // descending fill slope; should be beyond the shoulder offset of 3.5
      expect(result.offset).toBeGreaterThan(3.5)
      expect(result.level).toBeGreaterThan(0)
    }
  })

  it('should find intersection for a cut slope going upward', () => {
    // Ground: flat at 102 extending to 15m → cut slope has room to reach ground
    const ground: ProfilePoint[] = [
      { offset: -10, level: 102 },
      { offset: -5, level: 102 },
      { offset: 0, level: 102 },
      { offset: 5, level: 102 },
      { offset: 10, level: 102 },
      { offset: 15, level: 102 },
    ]

    // Shoulder at offset 5.5, level 99.5 (below ground of 102)
    // Cut slope 1:2 going up-right; reaches 102 at offset 5.5 + 2*(102-99.5) = 10.5
    const result = computeSlopeIntercept(5.5, 99.5, 2, true, ground)

    expect(result).not.toBeNull()
    if (result) {
      expect(result.offset).toBeGreaterThan(5.5)
      expect(result.offset).toBeLessThan(15)
      expect(result.level).toBeCloseTo(102, 0)
    }
  })

  it('should return null for insufficient ground points', () => {
    const ground: ProfilePoint[] = [{ offset: 0, level: 100 }]
    const result = computeSlopeIntercept(3.5, 99.5, 2, false, ground)
    expect(result).toBeNull()
  })
})

// ─── computeCutFillArea ────────────────────────────────────────────────────

describe('computeCutFillArea', () => {
  it('should compute ~20 m² cut for flat ground at 100 over formation at 98 across 10m', () => {
    // Ground flat at 100, formation flat at 98, 10m wide
    const ground: ProfilePoint[] = [
      { offset: -5, level: 100 },
      { offset: 5, level: 100 },
    ]
    const formation: ProfilePoint[] = [
      { offset: -5, level: 98 },
      { offset: 5, level: 98 },
    ]

    const area = computeCutFillArea(ground, formation)

    // Area ≈ 10 × 2 = 20 m²; positive for cut (ground above formation)
    expect(area).toBeCloseTo(20, 0)
    expect(area).toBeGreaterThan(0) // cut is positive
  })

  it('should return negative area for fill scenario (ground below formation)', () => {
    // Ground flat at 98, formation flat at 100
    const ground: ProfilePoint[] = [
      { offset: -5, level: 98 },
      { offset: 5, level: 98 },
    ]
    const formation: ProfilePoint[] = [
      { offset: -5, level: 100 },
      { offset: 5, level: 100 },
    ]

    const area = computeCutFillArea(ground, formation)

    expect(area).toBeLessThan(0) // fill is negative
    expect(Math.abs(area)).toBeCloseTo(20, 0)
  })

  it('should return 0 when profiles have fewer than 2 points', () => {
    const ground: ProfilePoint[] = [{ offset: 0, level: 100 }]
    const formation: ProfilePoint[] = [{ offset: 0, level: 98 }]

    expect(computeCutFillArea(ground, formation)).toBe(0)
    expect(computeCutFillArea([], formation)).toBe(0)
  })
})

// ─── computeFormationLine ───────────────────────────────────────────────────

describe('computeFormationLine', () => {
  const template: RoadTemplate = {
    carriagewayWidth: 7,
    shoulderWidth: 2,
    cutSlope: '1:2',
    fillSlope: '1:1.5',
    camber: 2.5,
    subgradeDepth: 0.15,
  }

  // Ground profile extending well beyond the road
  const ground: ProfilePoint[] = [
    { offset: -15, level: 104 },
    { offset: -10, level: 103 },
    { offset: -5, level: 102 },
    { offset: 0, level: 101 },
    { offset: 5, level: 102 },
    { offset: 10, level: 103 },
    { offset: 15, level: 104 },
  ]

  it('should return points spanning wider than carriageway + shoulders (±5.5m)', () => {
    const formation = computeFormationLine(template, 100, ground, true)

    const minOffset = Math.min(...formation.map((p) => p.offset))
    const maxOffset = Math.max(...formation.map((p) => p.offset))

    // Total span should exceed CW + 2×shoulders = 7 + 4 = 11m (from -5.5 to +5.5)
    expect(maxOffset - minOffset).toBeGreaterThan(11)
  })

  it('should have centre as the highest point (parabolic camber)', () => {
    const formation = computeFormationLine(template, 100, ground, true)

    const centrePoint = formation.find((p) => Math.abs(p.offset) < 0.01)
    expect(centrePoint).toBeDefined()
    expect(centrePoint!.level).toBeCloseTo(100, 3)

    // All other carriageway points should be lower
    const carriagewayPoints = formation.filter(
      (p) => Math.abs(p.offset) <= 3.5 && Math.abs(p.offset) > 0.01,
    )
    for (const p of carriagewayPoints) {
      expect(p.level).toBeLessThan(centrePoint!.level)
    }
  })

  it('should include shoulder points at ±5.5m offset', () => {
    const formation = computeFormationLine(template, 100, ground, true)

    const leftShoulder = formation.find((p) => Math.abs(p.offset - (-5.5)) < 0.01)
    const rightShoulder = formation.find((p) => Math.abs(p.offset - 5.5) < 0.01)

    expect(leftShoulder).toBeDefined()
    expect(rightShoulder).toBeDefined()
  })

  it('should have shoulder levels lower than carriageway edges (cross-fall)', () => {
    const formation = computeFormationLine(template, 100, ground, true)

    const leftEdge = formation.find((p) => Math.abs(p.offset - (-3.5)) < 0.01)
    const leftShoulder = formation.find((p) => Math.abs(p.offset - (-5.5)) < 0.01)

    expect(leftShoulder!.level).toBeLessThan(leftEdge!.level)
  })

  it('should include slope intercept points when ground extends far enough', () => {
    const formation = computeFormationLine(template, 100, ground, true)

    // For a cut section with ground at ~102 and formation at ~99,
    // the cut slope should intercept the ground
    const minOffset = Math.min(...formation.map((p) => p.offset))
    const maxOffset = Math.max(...formation.map((p) => p.offset))

    // Should extend beyond shoulders due to slope intercepts
    expect(Math.abs(minOffset)).toBeGreaterThan(5.5)
    expect(maxOffset).toBeGreaterThan(5.5)
  })

  it('should handle fill section mode with different slope ratio', () => {
    const fillGround: ProfilePoint[] = [
      { offset: -15, level: 96 },
      { offset: -10, level: 97 },
      { offset: -5, level: 98 },
      { offset: 0, level: 98.5 },
      { offset: 5, level: 98 },
      { offset: 10, level: 97 },
      { offset: 15, level: 96 },
    ]

    const formation = computeFormationLine(template, 100, fillGround, false)

    expect(formation.length).toBeGreaterThan(0)

    // Centre should still be at formation level
    const centrePoint = formation.find((p) => Math.abs(p.offset) < 0.01)
    expect(centrePoint).toBeDefined()
    expect(centrePoint!.level).toBeCloseTo(100, 3)
  })
})
