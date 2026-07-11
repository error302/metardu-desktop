import { parseRinexHeader, parseRinex } from '../rinex'

// Helper: pad a RINEX record to 80 characters with label at positions 60-80
function R(content: string, label: string): string {
  const padded = content.padEnd(60, ' ')
  return (padded + label).padEnd(80, ' ')
}

// ─── Minimal RINEX 2.10 header (GPS only) ────────────────────────────────────

const RINEX_2_10_HEADER = [
  R('    2.10          OBSERVATION DATA    G (GPS)', 'RINEX VERSION / TYPE'),
  R('NAIROBI1', 'MARKER NAME'),
  R('12345', 'MARKER NUMBER'),
  R('J. KAMAU            SURVEY OF KENYA', 'OBSERVER / AGENCY'),
  R('12345              TRIMBLE NETR9       5.10', 'REC # / TYPE / VERS'),
  R('12345              TRM57971.00         NONE', 'ANT # / TYPE'),
  R('   2112620.5430   22100863.8490 -2786439.7520', 'APPROX POSITION XYZ'),
  R('        0.0640        0.0000        0.0000', 'ANTENNA: DELTA H/E/N'),
  R(' 2024 01 15  0 30  0.0000000  GPS', 'TIME OF FIRST OBS'),
  R('     1.0000', 'INTERVAL'),
  R('    13    C1    P1    L1    L2    S1    S2', '# / TYPES OF OBSERV'),
  R('', 'END OF HEADER'),
].join('\n')

// ─── Minimal RINEX 2.11 header (GPS + GLONASS) ─────────────────────────────

const RINEX_2_11_HEADER = [
  R(' 2.11            OBSERVATION DATA    M (MIXED)', 'RINEX VERSION / TYPE'),
  R('NAIROBI_GNSS', 'MARKER NAME'),
  R('12346', 'MARKER NUMBER'),
  R('A. ODHIAMBO         SURVEY OF KENYA', 'OBSERVER / AGENCY'),
  R('12346              LEICA AR20         4.30', 'REC # / TYPE / VERS'),
  R('12346              LEIAR20           NONE', 'ANT # / TYPE'),
  R('   2112620.5430   22100863.8490 -2786439.7520', 'APPROX POSITION XYZ'),
  R('        0.0640        0.0000        0.0000', 'ANTENNA: DELTA H/E/N'),
  R(' 2024 01 15  0 30  0.0000000  GPS', 'TIME OF FIRST OBS'),
  R('', 'END OF HEADER'),
].join('\n')

// ─── Minimal RINEX 3.00 header ──────────────────────────────────────────────

const RINEX_3_00_HEADER = [
  R('  3.00          OBSERVATION DATA    M (MIXED)', 'RINEX VERSION / TYPE'),
  R('NLRB', 'MARKER NAME'),
  R('A0012345', 'MARKER NUMBER'),
  R('J. KAMAU       SURVEY OF KENYA', 'OBSERVER / AGENCY'),
  R('12345          TRIMBLE NETR9       5.10', 'REC # / TYPE / VERS'),
  R('12345          TRM57971.00         NONE', 'ANT # / TYPE'),
  R('   2112620.5430   22100863.8490 -2786439.7520', 'APPROX POSITION XYZ'),
  R('        0.0640        0.0000        0.0000', 'ANTENNA: DELTA H/E/N'),
  R('2024    01    15    00    30    0.0000000  GPS', 'TIME OF FIRST OBS'),
  R('     1.0000', 'INTERVAL'),
  R('G  4 C1C L1C S1C C2W', 'SYS / # / OBS TYPES'),
  R('R  4 C1C L1C S1C C2P', 'SYS / # / OBS TYPES'),
  R('', 'END OF HEADER'),
].join('\n')

// ─── Minimal RINEX 2 with observation epochs ────────────────────────────────

