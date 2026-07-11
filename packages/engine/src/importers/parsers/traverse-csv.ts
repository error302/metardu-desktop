import { registerParser } from '../registry';
import { ParseResult, ParsedPoint } from '@/types/importer';
import { bearingDistanceToDelta } from '@/lib/geodesy/coordinates';

registerParser({
  format: 'csv',
  label: 'Traverse CSV (Bearing + Distance)',
  extensions: ['csv'],
  detect: (content) => {
    const lines = content.trim().split('\n');
    if (lines.length < 2) return false;
    const headers = lines[0].split(',').map((h: any) => h.trim().toLowerCase());
    const hasBearing = headers.some((h: any) => ['bearing', 'azimuth', 'brg', 'bear'].includes(h));
    const hasDistance = headers.some((h: any) => ['distance', 'dist', 'hd', 'length'].includes(h));
    return hasBearing && hasDistance;
  },
  parse: (content): ParseResult => {
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',').map((h: any) => h.trim().toLowerCase());
    const points: ParsedPoint[] = [];
    const warnings: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v: any) => v.trim());
      if (values.length < 2) continue;

      const raw: Record<string, unknown> = {};
      headers.forEach((h, idx) => { raw[h] = values[idx]; });

      const bearing = parseFloat(String(raw['bearing'] ?? raw['azimuth'] ?? raw['brg'] ?? raw['bear'] ?? ''));
      const distance = parseFloat(String(raw['distance'] ?? raw['dist'] ?? raw['hd'] ?? raw['length'] ?? ''));

      if (isNaN(bearing) || isNaN(distance) || distance <= 0) {
        warnings.push(`Row ${i + 1}: invalid or missing bearing/distance`);
        continue;
      }

      const normalizedBearing = (bearing + 360) % 360;
      const { deltaE, deltaN } = bearingDistanceToDelta(normalizedBearing, distance);

      points.push({
        point_no: String(raw['station'] ?? raw['stn'] ?? raw['from'] ?? raw['point'] ?? `P${i}`),
        bearing: normalizedBearing,
        distance: Number(distance.toFixed(3)),
        code: String(raw['code'] ?? raw['description'] ?? raw['desc'] ?? ''),
        remark: String(raw['remark'] ?? raw['notes'] ?? ''),
        raw,
        raw_data: { deltaE, deltaN }
      });
    }

    if (points.length < 3) {
      warnings.push('Fewer than 3 legs — closure check may not be meaningful');
    }

    return { format: 'csv', points, warnings };
  },
});
