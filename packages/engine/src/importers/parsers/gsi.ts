/**
 * Leica GSI Parser — Professional Grade
 *
 * Supports:
 *  - GSI-8  (16-char word blocks)
 *  - GSI-16 (24-char word blocks)
 *  - All standard Leica word indices (WI 11–88)
 *  - Face Left / Face Right detection and mean face reduction
 *  - Feature code extraction (WI 71)
 *  - Instrument height (WI 88) and target/prism height (WI 87)
 *  - Automatic sign handling (+/-)
 *
 * Reference: Leica Geosystems GSI Online Format Description
 *
 * GSI Word Structure (GSI-16 example):
 *   Position  1:    '*' line start marker
 *   Position  2–3:  Word Index (WI)
 *   Position  4:    additional info / data ID extension
 *   Position  5:    decimal/sign indicator
 *   Position  6–7:  unused (padding or extension)
 *   Position  8–24: data value (right-justified, zero-padded)
 *
 * GSI-8: each word block is 16 characters
 * GSI-16: each word block is 24 characters
 */

import { registerParser } from '../registry';
import { ParseResult, ParsedPoint } from '@/types/importer';

// ─── Word Index Definitions ──────────────────────────────────────────────────

/** All recognized Leica GSI Word Indices with their meaning and unit info. */
const GSI_WORD_INDEX: Record<string, {
  field: string;
  description: string;
  divisor: number; // value is divided by this to get the final unit
}> = {
  '11': { field: 'point_id',        description: 'Point number',                  divisor: 1    },
  '12': { field: 'serial_no',       description: 'Instrument serial number',      divisor: 1    },
  '13': { field: 'instrument_no',   description: 'Instrument number',             divisor: 1    },
  '18': { field: 'time_stamp',      description: 'Time stamp',                    divisor: 1    },
  '19': { field: 'date_stamp',      description: 'Date stamp',                    divisor: 1    },

  '21': { field: 'hz_angle',        description: 'Horizontal angle',              divisor: 100000 }, // gon → needs conversion
  '22': { field: 'v_angle',         description: 'Vertical angle',                divisor: 100000 },
  '23': { field: 'hz_angle_avg',    description: 'Hz angle (averaged)',            divisor: 100000 },
  '24': { field: 'v_angle_avg',     description: 'V angle (averaged)',             divisor: 100000 },
  '25': { field: 'hz_diff',         description: 'Hz difference (face)',           divisor: 100000 },

  '31': { field: 'slope_dist',      description: 'Slope distance',                divisor: 1000 },
  '32': { field: 'hz_dist',         description: 'Horizontal distance',           divisor: 1000 },
  '33': { field: 'height_diff',     description: 'Height difference',             divisor: 1000 },

  '41': { field: 'code_block',      description: 'Code block (new point)',         divisor: 1    },
  '42': { field: 'info1',           description: 'Information 1',                 divisor: 1    },
  '43': { field: 'info2',           description: 'Information 2',                 divisor: 1    },
  '44': { field: 'info3',           description: 'Information 3',                 divisor: 1    },
  '45': { field: 'info4',           description: 'Information 4',                 divisor: 1    },
  '46': { field: 'info5',           description: 'Information 5',                 divisor: 1    },
  '47': { field: 'info6',           description: 'Information 6',                 divisor: 1    },
  '48': { field: 'info7',           description: 'Information 7',                 divisor: 1    },
  '49': { field: 'info8',           description: 'Information 8',                 divisor: 1    },

  '51': { field: 'prism_constant',  description: 'Prism constant',                divisor: 10000 },
  '52': { field: 'ppm',             description: 'PPM correction',                divisor: 10    },
  '53': { field: 'pressure',        description: 'Atmospheric pressure (hPa)',     divisor: 10    },
  '54': { field: 'temperature',     description: 'Temperature (°C)',              divisor: 10    },
  '55': { field: 'humidity',        description: 'Relative humidity (%)',          divisor: 10    },
  '58': { field: 'refraction',      description: 'Refraction coefficient',         divisor: 10000 },
  '59': { field: 'earth_curve',     description: 'Earth curvature correction',     divisor: 1000 },

  '71': { field: 'feature_code',    description: 'Point code (feature code)',      divisor: 1    },
  '72': { field: 'attribute1',      description: 'Attribute 1',                   divisor: 1    },
  '73': { field: 'attribute2',      description: 'Attribute 2',                   divisor: 1    },
  '74': { field: 'attribute3',      description: 'Attribute 3',                   divisor: 1    },
  '75': { field: 'attribute4',      description: 'Attribute 4',                   divisor: 1    },
  '76': { field: 'attribute5',      description: 'Attribute 5',                   divisor: 1    },
  '77': { field: 'attribute6',      description: 'Attribute 6',                   divisor: 1    },
  '78': { field: 'attribute7',      description: 'Attribute 7',                   divisor: 1    },
  '79': { field: 'attribute8',      description: 'Attribute 8',                   divisor: 1    },

  '81': { field: 'easting',         description: 'Easting (E)',                   divisor: 1000 },
  '82': { field: 'northing',        description: 'Northing (N)',                  divisor: 1000 },
  '83': { field: 'rl',              description: 'Reduced level (H)',             divisor: 1000 },
  '84': { field: 'easting_0',       description: 'Easting (target 0)',            divisor: 1000 },
  '85': { field: 'northing_0',      description: 'Northing (target 0)',           divisor: 1000 },
  '86': { field: 'rl_0',            description: 'RL (target 0)',                 divisor: 1000 },
  '87': { field: 'target_height',   description: 'Target/reflector height',       divisor: 1000 },
  '88': { field: 'instrument_height', description: 'Instrument height (HI)',      divisor: 1000 },
};

