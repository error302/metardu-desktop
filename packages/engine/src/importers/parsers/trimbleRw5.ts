import { registerParser } from '../registry';
import { ParseResult, ParsedPoint } from '@/types/importer';

registerParser({
  format: 'trimble-rw5',
  label: 'Trimble RW5',
  extensions: ['rw5', 'dc'],
  detect: (content) =>
    content.includes('--Trimble') || /^(TR|SS|BD|OB|MO),/.test(content.trim()),
  parse: (content): ParseResult => {
    const lines = content.trim().split('\n');
    const points: ParsedPoint[] = [];
    const warnings: string[] = [];

    for (const line of lines) {
      if (line.startsWith('--') || line.startsWith('!') || line.startsWith('MN')) continue;
      const parts = line.split(',');
      const recordType = parts[0]?.trim();

      if (recordType === 'SS' || recordType === 'TR') {
        const fields: Record<string, string> = {};
        parts.forEach((p) => {
          const [k, v] = p.split('=');
          if (k && v) fields[k.trim()] = v.trim();
        });

        const point: ParsedPoint = {
          point_no: fields['FP'] ?? fields['OP'],
          bearing: parseFloat(fields['AZ'] ?? fields['HR'] ?? '0'),
          distance: parseFloat(fields['SD'] ?? fields['HD'] ?? '0'),
          rl: parseFloat(fields['EL'] ?? '0'),
          code: fields['--'] ?? fields['CD'] ?? '',
          raw: fields,
        };

        if (point.point_no) {
          points.push(point);
        }
      }
    }

    if (points.length === 0) {
      warnings.push('No SS/TR records found. Verify this is a Trimble RW5 raw data file.');
    }

    return { format: 'trimble-rw5', points, warnings };
  },
});
