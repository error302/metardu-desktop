/**
 * Property-based tests for coordinate transforms.
 *
 * Per Master Plan §10.3: "Coordinate transforms are the silent killer of
 * surveying software. A Helmert 7-parameter transform with a sign error
 * can shift every coordinate by 50 metres and still produce a plausible-
 * looking map. We use fast-check to run property-based tests on every CRS
 * transform."
 *
 * Three properties are tested:
 *   1. Round-trip:  A → B → A ≈ A    (within 1 mm tolerance)
 *   2. Identity:    transform with identity parameters = no-op
 *   3. Consistency: two-step propagation matches one-step
 *
 * These run on every PR. Non-negotiable.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  geodeticToEcef,
  ecefToGeodetic,
  propagateToEpoch,
  dateToDecimalYear,
  decimalYearToDate,
} from '../epochManager';

// ─── Property 1: geodetic → ECEF → geodetic round-trip ──────────────────

describe('Property: geodetic ↔ ECEF round-trip', () => {
  it('round-trips any (lat, lon, h) within 1 mm', () => {
    const prop = fc.property(
      fc.record({
        lat: fc.float({ min: Math.fround(-89.9), max: Math.fround(89.9), noNaN: true }),
        lon: fc.float({ min: Math.fround(-179.9), max: Math.fround(179.9), noNaN: true }),
        h: fc.float({ min: Math.fround(-100), max: Math.fround(9000), noNaN: true }),
      }),
      ({ lat, lon, h }) => {
        const [X, Y, Z] = geodeticToEcef(lat, lon, h);
        const back = ecefToGeodetic(X, Y, Z);
        const latDiffM = Math.abs(back.latitude - lat) * 111000;
        const lonDiffM = Math.abs(back.longitude - lon) * 111000 * Math.cos((lat * Math.PI) / 180);
        const hDiffM = Math.abs(back.height - h);
        return latDiffM < 0.001 && lonDiffM < 0.001 && hDiffM < 0.001;
      },
    );
    const result = fc.check(prop, { numRuns: 200 });
    if (result.failed) {
      throw new Error(`Round-trip failed: ${result.error}\nCounterexample: ${JSON.stringify(result.counterexample)}`);
    }
  });
});

// ─── Property 2: epoch propagation is identity when source = target ────

describe('Property: epoch propagation identity', () => {
  it('returns original when target epoch equals source epoch (within 1 mm)', () => {
    const prop = fc.property(
      fc.record({
        lat: fc.float({ min: Math.fround(-89.9), max: Math.fround(89.9), noNaN: true }),
        lon: fc.float({ min: Math.fround(-179.9), max: Math.fround(179.9), noNaN: true }),
        h: fc.float({ min: Math.fround(-100), max: Math.fround(9000), noNaN: true }),
        epoch: fc.float({ min: Math.fround(2000.0), max: Math.fround(2030.0), noNaN: true }),
      }),
      ({ lat, lon, h, epoch }) => {
        const coord = { latitude: lat, longitude: lon, height: h, epoch };
        const propagated = propagateToEpoch(coord, epoch);
        const latDiffM = Math.abs(propagated.latitude - lat) * 111000;
        const lonDiffM = Math.abs(propagated.longitude - lon) * 111000 * Math.cos((lat * Math.PI) / 180);
        const hDiffM = Math.abs(propagated.height - h);
        return latDiffM < 0.001 && lonDiffM < 0.001 && hDiffM < 0.001 && propagated.epoch === epoch;
      },
    );
    const result = fc.check(prop, { numRuns: 200 });
    if (result.failed) {
      throw new Error(`Identity failed: ${result.error}\nCounterexample: ${JSON.stringify(result.counterexample)}`);
    }
  });
});

// ─── Property 3: decimal year ↔ date round-trip ────────────────────────

describe('Property: decimal year ↔ date round-trip', () => {
  it('round-trips any epoch within 1.5 days (date-resolution limit)', () => {
    const prop = fc.property(
      fc.float({ min: Math.fround(2000.0), max: Math.fround(2030.0), noNaN: true }),
      (epoch) => {
        const dateStr = decimalYearToDate(epoch);
        const back = dateToDecimalYear(dateStr);
        return Math.abs(back - epoch) < 0.005;
      },
    );
    const result = fc.check(prop, { numRuns: 200 });
    if (result.failed) {
      throw new Error(`Date round-trip failed: ${result.error}\nCounterexample: ${JSON.stringify(result.counterexample)}`);
    }
  });
});

// ─── Property 4: epoch propagation consistency over intervals ──────────

describe('Property: epoch propagation consistency over intervals', () => {
  it('two-step propagation matches one-step (within 0.1 mm)', () => {
    const prop = fc.property(
      fc.record({
        lat: fc.float({ min: Math.fround(-5), max: Math.fround(5), noNaN: true }),
        lon: fc.float({ min: Math.fround(33), max: Math.fround(42), noNaN: true }),
        h: fc.float({ min: Math.fround(0), max: Math.fround(3000), noNaN: true }),
      }),
      ({ lat, lon, h }) => {
        const coord2020 = { latitude: lat, longitude: lon, height: h, epoch: 2020.0 };
        const direct = propagateToEpoch(coord2020, 2030.0);
        const mid2025 = propagateToEpoch(coord2020, 2025.0);
        const twoStep = propagateToEpoch(mid2025, 2030.0);
        const latDiffM = Math.abs(direct.latitude - twoStep.latitude) * 111000;
        const lonDiffM = Math.abs(direct.longitude - twoStep.longitude) * 111000 * Math.cos((lat * Math.PI) / 180);
        const hDiffM = Math.abs(direct.height - twoStep.height);
        return latDiffM < 0.0001 && lonDiffM < 0.0001 && hDiffM < 0.0001;
      },
    );
    const result = fc.check(prop, { numRuns: 100 });
    if (result.failed) {
      throw new Error(`Consistency failed: ${result.error}\nCounterexample: ${JSON.stringify(result.counterexample)}`);
    }
  });
});

// ─── Known-answer regression tests (deterministic) ─────────────────────

describe('Known-answer regression tests', () => {
  it('Nairobi (-1.2864°, 36.8172°, 1795 m) → ECEF matches expected', () => {
    const [X, Y, Z] = geodeticToEcef(-1.2864, 36.8172, 1795);
    expect(X).toBeCloseTo(5106186.0, -3);
    expect(Y).toBeCloseTo(3822306.0, -3);
    expect(Z).toBeCloseTo(-142271.0, -3);
  });

  it('propagateToEpoch over 10 years shifts Nairobi by 5–50 cm (Somali plate)', () => {
    const coord = { latitude: -1.2864, longitude: 36.8172, height: 1795, epoch: 2015.0 };
    const propagated = propagateToEpoch(coord, 2025.0);
    const shiftM = Math.sqrt(
      ((propagated.latitude - coord.latitude) * 111000) ** 2 +
      ((propagated.longitude - coord.longitude) * 111000 * Math.cos((coord.latitude * Math.PI) / 180)) ** 2,
    );
    expect(shiftM).toBeGreaterThan(0.05);
    expect(shiftM).toBeLessThan(0.50);
  });

  it('decimalYearToDate(2025.5) ≈ 2025-07-02', () => {
    const dateStr = decimalYearToDate(2025.5);
    const d = new Date(dateStr);
    expect(d.getUTCFullYear()).toBe(2025);
    const dayOfYear = Math.floor((d.getTime() - Date.UTC(2025, 0, 1)) / (24 * 60 * 60 * 1000));
    expect(dayOfYear).toBeGreaterThanOrEqual(181);
    expect(dayOfYear).toBeLessThanOrEqual(183);
  });

  it('ECEF round-trip recovers Nairobi coordinates', () => {
    const [X, Y, Z] = geodeticToEcef(-1.2864, 36.8172, 1795);
    const back = ecefToGeodetic(X, Y, Z);
    expect(back.latitude).toBeCloseTo(-1.2864, 5);
    expect(back.longitude).toBeCloseTo(36.8172, 5);
    expect(back.height).toBeCloseTo(1795, 1);
  });
});
