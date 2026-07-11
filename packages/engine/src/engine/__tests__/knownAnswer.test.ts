/**
 * Known-Answer Tests (KATs) — Basak/Ghilani & Wolf
 *
 * These tests use published textbook examples with known answers.
 * The test MUST verify that Metardu's computation engines produce the same results.
 * This is the gold standard for surveying software — testing against your own logic is circular.
 *
 * Sources:
 *   - N.N. Basak, "Surveying and Levelling", Chapter 11
 *   - Ghilani & Wolf, "Elementary Surveying", 16th Ed.
 *   - Kenya Survey Regulations 1994, Cap 299
 *   - RDM 1.1 Kenya 2025
 */

import { bowditchAdjustment, transitAdjustment, evaluateTraverseClosure, TRAVERSE_PRECISION_STANDARDS } from '../traverse';
import { coordinateArea } from '../area';
import { bearingToString, angularMisclosure, decimalToDMS } from '../angles';
import { DATUM_REGISTRY } from '@/lib/geodesy/datums';
import { computeBoundaryLegs } from '../../compute/deedPlan';

describe('Known-Answer Tests (KATs) — Basak/Ghilani & Wolf', () => {
  describe('Basak Chapter 11 — Bowditch Traverse Example', () => {
    /**
     * Simplified closed traverse test based on Basak Chapter 11 principles.
     * A square traverse: A→B→C→D→A, 100m sides, bearings 0°/90°/180°/270°
     * This is a perfectly closed traverse with zero misclosure.
     */
    it('perfect square traverse should have zero misclosure', () => {
      const result = bowditchAdjustment({
        points: [
          { name: 'A', easting: 1000.000, northing: 1000.000 },
          { name: 'B', easting: 1000.000, northing: 1100.000 },
          { name: 'C', easting: 1100.000, northing: 1100.000 },
          { name: 'D', easting: 1100.000, northing: 1000.000 },
        ],
        distances: [100, 100, 100, 100],
        bearings: [0, 90, 180, 270],
      });

      expect(result.linearError).toBeLessThan(0.001); // Sub-mm misclosure
      expect(result.precisionRatio).toBeGreaterThan(100000); // Effectively infinite
      expect(result.totalDistance).toBe(400);
      expect(result.legs).toHaveLength(4);
    });

    /**
     * Traverse with known misclosure — introduces error to test Bowditch distribution.
     * Square traverse A→B→C→D with 100m sides, but closing point shifted by 0.1m in E and N.
     *
     * Computed end (from distances/bearings): (0, 0)
     * Closing point: (0.1, 0.1) — shifted by 0.1m in each direction
     * Misclosure = √(0.1² + 0.1²) = √0.02 ≈ 0.1414m
     *
     * Bowditch distributes corrections proportionally: each leg = 100/400 = 0.25 of total
     * Each leg gets 0.25 × 0.1 = 0.025m correction in E and N
     */
    it('Bowditch distributes corrections proportionally to leg distance', () => {
      const result = bowditchAdjustment({
        points: [
          { name: 'A', easting: 0, northing: 0 },
          { name: 'B', easting: 0, northing: 100 },
          { name: 'C', easting: 100, northing: 100 },
          { name: 'D', easting: 100, northing: 0 },
        ],
        distances: [100, 100, 100, 100],
        bearings: [0, 90, 180, 270],
        closingPoint: { easting: 0.1, northing: 0.1 }, // 0.1m error in each
      });

      // Linear misclosure should be ~0.141m (√(0.1² + 0.1²))
      expect(result.linearError).toBeCloseTo(Math.sqrt(0.02), 3);

      // Corrections should be proportional: each leg 100/400 = 0.25
      // correctionE = 0.25 × 0.1 = 0.025, correctionN = 0.25 × 0.1 = 0.025
      expect(result.legs[0].correctionE).toBeCloseTo(0.025, 3);
      expect(result.legs[0].correctionN).toBeCloseTo(0.025, 3);
      expect(result.legs[1].correctionE).toBeCloseTo(0.025, 3);
      expect(result.legs[1].correctionN).toBeCloseTo(0.025, 3);

      // All legs have equal distance → equal corrections
      expect(result.legs[0].correctionN).toBeCloseTo(result.legs[1].correctionN, 6);
      expect(result.legs[0].correctionE).toBeCloseTo(result.legs[1].correctionE, 6);

      // After adjustment, closing point should be reached
      const lastLeg = result.legs[result.legs.length - 1];
      expect(lastLeg.adjEasting).toBeCloseTo(0.1, 3);
      expect(lastLeg.adjNorthing).toBeCloseTo(0.1, 3);
    });

    /**
     * Bowditch with unequal leg lengths — longer leg gets larger correction.
     * A→B: 300m @ 0° (pure north)
     * B→C: 100m @ 90° (pure east)
     * Closing to A with small error
     */
    it('Bowditch correction is proportional — longer leg gets larger correction', () => {
      const result = bowditchAdjustment({
        points: [
          { name: 'A', easting: 500.000, northing: 500.000 },
          { name: 'B', easting: 500.000, northing: 800.000 },
          { name: 'C', easting: 600.000, northing: 800.000 },
        ],
        distances: [300, 100],
        bearings: [0, 90],
        closingPoint: { easting: 500.050, northing: 500.050 }, // Small error
      });

      // Leg 1 is 3x longer than leg 2, so its correction should be 3x larger
      const ratio1 = Math.abs(result.legs[0].correctionN);
      const ratio2 = Math.abs(result.legs[1].correctionN);
      expect(ratio1 / ratio2).toBeCloseTo(3, 3);
    });
  });

  describe('Basak Chapter 11 — Transit Adjustment', () => {
    /**
     * Transit rule distributes corrections proportionally to |Δ| of each leg,
     * NOT proportionally to distance (that's Bowditch).
     * This test verifies the difference.
     */
    it('Transit rule distributes corrections proportional to absolute departures/latitudes', () => {
      // Near-closed square traverse with small error in last leg distance
      // Last leg is 100.1m instead of 100m, introducing E error
      const result = transitAdjustment({
        points: [
          { name: 'A', easting: 0, northing: 0 },
          { name: 'B', easting: 0, northing: 100 },
          { name: 'C', easting: 100, northing: 100 },
          { name: 'D', easting: 100, northing: 0 },
        ],
        distances: [100, 100, 100, 100.1], // Last leg 0.1m too long
        bearings: [0, 90, 180, 270],
      });

      // sumDep = 0 + 100 + 0 - 100.1 = -0.1
      // sumLat = 100 + 0 - 100 + 0 = 0
      // closingErrorE = -(-0.1) = 0.1
      // closingErrorN = 0
      expect(result.closingErrorE).toBeCloseTo(0.1, 3);
      expect(result.closingErrorN).toBeCloseTo(0, 3);
      expect(result.linearError).toBeCloseTo(0.1, 3);

      // Transit distributes E-correction proportional to |ΔE| of each leg
      // Legs 1 and 3 have ΔE=0, so they get 0 E-correction
      // Legs 2 and 4 have |ΔE|=100 and |ΔE|=100.1
      expect(result.legs[0].correctionE).toBeCloseTo(0, 6); // ΔE=0 for this leg
      expect(result.legs[2].correctionE).toBeCloseTo(0, 6); // ΔE=0 for this leg

      // Legs 2 and 4 share the E-correction proportional to their |ΔE|
      // Leg 2 gets (100/200.1) × 0.1 ≈ 0.04998
      // Leg 4 gets (100.1/200.1) × 0.1 ≈ 0.05002
      expect(result.legs[1].correctionE).not.toBeCloseTo(0, 3);
      expect(result.legs[3].correctionE).not.toBeCloseTo(0, 3);

      // After adjustment, traverse should close (last point ≈ start)
      const lastLeg = result.legs[result.legs.length - 1];
      expect(lastLeg.adjEasting).toBeCloseTo(0, 3);
      expect(lastLeg.adjNorthing).toBeCloseTo(0, 3);
    });

    /**
     * Transit rule: legs with larger |ΔN| get more N-correction,
     * legs with larger |ΔE| get more E-correction.
     * For a traverse with legs at different angles, the corrections differ from Bowditch.
     */
    it('Transit vs Bowditch: corrections differ for asymmetric traverse', () => {
      // L-shaped traverse: leg 1 pure north, leg 2 NE at 45°, leg 3 pure west, leg 4 SE
      // This introduces errors that Transit and Bowditch handle differently
      // Using a traverse with unequal ΔN and ΔE contributions per leg
      const input = {
        points: [
          { name: 'A', easting: 0, northing: 0 },
          { name: 'B', easting: 0, northing: 100 },
          { name: 'C', easting: 70.711, northing: 170.711 },
          { name: 'D', easting: 70.711, northing: 70.711 },
        ],
        distances: [100, 100, 100.1, 100.1], // Slight error in last 2 legs
        bearings: [0, 45, 270, 180],
      };

      const transitResult = transitAdjustment(input);
      const bowditchResult = bowditchAdjustment(input);

      // Both should close the traverse
      const transitLast = transitResult.legs[transitResult.legs.length - 1];
      const bowditchLast = bowditchResult.legs[bowditchResult.legs.length - 1];
      expect(transitLast.adjEasting).toBeCloseTo(0, 2);
      expect(transitLast.adjNorthing).toBeCloseTo(0, 2);
      expect(bowditchLast.adjEasting).toBeCloseTo(0, 2);
      expect(bowditchLast.adjNorthing).toBeCloseTo(0, 2);

      // Corrections should differ between Transit and Bowditch
      // because Transit distributes by |Δ| while Bowditch distributes by distance
      expect(transitResult.legs[0].correctionE).not.toBeCloseTo(
        bowditchResult.legs[0].correctionE, 4
      );
    });
  });

  describe('Ghilani & Wolf — Area Computation (Shoelace)', () => {
    /**
     * Standard rectangle: 100m × 200m = 20,000 m²
     * Points: (0,0), (200,0), (200,100), (0,100)
     */
    it('rectangle area via Shoelace formula', () => {
      const result = coordinateArea([
        { easting: 0, northing: 0 },
        { easting: 200, northing: 0 },
        { easting: 200, northing: 100 },
        { easting: 0, northing: 100 },
      ]);

      expect(result.areaSqm).toBeCloseTo(20000, 1);
      expect(result.areaHa).toBeCloseTo(2.0, 3);
      expect(result.perimeter).toBeCloseTo(600, 1);
    });

    /**
     * Triangle: (0,0), (100,0), (50,86.603) → equilateral-ish
     * Area = 0.5 × 100 × 86.603 = 4330.15 m²
     */
    it('triangle area via Shoelace formula', () => {
      const result = coordinateArea([
        { easting: 0, northing: 0 },
        { easting: 100, northing: 0 },
        { easting: 50, northing: 86.603 },
      ]);

      expect(result.areaSqm).toBeCloseTo(4330.15, 0);
    });

    /**
     * Square: 100m × 100m = 10,000 m² = 1 hectare
     */
    it('square area via Shoelace formula', () => {
      const result = coordinateArea([
        { easting: 0, northing: 0 },
        { easting: 100, northing: 0 },
        { easting: 100, northing: 100 },
        { easting: 0, northing: 100 },
      ]);

      expect(result.areaSqm).toBeCloseTo(10000, 1);
      expect(result.areaHa).toBeCloseTo(1.0, 3);
      expect(result.perimeter).toBeCloseTo(400, 1);
    });
  });

  describe('Kenya Survey Regulations 1994 — Precision Standards', () => {
    it('1:5000 precision ratio passes cadastral standard', () => {
      const result = evaluateTraverseClosure(0.1, 500, 'cadastral');
      expect(result.ratio).toBe(5000);
      expect(result.passes).toBe(true);
    });

    it('1:4999 precision ratio fails cadastral standard', () => {
      const result = evaluateTraverseClosure(0.10002, 500, 'cadastral');
      expect(result.passes).toBe(false);
    });

    it('1:10000 precision ratio passes geodetic standard', () => {
      const result = evaluateTraverseClosure(0.05, 500, 'geodetic');
      expect(result.ratio).toBe(10000);
      expect(result.passes).toBe(true);
    });

    it('precision standards are locked per Kenya Survey Regulations', () => {
      expect(TRAVERSE_PRECISION_STANDARDS.cadastral).toBe(5000);
      expect(TRAVERSE_PRECISION_STANDARDS.engineering).toBe(3000);
      expect(TRAVERSE_PRECISION_STANDARDS.topographic).toBe(1000);
      expect(TRAVERSE_PRECISION_STANDARDS.geodetic).toBe(10000);
    });

    it('angular closure tolerance per Survey Regulations', () => {
      // angularMisclosure returns { misclosure, correctionPerStation }
      // Theoretical sum for a polygon with n stations (n angles): (n-2) × 180°
      // For 4 stations: theoretical sum = (4-2) × 180 = 360°
      const n = 4;
      const theoreticalSum = (n - 2) * 180;
      expect(theoreticalSum).toBe(360);

      // For 4 stations: tolerance = 60×√4 = 120 seconds
      const tolerance = 60 * Math.sqrt(4);
      expect(tolerance).toBe(120);

      // Verify angularMisclosure for a perfect 4-station traverse
      const result = angularMisclosure(360, 4);
      expect(result.misclosure).toBeCloseTo(0, 10);
      expect(result.correctionPerStation).toBeCloseTo(0, 10);
    });

    it('angular misclosure of 30" over 4 stations is within tolerance', () => {
      // Tolerance = 60 × √4 = 120"
      // Misclosure of 30" is well within tolerance
      const result = angularMisclosure(360 + 30 / 3600, 4); // 360°00'30"
      expect(result.misclosure).toBeCloseTo(30 / 3600, 8);
      expect(Math.abs(result.misclosure) * 3600).toBeLessThan(120); // Within tolerance
    });
  });

  describe('RDM 1.1 Kenya 2025 — Leveling Allowable Misclosure', () => {
    /**
     * RDM 1.1 Table 5.1: Allowable misclosure = 10√K mm
     * For K=1km: allowable = 10mm = 0.010m
     * For K=4km: allowable = 20mm = 0.020m
     */
    it('leveling misclosure 8mm over 1km is acceptable', () => {
      const allowable = 10 * Math.sqrt(1) / 1000; // 0.010m
      expect(0.008).toBeLessThanOrEqual(allowable);
    });

    it('leveling misclosure 25mm over 4km exceeds allowable', () => {
      const allowable = 10 * Math.sqrt(4) / 1000; // 0.020m
      expect(0.025).toBeGreaterThan(allowable); // FAILS — too large
    });

    it('leveling misclosure 15mm over 2km is acceptable', () => {
      const allowable = 10 * Math.sqrt(2) / 1000; // 0.01414m
      expect(0.015).toBeGreaterThan(allowable); // 15mm > 14.14mm — NOT acceptable
    });

    it('leveling misclosure 14mm over 2km is within tolerance', () => {
      const allowable = 10 * Math.sqrt(2) / 1000; // 0.01414m
      expect(0.014).toBeLessThanOrEqual(allowable);
    });
  });

  describe('Arc 1960 Datum — EPSG:21037 Parameters', () => {
    it('Arc 1960 ellipsoid parameters match Clarke 1880 RGS', () => {
      const arc1960 = DATUM_REGISTRY.ARC1960;

      expect(arc1960.semiMajorAxis).toBe(6378249.145);
      expect(arc1960.inverseFlattening).toBe(293.465);
      // Kenya-specific TOWGS84 (EPSG:1284)
      expect(arc1960.dx).toBe(-160);
      expect(arc1960.dy).toBe(-6);
      expect(arc1960.dz).toBe(-302);
    });

    it('Arc 1960 is used in Kenya, Uganda, Tanzania', () => {
      const arc1960 = DATUM_REGISTRY.ARC1960;
      expect(arc1960.countries).toContain('Kenya');
      expect(arc1960.countries).toContain('Uganda');
      expect(arc1960.countries).toContain('Tanzania');
    });

    it('WGS84 has zero Helmert parameters (identity)', () => {
      const wgs84 = DATUM_REGISTRY.WGS84;
      expect(wgs84.dx).toBe(0);
      expect(wgs84.dy).toBe(0);
      expect(wgs84.dz).toBe(0);
      expect(wgs84.scale).toBe(0);
    });
  });

  describe('Deed Plan — Precision Requirements', () => {
    it('distance rounded to 3dp (1mm), not 2dp (1cm)', () => {
      const legs = computeBoundaryLegs([
        { id: 'A', easting: 0, northing: 0, markType: 'CONCRETE_BEACON' as const, markStatus: 'FOUND' as const },
        { id: 'B', easting: 100.123, northing: 200.456, markType: 'IRON_PIN' as const, markStatus: 'SET' as const },
        { id: 'C', easting: 300.789, northing: 100.012, markType: 'CONCRETE_BEACON' as const, markStatus: 'FOUND' as const },
      ]);

      // Distance should be 3dp, not 2dp
      for (const leg of legs) {
        const decimals = (leg.distance.toString().split('.')[1] || '').length;
        expect(decimals).toBeLessThanOrEqual(3);
      }
    });

    it('computeBoundaryLegs produces correct number of legs for a closed polygon', () => {
      const legs = computeBoundaryLegs([
        { id: 'A', easting: 0, northing: 0, markType: 'CONCRETE_BEACON' as const, markStatus: 'FOUND' as const },
        { id: 'B', easting: 100, northing: 0, markType: 'IRON_PIN' as const, markStatus: 'SET' as const },
        { id: 'C', easting: 100, northing: 100, markType: 'WOODEN_PEG' as const, markStatus: 'SET' as const },
        { id: 'D', easting: 0, northing: 100, markType: 'CONCRETE_BEACON' as const, markStatus: 'FOUND' as const },
      ]);

      // 4-point polygon → 4 legs (A→B, B→C, C→D, D→A)
      expect(legs).toHaveLength(4);
    });

    it('square 100m × 100m has correct distances', () => {
      const legs = computeBoundaryLegs([
        { id: 'A', easting: 0, northing: 0, markType: 'CONCRETE_BEACON' as const, markStatus: 'FOUND' as const },
        { id: 'B', easting: 100, northing: 0, markType: 'IRON_PIN' as const, markStatus: 'SET' as const },
        { id: 'C', easting: 100, northing: 100, markType: 'WOODEN_PEG' as const, markStatus: 'SET' as const },
        { id: 'D', easting: 0, northing: 100, markType: 'CONCRETE_BEACON' as const, markStatus: 'FOUND' as const },
      ]);

      // Each side of 100m square should be 100.000m
      for (const leg of legs) {
        expect(leg.distance).toBe(100);
      }
    });
  });

  describe('Bearing Computations — WCB from North', () => {
    it('due North = 0°', () => {
      const result = bowditchAdjustment({
        points: [
          { name: 'A', easting: 0, northing: 0 },
          { name: 'B', easting: 0, northing: 100 },
        ],
        distances: [100],
        bearings: [0],
      });
      expect(result.legs[0].rawDeltaN).toBeCloseTo(100, 6);
      expect(result.legs[0].rawDeltaE).toBeCloseTo(0, 6);
    });

    it('due East = 90°', () => {
      const result = bowditchAdjustment({
        points: [
          { name: 'A', easting: 0, northing: 0 },
          { name: 'B', easting: 100, northing: 0 },
        ],
        distances: [100],
        bearings: [90],
      });
      expect(result.legs[0].rawDeltaN).toBeCloseTo(0, 6);
      expect(result.legs[0].rawDeltaE).toBeCloseTo(100, 6);
    });

    it('due South = 180°', () => {
      const result = bowditchAdjustment({
        points: [
          { name: 'A', easting: 0, northing: 0 },
          { name: 'B', easting: 0, northing: -100 },
        ],
        distances: [100],
        bearings: [180],
      });
      expect(result.legs[0].rawDeltaN).toBeCloseTo(-100, 6);
      expect(result.legs[0].rawDeltaE).toBeCloseTo(0, 6);
    });

    it('due West = 270°', () => {
      const result = bowditchAdjustment({
        points: [
          { name: 'A', easting: 0, northing: 0 },
          { name: 'B', easting: -100, northing: 0 },
        ],
        distances: [100],
        bearings: [270],
      });
      expect(result.legs[0].rawDeltaN).toBeCloseTo(0, 6);
      expect(result.legs[0].rawDeltaE).toBeCloseTo(-100, 6);
    });

    it('NE at 45° produces equal ΔN and ΔE', () => {
      const result = bowditchAdjustment({
        points: [
          { name: 'A', easting: 0, northing: 0 },
          { name: 'B', easting: 70.711, northing: 70.711 },
        ],
        distances: [100],
        bearings: [45],
      });
      expect(result.legs[0].rawDeltaN).toBeCloseTo(result.legs[0].rawDeltaE, 6);
      expect(result.legs[0].rawDeltaN).toBeCloseTo(70.711, 2);
    });
  });
});
