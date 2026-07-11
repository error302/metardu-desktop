/**
 * Machine Control Data Export
 *
 * Generates data files for construction equipment guidance systems including
 * Trimble, Leica, Topcon, and generic formats.
 *
 * Reference:
 * - Trimble Business Center Data Formats
 * - Leica GSI Format Specification (GSI-8 / GSI-16)
 * - Topcon Magnet File Formats
 *
 * All coordinates in metres. No external dependencies.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MachineControlPoint {
  name: string;
  easting: number;
  northing: number;
  elevation: number;
  code: string;
  description?: string;
}

export interface MachineControlOptions {
  format:
    | 'trimble_csv'
    | 'leica_gsi'
    | 'topcon_csv'
    | 'generic_csv'
    | 'alignment_xml';
  coordinateSystem?: string;
  zone?: number;
  datum?: string;
}

export type MachineControlFormat = MachineControlOptions['format'];

export interface FormatDescriptor {
  id: MachineControlFormat;
  label: string;
  software: string;
  extension: string;
  description: string;
}

// ─── Format Registry ────────────────────────────────────────────────────────

export const MACHINE_FORMATS: FormatDescriptor[] = [
  {
    id: 'trimble_csv',
    label: 'Trimble Compatible CSV',
    software: 'Trimble Business Center',
    extension: '.csv',
    description:
      'CSV format compatible with Trimble Business Center point import (Name,E,N,Z,Code,Description).',
  },
  {
    id: 'leica_gsi',
    label: 'Leica GSI-8',
    software: 'Leica Geo Office',
    extension: '.gsi',
    description:
      'Leica GSI-8 fixed-width data record format for total station and GNSS instruments.',
  },
  {
    id: 'topcon_csv',
    label: 'Topcon CSV',
    software: 'Topcon Magnet',
    extension: '.csv',
    description:
      'Topcon Magnet-compatible CSV (Point ID,E,N,EL,Code) for machine control.',
  },
  {
    id: 'generic_csv',
    label: 'Generic CSV',
    software: 'Universal',
    extension: '.csv',
    description:
      'Universal comma-separated format (Name,Easting,Northing,Elevation,Code,Description).',
  },
  {
    id: 'alignment_xml',
    label: 'Alignment XML',
    software: 'Universal',
    extension: '.xml',
    description:
      'XML format for alignment and design data exchange between CAD and machine control.',
  },
];

// ─── Trimble CSV ────────────────────────────────────────────────────────────

/**
 * Export points in Trimble-compatible CSV format.
 *
 * Format: Name,E,N,Z,Code,Description
 * Header line identifies the source and format.
 *
 * @param points Machine control points to export
 * @returns Trimble-compatible CSV string
 */
export function exportTrimbleCSV(points: MachineControlPoint[]): string {
  const lines: string[] = [
    '# Metardu Machine Control Export — Trimble Compatible CSV',
    '# Format: Name,Easting,Northing,Elevation,Code,Description',
    '# Units: metres',
    `# Points: ${points.length}`,
    `# Date: ${new Date().toISOString()}`,
    '',
    'Name,Easting,Northing,Elevation,Code,Description',
  ];

  for (const p of points) {
    const name = escapeCsvField(p.name);
    const e = p.easting.toFixed(4);
    const n = p.northing.toFixed(4);
    const z = p.elevation.toFixed(4);
    const code = escapeCsvField(p.code);
    const desc = escapeCsvField(p.description || '');
    lines.push(`${name},${e},${n},${z},${code},${desc}`);
  }

  lines.push('');
  lines.push('# End');
  return lines.join('\n');
}

// ─── Leica GSI-8 ────────────────────────────────────────────────────────────

/**
 * Encode a GSI-8 word.
 *
 * Format: *WWTTTT+NNNNNNNNN (16 characters total)
 *   *  = start marker
 *   WW = word type (2 digits)
 *   TTTT = point index (4 digits)
 *   +/-  = sign
 *   NNNNNNNNN = value (9 digits, padded with leading zeros)
 *
 * For string codes (word 81), the value field contains the code
 * left-justified and space-padded to 8 characters (no sign).
 */
