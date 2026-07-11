import { registerParser } from '../registry';
import { ParseResult, ParsedPoint } from '@/types/importer';

registerParser({
  format: 'dxf',
  label: 'DXF (AutoCAD)',
  extensions: ['dxf'],
  detect: (content) => content.includes('SECTION') && content.includes('ENTITIES'),
  parse: (content): ParseResult => {
    const points: ParsedPoint[] = [];
    const warnings: string[] = [];
    const lines = content.split('\n').map((l) => l.trim());

    let i = 0;
    while (i < lines.length) {
      if (lines[i] === '0' && lines[i + 1] === 'POINT') {
        const point: ParsedPoint = { raw: {} };
        i += 2;
        while (i < lines.length && lines[i] !== '0') {
          const code = lines[i];
          const value = lines[i + 1];
          if (code === '10') point.easting = parseFloat(value);
          if (code === '20') point.northing = parseFloat(value);
          if (code === '30') point.rl = parseFloat(value);
          if (code === '8') point.code = value;
          i += 2;
        }
        if (point.easting !== undefined && point.northing !== undefined) {
          points.push(point);
        }
      } else {
        i++;
      }
    }

    if (points.length === 0) {
      warnings.push('No POINT entities found in DXF. If data is in polylines or blocks, export as CSV first.');
    }

    return { format: 'dxf', points, warnings };
  },
});
