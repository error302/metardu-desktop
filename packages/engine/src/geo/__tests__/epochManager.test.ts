/**
 * Tests for the Epoch Manager — plate velocity and epoch propagation
 *
 * Verifies that the Somali plate velocity model produces sensible numbers
 * for Kenya and that epoch propagation works correctly.
 */

import {
  computePlateVelocity,
  geodeticToEcef,
  ecefToGeodetic,
  propagateToEpoch,
  compareCoordinates,
  dateToDecimalYear,
  decimalYearToDate,
  currentEpoch,
  validateEpoch,
  SOMALI_PLATE_OMEGA,
} from '../epochManager'

// ─── ECEF Conversions ───────────────────────────────────────────────────────

describe('geodeticToEcef / ecefToGeodetic', () => {
  it('round-trips Nairobi coordinates correctly', () => {
    const lat = -1.2921
    const lon = 36.8219
    const h = 1795 // Nairobi elevation ~1795m

    const [X, Y, Z] = geodeticToEcef(lat, lon, h)
    const result = ecefToGeodetic(X, Y, Z)

    expect(result.latitude).toBeCloseTo(lat, 6)
    expect(result.longitude).toBeCloseTo(lon, 6)
    expect(result.height).toBeCloseTo(h, 2)
  })

  it('round-trips Mombasa coordinates correctly', () => {
    const lat = -4.0435
    const lon = 39.6682
    const h = 50

    const [X, Y, Z] = geodeticToEcef(lat, lon, h)
    const result = ecefToGeodetic(X, Y, Z)

    expect(result.latitude).toBeCloseTo(lat, 6)
    expect(result.longitude).toBeCloseTo(lon, 6)
    expect(result.height).toBeCloseTo(h, 2)
  })

  it('produces sensible ECEF values for Nairobi', () => {
    const [X, Y, Z] = geodeticToEcef(-1.2921, 36.8219, 1795)
    // Nairobi is ~6.3Mm from Earth center, mostly X (near equator, 37°E)
    expect(Math.sqrt(X * X + Y * Y + Z * Z)).toBeCloseTo(6378137 + 1795, -3)
    expect(X).toBeGreaterThan(0)
    expect(Y).toBeGreaterThan(0)
    expect(Z).toBeLessThan(0) // southern hemisphere
  })
})

// ─── Plate Velocity ─────────────────────────────────────────────────────────

describe('computePlateVelocity', () => {
  it('produces a northeast velocity for Kenya (Somali plate moves NNE)', () => {
    const v = computePlateVelocity(-1.2921, 36.8219)
    expect(v.ve).toBeGreaterThan(0) // eastward
    expect(v.vn).toBeGreaterThan(0) // northward
    const horizontalVel = Math.sqrt(v.ve ** 2 + v.vn ** 2)
    expect(horizontalVel).toBeGreaterThan(0.005) // > 5mm/year
    expect(horizontalVel).toBeLessThan(0.05)     // < 5cm/year
  })

  it('produces a small vertical velocity (plates move mostly horizontally)', () => {
    const v = computePlateVelocity(-1.2921, 36.8219)
    const horizontalVel = Math.sqrt(v.ve ** 2 + v.vn ** 2)
    expect(Math.abs(v.vu)).toBeLessThan(horizontalVel)
  })

  it('produces consistent velocities across Kenya (same plate)', () => {
    const nairobi = computePlateVelocity(-1.2921, 36.8219)
    const mombasa = computePlateVelocity(-4.0435, 39.6682)
    const kisumu = computePlateVelocity(-0.0917, 34.7680)

    const magnitudes = [nairobi, mombasa, kisumu].map(v => Math.sqrt(v.ve ** 2 + v.vn ** 2))
    const maxMag = Math.max(...magnitudes)
    const minMag = Math.min(...magnitudes)
    expect(maxMag / minMag).toBeLessThan(2.5)
  })

  it('uses the Somali plate omega by default', () => {
    const v = computePlateVelocity(-1.2921, 36.8219)
    const vExplicit = computePlateVelocity(-1.2921, 36.8219, 0, SOMALI_PLATE_OMEGA)
    expect(v.ve).toBeCloseTo(vExplicit.ve, 15)
    expect(v.vn).toBeCloseTo(vExplicit.vn, 15)
  })
})

// ─── Epoch Propagation ──────────────────────────────────────────────────────

describe('propagateToEpoch', () => {
  it('returns the same coordinate when source and target epochs are equal', () => {
    const coord = {
      latitude: -1.2921,
      longitude: 36.8219,
      height: 1795,
      frame: 'ITRF2014' as const,
      epoch: 2025.0,
    }
    const result = propagateToEpoch(coord, 2025.0)
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
    const result = propagateToEpoch(coord, 2025.0)

    const totalDisplacement = Math.sqrt(
      result.displacement.de ** 2 + result.displacement.dn ** 2,
    )
    expect(totalDisplacement).toBeGreaterThan(0.005) // > 5mm over 10 years
    expect(totalDisplacement).toBeLessThan(0.50)     // < 50cm
    expect(result.dtYears).toBeCloseTo(10, 1)
  })

  it('propagates backwards in time (negative dt)', () => {
    const coord = {
      latitude: -1.2921,
      longitude: 36.8219,
      height: 1795,
      frame: 'ITRF2014' as const,
      epoch: 2025.0,
    }
    const result = propagateToEpoch(coord, 2015.0)
    expect(result.dtYears).toBeCloseTo(-10, 1)
    expect(Math.abs(result.displacement.de)).toBeGreaterThan(0.0001)
  })

  it('includes provenance with source and target epochs', () => {
    const coord = {
      latitude: -1.2921,
      longitude: 36.8219,
      height: 1795,
      frame: 'ITRF2014' as const,
      epoch: 2015.0,
    }
    const result = propagateToEpoch(coord, 2025.0)
    expect(result.provenance).toContain('2015')
    expect(result.provenance).toContain('2025')
    expect(result.provenance).toContain('Somali plate')
    expect(result.provenance).toContain('ITRF2014')
  })
})

