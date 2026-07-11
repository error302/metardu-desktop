import { parseTopconDL } from '../parseTopconDL'

describe('parseTopconDL', () => {
  test('parses space-separated Topcon DL format', () => {
    const content = [
      'Topcon DL-102',
      'Job: JK-2024-001',
      'Operator: J. KAMAU',
      'Date: 2024-01-15',
      'BM1  1.65432  25.4  BS',
      'TP1  0.87654  30.1  FS',
      'TP1  1.54321  28.5  BS',
      'BM2  0.76543  32.1  FS',
    ].join('\n')

    const result = parseTopconDL(content, 'test_dl.dat')
    expect(result.format).toBe('topcon-dl')
    expect(result.readings).toHaveLength(4)
    expect(result.metadata.instrument).toBeDefined()
    expect(result.metadata.operator).toBe('J. KAMAU')
    expect(result.metadata.jobNumber).toBe('JK-2024-001')
  })

  test('parses tab-separated format', () => {
    const content = 'BM1\t1.65432\t25.4\tBS\nTP1\t0.87654\t30.1\tFS\n'
    const result = parseTopconDL(content, 'test_tab.dat')
    expect(result.readings).toHaveLength(2)
    expect(result.readings[0].stationId).toBe('BM1')
    expect(result.readings[0].staffReading).toBeCloseTo(1.65432, 5)
  })

  test('parses semicolon-separated format', () => {
    const content = 'BM1;1.65432;25.4;BS\nTP1;0.87654;30.1;FS\n'
    const result = parseTopconDL(content, 'test_semi.dat')
    expect(result.readings).toHaveLength(2)
    expect(result.readings[0].stationId).toBe('BM1')
    expect(result.readings[0].staffReading).toBeCloseTo(1.65432, 5)
    expect(result.readings[1].type).toBe('FS')
  })

  test('builds observations from BS/FS pairs', () => {
    const content = [
      'BM1  1.50000  30.0  BS',
      'TP1  0.80000  30.0  FS',
      'TP1  1.40000  25.0  BS',
      'BM2  0.70000  25.0  FS',
    ].join('\n')

    const result = parseTopconDL(content, 'test_obs.dat')
    expect(result.observations).toHaveLength(2)
    expect(result.observations[0].fromId).toBe('BM1')
    expect(result.observations[0].toId).toBe('TP1')
    expect(result.observations[0].heightDifference).toBeCloseTo(0.7, 5)
  })

  test('detects model from DL-xxx pattern', () => {
    const content = 'DL-102\nBM1  1.50000  30.0  BS\n'
    const result = parseTopconDL(content, 'test_model.dat')
    expect(result.metadata.instrument).toBe('DL-102')
  })

  test('handles empty content gracefully', () => {
    const result = parseTopconDL('', 'empty.dat')
    expect(result.format).toBe('topcon-dl')
    expect(result.readings).toHaveLength(0)
    expect(result.observations).toHaveLength(0)
  })

  test('defaults distance to 30m when not provided', () => {
    const content = 'BM1  1.50000  BS\n'
    const result = parseTopconDL(content, 'test_nodef.dat')
    expect(result.readings).toHaveLength(1)
    expect(result.readings[0].distance).toBe(30)
  })
})
