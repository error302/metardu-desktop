/**
 * Tests for Transformation Calibration (auto-derive local 7-param)
 */

import {
  calibrateTransformation,
  validateCommonPoints,
  assessCalibrationQuality,
  type CommonPoint,
} from '../transformationCalibration'

describe('validateCommonPoints', () => {
  it('rejects fewer than 3 points', () => {
    const issues = validateCommonPoints([
      { id: 'P1', source: { x: 1, y: 2, z: 3 }, target: { x: 1, y: 2, z: 3 } },
      { id: 'P2', source: { x: 4, y: 5, z: 6 }, target: { x: 4, y: 5, z: 6 } },
    ])
    expect(issues.some(i => i.includes('at least 3'))).toBe(true)
  })

  it('warns about no redundancy with exactly 3 points', () => {
    const issues = validateCommonPoints([
      { id: 'P1', source: { x: 5000000, y: 3000000, z: -1000000 }, target: { x: 5000100, y: 3000200, z: -999950 } },
      { id: 'P2', source: { x: 4500000, y: -2500000, z: -1200000 }, target: { x: 4500100, y: -2499800, z: -1199950 } },
      { id: 'P3', source: { x: -5200000, y: 3100000, z: -900000 }, target: { x: -5199900, y: 3100200, z: -899950 } },
    ])
    expect(issues.some(i => i.includes('no redundancy'))).toBe(true)
  })

  it('detects duplicate IDs', () => {
    const issues = validateCommonPoints([
      { id: 'P1', source: { x: 5000000, y: 3000000, z: -1000000 }, target: { x: 5000100, y: 3000200, z: -999950 } },
      { id: 'P1', source: { x: 4500000, y: -2500000, z: -1200000 }, target: { x: 4500100, y: -2499800, z: -1199950 } },
      { id: 'P3', source: { x: -5200000, y: 3100000, z: -900000 }, target: { x: -5199900, y: 3100200, z: -899950 } },
      { id: 'P4', source: { x: 100000, y: 50000, z: 6100000 }, target: { x: 100100, y: 50200, z: 6100050 } },
    ])
    expect(issues.some(i => i.includes('Duplicate'))).toBe(true)
  })

  it('passes for 5+ well-spread points', () => {
    const issues = validateCommonPoints([
      { id: 'P1', source: { x: 5000000, y: 3000000, z: -1000000 }, target: { x: 5000100, y: 3000200, z: -999950 } },
      { id: 'P2', source: { x: 4500000, y: -2500000, z: -1200000 }, target: { x: 4500100, y: -2499800, z: -1199950 } },
      { id: 'P3', source: { x: -5200000, y: 3100000, z: -900000 }, target: { x: -5199900, y: 3100200, z: -899950 } },
      { id: 'P4', source: { x: 100000, y: 50000, z: 6100000 }, target: { x: 100100, y: 50200, z: 6100050 } },
      { id: 'P5', source: { x: -2000000, y: -1800000, z: 4500000 }, target: { x: -1999900, y: -1799800, z: 4500050 } },
    ])
    expect(issues).toHaveLength(0)
  })
})

