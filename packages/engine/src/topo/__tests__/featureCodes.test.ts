import {
  getFeatureCode,
  getAllGroups,
  getCodesByCategory,
  mapPointsToLayers,
  joinFeatureLines,
  aciToHex,
  searchFeatureCodes,
  KENYA_TOPO_CODES,
  type SurveyPointWithCode,
} from '@/lib/topo/featureCodes';

// ─── getFeatureCode ─────────────────────────────────────────────────────────

describe('getFeatureCode()', () => {
  it('returns correct definition for known code RD', () => {
    const fc = getFeatureCode('RD');
    expect(fc).not.toBeNull();
    expect(fc!.code).toBe('RD');
    expect(fc!.description).toBe('Road Carriageway Edge');
    expect(fc!.category).toBe('transportation');
    expect(fc!.dxfLayer).toBe('ROAD-EDGE');
  });

  it('returns correct definition for BLD', () => {
    const fc = getFeatureCode('BLD');
    expect(fc).not.toBeNull();
    expect(fc!.code).toBe('BLD');
    expect(fc!.dxfLayer).toBe('STRUCT-BUILDING');
  });

  it('returns correct definition for TRV', () => {
    const fc = getFeatureCode('TRV');
    expect(fc).not.toBeNull();
    expect(fc!.code).toBe('TRV');
    expect(fc!.dxfLayer).toBe('VEG-TREE');
  });

  it('returns correct definition for BND', () => {
    const fc = getFeatureCode('BND');
    expect(fc).not.toBeNull();
    expect(fc!.dxfLayer).toBe('BOUNDARY-CADASTRAL');
    expect(fc!.lineType).toBe('DASHED');
  });

  it('returns undefined for unknown code', () => {
    const fc = getFeatureCode('NONEXISTENT');
    expect(fc).toBeUndefined();
  });

  it('is case-insensitive', () => {
    expect(getFeatureCode('rd')?.code).toBe('RD');
    expect(getFeatureCode('bld')?.code).toBe('BLD');
    expect(getFeatureCode('Rd')?.code).toBe('RD');
    expect(getFeatureCode('Trv')?.code).toBe('TRV');
    expect(getFeatureCode('rd-ctr')?.code).toBe('RD-CTR');
  });
});

// ─── getAllGroups ────────────────────────────────────────────────────────────

describe('getAllGroups()', () => {
  it('returns all 10 categories', () => {
    const groups = getAllGroups();
    expect(groups).toHaveLength(10);
  });

  it('returns categories in correct order', () => {
    const groups = getAllGroups();
    const categories = groups.map(g => g.category);
    expect(categories).toEqual([
      'boundary', 'structure', 'transportation', 'utilities', 'hydrography',
      'vegetation', 'relief', 'control', 'furniture', 'other',
    ]);
  });

  it('each group has correct name and codes', () => {
    const groups = getAllGroups();
    const boundary = groups.find(g => g.category === 'boundary');
    expect(boundary).not.toBeNull();
    expect(boundary!.name).toBe('Boundary');
    expect(boundary!.codes.length).toBe(5);
  });
});

// ─── getCodesByCategory ─────────────────────────────────────────────────────

describe('getCodesByCategory()', () => {
  it('returns transportation codes including RD, RD-CTR, etc.', () => {
    const groups = getCodesByCategory('transportation');
    expect(groups).toHaveLength(1);
    const codes = groups[0].codes.map(c => c.code);
    expect(codes).toContain('RD');
    expect(codes).toContain('RD-CTR');
    expect(codes).toContain('RD-VERGE');
    expect(codes).toContain('RD-KERB');
    expect(codes).toContain('RD-PATH');
  });

  it('returns all groups when no category specified', () => {
    const groups = getCodesByCategory();
    expect(groups).toHaveLength(10);
  });

  it('returns all groups when wildcard specified', () => {
    const groups = getCodesByCategory('*');
    expect(groups).toHaveLength(10);
  });

  it('returns empty array for unknown category', () => {
    const groups = getCodesByCategory('nonexistent');
    expect(groups).toHaveLength(0);
  });
});

// ─── mapPointsToLayers ─────────────────────────────────────────────────────

