import { riseAndFall, heightOfCollimation, LevelingInput } from '../engine/leveling';
import { LevelingResult } from '../engine/types';
import { FieldBookRow } from '@/types/fieldbook';

export interface LevelingComputeInput {
  rows: FieldBookRow[];
  openingRL: number;
  closingRL?: number;
  method: 'rise_and_fall' | 'height_of_collimation';
}

function parseFieldBookRows(rows: FieldBookRow[]): LevelingInput['readings'] {
  return rows
    .filter((r) => r.station && (r.bs || r.is || r.fs))
    .map((r) => ({
      station: String(r.station || ''),
      bs: r.bs !== '' && r.bs !== null ? Number(r.bs) : undefined,
      is: r.is !== '' && r.is !== null ? Number(r.is) : undefined,
      fs: r.fs !== '' && r.fs !== null ? Number(r.fs) : undefined,
    }));
}

function calculateTotalDistance(readings: LevelingInput['readings']): number {
  let total = 0;
  for (let i = 1; i < readings.length; i++) {
    if (readings[i].bs !== undefined) {
      total += 1;
    }
  }
  return total;
}

export function runLevelingComputation(input: LevelingComputeInput): LevelingResult {
  const readings = parseFieldBookRows(input.rows);
  const distanceKm = calculateTotalDistance(readings) / 1000;

  const engineInput: LevelingInput = {
    readings,
    openingRL: input.openingRL,
    closingRL: input.closingRL,
    method: input.method,
    distanceKm: Math.max(distanceKm, 0.001),
  };

  if (input.method === 'height_of_collimation') {
    return heightOfCollimation(engineInput);
  }
  return riseAndFall(engineInput);
}

export function getLevelingClosureStatus(result: LevelingResult): {
  status: 'acceptable' | 'excessive' | 'unknown';
  message: string;
  misclosureMm: number;
  allowableMm: number;
} {
  if (result.allowableMisclosure === 0) {
    return { status: 'unknown', message: 'No closing benchmark provided', misclosureMm: 0, allowableMm: 0 };
  }

  const misclosureMm = Math.abs(result.misclosure) * 1000;
  const allowableMm = result.allowableMisclosure * 1000;

  if (result.isAcceptable) {
    return { status: 'acceptable', message: `Closure within tolerance (${misclosureMm.toFixed(1)}mm / ${allowableMm.toFixed(1)}mm)`, misclosureMm, allowableMm };
  }

  return { status: 'excessive', message: `Closure exceeds tolerance (${misclosureMm.toFixed(1)}mm / ${allowableMm.toFixed(1)}mm)`, misclosureMm, allowableMm };
}
