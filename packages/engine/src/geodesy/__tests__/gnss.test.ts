import { geodeticToECEF, ecefToGeodetic, computeBaseline, utmToGeodetic, calculatePDOP } from '../gnss'

describe('geodeticToECEF', () => {
  it('converts equatorial point on prime meridian', () => {
    const r = geodeticToECEF(0, 0, 0)
    // At (0°,0°,0m): X≈6378137, Y=0, Z=0
    expect(r.x).toBeCloseTo(6378137, -2)
    expect(Math.abs(r.y)).toBeLessThan(1)
    expect(Math.abs(r.z)).toBeLessThan(1)
  })

  it('north pole has Z ≈ semi-minor axis', () => {
    const r = geodeticToECEF(90, 0, 0)
    expect(r.z).toBeCloseTo(6356752, -2)
    expect(Math.abs(r.x)).toBeLessThan(10)
  })

  it('height increases X for equatorial point', () => {
    const r0 = geodeticToECEF(0, 0, 0)
    const r1000 = geodeticToECEF(0, 0, 1000)
    expect(r1000.x).toBeGreaterThan(r0.x)
  })

  it('round-trips with ecefToGeodetic', () => {
    const lat = -1.2921, lon = 36.8219, h = 1798
    const ecef = geodeticToECEF(lat, lon, h)
    const back = ecefToGeodetic(ecef.x, ecef.y, ecef.z)
    expect(back.lat).toBeCloseTo(lat, 4)
    expect(back.lon).toBeCloseTo(lon, 4)
    expect(back.h).toBeCloseTo(h, 0)
  })
})

describe('computeBaseline', () => {
  it('returns baseline vector between two stations', () => {
    const fromEcef = geodeticToECEF(-1.29, 36.82, 1798)
    const toEcef = geodeticToECEF(-1.28, 36.83, 1800)
    const from = { pointName: 'BASE', x: fromEcef.x, y: fromEcef.y, z: fromEcef.z }
    const to   = { pointName: 'ROVER', x: toEcef.x, y: toEcef.y, z: toEcef.z }
    const r = computeBaseline(from, to)
    expect(Number.isFinite(r.deltaX)).toBe(true)
    expect(Number.isFinite(r.deltaY)).toBe(true)
    expect(Number.isFinite(r.deltaZ)).toBe(true)
    expect(r.distance3D).toBeGreaterThan(0)
  })

  it('zero baseline for same point', () => {
    const ecef = geodeticToECEF(0, 0, 0)
    const pt = { pointName: 'A', x: ecef.x, y: ecef.y, z: ecef.z }
    const r = computeBaseline(pt, pt)
    expect(r.distance3D).toBeCloseTo(0, 4)
  })
})

describe('utmToGeodetic', () => {
  it('converts UTM coordinates and returns valid lat/lon', () => {
    const r = utmToGeodetic(500000, 0, 37, 'N')
    expect(Number.isFinite(r.lat)).toBe(true)
    expect(Number.isFinite(r.lon)).toBe(true)
    // Longitude should be within valid range
    expect(r.lon).toBeGreaterThanOrEqual(-180)
    expect(r.lon).toBeLessThanOrEqual(180)
  })

  it('returns finite lat/lon', () => {
    const r = utmToGeodetic(500000, 0, 36, 'N')
    expect(Number.isFinite(r.lat)).toBe(true)
    expect(Number.isFinite(r.lon)).toBe(true)
  })
})

describe('calculatePDOP', () => {
  it('returns a finite positive PDOP', () => {
    const satellites = [
      { x: 20000000, y: 0, z: 20000000 },
      { x: -20000000, y: 0, z: 20000000 },
      { x: 0, y: 20000000, z: 20000000 },
      { x: 0, y: -20000000, z: 20000000 },
    ]
    const user = { x: 6378137, y: 0, z: 0 }
    const pdop = calculatePDOP(satellites, user)
    expect(Number.isFinite(pdop)).toBe(true)
    expect(pdop).toBeGreaterThan(0)
  })
})
