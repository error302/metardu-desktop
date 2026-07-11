import { surfaceCutFillVolumeGrid } from '../volume'

const GRID_POINTS = (z: number) => Array.from({ length: 9 }, (_, i) => ({
  easting: (i % 3) * 10,
  northing: Math.floor(i / 3) * 10,
  elevation: z,
}))

describe('surfaceCutFillVolumeGrid', () => {
  it('all existing above design → all cut, no fill', () => {
    const r = surfaceCutFillVolumeGrid({
      existing: GRID_POINTS(10),
      design: GRID_POINTS(5),
      gridSpacing: 5,
    })
    expect(r.cutVolume).toBeGreaterThan(0)
    expect(r.fillVolume).toBeCloseTo(0, 1)
  })

  it('all existing below design → all fill, no cut', () => {
    const r = surfaceCutFillVolumeGrid({
      existing: GRID_POINTS(0),
      design: GRID_POINTS(5),
      gridSpacing: 5,
    })
    expect(r.fillVolume).toBeGreaterThan(0)
    expect(r.cutVolume).toBeCloseTo(0, 1)
  })

  it('net volume = cut - fill', () => {
    const r = surfaceCutFillVolumeGrid({
      existing: GRID_POINTS(8),
      design: GRID_POINTS(5),
      gridSpacing: 5,
    })
    expect(r.netVolume).toBeCloseTo(r.cutVolume - r.fillVolume, 4)
  })

  it('equal surfaces → zero net volume', () => {
    const r = surfaceCutFillVolumeGrid({
      existing: GRID_POINTS(5),
      design: GRID_POINTS(5),
      gridSpacing: 5,
    })
    expect(Math.abs(r.netVolume)).toBeLessThan(0.001)
  })

  it('returns cellCount > 0', () => {
    const r = surfaceCutFillVolumeGrid({
      existing: GRID_POINTS(10),
      design: GRID_POINTS(5),
      gridSpacing: 5,
    })
    expect(r.cellCount).toBeGreaterThan(0)
  })
})
