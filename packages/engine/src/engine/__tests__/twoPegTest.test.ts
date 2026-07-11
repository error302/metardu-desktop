import { twoPegTest } from '../twoPegTest'

describe('twoPegTest', () => {
  it('passes when collimation error is within limit', () => {
    // A1=1.500, B1=1.497 → diff1=+0.003
    // A2=2.500, B2=2.497 → diff2=+0.003
    // collimationError=(0.003-0.003)/2=0 → 0mm/100m → PASS
    const r = twoPegTest({ A1: 1.500, B1: 1.497, A2: 2.500, B2: 2.497 })
    expect(r.pass).toBe(true)
  })

  it('fails when collimation error exceeds 10mm/100m', () => {
    // A1=1.500, B1=1.480 → diff1=+0.020
    // A2=1.500, B2=1.520 → diff2=-0.020
    // collimationError=0.020, per100m=0.020, *1000=20 > 10 → FAIL
    const r = twoPegTest({ A1: 1.500, B1: 1.480, A2: 1.500, B2: 1.520, baselineMeters: 100 })
    expect(r.pass).toBe(false)
  })

  it('true difference is average of both observed differences', () => {
    const r = twoPegTest({ A1: 1.600, B1: 1.400, A2: 1.610, B2: 1.412 })
    expect(r.trueDiff).toBeCloseTo((r.obsDiff1 + r.obsDiff2) / 2, 6)
  })

  it('collimation error is half the difference of observed diffs', () => {
    const r = twoPegTest({ A1: 1.600, B1: 1.400, A2: 1.610, B2: 1.412 })
    expect(r.collimationError).toBeCloseTo((r.obsDiff1 - r.obsDiff2) / 2, 6)
  })

  it('zero collimation error when both positions give same difference', () => {
    const r = twoPegTest({ A1: 1.500, B1: 1.300, A2: 1.800, B2: 1.600 })
    expect(r.collimationError).toBeCloseTo(0, 6)
    expect(r.pass).toBe(true)
  })

  it('scales collimation per 100m correctly', () => {
    const r = twoPegTest({ A1: 1.500, B1: 1.490, A2: 1.500, B2: 1.492, baselineMeters: 50 })
    expect(r.collimationPer100m).toBeCloseTo(r.collimationError * 2, 6)
  })
})
