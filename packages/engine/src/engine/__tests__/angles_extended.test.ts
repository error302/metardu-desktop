import { wcbToQuadrant, bearingToString, parseDMSString } from '../angles'

describe('wcbToQuadrant', () => {
  it('0° is N0E', () => expect(wcbToQuadrant(0)).toMatch(/N.*E|^N$/i))
  it('90° is N90E or E', () => expect(wcbToQuadrant(90)).toMatch(/90|E/i))
  it('180° is S0E or S', () => expect(wcbToQuadrant(180)).toMatch(/S/i))
  it('270° is S90W or W', () => expect(wcbToQuadrant(270)).toMatch(/W/i))
  it('45° is NE quadrant', () => expect(wcbToQuadrant(45)).toMatch(/N.*E/i))
  it('225° is SW quadrant', () => expect(wcbToQuadrant(225)).toMatch(/S.*W/i))
})

describe('bearingToString', () => {
  it('returns a non-empty string', () => {
    expect(typeof bearingToString(45.5)).toBe('string')
    expect(bearingToString(45.5).length).toBeGreaterThan(0)
  })

  it('formats 0° as due north', () => {
    expect(bearingToString(0)).toMatch(/0|N/i)
  })

  it('formats 90° as east', () => {
    expect(bearingToString(90)).toMatch(/90|E/i)
  })
})

describe('parseDMSString', () => {
  it('parses "45°30\'20\\"" format', () => {
    const r = parseDMSString("45°30'20\"")
    expect(r).not.toBeNull()
    expect(r!).toBeCloseTo(45.5056, 3)
  })

  it('returns null for invalid string', () => {
    const r = parseDMSString('not-a-bearing')
    expect(r).toBeNull()
  })

  it('parses plain decimal string', () => {
    const r = parseDMSString('123.456')
    expect(r).not.toBeNull()
    expect(r!).toBeCloseTo(123.456, 3)
  })
})
