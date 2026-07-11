/**
 * Calculation standard: N.N. Basak — Surveying and Levelling
 * Source: N.N. Basak, Surveying and Levelling, Chapters 5-7
 * Source: Ghilani & Wolf, Elementary Surveying 16th Ed., Chapters 5-6
 * Source: RDM 1.1 Kenya 2025, Table 5.1 — Allowable misclosure 10√K mm for direct leveling
 * - No intermediate rounding
 * - Full floating point precision throughout
 * - Round only at final display layer
 * - Bearings: WCB 0-360° clockwise from North
 */

// METARDU Engine - Leveling calculations

import { LevelingResult, LevelingReading } from './types';

export interface LevelingInput {
  readings: Array<{
    station: string;
    bs?: number;
    is?: number;
    fs?: number;
  }>;
  openingRL: number;
  closingRL?: number;
  method: 'rise_and_fall' | 'height_of_collimation';
  distanceKm?: number;
}

export function riseAndFall(input: LevelingInput): LevelingResult {
  const { readings, openingRL, closingRL, distanceKm = 1 } = input;

  const results: LevelingReading[] = [{ station: 'BM', reducedLevel: openingRL }];

  let hi: number | null = null;
  let currentRL = openingRL;
  let previousComputedRL = openingRL;
  let lastComputedRL = openingRL;

  const stationRL = new Map<string, number>();
  stationRL.set('BM', openingRL);

  let sumBS = 0;
  let sumFS = 0;
  let sumRise = 0;
  let sumFall = 0;

  for (const reading of readings) {
    const row: LevelingReading = { station: reading.station };

    if (reading.bs !== undefined && reading.bs !== null) {
      const backsightRL = stationRL.get(reading.station) ?? currentRL;
      row.bs = reading.bs;
      row.reducedLevel = backsightRL;
      sumBS += reading.bs;
      hi = backsightRL + reading.bs;
    }

    if (reading.is !== undefined && reading.is !== null) {
      if (hi === null) {
        results.push(row);
        continue;
      }
      row.is = reading.is;
      const rl = hi - reading.is;
      row.reducedLevel = rl;
      stationRL.set(reading.station, rl);

      const diff = rl - previousComputedRL;
      if (diff >= 0) {
        row.rise = diff;
        row.fall = 0;
        sumRise += diff;
      } else {
        row.rise = 0;
        row.fall = Math.abs(diff);
        sumFall += Math.abs(diff);
      }

      previousComputedRL = rl;
      currentRL = rl;
      lastComputedRL = rl;
    }

    if (reading.fs !== undefined && reading.fs !== null) {
      if (hi === null) {
        results.push(row);
        continue;
      }
      row.fs = reading.fs;
      sumFS += reading.fs;

      const rl = hi - reading.fs;
      row.reducedLevel = rl;
      stationRL.set(reading.station, rl);

      const diff = rl - previousComputedRL;
      if (diff >= 0) {
        row.rise = diff;
        row.fall = 0;
        sumRise += diff;
      } else {
        row.rise = 0;
        row.fall = Math.abs(diff);
        sumFall += Math.abs(diff);
      }

      previousComputedRL = rl;
      currentRL = rl;
      lastComputedRL = rl;
    }

    results.push(row);
  }

  const bsFsDiff = (sumBS - sumFS) - (lastComputedRL - openingRL);
  const riseFallDiff = (sumRise - sumFall) - (lastComputedRL - openingRL);
  const arithmeticCheck = Math.abs(bsFsDiff) < 0.001 && Math.abs(riseFallDiff) < 0.001;

  const misclosure = closingRL !== undefined ? (lastComputedRL - closingRL) : 0;

  const allowableMisclosure = 10 * Math.sqrt(distanceKm) / 1000;
  const isAcceptable = closingRL === undefined ? true : Math.abs(misclosure) <= allowableMisclosure;

  if (closingRL !== undefined && isAcceptable && misclosure !== 0) {
    const adjustableIndexes: number[] = [];
    for (let i = 1; i < results.length; i++) {
      if (results[i].reducedLevel !== undefined && (results[i].is !== undefined || results[i].fs !== undefined)) {
        adjustableIndexes.push(i);
      }
    }

    const count = adjustableIndexes.length;
    if (count > 0) {
      for (let j = 0; j < adjustableIndexes.length; j++) {
        const i = adjustableIndexes[j];
        const fraction = (j + 1) / count;
        const adjustment = fraction * misclosure;
        const rl = results[i].reducedLevel as number;
        results[i].adjustedRL = rl - adjustment;
      }
    }
  }

  return {
    readings: results,
    misclosure,
    arithmeticCheck,
    allowableMisclosure,
    isAcceptable,
    method: 'rise_and_fall'
  };
}

export function heightOfCollimation(input: LevelingInput): LevelingResult {
  const { readings, openingRL, closingRL, distanceKm = 1 } = input;

  const results: LevelingReading[] = [{ station: 'BM', reducedLevel: openingRL }];

  let hi: number | null = null;
  let currentRL = openingRL;
  let lastComputedRL = openingRL;

  const stationRL = new Map<string, number>();
  stationRL.set('BM', openingRL);

  let sumBS = 0;
  let sumFS = 0;

  for (const reading of readings) {
    const row: LevelingReading = { station: reading.station };

    if (reading.bs !== undefined && reading.bs !== null) {
      const backsightRL = stationRL.get(reading.station) ?? currentRL;
      row.bs = reading.bs;
      row.reducedLevel = backsightRL;
      sumBS += reading.bs;
      hi = backsightRL + reading.bs;
    }

    if (reading.is !== undefined && reading.is !== null) {
      if (hi === null) {
        results.push(row);
        continue;
      }
      row.is = reading.is;
      const rl = hi - reading.is;
      row.reducedLevel = rl;
      stationRL.set(reading.station, rl);
      currentRL = rl;
      lastComputedRL = rl;
    }

    if (reading.fs !== undefined && reading.fs !== null) {
      if (hi === null) {
        results.push(row);
        continue;
      }
      row.fs = reading.fs;
      sumFS += reading.fs;
      const rl = hi - reading.fs;
      row.reducedLevel = rl;
      stationRL.set(reading.station, rl);
      currentRL = rl;
      lastComputedRL = rl;
    }

    results.push(row);
  }

  const arithmeticDiff = (sumBS - sumFS) - (lastComputedRL - openingRL);
  const arithmeticCheck = Math.abs(arithmeticDiff) < 0.001;

  const misclosure = closingRL !== undefined ? (lastComputedRL - closingRL) : 0;
  const allowableMisclosure = 10 * Math.sqrt(distanceKm) / 1000;
  const isAcceptable = closingRL === undefined ? true : Math.abs(misclosure) <= allowableMisclosure;

  return {
    readings: results,
    misclosure,
    arithmeticCheck,
    allowableMisclosure,
    isAcceptable,
    method: 'height_of_collimation'
  };
}