// ─── Coordinate Comparison ──────────────────────────────────────────────────

describe('compareCoordinates', () => {
  it('returns zero distance for identical coordinates at the same epoch', () => {
    const coord = {
      latitude: -1.2921,
      longitude: 36.8219,
      height: 1795,
      frame: 'ITRF2014' as const,
      epoch: 2025.0,
    }
    const result = compareCoordinates(coord, coord, 0.05)
    expect(result.distanceM).toBeCloseTo(0, 5)
    expect(result.agrees).toBe(true)
  })

  it('detects disagreement when coordinates differ by > tolerance', () => {
    const coord1 = {
      latitude: -1.2921,
      longitude: 36.8219,
      height: 1795,
      frame: 'ITRF2014' as const,
      epoch: 2025.0,
    }
    const coord2 = {
      latitude: -1.2920, // ~11m south — way beyond 5cm tolerance
      longitude: 36.8219,
      height: 1795,
      frame: 'ITRF2014' as const,
      epoch: 2025.0,
    }
    const result = compareCoordinates(coord1, coord2, 0.05)
    expect(result.distanceM).toBeGreaterThan(5) // ~11m
    expect(result.agrees).toBe(false)
  })

  it('propagates both coordinates to a common epoch before comparing', () => {
    // Same physical point, observed 10 years apart. The 2025 observation
    // gives a DIFFERENT lat/lon (because the plate moved ~10cm NNE over
    // 10 years). After propagation to a common epoch, the distance should
    // be near zero (sub-mm with the rigorous Rodrigues' rotation formula).
    const coord2015 = {
      latitude: -1.2921,
      longitude: 36.8219,
      height: 1795,
      frame: 'ITRF2014' as const,
      epoch: 2015.0,
    }

    // The 2025 observation is of the SAME monument, so its lat/lon reflects
    // 10 years of plate motion. Compute this with the rigorous propagator.
    // We need to import it here to construct the test data.
    const { propagateToEpochRigorous } = require('../epochManagerRigorous')
    const propagated = propagateToEpochRigorous(coord2015, 2025.0)

    const coord2025 = {
      latitude: propagated.latitude,
      longitude: propagated.longitude,
      height: propagated.height,
      frame: 'ITRF2014' as const,
      epoch: 2025.0,
    }

    const result = compareCoordinates(coord2015, coord2025, 0.05)
    expect(result.commonEpoch).toBeCloseTo(2025.0, 1)
    // Rigorous Rodrigues' rotation has zero accumulated error — these are
    // the same physical point, so distance should be sub-mm.
    expect(result.distanceM).toBeLessThan(0.001)
    expect(result.agrees).toBe(true)  // PASSES within 5cm tolerance
  })
})

// ─── Date/Epoch Conversion ──────────────────────────────────────────────────

describe('dateToDecimalYear', () => {
  it('returns 2025.0 for Jan 1, 2025', () => {
    expect(dateToDecimalYear('2025-01-01')).toBeCloseTo(2025.0, 2)
  })

  it('returns ~2025.5 for July 1, 2025', () => {
    expect(dateToDecimalYear('2025-07-01')).toBeCloseTo(2025.5, 1)
  })

  it('returns ~2024.99 for Dec 31, 2024', () => {
    expect(dateToDecimalYear('2024-12-31')).toBeGreaterThan(2024.99)
    expect(dateToDecimalYear('2024-12-31')).toBeLessThan(2025.0)
  })
})

describe('decimalYearToDate', () => {
  it('returns a valid ISO date string', () => {
    const dateStr = decimalYearToDate(2025.5)
    expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('round-trips approximately with dateToDecimalYear', () => {
    const epoch = 2025.5
    const dateStr = decimalYearToDate(epoch)
    const roundTrip = dateToDecimalYear(dateStr)
    expect(roundTrip).toBeCloseTo(epoch, 1)
  })
})

// ─── Validation ─────────────────────────────────────────────────────────────

describe('validateEpoch', () => {
  it('accepts modern epochs (post-1990)', () => {
    expect(validateEpoch(2025.0)).toHaveLength(0)
    expect(validateEpoch(2010.5)).toHaveLength(0)
    expect(validateEpoch(1995.0)).toHaveLength(0)
  })

  it('warns about pre-1990 epochs', () => {
    const errors = validateEpoch(1985.0)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('pre-modular ITRF')
  })

  it('warns about future epochs', () => {
    const future = currentEpoch() + 5
    const errors = validateEpoch(future)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('future')
  })
})

// ─── Integration: Kenya boundary scenario ───────────────────────────────────

describe('Kenya boundary commission scenario', () => {
  it('can propagate a 2010 GNSS observation to 2026 for comparison', () => {
    const pillar2010 = {
      latitude: -1.0,
      longitude: 37.0,
      height: 1500,
      frame: 'ITRF2014' as const,
      epoch: 2010.0,
    }

    const pillar2026 = propagateToEpoch(pillar2010, 2026.0)

    const totalDisplacement = Math.sqrt(
      pillar2026.displacement.de ** 2 + pillar2026.displacement.dn ** 2,
    )
    expect(totalDisplacement).toBeGreaterThan(0.01) // > 1cm over 16 years
    expect(totalDisplacement).toBeLessThan(0.60)    // < 60cm

    expect(pillar2026.provenance).toContain('16')
    expect(pillar2026.provenance).toContain('Somali plate')
  })
})
