import { registerParser } from '../registry';
import { ParseResult, ParsedPoint } from '@/types/importer';
import { parseSouthData } from '@/lib/import/totalStation/parseSouth';

/**
 * South total station .dat/.dc format registration.
 *
 * Detection strategy:
 * 1. If file starts with "South," header — confirmed South
 * 2. If file contains SS observation rows with South-style DMS angles — likely South
 * 3. If .dat/.dc extension and coordinate rows match pattern — South coordinate export
 *
 * Note: .dc is also used by Trimble RW5. The detect function checks content to
 * disambiguate. Trimble detection runs first if file contains "--Trimble" markers.
 */
registerParser({
  format: 'south',
  label: 'South Total Station (.dat/.dc)',
  extensions: ['dat', 'dc'],
  detect: (content) => {
    const trimmed = content.trim();
    const firstLine = trimmed.split('\n')[0]?.trim() ?? '';

    // Explicit South header
    if (firstLine.toLowerCase().startsWith('south,')) return true;

    // SS observation rows (South format: SS,obs#,station,target,HCL_DMS,...)
    // Distinguished from Trimble SS by key=value absence and numeric DMS angle
    const ssLineMatch = /^(SS,)\d+,/.test(firstLine) &&
      !firstLine.includes('=') &&
      /\d{2,3}\.\d{4}/.test(firstLine);

    if (ssLineMatch) return true;

    // Coordinate-only South file: integer pt#, name, numeric E, N, RL, quoted code, type
    // Pattern: 1,BM1,984321.456,1234567.890,1542.345,"BM1",0
    const coordLineMatch = /^\s*\d+\s*,/.test(firstLine) &&
      !/^\s*\d+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+/.test(firstLine.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '')) === false;

    // More reliable: check if any line matches the full South coordinate pattern
    const lines = trimmed.split('\n').slice(0, 10);
    const southCoordRegex = /^\s*\d+\s*,\s*\w+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+/;
    const hasSouthCoord = lines.some((l) => southCoordRegex.test(l.trim()));

    // Must NOT be Trimble (Trimble uses key=value pairs)
    const hasTrimbleMarkers = trimmed.includes('--Trimble') || /[A-Z]{2}=/i.test(trimmed);

    if (hasSouthCoord && !hasTrimbleMarkers) return true;

    return false;
  },
  parse: (content): ParseResult => {
    const result = parseSouthData(content);
    const points: ParsedPoint[] = [];
    const warnings: string[] = [...result.warnings];

    // Convert coordinate points to ParsedPoint format
    for (const coord of result.coordinates) {
      const point: ParsedPoint = {
        point_no: String(coord.pointNumber),
        easting: coord.easting,
        northing: coord.northing,
        rl: coord.elevation,
        code: coord.code || undefined,
        remark: coord.pointName !== String(coord.pointNumber) ? coord.pointName : undefined,
        raw: {
          pointNumber: coord.pointNumber,
          pointName: coord.pointName,
          pointType: coord.pointType,
        } as Record<string, unknown>,
      };
      points.push(point);
    }

    // Convert observations to ParsedPoint entries
    for (const obs of result.observations) {
      const point: ParsedPoint = {
        point_no: obs.target,
        bearing:
          obs.hclDeg + obs.hclMin / 60 + obs.hclSec / 3600,
        distance: obs.slopeDistance,
        code: `${obs.station}→${obs.target}`,
        raw: {
          observationNumber: obs.observationNumber,
          station: obs.station,
          target: obs.target,
          hcl: `${obs.hclDeg}°${obs.hclMin}'${obs.hclSec}"`,
          targetHeight: obs.targetHeight,
          slopeDistance: obs.slopeDistance,
          va: `${obs.vaDeg}°${obs.vaMin}'${obs.vaSec}"`,
          instrumentHeight: obs.instrumentHeight,
        } as Record<string, unknown>,
      };
      points.push(point);
    }

    // Pass through errors as warnings (registry parsers use warnings, not errors)
    for (const err of result.errors) {
      warnings.push(err);
    }

    if (points.length === 0) {
      warnings.push(
        'No valid South coordinate or observation records parsed. Verify the file format.'
      );
    }

    return {
      format: 'south',
      points,
      warnings,
      metadata: {
        fileType: result.type,
        coordinateCount: result.coordinates.length,
        observationCount: result.observations.length,
      },
    };
  },
});
