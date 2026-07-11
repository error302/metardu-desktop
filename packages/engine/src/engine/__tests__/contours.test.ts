import { triangulate, generateContours } from '../contours'

const SPOT_HEIGHTS = [
  { name: 'A', easting: 0,   northing: 0,   elevation: 10 },
  { name: 'B', easting: 100, northing: 0,   elevation: 20 },
  { name: 'C', easting: 100, northing: 100, elevation: 15 },
  { name: 'D', easting: 0,   northing: 100, elevation: 5  },
  { name: 'E', easting: 50,  northing: 50,  elevation: 25 },
]

describe('triangulate', () => {
  it('returns triangles from spot heights', () => {
    const tris = triangulate(SPOT_HEIGHTS)
    expect(tris.length).toBeGreaterThan(0)
  })

  it('each triangle has 3 vertices', () => {
    const tris = triangulate(SPOT_HEIGHTS)
    tris.forEach((tri: any) => {
      expect(tri.p1).toBeDefined()
      expect(tri.p2).toBeDefined()
      expect(tri.p3).toBeDefined()
    })
  })

  it('returns empty array for < 3 points', () => {
    const tris = triangulate([SPOT_HEIGHTS[0], SPOT_HEIGHTS[1]])
    expect(tris.length).toBe(0)
  })
})

describe('generateContours', () => {
  it('generates contour lines between min and max elevation', () => {
    const contours = generateContours(SPOT_HEIGHTS, 5)
    expect(contours.length).toBeGreaterThan(0)
  })

  it('all contour elevations are between min and max elevation', () => {
    const elevations = SPOT_HEIGHTS.map((p: any) => p.elevation)
    const minE = Math.min(...elevations)
    const maxE = Math.max(...elevations)
    const contours = generateContours(SPOT_HEIGHTS, 5)
    contours.forEach((c: any) => {
      expect(c.elevation).toBeGreaterThanOrEqual(minE)
      expect(c.elevation).toBeLessThanOrEqual(maxE)
    })
  })

  it('finer interval gives more contours', () => {
    const coarse = generateContours(SPOT_HEIGHTS, 10)
    const fine = generateContours(SPOT_HEIGHTS, 5)
    expect(fine.length).toBeGreaterThanOrEqual(coarse.length)
  })

  it('returns empty array for < 3 points', () => {
    const result = generateContours([SPOT_HEIGHTS[0], SPOT_HEIGHTS[1]], 5)
    expect(result.length).toBe(0)
  })
})
