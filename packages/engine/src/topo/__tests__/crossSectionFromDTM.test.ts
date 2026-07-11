/**
 * Cross-Section from DTM Tests
 * Run: npx jest src/lib/topo/__tests__/crossSectionFromDTM.test.ts
 */

import { describe, it, expect } from '@jest/globals'
import {
  buildCenterline,
  pointAtChainage,
  generateCrossSectionsFromDTM,
  crossSectionsToCSV,
  crossSectionsToDXF,
} from '../crossSectionFromDTM'

describe('buildCenterline', () => {
  it('computes chainage from distances', () => {
    const points = [
      { easting: 0, northing: 0 },
      { easting: 3, northing: 4 }, // 5m away
      { easting: 3, northing: 14 }, // 10m away
    ]
    const cl = buildCenterline(points)
    expect(cl[0].chainage).toBe(0)
    expect(cl[1].chainage).toBe(5)
    expect(cl[2].chainage).toBe(15)
  })

  it('handles single point', () => {
    const cl = buildCenterline([{ easting: 100, northing: 200 }])
    expect(cl).toHaveLength(1)
    expect(cl[0].chainage).toBe(0)
  })
})

describe('pointAtChainage', () => {
  it('interpolates position along centerline', () => {
    const cl = buildCenterline([
      { easting: 0, northing: 0 },
      { easting: 10, northing: 0 },
    ])
    const p = pointAtChainage(cl, 5)
    expect(p.easting).toBeCloseTo(5)
    expect(p.northing).toBeCloseTo(0)
  })

  it('returns bearing of the segment', () => {
    const cl = buildCenterline([
      { easting: 0, northing: 0 },
      { easting: 0, northing: 10 }, // due north
    ])
    const p = pointAtChainage(cl, 5)
    expect(p.bearing).toBeCloseTo(0) // north = 0 radians
  })
})

describe('generateCrossSectionsFromDTM', () => {
  it('generates cross-sections at specified intervals', () => {
    // Simple flat surface at z=100
    const spotHeights = [
      { name: 'P1', easting: 0, northing: 0, elevation: 100 },
      { name: 'P2', easting: 100, northing: 0, elevation: 100 },
      { name: 'P3', easting: 0, northing: 100, elevation: 100 },
      { name: 'P4', easting: 100, northing: 100, elevation: 100 },
    ]
    const cl = buildCenterline([
      { easting: 0, northing: 50 },
      { easting: 100, northing: 50 },
    ])
    const result = generateCrossSectionsFromDTM(spotHeights, cl, 20, 10, 5)

    expect(result.sections.length).toBeGreaterThan(0)
    expect(result.interval).toBe(20)
    expect(result.halfWidth).toBe(10)
  })

  it('exports to CSV with correct headers', () => {
    const spotHeights = [
      { name: 'P1', easting: 0, northing: 0, elevation: 100 },
      { name: 'P2', easting: 10, northing: 0, elevation: 100 },
      { name: 'P3', easting: 0, northing: 10, elevation: 100 },
    ]
    const cl = buildCenterline([{ easting: 0, northing: 5 }, { easting: 10, northing: 5 }])
    const result = generateCrossSectionsFromDTM(spotHeights, cl, 10, 5, 5)
    const csv = crossSectionsToCSV(result)
    expect(csv).toContain('Chainage,Offset,Easting,Northing,Elevation')
  })

  it('exports to DXF with ENTITIES section', () => {
    const spotHeights = [
      { name: 'P1', easting: 0, northing: 0, elevation: 100 },
      { name: 'P2', easting: 10, northing: 0, elevation: 100 },
      { name: 'P3', easting: 0, northing: 10, elevation: 100 },
    ]
    const cl = buildCenterline([{ easting: 0, northing: 5 }, { easting: 10, northing: 5 }])
    const result = generateCrossSectionsFromDTM(spotHeights, cl, 10, 5, 5)
    const dxf = crossSectionsToDXF(result)
    expect(dxf).toContain('SECTION')
    expect(dxf).toContain('ENTITIES')
    expect(dxf).toContain('EOF')
  })
})
