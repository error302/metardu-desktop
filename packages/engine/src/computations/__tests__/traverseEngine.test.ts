/**
 * Tests for the traverse computation engine (traverseEngine.ts).
 * 
 * Verifies WCB propagation from observed angles, coordinate computation,
 * and Bowditch adjustment for closed traverses.
 * 
 * Source: Basak Chapter 10-11, Ghilani & Wolf Chapter 10, 12
 * 
 * VA convention: VA = vertical angle (elevation angle from horizontal).
 *   VA = 0° means horizontal shot (HD = SD × cos(0°) = SD).
 *   VA = 90° means vertical shot upward (HD = SD × cos(90°) = 0).
 *   This is the ELEVATION angle convention, NOT the zenith angle convention.
 *   If your field book uses zenith angles: VA = 90° - zenith_angle.
 */

import { computeTraverse } from '../traverseEngine'

describe('computeTraverse — WCB Propagation', () => {
  /**
   * Square traverse: 4 stations forming a 100m × 100m square.
   * Starting at A(1000, 2000), going clockwise:
   *   A→B due East (90°), B→C due South (180°), C→D due West (270°), D→A due North (0°)
   * 
   * Interior angles of the square measured clockwise (from BS direction to FS direction):
   *   At A: BS is North (0°), turn 90° CW → East (90°)
   *   At B: BS from A is West (back bearing of 90° = 270°), turn 270° CW → South (180°)
   *   At C: BS from B is North (back bearing of 180° = 0°), turn 270° CW → West (270°)
   *   At D: BS from C is East (back bearing of 270° = 90°), turn 270° CW → North (0°/360°)
   */

  it('correct WCB propagation for a square traverse going clockwise', () => {
    const result = computeTraverse({
      openingEasting: 1000,
      openingNorthing: 2000,
      openingStation: 'A',
      closingEasting: 1000,
      closingNorthing: 2000,
      closingStation: 'A',
      backsightBearingDeg: 0,
      backsightBearingMin: 0,
      backsightBearingSec: 0,
      observations: [
        // At A: BS at North (0°), observed angle 90° CW → FS at East (WCB=90°)
        { station: 'B', bs: 'BS', fs: 'C', hclDeg: '90', hclMin: '0', hclSec: '0', hcrDeg: '270', hcrMin: '0', hcrSec: '0', slopeDist: '100', vaDeg: '0', vaMin: '0', vaSec: '0', ih: '1.5', th: '1.5' },
        // At B: observed angle 270° CW
        { station: 'C', bs: 'A', fs: 'D', hclDeg: '270', hclMin: '0', hclSec: '0', hcrDeg: '90', hcrMin: '0', hcrSec: '0', slopeDist: '100', vaDeg: '0', vaMin: '0', vaSec: '0', ih: '1.5', th: '1.5' },
        // At C: observed angle 270° CW
        { station: 'D', bs: 'B', fs: 'A', hclDeg: '270', hclMin: '0', hclSec: '0', hcrDeg: '90', hcrMin: '0', hcrSec: '0', slopeDist: '100', vaDeg: '0', vaMin: '0', vaSec: '0', ih: '1.5', th: '1.5' },
        // At D: observed angle 270° CW
        { station: 'A', bs: 'C', fs: 'X', hclDeg: '270', hclMin: '0', hclSec: '0', hcrDeg: '90', hcrMin: '0', hcrSec: '0', slopeDist: '100', vaDeg: '0', vaMin: '0', vaSec: '0', ih: '1.5', th: '1.5' },
      ],
    })

    // Verify WCBs
    expect(result.legs[0].wcb).toBeCloseTo(90, 1)   // A→B due East
    expect(result.legs[1].wcb).toBeCloseTo(180, 1)  // B→C due South
    expect(result.legs[2].wcb).toBeCloseTo(270, 1)  // C→D due West
    expect(result.legs[3].wcb).toBeCloseTo(0, 1)    // D→A due North (or 360°)

    // Verify coordinates
    expect(result.coordinates[1].easting).toBeCloseTo(1100, 2)  // B
    expect(result.coordinates[1].northing).toBeCloseTo(2000, 2)
    expect(result.coordinates[2].easting).toBeCloseTo(1100, 2)  // C
    expect(result.coordinates[2].northing).toBeCloseTo(1900, 2)
    expect(result.coordinates[3].easting).toBeCloseTo(1000, 2)  // D
    expect(result.coordinates[3].northing).toBeCloseTo(1900, 2)
    expect(result.coordinates[4].easting).toBeCloseTo(1000, 2)  // A (close)
    expect(result.coordinates[4].northing).toBeCloseTo(2000, 2)

    // Should have near-zero misclosure
    expect(result.linearError).toBeLessThan(0.01)
  })

  it('WCB propagation verified: back bearing + angle gives correct forward bearing', () => {
    // Simple 2-leg traverse: A→B at 45° (NE), B→C at 135° (SE)
    // At A: BS at North (0°), angle = 45° → WCB = 0° + 45° = 45°
    // At B: back_bearing(45°) = 225°, angle = 270° → WCB = 225° + 270° = 495° → 135°
    const result = computeTraverse({
      openingEasting: 0,
      openingNorthing: 0,
      openingStation: 'A',
      closingEasting: 141.421,
      closingNorthing: 0,
      closingStation: 'C',
      backsightBearingDeg: 0,
      backsightBearingMin: 0,
      backsightBearingSec: 0,
      observations: [
        // A→B at 45° (NE), 100m
        { station: 'B', bs: 'BS', fs: 'C', hclDeg: '45', hclMin: '0', hclSec: '0', hcrDeg: '225', hcrMin: '0', hcrSec: '0', slopeDist: '100', vaDeg: '0', vaMin: '0', vaSec: '0', ih: '1.5', th: '1.5' },
        // B→C at 135° (SE), 100m
        { station: 'C', bs: 'A', fs: 'X', hclDeg: '270', hclMin: '0', hclSec: '0', hcrDeg: '90', hcrMin: '0', hcrSec: '0', slopeDist: '100', vaDeg: '0', vaMin: '0', vaSec: '0', ih: '1.5', th: '1.5' },
      ],
    })

    // WCBs should be 45° and 135°
    expect(result.legs[0].wcb).toBeCloseTo(45, 1)   // A→B NE
    expect(result.legs[1].wcb).toBeCloseTo(135, 1)  // B→C SE

    // Verify coordinates
    // B: E = 0 + 100×sin(45°) ≈ 70.711, N = 0 + 100×cos(45°) ≈ 70.711
    expect(result.coordinates[1].easting).toBeCloseTo(70.711, 1)
    expect(result.coordinates[1].northing).toBeCloseTo(70.711, 1)
    // C: E = 70.711 + 100×sin(135°) ≈ 141.421, N = 70.711 + 100×cos(135°) ≈ 0
    expect(result.coordinates[2].easting).toBeCloseTo(141.421, 0)
    expect(result.coordinates[2].northing).toBeCloseTo(0, 0)
  })
})

