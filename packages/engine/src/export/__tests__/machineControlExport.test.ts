import {
  exportTrimbleCSV,
  exportLeicaGSI,
  exportTopconCSV,
  exportGenericCSV,
  exportAlignmentXML,
  exportMachineControl,
  MACHINE_FORMATS,
  type MachineControlPoint,
} from '@/lib/export/machineControlExport';

// ─── Test data ─────────────────────────────────────────────────────────────

const testPoints: MachineControlPoint[] = [
  { name: 'P1', easting: 1000.1234, northing: 2000.5678, elevation: 1250.0012, code: 'RD', description: 'Road edge' },
  { name: 'P2', easting: 1010.5678, northing: 2005.1234, elevation: 1249.5000, code: 'BLD', description: 'Building corner' },
  { name: 'P3', easting: 1020.0000, northing: 2010.0000, elevation: 1251.2500, code: 'BM', description: 'Benchmark' },
];

// ─── exportTrimbleCSV ─────────────────────────────────────────────────────

describe('exportTrimbleCSV()', () => {
  it('produces CSV with Name,Easting,Northing,Elevation,Code,Description headers', () => {
    const csv = exportTrimbleCSV(testPoints);
    const lines = csv.split('\n');
    const headerLine = lines.find(l => l.includes('Name') && !l.startsWith('#'));
    expect(headerLine).toBeTruthy();
    expect(headerLine).toContain('Name');
    expect(headerLine).toContain('Easting');
    expect(headerLine).toContain('Northing');
    expect(headerLine).toContain('Elevation');
    expect(headerLine).toContain('Code');
    expect(headerLine).toContain('Description');
  });

  it('contains point data rows', () => {
    const csv = exportTrimbleCSV(testPoints);
    expect(csv).toContain('P1');
    expect(csv).toContain('1000.1234');
    expect(csv).toContain('2000.5678');
    expect(csv).toContain('1250.0012');
    expect(csv).toContain('RD');
  });
});

// ─── exportLeicaGSI ──────────────────────────────────────────────────────

describe('exportLeicaGSI()', () => {
  it('produces lines starting with *', () => {
    const gsi = exportLeicaGSI(testPoints);
    const dataLines = gsi.split('\n').filter(l => l.startsWith('*'));
    expect(dataLines.length).toBeGreaterThan(0);
  });

  it('correct GSI word format (starts with *, has word type and point index)', () => {
    const gsi = exportLeicaGSI(testPoints);
    const dataLines = gsi.split('\n').filter(l => l.startsWith('*'));
    for (const line of dataLines) {
      // Format: *WWTTTT[content]
      // Numeric words: * + 2 + 4 + 10 = 17 chars
      // String words (code 81): * + 2 + 4 + 8 = 15 chars
      expect(line[0]).toBe('*');
      // Word type should be 11, 21, 22, 31, or 81
      const wt = parseInt(line.substring(1, 3), 10);
      expect([11, 21, 22, 31, 81]).toContain(wt);
      expect(line.length).toBeGreaterThanOrEqual(15);
    }
  });

  it('has correct number of word records per point (5 data words)', () => {
    const gsi = exportLeicaGSI(testPoints);
    // Per point: word 11 (ID), 21 (E), 22 (N), 31 (Z), 81 (Code) = 5 words
    const dataLines = gsi.split('\n').filter(l => l.startsWith('*'));
    expect(dataLines.length).toBe(3 * 5); // 3 points × 5 words
  });
});

// ─── exportTopconCSV ─────────────────────────────────────────────────────

describe('exportTopconCSV()', () => {
  it('produces CSV with correct columns', () => {
    const csv = exportTopconCSV(testPoints);
    const lines = csv.split('\n');
    const headerLine = lines.find(l => l.includes('Point ID') && !l.startsWith('#'));
    expect(headerLine).toBeTruthy();
    expect(headerLine).toContain('Point ID');
    expect(headerLine).toContain('E');
    expect(headerLine).toContain('N');
    expect(headerLine).toContain('EL');
    expect(headerLine).toContain('Code');
  });

  it('contains point data', () => {
    const csv = exportTopconCSV(testPoints);
    expect(csv).toContain('P1');
    expect(csv).toContain('1000.1234');
  });
});

// ─── exportGenericCSV ────────────────────────────────────────────────────

