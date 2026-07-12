/**
 * Workflow Dashboards — Specialized workflows for each surveyor type
 *
 * Six production-grade workflows, each tuned to the specific needs of:
 *
 *   1. CADASTRAL SURVEYOR — perfect, error-free, no propagation
 *      Step-by-step pipeline: import → traverse → blunder check →
 *      Bowditch/Transit/LSA → COGO recovery → parcel creation →
 *      area computation → QA gate → Form J → deed plan →
 *      mutation (if needed) → NLIMS export → survey report
 *
 *   2. LEVELLING (LARGE PROJECT) — for surveyors doing massive level runs
 *      Bench mark schedule → page-by-page rise/fall → page check →
 *      closure (10√K mm) → adjusted RLs → second-order correction →
 *      leveling book → cross-sections if needed
 *
 *   3. KeNHA ROAD ENGINEERING — survey engineer at KeNHA building a road
 *      Alignment design → horizontal + vertical curves → staking table →
 *      cross-sections → earthworks (cut/fill/net) → mass-haul →
 *      machine control export → as-built comparison
 *
 *   4. CONSTRUCTION SETTING OUT — construction surveyor doing setting out
 *      Design import → station setup → stakeout coordinates →
 *      real-time deviation → re-stake if out of tolerance →
 *      as-built record → conformance report
 *
 *   5. DAM CONSTRUCTION — survey engineer building a dam
 *      Foundation survey → grid staking → volume computation →
 *      stage-wise construction checking → spillway alignment →
 *      embankment cross-sections → as-built vs design comparison
 *
 *   6. COMBINED SURVEY — multi-discipline projects
 *      Pick modules from each workflow; reports combined.
 *
 * Each workflow enforces the principle: NO ERRORS PROPAGATE.
 * Every step validates inputs and outputs before proceeding.
 */

import { useState, useEffect, useCallback } from 'react';

export type WorkflowType =
  | 'cadastral'
  | 'leveling'
  | 'kenha-road'
  | 'construction-setting-out'
  | 'dam'
  | 'combined';

interface WorkflowStep {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'complete' | 'error' | 'skipped';
  validationRule?: string;
  outputArtifact?: string;
  ipcHandler?: string;
}

interface WorkflowDef {
  id: WorkflowType;
  title: string;
  subtitle: string;
  icon: string;
  principle: string;
  steps: WorkflowStep[];
}

