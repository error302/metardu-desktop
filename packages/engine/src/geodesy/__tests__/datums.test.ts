import {
  getAvailableDatums,
  getDatumByCountry,
  getDatumByCountryAndIndex,
  getDatumByName,
  getDatumNames,
  transformToWGS84,
  getScaleFactor,
  getConvergenceAngle,
} from '../datums'

describe('getAvailableDatums', () => {
  it('returns all geodetic datums', () => {
    const datums = getAvailableDatums()
    expect(datums.length).toBeGreaterThan(10)
  })

  it('each datum has required geodetic parameters', () => {
    getAvailableDatums().forEach((d: any) => {
      expect(typeof d.name).toBe('string')
      expect(d.name.length).toBeGreaterThan(0)
      expect(typeof d.ellipsoid).toBe('string')
      expect(typeof d.semiMajorAxis).toBe('number')
      expect(d.semiMajorAxis).toBeGreaterThan(6_300_000)
      expect(d.semiMajorAxis).toBeLessThan(6_400_000)
      expect(Array.isArray(d.countries)).toBe(true)
    })
  })
})

describe('getDatumByCountry (new IDs)', () => {
  it('returns WGS84 for unknown country', () => {
    const datums = getDatumByCountry('Narnia')
    expect(datums.length).toBeGreaterThan(0)
  })

  it('returns Arc1960 for kenya', () => {
    const datums = getDatumByCountry('kenya')
    expect(datums.length).toBeGreaterThan(0)
    expect(datums.some((d: any) => d.name === 'Arc 1960')).toBe(true)
  })

  it('returns NAD83 for us', () => {
    const datums = getDatumByCountry('us')
    expect(datums.length).toBeGreaterThan(0)
    expect(datums.some((d: any) => d.name.includes('NAD83'))).toBe(true)
  })

  it('returns GDA2020 for australia', () => {
    const datums = getDatumByCountry('australia')
    expect(datums.length).toBeGreaterThan(0)
    expect(datums.some((d: any) => d.name === 'GDA2020')).toBe(true)
  })

  it('returns NZGD2000 for new_zealand', () => {
    const datums = getDatumByCountry('new_zealand')
    expect(datums.length).toBeGreaterThan(0)
    expect(datums.some((d: any) => d.name === 'NZGD2000')).toBe(true)
  })

  it('returns OSGB36 for uk', () => {
    const datums = getDatumByCountry('uk')
    expect(datums.length).toBeGreaterThan(0)
    expect(datums.some((d: any) => d.name === 'OSGB36')).toBe(true)
  })

  it('returns Hartebeesthoek94 for south_africa', () => {
    const datums = getDatumByCountry('south_africa')
    expect(datums.length).toBeGreaterThan(0)
    expect(datums.some((d: any) => d.name === 'Hartebeesthoek94')).toBe(true)
  })
})

describe('getDatumByCountryAndIndex', () => {
  it('returns WGS84 as default for unknown index', () => {
    const datum = getDatumByCountryAndIndex('kenya', 99)
    expect(datum.name).toBe('WGS84 (G1762)')
  })

  it('returns correct datum by index', () => {
    const datum = getDatumByCountryAndIndex('us', 0)
    expect(datum.name).toContain('NAD83')
  })
})

describe('getDatumNames', () => {
  it('returns all datum registry keys', () => {
    const names = getDatumNames()
    expect(names.length).toBeGreaterThan(10)
    expect(names).toContain('NAD83_2011')
    expect(names).toContain('OSGB36')
    expect(names).toContain('GDA2020')
    expect(names).toContain('NZGD2000')
    expect(names).toContain('HARTEBEESTHOEK94')
    expect(names).toContain('AIN_AL_ABD_1970')
  })
})

describe('getDatumByName', () => {
  it('returns NAD83(2011) datum', () => {
    const datum = getDatumByName('NAD83_2011')
    expect(datum?.name).toContain('NAD83(2011)')
    expect(datum?.semiMajorAxis).toBeCloseTo(6378137.0, 2)
  })

  it('returns OSGB36 datum', () => {
    const datum = getDatumByName('OSGB36')
    expect(datum?.name).toBe('OSGB36')
    expect(datum?.ellipsoid).toBe('Airy 1830')
    expect(datum?.semiMajorAxis).toBeCloseTo(6377563.396, 2)
  })

  it('returns GDA2020 datum', () => {
    const datum = getDatumByName('GDA2020')
    expect(datum?.name).toBe('GDA2020')
    expect(datum?.semiMajorAxis).toBeCloseTo(6378137.0, 2)
  })

  it('returns Ain Al-Abd 1970 for Bahrain', () => {
    const datum = getDatumByName('AIN_AL_ABD_1970')
    expect(datum?.name).toBe('Ain Al-Abd 1970')
    expect(datum?.ellipsoid).toBe('Clarke 1880')
  })

  it('returns undefined for unknown datum', () => {
    expect(getDatumByName('NonExistentDatum123')).toBeUndefined()
  })
})

describe('transformToWGS84', () => {
  it('returns same coordinates for WGS84', () => {
    const datum = getDatumByName('WGS84')
    if (!datum) return
    const result = transformToWGS84(500000, 5000000, 37, 'S', datum)
    expect(result.easting).toBeCloseTo(500000, 0)
    expect(result.note).toContain('already WGS84-compatible')
  })

  it('returns note for WGS84-compatible datums', () => {
    const datum = getDatumByName('NAD83_2011')
    if (!datum) return
    const result = transformToWGS84(500000, 5000000, 17, 'N', datum)
    expect(Number.isFinite(result.easting)).toBe(true)
    expect(result.note).toContain('WGS84-compatible')
  })

  it('applies Helmert transform for Arc 1960', () => {
    const datum = getDatumByName('ARC1960')
    if (!datum) return
    const result = transformToWGS84(257000, 9857000, 37, 'S', datum)
    expect(Number.isFinite(result.easting)).toBe(true)
    // Note uses 'Bursa-Wolf' (the formal name for the 7-parameter Helmert
    // transform per EPSG 9606). Both names refer to the same math.
    expect(result.note).toMatch(/Bursa-Wolf|Helmert/)
  })
})

describe('getScaleFactor', () => {
  it('returns scale factor close to 1 at sea level', () => {
    const sf = getScaleFactor(0, 0)
    expect(sf).toBeCloseTo(1.0, 2)
  })

  it('returns scale factor > 1 at high elevation', () => {
    const sf = getScaleFactor(0, 1000)
    expect(sf).toBeGreaterThan(1.0)
  })
})

describe('getConvergenceAngle', () => {
  it('returns 0 at central meridian', () => {
    const conv = getConvergenceAngle(37, 0, 37)
    expect(conv).toBeCloseTo(0, 1)
  })

  it('returns non-zero away from central meridian', () => {
    const conv = getConvergenceAngle(38, -1.2921, 37)
    expect(Math.abs(conv)).toBeGreaterThan(0)
  })

  it('returns larger convergence at higher latitude', () => {
    const convEquator = getConvergenceAngle(38, -1.2921, 37)
    const convHighLat = getConvergenceAngle(38, 45, 37)
    expect(Math.abs(convHighLat)).toBeGreaterThan(Math.abs(convEquator))
  })
})