describe('exportGenericCSV()', () => {
  it('produces universal CSV', () => {
    const csv = exportGenericCSV(testPoints);
    const lines = csv.split('\n');
    const headerLine = lines.find(l => l.includes('Name') && !l.startsWith('#'));
    expect(headerLine).toBeTruthy();
    expect(headerLine).toContain('Name');
    expect(headerLine).toContain('Easting');
    expect(headerLine).toContain('Northing');
    expect(headerLine).toContain('Elevation');
    expect(headerLine).toContain('Code');
    expect(headerLine).toContain('Description');
  });

  it('contains all point data', () => {
    const csv = exportGenericCSV(testPoints);
    expect(csv).toContain('P1');
    expect(csv).toContain('P2');
    expect(csv).toContain('P3');
    expect(csv).toContain('Road edge');
    expect(csv).toContain('Building corner');
  });
});

// ─── exportAlignmentXML ──────────────────────────────────────────────────

describe('exportAlignmentXML()', () => {
  it('produces valid XML with root element', () => {
    const xml = exportAlignmentXML(testPoints, 'Test Alignment', 'UTM Zone 37S');
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<MachineControlData>');
    expect(xml).toContain('</MachineControlData>');
  });

  it('contains header information', () => {
    const xml = exportAlignmentXML(testPoints, 'Test Alignment', 'UTM Zone 37S');
    expect(xml).toContain('<ProjectName>Test Alignment</ProjectName>');
    expect(xml).toContain('<CoordinateSystem>UTM Zone 37S</CoordinateSystem>');
    expect(xml).toContain('<PointCount>3</PointCount>');
  });

  it('contains point data', () => {
    const xml = exportAlignmentXML(testPoints, 'Test', 'Local');
    expect(xml).toContain('<Point name="P1"');
    expect(xml).toContain('<Easting>1000.1234</Easting>');
    expect(xml).toContain('<Northing>2000.5678</Northing>');
    expect(xml).toContain('<Elevation>1250.0012</Elevation>');
    expect(xml).toContain('<Description>Road edge</Description>');
  });

  it('escapes XML special characters', () => {
    const specialPoints: MachineControlPoint[] = [
      { name: 'P&1', easting: 100, northing: 200, elevation: 50, code: 'TE<ST', description: 'A & B < C' },
    ];
    const xml = exportAlignmentXML(specialPoints, 'Test', 'Local');
    expect(xml).toContain('P&amp;1');
    expect(xml).toContain('TE&lt;ST');
    expect(xml).toContain('A &amp; B &lt; C');
  });
});

// ─── exportMachineControl ────────────────────────────────────────────────

describe('exportMachineControl()', () => {
  it('returns correct content and extension for trimble_csv', () => {
    const result = exportMachineControl(testPoints, { format: 'trimble_csv' });
    expect(result.content).toContain('Name');
    expect(result.ext).toBe('.csv');
    expect(result.filename).toContain('machine_control');
    expect(result.filename).toContain('.csv');
  });

  it('returns correct content and extension for leica_gsi', () => {
    const result = exportMachineControl(testPoints, { format: 'leica_gsi' });
    expect(result.content).toContain('*');
    expect(result.ext).toBe('.gsi');
  });

  it('returns correct content and extension for topcon_csv', () => {
    const result = exportMachineControl(testPoints, { format: 'topcon_csv' });
    expect(result.content).toContain('Point ID');
    expect(result.ext).toBe('.csv');
  });

  it('returns correct content and extension for generic_csv', () => {
    const result = exportMachineControl(testPoints, { format: 'generic_csv' });
    expect(result.content).toContain('Name');
    expect(result.ext).toBe('.csv');
  });

  it('returns correct content and extension for alignment_xml', () => {
    const result = exportMachineControl(testPoints, { format: 'alignment_xml' });
    expect(result.content).toContain('<MachineControlData>');
    expect(result.ext).toBe('.xml');
  });

  it('injects coordinate system into non-XML formats', () => {
    const result = exportMachineControl(testPoints, {
      format: 'trimble_csv',
      coordinateSystem: 'UTM Zone 37S',
    });
    expect(result.content).toContain('UTM Zone 37S');
  });
});

// ─── MACHINE_FORMATS ─────────────────────────────────────────────────────

describe('MACHINE_FORMATS', () => {
  it('has 5 formats', () => {
    expect(MACHINE_FORMATS).toHaveLength(5);
  });

  it('has correct ids', () => {
    const ids = MACHINE_FORMATS.map(f => f.id);
    expect(ids).toContain('trimble_csv');
    expect(ids).toContain('leica_gsi');
    expect(ids).toContain('topcon_csv');
    expect(ids).toContain('generic_csv');
    expect(ids).toContain('alignment_xml');
  });

  it('each format has required properties', () => {
    for (const fmt of MACHINE_FORMATS) {
      expect(fmt.id).toBeTruthy();
      expect(fmt.label).toBeTruthy();
      expect(fmt.software).toBeTruthy();
      expect(fmt.extension).toBeTruthy();
      expect(fmt.description).toBeTruthy();
      expect(fmt.extension).toMatch(/^\./);
    }
  });
});