const WORKFLOWS: WorkflowDef[] = [
  {
    id: 'cadastral',
    title: 'Cadastral Survey Workflow',
    subtitle: 'Perfect, error-free, no propagation',
    icon: '🗺️',
    principle: 'No errors can propagate — always accurate. Every step validates before the next begins.',
    steps: [
      { id: 'import', title: '1. Import Field Data', description: 'CSV/RINEX/total station import with format validation', status: 'pending', validationRule: 'CSV must have ≥3 points, each with E/N/elevation', outputArtifact: 'survey_points table' },
      { id: 'control', title: '2. Verify Control Network', description: 'Check starting coordinates against known bench marks', status: 'pending', validationRule: 'Starting station must match SoK control registry (±10mm)', outputArtifact: 'verified_control' },
      { id: 'traverse', title: '3. Compute Traverse', description: 'Bowditch / Transit / Least Squares adjustment', status: 'pending', validationRule: 'Linear misclosure < 1:5000 (Reg 97 cadastral)', outputArtifact: 'adjusted_coordinates', ipcHandler: 'traverse:compute' },
      { id: 'blunder', title: '4. Blunder Detection (Baarda)', description: 'χ² global test + data snooping w-test', status: 'pending', validationRule: 'No w-test statistic > 3.29 (α=0.001)', outputArtifact: 'blunder_report', ipcHandler: 'blunder:detect' },
      { id: 'cogo', title: '5. COGO Recovery', description: 'Recover missing/disturbed beacons via bearing/distance intersection', status: 'pending', validationRule: 'Recovered point within ±20mm of design', outputArtifact: 'recovered_points' },
      { id: 'parcel', title: '6. Create Parcel', description: 'Form parcel from adjusted traverse stations', status: 'pending', validationRule: 'Polygon must be simple (no self-intersection)', outputArtifact: 'parcel_record', ipcHandler: 'parcel:create' },
      { id: 'area', title: '7. Compute Area', description: 'Area by coordinates (Gauss/Green\'s theorem)', status: 'pending', validationRule: 'Area > 0; for mutation: parent = sum(children) + balance (±0.01 m²)', outputArtifact: 'area_computation' },
      { id: 'qa-gate', title: '8. QA Gate (Pre-submission)', description: '10-category validation: completeness, precision, blunder, topology, etc.', status: 'pending', validationRule: 'All 10 categories PASS or CONDITIONAL', outputArtifact: 'qa_report', ipcHandler: 'qa:gate' },
      { id: 'form-j', title: '9. Form J (Traverse Abstract)', description: 'Generate traverse computation sheet per Reg 17', status: 'pending', outputArtifact: 'form_j.pdf', ipcHandler: 'report:generate' },
      { id: 'deed-plan', title: '10. Deed Plan (Auto-Layout)', description: 'SoK-compliant deed plan with auto-rotation, auto-scale', status: 'pending', outputArtifact: 'deed_plan.pdf', ipcHandler: 'plan:autoGenerate' },
      { id: 'mutation', title: '11. Mutation Form (if applicable)', description: 'Form P for subdivision/amalgamation', status: 'skipped', outputArtifact: 'form_p.pdf', ipcHandler: 'form:generateFormP' },
      { id: 'nlims', title: '12. NLIMS/ArdhiSasa Export', description: 'JSON export with schema validation', status: 'pending', outputArtifact: 'nlims.json' },
      { id: 'survey-report', title: '13. Survey Report (Sealed)', description: 'Consolidated PDF with surveyor\'s RSA-2048 certificate', status: 'pending', outputArtifact: 'survey_report.pdf', ipcHandler: 'report:generate' },
    ],
  },
  {
    id: 'leveling',
    title: 'Leveling Workflow (Large Project)',
    subtitle: 'For massive level runs across long distances',
    icon: '📐',
    principle: 'Every page is checked before leaving the field. Closure must meet 10√K mm.',
    steps: [
      { id: 'bm-schedule', title: '1. Bench Mark Schedule', description: 'Establish TBMs at 1km intervals along the route', status: 'pending', validationRule: 'TBM spacing ≤ 1km; reference to 1st-order BM', outputArtifact: 'bm_schedule' },
      { id: 'equipment-check', title: '2. Equipment Calibration Check', description: 'Two-peg test for collimation error; staff calibration', status: 'pending', validationRule: 'Collimation error < 5" (0.025mm/m); staff tolerance ±0.5mm', outputArtifact: 'calibration_record' },
      { id: 'field-pages', title: '3. Field Leveling (Page by Page)', description: 'Rise and fall method, equal FS/BS distances', status: 'pending', validationRule: 'BS-FS distance difference < 5m per setup; cumulative < 10m', outputArtifact: 'leveling_pages' },
      { id: 'page-check', title: '4. Page Check (per page)', description: '∑BS - ∑FS = ∑rise - ∑fall = last RL - first RL', status: 'pending', validationRule: 'Page check must PASS (±0.001 m) before leaving the field', outputArtifact: 'page_check_results' },
      { id: 'closure', title: '5. Run Closure', description: 'Misclosure vs allowable (10√K mm)', status: 'pending', validationRule: '|misclosure| ≤ 10√K mm where K = distance in km', outputArtifact: 'closure_report' },
      { id: 'adjustment', title: '6. Adjust Reduced Levels', description: 'Proportional correction based on distance', status: 'pending', validationRule: 'Corrections distributed proportionally to setup distance', outputArtifact: 'adjusted_rls' },
      { id: 'second-order', title: '7. Second-Order Correction (if needed)', description: 'Apply refraction + earth curvature correction for long sights', status: 'pending', validationRule: 'Sights > 50m require curvature/refraction correction', outputArtifact: 'corrected_rls' },
      { id: 'leveling-book', title: '8. Leveling Book PDF', description: 'Statutory leveling book per RDM 1.1 Section 5', status: 'pending', outputArtifact: 'leveling_book.pdf', ipcHandler: 'form:generateLevelingBook' },
      { id: 'cross-sections', title: '9. Cross-Sections (if engineering)', description: 'Cross-section sheets at each chainage', status: 'skipped', outputArtifact: 'cross_sections.pdf', ipcHandler: 'form:generateCrossSections' },
      { id: 'archive', title: '10. Archive + Seal', description: 'Seal with RSA-2048; archive to project', status: 'pending', outputArtifact: 'sealed_archive' },
    ],
  },
  {
    id: 'kenha-road',
    title: 'KeNHA Road Engineering Workflow',
    subtitle: 'Survey engineer at KeNHA building a road',
    icon: '🛣️',
    principle: 'RDM 1.1 (2025) compliance. Machine control exports validated against design.',
    steps: [
      { id: 'design-import', title: '1. Import Road Design', description: 'LandXML alignment + profile + cross-section template', status: 'pending', validationRule: 'LandXML schema valid; alignment geometry closes', outputArtifact: 'road_design' },
      { id: 'control', title: '2. Establish Control', description: 'GNSS static control along alignment at 500m intervals', status: 'pending', validationRule: '1st-order control; ±5mm + 1ppm', outputArtifact: 'control_network' },
      { id: 'alignment-design', title: '3. Alignment Design', description: 'Horizontal curves (radius, transition) + vertical curves', status: 'pending', validationRule: 'Min radius per design speed; superelevation per RDM 1.1', outputArtifact: 'alignment', ipcHandler: 'traverse:compute' },
      { id: 'curves', title: '4. Curve Setting Out', description: 'Chainage + offset table for each curve element', status: 'pending', validationRule: 'Deflection angle < 10° for safety; transition length per RDM', outputArtifact: 'curve_table' },
      { id: 'staking', title: '5. Staking Table', description: 'Station-by-station stakeout coordinates', status: 'pending', validationRule: 'Stake spacing 10m on tangents, 5m on curves', outputArtifact: 'staking_table' },
      { id: 'cross-sections', title: '6. Cross-Section Survey', description: 'Existing ground at each chainage', status: 'pending', validationRule: 'Section spacing 20m (50m in flat terrain)', outputArtifact: 'cross_sections', ipcHandler: 'form:generateCrossSections' },
      { id: 'earthworks', title: '7. Earthworks Computation', description: 'Cut/fill volumes by end-area or prismoidal method', status: 'pending', validationRule: 'Prismoidal for error < 5%; end-area for rough', outputArtifact: 'earthworks' },
      { id: 'mass-haul', title: '8. Mass-Haul Diagram', description: 'Optimize haul distances; identify borrow/spoil', status: 'pending', validationRule: 'Freehaul vs overhaul economic analysis', outputArtifact: 'mass_haul' },
      { id: 'machine-control', title: '9. Machine Control Export', description: 'LandXML + DXF + Trimble/Leica/Topcon proprietary', status: 'pending', validationRule: '7 formats; verified against alignment', outputArtifact: 'machine_control' },
      { id: 'as-built', title: '10. As-Built Survey', description: 'Final survey of completed road; conformance check', status: 'pending', validationRule: 'Deviations < ±20mm horizontally, ±10mm vertically', outputArtifact: 'as-built_report' },
      { id: 'report', title: '11. Engineering Report (Sealed)', description: 'Cross-section sheets + earthworks + as-built, RSA-2048 sealed', status: 'pending', outputArtifact: 'engineering_report.pdf', ipcHandler: 'form:generateCrossSections' },
    ],
  },
  {
    id: 'construction-setting-out',
    title: 'Construction Setting-Out Workflow',
    subtitle: 'Construction surveyor doing setting out',
    icon: '🏗️',
    principle: 'Real-time deviation check. Re-stake if out of tolerance. No structure built without verification.',
    steps: [
      { id: 'design-import', title: '1. Import Design Coordinates', description: 'Architectural/structural design points (DXF/CSV)', status: 'pending', validationRule: 'Design points within site boundary', outputArtifact: 'design_points' },
      { id: 'control', title: '2. Establish Site Control', description: 'Minimum 3 control points; verified daily', status: 'pending', validationRule: 'Control precision 1:10000; check before each session', outputArtifact: 'site_control' },
      { id: 'station-setup', title: '3. Total Station Setup', description: 'Free station or known station; backsight check', status: 'pending', validationRule: 'Residuals < 5mm; standard error < 3"', outputArtifact: 'station_setup' },
      { id: 'stakeout', title: '4. Compute Stakeout Coordinates', description: 'Bearing + distance from station to each design point', status: 'pending', validationRule: 'All points reachable from station', outputArtifact: 'stakeout_table' },
      { id: 'field-stake', title: '5. Field Setting Out', description: 'Drive pegs/nails at design points; mark offset reference', status: 'pending', validationRule: 'Peg tolerance ±5mm horizontally, ±2mm vertically', outputArtifact: 'staked_points' },
      { id: 'deviation', title: '6. Real-Time Deviation Check', description: 'Measure staked point; compare to design', status: 'pending', validationRule: 'Deviation < ±10mm or as per spec; if exceeded, re-stake', outputArtifact: 'deviation_report' },
      { id: 're-stake', title: '7. Re-Stake if Out of Tolerance', description: 'Repeat stakeout for points exceeding tolerance', status: 'skipped', validationRule: 'Re-stake log records original + corrected position', outputArtifact: 'restake_log' },
      { id: 'as-built', title: '8. As-Built Record', description: 'Final positions of all set-out points', status: 'pending', validationRule: 'As-built vs design deviations documented', outputArtifact: 'as-built_record' },
      { id: 'conformance', title: '9. Conformance Report', description: 'Pass/fail per structural element', status: 'pending', validationRule: '100% of points within tolerance = PASS', outputArtifact: 'conformance_report.pdf' },
      { id: 'archive', title: '10. Archive + Seal', description: 'All records sealed with RSA-2048', status: 'pending', outputArtifact: 'sealed_archive' },
    ],
  },
  {
    id: 'dam',
    title: 'Dam Construction Workflow',
    subtitle: 'Survey engineer building a dam',
    icon: '💧',
    principle: 'Volumetric accuracy is paramount. Stage-wise construction checking.',
    steps: [
      { id: 'foundation', title: '1. Foundation Survey', description: 'Pre-construction foundation surface survey', status: 'pending', validationRule: 'Point density: 1 point per 5m²; breaklines along all features', outputArtifact: 'foundation_survey' },
      { id: 'control', title: '2. Dam Axis Control', description: 'Establish dam axis + abutment control points', status: 'pending', validationRule: '1st-order GNSS; verified against national control', outputArtifact: 'dam_control' },
      { id: 'grid-staking', title: '3. Grid Staking', description: 'Stake out construction grid (10m × 10m typical)', status: 'pending', validationRule: 'Grid spacing per design; ±5mm tolerance', outputArtifact: 'construction_grid' },
      { id: 'volume-base', title: '4. Base Volume Computation', description: 'Foundation to first lift volume (DTM differencing)', status: 'pending', validationRule: 'Prismoidal method; closure check ±0.5%', outputArtifact: 'base_volume' },
      { id: 'stage-check', title: '5. Stage-Wise Construction Checking', description: 'After each lift: survey surface, compute volume placed', status: 'pending', validationRule: 'Lift thickness per spec (typically 300mm); volume variance < 2%', outputArtifact: 'stage_reports' },
      { id: 'spillway', title: '6. Spillway Alignment', description: 'Stake out spillway centerline + cross-sections', status: 'pending', validationRule: 'Spillway grade per hydraulic design; ±10mm vertically', outputArtifact: 'spillway_layout' },
      { id: 'embankment-xs', title: '7. Embankment Cross-Sections', description: 'Cross-sections at 20m intervals along dam axis', status: 'pending', validationRule: 'Cross-section spacing per dam height', outputArtifact: 'embankment_xs', ipcHandler: 'form:generateCrossSections' },
      { id: 'as-built', title: '8. As-Built vs Design', description: 'Compare final surface to design surface', status: 'pending', validationRule: 'Volume difference < 1% of total', outputArtifact: 'as-built_comparison' },
      { id: 'rinex', title: '9. GNSS Observation Log', description: 'RINEX log for all static GNSS sessions', status: 'pending', outputArtifact: 'rinex_log.pdf', ipcHandler: 'form:generateRinexLog' },
      { id: 'archive', title: '10. Dam Survey Report (Sealed)', description: 'All deliverables consolidated, RSA-2048 sealed', status: 'pending', outputArtifact: 'dam_report.pdf' },
    ],
  },
  {
    id: 'combined',
    title: 'Combined Survey Workflow',
    subtitle: 'Multi-discipline projects (topo + cadastral + engineering)',
    icon: '🎯',
    principle: 'Each module follows its own workflow. Outputs merged into one report.',
    steps: [
      { id: 'topo-module', title: '1. Topographical Module', description: 'Topo survey (control, detail, contours, DEM)', status: 'pending', validationRule: 'Per SoK Practice Notes 2020', outputArtifact: 'topo_deliverables' },
      { id: 'cadastral-module', title: '2. Cadastral Module', description: 'Boundary survey + deed plan (if land division required)', status: 'pending', validationRule: 'Per Cap 299 + Survey Reg 1994', outputArtifact: 'cadastral_deliverables' },
      { id: 'engineering-module', title: '3. Engineering Module', description: 'Alignment + cross-sections + earthworks (if infrastructure)', status: 'pending', validationRule: 'Per RDM 1.1 (2025)', outputArtifact: 'engineering_deliverables' },
      { id: 'rinex-module', title: '4. GNSS Module', description: 'Static GNSS control + RINEX observation log', status: 'pending', validationRule: 'Per SoK GNSS Practice Notes', outputArtifact: 'gnss_deliverables' },
      { id: 'leveling-module', title: '5. Leveling Module', description: 'Precise leveling for vertical control', status: 'pending', validationRule: 'Closure 10√K mm (RDM 1.1 Sec 5)', outputArtifact: 'leveling_deliverables' },
      { id: 'merge', title: '6. Merge Deliverables', description: 'Consolidate all outputs into single project archive', status: 'pending', validationRule: 'Cross-module consistency check', outputArtifact: 'merged_archive' },
      { id: 'combined-report', title: '7. Combined Survey Report', description: 'Master report with all modules, sealed RSA-2048', status: 'pending', outputArtifact: 'combined_report.pdf', ipcHandler: 'report:generate' },
    ],
  },
];

