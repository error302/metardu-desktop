import {
  getTopoConfigForCountry,
  getASPRSRMSE,
  getASPRSContourRMSE,
  getBoundaryTolerance,
  nssdaHorizontal,
  nssdaVertical,
  ASPRS_PLANIMETRIC,
  ASPRS_TOPOGRAPHIC,
} from '../topographic'

describe('getTopoConfigForCountry', () => {
  it('Kenya: 2m contour, 1:2,500 scale, Class 2', () => {
    const cfg = getTopoConfigForCountry('kenya')
    expect(cfg.defaultContourInterval).toBe(2.0)
    expect(cfg.defaultScale).toBe('1:2,500')
    expect(cfg.rmseClass).toBe(2)
    expect(cfg.requiresDTM).toBe(true)
  })

  it('US: 2m contour, 1:5,000 scale, Class 1', () => {
    const cfg = getTopoConfigForCountry('us')
    expect(cfg.defaultContourInterval).toBe(2.0)
    expect(cfg.defaultScale).toBe('1:5,000')
    expect(cfg.rmseClass).toBe(1)
    expect(cfg.requiresDTM).toBe(true)
    expect(cfg.requiresBreaklines).toBe(true)
  })

  it('Bahrain: 1m contour, Class 1', () => {
    const cfg = getTopoConfigForCountry('bahrain')
    expect(cfg.defaultContourInterval).toBe(1.0)
    expect(cfg.rmseClass).toBe(1)
  })

  it('UK: 1m contour, 1:1,250 scale', () => {
    const cfg = getTopoConfigForCountry('uk')
    expect(cfg.defaultContourInterval).toBe(1.0)
    expect(cfg.defaultScale).toBe('1:1,250')
  })

  it('unknown country: defaults to 2m, Class 2', () => {
    const cfg = getTopoConfigForCountry('other')
    expect(cfg.defaultContourInterval).toBe(2.0)
    expect(cfg.rmseClass).toBe(2)
  })
})

describe('ASPRS Planimetric Table', () => {
  it('has 17 scale entries', () => {
    expect(ASPRS_PLANIMETRIC.length).toBe(17)
  })

  it('each entry has Class 1 < Class 2 < Class 3', () => {
    ASPRS_PLANIMETRIC.forEach((e: any) => {
      expect(e.class1).toBeLessThan(e.class2)
      expect(e.class2).toBeLessThan(e.class3)
    })
  })

  it('1:1,000 scale, Class 1: 0.304ft RMSE', () => {
    const r = getASPRSRMSE("1\"=1,000'", 1)
    expect(r).toBeCloseTo(0.304, 2)
  })
})

describe('ASPRS Topographic Table', () => {
  it('has 6 contour interval entries', () => {
    expect(ASPRS_TOPOGRAPHIC.length).toBe(6)
  })

  it('each entry has Class 1 < Class 2 < Class 3', () => {
    ASPRS_TOPOGRAPHIC.forEach((e: any) => {
      expect(e.class1).toBeLessThan(e.class2)
      expect(e.class2).toBeLessThan(e.class3)
    })
  })

  it('1ft contour, Class 1: 0.067ft RMSE', () => {
    const r = getASPRSContourRMSE(1.0, 1)
    expect(r).toBeCloseTo(0.067, 2)
  })
})

describe('getBoundaryTolerance', () => {
  it('Kenya: 0.10m tolerance', () => {
    const t = getBoundaryTolerance('kenya')
    expect(t.tolerance).toBeCloseTo(0.10, 1)
    expect(t.unit).toBe('metres')
  })

  it('Bahrain: 0.05m tolerance', () => {
    const t = getBoundaryTolerance('bahrain')
    expect(t.tolerance).toBeCloseTo(0.05, 1)
  })

  it('US: ALTA formula (20mm + 50ppm)', () => {
    const t = getBoundaryTolerance('us', 1000)
    expect(t.tolerance).toBeCloseTo(0.020 + 0.00005 * 1000, 3)
    expect(t.unit).toBe('metres')
  })

  it('UK: 0.10m tolerance', () => {
    const t = getBoundaryTolerance('uk')
    expect(t.tolerance).toBeCloseTo(0.10, 1)
  })

  it('NZ: 0.05m tolerance', () => {
    const t = getBoundaryTolerance('new_zealand')
    expect(t.tolerance).toBeCloseTo(0.05, 1)
  })
})

describe('NSSDA Accuracy', () => {
  it('horizontal accuracy = 2.447 × RMSE', () => {
    expect(nssdaHorizontal(0.304)).toBeCloseTo(0.744, 2)  // 0.304 × 2.447 ≈ 0.744
  })

  it('vertical accuracy = 1.96 × RMSE', () => {
    expect(nssdaVertical(0.067)).toBeCloseTo(0.131, 2)  // 0.067 × 1.96 ≈ 0.131
  })

  it('NSSDA gives 95% confidence', () => {
    const rmse = 1.0
    expect(nssdaHorizontal(rmse)).toBeCloseTo(2.447, 2)
    expect(nssdaVertical(rmse)).toBeCloseTo(1.96, 2)
  })
})