// String-type word indices (don't parse as numeric)
const STRING_WORD_INDICES = new Set([
  '11', '12', '13', '18', '19',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '71', '72', '73', '74', '75', '76', '77', '78', '79',
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GSIObservation {
  lineNumber: number;
  pointId: string;
  hzAngle?: number;       // degrees (converted from gon if needed)
  vAngle?: number;        // degrees
  slopeDist?: number;     // metres
  hzDist?: number;        // metres
  heightDiff?: number;    // metres
  easting?: number;
  northing?: number;
  rl?: number;
  instrumentHeight?: number;
  targetHeight?: number;
  featureCode?: string;
  prismConstant?: number;
  face?: 'FL' | 'FR';    // detected face
  raw: Record<string, number | string>;
}

export interface GSIFacePair {
  pointId: string;
  fl: GSIObservation;
  fr: GSIObservation;
  meanHz: number;         // degrees
  meanV: number;          // degrees
  meanSD: number;         // metres
  collimation: number;    // arc-seconds — horizontal collimation error
  indexError: number;     // arc-seconds — vertical index error
}

export interface GSIParseResult extends ParseResult {
  observations: GSIObservation[];
  facePairs: GSIFacePair[];
  stationSetups: GSIStationSetup[];
  format: 'gsi';
  gsiVersion: 8 | 16;
  angleUnit: 'gon' | 'deg' | 'dms';
}

export interface GSIStationSetup {
  stationId: string;
  instrumentHeight: number;
  backsightId?: string;
  observations: GSIObservation[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Detect GSI format version (8 or 16) from content. */
function detectGSIVersion(content: string): 8 | 16 {
  const firstLine = content.trim().split('\n')[0] ?? '';
  // GSI-16 has 24-char word blocks; GSI-8 has 16-char blocks
  // After the leading '*', check if the first word block is ≥ 24 chars
  const stripped = firstLine.startsWith('*') ? firstLine.slice(1) : firstLine;
  // Word blocks separated by spaces in some instruments, or contiguous
  // Heuristic: if the block after WI has > 16 chars of data, it's GSI-16
  if (stripped.length > 0) {
    // Check if the line has space-delimited words
    const words = stripped.split(/\s+/).filter(Boolean);
    if (words.length > 0 && words[0].length >= 23) return 16;
    // Check for contiguous: if total length / word count suggests 24-char blocks
    if (words.length > 1 && words[0].length >= 15 && words[0].length <= 16) return 8;
    if (words.length > 1 && words[0].length >= 23) return 16;
  }
  return 8;
}

/** Parse a single GSI word block into a field name and value. */
function parseWord(word: string, gsiVersion: 8 | 16): {
  wi: string;
  field: string | null;
  value: number | string;
  sign: number;
} | null {
  if (word.length < (gsiVersion === 16 ? 23 : 15)) return null;

  const wi = word.slice(0, 2);
  const def = GSI_WORD_INDEX[wi];
  if (!def) return null;

  // Sign/decimal indicator at position 5 (0-indexed: pos 4 for GSI-8, pos 6 for GSI-16)
  const signPos = gsiVersion === 16 ? 6 : 5;
  const signChar = word[signPos] ?? '+'
  const sign = signChar === '-' ? -1 : 1;

  // Data portion: last N characters
  const dataStart = gsiVersion === 16 ? 7 : 6;
  const dataStr = word.slice(dataStart).replace(/^0+/, '') || '0';

  if (STRING_WORD_INDICES.has(wi)) {
    // String value — strip leading zeros and return as string
    const strVal = word.slice(dataStart).replace(/^0+/, '').trim() || word.slice(dataStart).trim();
    return { wi, field: def.field, value: strVal, sign: 1 };
  }

  // Numeric value
  const rawNum = parseInt(dataStr, 10);
  if (isNaN(rawNum)) return null;

  const value = (sign * rawNum) / def.divisor;
  return { wi, field: def.field, value, sign };
}

/** Convert gon to degrees. */
function gonToDeg(gon: number): number {
  return gon * 360 / 400;
}

/** Detect if the angles are in gon (gradian) or degrees. */
function detectAngleUnit(observations: GSIObservation[]): 'gon' | 'deg' | 'dms' {
  // Heuristic: if any horizontal angle > 360 but ≤ 400, it's gon
  for (const obs of observations) {
    if (obs.hzAngle !== undefined && obs.hzAngle > 360 && obs.hzAngle <= 400) return 'gon';
    if (obs.vAngle !== undefined && obs.vAngle > 360 && obs.vAngle <= 400) return 'gon';
  }
  return 'deg'; // default to degrees
}

/** Detect face from vertical angle (FL: 0–200g or 0–180°, FR: 200–400g or 180–360°). */
function detectFace(vAngle: number | undefined, angleUnit: 'gon' | 'deg' | 'dms'): 'FL' | 'FR' | undefined {
  if (vAngle === undefined) return undefined;
  if (angleUnit === 'gon') {
    return vAngle < 200 ? 'FL' : 'FR';
  }
  return vAngle < 180 ? 'FL' : 'FR';
}

/** Mean of two angles, handling wraparound. */
function meanAngle(a: number, b: number, fullCircle: number): number {
  // For horizontal angle mean from FL/FR: mean = (FL + FR ± 180°) / 2
  // Standard face reduction
  let diff = b - a;
  if (diff > fullCircle / 2) diff -= fullCircle;
  if (diff < -fullCircle / 2) diff += fullCircle;
  let mean = a + diff / 2;
  if (mean < 0) mean += fullCircle;
  if (mean >= fullCircle) mean -= fullCircle;
  return mean;
}

// ─── Main Parser ──────────────────────────────────────────────────────────────

function parseGSIContent(content: string): GSIParseResult {
  const lines = content.trim().split('\n');
  const gsiVersion = detectGSIVersion(content);
  const observations: GSIObservation[] = [];
  const warnings: string[] = [];
  const points: ParsedPoint[] = [];

  const wordLength = gsiVersion === 16 ? 24 : 16;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx].trim();
    if (!line || !line.startsWith('*')) continue;

    // Strip leading '*' and split into word blocks
    const stripped = line.slice(1);

    // Words can be space-separated or contiguous
    let words: string[];
    if (stripped.includes(' ')) {
      words = stripped.split(/\s+/).filter(Boolean);
    } else {
      // Contiguous: split by word length
      words = [];
      for (let i = 0; i < stripped.length; i += wordLength) {
        const w = stripped.slice(i, i + wordLength);
        if (w.length >= wordLength - 2) words.push(w);
      }
    }

    const obs: GSIObservation = {
      lineNumber: lineIdx + 1,
      pointId: '',
      raw: {},
    };

    for (const word of words) {
      const parsed = parseWord(word, gsiVersion);
      if (!parsed || !parsed.field) continue;

      obs.raw[parsed.wi] = parsed.value;

      switch (parsed.field) {
        case 'point_id':
          obs.pointId = String(parsed.value);
          break;
        case 'hz_angle':
        case 'hz_angle_avg':
          obs.hzAngle = parsed.value as number;
          break;
        case 'v_angle':
        case 'v_angle_avg':
          obs.vAngle = parsed.value as number;
          break;
        case 'slope_dist':
          obs.slopeDist = parsed.value as number;
          break;
        case 'hz_dist':
          obs.hzDist = parsed.value as number;
          break;
        case 'height_diff':
          obs.heightDiff = parsed.value as number;
          break;
        case 'easting':
          obs.easting = parsed.value as number;
          break;
        case 'northing':
          obs.northing = parsed.value as number;
          break;
        case 'rl':
          obs.rl = parsed.value as number;
          break;
        case 'instrument_height':
          obs.instrumentHeight = parsed.value as number;
          break;
        case 'target_height':
          obs.targetHeight = parsed.value as number;
          break;
        case 'feature_code':
          obs.featureCode = String(parsed.value);
          break;
        case 'prism_constant':
          obs.prismConstant = parsed.value as number;
          break;
      }
    }

    if (obs.pointId) {
      observations.push(obs);
    } else {
      warnings.push(`Line ${lineIdx + 1}: No point ID found — skipped`);
    }
  }

  // Detect angle unit and convert if necessary
  const angleUnit = detectAngleUnit(observations);
  if (angleUnit === 'gon') {
    for (const obs of observations) {
      if (obs.hzAngle !== undefined) obs.hzAngle = gonToDeg(obs.hzAngle);
      if (obs.vAngle !== undefined) obs.vAngle = gonToDeg(obs.vAngle);
    }
  }

  // Detect faces
  for (const obs of observations) {
    obs.face = detectFace(obs.vAngle, angleUnit);
  }

  // Build face pairs (group by point ID, pair FL with FR)
  const facePairs = buildFacePairs(observations, angleUnit);

  // Build station setups (group by instrument height changes)
  const stationSetups = buildStationSetups(observations);

  // Build ParsedPoint array for the universal importer
  for (const obs of observations) {
    const pt: ParsedPoint = { raw: obs.raw as Record<string, unknown> };
    if (obs.pointId) (pt as Record<string, unknown>)['point_no'] = obs.pointId;
    if (obs.easting !== undefined) (pt as Record<string, unknown>)['easting'] = obs.easting;
    if (obs.northing !== undefined) (pt as Record<string, unknown>)['northing'] = obs.northing;
    if (obs.rl !== undefined) (pt as Record<string, unknown>)['rl'] = obs.rl;
    if (obs.hzAngle !== undefined) (pt as Record<string, unknown>)['bearing'] = obs.hzAngle;
    if (obs.slopeDist !== undefined) (pt as Record<string, unknown>)['distance'] = obs.slopeDist;
    if (obs.hzDist !== undefined) (pt as Record<string, unknown>)['distance'] = obs.hzDist;
    if (obs.featureCode) (pt as Record<string, unknown>)['feature_code'] = obs.featureCode;
    if (obs.targetHeight !== undefined) (pt as Record<string, unknown>)['target_height'] = obs.targetHeight;
    if (obs.instrumentHeight !== undefined) (pt as Record<string, unknown>)['instrument_height'] = obs.instrumentHeight;
    points.push(pt);
  }

  return {
    format: 'gsi',
    points,
    warnings,
    observations,
    facePairs,
    stationSetups,
    gsiVersion,
    angleUnit,
  };
}

// ─── Face Pairing ─────────────────────────────────────────────────────────────

function buildFacePairs(observations: GSIObservation[], angleUnit: 'gon' | 'deg' | 'dms'): GSIFacePair[] {
  const pairs: GSIFacePair[] = [];

  // Group observations by point ID
  const byPointId = new Map<string, GSIObservation[]>();
  for (const obs of observations) {
    if (!obs.pointId || obs.face === undefined) continue;
    const existing = byPointId.get(obs.pointId) ?? [];
    existing.push(obs);
    byPointId.set(obs.pointId, existing);
  }

  for (const [pointId, obsList] of Array.from(byPointId.entries())) {
    const flObs = obsList.filter(o => o.face === 'FL');
    const frObs = obsList.filter(o => o.face === 'FR');

    // Pair FL[i] with FR[i]
    const pairCount = Math.min(flObs.length, frObs.length);
    for (let i = 0; i < pairCount; i++) {
      const fl = flObs[i];
      const fr = frObs[i];

      if (fl.hzAngle === undefined || fr.hzAngle === undefined) continue;
      if (fl.vAngle === undefined || fr.vAngle === undefined) continue;

      const fullCircle = 360; // already converted from gon

      // Mean horizontal angle: (Hz_FL + Hz_FR ± 180°) / 2
      let frHzCorrected = fr.hzAngle >= 180 ? fr.hzAngle - 180 : fr.hzAngle + 180;
      let meanHz = (fl.hzAngle + frHzCorrected) / 2;
      if (meanHz >= 360) meanHz -= 360;
      if (meanHz < 0) meanHz += 360;

      // Mean vertical angle: (V_FL + (360° - V_FR)) / 2
      const meanV = (fl.vAngle + (360 - fr.vAngle)) / 2;

      // Mean slope distance
      const meanSD = ((fl.slopeDist ?? 0) + (fr.slopeDist ?? 0)) / 2;

      // Collimation error: (Hz_FL - (Hz_FR ± 180°)) / 2 → in arc-seconds
      const collimation = ((fl.hzAngle - frHzCorrected) / 2) * 3600;

      // Index error: (V_FL + V_FR - 360°) / 2 → in arc-seconds
      const indexError = ((fl.vAngle + fr.vAngle - 360) / 2) * 3600;

      pairs.push({
        pointId,
        fl,
        fr,
        meanHz,
        meanV,
        meanSD,
        collimation,
        indexError,
      });
    }
  }

  return pairs;
}

// ─── Station Setups ───────────────────────────────────────────────────────────

function buildStationSetups(observations: GSIObservation[]): GSIStationSetup[] {
  const setups: GSIStationSetup[] = [];
  let currentSetup: GSIStationSetup | null = null;

  for (const obs of observations) {
    // Detect station setup change: when instrument height appears
    if (obs.instrumentHeight !== undefined && obs.instrumentHeight > 0) {
      if (currentSetup && currentSetup.observations.length > 0) {
        setups.push(currentSetup);
      }
      currentSetup = {
        stationId: obs.pointId,
        instrumentHeight: obs.instrumentHeight,
        observations: [],
      };
      continue;
    }

    if (currentSetup) {
      currentSetup.observations.push(obs);
    } else {
      // Observations before first station setup — create implicit setup
      currentSetup = {
        stationId: 'UNKNOWN',
        instrumentHeight: 0,
        observations: [obs],
      };
    }
  }

  if (currentSetup && currentSetup.observations.length > 0) {
    setups.push(currentSetup);
  }

  return setups;
}

// ─── Register with Universal Importer ─────────────────────────────────────────

registerParser({
  format: 'gsi',
  label: 'Leica GSI (Professional)',
  extensions: ['gsi', 'txt'],
  detect: (content) => {
    const trimmed = content.trimStart();
    return trimmed.startsWith('*') && /^\*\d{2}/.test(trimmed);
  },
  parse: (content): ParseResult => {
    const result = parseGSIContent(content);
    return {
      format: 'gsi',
      points: result.points,
      warnings: result.warnings,
    };
  },
});

// Export for direct use by advanced components
export { parseGSIContent };