describe('mapPointsToLayers()', () => {
  it('correctly groups points by DXF layer', () => {
    const points: SurveyPointWithCode[] = [
      { easting: 100, northing: 200, code: 'RD' },
      { easting: 101, northing: 200, code: 'RD' },
      { easting: 200, northing: 300, code: 'BLD' },
    ];
    const layers = mapPointsToLayers(points);
    expect(layers).toHaveLength(2);

    const roadLayer = layers.find(l => l.layer === 'ROAD-EDGE');
    expect(roadLayer).not.toBeNull();
    expect(roadLayer!.points).toHaveLength(2);

    const bldLayer = layers.find(l => l.layer === 'STRUCT-BUILDING');
    expect(bldLayer).not.toBeNull();
    expect(bldLayer!.points).toHaveLength(1);
  });

  it('generates polylines for codes with joinLines=true', () => {
    const points: SurveyPointWithCode[] = [
      { easting: 100, northing: 200, code: 'RD' },
      { easting: 101, northing: 200, code: 'RD' },
      { easting: 102, northing: 200, code: 'RD' },
    ];
    const layers = mapPointsToLayers(points);
    const roadLayer = layers.find(l => l.layer === 'ROAD-EDGE');
    expect(roadLayer).not.toBeNull();
    expect(roadLayer!.polylines).toHaveLength(1);
    expect(roadLayer!.polylines[0]).toHaveLength(3);
  });

  it('no polylines for codes with joinLines=false', () => {
    const points: SurveyPointWithCode[] = [
      { easting: 100, northing: 200, code: 'TRV' },
      { easting: 101, northing: 200, code: 'TRV' },
    ];
    const layers = mapPointsToLayers(points);
    const treeLayer = layers.find(l => l.layer === 'VEG-TREE');
    expect(treeLayer).not.toBeNull();
    expect(treeLayer!.polylines).toHaveLength(0);
  });

  it('maps unknown codes to OTHER-UNKNOWN layer', () => {
    const points: SurveyPointWithCode[] = [
      { easting: 100, northing: 200, code: 'FAKE' },
    ];
    const layers = mapPointsToLayers(points);
    expect(layers).toHaveLength(1);
    expect(layers[0].layer).toBe('OTHER-UNKNOWN');
  });
});

// ─── joinFeatureLines ──────────────────────────────────────────────────────

describe('joinFeatureLines()', () => {
  it('joins sequential points correctly', () => {
    const points: SurveyPointWithCode[] = [
      { easting: 100, northing: 200, code: 'RD' },
      { easting: 101, northing: 200, code: 'RD' },
      { easting: 102, northing: 200, code: 'RD' },
    ];
    const result = joinFeatureLines(points, 'RD');
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(3);
    expect(result[0][0]).toEqual({ e: 100, n: 200 });
    expect(result[0][2]).toEqual({ e: 102, n: 200 });
  });

  it("doesn't join non-sequential points", () => {
    const points: SurveyPointWithCode[] = [
      { easting: 100, northing: 200, code: 'RD' },
      { easting: 200, northing: 300, code: 'BLD' },
      { easting: 101, northing: 200, code: 'RD' },
    ];
    const result = joinFeatureLines(points, 'RD');
    // Single points don't form polylines (need >= 2 vertices)
    expect(result).toHaveLength(0);
  });

  it('creates multiple polylines when there are gaps', () => {
    const points: SurveyPointWithCode[] = [
      { easting: 100, northing: 200, code: 'RD' },
      { easting: 101, northing: 200, code: 'RD' },
      { easting: 500, northing: 500, code: 'BLD' },
      { easting: 200, northing: 200, code: 'RD' },
      { easting: 201, northing: 200, code: 'RD' },
    ];
    const result = joinFeatureLines(points, 'RD');
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(2);
    expect(result[1]).toHaveLength(2);
  });
});

// ─── searchFeatureCodes ────────────────────────────────────────────────────

describe('searchFeatureCodes()', () => {
  it('finds codes by keyword "road"', () => {
    const results = searchFeatureCodes('road');
    const codes = results.map(r => r.code);
    expect(codes).toContain('RD');
    expect(codes).toContain('RD-CTR');
    expect(codes).toContain('RD-VERGE');
    expect(codes).toContain('RD-KERB');
    expect(codes).toContain('RD-PATH');
  });

  it('is case-insensitive', () => {
    const upper = searchFeatureCodes('ROAD');
    const lower = searchFeatureCodes('road');
    expect(upper).toEqual(lower);
  });

  it('returns empty for non-matching query', () => {
    const results = searchFeatureCodes('zzzzzzzzz');
    expect(results).toHaveLength(0);
  });

  it('respects limit parameter', () => {
    const results = searchFeatureCodes('', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});

// ─── Unique DXF layers ─────────────────────────────────────────────────────

describe('DXF layer uniqueness', () => {
  it('all codes have unique DXF layer names', () => {
    const layers = KENYA_TOPO_CODES.map(fc => fc.dxfLayer);
    const uniqueLayers = new Set(layers);
    // The task says "70 codes" but the actual count is 70 (5+10+12+10+8+8+5+4+5+3=70)
    expect(layers.length).toBe(70);
    expect(uniqueLayers.size).toBe(layers.length);
  });
});

// ─── aciToHex ──────────────────────────────────────────────────────────────

describe('aciToHex()', () => {
  it('returns valid hex color for known ACI', () => {
    expect(aciToHex(1)).toBe('#FF0000');
    expect(aciToHex(3)).toBe('#00FF00');
    expect(aciToHex(7)).toBe('#FFFFFF');
  });

  it('returns fallback for unknown ACI', () => {
    expect(aciToHex(999)).toBe('#808080');
  });

  it('returns hex string starting with #', () => {
    const result = aciToHex(5);
    expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
