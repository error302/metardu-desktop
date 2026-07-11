import { registerParser } from '../registry';
import { ParseResult, ParsedPoint } from '@/types/importer';

registerParser({
  format: 'jobxml',
  label: 'JobXML (Trimble/Topcon)',
  extensions: ['jxl', 'xml', 'job'],
  detect: (content) =>
    content.includes('<JOBFile') || content.includes('<job') || content.includes('<FieldBook'),
  parse: (content): ParseResult => {
    const points: ParsedPoint[] = [];
    const warnings: string[] = [];

    const pointRegex = /<Point[^>]*>([\s\S]*?)<\/Point>/gi;
    let match;

    while ((match = pointRegex.exec(content)) !== null) {
      const block = match[1];
      const get = (tag: string) => {
        const m = block.match(new RegExp(`<${tag}>([^<]*)<\/${tag}>`));
        return m ? m[1].trim() : undefined;
      };

      const point: ParsedPoint = {
        point_no: get('Name') ?? get('ID'),
        northing: parseFloat(get('North') ?? get('Northing') ?? '0'),
        easting: parseFloat(get('East') ?? get('Easting') ?? '0'),
        rl: parseFloat(get('Elev') ?? get('Elevation') ?? get('Height') ?? '0'),
        code: get('Code') ?? get('Feature'),
        raw: {},
      };

      if (!point.point_no) {
        warnings.push('Point block missing Name/ID — skipped');
        continue;
      }

      points.push(point);
    }

    if (points.length === 0) {
      warnings.push('No <Point> elements found. File may be raw observation rather than coordinate export.');
    }

    return { format: 'jobxml', points, warnings };
  },
});
