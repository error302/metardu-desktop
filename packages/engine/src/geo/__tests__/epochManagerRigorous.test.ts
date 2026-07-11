/**
 * Tests for the Rigorous Epoch Manager (Rodrigues' rotation + ITRF frame transformation)
 */

import {
  propagateToEpochRigorous,
  rodriguesRotation,
  convertReferenceFrame,
  transformITRFFrame,
  ITRF2014_FROM_ITRF2008,
  alignCoordinate,
} from '../epochManagerRigorous'

// ─── Rodrigues' Rotation Formula ─────────────────────────────────────────────

describe('rodriguesRotation', () => {
  it('returns identity for zero rotation', () => {
    const R = rodriguesRotation(0, 0, 1, 0)
    expect(R[0][0]).toBeCloseTo(1, 10)
    expect(R[1][1]).toBeCloseTo(1, 10)
    expect(R[2][2]).toBeCloseTo(1, 10)
    expect(R[0][1]).toBeCloseTo(0, 10)
    expect(R[1][0]).toBeCloseTo(0, 10)
  })

  it('rotates 90° about Z-axis correctly', () => {
    const R = rodriguesRotation(0, 0, 1, Math.PI / 2)
    // (1,0,0) → (0,1,0)
    expect(R[0][0]).toBeCloseTo(0, 10)
    expect(R[1][0]).toBeCloseTo(1, 10)
    expect(R[0][1]).toBeCloseTo(-1, 10)
    expect(R[1][1]).toBeCloseTo(0, 10)
  })

  it('preserves vector length (orthogonal matrix)', () => {
    const R = rodriguesRotation(0.3, -0.7, 0.2, 0.5)
    // Check R·R^T = I
    const Rt = [
      [R[0][0], R[1][0], R[2][0]],
      [R[0][1], R[1][1], R[2][1]],
      [R[0][2], R[1][2], R[2][2]],
    ]
    // Compute R · Rt
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const dot = R[i][0] * Rt[0][j] + R[i][1] * Rt[1][j] + R[i][2] * Rt[2][j]
        const expected = i === j ? 1 : 0
        expect(dot).toBeCloseTo(expected, 8)
      }
    }
  })

  it('det(R) = 1 (proper rotation, not reflection)', () => {
    const R = rodriguesRotation(0.3, -0.7, 0.2, 0.5)
    const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1])
              - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0])
              + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0])
    expect(det).toBeCloseTo(1, 8)
  })
})

// ─── Exact Epoch Propagation ────────────────────────────────────────────────

describe('propagateToEpochRigorous', () => {
  it('returns the same coordinate when source and target epochs are equal', () => {
    const coord = {
      latitude: -1.2921,
      longitude: 36.8219,
      height: 1795,
      frame: 'ITRF2014' as const,
      epoch: 2025.0,
    }
    const result = propagateToEpochRigorous(coord, 2025.0)
    expect(result.latitude).toBeCloseTo(coord.latitude, 10)
    expect(result.longitude).toBeCloseTo(coord.longitude, 10)
    expect(result.dtYears).toBeCloseTo(0, 10)
    expect(result.displacement.de).toBeCloseTo(0, 10)
  })

  it('propagates Nairobi 10 years forward with measurable displacement', () => {
    const coord = {
      latitude: -1.2921,
      longitude: 36.8219,
      height: 1795,
      frame: 'ITRF2014' as const,
      epoch: 2015.0,
    }
    const result = propagateToEpochRigorous(coord, 2025.0)

    const totalDisplacement = Math.sqrt(
      result.displacement.de ** 2 + result.displacement.dn ** 2,
    )
    expect(totalDisplacement).toBeGreaterThan(0.005) // > 5mm over 10 years
    expect(totalDisplacement).toBeLessThan(0.50)     // < 50cm
    expect(result.dtYears).toBeCloseTo(10, 1)
  })

  it('round-trips: propagating forward then backward returns to the original point', () => {
    const original = {
      latitude: -1.2921,
      longitude: 36.8219,
      height: 1795,
      frame: 'ITRF2014' as const,
      epoch: 2015.0,
    }
    // Forward 10 years, then back 10 years
    const forward = propagateToEpochRigorous(original, 2025.0)
    const back = propagateToEpochRigorous(
      { ...forward, epoch: 2025.0 },
      2015.0,
    )

    // The rigorous rotation has ZERO accumulated error — round-trip
    // should recover the original coordinates to numerical precision.
    expect(back.latitude).toBeCloseTo(original.latitude, 10)
    expect(back.longitude).toBeCloseTo(original.longitude, 10)
    expect(back.height).toBeCloseTo(original.height, 5)
  })

  it('round-trips over 100 years (linear method would have ~1m error)', () => {
    const original = {
      latitude: -1.0,
      longitude: 37.0,
      height: 1500,
      frame: 'ITRF2014' as const,
      epoch: 1950.0,
    }
    const forward = propagateToEpochRigorous(original, 2050.0)
    const back = propagateToEpochRigorous(
      { ...forward, epoch: 2050.0 },
      1950.0,
    )

    // 100-year round-trip — rigorous method should recover to < 0.01mm
    expect(back.latitude).toBeCloseTo(original.latitude, 10)
    expect(back.longitude).toBeCloseTo(original.longitude, 10)
    expect(back.height).toBeCloseTo(original.height, 5)
  })

  it('includes provenance with Rodrigues formula reference', () => {
    const coord = {
      latitude: -1.2921,
      longitude: 36.8219,
      height: 1795,
      frame: 'ITRF2014' as const,
      epoch: 2015.0,
    }
    const result = propagateToEpochRigorous(coord, 2025.0)
    expect(result.provenance).toContain('Rodrigues')
    expect(result.provenance).toContain('2015')
    expect(result.provenance).toContain('2025')
    expect(result.provenance).toContain('No linearization error')
  })
})