const RINEX_2_WITH_OBS = [
  R('    2.10          OBSERVATION DATA    G (GPS)', 'RINEX VERSION / TYPE'),
  R('NLRB', 'MARKER NAME'),
  R('12345', 'MARKER NUMBER'),
  R('J. KAMAU           SURVEY OF KENYA', 'OBSERVER / AGENCY'),
  R('12345              TRIMBLE NETR9       5.10', 'REC # / TYPE / VERS'),
  R('12345              TRM57971.00         NONE', 'ANT # / TYPE'),
  R('   2112620.5430   22100863.8490 -2786439.7520', 'APPROX POSITION XYZ'),
  R('        0.0640        0.0000        0.0000', 'ANTENNA: DELTA H/E/N'),
  R(' 2024 01 15  0 30  0.0000000  GPS', 'TIME OF FIRST OBS'),
  R('     1.0000', 'INTERVAL'),
  R('    13    C1    P1    L1    L2    S1    S2', '# / TYPES OF OBSERV'),
  R('', 'END OF HEADER'),
  ' 24 01 15  0 30  0.0000000  0  3  7 12 19 24',
  'G07  22456789.012  22456790.012 -12345678.012  22456788.012  9876543.012  -9876544.012   42   38',
  'G12  21456789.012  21456790.012 -11345678.012  21456788.012  8765432.012  -8765433.012   45   40',
  'G19  20456789.012  20456790.012 -10345678.012  20456788.012  7654321.012  -7654322.012   39   35',
].join('\n')

// ─── Minimal RINEX 3 with observation epochs ────────────────────────────────

