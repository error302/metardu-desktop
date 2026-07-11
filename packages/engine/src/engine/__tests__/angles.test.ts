import {
  toRadians, toDegrees, normalizeBearing,
  dmsToDecimal, decimalToDMS, backBearing, angularMisclosure
} from '../angles'

describe('toRadians / toDegrees', () => {
  it('converts 180° to π', () => expect(toRadians(180)).toBeCloseTo(Math.PI, 10))
  it('converts 90° to π/2', () => expect(toRadians(90)).toBeCloseTo(Math.PI / 2, 10))
  it('converts π back to 180°', () => expect(toDegrees(Math.PI)).toBeCloseTo(180, 10))
  it('round-trips correctly', () => expect(toDegrees(toRadians(123.456))).toBeCloseTo(123.456, 8))
})

describe('normalizeBearing', () => {
  it('keeps 0–360 values unchanged', () => expect(normalizeBearing(45)).toBeCloseTo(45, 6))
  it('wraps negative bearings', () => expect(normalizeBearing(-90)).toBeCloseTo(270, 6))
  it('wraps bearings > 360', () => expect(normalizeBearing(450)).toBeCloseTo(90, 6))
  it('360 normalizes to 0', () => expect(normalizeBearing(360)).toBeCloseTo(0, 6))
})

describe('backBearing', () => {
  it('0° → 180°', () => expect(backBearing(0)).toBeCloseTo(180, 6))
  it('90° → 270°', () => expect(backBearing(90)).toBeCloseTo(270, 6))
  it('180° → 0°', () => expect(backBearing(180)).toBeCloseTo(0, 6))
  it('270° → 90°', () => expect(backBearing(270)).toBeCloseTo(90, 6))
  it('45° → 225°', () => expect(backBearing(45)).toBeCloseTo(225, 6))
})

describe('dmsToDecimal', () => {
  it('converts 90°0\'0" to 90', () =>
    expect(dmsToDecimal({ degrees: 90, minutes: 0, seconds: 0, direction: 'E' })).toBeCloseTo(90, 6))
  it('converts 1°30\'0" to 1.5', () =>
    expect(dmsToDecimal({ degrees: 1, minutes: 30, seconds: 0, direction: 'N' })).toBeCloseTo(1.5, 6))
  it('converts 45°30\'36" ≈ 45.51°', () =>
    expect(dmsToDecimal({ degrees: 45, minutes: 30, seconds: 36, direction: 'N' })).toBeCloseTo(45.51, 4))
})

describe('decimalToDMS', () => {
  it('converts 1.5° → 1°30\'0"', () => {
    const r = decimalToDMS(1.5, false)
    expect(r.degrees).toBe(1)
    expect(r.minutes).toBe(30)
    expect(r.seconds).toBeCloseTo(0, 4)
  })

  it('round-trips decimal → DMS → decimal', () => {
    const original = 123.4567
    const dms = decimalToDMS(original, false)
    const back = dmsToDecimal({ ...dms, direction: 'N' })
    expect(back).toBeCloseTo(original, 4)
  })
})

describe('angularMisclosure', () => {
  it('zero misclosure for exact closed traverse', () => {
    // 4-station traverse: expected sum = (4-2)×180 = 360°
    const r = angularMisclosure(360.0, 4)
    expect(r.misclosure).toBeCloseTo(0, 6)
  })

  it('positive misclosure when sum exceeds theoretical', () => {
    // Observed 361° vs expected 360°
    const r = angularMisclosure(361.0, 4)
    expect(r.misclosure).toBeCloseTo(1.0, 4)
  })

  it('correction per station = -misclosure / n', () => {
    const r = angularMisclosure(362.0, 4)
    expect(r.correctionPerStation).toBeCloseTo(-0.5, 4)
  })
})