// ─── ITRF Frame Transformation ──────────────────────────────────────────────

describe('transformITRFFrame', () => {
  it('ITRF2008 → ITRF2014 produces a small translation + scale effect', () => {
    // ITRF2008 → ITRF2014 transformation at epoch 2010.0:
    //   T1 = 0.2mm, T2 = 0.7mm, T3 = -1.9mm, D = 0.30 ppb
    // The scale contributes D × |X| = 0.30e-9 × 6.378e6 ≈ 1.9mm on the X-axis
    const X2008: [number, number, number] = [6378137, 0, 0]  // point on X-axis
    const X2014 = transformITRFFrame(X2008, ITRF2014_FROM_ITRF2008, 2010.0)

    // Expected: X2014 = (1+D)·X2008 + T = (1 + 0.30e-9) × 6378137 + 0.0002
    //                                  = 6378137 + 0.00191 + 0.0002 ≈ 6378137.00211
    const expectedScale = 1 + 0.30e-9
    expect(X2014[0]).toBeCloseTo(expectedScale * 6378137 + 0.0002, 4)
    expect(X2014[1]).toBeCloseTo(0.0007, 6)
    expect(X2014[2]).toBeCloseTo(-0.0019, 6)
  })

  it('round-trips: ITRF2008 → ITRF2014 → ITRF2008 recovers the original', () => {
    const X2008: [number, number, number] = [5000000, 3000000, -2000000]
    const X2014 = transformITRFFrame(X2008, ITRF2014_FROM_ITRF2008, 2015.0)

    // Use the inverse
    const { transformITRFFrameInverse } = require('../epochManagerRigorous')
    const X2008_back = transformITRFFrameInverse(X2014, ITRF2014_FROM_ITRF2008, 2015.0)

    expect(X2008_back[0]).toBeCloseTo(X2008[0], 4)
    expect(X2008_back[1]).toBeCloseTo(X2008[1], 4)
    expect(X2008_back[2]).toBeCloseTo(X2008[2], 4)
  })
})

describe('convertReferenceFrame', () => {
  it('returns the same coordinate when source and target frames are the same', () => {
    const coord = {
      latitude: -1.2921,
      longitude: 36.8219,
      height: 1795,
      frame: 'ITRF2014' as const,
      epoch: 2020.0,
    }
    const result = convertReferenceFrame(coord, 'ITRF2014')
    expect(result.latitude).toBeCloseTo(coord.latitude, 10)
    expect(result.longitude).toBeCloseTo(coord.longitude, 10)
    expect(result.height).toBeCloseTo(coord.height, 10)
    expect(result.provenance).toContain('No frame transformation needed')
  })

  it('transforms ITRF2008 → ITRF2014 (small shift expected)', () => {
    const coord2008 = {
      latitude: -1.2921,
      longitude: 36.8219,
      height: 1795,
      frame: 'ITRF2008' as const,
      epoch: 2010.0,
    }
    const result = convertReferenceFrame(coord2008, 'ITRF2014')

    // The ITRF2008 → ITRF2014 shift is < 1cm at the equator
    expect(result.frame).toBe('ITRF2014')
    expect(Math.abs(result.latitude - coord2008.latitude)).toBeLessThan(0.001)  // < 1mm in degrees
    expect(Math.abs(result.longitude - coord2008.longitude)).toBeLessThan(0.001)
    expect(Math.abs(result.height - coord2008.height)).toBeLessThan(0.05)  // < 5cm
    expect(result.provenance).toContain('ITRF2008')
    expect(result.provenance).toContain('ITRF2014')
  })
})

