import { registerParser } from '../registry';
import { ParseResult, ParsedPoint } from '@/types/importer';

registerParser({
  format: 'csv',
  label: 'Generic CSV',
  extensions: ['csv', 'txt'],
  detect: (content) => {
    const lines = content.trim().split('\n');
    return lines.length > 1 && lines[1].includes(',');
  },
  parse: (content): ParseResult => {
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const points: ParsedPoint[] = [];
    const warnings: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim());
      if (values.length < 2) continue;

      const raw: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        raw[h] = values[idx];
      });

      const point: ParsedPoint = {
        point_no: String(raw['point'] ?? raw['pt'] ?? raw['name'] ?? raw['station'] ?? raw['stn'] ?? String(i)),
        easting: parseFloat(String(raw['easting'] ?? raw['e'] ?? raw['x'] ?? '')),
        northing: parseFloat(String(raw['northing'] ?? raw['n'] ?? raw['y'] ?? '')),
        rl: parseFloat(String(raw['rl'] ?? raw['elevation'] ?? raw['z'] ?? raw['height'] ?? '')),
        bearing: parseFloat(String(raw['bearing'] ?? raw['azimuth'] ?? raw['brg'] ?? raw['bear'] ?? '')),
        distance: parseFloat(String(raw['distance'] ?? raw['dist'] ?? raw['hd'] ?? raw['slope_dist'] ?? '')),
        code: String(raw['code'] ?? raw['description'] ?? raw['desc'] ?? ''),
        remark: String(raw['remark'] ?? raw['remark'] ?? raw['notes'] ?? ''),
        raw,
      };

      if (Number.isNaN(point.easting!) || Number.isNaN(point.northing!)) {
        warnings.push(`Row ${i + 1}: missing or invalid easting/northing — skipped`);
        continue;
      }

      points.push(point);
    }

    return { format: 'csv', points, warnings };
  },
});
