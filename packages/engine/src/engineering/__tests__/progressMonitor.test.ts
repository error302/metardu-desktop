import {
  type InspectionCheckpoint,
  calculateProgressSummary,
  generateProgressChart,
  parseProgressCSV,
  progressToCSV,
  generateInspectionReport,
  generateDemoCheckpoints,
} from '@/lib/engineering/progressMonitor';

// ─── Test data ─────────────────────────────────────────────────────────────

function makeCheckpoint(overrides: Partial<InspectionCheckpoint> = {}): InspectionCheckpoint {
  const today = new Date().toISOString().split('T')[0];
  const pastDate = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  return {
    id: 'cp-1',
    projectId: 'proj-1',
    description: 'Test checkpoint',
    category: 'earthworks',
    plannedDate: pastDate,
    plannedPercentage: 10,
    status: 'completed',
    actualDate: pastDate,
    actualPercentage: 10,
    ...overrides,
  };
}

const today = new Date();
today.setHours(0, 0, 0, 0);
const todayStr = today.toISOString().split('T')[0];
const pastStr = new Date(today.getTime() - 30 * 86400000).toISOString().split('T')[0];
const futureStr = new Date(today.getTime() + 30 * 86400000).toISOString().split('T')[0];

// ─── calculateProgressSummary ─────────────────────────────────────────────

describe('calculateProgressSummary()', () => {
  it('counts checkpoints correctly', () => {
    const checkpoints = [
      makeCheckpoint({ status: 'completed', plannedDate: pastStr }),
      makeCheckpoint({ status: 'pending', plannedDate: futureStr, actualPercentage: undefined }),
      makeCheckpoint({ status: 'in_progress', plannedDate: pastStr, actualPercentage: 5 }),
      makeCheckpoint({ status: 'delayed', plannedDate: pastStr }),
    ];
    const summary = calculateProgressSummary(checkpoints);
    expect(summary.totalCheckpoints).toBe(4);
    expect(summary.completedCheckpoints).toBe(1); // completed only
    expect(summary.inProgressCheckpoints).toBe(1);
    expect(summary.pendingCheckpoints).toBe(1);
    expect(summary.delayedCheckpoints).toBe(1); // delayed + rejected
  });

  it('overall progress = weighted average of actual percentages', () => {
    const checkpoints = [
      makeCheckpoint({ actualPercentage: 50 }),
      makeCheckpoint({ actualPercentage: 50 }),
      makeCheckpoint({ actualPercentage: 50 }),
    ];
    const summary = calculateProgressSummary(checkpoints);
    // (50 + 50 + 50) / 3 = 50
    expect(summary.overallProgress).toBe(50);
  });

  it('planned progress only considers checkpoints whose planned date <= today', () => {
    const checkpoints = [
      makeCheckpoint({ plannedPercentage: 50, plannedDate: pastStr }),
      makeCheckpoint({ plannedPercentage: 50, plannedDate: futureStr }),
    ];
    const summary = calculateProgressSummary(checkpoints);
    // Only first checkpoint's planned % counts: 50 / 2 = 25
    expect(summary.plannedProgress).toBe(25);
  });

  it('variance = overall - planned', () => {
    const checkpoints = [
      makeCheckpoint({
        plannedDate: pastStr,
        plannedPercentage: 30,
        actualPercentage: 50,
      }),
    ];
    const summary = calculateProgressSummary(checkpoints);
    expect(summary.variance).toBeCloseTo(summary.overallProgress - summary.plannedProgress, 1);
  });

  it('delayed and rejected items appear in criticalItems', () => {
    const checkpoints = [
      makeCheckpoint({ status: 'delayed', description: 'Delayed item' }),
      makeCheckpoint({ status: 'rejected', description: 'Rejected item' }),
      makeCheckpoint({ status: 'completed', description: 'Completed item' }),
    ];
    const summary = calculateProgressSummary(checkpoints);
    expect(summary.criticalItems).toHaveLength(2);
    expect(summary.criticalItems[0].description).toBe('Delayed item');
    expect(summary.criticalItems[1].description).toBe('Rejected item');
  });

  it('empty checkpoints returns zeroed summary', () => {
    const summary = calculateProgressSummary([]);
    expect(summary.totalCheckpoints).toBe(0);
    expect(summary.overallProgress).toBe(0);
    expect(summary.plannedProgress).toBe(0);
    expect(summary.variance).toBe(0);
    expect(summary.criticalItems).toHaveLength(0);
  });

  it('completed includes inspected and approved', () => {
    const checkpoints = [
      makeCheckpoint({ status: 'inspected', actualPercentage: 100 }),
      makeCheckpoint({ status: 'approved', actualPercentage: 100 }),
      makeCheckpoint({ status: 'completed', actualPercentage: 100 }),
    ];
    const summary = calculateProgressSummary(checkpoints);
    expect(summary.completedCheckpoints).toBe(3);
  });
});

// ─── generateProgressChart ────────────────────────────────────────────────

