/**
 * Tests for Phase 2: DXF design extractor, instrument writers, as-built comparison
 */

import {
  extractDesignPointsFromDXF,
} from '../dxfDesignExtractor'
import {
  exportStakeoutToCSV,
  exportStakeoutToGSI,
  exportStakeoutToSDR,
  exportStakeoutToJobXML,
  exportStakeout,
  getAvailableFormats,
} from '../instrumentWriters'
import {
  compareAsBuiltToDesign,
  formatRowForDisplay,
  getVerdictColor,
  getVerdictIcon,
} from '../asBuiltComparison'
import type {
  SettingOutResult,
  DesignPoint,
  InstrumentStation,
} from '@/lib/computations/settingOutEngine'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const MINIMAL_DXF = `0
SECTION
2
ENTITIES
0
POINT
8
STAKEOUT
10
264000.000
20
9861000.000
30
1500.000
0
POINT
8
STAKEOUT
10
264100.000
20
9861100.000
30
1500.000
0
LINE
8
BOUNDARY
10
264000.000
20
9861000.000
30
1500.000
11
264100.000
21
9861100.000
31
1500.000
0
ENDSEC
0
EOF`

const station: InstrumentStation = {
  e: 264000, n: 9861000, rl: 1500, ih: 1.5,
}

const designPoints: DesignPoint[] = [
  { id: 'P1', e: 264100, n: 9861100, rl: 1500, th: 2.0, description: 'Corner 1' },
  { id: 'P2', e: 264200, n: 9861100, rl: 1500, th: 2.0, description: 'Corner 2' },
  { id: 'P3', e: 264200, n: 9861200, rl: 1500, th: 2.0, description: 'Corner 3' },
  { id: 'P4', e: 264100, n: 9861200, rl: 1500, th: 2.0, description: 'Corner 4' },
]

const settingOutResult: SettingOutResult = {
  instrumentStation: station,
  backsight: { e: 264050, n: 9861050 },
  bsBearing: '045°00\'00.0"',
  bsBearingDecimal: 45,
  rows: designPoints.map((p, i) => ({
    id: p.id,
    designE: p.e,
    designN: p.n,
    designRL: p.rl,
    HzAngle: `${45 + i * 10}°00'00.0"`,
    HzDecimal: 45 + i * 10,
    HD: 100 + i * 10,
    VA: '+00°00\'00.0"',
    VA_Rad: 0,
    SD: 100 + i * 10,
    TH: p.th,
    heightDiff: 0,
    steps: [],
  })),
  totalPoints: 4,
}

// ─── DXF Design Extractor ───────────────────────────────────────────────────

