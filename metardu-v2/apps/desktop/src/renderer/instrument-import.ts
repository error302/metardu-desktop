/**
 * Instrument Data Import — parse raw data dumps from total stations and levels.
 *
 * Supports:
 *   1. CSV (generic) — id, TH, Hz, V, SD  or  id, BS, IS, FS
 *   2. Leica GSI-8/GSI-16 — angle/distance records with instrument serial
 *   3. Sokkia SDR — Standard Data Record format
 *   4. Trimble DC — ASCII export format
 *
 * Each parser returns a typed array that can be loaded directly into
 * the FieldBookView's observation tables.
 */

export interface TsObservation {
  pointId: string;
  targetHeight: number;
  faceLeft: { hz: number; v: number; sd: number } | null;
  faceRight: { hz: number; v: number; sd: number } | null;
  remark: string;
}

export interface LevelObservation {
  id: string;
  bs: number | null;
  is: number | null;
  fs: number | null;
  rl: number;
  remark: string;
}

export type ParsedFieldBook =
  | { type: "total_station"; observations: TsObservation[]; instrument?: string; serialNumber?: string }
  | { type: "level"; observations: LevelObservation[]; instrument?: string };

// ─── CSV Parser ─────────────────────────────────────────────────

/**
 * Parse a generic CSV string. Supports both total station and level formats.
 *
 * TS format: id, TH, Hz, V, SD [, FR_Hz, FR_V, FR_SD] [, remark]
 * Level format: id, BS, IS, FS, RL, remark
 */
export function parseCsv(raw: string): ParsedFieldBook {
  const lines = raw.trim().split("\n").filter(l => l.trim() && !l.trim().startsWith("#"));
  if (lines.length === 0) return { type: "total_station", observations: [] };

  const firstLine = lines[0]!.split(/[;,|\t]+/).map(s => s.trim());
  const numCols = firstLine.length;

  // Detect format by column count and header hints
  const header = firstLine.map(s => s.toLowerCase());
  const isLevel = header.some(h => ["bs", "backsight", "back"].includes(h)) ||
                  (numCols >= 4 && numCols <= 6 && header.every(h => /^[a-z]/.test(h) || !isNaN(parseFloat(h))));

  if (isLevel) {
    return { type: "level", observations: parseLevelCsv(lines) };
  }

  return { type: "total_station", observations: parseTsCsv(lines) };
}

function parseTsCsv(lines: string[]): TsObservation[] {
  return lines.map(line => {
    const p = line.split(/[;,|\t]+/).map(s => s.trim());
    return {
      pointId: p[0] || "PT",
      targetHeight: parseFloat(p[1]) || 1.6,
      faceLeft: { hz: parseFloat(p[2]) || 0, v: parseFloat(p[3]) || 90, sd: parseFloat(p[4]) || 0 },
      faceRight: p[5] ? { hz: parseFloat(p[5]) || 0, v: parseFloat(p[6]) || 270, sd: parseFloat(p[7]) || 0 } : null,
      remark: p[8] || "",
    };
  });
}

function parseLevelCsv(lines: string[]): LevelObservation[] {
  const result: LevelObservation[] = [];
  let currentRL = 100.0;
  for (const line of lines) {
    const p = line.split(/[;,|\t]+/).map(s => s.trim());
    const id = p[0] || "BM";
    const bs = p[1] ? parseFloat(p[1]) : null;
    const is_ = p[2] ? parseFloat(p[2]) : null;
    const fs = p[3] ? parseFloat(p[3]) : null;
    const rl = p[4] ? parseFloat(p[4]) : currentRL;
    if (p[4]) currentRL = rl;
    result.push({ id, bs, is: is_, fs, rl, remark: p[5] || "" });
  }
  return result;
}

// ─── Leica GSI Parser ───────────────────────────────────────────

/**
 * Parse Leica GSI-8 or GSI-16 format.
 *
 * GSI record format:
 *   %... 1 ...2 ...3 ...4 ...
 *   Where each field is: Wxyz MetricData
 *   - W = data type (1=point ID, 21=Hz, 22=V, 31=SD, 81=instrument serial)
 *   - xyz = sequence
 *   - MetricData = signed integer (GSI-8: 8 digits, GSI-16: 16 digits)
 *
 * Example:
 *   %1  1 00000002+00000000
 *   %1 21 00000001+00451234
 *   %1 22 00000001+00875431
 *   %1 31 00000001+00045234
 */
