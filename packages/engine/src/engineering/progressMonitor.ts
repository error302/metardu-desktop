// METARDU Construction Progress Monitoring Module
// Track construction progress against programme with photo attachments and sign-off workflow

// ─── TYPES ─────────────────────────────────────────────────────────────────────

export interface InspectionCheckpoint {
  id?: string;
  projectId: string;
  chainage?: number;
  gridRef?: string;
  description: string;
  category: 'earthworks' | 'drainage' | 'pavement' | 'structure' | 'utilities' | 'finishing' | 'other';
  plannedDate: string;
  plannedPercentage: number;
  status: 'pending' | 'in_progress' | 'completed' | 'delayed' | 'inspected' | 'approved' | 'rejected';
  actualDate?: string;
  actualPercentage?: number;
  photos?: string[];
  notes?: string;
  inspectedBy?: string;
  approvedBy?: string;
  deviations?: string[];
  timestamp?: string;
}

export interface ProgressSummary {
  totalCheckpoints: number;
  completedCheckpoints: number;
  delayedCheckpoints: number;
  inProgressCheckpoints: number;
  pendingCheckpoints: number;
  overallProgress: number;
  plannedProgress: number;
  variance: number;
  estimatedCompletion: string;
  milestones: {
    name: string;
    planned: string;
    actual?: string;
    status: InspectionCheckpoint['status'];
  }[];
  photoCount: number;
  criticalItems: InspectionCheckpoint[];
}

export interface ProgressChart {
  dates: string[];
  plannedProgress: number[];
  actualProgress: number[];
}

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<InspectionCheckpoint['category'], string> = {
  earthworks: 'Earthworks',
  drainage: 'Drainage',
  pavement: 'Pavement',
  structure: 'Structure',
  utilities: 'Utilities',
  finishing: 'Finishing',
  other: 'Other',
};

export const CATEGORY_COLORS: Record<InspectionCheckpoint['category'], string> = {
  earthworks: '#a3763d',
  drainage: '#3b82f6',
  pavement: '#6b7280',
  structure: '#ef4444',
  utilities: '#8b5cf6',
  finishing: '#22c55e',
  other: '#a1a1aa',
};