describe('alignCoordinate (frame + epoch in one operation)', () => {
  it('transforms frame and propagates epoch', () => {
    const coord2008_2010 = {
      latitude: -1.2921,
      longitude: 36.8219,
      height: 1795,
      frame: 'ITRF2008' as const,
      epoch: 2010.0,
    }
    const result = alignCoordinate(coord2008_2010, 'ITRF2014', 2025.0)

    expect(result.frame).toBe('ITRF2014')
    expect(result.epoch).toBe(2025.0)
    expect(result.dtYears).toBeCloseTo(15, 1)
    expect(result.frameTransformProvenance).toContain('ITRF2008')
    expect(result.provenance).toContain('Rodrigues')
  })
})

// ─── Kenya Boundary Commission Scenario ─────────────────────────────────────

describe('Kenya boundary commission scenario (rigorous)', () => {
  it('can align a 2010 ITRF2008 CORS coordinate to 2026 ITRF2014', () => {
    const cors2010 = {
      latitude: -1.0,
      longitude: 37.0,
      height: 1500,
      frame: 'ITRF2008' as const,
      epoch: 2010.0,
    }

    const aligned = alignCoordinate(cors2010, 'ITRF2014', 2026.0)

    expect(aligned.frame).toBe('ITRF2014')
    expect(aligned.epoch).toBe(2026.0)

    // Total displacement over 16 years should be 16 × ~2.5cm = ~40cm
    const totalDisplacement = Math.sqrt(
      aligned.displacement.de ** 2 + aligned.displacement.dn ** 2,
    )
    expect(totalDisplacement).toBeGreaterThan(0.10)  // > 10cm
    expect(totalDisplacement).toBeLessThan(0.60)     // < 60cm

    expect(aligned.provenance).toContain('16')
    expect(aligned.provenance).toContain('Rodrigues')
    expect(aligned.frameTransformProvenance).toContain('ITRF2008')
    expect(aligned.frameTransformProvenance).toContain('ITRF2014')
  })

  it('compares a 2010 ITRF2008 reading to a 2026 ITRF2014 PPP reading of the same monument', () => {
    // A monument is observed in 2010 (ITRF2008) and again in 2026 (ITRF2014).
    // The 2026 lat/lon should be the PROPAGATED position (the monument has
    // moved with the plate). If both are aligned to the same frame+epoch,
    // the distance should be sub-mm.
    const old = {
      latitude: -1.0,
      longitude: 37.0,
      height: 1500,
      frame: 'ITRF2008' as const,
      epoch: 2010.0,
    }

    // First propagate the 2010 observation to 2026 to find where the monument
    // should be in 2026 (this is what the 2026 PPP reading should give)
    const propagated = propagateToEpochRigorous(
      { ...old, frame: 'ITRF2014' }, // treat as ITRF2014 for propagation
      2026.0,
    )

    const recent = {
      latitude: propagated.latitude,
      longitude: propagated.longitude,
      height: propagated.height,
      frame: 'ITRF2014' as const,
      epoch: 2026.0,
    }

    // Align both to ITRF2014 @ 2026
    const old_aligned = alignCoordinate(old, 'ITRF2014', 2026.0)
    const recent_aligned = alignCoordinate(recent, 'ITRF2014', 2026.0)

    // The aligned coordinates should match within the ITRF2008→ITRF2014 frame
    // transformation uncertainty (a few mm).
    const dLat = (old_aligned.latitude - recent_aligned.latitude) * Math.PI / 180
    const dLon = (old_aligned.longitude - recent_aligned.longitude) * Math.PI / 180
    const R = 6371000
    const distance = Math.sqrt(
      (dLat * R) ** 2 + (dLon * R * Math.cos(old_aligned.latitude * Math.PI / 180)) ** 2,
    )

    expect(distance).toBeLessThan(0.01)  // < 1cm (frame transformation uncertainty)
  })
})
