import { tacheometryReduction } from '../tacheometry'

const STD = { K: 100, C: 0 }

describe('tacheometryReduction', () => {
  it('horizontal sight (0° vertical angle) gives D = K*S', () => {
    const r = tacheometryReduction({ ...STD, instrumentHeight: 1.5, upper: 1.800, middle: 1.500, lower: 1.200, verticalAngleDeg: 0 })
    expect(r.S).toBeCloseTo(0.6, 6)
    expect(r.horizontalDistance).toBeCloseTo(60, 3)  // 100 × 0.6
    expect(r.verticalDistance).toBeCloseTo(0, 6)
  })

  it('staff intercept S = upper - lower', () => {
    const r = tacheometryReduction({ ...STD, instrumentHeight: 1.5, upper: 2.100, middle: 1.600, lower: 1.100, verticalAngleDeg: 5 })
    expect(r.S).toBeCloseTo(1.0, 6)
  })

  it('RL of staff station = HI + V - middle', () => {
    const HI = 105.0
    const r = tacheometryReduction({ ...STD, instrumentHeight: HI, upper: 1.800, middle: 1.500, lower: 1.200, verticalAngleDeg: 10 })
    expect(r.staffStationRL).toBeCloseTo(HI + r.verticalDistance - 1.500, 4)
  })

  it('positive vertical angle gives positive V (elevated sight)', () => {
    const r = tacheometryReduction({ ...STD, instrumentHeight: 1.5, upper: 1.600, middle: 1.400, lower: 1.200, verticalAngleDeg: 15 })
    expect(r.verticalDistance).toBeGreaterThan(0)
  })

  it('negative vertical angle gives negative V (depressed sight)', () => {
    const r = tacheometryReduction({ ...STD, instrumentHeight: 1.5, upper: 1.600, middle: 1.400, lower: 1.200, verticalAngleDeg: -10 })
    expect(r.verticalDistance).toBeLessThan(0)
  })

  it('Basak stadia: K=100, C=0, S=1.234, θ=8°30\'', () => {
    // D = 100 × 1.234 × cos²(8.5°) ≈ 120.81m
    const r = tacheometryReduction({ K: 100, C: 0, instrumentHeight: 1.5, upper: 2.117, middle: 1.5, lower: 0.883, verticalAngleDeg: 8.5 })
    expect(r.horizontalDistance).toBeCloseTo(120.5, 0)
  })
})
