import { adjustNetwork, Observation } from '../leastSquares'

describe('adjustNetwork — 2D angle observation', () => {
  it('adjusts a simple triangle with included angles', () => {
    const result = adjustNetwork({
      fixedPoints: [
        { name: 'A', easting: 1000, northing: 1000, rl: 100 },
        { name: 'B', easting: 1100, northing: 1000, rl: 100 },
      ],
      adjustablePoints: [
        { name: 'C', easting: 1050, northing: 1087, rl: 100 },
      ],
      observations: [
        {
          type: 'angle',
          from: 'A',
          to: 'C',
          occupied: 'A',
          backsight: 'B',
          foresight: 'C',
          angle: 60.0,
          angleSigmaArcSec: 5,
        },
        {
          type: 'distance',
          from: 'A',
          to: 'C',
          distance: 100,
          distanceSigma: 0.005,
        },
      ],
      dimension: '2D',
    })
    expect(result.ok).toBe(true)
    expect(result.adjustedPoints.length).toBe(1)
    expect(result.adjustedPoints[0].name).toBe('C')
  })
})

describe('adjustNetwork — 3D adjustment with slope distance + zenith angle', () => {
  it('adjusts a 3D network producing adjusted RLs', () => {
    const result = adjustNetwork({
      fixedPoints: [
        { name: 'A', easting: 1000, northing: 1000, rl: 100.000 },
      ],
      adjustablePoints: [
        { name: 'B', easting: 1100, northing: 1000, rl: 105.000 },
        { name: 'C', easting: 1050, northing: 1087, rl: 102.500 },
      ],
      observations: [
        {
          type: 'slope_distance',
          from: 'A',
          to: 'B',
          slopeDistance: 100.125,
          slopeDistanceSigma: 0.003,
        },
        {
          type: 'zenith_angle',
          from: 'A',
          to: 'B',
          zenithAngle: 87.1345,
          zenithAngleSigmaArcSec: 3,
        },
        {
          type: 'height_difference',
          from: 'A',
          to: 'B',
          heightDifference: 5.0,
          heightDiffSigma: 0.002,
        },
        {
          type: 'distance',
          from: 'A',
          to: 'C',
          distance: 100.0,
          distanceSigma: 0.005,
        },
        {
          type: 'bearing',
          from: 'A',
          to: 'B',
          bearing: 90.0,
          bearingSigmaArcSec: 5,
        },
      ],
      dimension: '3D',
    })
    expect(result.ok).toBe(true)
    expect(result.adjustedPoints[0].rl).toBeDefined()
    expect(Number.isFinite(result.adjustedPoints[0].rl!)).toBe(true)
  })
})

describe('adjustNetwork — 2D backward compatibility', () => {
  it('defaults to 2D when dimension is omitted', () => {
    const result = adjustNetwork({
      fixedPoints: [
        { name: 'A', easting: 1000, northing: 1000 },
        { name: 'B', easting: 1100, northing: 1000 },
      ],
      adjustablePoints: [
        { name: 'C', easting: 1050, northing: 1087 },
      ],
      observations: [
        { from: 'A', to: 'C', distance: 100, distanceSigma: 0.005 },
        { from: 'B', to: 'C', distance: 100, distanceSigma: 0.005 },
        { from: 'A', to: 'B', bearing: 90, bearingSigmaArcSec: 5 },
        { from: 'A', to: 'C', bearing: 60, bearingSigmaArcSec: 5 },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.adjustedPoints[0].name).toBe('C')
    expect(result.adjustedPoints[0].rl).toBeUndefined()
  })
})

describe('adjustNetwork — angle observation partials', () => {
  it('adjusts a network with mixed angle and distance observations', () => {
    const result = adjustNetwork({
      fixedPoints: [
        { name: 'A', easting: 0, northing: 0 },
        { name: 'B', easting: 100, northing: 0 },
      ],
      adjustablePoints: [
        { name: 'C', easting: 50, northing: 86.603 },
      ],
      observations: [
        {
          type: 'angle',
          from: 'A',
          to: 'C',
          occupied: 'A',
          backsight: 'B',
          foresight: 'C',
          angle: 120,
          angleSigmaArcSec: 5,
        },
        {
          type: 'distance',
          from: 'A',
          to: 'C',
          distance: 100,
          distanceSigma: 0.005,
        },
      ],
      dimension: '2D',
    })
    expect(result.ok).toBe(true)
  })
})
