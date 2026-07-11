/**
 * Tests for chainageCalculator — Kenya road chainage formatting/parsing
 *
 * These tests cover the pure-function parts (formatChainage, parseChainage,
 * findAssetsNearChainage) which don't require OpenLayers. The geometry-
 * based functions (calculateChainage, generateChainageTicks) need OL
 * LineString instances and are skipped here.
 */

import { formatChainage, parseChainage, findAssetsNearChainage } from '../chainageCalculator'

describe('formatChainage', () => {
  it('formats a whole-meter chainage as KM XX+XXX', () => {
    // The implementation uses a specific padding/formatting convention.
    // We test the contract: the output starts with "KM " and contains "+".
    const result = formatChainage(14420)
    expect(result).toMatch(/^KM \d+\+\d+/)
  })

  it('formats a sub-kilometer chainage', () => {
    const result = formatChainage(350)
    expect(result).toMatch(/^KM 0\+/)
  })

  it('formats zero chainage', () => {
    const result = formatChainage(0)
    expect(result).toMatch(/^KM 0\+/)
  })

  it('formats a large chainage (over 100km)', () => {
    const result = formatChainage(123456)
    expect(result).toMatch(/^KM 123\+/)
  })

  it('always includes the + separator between km and m', () => {
    expect(formatChainage(1000)).toContain('+')
    expect(formatChainage(0)).toContain('+')
    expect(formatChainage(99999)).toContain('+')
  })
})

describe('parseChainage', () => {
  it('parses a standard KM XX+XXX label', () => {
    expect(parseChainage('KM 14+420')).toBe(14420)
  })

  it('parses a label without the KM prefix', () => {
    expect(parseChainage('14+420')).toBe(14420)
  })

  it('parses a lowercase km prefix', () => {
    expect(parseChainage('km 14+420')).toBe(14420)
  })

  it('parses a fractional chainage', () => {
    expect(parseChainage('1+234.56')).toBeCloseTo(1234.56, 5)
  })

  it('parses a plain number', () => {
    expect(parseChainage('14420')).toBe(14420)
  })

  it('returns null for an unparseable string', () => {
    expect(parseChainage('not-a-chainage')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseChainage('')).toBeNull()
  })

  it('handles leading/trailing whitespace', () => {
    expect(parseChainage('  KM 14+420  ')).toBe(14420)
  })
})

describe('findAssetsNearChainage', () => {
  const assets = [
    { chainage: 1000, name: 'Bridge A' },
    { chainage: 2000, name: 'Culvert B' },
    { chainage: 3000, name: 'Bridge C' },
    { chainage: 5000, name: 'Sign D' },
  ]

  it('finds assets within the default 100m range', () => {
    const results = findAssetsNearChainage(assets, 2050)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Culvert B')
    expect(results[0].distanceFromTarget).toBe(50)
  })

  it('finds multiple assets with a larger range', () => {
    const results = findAssetsNearChainage(assets, 2000, 1500)
    expect(results).toHaveLength(3)
    expect(results.map(r => r.name).sort()).toEqual(['Bridge A', 'Bridge C', 'Culvert B'])
  })

  it('returns an empty array when no assets are in range', () => {
    const results = findAssetsNearChainage(assets, 10000, 100)
    expect(results).toHaveLength(0)
  })

  it('includes the distanceFromTarget field', () => {
    const results = findAssetsNearChainage(assets, 1950, 100)
    expect(results[0].distanceFromTarget).toBe(50)
  })

  it('preserves the original asset properties', () => {
    const results = findAssetsNearChainage(assets, 1000, 100)
    expect(results[0]).toMatchObject({ chainage: 1000, name: 'Bridge A' })
  })

  it('handles an empty assets array', () => {
    const results = findAssetsNearChainage([], 1000, 100)
    expect(results).toHaveLength(0)
  })
})
