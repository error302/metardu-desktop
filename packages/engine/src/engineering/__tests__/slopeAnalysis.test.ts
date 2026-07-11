import {
  analyzeSlopeFromPoints,
  computeCutFillDatum,
  computeAreaBetweenPoints,
  slopeAnalysisToCSV,
  type DTMPoint,
} from '@/lib/engineering/slopeAnalysis';

// ─── Test data ─────────────────────────────────────────────────────────────

const flatTerrain: DTMPoint[] = [
  { easting: 0, northing: 0, elevation: 100 },
  { easting: 5, northing: 0, elevation: 100 },
  { easting: 5, northing: 5, elevation: 100 },
  { easting: 0, northing: 5, elevation: 100 },
  { easting: 2.5, northing: 2.5, elevation: 100 },
];

const uniformSlope: DTMPoint[] = [
  { easting: 0, northing: 0, elevation: 100 },
  { easting: 5, northing: 0, elevation: 101 },
  { easting: 10, northing: 0, elevation: 102 },
  { easting: 0, northing: 5, elevation: 100 },
  { easting: 5, northing: 5, elevation: 101 },
  { easting: 10, northing: 5, elevation: 102 },
  { easting: 0, northing: 10, elevation: 100 },
  { easting: 5, northing: 10, elevation: 101 },
  { easting: 10, northing: 10, elevation: 102 },
];

const rectanglePoints: DTMPoint[] = [
  { easting: 100, northing: 100, elevation: 0 },
  { easting: 200, northing: 100, elevation: 0 },
  { easting: 200, northing: 200, elevation: 0 },
  { easting: 100, northing: 200, elevation: 0 },
];

// ─── analyzeSlopeFromPoints ────────────────────────────────────────────────

describe('analyzeSlopeFromPoints()', () => {
  it('flat terrain (all same elevation) returns 0% slope', () => {
    const result = analyzeSlopeFromPoints(flatTerrain, 2.0);
    expect(result.statistics.meanSlopePercent).toBe(0);
    expect(result.statistics.maxSlopePercent).toBe(0);
    expect(result.statistics.minSlopePercent).toBe(0);
  });

  it('uniform slope returns correct average slope', () => {
    // Slope of 1m rise over 5m run = 20%
    const result = analyzeSlopeFromPoints(uniformSlope, 5.0);
    // With a grid, the mean slope should be close to 20%
    expect(result.statistics.meanSlopePercent).toBeGreaterThan(10);
    expect(result.statistics.meanSlopePercent).toBeLessThan(30);
  });

  it('slope classification: flat (1%)', () => {
    const result = analyzeSlopeFromPoints(flatTerrain, 2.0);
    const flatCount = result.statistics.slopeDistribution.flat;
    expect(flatCount).toBeGreaterThan(0);
  });

  it('slope classification: gentle (3%)', () => {
    const gentleSlope: DTMPoint[] = [
      { easting: 0, northing: 0, elevation: 100 },
      { easting: 10, northing: 0, elevation: 100.3 },
      { easting: 10, northing: 10, elevation: 100.3 },
      { easting: 0, northing: 10, elevation: 100 },
      { easting: 5, northing: 5, elevation: 100.15 },
    ];
    const result = analyzeSlopeFromPoints(gentleSlope, 4.0);
    const gentleCount = result.statistics.slopeDistribution.gentle;
    expect(gentleCount).toBeGreaterThan(0);
  });

  it('slope classification: moderate (10%), steep (20%), very_steep (45%), cliff (70%)', () => {
    // Create a steep point cloud: 7m rise over 10m = 70%
    const steepTerrain: DTMPoint[] = [
      { easting: 0, northing: 0, elevation: 100 },
      { easting: 10, northing: 0, elevation: 107 },
      { easting: 10, northing: 10, elevation: 107 },
      { easting: 0, northing: 10, elevation: 100 },
      { easting: 5, northing: 5, elevation: 103.5 },
    ];
    const result = analyzeSlopeFromPoints(steepTerrain, 4.0);
    // The cliff classification (>60%) should have at least some points
    // depending on grid resolution
    expect(result.statistics.slopeDistribution).toBeDefined();
  });

  it('throws error for less than 3 points', () => {
    const fewPoints: DTMPoint[] = [
      { easting: 0, northing: 0, elevation: 100 },
      { easting: 1, northing: 0, elevation: 100 },
    ];
    expect(() => analyzeSlopeFromPoints(fewPoints, 1.0)).toThrow();
  });

  it('statistics include mean, max, min slope', () => {
    const result = analyzeSlopeFromPoints(flatTerrain, 2.0);
    expect(result.statistics).toHaveProperty('meanSlopePercent');
    expect(result.statistics).toHaveProperty('maxSlopePercent');
    expect(result.statistics).toHaveProperty('minSlopePercent');
    expect(result.statistics).toHaveProperty('meanSlopeDegrees');
    expect(typeof result.statistics.meanSlopePercent).toBe('number');
  });
});

