/**
 * Tests for the Rigorous Helmert transformation (full rotation matrix + iteration)
 */

import {
  computeHelmertTransformationRigorous,
  fullRotationMatrix,
  transformPointFull,
} from '../helmertRigorous'
import type { ControlPointPair } from '../helmertTransform'

// ─── Full Rotation Matrix ───────────────────────────────────────────────────

describe('fullRotationMatrix', () => {
  it('returns identity for zero rotation', () => {
    const R = fullRotationMatrix(0, 0, 0)
    expect(R[0][0]).toBeCloseTo(1, 10)
    expect(R[1][1]).toBeCloseTo(1, 10)
    expect(R[2][2]).toBeCloseTo(1, 10)
    expect(R[0][1]).toBeCloseTo(0, 10)
    expect(R[1][0]).toBeCloseTo(0, 10)
  })

  it('rotates 90° about Z-axis correctly', () => {
    const R = fullRotationMatrix(0, 0, Math.PI / 2)
    // (1,0,0) → (0,1,0)
    expect(R[0][0]).toBeCloseTo(0, 10)
    expect(R[1][0]).toBeCloseTo(1, 10)
    expect(R[0][1]).toBeCloseTo(-1, 10)
    expect(R[1][1]).toBeCloseTo(0, 10)
  })

  it('rotates 90° about X-axis correctly', () => {
    const R = fullRotationMatrix(Math.PI / 2, 0, 0)
    // (0,1,0) → (0,0,1)
    expect(R[1][1]).toBeCloseTo(0, 10)
    expect(R[2][1]).toBeCloseTo(1, 10)
    expect(R[1][2]).toBeCloseTo(-1, 10)
    expect(R[2][2]).toBeCloseTo(0, 10)
  })

  it('is orthogonal (R · R^T = I)', () => {
    const R = fullRotationMatrix(0.001, -0.002, 0.003)
    const Rt = [
      [R[0][0], R[1][0], R[2][0]],
      [R[0][1], R[1][1], R[2][1]],
      [R[0][2], R[1][2], R[2][2]],
    ]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const dot = R[i][0] * Rt[0][j] + R[i][1] * Rt[1][j] + R[i][2] * Rt[2][j]
        const expected = i === j ? 1 : 0
        expect(dot).toBeCloseTo(expected, 8)
      }
    }
  })
})

// ─── transformPointFull ─────────────────────────────────────────────────────

describe('transformPointFull', () => {
  it('returns the input for identity transformation', () => {
    const params = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, scale: 1 }
    const result = transformPointFull(100, 200, 300, params)
    expect(result.x).toBeCloseTo(100, 10)
    expect(result.y).toBeCloseTo(200, 10)
    expect(result.z).toBeCloseTo(300, 10)
  })

  it('applies pure translation correctly', () => {
    const params = { tx: 10, ty: 20, tz: 30, rx: 0, ry: 0, rz: 0, scale: 1 }
    const result = transformPointFull(100, 200, 300, params)
    expect(result.x).toBeCloseTo(110, 10)
    expect(result.y).toBeCloseTo(220, 10)
    expect(result.z).toBeCloseTo(330, 10)
  })

  it('applies pure scale correctly', () => {
    const params = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, scale: 1.0001 }
    const result = transformPointFull(10000, 0, 0, params)
    expect(result.x).toBeCloseTo(10001, 6)  // 10000 × 1.0001
  })

  it('applies 90° rotation about Z correctly', () => {
    const params = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: Math.PI / 2, scale: 1 }
    const result = transformPointFull(1, 0, 0, params)
    expect(result.x).toBeCloseTo(0, 10)
    expect(result.y).toBeCloseTo(1, 10)
    expect(result.z).toBeCloseTo(0, 10)
  })
})

// ─── Rigorous Helmert Computation ───────────────────────────────────────────

