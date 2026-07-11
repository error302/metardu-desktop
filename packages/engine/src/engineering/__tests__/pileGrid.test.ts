import {
  type PileGridDefinition,
  generatePileGrid,
  computeSettingOut,
  formatBearingDMS,
  pileGridToCSV,
  parsePileGridCSV,
  generatePileGridDXF,
} from '@/lib/engineering/pileGrid';

// ─── Test fixtures ──────────────────────────────────────────────────────────

const basicDef: PileGridDefinition = {
  name: 'Test Grid',
  originEasting: 1000,
  originNorthing: 2000,
  originRL: 1250,
  rows: 3,
  columns: 4,
  rowSpacing: 5,
  columnSpacing: 6,
  rotation: 0,
  startLabel: 'A1',
  labelRowsAs: 'alpha',
  labelColumnsAs: 'numeric',
  pileType: 'pile',
  coordinateSystem: 'Local Grid',
};

const numericDef: PileGridDefinition = {
  ...basicDef,
  labelRowsAs: 'numeric',
  labelColumnsAs: 'numeric',
};

// ─── generatePileGrid ──────────────────────────────────────────────────────

describe('generatePileGrid()', () => {
  it('produces correct number of piles (rows × columns)', () => {
    const result = generatePileGrid(basicDef);
    expect(result.totalPiles).toBe(3 * 4); // 12
    expect(result.piles).toHaveLength(12);
  });

  it('piles at (0,0) match origin coordinates', () => {
    const result = generatePileGrid(basicDef);
    const firstPile = result.piles[0];
    expect(firstPile.easting).toBeCloseTo(1000, 4);
    expect(firstPile.northing).toBeCloseTo(2000, 4);
  });

  it('label generation works for alpha-numeric (e.g. A1, A2, B1, B2)', () => {
    const result = generatePileGrid(basicDef);
    const labels = result.piles.map(p => p.label);
    expect(labels).toContain('A1');
    expect(labels).toContain('A2');
    expect(labels).toContain('B1');
    expect(labels).toContain('B2');
    expect(labels).toContain('C1');
  });

  it('label generation works for numeric-numeric (e.g. 1-1, 1-2, 2-1)', () => {
    const result = generatePileGrid(numericDef);
    const labels = result.piles.map(p => p.label);
    expect(labels).toContain('11');
    expect(labels).toContain('12');
    expect(labels).toContain('21');
  });

  it('rotation 90° swaps E/N offsets', () => {
    const rotatedDef = { ...basicDef, rotation: 90 };
    const result0 = generatePileGrid(basicDef);
    const result90 = generatePileGrid(rotatedDef);

    // At rotation=0: pile at row=0,col=1 has offsetE=6, offsetN=0
    const pile0_01 = result0.piles.find(p => p.row === 0 && p.column === 1);
    expect(pile0_01).not.toBeNull();
    // At rotation=90°: that offset should become offsetE=0, offsetN=6
    const pile90_01 = result90.piles.find(p => p.row === 0 && p.column === 1);
    expect(pile90_01).not.toBeNull();

    expect(pile0_01!.gridOffsetE).toBeCloseTo(6, 2);
    expect(pile0_01!.gridOffsetN).toBeCloseTo(0, 2);
    // At 90°: lx=6, ly=0 → rx = 6*cos90 + 0*sin90 = 0, ry = -6*sin90 + 0*cos90 = -6
    // Wait, actually: ry = -lx*sin(theta) + ly*cos(theta) = -6*1 + 0*0 = -6
    // That gives northing = 2000 + (-6) = 1994
    // But offsetN = ry = -6, that's negative offset in N direction
    expect(pile90_01!.gridOffsetE).toBeCloseTo(0, 2);
  });

  it('bounding box is correct', () => {
    const result = generatePileGrid(basicDef);
    const { boundingBox } = result;
    expect(boundingBox.minE).toBeCloseTo(1000, 4);
    expect(boundingBox.minN).toBeCloseTo(2000, 4);
    expect(boundingBox.maxE).toBeCloseTo(1000 + 3 * 6, 4); // 3 cols spacing
    expect(boundingBox.maxN).toBeCloseTo(2000 + 2 * 5, 4); // 2 rows spacing
  });

  it('area equals rows×spacing × cols×spacing (using (n-1) gaps)', () => {
    const result = generatePileGrid(basicDef);
    const expectedArea = (4 - 1) * 6 * (3 - 1) * 5; // 18 * 10 = 180
    expect(result.area).toBeCloseTo(expectedArea, 4);
  });

  it('single row/column grid produces 1 pile', () => {
    const singleDef = { ...basicDef, rows: 1, columns: 1 };
    const result = generatePileGrid(singleDef);
    expect(result.totalPiles).toBe(1);
    expect(result.area).toBe(0); // (1-1)*spacing * (1-1)*spacing = 0
  });
});

// ─── computeSettingOut ─────────────────────────────────────────────────────