describe('generateProgressChart()', () => {
  it('produces dates and percentage arrays', () => {
    const checkpoints = [
      makeCheckpoint({ plannedDate: pastStr, actualDate: pastStr, actualPercentage: 50, plannedPercentage: 50 }),
    ];
    const chart = generateProgressChart(checkpoints);
    expect(chart.dates.length).toBeGreaterThan(0);
    expect(chart.plannedProgress.length).toBe(chart.dates.length);
    expect(chart.actualProgress.length).toBe(chart.dates.length);
  });

  it('empty checkpoints returns empty arrays', () => {
    const chart = generateProgressChart([]);
    expect(chart.dates).toHaveLength(0);
    expect(chart.plannedProgress).toHaveLength(0);
    expect(chart.actualProgress).toHaveLength(0);
  });

  it('planned progress never decreases', () => {
    const checkpoints = [
      makeCheckpoint({ plannedPercentage: 20, plannedDate: pastStr }),
      makeCheckpoint({ plannedPercentage: 40, plannedDate: todayStr }),
      makeCheckpoint({ plannedPercentage: 60, plannedDate: futureStr }),
    ];
    const chart = generateProgressChart(checkpoints);
    for (let i = 1; i < chart.plannedProgress.length; i++) {
      expect(chart.plannedProgress[i]).toBeGreaterThanOrEqual(chart.plannedProgress[i - 1]);
    }
  });
});

// ─── parseProgressCSV ─────────────────────────────────────────────────────

describe('parseProgressCSV()', () => {
  it('parses CSV correctly', () => {
    const csv = `Date,Description,Category,Status,Percentage
2024-01-15,Site clearance,earthworks,completed,10
2024-02-01,Bulk earthworks,earthworks,pending,25`;
    const result = parseProgressCSV(csv);
    expect(result).toHaveLength(2);
    expect(result[0].plannedDate).toBe('2024-01-15');
    expect(result[0].description).toBe('Site clearance');
    expect(result[0].category).toBe('earthworks');
    expect(result[0].status).toBe('completed');
    expect(result[0].plannedPercentage).toBe(10);
  });

  it('returns empty array for insufficient data', () => {
    expect(parseProgressCSV('')).toHaveLength(0);
    expect(parseProgressCSV('Header only')).toHaveLength(0);
  });

  it('normalises status with spaces', () => {
    const csv = `Date,Description,Status
2024-01-01,Test,in progress`;
    const result = parseProgressCSV(csv);
    expect(result[0].status).toBe('in_progress');
  });
});

// ─── progressToCSV ────────────────────────────────────────────────────────

describe('progressToCSV()', () => {
  it('produces valid CSV', () => {
    const checkpoints = [
      makeCheckpoint({ plannedDate: '2024-01-01', plannedPercentage: 10, status: 'completed' }),
    ];
    const csv = progressToCSV(checkpoints);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('Date');
    expect(lines[0]).toContain('Description');
    expect(lines[0]).toContain('Status');
    expect(lines.length).toBe(2);
  });

  it('handles commas in descriptions by quoting', () => {
    const checkpoints = [
      makeCheckpoint({ description: 'Site clearance, topsoil' }),
    ];
    const csv = progressToCSV(checkpoints);
    expect(csv).toContain('"Site clearance, topsoil"');
  });
});

// ─── generateInspectionReport ─────────────────────────────────────────────

describe('generateInspectionReport()', () => {
  it('produces HTML string with key sections', () => {
    const checkpoints = [makeCheckpoint()];
    const summary = calculateProgressSummary(checkpoints);
    const html = generateInspectionReport(checkpoints, summary, {
      name: 'Test Project',
      client: 'Test Client',
      contractor: 'Test Contractor',
      surveyor: 'Test Surveyor',
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Construction Progress Report');
    expect(html).toContain('Test Project');
    expect(html).toContain('Executive Summary');
    expect(html).toContain('Checkpoint Register');
    expect(html).toContain('Test Client');
    expect(html).toContain('Test Surveyor');
  });

  it('contains overall progress percentage', () => {
    const checkpoints = [makeCheckpoint({ actualPercentage: 50 })];
    const summary = calculateProgressSummary(checkpoints);
    const html = generateInspectionReport(checkpoints, summary, {
      name: 'Test', client: 'C', contractor: 'C', surveyor: 'S',
    });
    expect(html).toContain('50%');
  });
});

// ─── generateDemoCheckpoints ──────────────────────────────────────────────

describe('generateDemoCheckpoints()', () => {
  it('produces 12 checkpoints', () => {
    const checkpoints = generateDemoCheckpoints('proj-1');
    expect(checkpoints).toHaveLength(12);
  });

  it('each checkpoint has required fields', () => {
    const checkpoints = generateDemoCheckpoints('proj-1');
    for (const cp of checkpoints) {
      expect(cp.projectId).toBe('proj-1');
      expect(cp.description).toBeTruthy();
      expect(cp.category).toBeTruthy();
      expect(cp.plannedDate).toBeTruthy();
      expect(typeof cp.plannedPercentage).toBe('number');
      expect(cp.status).toBeTruthy();
    }
  });

  it('has variety of categories', () => {
    const checkpoints = generateDemoCheckpoints('proj-1');
    const categories = new Set(checkpoints.map(c => c.category));
    expect(categories.size).toBeGreaterThan(1);
  });
});
