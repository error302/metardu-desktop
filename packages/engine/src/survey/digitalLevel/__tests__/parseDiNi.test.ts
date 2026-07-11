import { parseDiNi } from '../parseDiNi'

describe('parseDiNi', () => {
  test('parses DiNi RAW format (pipe-delimited)', () => {
    const content = [
      'Start-No.|  1',
      'End-No.: |99999',
      'Staff1:  |  10001',
      'Staff2:  |  10002',
      'Operator: J. KAMAU',
      'Date: 2024-01-15',
      'Inst: DiNi 22',
      '1|BM1          |  1.65432|  25.432|BM',
      '2|TP1          |  0.87654|  30.121|FS',
      '3|TP1          |  1.54321|  28.500|BS',
      '4|BM2          |  0.76543|  32.100|FS',
    ].join('\n')

    const result = parseDiNi(content, 'test_raw.dat')
    expect(result.format).toBe('dini')
    expect(result.readings).toHaveLength(4)
    expect(result.metadata.instrument).toBe('DiNi 22')
    expect(result.metadata.operator).toBe('J. KAMAU')
    expect(result.metadata.date).toBe('2024-01-15')
    expect(result.metadata.staffA).toBe('10001')

    // First reading
    expect(result.readings[0].stationId).toBe('BM1')
    expect(result.readings[0].staffReading).toBeCloseTo(1.65432, 5)
    expect(result.readings[0].distance).toBeCloseTo(25.432, 3)
    expect(result.readings[0].type).toBe('BS')

    // FS reading
    expect(result.readings[1].type).toBe('FS')
  })

  test('parses DiNi DAT format (CSV)', () => {
    const content = [
      'BM1,1.65432,25.432,BS',
      'TP1,0.87654,30.121,FS',
      'TP1,1.54321,28.500,BS',
      'BM2,0.76543,32.100,FS',
    ].join('\n')

    const result = parseDiNi(content, 'test_dat.csv')
    expect(result.format).toBe('dini')
    expect(result.readings).toHaveLength(4)
    expect(result.readings[0].stationId).toBe('BM1')
    expect(result.readings[0].staffReading).toBeCloseTo(1.65432, 5)
    expect(result.readings[0].type).toBe('BS')
    expect(result.readings[1].type).toBe('FS')
  })

  test('builds observations from BS/FS pairs', () => {
    const content = [
      'BM1,1.50000,30.000,BS',
      'TP1,0.80000,30.000,FS',
      'TP1,1.40000,25.000,BS',
      'BM2,0.70000,25.000,FS',
    ].join('\n')

    const result = parseDiNi(content, 'test.csv')
    expect(result.observations).toHaveLength(2)
    // First obs: BM1 -> TP1, heightDiff = 1.5 - 0.8 = 0.7
    expect(result.observations[0].fromId).toBe('BM1')
    expect(result.observations[0].toId).toBe('TP1')
    expect(result.observations[0].heightDifference).toBeCloseTo(0.7, 5)
    expect(result.observations[0].weight).toBeGreaterThan(0)
  })

  test('handles empty content gracefully', () => {
    const result = parseDiNi('', 'empty.dat')
    expect(result.format).toBe('dini')
    expect(result.readings).toHaveLength(0)
    expect(result.observations).toHaveLength(0)
  })

  test('handles content with only headers and no data rows', () => {
    const content = [
      'Start-No.|  1',
      'End-No.: |99999',
    ].join('\n')
    const result = parseDiNi(content, 'headers_only.dat')
    expect(result.readings).toHaveLength(0)
    expect(result.observations).toHaveLength(0)
  })

  test('weights are based on 1/d^2 where d is in km', () => {
    const content = [
      'BM1,1.50000,1000.000,BS',
      'TP1,0.80000,1000.000,FS',
    ].join('\n')
    const result = parseDiNi(content, 'test_weight.csv')
    expect(result.observations).toHaveLength(1)
    // distance = 1000m = 1km, weight = 1/(1^2) = 1
    expect(result.observations[0].weight).toBeCloseTo(1.0, 2)
  })

  test('IS type readings do not create observations', () => {
    const content = [
      'BM1,1.50000,30.000,BS',
      'TP1,1.20000,30.000,IS',
      'TP1,0.80000,30.000,FS',
    ].join('\n')
    const result = parseDiNi(content, 'test_is.csv')
    expect(result.readings).toHaveLength(3)
    expect(result.observations).toHaveLength(1) // only BS+FS pair
  })
})
