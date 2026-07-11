import { describe, it, expect } from '@jest/globals'
import { getUTMZone, getHemisphere } from '../utmZones'

describe('utmZones', () => {
  it('returns zone 37 for Kenya (36-42°E)', () => {
    expect(getUTMZone(37)).toBe(37)
    expect(getUTMZone(38)).toBe(37)
    expect(getUTMZone(39)).toBe(37)
  })
  it('returns zone 36 for 30-36°E', () => {
    expect(getUTMZone(35)).toBe(36)
    expect(getUTMZone(30)).toBe(36)
  })
  it('returns zone 31 for 0°', () => {
    expect(getUTMZone(0)).toBe(31)
  })
  it('returns N for positive latitude, S for negative', () => {
    expect(getHemisphere(1)).toBe('N')
    expect(getHemisphere(-1)).toBe('S')
  })
})
