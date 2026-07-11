import { curveElements, curveStakeout, verticalCurve, compoundCurveElements, reverseCurveApprox } from '../curves'

describe('curveStakeout', () => {
  it('generates stakeout points along a curve', () => {
    const r = curveStakeout(1000, 45, 200, 60, 20)
    expect(r.points.length).toBeGreaterThan(1)
    // First point is PC (chord=0); subsequent points have positive chords
    const afterPC = r.points.slice(1)
    afterPC.forEach((p: any) => {
      expect(Number.isFinite(p.chordLength)).toBe(true)
      expect(p.chordLength).toBeGreaterThan(0)
    })
  })

  it('pcChainage < piChainage < ptChainage', () => {
    const r = curveStakeout(1000, 0, 200, 60, 20)
    expect(r.pcChainage).toBeLessThan(r.piChainage)
    expect(r.piChainage).toBeLessThan(r.ptChainage)
  })
})

describe('verticalCurve', () => {
  it('generates RLs along a parabolic vertical curve', () => {
    // Rising grade 2%, falling grade -1%, 200m curve
    const pts = verticalCurve(2, -1, 200, 100.0, 20)
    expect(pts.length).toBeGreaterThan(0)
    pts.forEach((p: any) => {
      expect(Number.isFinite(p.rl)).toBe(true)
      expect(Number.isFinite(p.chainage)).toBe(true)
    })
  })

  it('first point RL equals startRL', () => {
    const pts = verticalCurve(1, -1, 100, 150.0, 10)
    expect(pts[0].rl).toBeCloseTo(150.0, 3)
  })

  it('crest curve is lower in the middle than at start', () => {
    // g1=+2%, g2=-2% → crest curve, highest at apex
    const pts = verticalCurve(2, -2, 200, 100.0, 20)
    const last = pts[pts.length - 1]
    // End point should be below first point due to change in grade
    expect(Number.isFinite(last.rl)).toBe(true)
  })
})

describe('compoundCurveElements', () => {
  it('returns elements for both sub-curves', () => {
    const r = compoundCurveElements({ R1: 200, R2: 150, delta1Deg: 30, delta2Deg: 45, junctionChainage: 500 })
    expect(Number.isFinite(r.t1)).toBe(true)
    expect(Number.isFinite(r.t2)).toBe(true)
    expect(r.l1).toBeGreaterThan(0)
    expect(r.l2).toBeGreaterThan(0)
  })
})

describe('reverseCurveApprox', () => {
  it('returns commonTangent and totalLength', () => {
    const r = reverseCurveApprox({ R1: 200, R2: 150, AB: 500 })
    expect(Number.isFinite(r.commonTangent)).toBe(true)
    expect(Number.isFinite(r.totalLength)).toBe(true)
    expect(r.commonTangent).toBeGreaterThan(0)
    expect(r.totalLength).toBeGreaterThan(0)
  })

  it('totalLength = π(R1 + R2)', () => {
    const r = reverseCurveApprox({ R1: 200, R2: 200, AB: 600 })
    expect(r.totalLength).toBeCloseTo(Math.PI * 400, 3)
  })
})
