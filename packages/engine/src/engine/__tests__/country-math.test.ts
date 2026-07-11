import {
  getTraverseValidation,
  formatAreaByCountry,
  getSlopeRuleForCountry,
  getBeaconRuleForCountry,
  getFieldNoteRuleForCountry,
  getSurveyorReportReqForCountry,
  getCountrySurveySummary,
} from '../country-math'

describe('getTraverseValidation', () => {
  it('Kenya urban: 1:20,000 required', () => {
    const r = getTraverseValidation({
      country: 'kenya',
      environment: 'urban',
      linearError: 0.5,
      totalDistance: 10_000,
    })
    expect(r.requiredRatio).toBe(20_000)
    expect(r.isAcceptable).toBe(true)
    expect(r.regulation).toContain('Kenya')
  })

  it('Kenya urban: FAILS if < 1:20,000', () => {
    const r = getTraverseValidation({
      country: 'kenya',
      environment: 'urban',
      linearError: 1.0,
      totalDistance: 10_000,
    })
    expect(r.isAcceptable).toBe(false)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('Kenya rural: 1:10,000 required', () => {
    const r = getTraverseValidation({
      country: 'kenya',
      environment: 'rural',
      linearError: 1.0,
      totalDistance: 10_000,
    })
    expect(r.requiredRatio).toBe(10_000)
    expect(r.isAcceptable).toBe(true)
  })

  it('US third_order_class_i: 1:10,000 required', () => {
    const r = getTraverseValidation({
      country: 'us',
      environment: 'third_order_i',
      linearError: 1.0,
      totalDistance: 10_000,
    })
    expect(r.requiredRatio).toBe(10_000)
    expect(r.isAcceptable).toBe(true)
    expect(r.regulation).toContain('USACE')
  })

  it('US alta_acsm: 1:15,000 required', () => {
    const r = getTraverseValidation({
      country: 'us',
      environment: 'alta_acsm',
      linearError: 1.0,
      totalDistance: 15_000,
    })
    expect(r.requiredRatio).toBe(15_000)
    expect(r.isAcceptable).toBe(true)
  })

  it('UK cadastral: 1:10,000 required', () => {
    const r = getTraverseValidation({
      country: 'uk',
      environment: 'default',
      linearError: 1.0,
      totalDistance: 10_000,
    })
    expect(r.requiredRatio).toBe(10_000)
    expect(r.regulation).toContain('HMLR')
  })

  it('Bahrain detail: 1:5,000 required', () => {
    const r = getTraverseValidation({
      country: 'bahrain',
      environment: 'detail',
      linearError: 1.0,
      totalDistance: 5_000,
    })
    expect(r.requiredRatio).toBe(5_000)
    expect(r.isAcceptable).toBe(true)
  })

  it('returns zero surplus for borderline pass', () => {
    const r = getTraverseValidation({
      country: 'kenya',
      environment: 'rural',
      linearError: 1.0,
      totalDistance: 10_000,
    })
    expect(r.surplusPercent).toBeCloseTo(0, 0)
  })

  it('returns positive surplus for comfortable pass', () => {
    const r = getTraverseValidation({
      country: 'kenya',
      environment: 'rural',
      linearError: 0.5,
      totalDistance: 10_000,
    })
    expect(r.surplusPercent).toBeGreaterThan(0)
  })
})

describe('formatAreaByCountry', () => {
  it('Kenya: ≤1ha → 4 decimal places', () => {
    const r = formatAreaByCountry('kenya', 5_000) // 0.5 ha
    expect(r.decimalPlaces).toBe(4)
    expect(r.formattedHa).toBe('0.5000')
  })

  it('Kenya: 1–10ha → 3 decimal places', () => {
    const r = formatAreaByCountry('kenya', 50_000) // 5 ha
    expect(r.decimalPlaces).toBe(3)
    expect(r.formattedHa).toBe('5.000')
  })

  it('Kenya: 10–1,000ha → 2 decimal places', () => {
    const r = formatAreaByCountry('kenya', 500_000) // 50 ha
    expect(r.decimalPlaces).toBe(2)
    expect(r.formattedHa).toBe('50.00')
  })

  it('Kenya: >1,000ha → 1 decimal place', () => {
    const r = formatAreaByCountry('kenya', 20_000_000) // 2,000 ha
    expect(r.decimalPlaces).toBe(1)
    expect(r.formattedHa).toBe('2000.0')
  })

  it('US: always 4 decimal places (ALTA)', () => {
    const r = formatAreaByCountry('us', 5000)
    expect(r.decimalPlaces).toBe(4)
    expect(r.regulation).toContain('ALTA')
  })

  it('warns for extremely small parcel', () => {
    const r = formatAreaByCountry('kenya', 0.5)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('returns hectares and sqMetres correctly', () => {
    const r = formatAreaByCountry('other', 10_000)
    expect(r.hectares).toBeCloseTo(1.0, 3)
    expect(r.sqMetres).toBe(10_000)
  })
})

describe('getSlopeRuleForCountry', () => {
  it('Kenya: max 10° single-face slope', () => {
    const rule = getSlopeRuleForCountry('kenya')
    expect(rule.maxSlopeSingleFace).toBe(10)
    expect(rule.requiresTwoFaces(15)).toBe(true)
    expect(rule.requiresTwoFaces(5)).toBe(false)
  })

  it('US: requires slope correction', () => {
    const rule = getSlopeRuleForCountry('us')
    expect(rule.tempCorrection).toBe(true)
    expect(rule.pressureCorrection).toBe(true)
    expect(rule.sagCorrection).toBe(true)
  })

  it('warnings generated for steep slope', () => {
    const rule = getSlopeRuleForCountry('kenya')
    const warnings = rule.warnings(15)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain('both faces')
  })
})

describe('getBeaconRuleForCountry', () => {
  it('Kenya: must reference underground', () => {
    const rule = getBeaconRuleForCountry('kenya')
    expect(rule.mustReferenceUnderground).toBe(true)
  })

  it('Australia: must reference underground', () => {
    const rule = getBeaconRuleForCountry('australia')
    expect(rule.mustReferenceUnderground).toBe(true)
  })

  it('US: verify with known points', () => {
    const rule = getBeaconRuleForCountry('us')
    expect(rule.mustReferenceUnderground).toBe(false)
  })
})

describe('getFieldNoteRuleForCountry', () => {
  it('all countries: no erasures', () => {
    const countries = ['kenya', 'us', 'uk', 'bahrain', 'new_zealand', 'australia'] as const
    for (const c of countries) {
      const rule = getFieldNoteRuleForCountry(c)
      expect(rule.noErasures).toBe(true)
    }
  })
})

describe('getSurveyorReportReqForCountry', () => {
  it('US: report required with counter-sign', () => {
    const req = getSurveyorReportReqForCountry('us')
    expect(req.required).toBe(true)
    expect(req.counterSignRequired).toBe(true)
    expect(req.mustInclude.length).toBeGreaterThan(0)
  })

  it('UK: report required without counter-sign', () => {
    const req = getSurveyorReportReqForCountry('uk')
    expect(req.required).toBe(true)
    expect(req.counterSignRequired).toBe(false)
  })

  it('Kenya: report required', () => {
    const req = getSurveyorReportReqForCountry('kenya')
    expect(req.required).toBe(true)
  })
})

describe('getCountrySurveySummary', () => {
  it('returns complete summary for Kenya', () => {
    const s = getCountrySurveySummary('kenya')
    expect(s.country).toBe('kenya')
    expect(s.name).toBe('Kenya')
    expect(s.datum).toBe('Arc 1960')
    expect(s.defaultTraverseRatio).toBe(10_000)
    expect(s.slopeCorrection).toBe(true)
    expect(s.surveyorReport).toBe(true)
    expect(s.topographicConfig.contourInterval).toBe(2.0)
    expect(s.topographicConfig.defaultScale).toBe('1:2,500')
  })

  it('returns complete summary for US', () => {
    const s = getCountrySurveySummary('us')
    expect(s.country).toBe('us')
    expect(s.datum).toBe('NAD83(2011)')
    expect(s.defaultTraverseRatio).toBe(10_000)
    expect(s.topographicConfig.rmseClass).toBe(1)
  })

  it('returns complete summary for Bahrain', () => {
    const s = getCountrySurveySummary('bahrain')
    expect(s.datum).toBe('Ain Al-Abd 1970')
    expect(s.topographicConfig.defaultScale).toBe('1:5,000')
  })
})
