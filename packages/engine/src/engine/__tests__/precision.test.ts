import { describe, it, expect } from '@jest/globals'
import { formatCoordinate, formatAreaSqm, formatAreaHa } from '../precision'

describe('precision', () => {
  it('formats coordinate with 3 decimals', () => {
    const result = formatCoordinate(123.456789)
    expect(result).toContain('123.457')
  })
  it('formats area in m²', () => {
    const result = formatAreaSqm(12345.678)
    expect(result).toContain('12345')
  })
  it('formats area in hectares', () => {
    const result = formatAreaHa(1.23456)
    expect(result).toContain('1.234')
  })
})