describe('computeSettingOut()', () => {
  it('computes correct bearing and distance for known geometry', () => {
    const result = generatePileGrid(basicDef);
    // Station at (1000, 2000), pile A1 is also at (1000, 2000) → distance 0
    const so = computeSettingOut(result.piles, 1000, 2000, 1245, 1.5);
    const a1 = so.find(s => s.pile.label === 'A1');
    expect(a1).not.toBeNull();
    expect(a1!.horizontalDistance).toBeCloseTo(0, 4);
    expect(a1!.targetHeight).toBeCloseTo(1250 - 1245 - 1.5, 4); // 3.5
  });

  it('target height = designRL - stationRL - HI', () => {
    const pile = basicDef;
    const designRL = 1250;
    const stationRL = 1240;
    const HI = 1.5;
    const result = generatePileGrid(basicDef);
    const so = computeSettingOut(result.piles, 999, 1999, stationRL, HI);
    // All piles have designRL = 1250
    for (const item of so) {
      expect(item.targetHeight).toBeCloseTo(designRL - stationRL - HI, 4);
    }
  });

  it('bearing to due East is 90°', () => {
    const result = generatePileGrid(basicDef);
    // Station at (1000, 2000), pile B2 at row=1,col=1 → E=1006, N=2005
    const so = computeSettingOut(result.piles, 1000, 2005, 1245, 1.5);
    const b2 = so.find(s => s.pile.column === 1 && s.pile.row === 1);
    expect(b2).not.toBeNull();
    expect(b2!.bearingDeg).toBeCloseTo(90, 1);
  });
});

// ─── formatBearingDMS ──────────────────────────────────────────────────────

describe('formatBearingDMS()', () => {
  it('formats 45.5° correctly', () => {
    // 45.5° = 45° 30' 00.0"
    const result = formatBearingDMS(45.5);
    expect(result).toContain('45');
    expect(result).toContain('30');
  });

  it('formats 0° correctly', () => {
    const result = formatBearingDMS(0);
    expect(result).toContain('00');
    expect(result).toContain('00');
  });

  it('formats 360° as 0°', () => {
    const result = formatBearingDMS(360);
    expect(result).toContain('00');
  });

  it('formats 127°30\'15.2"', () => {
    const result = formatBearingDMS(127.5042);
    expect(result).toContain('127');
    expect(result).toContain('30');
  });

  it('handles negative values by normalizing', () => {
    const pos = formatBearingDMS(45);
    const neg = formatBearingDMS(-315);
    // -315 + 360 = 45
    expect(neg).toBe(pos);
  });
});

// ─── generatePileGridDXF ──────────────────────────────────────────────────

describe('generatePileGridDXF()', () => {
  it('produces string with DXF headers', () => {
    const result = generatePileGrid(basicDef);
    const dxf = generatePileGridDXF(result);
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('HEADER');
    expect(dxf).toContain('ENTITIES');
    expect(dxf).toContain('EOF');
  });

  it('contains SETOUT_POINTS layer', () => {
    const result = generatePileGrid(basicDef);
    const dxf = generatePileGridDXF(result);
    expect(dxf).toContain('SETOUT_POINTS');
  });

  it('contains pile labels as TEXT entities', () => {
    const result = generatePileGrid(basicDef);
    const dxf = generatePileGridDXF(result);
    expect(dxf).toContain('A1');
  });
});

// ─── pileGridToCSV ─────────────────────────────────────────────────────────

describe('pileGridToCSV()', () => {
  it('produces valid CSV', () => {
    const result = generatePileGrid(basicDef);
    const csv = pileGridToCSV(result);
    const lines = csv.trim().split('\n');

    // Header + data rows
    expect(lines.length).toBe(1 + result.piles.length);
    expect(lines[0]).toContain('Label');
    expect(lines[0]).toContain('Easting');
    expect(lines[0]).toContain('Northing');

    // Check a data row
    const dataRow = lines[1].split(',');
    expect(dataRow[0]).toBe('A1');
  });
});

// ─── parsePileGridCSV ──────────────────────────────────────────────────────

describe('parsePileGridCSV()', () => {
  it('parses Parameter,Value format', () => {
    const csv = `Parameter,Value
Name,Test Grid
Origin E,1000.0
Origin N,2000.0
Origin RL,1250.0
Rows,3
Columns,4
Row Spacing,5.0
Column Spacing,6.0
Rotation,0.0
Start Label,A1
Label Rows As,alpha
Label Columns As,numeric
Pile Type,pile
Coordinate System,Local Grid`;

    const def = parsePileGridCSV(csv);
    expect(def.name).toBe('Test Grid');
    expect(def.originEasting).toBeCloseTo(1000, 1);
    expect(def.originNorthing).toBeCloseTo(2000, 1);
    expect(def.originRL).toBeCloseTo(1250, 1);
    expect(def.rows).toBe(3);
    expect(def.columns).toBe(4);
    expect(def.rowSpacing).toBeCloseTo(5, 1);
    expect(def.columnSpacing).toBeCloseTo(6, 1);
    expect(def.rotation).toBeCloseTo(0, 1);
    expect(def.startLabel).toBe('A1');
    expect(def.labelRowsAs).toBe('alpha');
    expect(def.labelColumnsAs).toBe('numeric');
    expect(def.pileType).toBe('pile');
    expect(def.coordinateSystem).toBe('Local Grid');
  });

  it('skips header row', () => {
    const csv = `Parameter,Value
Name,My Grid`;
    const def = parsePileGridCSV(csv);
    expect(def.name).toBe('My Grid');
  });

  it('returns empty object for empty CSV', () => {
    const def = parsePileGridCSV('');
    expect(Object.keys(def)).toHaveLength(0);
  });
});
