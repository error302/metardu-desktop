import { compareDesignVsAsBuilt, computeStatistics, parseAsBuiltCSV, TOLERANCE_BANDS, generateAsBuiltCertificate } from '../asBuiltSurvey'

describe('computeStatistics', () => {
  it('computes mean, stdDev, rms for known values', () => {
    const stats = computeStatistics([2, -2, 4, -4, 0])
    expect(stats.mean).toBe(0)
    expect(stats.rms).toBeCloseTo(2.828, 2)
    expect(stats.max).toBe(4)
    expect(stats.min).toBe(-4)
  })

  it('handles empty array', () => {
    const stats = computeStatistics([])
    expect(stats.mean).toBe(0)
    expect(stats.stdDev).toBe(0)
    expect(stats.rms).toBe(0)
  })

  it('handles single value', () => {
    const stats = computeStatistics([5])
    expect(stats.mean).toBe(5)
    expect(stats.stdDev).toBe(0)
    expect(stats.rms).toBe(5)
  })
})

describe('compareDesignVsAsBuilt', () => {
  const design = [
    { chainage: 0, designLevel: 100 },
    { chainage: 100, designLevel: 101 },
    { chainage: 200, designLevel: 102 },
    { chainage: 300, designLevel: 101 },
    { chainage: 400, designLevel: 100 },
  ]

  it('100% pass rate for exact match', () => {
    const asBuilt = design.map(d => ({ chainage: d.chainage, surveyedLevel: d.designLevel }))
    const result = compareDesignVsAsBuilt(design, asBuilt, TOLERANCE_BANDS.paved)
    expect(result.summary.passRate).toBe(100)
    expect(result.summary.isCompliant).toBe(true)
    expect(result.comparisons.length).toBe(5)
  })

  it('detects deviations correctly', () => {
    const asBuilt = [
      { chainage: 0, surveyedLevel: 100.050 },  // +50mm — fail (tol ±25mm)
      { chainage: 100, surveyedLevel: 100.990 },  // -10mm — pass
      { chainage: 200, surveyedLevel: 102.020 },  // +20mm — pass
      { chainage: 300, surveyedLevel: 101.030 },  // +30mm — fail
      { chainage: 400, surveyedLevel: 100.000 },  // 0mm — pass
    ]
    const result = compareDesignVsAsBuilt(design, asBuilt, TOLERANCE_BANDS.paved)
    expect(result.summary.passCount).toBe(3)
    expect(result.summary.failCount).toBe(2)
    expect(result.summary.passRate).toBe(60)
    expect(result.summary.isCompliant).toBe(false)
  })

  it('95% threshold for compliance', () => {
    const n = 20
    const asBuilt = design.flatMap(d => {
      // 19 pass + 1 fail = 95% exactly (boundary)
      return Array.from({ length: 4 }, (_, i) => ({
        chainage: d.chainage + i * 0.01,
        surveyedLevel: d.designLevel + (i === 3 && d.chainage === 200 ? 0.05 : 0),
      }))
    })
    const result = compareDesignVsAsBuilt(
      design.flatMap(d => Array.from({ length: 4 }, (_, i) => ({ chainage: d.chainage + i * 0.01, designLevel: d.designLevel }))),
      asBuilt, TOLERANCE_BANDS.paved
    )
    expect(result.summary.isCompliant).toBe(true)
  })

  it('uses correct tolerance bands', () => {
    const asBuilt = [{ chainage: 0, surveyedLevel: 100.040 }] // +40mm
    const pavedResult = compareDesignVsAsBuilt([{ chainage: 0, designLevel: 100 }], asBuilt, TOLERANCE_BANDS.paved)
    expect(pavedResult.summary.failCount).toBe(1) // 40 > 25

    const gravelResult = compareDesignVsAsBuilt([{ chainage: 0, designLevel: 100 }], asBuilt, TOLERANCE_BANDS.gravel)
    expect(gravelResult.summary.passCount).toBe(1) // 40 < 50
  })

  it('handles empty as-built data', () => {
    const result = compareDesignVsAsBuilt(design, [], TOLERANCE_BANDS.paved)
    expect(result.summary.totalPoints).toBe(0)
    expect(result.summary.certificationReady).toBe(false)
  })

  it('computes RMS error correctly', () => {
    const asBuilt = design.map(d => ({ chainage: d.chainage, surveyedLevel: d.designLevel + 0.010 }))
    const result = compareDesignVsAsBuilt(design, asBuilt, TOLERANCE_BANDS.paved)
    expect(result.summary.rmsError).toBeCloseTo(10, 0) // all 10mm deviations
  })
})

describe('parseAsBuiltCSV', () => {
  it('parses valid CSV', () => {
    const csv = `chainage,level,easting,northing\n0,100.025,123456.789,9876543.210\n20,100.032,123466.521,9876550.102`
    const points = parseAsBuiltCSV(csv)
    expect(points).toHaveLength(2)
    expect(points[0].chainage).toBe(0)
    expect(points[0].surveyedLevel).toBe(100.025)
    expect(points[0].surveyedEasting).toBe(123456.789)
  })

  it('skips invalid rows', () => {
    const csv = `chainage,level\n0,100\nbad,Data\n20,101`
    const points = parseAsBuiltCSV(csv)
    expect(points).toHaveLength(2)
  })

  it('handles empty input', () => {
    expect(parseAsBuiltCSV('')).toHaveLength(0)
    expect(parseAsBuiltCSV('chainage,level')).toHaveLength(0)
  })
})

describe('generateAsBuiltCertificate', () => {
  it('generates certificate with correct number format', () => {
    const result = compareDesignVsAsBuilt(
      [{ chainage: 0, designLevel: 100 }, { chainage: 100, designLevel: 101 }],
      [{ chainage: 0, surveyedLevel: 100.005 }, { chainage: 100, surveyedLevel: 100.998 }],
      TOLERANCE_BANDS.paved
    )
    const cert = generateAsBuiltCertificate({
      projectName: 'Test Road',
      roadName: 'Test',
      roadClass: 'B',
      chainageStart: 0,
      chainageEnd: 100,
      surveyorName: 'J. Doe',
      surveyorLicense: 'ISK-1234',
      date: '2026-01-01',
      result,
    })
    expect(cert.certificateNumber).toMatch(/^ABC-\d{4}-\d{3}$/)
    expect(cert.surveyorName).toBe('J. Doe')
    expect(cert.result.passRate).toBe(100)
  })
})