export function WorkflowDashboard({ onStepClick }: {
  onStepClick?: (workflow: WorkflowType, stepId: string) => void;
}) {
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowType>('cadastral');
  const [stepStatuses, setStepStatuses] = useState<Record<string, 'pending' | 'in-progress' | 'complete' | 'error' | 'skipped'>>({});

  const workflow = WORKFLOWS.find(w => w.id === activeWorkflow)!;

  const updateStepStatus = useCallback((stepId: string, status: 'pending' | 'in-progress' | 'complete' | 'error' | 'skipped') => {
    setStepStatuses(prev => ({ ...prev, [`${activeWorkflow}:${stepId}`]: status }));
  }, [activeWorkflow]);

  // Load persisted statuses
  useEffect(() => {
    const saved = localStorage.getItem('metardu:workflow-statuses');
    if (saved) {
      try {
        setStepStatuses(JSON.parse(saved));
      } catch {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('metardu:workflow-statuses', JSON.stringify(stepStatuses));
  }, [stepStatuses]);

  const completedCount = workflow.steps.filter(s =>
    stepStatuses[`${activeWorkflow}:${s.id}`] === 'complete'
  ).length;
  const totalCount = workflow.steps.filter(s => s.status !== 'skipped').length;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="workflow-dashboard">
      <div className="dashboard-header">
        <h3>Workflow Dashboard</h3>
        <p className="dashboard-subtitle">Production-grade pipelines — no errors propagate</p>
      </div>

      <div className="workflow-tabs">
        {WORKFLOWS.map(w => (
          <button
            key={w.id}
            className={`workflow-tab ${activeWorkflow === w.id ? 'active' : ''}`}
            onClick={() => setActiveWorkflow(w.id)}
            title={w.subtitle}
          >
            <span className="tab-icon">{w.icon}</span>
            <span className="tab-label">{w.title}</span>
          </button>
        ))}
      </div>

      <div className="workflow-detail">
        <div className="workflow-banner">
          <div className="banner-title">{workflow.icon} {workflow.title}</div>
          <div className="banner-subtitle">{workflow.subtitle}</div>
          <div className="banner-principle">⚡ {workflow.principle}</div>
          <div className="banner-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progressPct}%` }}></div>
            </div>
            <span className="progress-text">{completedCount} / {totalCount} steps complete ({progressPct.toFixed(0)}%)</span>
          </div>
        </div>

        <div className="workflow-steps">
          {workflow.steps.map((step, idx) => {
            const status = stepStatuses[`${activeWorkflow}:${step.id}`] ?? step.status;
            return (
              <div
                key={step.id}
                className={`workflow-step status-${status}`}
                onClick={() => onStepClick?.(activeWorkflow, step.id)}
              >
                <div className="step-status-icon">
                  {status === 'complete' && '✓'}
                  {status === 'in-progress' && '⏳'}
                  {status === 'error' && '✗'}
                  {status === 'skipped' && '⏭'}
                  {status === 'pending' && idx + 1}
                </div>
                <div className="step-content">
                  <div className="step-title">{step.title}</div>
                  <div className="step-desc">{step.description}</div>
                  {step.validationRule && (
                    <div className="step-validation">📋 {step.validationRule}</div>
                  )}
                  {step.outputArtifact && (
                    <div className="step-output">📦 {step.outputArtifact}</div>
                  )}
                  {step.ipcHandler && (
                    <div className="step-ipc">⚡ {step.ipcHandler}</div>
                  )}
                  <div className="step-actions">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={(e) => { e.stopPropagation(); updateStepStatus(step.id, 'complete'); }}
                      disabled={status === 'complete' || status === 'skipped'}
                    >
                      Mark Complete
                    </button>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={(e) => { e.stopPropagation(); updateStepStatus(step.id, 'in-progress'); }}
                    >
                      Start
                    </button>
                    {status !== 'skipped' && (
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={(e) => { e.stopPropagation(); updateStepStatus(step.id, 'skipped'); }}
                      >
                        Skip
                      </button>
                    )}
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={(e) => { e.stopPropagation(); updateStepStatus(step.id, 'pending'); }}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="workflow-footer">
          <div className="footer-principle">
            ⚡ <strong>Principle:</strong> {workflow.principle}
          </div>
          <div className="footer-note">
            Each step validates its inputs and outputs before the next begins.
            No errors propagate. Always accurate.
          </div>
        </div>
      </div>
    </div>
  );
}