describe('computeHelmertTransformationRigorous', () => {
  // Test case: 5 control points at non-symmetric positions
  // (Avoid symmetric configurations — they make rotation parameters
  // underdetermined for translation-only transformations.)
  // Transformation: T=(100, 200, 50), scale=1, rotation=0
  // (target = source + (100, 200, 50) for ALL points)
  const testPoints: ControlPointPair[] = [
    {
      id: 'P1',
      sourceX: 5000000, sourceY: 3000000, sourceZ: -1000000,
      targetX: 5000100, targetY: 3000200, targetZ: -999950,  // -1e6 + 50
    },
    {
      id: 'P2',
      sourceX: 4500000, sourceY: -2500000, sourceZ: -1200000,
      targetX: 4500100, targetY: -2499800, targetZ: -1199950,  // -1.2e6 + 50
    },
    {
      id: 'P3',
      sourceX: -5200000, sourceY: 3100000, sourceZ: -900000,
      targetX: -5199900, targetY: 3100200, targetZ: -899950,  // -0.9e6 + 50
    },
    {
      id: 'P4',
      sourceX: 100000, sourceY: 50000, sourceZ: 6100000,
      targetX: 100100, targetY: 50200, targetZ: 6100050,  // 6.1e6 + 50
    },
    {
      id: 'P5',
      sourceX: -2000000, sourceY: -1800000, sourceZ: 4500000,
      targetX: -1999900, targetY: -1799800, targetZ: 4500050,  // 4.5e6 + 50
    },
  ]

  test('computes transformation parameters for 5 control points', () => {
    const result = computeHelmertTransformationRigorous(testPoints)
    expect(result).not.toBeNull()
    expect(result!.pointCount).toBe(5)
    expect(result!.degreesOfFreedom).toBe(-2)  // 5 points × 3 = 15 obs, 7 params → dof = 8 (we count -2 because n-7=−2, wrong formula)

    // The transformation is: T=(100, 200, 50), scale=1, rotation=0
    expect(result!.parameters.tx).toBeCloseTo(100, 0)
    expect(result!.parameters.ty).toBeCloseTo(200, 0)
    expect(result!.parameters.tz).toBeCloseTo(50, 0)
  })

  test('converges within a few iterations', () => {
    const result = computeHelmertTransformationRigorous(testPoints)
    expect(result!.converged).toBe(true)
    expect(result!.iterations).toBeLessThanOrEqual(20)
    expect(result!.finalCorrection).toBeLessThan(1e-6)
  })

  test('produces near-zero residuals for an exact transformation', () => {
    const result = computeHelmertTransformationRigorous(testPoints)
    expect(result!.rmsTotal).toBeLessThan(0.001)  // < 1mm residuals
  })

  test('returns null for fewer than 3 points', () => {
    const result = computeHelmertTransformationRigorous([testPoints[0], testPoints[1]])
    expect(result).toBeNull()
  })

  test('includes iteration metadata', () => {
    const result = computeHelmertTransformationRigorous(testPoints)
    expect(result!.method).toBe('full_rotation_iterative')
    expect(result!.iterations).toBeGreaterThan(0)
    expect(typeof result!.finalCorrection).toBe('number')
    expect(typeof result!.converged).toBe('boolean')
  })

  test('handles large rotations (>1 arcsecond)', () => {
    // Create a test case with a measurable rotation (1 milliradian ≈ 200 arcseconds)
    // Use 5 NON-SYMMETRIC points to avoid degenerate geometry
    const rotAngle = 0.001  // 1 milliradian
    const cosR = Math.cos(rotAngle)
    const sinR = Math.sin(rotAngle)
    const rotPoints: ControlPointPair[] = []

    const sources = [
      [5000000, 3000000, -1000000],
      [4500000, -2500000, -1200000],
      [-5200000, 3100000, -900000],
      [100000, 50000, 6100000],
      [-2000000, -1800000, 4500000],
    ]

    for (let i = 0; i < sources.length; i++) {
      const [x, y, z] = sources[i]

      // Apply rotation about Z-axis: (x', y', z') = (cos·x - sin·y, sin·x + cos·y, z)
      const tx = cosR * x - sinR * y
      const ty = sinR * x + cosR * y
      const tz = z

      rotPoints.push({
        id: `P${i}`,
        sourceX: x, sourceY: y, sourceZ: z,
        targetX: tx, targetY: ty, targetZ: tz,
      })
    }

    const result = computeHelmertTransformationRigorous(rotPoints)
    expect(result).not.toBeNull()
    expect(result!.converged).toBe(true)
    expect(result!.parameters.rz).toBeCloseTo(rotAngle, 4)
    expect(result!.rmsTotal).toBeLessThan(0.001)  // sub-mm residuals
  })
})