export const STATUS_CONFIG: Record<InspectionCheckpoint['status'], { label: string; color: string; bg: string }> = {
  pending:     { label: 'Pending',     color: '#a1a1aa', bg: 'rgba(161,161,170,0.15)' },
  in_progress: { label: 'In Progress', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  completed:   { label: 'Completed',   color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  delayed:     { label: 'Delayed',     color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  inspected:   { label: 'Inspected',   color: '#06b6d4', bg: 'rgba(6,182,212,0.15)' },
  approved:    { label: 'Approved',    color: '#22c55e', bg: 'rgba(34,197,94,0.20)' },
  rejected:    { label: 'Rejected',    color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
};

// ─── PROGRESS SUMMARY ──────────────────────────────────────────────────────────

export function calculateProgressSummary(checkpoints: InspectionCheckpoint[]): ProgressSummary {
  if (checkpoints.length === 0) {
    return {
      totalCheckpoints: 0,
      completedCheckpoints: 0,
      delayedCheckpoints: 0,
      inProgressCheckpoints: 0,
      pendingCheckpoints: 0,
      overallProgress: 0,
      plannedProgress: 0,
      variance: 0,
      estimatedCompletion: new Date().toISOString().split('T')[0],
      milestones: [],
      photoCount: 0,
      criticalItems: [],
    };
  }

  // 1. Count checkpoints by status
  const pendingCheckpoints = checkpoints.filter(c => c.status === 'pending').length;
  const inProgressCheckpoints = checkpoints.filter(c => c.status === 'in_progress').length;
  const completedCheckpoints = checkpoints.filter(c =>
    c.status === 'completed' || c.status === 'inspected' || c.status === 'approved'
  ).length;
  const delayedCheckpoints = checkpoints.filter(c => c.status === 'delayed' || c.status === 'rejected').length;

  // 2. Overall progress = weighted average of actualPercentage across all checkpoints
  const withActual = checkpoints.filter(c => c.actualPercentage !== undefined && c.actualPercentage !== null);
  const overallProgress = withActual.length > 0
    ? withActual.reduce((sum, c) => sum + (c.actualPercentage ?? 0), 0) / checkpoints.length
    : 0;

  // 3. Planned progress = average of plannedPercentage for checkpoints whose plannedDate <= today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueNow = checkpoints.filter(c => new Date(c.plannedDate) <= today);
  const plannedProgress = checkpoints.length > 0
    ? dueNow.reduce((sum, c) => sum + c.plannedPercentage, 0) / checkpoints.length
    : 0;

  // 4. Variance = overall - planned
  const variance = overallProgress - plannedProgress;

  // 5. Estimated completion: linear extrapolation from current rate to reach 100%
  let estimatedCompletion: string;
  if (overallProgress <= 0 || withActual.length < 2) {
    // No progress yet — use latest planned end date
    const latestDate = checkpoints.reduce((max, c) => {
      const d = new Date(c.plannedDate);
      return d > max ? d : max;
    }, new Date(0));
    estimatedCompletion = latestDate.toISOString().split('T')[0];
  } else {
    // Find earliest and latest actual dates to compute rate
    const dated = checkpoints
      .filter(c => c.actualDate)
      .map(c => ({ date: new Date(c.actualDate!), pct: c.actualPercentage ?? 0 }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (dated.length >= 2) {
      const first = dated[0];
      const last = dated[dated.length - 1];
      const daySpan = (last.date.getTime() - first.date.getTime()) / (1000 * 60 * 60 * 24);
      const pctSpan = last.pct - first.pct;
      if (daySpan > 0 && pctSpan > 0) {
        const ratePerDay = pctSpan / daySpan;
        const remainingPct = 100 - overallProgress;
        const daysRemaining = remainingPct / ratePerDay;
        const est = new Date();
        est.setDate(est.getDate() + Math.ceil(daysRemaining));
        estimatedCompletion = est.toISOString().split('T')[0];
      } else {
        const latestPlanned = checkpoints.reduce((max, c) => {
          const d = new Date(c.plannedDate);
          return d > max ? d : max;
        }, new Date(0));
        estimatedCompletion = latestPlanned.toISOString().split('T')[0];
      }
    } else {
      const latestPlanned = checkpoints.reduce((max, c) => {
        const d = new Date(c.plannedDate);
        return d > max ? d : max;
      }, new Date(0));
      estimatedCompletion = latestPlanned.toISOString().split('T')[0];
    }
  }

  // 6. Critical items = delayed + rejected checkpoints
  const criticalItems = checkpoints.filter(c => c.status === 'delayed' || c.status === 'rejected');

  // Milestones: checkpoints with plannedPercentage >= 100 or that are approved
  const milestones = checkpoints
    .filter(c => c.plannedPercentage >= 100 || c.status === 'approved')
    .map(c => ({
      name: c.description.length > 40 ? c.description.substring(0, 40) + '…' : c.description,
      planned: c.plannedDate,
      actual: c.actualDate,
      status: c.status,
    }));

  // Photo count
  const photoCount = checkpoints.reduce((sum, c) => sum + (c.photos?.length ?? 0), 0);

  return {
    totalCheckpoints: checkpoints.length,
    completedCheckpoints,
    delayedCheckpoints,
    inProgressCheckpoints,
    pendingCheckpoints,
    overallProgress: Math.round(overallProgress * 10) / 10,
    plannedProgress: Math.round(plannedProgress * 10) / 10,
    variance: Math.round(variance * 10) / 10,
    estimatedCompletion,
    milestones,
    photoCount,
    criticalItems,
  };
}

// ─── PROGRESS CHART (S-CURVE) ──────────────────────────────────────────────────

export function generateProgressChart(checkpoints: InspectionCheckpoint[]): ProgressChart {
  if (checkpoints.length === 0) {
    return { dates: [], plannedProgress: [], actualProgress: [] };
  }

  // 1. Find min and max planned dates
  const allDates = checkpoints.map(c => c.plannedDate).filter(Boolean);
  const actualDates = checkpoints.map(c => c.actualDate).filter(Boolean) as string[];
  const combined = [...allDates, ...actualDates].map(d => new Date(d).getTime());
  if (combined.length === 0) {
    return { dates: [], plannedProgress: [], actualProgress: [] };
  }

  const minDate = new Date(Math.min(...combined));
  const maxDate = new Date(Math.max(...combined));

  // Extend range slightly
  minDate.setDate(minDate.getDate() - 7);
  maxDate.setDate(maxDate.getDate() + 14);

  // 2. Generate monthly date range
  const dates: string[] = [];
  const current = new Date(minDate);
  while (current <= maxDate) {
    dates.push(current.toISOString().split('T')[0]);
    // Advance by approximately 1 month
    current.setMonth(current.getMonth() + 1);
  }
  // Ensure the maxDate is included
  const lastDateStr = dates[dates.length - 1];
  if (lastDateStr && new Date(lastDateStr) < maxDate) {
    dates.push(maxDate.toISOString().split('T')[0]);
  }

  const total = checkpoints.length;

  // 3. For each date, compute planned and actual progress
  const plannedProgress: number[] = [];
  const actualProgress: number[] = [];

  for (const dateStr of dates) {
    const cutoff = new Date(dateStr);

    // Planned: sum of planned % for checkpoints whose plannedDate <= date / total
    const plannedSum = checkpoints
      .filter(c => new Date(c.plannedDate) <= cutoff)
      .reduce((sum, c) => sum + c.plannedPercentage, 0);
    plannedProgress.push(total > 0 ? Math.round((plannedSum / total) * 10) / 10 : 0);

    // Actual: sum of actual % for checkpoints whose actualDate <= date / total
    const actualSum = checkpoints
      .filter(c => c.actualDate && new Date(c.actualDate) <= cutoff)
      .reduce((sum, c) => sum + (c.actualPercentage ?? 0), 0);
    actualProgress.push(total > 0 ? Math.round((actualSum / total) * 10) / 10 : 0);
  }

  return { dates, plannedProgress, actualProgress };
}

// ─── CSV PARSING ───────────────────────────────────────────────────────────────

export function parseProgressCSV(csv: string): Partial<InspectionCheckpoint>[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const results: Partial<InspectionCheckpoint>[] = [];

  // Parse header — normalize to lowercase, strip spaces
  const headerRaw = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[\s_-]/g, ''));
  const dateIdx = headerRaw.findIndex(h => h === 'date' || h === 'planneddate' || h === 'planned_date');
  const chainageIdx = headerRaw.findIndex(h => h === 'chainage' || h === 'ch');
  const gridIdx = headerRaw.findIndex(h => h === 'gridref' || h === 'gridreference' || h === 'grid_ref' || h === 'grid');
  const descIdx = headerRaw.findIndex(h => h === 'description' || h === 'desc');
  const catIdx = headerRaw.findIndex(h => h === 'category' || h === 'cat' || h === 'type');
  const statusIdx = headerRaw.findIndex(h => h === 'status');
  const pctIdx = headerRaw.findIndex(h => h === 'percentage' || h === 'pct' || h === 'plannedpercentage' || h === 'planned_pct');
  const notesIdx = headerRaw.findIndex(h => h === 'notes' || h === 'note');

  const validCategories = new Set<string>(['earthworks', 'drainage', 'pavement', 'structure', 'utilities', 'finishing', 'other']);
  const validStatuses = new Set<string>(['pending', 'in_progress', 'completed', 'delayed', 'inspected', 'approved', 'rejected']);

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    if (cols.length < 2) continue;

    const entry: Partial<InspectionCheckpoint> = {};

    if (dateIdx >= 0 && cols[dateIdx]) {
      const parsed = new Date(cols[dateIdx]);
      if (!isNaN(parsed.getTime())) {
        entry.plannedDate = parsed.toISOString().split('T')[0];
      }
    }

    if (chainageIdx >= 0 && cols[chainageIdx]) {
      const val = parseFloat(cols[chainageIdx]);
      if (!isNaN(val)) entry.chainage = val;
    }

    if (gridIdx >= 0 && cols[gridIdx]) {
      entry.gridRef = cols[gridIdx];
    }

    if (descIdx >= 0 && cols[descIdx]) {
      entry.description = cols[descIdx];
    }

    if (catIdx >= 0 && cols[catIdx]) {
      const cat = cols[catIdx].toLowerCase();
      if (validCategories.has(cat)) {
        entry.category = cat as InspectionCheckpoint['category'];
      } else {
        entry.category = 'other';
      }
    }

    if (statusIdx >= 0 && cols[statusIdx]) {
      const st = cols[statusIdx].toLowerCase().replace(/\s+/g, '_');
      if (validStatuses.has(st)) {
        entry.status = st as InspectionCheckpoint['status'];
      }
    }

    if (pctIdx >= 0 && cols[pctIdx]) {
      const val = parseFloat(cols[pctIdx]);
      if (!isNaN(val)) entry.plannedPercentage = Math.max(0, Math.min(100, val));
    }

    if (notesIdx >= 0 && cols[notesIdx]) {
      entry.notes = cols[notesIdx];
    }

    if (entry.plannedDate || entry.description) {
      results.push(entry);
    }
  }

  return results;
}

// ─── CSV EXPORT ────────────────────────────────────────────────────────────────

export function progressToCSV(checkpoints: InspectionCheckpoint[]): string {
  const header = [
    'Date',
    'Chainage',
    'GridRef',
    'Description',
    'Category',
    'Status',
    'PlannedPct',
    'ActualPct',
    'ActualDate',
    'Notes',
    'Deviations',
    'Photos',
  ].join(',');

  const rows = checkpoints.map(c => {
    const esc = (val?: string) => {
      if (!val) return '';
      const v = val.replace(/"/g, '""');
      return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v}"` : v;
    };
    return [
      c.plannedDate,
      c.chainage ?? '',
      c.gridRef ?? '',
      esc(c.description),
      c.category,
      c.status,
      c.plannedPercentage,
      c.actualPercentage ?? '',
      c.actualDate ?? '',
      esc(c.notes),
      c.deviations?.length ? `"${c.deviations.join('; ')}"` : '',
      c.photos?.length ? `"${c.photos.join('; ')}"` : '',
    ].join(',');
  });

  return [header, ...rows].join('\n');
}

// ─── INSPECTION REPORT GENERATION ──────────────────────────────────────────────

export function generateInspectionReport(
  checkpoints: InspectionCheckpoint[],
  summary: ProgressSummary,
  projectInfo: { name: string; client: string; contractor: string; surveyor: string }
): string {
  const now = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const statusBadge = (status: InspectionCheckpoint['status']) => {
    const cfg = STATUS_CONFIG[status];
    return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:${cfg.color}">${cfg.label}</span>`;
  };

  const categoryLabel = (cat: InspectionCheckpoint['category']) => CATEGORY_LABELS[cat];

  const checkpointRows = checkpoints.map((c, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#fff'}">
      <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #e5e7eb">${c.chainage ?? '—'}</td>
      <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #e5e7eb">${c.gridRef ?? '—'}</td>
      <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #e5e7eb;max-width:200px">${c.description}</td>
      <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #e5e7eb">${categoryLabel(c.category)}</td>
      <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #e5e7eb">${c.plannedDate}</td>
      <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #e5e7eb;text-align:center">${c.plannedPercentage}%</td>
      <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #e5e7eb;text-align:center">${statusBadge(c.status)}</td>
      <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #e5e7eb;text-align:center">${c.actualDate ?? '—'}</td>
      <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #e5e7eb;text-align:center">${c.actualPercentage != null ? c.actualPercentage + '%' : '—'}</td>
    </tr>`).join('');

  const criticalRows = summary.criticalItems.map((c, i) => `
    <tr style="background:${i % 2 === 0 ? '#fef2f2' : '#fff'}">
      <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #fecaca">${c.chainage ?? '—'}</td>
      <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #fecaca">${c.description}</td>
      <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #fecaca;text-align:center">${statusBadge(c.status)}</td>
      <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #fecaca">${c.deviations?.join(', ') || '—'}</td>
      <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #fecaca">${c.notes || '—'}</td>
    </tr>`).join('');

  const varianceColor = summary.variance >= 0 ? '#16a34a' : '#dc2626';
  const varianceLabel = summary.variance >= 0 ? 'Ahead' : 'Behind';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Construction Progress Report — ${projectInfo.name}</title>
  <style>
    @page { size: A4 landscape; margin: 15mm; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 24px; color: #1f2937; }
    h1 { font-size: 22px; margin: 0 0 4px 0; }
    h2 { font-size: 16px; margin: 20px 0 10px 0; color: #374151; border-bottom: 2px solid #3b82f6; padding-bottom: 4px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1f2937; padding-bottom: 12px; margin-bottom: 20px; }
    .meta { font-size: 12px; color: #6b7280; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { background: #1f2937; color: #fff; padding: 8px; font-size: 11px; text-align: left; text-transform: uppercase; letter-spacing: 0.5px; }
    .summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 20px; }
    .summary-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; text-align: center; }
    .summary-card .value { font-size: 24px; font-weight: 700; }
    .summary-card .label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
    .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Construction Progress Report</h1>
      <div style="font-size:14px;color:#3b82f6;font-weight:600;margin-bottom:6px">${projectInfo.name}</div>
      <div class="meta">Generated: ${now}</div>
    </div>
    <div style="text-align:right;font-size:12px;color:#6b7280;line-height:1.8">
      <div><strong>Client:</strong> ${projectInfo.client}</div>
      <div><strong>Contractor:</strong> ${projectInfo.contractor}</div>
      <div><strong>Resident Surveyor:</strong> ${projectInfo.surveyor}</div>
    </div>
  </div>

  <h2>Executive Summary</h2>
  <div class="summary-grid">
    <div class="summary-card">
      <div class="value" style="color:#3b82f6">${summary.overallProgress}%</div>
      <div class="label">Overall Progress</div>
    </div>
    <div class="summary-card">
      <div class="value">${summary.plannedProgress}%</div>
      <div class="label">Planned Progress</div>
    </div>
    <div class="summary-card">
      <div class="value" style="color:${varianceColor}">${summary.variance > 0 ? '+' : ''}${summary.variance}%</div>
      <div class="label">${varianceLabel} of Schedule</div>
    </div>
    <div class="summary-card">
      <div class="value" style="color:${summary.criticalItems.length > 0 ? '#f59e0b' : '#22c55e'}">${summary.criticalItems.length}</div>
      <div class="label">Critical Items</div>
    </div>
    <div class="summary-card">
      <div class="value">${summary.estimatedCompletion}</div>
      <div class="label">Est. Completion</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;font-size:12px;color:#4b5563">
    <div>Total Checkpoints: <strong>${summary.totalCheckpoints}</strong></div>
    <div>Completed: <strong style="color:#16a34a">${summary.completedCheckpoints}</strong></div>
    <div>In Progress: <strong style="color:#3b82f6">${summary.inProgressCheckpoints}</strong></div>
    <div>Delayed / Rejected: <strong style="color:#ef4444">${summary.delayedCheckpoints}</strong></div>
    <div>Pending: <strong>${summary.pendingCheckpoints}</strong></div>
    <div>Photos Attached: <strong>${summary.photoCount}</strong></div>
  </div>

  <h2>S-Curve Progress Chart</h2>
  <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:20px;text-align:center;color:#9ca3af;font-size:13px">
    <!-- Chart placeholder: generate SVG from generateProgressChart() for visual rendering -->
    [ S-Curve Chart — Planned vs Actual Progress over Time ]
  </div>

  <h2>Checkpoint Register</h2>
  <div style="overflow-x:auto">
    <table>
      <thead>
        <tr>
          <th>Ch.</th>
          <th>Grid</th>
          <th>Description</th>
          <th>Category</th>
          <th>Planned</th>
          <th>Pct</th>
          <th>Status</th>
          <th>Actual</th>
          <th>Act %</th>
        </tr>
      </thead>
      <tbody>
        ${checkpointRows}
      </tbody>
    </table>
  </div>

  ${summary.criticalItems.length > 0 ? `
  <h2 style="color:#dc2626;border-bottom-color:#dc2626">Critical Items (Delayed / Rejected)</h2>
  <table>
    <thead>
      <tr>
        <th>Ch.</th>
        <th>Description</th>
        <th>Status</th>
        <th>Deviations</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${criticalRows}
    </tbody>
  </table>
  ` : ''}

  <div class="footer">
    METARDU Construction Progress Monitoring Report &middot; ${projectInfo.name} &middot; ${now}
  </div>
</body>
</html>`;
}

// ─── DEMO DATA ─────────────────────────────────────────────────────────────────

export function generateDemoCheckpoints(projectId: string): InspectionCheckpoint[] {
  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() - 90);

  const makeDate = (daysOffset: number): string => {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + daysOffset);
    return d.toISOString().split('T')[0];
  };

  return [
    {
      id: 'cp-001',
      projectId,
      chainage: 0,
      gridRef: 'A1',
      description: 'Site clearance and topsoil stripping',
      category: 'earthworks',
      plannedDate: makeDate(0),
      plannedPercentage: 10,
      status: 'approved',
      actualDate: makeDate(1),
      actualPercentage: 10,
      photos: ['photo_site_clearance_001.jpg'],
      notes: 'Completed as per programme. Topsoil stockpiled at designated area.',
      inspectedBy: 'J. Mwangi',
      approvedBy: 'Eng. K. Ochieng',
      deviations: [],
      timestamp: makeDate(1),
    },
    {
      id: 'cp-002',
      projectId,
      chainage: 0,
      gridRef: 'A1',
      description: 'Bulk earthworks — cut to formation',
      category: 'earthworks',
      plannedDate: makeDate(14),
      plannedPercentage: 25,
      status: 'approved',
      actualDate: makeDate(18),
      actualPercentage: 25,
      photos: ['photo_bulk_cut_001.jpg', 'photo_bulk_cut_002.jpg'],
      notes: 'Delayed by 4 days due to heavy rains. Cut levels verified.',
      inspectedBy: 'J. Mwangi',
      approvedBy: 'Eng. K. Ochieng',
      deviations: [],
      timestamp: makeDate(18),
    },
    {
      id: 'cp-003',
      projectId,
      chainage: 200,
      gridRef: 'B3',
      description: 'Sub-grade preparation and compaction',
      category: 'earthworks',
      plannedDate: makeDate(28),
      plannedPercentage: 35,
      status: 'completed',
      actualDate: makeDate(32),
      actualPercentage: 35,
      photos: ['photo_subgrade_001.jpg'],
      notes: 'Compaction tests passed at 95% MDD.',
      inspectedBy: 'J. Mwangi',
      deviations: [],
      timestamp: makeDate(32),
    },
    {
      id: 'cp-004',
      projectId,
      chainage: 200,
      gridRef: 'B3',
      description: 'Pipe culvert installation at Ch 0+200',
      category: 'drainage',
      plannedDate: makeDate(35),
      plannedPercentage: 42,
      status: 'delayed',
      actualPercentage: 30,
      photos: [],
      notes: 'Waiting for pipe delivery. Supplier delayed by 10 days.',
      deviations: ['Material delivery delay', 'Revised programme needed'],
      timestamp: makeDate(45),
    },
    {
      id: 'cp-005',
      projectId,
      chainage: 400,
      gridRef: 'C5',
      description: 'Granular sub-base (GSB) laying',
      category: 'pavement',
      plannedDate: makeDate(42),
      plannedPercentage: 50,
      status: 'in_progress',
      actualDate: makeDate(44),
      actualPercentage: 48,
      photos: ['photo_gsb_001.jpg'],
      notes: 'GSB placement ongoing. 60% complete at Ch 0+300 to Ch 0+500.',
      inspectedBy: 'J. Mwangi',
      deviations: [],
      timestamp: makeDate(47),
    },
    {
      id: 'cp-006',
      projectId,
      chainage: 400,
      gridRef: 'C5',
      description: 'Crushed stone base (CSB) laying',
      category: 'pavement',
      plannedDate: makeDate(56),
      plannedPercentage: 62,
      status: 'pending',
      photos: [],
      notes: '',
      timestamp: makeDate(47),
    },
    {
      id: 'cp-007',
      projectId,
      chainage: 0,
      gridRef: 'A1',
      description: 'Concrete column casting — Pier 1',
      category: 'structure',
      plannedDate: makeDate(50),
      plannedPercentage: 55,
      status: 'inspected',
      actualDate: makeDate(52),
      actualPercentage: 55,
      photos: ['photo_pier1_001.jpg', 'photo_pier1_002.jpg', 'photo_pier1_003.jpg'],
      notes: 'Concrete cast and cured. Awaiting cube test results (7-day).',
      inspectedBy: 'J. Mwangi',
      deviations: [],
      timestamp: makeDate(53),
    },
    {
      id: 'cp-008',
      projectId,
      chainage: 600,
      gridRef: 'D7',
      description: 'Side drain excavation and lining',
      category: 'drainage',
      plannedDate: makeDate(49),
      plannedPercentage: 58,
      status: 'rejected',
      actualDate: makeDate(51),
      actualPercentage: 55,
      photos: ['photo_drain_001.jpg'],
      notes: 'Drain gradient does not meet design specification. 0.3% vs required 0.5%.',
      inspectedBy: 'J. Mwangi',
      deviations: ['Insufficient drain gradient (0.3% vs 0.5% required)', 'Re-excavation required at Ch 0+580 to Ch 0+620'],
      timestamp: makeDate(52),
    },
    {
      id: 'cp-009',
      projectId,
      chainage: 800,
      gridRef: 'E9',
      description: 'Water main installation',
      category: 'utilities',
      plannedDate: makeDate(63),
      plannedPercentage: 70,
      status: 'pending',
      photos: [],
      notes: '',
      timestamp: makeDate(47),
    },
    {
      id: 'cp-010',
      projectId,
      chainage: 0,
      gridRef: 'A1',
      description: 'Asphalt surfacing (prime coat)',
      category: 'pavement',
      plannedDate: makeDate(70),
      plannedPercentage: 80,
      status: 'pending',
      photos: [],
      notes: '',
      timestamp: makeDate(47),
    },
    {
      id: 'cp-011',
      projectId,
      chainage: 0,
      gridRef: 'A1',
      description: 'Road markings and signage',
      category: 'finishing',
      plannedDate: makeDate(84),
      plannedPercentage: 95,
      status: 'pending',
      photos: [],
      notes: '',
      timestamp: makeDate(47),
    },
    {
      id: 'cp-012',
      projectId,
      chainage: 0,
      gridRef: 'A1',
      description: 'Final inspection and handover',
      category: 'finishing',
      plannedDate: makeDate(90),
      plannedPercentage: 100,
      status: 'pending',
      photos: [],
      notes: '',
      timestamp: makeDate(47),
    },
  ];
}
