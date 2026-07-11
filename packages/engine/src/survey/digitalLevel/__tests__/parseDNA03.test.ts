import { parseDNA03 } from '../parseDNA03'

describe('parseDNA03', () => {
  test('parses DNA03 RDT format with measurement header', () => {
    const content = [
      'DNA03 Digital Level',
      'Inst-No: 123456',
      'Job-No: JK-2024',
      'Staff: 10001 10002',
      'Operator: J. KAMAU',
      'RNo Sta  RNo Sta   Ht.m  Diff.m  Comments',
      '1  BM1  2  TP1    1.65432     0.77778     BS to TP1',
      '3  TP1  4  TP2    0.87654     0.66667     FS from TP1',
      '5  TP2  6  BM2    1.54321     0.77778     BS from TP2',
      '7  BM2  8  BM3    0.76543     0.77778     FS from BM2',
    ].join('\n')

    const result = parseDNA03(content, 'test_dna.dat')
    expect(result.format).toBe('dna03')
    expect(result.readings).toHaveLength(4)
    expect(result.metadata.instrument).toBe('123456')
    expect(result.metadata.jobNumber).toBe('JK-2024')
    expect(result.metadata.operator).toBe('J. KAMAU')
    expect(result.metadata.staffA).toBe('10001')
    expect(result.metadata.staffB).toBe('10002')
  })

  test('parses measurement rows with regex', () => {
    const content = [
      'DNA03 Digital Level',
      'RNo Sta  RNo Sta   Ht.m  Diff.m  Comments',
      '1  BM1  2  TP1    1.65432     0.77778     BS to TP1',
    ].join('\n')

    const result = parseDNA03(content)
    expect(result.readings).toHaveLength(1)
    expect(result.readings[0].stationId).toBe('TP1')
    expect(result.readings[0].staffReading).toBeCloseTo(1.65432, 5)
  })

  test('extracts timestamp from comments', () => {
    const content = [
      'DNA03 Digital Level',
      'RNo Sta  RNo Sta   Ht.m  Diff.m  Comments',
      '1  BM1  2  TP1    1.65432     0.77778     BS 08:30:15',
    ].join('\n')

    const result = parseDNA03(content)
    expect(result.readings[0].timestamp).toBeDefined()
  })

  test('defaults distance to 30m (estimated)', () => {
    const content = [
      'DNA03 Digital Level',
      'RNo Sta  RNo Sta   Ht.m  Diff.m  Comments',
      '1  BM1  2  TP1    1.65432     0.77778     BS',
    ].join('\n')

    const result = parseDNA03(content)
    expect(result.readings[0].distance).toBe(30)
  })

  test('handles empty content gracefully', () => {
    const result = parseDNA03('', 'empty.dat')
    expect(result.format).toBe('dna03')
    expect(result.readings).toHaveLength(0)
    expect(result.observations).toHaveLength(0)
  })

  test('handles content with only headers', () => {
    const content = [
      'DNA03 Digital Level',
      'Inst-No: 123456',
      'Job-No: TEST',
    ].join('\n')
    const result = parseDNA03(content)
    expect(result.readings).toHaveLength(0)
    expect(result.metadata.instrument).toBe('123456')
    expect(result.metadata.jobNumber).toBe('TEST')
  })

  test('parses alternative simple format rows', () => {
    const content = [
      'DNA03 Digital Level',
      'RNo Sta  RNo Sta   Ht.m  Diff.m  Comments',
      'BM1  1.65432  30.0  BS',
      'TP1  0.87654  30.0  FS',
    ].join('\n')

    const result = parseDNA03(content)
    expect(result.readings).toHaveLength(2)
    expect(result.readings[0].stationId).toBe('BM1')
    expect(result.readings[0].staffReading).toBeCloseTo(1.65432, 5)
    expect(result.readings[1].type).toBe('FS')
  })

  test('builds observations from BS/FS pairs', () => {
    const content = [
      'DNA03 Digital Level',
      'RNo Sta  RNo Sta   Ht.m  Diff.m  Comments',
      'BM1  1.50000  30  BS',
      'TP1  0.80000  30  FS',
      'TP1  1.40000  25  BS',
      'BM2  0.70000  25  FS',
    ].join('\n')

    const result = parseDNA03(content)
    expect(result.observations).toHaveLength(2)
    expect(result.observations[0].heightDifference).toBeCloseTo(0.7, 5)
  })
})