function gsi8Word(
  wordType: number,
  pointIndex: number,
  value: string | number
): string {
  const wt = String(wordType).padStart(2, '0');
  const pi = String(pointIndex).padStart(4, '0');

  let content: string;
  if (typeof value === 'string') {
    // String value: left-justified, space-padded to 8 chars
    content = value.padEnd(8, ' ').substring(0, 8);
  } else {
    // Numeric value: sign + 9 digits
    const sign = value >= 0 ? '+' : '-';
    const abs = Math.abs(value);
    const integer = Math.floor(abs);
    const decimal = Math.round((abs - integer) * 1000); // 3 decimal places
    const combined = integer * 1000 + decimal;
    content = sign + String(combined).padStart(9, '0');
  }

  return `*${wt}${pi}${content}`;
}

/**
 * Export points in Leica GSI-8 format.
 *
 * Each point is represented by 4 word records:
 *   11 = Point ID (name encoded as numeric index)
 *   21 = Easting
 *   22 = Northing
 *   31 = Elevation
 *   81 = Code (alphanumeric)
 *
 * Points are separated by blank lines.
 *
 * @param points Machine control points to export
 * @returns Leica GSI-8 formatted string
 */
export function exportLeicaGSI(points: MachineControlPoint[]): string {
  const lines: string[] = [
    '# Metardu Machine Control Export — Leica GSI-8',
    `# Points: ${points.length}`,
    `# Date: ${new Date().toISOString()}`,
    '',
  ];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const idx = i + 1;

    lines.push(gsi8Word(11, idx, idx)); // Point ID
    lines.push(gsi8Word(21, idx, p.easting)); // Easting
    lines.push(gsi8Word(22, idx, p.northing)); // Northing
    lines.push(gsi8Word(31, idx, p.elevation)); // Elevation
    lines.push(gsi8Word(81, idx, p.code)); // Code
    lines.push(''); // Blank separator
  }

  lines.push('# End');
  return lines.join('\n');
}

// ─── Topcon CSV ─────────────────────────────────────────────────────────────

/**
 * Export points in Topcon Magnet-compatible CSV format.
 *
 * Format: Point ID,E,N,EL,Code
 *
 * @param points Machine control points to export
 * @returns Topcon-compatible CSV string
 */
export function exportTopconCSV(points: MachineControlPoint[]): string {
  const lines: string[] = [
    '# Metardu Machine Control Export — Topcon Magnet CSV',
    '# Format: Point ID,Easting,Northing,Elevation,Code',
    '# Units: metres',
    `# Points: ${points.length}`,
    `# Date: ${new Date().toISOString()}`,
    '',
    'Point ID,E,N,EL,Code',
  ];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const id = escapeCsvField(p.name || String(i + 1));
    const e = p.easting.toFixed(4);
    const n = p.northing.toFixed(4);
    const el = p.elevation.toFixed(4);
    const code = escapeCsvField(p.code);
    lines.push(`${id},${e},${n},${el},${code}`);
  }

  lines.push('');
  lines.push('# End');
  return lines.join('\n');
}

// ─── Generic CSV ────────────────────────────────────────────────────────────

/**
 * Export points in a universal CSV format.
 *
 * Format: Name,Easting,Northing,Elevation,Code,Description
 *
 * @param points Machine control points to export
 * @returns Generic CSV string
 */
export function exportGenericCSV(points: MachineControlPoint[]): string {
  const lines: string[] = [
    '# Metardu Machine Control Export — Generic CSV',
    '# Format: Name,Easting,Northing,Elevation,Code,Description',
    '# Units: metres',
    `# Points: ${points.length}`,
    `# Date: ${new Date().toISOString()}`,
    '',
    'Name,Easting,Northing,Elevation,Code,Description',
  ];

  for (const p of points) {
    const name = escapeCsvField(p.name);
    const e = p.easting.toFixed(4);
    const n = p.northing.toFixed(4);
    const z = p.elevation.toFixed(4);
    const code = escapeCsvField(p.code);
    const desc = escapeCsvField(p.description || '');
    lines.push(`${name},${e},${n},${z},${code},${desc}`);
  }

  lines.push('');
  lines.push('# End');
  return lines.join('\n');
}