describe('computeTraverse — Bowditch Adjustment', () => {
  it('distributes corrections proportionally to leg distance in a closed traverse', () => {
    // Create a square traverse with a small deliberate error
    // Legs 2 and 4 are 100.1m instead of 100m, introducing misclosure
    const result = computeTraverse({
      openingEasting: 0,
      openingNorthing: 0,
      openingStation: 'A',
      closingEasting: 0,
      closingNorthing: 0,
      closingStation: 'A',
      backsightBearingDeg: 0,
      backsightBearingMin: 0,
      backsightBearingSec: 0,
      observations: [
        { station: 'B', bs: 'BS', fs: 'C', hclDeg: '90', hclMin: '0', hclSec: '0', hcrDeg: '270', hcrMin: '0', hcrSec: '0', slopeDist: '100', vaDeg: '0', vaMin: '0', vaSec: '0', ih: '1.5', th: '1.5' },
        { station: 'C', bs: 'A', fs: 'D', hclDeg: '270', hclMin: '0', hclSec: '0', hcrDeg: '90', hcrMin: '0', hcrSec: '0', slopeDist: '100.1', vaDeg: '0', vaMin: '0', vaSec: '0', ih: '1.5', th: '1.5' },
        { station: 'D', bs: 'B', fs: 'A', hclDeg: '270', hclMin: '0', hclSec: '0', hcrDeg: '90', hcrMin: '0', hcrSec: '0', slopeDist: '100', vaDeg: '0', vaMin: '0', vaSec: '0', ih: '1.5', th: '1.5' },
        { station: 'A', bs: 'C', fs: 'X', hclDeg: '270', hclMin: '0', hclSec: '0', hcrDeg: '90', hcrMin: '0', hcrSec: '0', slopeDist: '100.1', vaDeg: '0', vaMin: '0', vaSec: '0', ih: '1.5', th: '1.5' },
      ],
    })

    // Should have small misclosure due to the 0.1m errors
    expect(result.linearError).toBeGreaterThan(0)

    // After Bowditch adjustment, the traverse should close well
    const lastCoord = result.coordinates[result.coordinates.length - 1]
    expect(lastCoord.easting).toBeCloseTo(0, 1)
    expect(lastCoord.northing).toBeCloseTo(0, 1)
  })

  it('perfectly closed traverse has zero misclosure', () => {
    const result = computeTraverse({
      openingEasting: 0,
      openingNorthing: 0,
      openingStation: 'A',
      closingEasting: 0,
      closingNorthing: 0,
      closingStation: 'A',
      backsightBearingDeg: 0,
      backsightBearingMin: 0,
      backsightBearingSec: 0,
      observations: [
        { station: 'B', bs: 'BS', fs: 'C', hclDeg: '90', hclMin: '0', hclSec: '0', hcrDeg: '270', hcrMin: '0', hcrSec: '0', slopeDist: '100', vaDeg: '0', vaMin: '0', vaSec: '0', ih: '1.5', th: '1.5' },
        { station: 'C', bs: 'A', fs: 'D', hclDeg: '270', hclMin: '0', hclSec: '0', hcrDeg: '90', hcrMin: '0', hcrSec: '0', slopeDist: '100', vaDeg: '0', vaMin: '0', vaSec: '0', ih: '1.5', th: '1.5' },
        { station: 'D', bs: 'B', fs: 'A', hclDeg: '270', hclMin: '0', hclSec: '0', hcrDeg: '90', hcrMin: '0', hcrSec: '0', slopeDist: '100', vaDeg: '0', vaMin: '0', vaSec: '0', ih: '1.5', th: '1.5' },
        { station: 'A', bs: 'C', fs: 'X', hclDeg: '270', hclMin: '0', hclSec: '0', hcrDeg: '90', hcrMin: '0', hcrSec: '0', slopeDist: '100', vaDeg: '0', vaMin: '0', vaSec: '0', ih: '1.5', th: '1.5' },
      ],
    })

    expect(result.linearError).toBeLessThan(0.001)
    expect(result.isClosed).toBe(true)
  })
})