export function parseGsi(raw: string): ParsedFieldBook {
  const lines = raw.split("\n").filter(l => l.trim().startsWith("%"));
  const observations: TsObservation[] = [];
  let instrument = "";
  let serialNumber = "";

  let current: Partial<TsObservation> & { faceLeft?: TsObservation["faceLeft"]; faceRight?: TsObservation["faceRight"] } = {};
  let readingFace: "left" | "right" = "left";

  for (const line of lines) {
    // Parse the field code and value
    const match = line.match(/%\d+\s+(\d+)\s+\d+\s+([+-])(\d+)/);
    if (!match) continue;

    const code = match[1]!;
    const sign = match[2] === "+" ? 1 : -1;
    const rawValue = parseInt(match[3]!);

    switch (code) {
      case "1": // Point ID
        if (current.pointId) {
          // Save previous observation
          observations.push(finalizeTsObs(current));
          current = {};
        }
        current.pointId = String(rawValue);
        break;
      case "21": // Horizontal angle (grads * 10000 → degrees)
        {
          const hz = (rawValue * sign * 360) / 4000000;
          if (readingFace === "left") {
            current.faceLeft = { hz, v: current.faceLeft?.v ?? 90, sd: current.faceLeft?.sd ?? 0 };
          } else {
            current.faceRight = { hz, v: current.faceRight?.v ?? 270, sd: current.faceRight?.sd ?? 0 };
          }
        }
        break;
      case "22": // Vertical angle (grads * 10000 → degrees)
        {
          const v = (rawValue * sign * 360) / 4000000;
          if (readingFace === "left") {
            current.faceLeft = { hz: current.faceLeft?.hz ?? 0, v, sd: current.faceLeft?.sd ?? 0 };
          } else {
            current.faceRight = { hz: current.faceRight?.hz ?? 0, v, sd: current.faceRight?.sd ?? 0 };
          }
        }
        break;
      case "31": // Slope distance (mm)
        {
          const sd = rawValue / 1000;
          if (readingFace === "left") {
            current.faceLeft = { hz: current.faceLeft?.hz ?? 0, v: current.faceLeft?.v ?? 90, sd };
          } else {
            current.faceRight = { hz: current.faceRight?.hz ?? 0, v: current.faceRight?.v ?? 270, sd };
          }
        }
        break;
      case "33": // Target height
        current.targetHeight = rawValue / 1000;
        break;
      case "81": // Instrument serial
        serialNumber = String(rawValue);
        break;
      case "87": // Instrument type
        instrument = String(rawValue);
        break;
    }
  }

  // Push last observation
  if (current.pointId) {
    observations.push(finalizeTsObs(current));
  }

  return { type: "total_station", observations, instrument, serialNumber };
}

function finalizeTsObs(partial: Partial<TsObservation> & { faceLeft?: TsObservation["faceLeft"]; faceRight?: TsObservation["faceRight"] }): TsObservation {
  return {
    pointId: partial.pointId || "PT",
    targetHeight: partial.targetHeight ?? 1.6,
    faceLeft: partial.faceLeft ?? null,
    faceRight: partial.faceRight ?? null,
    remark: partial.remark || "",
  };
}

// ─── Sokkia SDR Parser ──────────────────────────────────────────

/**
 * Parse Sokkia SDR (Standard Data Record) format.
 *
 * SDR33 format:
 *   Smith      1  STN1          1.500
 *   Smith      2  FS1           1.600      45.2317   87.5431   45.234
 *   Smith      3  FS2           1.600      112.0542  92.1025   78.912
 *   Columns: recorder, seq, pointID, targetHeight, [Hz, V, SD]
 */
export function parseSdr(raw: string): ParsedFieldBook {
  const lines = raw.trim().split("\n").filter(l => l.trim());
  const observations: TsObservation[] = [];

  for (const line of lines) {
    const p = line.trim().split(/\s+/);
    if (p.length < 3) continue;

    const pointId = p[2]!;
    const th = parseFloat(p[3]) || 1.6;
    const hz = p[4] ? parseFloat(p[4]) : null;
    const v = p[5] ? parseFloat(p[5]) : null;
    const sd = p[6] ? parseFloat(p[6]) : null;

    if (hz !== null && v !== null && sd !== null) {
      observations.push({
        pointId,
        targetHeight: th,
        faceLeft: { hz, v, sd },
        faceRight: null,
        remark: "",
      });
    }
  }

  return { type: "total_station", observations };
}

// ─── Trimble DC Parser ──────────────────────────────────────────

/**
 * Parse Trimble DC (Data Collector) ASCII export format.
 *
 * DC format:
 *   Point       Code    Northing   Easting    Elevation
 *   STN1        CTRL    9857700.0  257100.0   100.0
 *   FS1         DET     9857745.2  257132.1   101.5
 */
export function parseTrimbleDc(raw: string): ParsedFieldBook {
  const lines = raw.trim().split("\n").filter(l => l.trim() && !l.startsWith("#"));
  if (lines.length < 2) return { type: "total_station", observations: [] };

  // Skip header line
  const dataLines = lines.slice(1);
  const observations: TsObservation[] = dataLines.map(line => {
    const p = line.trim().split(/\s+/);
    return {
      pointId: p[0] || "PT",
      targetHeight: 1.6,
      faceLeft: null,
      faceRight: null,
      remark: p[1] || "",
    };
  });

  return { type: "total_station", observations };
}

// ─── Format Detection ───────────────────────────────────────────

/**
 * Auto-detect the format of raw instrument data.
 */
export function detectFormat(raw: string): "csv" | "gsi" | "sdr" | "trimble-dc" | "unknown" {
  const trimmed = raw.trim();
  if (trimmed.startsWith("%")) return "gsi";
  if (/^Smith\s+\d+/m.test(trimmed)) return "sdr";
  if (/Point\s+Code\s+Northing/m.test(trimmed) || /Point\s+Code\s+Easting/m.test(trimmed)) return "trimble-dc";
  const lines = trimmed.split("\n");
  if (lines.length > 0) {
    const cols = lines[0]!.split(/[;,|\t]+/).length;
    if (cols >= 3 && cols <= 9) return "csv";
  }
  return "unknown";
}

/**
 * Parse raw instrument data using the detected format.
 */
export function importInstrumentData(raw: string): ParsedFieldBook {
  const format = detectFormat(raw);
  switch (format) {
    case "gsi": return parseGsi(raw);
    case "sdr": return parseSdr(raw);
    case "trimble-dc": return parseTrimbleDc(raw);
    case "csv": return parseCsv(raw);
    default: return parseCsv(raw); // fallback
  }
}