const RINEX_3_WITH_OBS = [
  R('  3.00          OBSERVATION DATA    M (MIXED)', 'RINEX VERSION / TYPE'),
  R('NLRB', 'MARKER NAME'),
  R('A0012345', 'MARKER NUMBER'),
  R('J. KAMAU       SURVEY OF KENYA', 'OBSERVER / AGENCY'),
  R('12345          TRIMBLE NETR9       5.10', 'REC # / TYPE / VERS'),
  R('12345          TRM57971.00         NONE', 'ANT # / TYPE'),
  R('   2112620.5430   22100863.8490 -2786439.7520', 'APPROX POSITION XYZ'),
  R('        0.0640        0.0000        0.0000', 'ANTENNA: DELTA H/E/N'),
  R('2024    01    15    00    30    0.0000000  GPS', 'TIME OF FIRST OBS'),
  R('G  4 C1C L1C S1C C2W', 'SYS / # / OBS TYPES'),
  R('', 'END OF HEADER'),
  '> 2024 01 15  0 30  0.0000000  0  2',
  'G07  22456789.012  -12345678.012   42  21456789.012',
  'G12  21456789.012  -11345678.012   45  20456789.012',
].join('\n')

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RINEX Parser', () => {
  describe('parseRinexHeader', () => {
    test('parses RINEX 2.10 GPS header', () => {
      const header = parseRinexHeader(RINEX_2_10_HEADER)
      expect(header.version).toBe('2.10')
      expect(header.fileType).toBe('O') // Observation data
      expect(header.markerName).toBe('NAIROBI1')
      expect(header.markerNumber).toBe('12345')
      expect(header.observer).toBe('J. KAMAU')
      expect(header.agency).toBe('SURVEY OF KENYA')
      expect(header.receiverType).toBe('TRIMBLE NETR9')
      expect(header.antennaType).toBe('TRM57971.00')
      expect(header.approxPosECEF).toBeDefined()
      expect(header.approxPosECEF!.x).toBeCloseTo(2112620.543, 0)
      expect(header.antennaDelta).toBeDefined()
      expect(header.antennaDelta!.h).toBeCloseTo(0.064, 3)
      expect(header.timeOfFirstObs).toBeDefined()
    })

    test('parses RINEX 2.11 mixed header (GPS+GLONASS)', () => {
      const header = parseRinexHeader(RINEX_2_11_HEADER)
      expect(header.version).toBe('2.11')
      expect(header.fileType).toBe('O') // Observation data
      expect(header.markerName).toBe('NAIROBI_GNSS')
      expect(header.observer).toBe('A. ODHIAMBO')
    })

    test('parses RINEX 3.00 header with multi-GNSS systems', () => {
      const header = parseRinexHeader(RINEX_3_00_HEADER)
      expect(header.version).toBe('3.00')
      expect(header.fileType).toBe('O') // Observation data
      expect(header.markerName).toBe('NLRB')
      expect(header.systems).toBeDefined()
      expect(header.systems).toContain('G')
      expect(header.systems).toContain('R')
    })

    test('returns default values for missing optional fields', () => {
      const minimal = [
        R('    2.10            OBSERVATION DATA    G (GPS)', 'RINEX VERSION / TYPE'),
        R('TEST', 'MARKER NAME'),
        R('', 'END OF HEADER'),
      ].join('\n')
      const header = parseRinexHeader(minimal)
      expect(header.version).toBe('2.10')
      expect(header.markerName).toBe('TEST')
      expect(header.markerNumber).toBeUndefined()
      expect(header.observer).toBeUndefined()
      expect(header.approxPosECEF).toBeUndefined()
    })
  })

  describe('parseRinex', () => {
    test('parses RINEX 2 header and creates point from ECEF', () => {
      const result = parseRinex(RINEX_2_10_HEADER)
      expect(result.format).toBe('rinex')
      expect(result.points).toHaveLength(1)
      expect(result.points[0].point_no).toBe('NAIROBI1')
      expect(result.points[0].raw!.ecef_x).toBeCloseTo(2112620.543, 0)
      expect(result.header.markerName).toBe('NAIROBI1')
      expect(result.version).toBe('2.1')
    })

    test('parses RINEX 2 observation epochs', () => {
      const result = parseRinex(RINEX_2_WITH_OBS)
      expect(result.epochCount).toBe(1)
      expect(result.observations.length).toBeGreaterThanOrEqual(3)

      // Check first observation
      const firstObs = result.observations[0]
      expect(firstObs.satellite).toBe('G07')
      expect(firstObs.system).toBe('GPS')
      expect(firstObs.epoch).toBeDefined()
      expect(firstObs.epoch.getUTCFullYear()).toBe(2024)
      expect(firstObs.epoch.getUTCMonth()).toBe(0) // January
      expect(firstObs.epoch.getUTCDate()).toBe(15)
    })

    test('parses RINEX 3 observation epochs with multi-GNSS', () => {
      const result = parseRinex(RINEX_3_WITH_OBS)
      expect(result.epochCount).toBeGreaterThanOrEqual(1)
      expect(result.observations.length).toBeGreaterThanOrEqual(2)
      expect(result.version).toBe('3')

      // Check that satellites were parsed
      const sats = result.observations.map(function(o) { return o.satellite })
      expect(sats).toContain('G07')
      expect(sats).toContain('G12')
    })

    test('auto-detects RINEX version from content', () => {
      const v2 = parseRinex(RINEX_2_10_HEADER)
      expect(v2.version).toBe('2.1')

      const v3 = parseRinex(RINEX_3_00_HEADER)
      expect(v3.version).toBe('3')
    })

    test('identifies satellite systems correctly', () => {
      const result = parseRinex(RINEX_2_WITH_OBS)
      expect(result.systems).toContain('G')
    })

    test('handles empty content gracefully', () => {
      const result = parseRinex('')
      expect(result.format).toBe('rinex')
      expect(result.points).toHaveLength(0)
      expect(result.observations).toHaveLength(0)
      expect(result.epochCount).toBe(0)
    })

    test('handles truncated file (missing END OF HEADER)', () => {
      // Properly formatted RINEX header lines (80 chars, label at 60-80)
      const truncated = R('    2.10            OBSERVATION DATA    G (GPS)', 'RINEX VERSION / TYPE') + '\n'
        + R('TEST', 'MARKER NAME') + '\n'
      const result = parseRinex(truncated)
      expect(result.format).toBe('rinex')
      expect(result.header.version).toBe('2.10')
      expect(result.header.markerName).toBe('TEST')
    })

    test('extracts observation metadata into point raw data', () => {
      const result = parseRinex(RINEX_2_WITH_OBS)
      expect(result.points.length).toBeGreaterThanOrEqual(1)
      const point = result.points[0]
      expect(point.raw!.version).toBe('2.1')
      expect(point.raw!.epoch_count).toBeGreaterThan(0)
      expect(point.raw!.observation_count).toBeGreaterThan(0)
    })

    test('RINEX 3 header extracts interval', () => {
      const header = parseRinexHeader(RINEX_3_00_HEADER)
      expect(header.interval).toBeCloseTo(1.0, 1)
    })
  })
})