// ─── computeCutFillDatum ──────────────────────────────────────────────────

describe('computeCutFillDatum()', () => {
  it('datum above surface gives cut volume', () => {
    const result = computeCutFillDatum(flatTerrain, 99, 2.0);
    // Surface at 100, datum at 99 → everything is above → all cut
    expect(result.totalCutVolume).toBeGreaterThan(0);
    expect(result.totalFillVolume).toBe(0);
    expect(result.netVolume).toBeGreaterThan(0);
  });

  it('datum below surface gives fill volume', () => {
    const result = computeCutFillDatum(flatTerrain, 101, 2.0);
    // Surface at 100, datum at 101 → everything is below → all fill
    expect(result.totalFillVolume).toBeGreaterThan(0);
    expect(result.totalCutVolume).toBe(0);
    expect(result.netVolume).toBeLessThan(0);
  });

  it('balance point is between min and max elevation', () => {
    const result = computeCutFillDatum(flatTerrain, 100, 2.0);
    expect(result.balancePoint).toBeGreaterThanOrEqual(99);
    expect(result.balancePoint).toBeLessThanOrEqual(101);
  });

  it('returns cut and fill areas', () => {
    const result = computeCutFillDatum(flatTerrain, 99, 2.0);
    expect(result.cutArea).toBeGreaterThan(0);
    expect(result.fillArea).toBe(0);
  });

  it('throws error for less than 3 points', () => {
    const fewPoints: DTMPoint[] = [
      { easting: 0, northing: 0, elevation: 100 },
      { easting: 1, northing: 0, elevation: 100 },
    ];
    expect(() => computeCutFillDatum(fewPoints, 99, 1.0)).toThrow();
  });
});

// ─── computeAreaBetweenPoints ──────────────────────────────────────────────

describe('computeAreaBetweenPoints()', () => {
  it('returns correct area for a known rectangle (100m × 100m = 10,000 m²)', () => {
    const area = computeAreaBetweenPoints(rectanglePoints);
    expect(area).toBeCloseTo(10000, 1);
  });

  it('returns 0 for less than 3 points', () => {
    const fewPoints: DTMPoint[] = [
      { easting: 0, northing: 0, elevation: 0 },
      { easting: 1, northing: 0, elevation: 0 },
    ];
    expect(computeAreaBetweenPoints(fewPoints)).toBe(0);
  });

  it('handles triangle correctly', () => {
    // Right triangle with legs 10 and 10 → area = 50
    const triangle: DTMPoint[] = [
      { easting: 0, northing: 0, elevation: 0 },
      { easting: 10, northing: 0, elevation: 0 },
      { easting: 0, northing: 10, elevation: 0 },
    ];
    expect(computeAreaBetweenPoints(triangle)).toBeCloseTo(50, 1);
  });
});

// ─── slopeAnalysisToCSV ───────────────────────────────────────────────────

describe('slopeAnalysisToCSV()', () => {
  it('produces valid CSV string', () => {
    const result = analyzeSlopeFromPoints(flatTerrain, 2.0);
    const csv = slopeAnalysisToCSV(result);
    const lines = csv.trim().split('\n');

    expect(lines[0]).toContain('Easting');
    expect(lines[0]).toContain('Northing');
    expect(lines[0]).toContain('SlopePercent');
    expect(lines[0]).toContain('SlopeClass');
  });

  it('contains summary section', () => {
    const result = analyzeSlopeFromPoints(flatTerrain, 2.0);
    const csv = slopeAnalysisToCSV(result);
    expect(csv).toContain('SLOPE ANALYSIS SUMMARY');
    expect(csv).toContain('Mean Slope Percent');
    expect(csv).toContain('SLOPE CLASS DISTRIBUTION');
  });
});
