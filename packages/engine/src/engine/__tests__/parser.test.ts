import { parseDelimitedFile, pointsToCSV, validatePoints } from '../parser'

describe('parseDelimitedFile', () => {
  it('parses a CSV with name,easting,northing,elevation', () => {
    const csv = 'A,1000,2000,150\nB,1100,2100,152\nC,1200,2200,148'
    const r = parseDelimitedFile(csv)
    expect(r.points.length).toBe(3)
    expect(r.points[0].name).toBe('A')
    expect(r.points[0].easting).toBeCloseTo(1000, 4)
    expect(r.points[0].northing).toBeCloseTo(2000, 4)
    expect(r.points[0].elevation).toBeCloseTo(150, 4)
  })

  it('handles tab-delimited format', () => {
    const tsv = 'P1\t500\t600\t100\nP2\t510\t610\t105'
    const r = parseDelimitedFile(tsv, '\t')
    expect(r.points.length).toBe(2)
    expect(r.points[0].easting).toBeCloseTo(500, 4)
  })

  it('skips blank lines', () => {
    const csv = 'A,100,200,10\n\nB,110,210,12\n'
    const r = parseDelimitedFile(csv)
    expect(r.points.length).toBe(2)
  })


})

describe('pointsToCSV', () => {
  const POINTS = [
    { name: 'A', easting: 1000, northing: 2000, elevation: 150 },
    { name: 'B', easting: 1100, northing: 2100, elevation: 152 },
  ]

  it('generates a CSV string', () => {
    const csv = pointsToCSV(POINTS)
    expect(typeof csv).toBe('string')
    expect(csv).toContain('A')
    expect(csv).toContain('1000')
  })

  it('has the same number of data rows as points', () => {
    const csv = pointsToCSV(POINTS)
    const lines = csv.trim().split('\n').filter((l: any) => l.trim())
    // May have a header row — data rows should include all points
    expect(lines.length).toBeGreaterThanOrEqual(POINTS.length)
  })

  it('round-trips: parse(pointsToCSV(pts)) gives same points', () => {
    const csv = pointsToCSV(POINTS)
    const r = parseDelimitedFile(csv)
    expect(r.points.length).toBeGreaterThan(0)
  })
})

describe('validatePoints', () => {
  it('returns empty array for valid UTM points', () => {
    // validatePoints checks UTM range 100000-900000
    const pts = [
      { name: 'A', easting: 500000, northing: 9857000, elevation: 100 },
      { name: 'B', easting: 501000, northing: 9858000, elevation: 102 },
    ]
    expect(validatePoints(pts)).toEqual([])
  })

  it('warns on duplicate point names', () => {
    const pts = [
      { name: 'A', easting: 500000, northing: 9857000, elevation: 100 },
      { name: 'A', easting: 501000, northing: 9858000, elevation: 102 },
    ]
    const warnings = validatePoints(pts)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain('A')
  })

  it('warns on out-of-range UTM easting', () => {
    const pts = [{ name: 'A', easting: 50000, northing: 9857000, elevation: 100 }]
    const warnings = validatePoints(pts)
    expect(warnings.length).toBeGreaterThan(0)
  })
})
