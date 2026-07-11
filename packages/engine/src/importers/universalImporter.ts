import { detectFormat, getParser } from './registry';
import { bowditchAdjustment } from '@/lib/engine/traverse';
import { ParseResult, SupportedFormat, ParsedPoint } from '@/types/importer';

export { detectFormat, getParser } from './registry';

interface FieldbookEntry {
  station: string;
  bearing: number;
  distance: number;
  deltaE?: number;
  deltaN?: number;
}

interface AdjustedLeg {
  from: string;
  to: string;
  adjEasting: number;
  adjNorthing: number;
  bearing: number;
  distance: number;
}

export interface SmartImportResult {
  success: boolean;
  entries: FieldbookEntry[];
  errors: string[];
  warnings: string[];
  totalEntries: number;
  parserUsed?: string;
  processed?: boolean;
  adjustedLegs?: AdjustedLeg[];
  relativePrecision?: string;
  message?: string;
}

export const smartImport = async (file: File): Promise<SmartImportResult> => {
  const content = await file.text();
  const format = detectFormat(file.name, content);

  if (format === 'unknown') {
    return {
      success: false,
      entries: [],
      errors: ['Unknown file format'],
      warnings: [],
      totalEntries: 0,
      parserUsed: 'unknown'
    };
  }

  const parser = getParser(format);
  if (!parser) {
    return {
      success: false,
      entries: [],
      errors: [`No parser for format: ${format}`],
      warnings: [],
      totalEntries: 0,
      parserUsed: format
    };
  }

  const parseResult = parser.parse(content);
  const points = parseResult.points || [];

  if (points.length < 3) {
    return {
      success: false,
      entries: [],
      errors: [...(parseResult.errors || []), 'Insufficient data - need at least 3 stations'],
      warnings: parseResult.warnings,
      totalEntries: points.length,
      parserUsed: format
    };
  }

  const entries: FieldbookEntry[] = points.map((p: ParsedPoint) => ({
    station: p.point_no || 'UNKNOWN',
    bearing: p.bearing || 0,
    distance: p.distance || 0,
    deltaE: (p.raw_data as Record<string, number>)?.deltaE || 0,
    deltaN: (p.raw_data as Record<string, number>)?.deltaN || 0,
  }));

  // Build engine-compatible traverse input
  const bowditchInput = {
    points: entries.map((e) => ({
      name: e.station,
      easting: 0,
      northing: 0,
    })),
    distances: entries.map((e) => e.distance),
    bearings: entries.map((e) => e.bearing),
  };

  const result = bowditchAdjustment(bowditchInput);

  const adjustedLegs: AdjustedLeg[] = result.legs.map((leg) => ({
    from: leg.from,
    to: leg.to,
    adjEasting: leg.adjEasting,
    adjNorthing: leg.adjNorthing,
    bearing: leg.bearing,
    distance: leg.distance,
  }));

  const precisionStr = result.linearError > 0 && result.totalDistance > 0
    ? `1:${Math.round(result.totalDistance / result.linearError).toLocaleString()}`
    : '1:Perfect';

  return {
    success: true,
    entries,
    errors: parseResult.errors || [],
    warnings: parseResult.warnings,
    totalEntries: entries.length,
    parserUsed: format,
    processed: true,
    adjustedLegs,
    relativePrecision: precisionStr,
    message: `Imported ${entries.length} legs. Bowditch applied (${precisionStr})`
  };
};
