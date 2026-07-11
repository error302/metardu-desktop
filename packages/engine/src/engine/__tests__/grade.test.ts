import { gradeFromElevations } from '../grade'

describe('computeGrade', () => {
  it('computes 5% grade for 5m rise over 100m', () => {
    const r = gradeFromElevations({ elev1: 100, elev2: 105, horizontalDistance: 100 })
    expect(r.gradientPercent).toBeCloseTo(5, 4)
  })

  it('computes negative grade for downhill', () => {
    const r = gradeFromElevations({ elev1: 110, elev2: 100, horizontalDistance: 100 })
    expect(r.gradientPercent).toBeCloseTo(-10, 4)
  })

  it('computes ratio correctly', () => {
    const r = gradeFromElevations({ elev1: 0, elev2: 1, horizontalDistance: 100 })
    expect(r.ratio).toBeCloseTo(100, 2) // 1:100
  })

  it('flat ground gives zero grade', () => {
    const r = gradeFromElevations({ elev1: 50, elev2: 50, horizontalDistance: 100 })
    expect(r.gradientPercent).toBeCloseTo(0, 6)
  })

  it('angle in degrees is correct', () => {
    // 45° slope: rise = distance
    const r = gradeFromElevations({ elev1: 0, elev2: 100, horizontalDistance: 100 })
    expect(r.slopeAngleDeg).toBeCloseTo(45, 2)
  })
})
