import {
  slopeFromEDM,
  seaLevelCorrection,
  gridCorrection,
  edmTemperatureCorrection,
  edmPressureCorrection,
  edmCombinedAtmosphericCorrection,
  edmFullReduction,
} from '../edm-corrections'

describe('slopeFromEDM', () => {
  it('zenith 90°: horizontal = slope (horizontal line)', () => {
    const r = slopeFromEDM({ slopeDistanceMetres: 100, zenithAngle: 90 })
    expect(r.horizontalDistance).toBeCloseTo(100, 2)
    expect(r.requiresTwoFace).toBe(false)
  })

  it('zenith 91°: flagged for two-face', () => {
    const r = slopeFromEDM({ slopeDistanceMetres: 100, zenithAngle: 91 })
    expect(r.requiresTwoFace).toBe(true)
    expect(r.warnings.some((w: any) => w.includes('both-face'))).toBe(true)
  })

  it('zenith 89°: flagged for two-face', () => {
    const r = slopeFromEDM({ slopeDistanceMetres: 100, zenithAngle: 89 })
    expect(r.requiresTwoFace).toBe(true)
  })

  it('≥500m: meteorological warning', () => {
    const r = slopeFromEDM({ slopeDistanceMetres: 500, zenithAngle: 90 })
    expect(r.warnings.some((w: any) => w.includes('meteorological'))).toBe(true)
  })
})

describe('seaLevelCorrection', () => {
  it('flat terrain: minimal correction', () => {
    const r = seaLevelCorrection({ horizontalDistance: 1000, meanElevationMetres: 0 })
    expect(r.curvatureRefractionCorr).toBeCloseTo(0.078, 1)  // 1000²/(2R) ≈ 0.078m
    expect(r.seaLevelDistance).toBeLessThan(1000)
  })

  it('high elevation: larger correction', () => {
    const r = seaLevelCorrection({ horizontalDistance: 1000, meanElevationMetres: 2000 })
    expect(r.curvatureRefractionCorr).toBeCloseTo(0.078, 1)  // curvature correction depends only on distance
  })

  it('long distance: correction grows with D²', () => {
    const r1 = seaLevelCorrection({ horizontalDistance: 1000, meanElevationMetres: 0 })
    const r2 = seaLevelCorrection({ horizontalDistance: 2000, meanElevationMetres: 0 })
    expect(r2.curvatureRefractionCorr).toBeGreaterThan(r1.curvatureRefractionCorr * 3)
  })
})

describe('gridCorrection', () => {
  it('scale factor 1.0: no change', () => {
    const r = gridCorrection({ seaLevelDistance: 1000, scaleFactor: 1.0 })
    expect(r.gridDistance).toBeCloseTo(1000, 4)
    expect(r.seaToGridCorr).toBeCloseTo(0, 4)
  })

  it('scale factor > 1: grid distance increases', () => {
    const r = gridCorrection({ seaLevelDistance: 1000, scaleFactor: 1.0001 })
    expect(r.gridDistance).toBeGreaterThan(1000)
  })

  it('unusual scale factor: warning', () => {
    const r = gridCorrection({ seaLevelDistance: 1000, scaleFactor: 0.9980 })
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})

describe('edmTemperatureCorrection', () => {
  it('standard conditions (15°C, 1013.25hPa): zero correction', () => {
    const ppm = edmTemperatureCorrection(15, 1013.25, 5)
    expect(Math.abs(ppm)).toBeLessThan(0.1)
  })

  it('hot temperature: positive ppm (reduces measured distance)', () => {
    const ppm = edmTemperatureCorrection(25, 1013.25, 5)
    expect(ppm).toBeGreaterThan(0)
  })

  it('cold temperature: negative ppm', () => {
    const ppm = edmTemperatureCorrection(5, 1013.25, 5)
    expect(ppm).toBeLessThan(0)
  })

  it('magnitude increases with temperature deviation', () => {
    const ppm10 = edmTemperatureCorrection(20, 1013.25, 5)
    const ppm25 = edmTemperatureCorrection(35, 1013.25, 5)
    expect(Math.abs(ppm25)).toBeGreaterThan(Math.abs(ppm10))
  })
})

describe('edmPressureCorrection', () => {
  it('standard pressure (1013.25hPa): near zero', () => {
    const ppm = edmPressureCorrection(15, 1013.25, 5)
    expect(Math.abs(ppm)).toBeLessThan(0.1)
  })

  it('low pressure: positive ppm', () => {
    const ppm = edmPressureCorrection(15, 980, 5)
    expect(ppm).toBeGreaterThan(0)
  })

  it('high pressure: negative ppm', () => {
    const ppm = edmPressureCorrection(15, 1050, 5)
    expect(ppm).toBeLessThan(0)
  })
})

describe('edmCombinedAtmosphericCorrection', () => {
  it('standard: isWithinSpec', () => {
    const r = edmCombinedAtmosphericCorrection(15, 1013.25, 5)
    expect(r.isWithinSpec).toBe(true)
    expect(r.totalPPM).toBeCloseTo(0, 1)
  })

  it('hot dry: large positive PPM', () => {
    const r = edmCombinedAtmosphericCorrection(35, 980, 5)
    expect(r.totalPPM).toBeGreaterThan(0)
  })

  it('cold wet: large negative PPM', () => {
    const r = edmCombinedAtmosphericCorrection(5, 1050, 5)
    expect(r.totalPPM).toBeLessThan(0)
  })
})

describe('edmFullReduction', () => {
  it('returns all correction stages', () => {
    const r = edmFullReduction({
      slopeDistance: 1000,
      zenithAngle: 90,
      meanElevation: 1000,
      scaleFactor: 1.0001,
      temperatureC: 20,
      pressureHPa: 1013.25,
      edmSpecMM: 5,
      edmSpecPPM: 5,
    })
    expect(r.slopeDistance).toBe(1000)
    expect(r.horizontalDistance).toBeCloseTo(1000, 1)
    expect(r.seaLevelDistance).toBeLessThan(r.horizontalDistance)
    expect(r.gridDistance).toBeGreaterThan(0)
    expect(r.ppm).toBeDefined()
    expect(r.mmAccuracy).toBeGreaterThan(0)
  })

  it('flags acceptable accuracy', () => {
    const r = edmFullReduction({
      slopeDistance: 1000,
      zenithAngle: 90,
      meanElevation: 0,
      scaleFactor: 1.0,
      temperatureC: 15,
      pressureHPa: 1013.25,
    })
    expect(r.isAcceptable).toBe(true)
  })
})
