import {
  curvatureRefractionCorrection,
  reduceReciprocalLevelling,
  reduceReciprocalSet,
  meanReciprocalHeightDifference,
  reciprocalStandardDeviation,
} from '../reciprocalLevelling'
import { ReciprocalObservation } from '../digitalLevelTypes'

describe('reciprocalLevelling', () => {
  describe('curvatureRefractionCorrection', () => {
    test('computes C+R correction for 500m distance', () => {
      // C+R = (1-2K)*d^2/(2R)
      // K=0.14, R=6371000m, d=500m
      // = (1-0.28) * 250000 / 12742000
      // = 0.72 * 250000 / 12742000
      // = 180000 / 12742000 ≈ 0.01413m ≈ 14.1mm
      const correction = curvatureRefractionCorrection(500)
      expect(correction).toBeCloseTo(0.01413, 4) // ~14mm
      expect(Math.abs(correction)).toBeGreaterThan(0) // correction is non-zero
    })

    test('correction scales with d squared', () => {
      const c100 = curvatureRefractionCorrection(100)
      const c200 = curvatureRefractionCorrection(200)
      // 200m correction should be ~4x the 100m correction (d^2 scaling)
      expect(c200 / c100).toBeCloseTo(4.0, 1)
    })

    test('correction is zero for zero distance', () => {
      const correction = curvatureRefractionCorrection(0)
      expect(correction).toBe(0)
    })

    test('correction for 1000m distance', () => {
      // (1-0.28) * 1000000 / (2 * 6371000)
      // = 0.72 * 1000000 / 12742000 ≈ 0.0565m
      const correction = curvatureRefractionCorrection(1000)
      expect(correction).toBeCloseTo(0.0565, 3)
    })
  })

  describe('reduceReciprocalLevelling', () => {
    test('computes mean height difference', () => {
      const obs: ReciprocalObservation = {
        stationA: 'A',
        stationB: 'B',
        readingAtA_fromB: 1.500, // staff at A when instrument at B
        readingAtB_fromA: 0.800, // staff at B when instrument at A
        distance: 500,
      }

      const result = reduceReciprocalLevelling(obs)
      // mean = (1.500 - 0.800) / 2 = 0.350
      expect(result.meanHeightDifference).toBeCloseTo(0.35, 3)
      expect(result.stationA).toBe('A')
      expect(result.stationB).toBe('B')
    })

    test('includes curvature and refraction correction', () => {
      const obs: ReciprocalObservation = {
        stationA: 'A',
        stationB: 'B',
        readingAtA_fromB: 1.500,
        readingAtB_fromA: 0.800,
        distance: 500,
      }

      const result = reduceReciprocalLevelling(obs)
      expect(result.correctionForCurvatureAndRefraction).toBeDefined()
      expect(Math.abs(result.correctionForCurvatureAndRefraction)).toBeGreaterThan(0)
    })

    test('precision is computed in mm', () => {
      const obs: ReciprocalObservation = {
        stationA: 'A',
        stationB: 'B',
        readingAtA_fromB: 1.500,
        readingAtB_fromA: 0.800,
        distance: 500,
      }

      const result = reduceReciprocalLevelling(obs)
      expect(result.precision).toBeGreaterThan(0)
      // precision = |readingAtA - readingAtB| * 1000 / 2
      expect(result.precision).toBeCloseTo(350, 0) // |1.5 - 0.8| * 500
    })

    test('equal readings give zero height difference', () => {
      const obs: ReciprocalObservation = {
        stationA: 'A',
        stationB: 'B',
        readingAtA_fromB: 1.200,
        readingAtB_fromA: 1.200,
        distance: 300,
      }

      const result = reduceReciprocalLevelling(obs)
      expect(result.meanHeightDifference).toBeCloseTo(0, 5)
    })
  })

  describe('reduceReciprocalSet', () => {
    test('reduces multiple reciprocal observations', () => {
      const observations: ReciprocalObservation[] = [
        { stationA: 'A', stationB: 'B', readingAtA_fromB: 1.500, readingAtB_fromA: 0.800, distance: 500 },
        { stationA: 'B', stationB: 'C', readingAtA_fromB: 1.300, readingAtB_fromA: 0.600, distance: 400 },
      ]

      const results = reduceReciprocalSet(observations)
      expect(results).toHaveLength(2)
      expect(results[0].stationA).toBe('A')
      expect(results[0].stationB).toBe('B')
      expect(results[1].stationA).toBe('B')
      expect(results[1].stationB).toBe('C')
    })

    test('returns empty array for empty input', () => {
      const results = reduceReciprocalSet([])
      expect(results).toHaveLength(0)
    })
  })

  describe('meanReciprocalHeightDifference', () => {
    test('computes mean across multiple results', () => {
      const results = [
        { stationA: 'A', stationB: 'B', meanHeightDifference: 0.350, correctionForCurvatureAndRefraction: 0.014, meanStaffReadingA: 1.5, meanStaffReadingB: 0.8, precision: 350 },
        { stationA: 'A', stationB: 'B', meanHeightDifference: 0.370, correctionForCurvatureAndRefraction: 0.014, meanStaffReadingA: 1.52, meanStaffReadingB: 0.78, precision: 370 },
      ]
      const mean = meanReciprocalHeightDifference(results)
      expect(mean).toBeCloseTo(0.360, 3)
    })

    test('returns zero for empty input', () => {
      expect(meanReciprocalHeightDifference([])).toBe(0)
    })
  })

  describe('reciprocalStandardDeviation', () => {
    test('computes standard deviation of results', () => {
      const results = [
        { stationA: 'A', stationB: 'B', meanHeightDifference: 0.350, correctionForCurvatureAndRefraction: 0.014, meanStaffReadingA: 1.5, meanStaffReadingB: 0.8, precision: 350 },
        { stationA: 'A', stationB: 'B', meanHeightDifference: 0.370, correctionForCurvatureAndRefraction: 0.014, meanStaffReadingA: 1.52, meanStaffReadingB: 0.78, precision: 370 },
        { stationA: 'A', stationB: 'B', meanHeightDifference: 0.360, correctionForCurvatureAndRefraction: 0.014, meanStaffReadingA: 1.51, meanStaffReadingB: 0.79, precision: 360 },
      ]
      const std = reciprocalStandardDeviation(results)
      // Mean = 0.360, deviations = [-0.01, 0.01, 0.00]
      // variance = (0.0001 + 0.0001 + 0) / 2 = 0.0001
      // std = sqrt(0.0001) ≈ 0.01
      expect(std).toBeCloseTo(0.01, 2)
    })

    test('returns zero for single result', () => {
      const results = [
        { stationA: 'A', stationB: 'B', meanHeightDifference: 0.35, correctionForCurvatureAndRefraction: 0.014, meanStaffReadingA: 1.5, meanStaffReadingB: 0.8, precision: 350 },
      ]
      expect(reciprocalStandardDeviation(results)).toBe(0)
    })

    test('returns zero for empty input', () => {
      expect(reciprocalStandardDeviation([])).toBe(0)
    })
  })
})