// ─── Alignment XML ──────────────────────────────────────────────────────────

/**
 * Export points in a structured XML format for alignment and
 * design data exchange.
 *
 * The XML schema includes a header with project metadata and
 * a points collection with coordinate data.
 *
 * @param points Machine control points to export
 * @param name Project or alignment name
 * @param coordinateSystem Coordinate reference system identifier
 * @returns XML-formatted string
 */
export function exportAlignmentXML(
  points: MachineControlPoint[],
  name: string,
  coordinateSystem: string
): string {
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toISOString().split('T')[1].split('.')[0];

  const pointElements = points
    .map(
      (p) => `      <Point name="${escapeXmlAttr(p.name)}" code="${escapeXmlAttr(p.code)}">
        <Easting>${p.easting.toFixed(4)}</Easting>
        <Northing>${p.northing.toFixed(4)}</Northing>
        <Elevation>${p.elevation.toFixed(4)}</Elevation>${
          p.description
            ? `\n        <Description>${escapeXmlText(p.description)}</Description>`
            : ''
        }
      </Point>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<MachineControlData>
  <Header>
    <ProjectName>${escapeXmlText(name)}</ProjectName>
    <CoordinateSystem>${escapeXmlText(coordinateSystem)}</CoordinateSystem>
    <PointCount>${points.length}</PointCount>
    <GeneratedBy>Metardu</GeneratedBy>
    <Date>${date}</Date>
    <Time>${time}</Time>
  </Header>
  <Points>
${pointElements}
  </Points>
</MachineControlData>`;
}

// ─── Unified Export Dispatcher ──────────────────────────────────────────────

/**
 * Export machine control points in the specified format.
 *
 * Returns an object with the file content, suggested filename (without
 * project prefix), and file extension.
 *
 * @param points   Machine control points to export
 * @param options  Export format and metadata options
 * @returns Object with content, filename, and extension
 *
 * @example
 * ```ts
 * const result = exportMachineControl(points, {
 *   format: 'trimble_csv',
 *   coordinateSystem: 'UTM Zone 37S',
 * });
 * // result.content → CSV string
 * // result.ext → '.csv'
 * ```
 */
export function exportMachineControl(
  points: MachineControlPoint[],
  options: MachineControlOptions
): { content: string; filename: string; ext: string } {
  const { format, coordinateSystem = 'Local Grid', zone, datum } = options;
  const fmt = MACHINE_FORMATS.find((f) => f.id === format);
  const ext = fmt ? fmt.extension : '.csv';
  const filename = `machine_control${ext}`;

  let content: string;

  switch (format) {
    case 'trimble_csv':
      content = exportTrimbleCSV(points);
      break;

    case 'leica_gsi':
      content = exportLeicaGSI(points);
      break;

    case 'topcon_csv':
      content = exportTopconCSV(points);
      break;

    case 'generic_csv':
      content = exportGenericCSV(points);
      break;

    case 'alignment_xml':
      content = exportAlignmentXML(points, 'Machine Control Export', coordinateSystem);
      break;

    default:
      content = exportGenericCSV(points);
  }

  // Inject coordinate system info into header if provided
  if (coordinateSystem && format !== 'alignment_xml') {
    const csLine = `# Coordinate System: ${coordinateSystem}`;
    if (zone) {
      const zoneLine = `# UTM Zone: ${zone}${datum === 'S' ? 'S' : datum === 'N' ? 'N' : ''}`;
      content = content.replace(
        '# Date:',
        `${csLine}\n${zoneLine}\n# Datum: ${datum || 'WGS84'}\n# Date:`
      );
    } else {
      content = content.replace('# Date:', `${csLine}\n# Date:`);
    }
  }

  return { content, filename, ext };
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/**
 * Escape a CSV field: wrap in double quotes if it contains a comma,
 * newline, or double quote. Double any internal double quotes.
 */
function escapeCsvField(value: string): string {
  if (!value) return '';
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Escape text for XML element content.
 */
function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape text for XML attribute values.
 */
function escapeXmlAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