describe('calibrateTransformation', () => {
  // Generate 5 well-spread common points: source → target = pure translation (100, 200, 50)
  const commonPoints: CommonPoint[] = [
    { id: 'P1', source: { x: 5000000, y: 3000000, z: -1000000 }, target: { x: 5000100, y: 3000200, z: -999950 } },
    { id: 'P2', source: { x: 4500000, y: -2500000, z: -1200000 }, target: { x: 4500100, y: -2499800, z: -1199950 } },
    { id: 'P3', source: { x: -5200000, y: 3100000, z: -900000 }, target: { x: -5199900, y: 3100200, z: -899950 } },
    { id: 'P4', source: { x: 100000, y: 50000, z: 6100000 }, target: { x: 100100, y: 50200, z: 6100050 } },
    { id: 'P5', source: { x: -2000000, y: -1800000, z: 4500000 }, target: { x: -1999900, y: -1799800, z: 4500050 } },
  ]

  test('recovers translation parameters from clean data', () => {
    const result = calibrateTransformation(commonPoints)

    expect(result.converged).toBe(true)
    expect(result.parameters.tx).toBeCloseTo(100, 0)
    expect(result.parameters.ty).toBeCloseTo(200, 0)
    expect(result.parameters.tz).toBeCloseTo(50, 0)
  })

  test('produces near-zero RMS for clean data', () => {
    const result = calibrateTransformation(commonPoints)

    expect(result.rmsFit).toBeLessThan(0.001)  // < 1mm
  })

  test('computes parameter standard deviations', () => {
    const result = calibrateTransformation(commonPoints)

    expect(result.parameterStdDevs.tx).toBeGreaterThanOrEqual(0)
    expect(result.parameterStdDevs.ty).toBeGreaterThanOrEqual(0)
    expect(result.parameterStdDevs.tz).toBeGreaterThanOrEqual(0)
    expect(result.parameterStdDevs.rx).toBeGreaterThanOrEqual(0)
  })

  test('computes 7×7 covariance matrix', () => {
    const result = calibrateTransformation(commonPoints)

    expect(result.covariance).toHaveLength(7)
    expect(result.covariance[0]).toHaveLength(7)
    // Diagonal should be non-negative (variances)
    for (let i = 0; i < 7; i++) {
      expect(result.covariance[i][i]).toBeGreaterThanOrEqual(0)
    }
  })

  test('computes per-point residuals', () => {
    const result = calibrateTransformation(commonPoints)

    expect(result.pointResiduals).toHaveLength(5)
    for (const r of result.pointResiduals) {
      expect(r.residualMagnitude).toBeGreaterThanOrEqual(0)
      // Clean data: residuals should be near zero
      expect(r.residualMagnitude).toBeLessThan(0.01)
      expect(r.isOutlier).toBe(false)
    }
  })

  test('estimates local accuracy', () => {
    const result = calibrateTransformation(commonPoints)

    // For clean data, RMS is essentially 0, so estimated accuracy is also ~0.
    // The key assertion is that it's a non-negative number.
    expect(result.estimatedLocalAccuracy).toBeGreaterThanOrEqual(0)
    expect(result.estimatedLocalAccuracy).toBeLessThan(0.01)  // < 1cm for clean data
  })

  test('includes summary', () => {
    const result = calibrateTransformation(commonPoints)

    expect(result.summary).toContain('converged')
    expect(result.summary).toContain('RMS')
    expect(result.summary).toContain('5 points')
  })

  test('throws for fewer than 3 points', () => {
    expect(() => calibrateTransformation([commonPoints[0], commonPoints[1]])).toThrow(
      'At least 3 common points required',
    )
  })

  test('detects outliers when one point has a blunder', () => {
    // Use 8 points so the blunder on point 3 can't be absorbed by parameters
    const eightPoints: CommonPoint[] = [
      { id: 'P1', source: { x: 5000000, y: 3000000, z: -1000000 }, target: { x: 5000100, y: 3000200, z: -999950 } },
      { id: 'P2', source: { x: 4500000, y: -2500000, z: -1200000 }, target: { x: 4500100, y: -2499800, z: -1199950 } },
      { id: 'P3', source: { x: -5200000, y: 3100000, z: -900000 }, target: { x: -5199900, y: 3100200, z: -899950 } },
      { id: 'P4', source: { x: 100000, y: 50000, z: 6100000 }, target: { x: 100100, y: 50200, z: 6100050 } },
      { id: 'P5', source: { x: -2000000, y: -1800000, z: 4500000 }, target: { x: -1999900, y: -1799800, z: 4500050 } },
      { id: 'P6', source: { x: 4800000, y: 2900000, z: -1100000 }, target: { x: 4800100, y: 2900200, z: -1099950 } },
      { id: 'P7', source: { x: -5000000, y: 3200000, z: -800000 }, target: { x: -4999900, y: 3200200, z: -799950 } },
      { id: 'P8', source: { x: 200000, y: 60000, z: 6000000 }, target: { x: 200100, y: 60200, z: 6000050 } },
    ]

    // Add 10m blunder to point 3's target X
    eightPoints[2] = {
      ...eightPoints[2],
      target: { x: eightPoints[2].target.x + 10.0, y: eightPoints[2].target.y, z: eightPoints[2].target.z },
    }

    const result = calibrateTransformation(eightPoints, { outlierThreshold: 2.0 })

    // With 8 points (15 dof) and a 10m blunder, the outlier should stand out
    const outliers = result.pointResiduals.filter(p => p.isOutlier)
    expect(outliers.length).toBeGreaterThan(0)
  })

  test('can remove outliers automatically', () => {
    const eightPoints: CommonPoint[] = [
      { id: 'P1', source: { x: 5000000, y: 3000000, z: -1000000 }, target: { x: 5000100, y: 3000200, z: -999950 } },
      { id: 'P2', source: { x: 4500000, y: -2500000, z: -1200000 }, target: { x: 4500100, y: -2499800, z: -1199950 } },
      { id: 'P3', source: { x: -5200000, y: 3100000, z: -900000 }, target: { x: -5199900, y: 3100200, z: -899950 } },
      { id: 'P4', source: { x: 100000, y: 50000, z: 6100000 }, target: { x: 100100, y: 50200, z: 6100050 } },
      { id: 'P5', source: { x: -2000000, y: -1800000, z: 4500000 }, target: { x: -1999900, y: -1799800, z: 4500050 } },
      { id: 'P6', source: { x: 4800000, y: 2900000, z: -1100000 }, target: { x: 4800100, y: 2900200, z: -1099950 } },
      { id: 'P7', source: { x: -5000000, y: 3200000, z: -800000 }, target: { x: -4999900, y: 3200200, z: -799950 } },
      { id: 'P8', source: { x: 200000, y: 60000, z: 6000000 }, target: { x: 200100, y: 60200, z: 6000050 } },
    ]

    // Massive 50m blunder on point 3
    eightPoints[2] = {
      ...eightPoints[2],
      target: { x: eightPoints[2].target.x + 50.0, y: eightPoints[2].target.y, z: eightPoints[2].target.z },
    }

    const result = calibrateTransformation(eightPoints, {
      removeOutliers: true,
      outlierThreshold: 2.0,
    })

    // The outlier should be detected — either flagged in residuals OR removed via warnings
    const totalOutliers = result.outlierCount + result.warnings.filter(w => w.includes('outlier')).length
    expect(totalOutliers).toBeGreaterThan(0)
    // After removal, the remaining points should fit well (RMS < 1cm)
    expect(result.rmsFit).toBeLessThan(0.01)
  })
})

describe('assessCalibrationQuality', () => {
  test('excellent calibration (<1cm)', () => {
    const q = assessCalibrationQuality(0.005, 5.0)
    expect(q.assessment).toBe('excellent')
    expect(q.improvementFactor).toBeGreaterThan(100)
    expect(q.recommendation).toContain('first-order')
  })

  test('good calibration (<5cm)', () => {
    const q = assessCalibrationQuality(0.03, 5.0)
    expect(q.assessment).toBe('good')
    expect(q.improvementFactor).toBeGreaterThan(20)
  })

  test('acceptable calibration (<20cm)', () => {
    const q = assessCalibrationQuality(0.15, 5.0)
    expect(q.assessment).toBe('acceptable')
  })

  test('poor calibration (>20cm)', () => {
    const q = assessCalibrationQuality(0.50, 5.0)
    expect(q.assessment).toBe('poor')
    expect(q.recommendation).toContain('blunders')
  })

  test('computes improvement factor over national parameters', () => {
    const q = assessCalibrationQuality(0.05, 5.0)
    expect(q.improvementFactor).toBeCloseTo(100, 0)  // 5.0 / 0.05 = 100
  })
})