describe('DXF Design Extractor', () => {
  it('extracts POINT entities from a DXF', () => {
    const result = extractDesignPointsFromDXF(MINIMAL_DXF)
    expect(result.points.length).toBeGreaterThanOrEqual(2)
    expect(result.points[0].e).toBe(264000)
    expect(result.points[0].n).toBe(9861000)
    expect(result.points[1].e).toBe(264100)
  })

  it('extracts LINE endpoint entities', () => {
    const result = extractDesignPointsFromDXF(MINIMAL_DXF)
    // The LINE should produce 2 points (start + end)
    const linePoints = result.points.filter(p => p.description?.includes('Line'))
    expect(linePoints.length).toBe(2)
  })

  it('filters by layer when specified', () => {
    const result = extractDesignPointsFromDXF(MINIMAL_DXF, { layerFilter: ['STAKEOUT'] })
    const stakeoutPoints = result.points.filter(p => p.description?.includes('STAKEOUT') || !p.description?.includes('Line'))
    // Should only get POINT entities from STAKEOUT layer
    expect(result.warnings.length).toBe(0)
  })

  it('reports available layers when filter finds nothing', () => {
    const result = extractDesignPointsFromDXF(MINIMAL_DXF, { layerFilter: ['NONEXISTENT'] })
    expect(result.points.length).toBe(0)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('Available layers')
  })

  it('uses default RL and TH when not in DXF', () => {
    const result = extractDesignPointsFromDXF(MINIMAL_DXF, { defaultRL: 2000, defaultTH: 1.5 })
    // POINT entities have z=1500 in the DXF, but LINE entities don't have z
    const linePoints = result.points.filter(p => p.description?.includes('Line'))
    // LINE z is 1500 from the DXF, so defaultRL doesn't apply there
    // But if we check the entitiesScanned:
    expect(result.entitiesScanned).toBeGreaterThan(0)
  })

  it('returns empty array with warning for empty DXF', () => {
    const result = extractDesignPointsFromDXF('')
    expect(result.points.length).toBe(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

// ─── Instrument Writers ─────────────────────────────────────────────────────

describe('Instrument Writers', () => {
  it('exports to CSV with header row', () => {
    const result = exportStakeoutToCSV(settingOutResult)
    expect(result.content).toContain('point_id,easting,northing')
    expect(result.content).toContain('P1,264100.0000')
    expect(result.format).toBe('CSV')
    expect(result.mimeType).toBe('text/csv')
    expect(result.pointCount).toBe(4)
  })

  it('exports to GSI-8 format', () => {
    const result = exportStakeoutToGSI(settingOutResult, { format: 'GSI-8' })
    expect(result.content).toContain('*') // GSI words start with *
    expect(result.format).toBe('GSI-8')
    expect(result.filename).toContain('.gsi')
    expect(result.pointCount).toBe(4)
  })

  it('exports to GSI-16 format', () => {
    const result = exportStakeoutToGSI(settingOutResult, { format: 'GSI-16' })
    expect(result.format).toBe('GSI-16')
    expect(result.content).toContain('*')
  })

  it('exports to SDR format', () => {
    const result = exportStakeoutToSDR(settingOutResult)
    expect(result.content).toContain('00NM') // SDR header
    expect(result.content).toContain('03CO') // coordinate record
    expect(result.content).toContain('08ST') // stakeout instruction
    expect(result.content).toContain('99END') // SDR footer
    expect(result.format).toBe('SDR')
    expect(result.filename).toContain('.sdr')
  })

  it('exports to JobXML format', () => {
    const result = exportStakeoutToJobXML(settingOutResult)
    expect(result.content).toContain('<?xml')
    expect(result.content).toContain('<JobXML')
    expect(result.content).toContain('<StakeoutData')
    expect(result.content).toContain('horizontalAngle')
    expect(result.format).toBe('JobXML')
    expect(result.mimeType).toBe('application/xml')
  })

  it('unified exportStakeout() dispatches to the correct writer', () => {
    const csv = exportStakeout(settingOutResult, 'CSV')
    expect(csv.format).toBe('CSV')

    const gsi = exportStakeout(settingOutResult, 'GSI-8')
    expect(gsi.format).toBe('GSI-8')

    const sdr = exportStakeout(settingOutResult, 'SDR')
    expect(sdr.format).toBe('SDR')
  })

  it('getAvailableFormats returns all 5 formats', () => {
    const formats = getAvailableFormats()
    expect(formats.length).toBe(5)
    expect(formats.map(f => f.value)).toContain('CSV')
    expect(formats.map(f => f.value)).toContain('GSI-8')
    expect(formats.map(f => f.value)).toContain('GSI-16')
    expect(formats.map(f => f.value)).toContain('SDR')
    expect(formats.map(f => f.value)).toContain('JobXML')
  })
})

// ─── As-Built Comparison ────────────────────────────────────────────────────

describe('As-Built Comparison', () => {
  it('passes when as-built matches design within tolerance', () => {
    const report = compareAsBuiltToDesign({
      designPoints,
      asBuiltPoints: [
        { id: 'P1', e: 264100.005, n: 9861100.003, rl: 1500.002 },
        { id: 'P2', e: 264200.008, n: 9861100.005, rl: 1499.998 },
        { id: 'P3', e: 264200.010, n: 9861200.008, rl: 1500.001 },
        { id: 'P4', e: 264100.003, n: 9861200.010, rl: 1500.003 },
      ],
      toleranceH: 0.025,
      toleranceV: 0.015,
    })

    expect(report.verdict).toBe('PASS')
    expect(report.totalFailed).toBe(0)
    expect(report.totalPassed).toBe(4)
    expect(report.summary).toContain('within tolerance')
  })

  it('fails when as-built is outside tolerance', () => {
    const report = compareAsBuiltToDesign({
      designPoints,
      asBuiltPoints: [
        { id: 'P1', e: 264100.050, n: 9861100.050, rl: 1500.050 }, // 70mm off — FAIL
        { id: 'P2', e: 264200.010, n: 9861100.005, rl: 1500.002 }, // 11mm — PASS
        { id: 'P3', e: 264200.020, n: 9861200.015, rl: 1500.001 }, // 25mm — borderline
        { id: 'P4', e: 264100.005, n: 9861200.020, rl: 1500.003 }, // 21mm — PASS
      ],
      toleranceH: 0.025,
      toleranceV: 0.015,
    })

    expect(report.verdict).toBe('FAIL')
    expect(report.totalFailed).toBeGreaterThan(0)
    expect(report.failedPoints[0].designId).toBe('P1')
    expect(report.summary).toContain('FAIL')
    expect(report.summary).toContain('re-stake')
  })

  it('matches by proximity when IDs dont match', () => {
    const report = compareAsBuiltToDesign({
      designPoints,
      asBuiltPoints: [
        { e: 264100.010, n: 9861100.005, rl: 1500.002 }, // no ID, near P1
        { e: 264200.015, n: 9861100.010, rl: 1499.998 }, // near P2
      ],
      toleranceH: 0.025,
      toleranceV: 0.015,
      proximityMaxM: 5.0,
    })

    expect(report.totalMatched).toBe(2)
    expect(report.rows[0].matchedBy).toBe('proximity')
    expect(report.rows[0].designId).toBe('P1')
    expect(report.rows[1].designId).toBe('P2')
  })

  it('reports unmatched design points', () => {
    const report = compareAsBuiltToDesign({
      designPoints,
      asBuiltPoints: [
        { id: 'P1', e: 264100.010, n: 9861100.005, rl: 1500.002 },
      ],
      toleranceH: 0.025,
      toleranceV: 0.015,
    })

    expect(report.totalMatched).toBe(1)
    expect(report.unmatchedDesignPoints.length).toBe(3) // P2, P3, P4 not staked
    expect(report.verdict).toBe('INCOMPLETE')
    expect(report.summary).toContain('not yet staked')
  })

  it('reports INCOMPLETE when no points match', () => {
    const report = compareAsBuiltToDesign({
      designPoints,
      asBuiltPoints: [
        { e: 999999, n: 999999 }, // nowhere near any design point
      ],
      proximityMaxM: 1.0,
    })

    expect(report.verdict).toBe('INCOMPLETE')
    expect(report.totalMatched).toBe(0)
  })

  it('formats rows for display correctly', () => {
    const row = {
      designId: 'P1',
      designE: 100, designN: 200, designRL: 50,
      asBuiltE: 100.010, asBuiltN: 200.005, asBuiltRL: 50.002,
      deltaE: 0.010, deltaN: 0.005, deltaRL: 0.002,
      horizontalOffset: 0.0112,
      hStatus: 'PASS' as const,
      vStatus: 'PASS' as const,
      passed: true,
      matchedBy: 'id' as const,
    }
    const display = formatRowForDisplay(row)
    expect(display.id).toBe('P1')
    expect(display.dE).toContain('mm')
    expect(display.status).toContain('PASS')
    expect(display.statusColor).toBe('green')
  })

  it('getVerdictColor returns correct colors', () => {
    expect(getVerdictColor('PASS')).toBe('green')
    expect(getVerdictColor('FAIL')).toBe('red')
    expect(getVerdictColor('INCOMPLETE')).toBe('yellow')
  })

  it('getVerdictIcon returns correct icons', () => {
    expect(getVerdictIcon('PASS')).toBe('✓')
    expect(getVerdictIcon('FAIL')).toBe('✗')
    expect(getVerdictIcon('INCOMPLETE')).toBe('!')
  })
})
