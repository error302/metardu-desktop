/**
 * Aerial-to-Statutory Pipeline — The killer feature
 *
 * No competitor in the world does this end-to-end:
 *
 *   1. Drone captures photos (500 hectares, 1 hour)
 *   2. METARDU provides GCPs (total station/GNSS, 30 minutes)
 *   3. OpenDroneMap processes (2 hours, automated)
 *   4. METARDU imports orthophoto + DSM (1 click)
 *   5. METARDU verifies GCP residuals
 *   6. METARDU extracts features (building footprints, road edges)
 *   7. METARDU generates contours from DSM
 *   8. METARDU digitizes parcel boundaries on orthophoto
 *   9. METARDU computes volumes (for earthwork billing)
 *   10. METARDU generates statutory deliverables:
 *       - Topographic sheet (SoK-compliant, contours from DSM)
 *       - Deed plan (from digitized parcel boundaries)
 *       - Volume report (for payment certification)
 *       - Survey report (RSA-2048 sealed)
 *
 * Pix4D stops at step 3. METARDU takes it from 3 to 10.
 *
 * Pipeline stages:
 *   - PLANNING: Define project area, expected GSD, GCP plan
 *   - GCP_SURVEY: Field survey of GCPs (total station / GNSS)
 *   - DRONE_CAPTURE: Drone flight (external)
 *   - PROCESSING: ODM / Pix4D processing (external)
 *   - IMPORT: Import orthophoto + DSM + point cloud
 *   - VERIFICATION: Verify GCP residuals
 *   - EXTRACTION: Extract features from orthophoto
 *   - CONTOURING: Generate contours from DSM
 *   - DIGITIZATION: Digitize parcel boundaries (manual or semi-auto)
 *   - VOLUME: Compute volumes if applicable
 *   - DELIVERABLES: Generate statutory outputs
 *   - SEAL: RSA-2048 digital seal
 *   - SUBMIT: Submit to Director of Surveys (SR3)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import log from 'electron-log/main';
import { app } from 'electron';

// ─── Pipeline Types ────────────────────────────────────────────────────

export type PipelineStage =
  | 'planning'
  | 'gcp_survey'
  | 'drone_capture'
  | 'processing'
  | 'import'
  | 'verification'
  | 'extraction'
  | 'contouring'
  | 'digitization'
  | 'volume'
  | 'deliverables'
  | 'seal'
  | 'submit'
  | 'complete'
  | 'failed';

export type SurveyApplication = 'cadastral' | 'engineering' | 'topographical' | 'wayleave' | 'stockpile' | 'deformation';

export interface PipelineStageStatus {
  stage: PipelineStage;
  status: 'pending' | 'in_progress' | 'complete' | 'skipped' | 'failed';
  startedAt?: string;
  completedAt?: string;
  durationSec?: number;
  notes?: string;
  artifacts?: string[];  // file paths or dataset IDs produced
  errors?: string[];
}

export interface AerialPipelineProject {
  id: string;
  name: string;
  application: SurveyApplication;
  // Project area
  projectName: string;
  county: string;
  locality: string;
  parcelNumber?: string;
  lrNumber?: string;
  // Expected parameters
  expectedGSDcm: number;
  expectedAreaHa: number;
  flightAltitudeM: number;
  numberOfGCPsPlanned: number;
  // Surveyor
  surveyorName: string;
  surveyorLicense: string;
  // Dates
  plannedDate: string;
  captureDate?: string;
  processingDate?: string;
  // Stage tracking
  stages: PipelineStageStatus[];
  currentStage: PipelineStage;
  // Linked datasets
  droneDatasetIds: string[];
  gcpIds: string[];
  // Outputs
  deliverables: PipelineDeliverable[];
  // Metadata
  createdAt: string;
  updatedAt: string;
}

export interface PipelineDeliverable {
  type: 'topographic_sheet' | 'deed_plan' | 'volume_report' | 'survey_report' | 'feature_extraction' | 'contour_map' | 'dsm' | 'orthophoto' | 'point_cloud';
  name: string;
  filePath?: string;
  datasetId?: string;
  generatedAt: string;
  sealed: boolean;
  status: 'pending' | 'generated' | 'sealed' | 'failed';
}

// ─── Pipeline Registry ─────────────────────────────────────────────────

const PIPELINE_DIR = 'aerial_pipelines';
const PIPELINE_FILE = 'pipelines.json';

function getPipelineDir(): string {
  const userDataPath = app.getPath('userData');
  const dir = path.join(userDataPath, PIPELINE_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadPipelines(): Record<string, AerialPipelineProject> {
  const filePath = path.join(getPipelineDir(), PIPELINE_FILE);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function savePipelines(pipelines: Record<string, AerialPipelineProject>): void {
  const filePath = path.join(getPipelineDir(), PIPELINE_FILE);
  fs.writeFileSync(filePath, JSON.stringify(pipelines, null, 2), { mode: 0o600 });
}

// ─── Pipeline CRUD ─────────────────────────────────────────────────────

export function createPipeline(input: Omit<AerialPipelineProject, 'id' | 'stages' | 'currentStage' | 'droneDatasetIds' | 'gcpIds' | 'deliverables' | 'createdAt' | 'updatedAt'>): AerialPipelineProject {
  const id = `pipeline-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();

  // Initialize stages based on application type
  const stages = getDefaultStages(input.application);

  const pipeline: AerialPipelineProject = {
    ...input,
    id,
    stages,
    currentStage: 'planning',
    droneDatasetIds: [],
    gcpIds: [],
    deliverables: [],
    createdAt: now,
    updatedAt: now,
  };

  const pipelines = loadPipelines();
  pipelines[id] = pipeline;
  savePipelines(pipelines);

  log.info(`Aerial pipeline created: ${pipeline.name} (${input.application})`);
  return pipeline;
}

function getDefaultStages(application: SurveyApplication): PipelineStageStatus[] {
  const allStages: PipelineStage[] = [
    'planning', 'gcp_survey', 'drone_capture', 'processing',
    'import', 'verification', 'extraction', 'contouring',
    'digitization', 'volume', 'deliverables', 'seal', 'submit',
  ];

  // Filter stages based on application
  const skipStages: PipelineStage[] = [];
  if (application === 'stockpile') {
    skipStages.push('extraction', 'digitization', 'submit');
  } else if (application === 'deformation') {
    skipStages.push('extraction', 'digitization', 'volume');
  } else if (application === 'topographical') {
    skipStages.push('digitization');
  } else if (application === 'wayleave') {
    skipStages.push('volume');
  }

  return allStages.map(stage => ({
    stage,
    status: skipStages.includes(stage) ? 'skipped' : 'pending',
  }));
}

export function listPipelines(): AerialPipelineProject[] {
  return Object.values(loadPipelines()).sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getPipeline(id: string): AerialPipelineProject | null {
  return loadPipelines()[id] ?? null;
}

export function updatePipelineStage(
  pipelineId: string,
  stage: PipelineStage,
  status: PipelineStageStatus['status'],
  options?: { notes?: string; artifacts?: string[]; errors?: string[] },
): AerialPipelineProject | null {
  const pipelines = loadPipelines();
  const pipeline = pipelines[pipelineId];
  if (!pipeline) return null;

  const stageStatus = pipeline.stages.find(s => s.stage === stage);
  if (!stageStatus) return null;

  const now = new Date().toISOString();
  if (status === 'in_progress' && !stageStatus.startedAt) {
    stageStatus.startedAt = now;
  }
  if (status === 'complete' || status === 'failed') {
    stageStatus.completedAt = now;
    if (stageStatus.startedAt) {
      stageStatus.durationSec = (new Date(now).getTime() - new Date(stageStatus.startedAt).getTime()) / 1000;
    }
  }
  stageStatus.status = status;
  if (options?.notes) stageStatus.notes = options.notes;
  if (options?.artifacts) stageStatus.artifacts = options.artifacts;
  if (options?.errors) stageStatus.errors = options.errors;

  // Advance current stage
  const nextStage = getNextStage(pipeline, stage);
  if (nextStage && status === 'complete') {
    pipeline.currentStage = nextStage;
  }
  if (stage === 'submit' && status === 'complete') {
    pipeline.currentStage = 'complete';
  }
  if (status === 'failed') {
    pipeline.currentStage = 'failed';
  }

  pipeline.updatedAt = now;
  pipelines[pipelineId] = pipeline;
  savePipelines(pipelines);

  log.info(`Pipeline ${pipelineId}: stage "${stage}" → ${status}`);
  return pipeline;
}

function getNextStage(pipeline: AerialPipelineProject, currentStage: PipelineStage): PipelineStage | null {
  const orderedStages: PipelineStage[] = [
    'planning', 'gcp_survey', 'drone_capture', 'processing',
    'import', 'verification', 'extraction', 'contouring',
    'digitization', 'volume', 'deliverables', 'seal', 'submit', 'complete',
  ];
  const idx = orderedStages.indexOf(currentStage);
  if (idx === -1 || idx >= orderedStages.length - 1) return null;

  // Skip stages marked as 'skipped'
  for (let i = idx + 1; i < orderedStages.length; i++) {
    const next = orderedStages[i];
    const stageStatus = pipeline.stages.find(s => s.stage === next);
    if (stageStatus && stageStatus.status !== 'skipped') {
      return next;
    }
  }
  return 'complete';
}

export function deletePipeline(id: string): boolean {
  const pipelines = loadPipelines();
  if (!pipelines[id]) return false;
  delete pipelines[id];
  savePipelines(pipelines);
  return true;
}

// ─── Pipeline Execution Helpers ────────────────────────────────────────

export interface PipelineProgressSummary {
  totalStages: number;
  completedStages: number;
  skippedStages: number;
  failedStages: number;
  inProgressStages: number;
  pendingStages: number;
  progressPercent: number;
  estimatedRemainingTime: string;
  currentStage: PipelineStage;
  currentStageDescription: string;
}

export function getPipelineProgress(pipeline: AerialPipelineProject): PipelineProgressSummary {
  const activeStages = pipeline.stages.filter(s => s.status !== 'skipped');
  const completed = activeStages.filter(s => s.status === 'complete').length;
  const failed = activeStages.filter(s => s.status === 'failed').length;
  const inProgress = activeStages.filter(s => s.status === 'in_progress').length;
  const pending = activeStages.filter(s => s.status === 'pending').length;
  const progressPercent = activeStages.length > 0 ? (completed / activeStages.length) * 100 : 0;

  const stageDescriptions: Record<PipelineStage, string> = {
    planning: 'Defining project area, expected GSD, and GCP placement plan',
    gcp_survey: 'Field survey of Ground Control Points using total station or GNSS',
    drone_capture: 'Drone flight to capture aerial photos (external)',
    processing: 'Processing drone photos in ODM/Pix4D (external)',
    import: 'Importing orthophoto, DSM, and point cloud into METARDU',
    verification: 'Verifying GCP residuals against known coordinates',
    extraction: 'Auto-extracting building footprints and road edges from orthophoto',
    contouring: 'Generating contours from DSM',
    digitization: 'Digitizing parcel boundaries on orthophoto',
    volume: 'Computing cut/fill volumes and stockpile quantities',
    deliverables: 'Generating statutory deliverables (topo sheet, deed plan, volume report)',
    seal: 'Applying RSA-2048 digital seal to all deliverables',
    submit: 'Preparing submission to Director of Surveys (Form SR3)',
    complete: 'Pipeline complete — all deliverables generated and sealed',
    failed: 'Pipeline failed — check stage errors',
  };

  // Estimate remaining time based on completed stages
  const totalCompletedTime = pipeline.stages
    .filter(s => s.durationSec != null)
    .reduce((sum, s) => sum + (s.durationSec ?? 0), 0);
  const avgStageTime = completed > 0 ? totalCompletedTime / completed : 600;  // default 10 min
  const remainingSec = pending * avgStageTime;
  const hours = Math.floor(remainingSec / 3600);
  const minutes = Math.floor((remainingSec % 3600) / 60);
  const estimatedRemainingTime = hours > 0
    ? `${hours}h ${minutes}m`
    : `${minutes}m`;

  return {
    totalStages: activeStages.length,
    completedStages: completed,
    skippedStages: activeStages.length - activeStages.filter(s => s.status !== 'skipped').length,
    failedStages: failed,
    inProgressStages: inProgress,
    pendingStages: pending,
    progressPercent,
    estimatedRemainingTime,
    currentStage: pipeline.currentStage,
    currentStageDescription: stageDescriptions[pipeline.currentStage] ?? '',
  };
}

// ─── Pipeline Validation ───────────────────────────────────────────────

export interface PipelineValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  canProceed: boolean;
}

export function validatePipelineForSubmission(pipeline: AerialPipelineProject): PipelineValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check all required stages are complete
  const requiredStages = pipeline.stages.filter(s => s.status !== 'skipped');
  for (const stage of requiredStages) {
    if (stage.status !== 'complete') {
      errors.push(`Stage "${stage.stage}" is ${stage.status} — must be complete before submission`);
    }
  }

  // Check deliverables
  if (pipeline.deliverables.length === 0) {
    errors.push('No deliverables generated');
  }

  // Check at least one deliverable is sealed
  const sealedDeliverables = pipeline.deliverables.filter(d => d.sealed);
  if (sealedDeliverables.length === 0) {
    warnings.push('No deliverables are sealed — recommend RSA-2048 seal before submission');
  }

  // Check GCPs
  if (pipeline.gcpIds.length === 0) {
    warnings.push('No GCPs linked to pipeline — aerial data is not ground-verified');
  }

  // Check drone datasets
  if (pipeline.droneDatasetIds.length === 0) {
    errors.push('No drone datasets imported');
  }

  // Application-specific checks
  switch (pipeline.application) {
    case 'cadastral':
      if (!pipeline.parcelNumber) {
        warnings.push('No parcel number set — required for deed plan generation');
      }
      break;
    case 'engineering':
      if (!pipeline.deliverables.some(d => d.type === 'volume_report')) {
        warnings.push('No volume report generated — recommended for engineering surveys');
      }
      break;
    case 'topographical':
      if (!pipeline.deliverables.some(d => d.type === 'contour_map')) {
        warnings.push('No contour map generated — required for topographical surveys');
      }
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    canProceed: errors.length === 0,
  };
}

// ─── Stage-to-Module Wiring ────────────────────────────────────────────

/**
 * Get the IPC handler or module function for a given pipeline stage.
 * This maps pipeline stages to the actual METARDU modules that execute them.
 */
export function getStageExecutor(stage: PipelineStage): {
  module: string;
  functionName: string;
  ipcChannel?: string;
  description: string;
} {
  const executors: Record<PipelineStage, { module: string; functionName: string; ipcChannel?: string; description: string }> = {
    planning: { module: 'aerial-pipeline', functionName: 'createPipeline', description: 'Define project parameters' },
    gcp_survey: { module: 'gcp-manager', functionName: 'convertSurveyPointsToGCPs', ipcChannel: 'gcp:convertPoints', description: 'Convert survey points to GCPs' },
    drone_capture: { module: 'external', functionName: 'drone_flight', description: 'Drone flight (external — not executed by METARDU)' },
    processing: { module: 'external', functionName: 'odm_or_pix4d', description: 'Drone photo processing (external — ODM or Pix4D)' },
    import: { module: 'drone-imagery', functionName: 'importDroneDataset', ipcChannel: 'drone:import', description: 'Import orthophoto + DSM + point cloud' },
    verification: { module: 'gcp-manager', functionName: 'verifyGCPResiduals', ipcChannel: 'gcp:verifyResiduals', description: 'Verify GCP residuals' },
    extraction: { module: 'drone-imagery', functionName: 'extractFeaturesFromOrthophoto', ipcChannel: 'drone:extractFeatures', description: 'Extract building footprints and road edges' },
    contouring: { module: 'drone-imagery', functionName: 'generateContoursFromDSM', ipcChannel: 'drone:generateContours', description: 'Generate contours from DSM' },
    digitization: { module: 'map', functionName: 'digitizeBoundaries', description: 'Digitize parcel boundaries on orthophoto (manual)' },
    volume: { module: 'drone-volume', functionName: 'computeSurfaceDifference', ipcChannel: 'drone:computeVolume', description: 'Compute cut/fill volumes' },
    deliverables: { module: 'statutory-forms', functionName: 'generateSurveyReport', ipcChannel: 'report:generate', description: 'Generate statutory deliverables' },
    seal: { module: 'crypto-seal', functionName: 'sealDocument', ipcChannel: 'deedPlan:seal', description: 'Apply RSA-2048 digital seal' },
    submit: { module: 'electronic-cadastre-forms', functionName: 'generateSR3', ipcChannel: 'form:generateSR3', description: 'Generate Form SR3 for Director of Surveys' },
    complete: { module: 'none', functionName: 'none', description: 'Pipeline complete' },
    failed: { module: 'none', functionName: 'none', description: 'Pipeline failed' },
  };
  return executors[stage];
}

// ─── Pipeline Cost Estimation ──────────────────────────────────────────

export interface PipelineCostEstimate {
  // Field work
  gcpSurveyCost: number;          // KSh
  droneFlightCost: number;        // KSh
  // Processing
  processingCost: number;         // KSh (ODM free, Pix4D paid)
  // METARDU work
  featureExtractionCost: number;  // KSh
  digitizationCost: number;       // KSh
  volumeComputationCost: number;  // KSh
  deliverableGenerationCost: number; // KSh
  // Total
  totalCost: number;
  // Time estimate
  estimatedTotalTimeHours: number;
  // Comparison
  totalStationEquivalentCost: number;
  totalStationEquivalentTimeHours: number;
  costSavings: number;
  timeSavings: number;
}

export function estimatePipelineCost(
  areaHa: number,
  application: SurveyApplication,
  processingSoftware: 'odm' | 'pix4d' = 'odm',
): PipelineCostEstimate {
  // Rough Kenyan market rates (2026 estimates)
  const gcpSurveyCost = Math.max(5000, Math.ceil(areaHa / 5) * 3000);  // KSh 3000 per GCP, 1 per 5ha
  const droneFlightCost = Math.ceil(areaHa / 50) * 15000;  // KSh 15000 per 50ha flight
  const processingCost = processingSoftware === 'odm' ? 0 : 5000;  // ODM free, Pix4D license
  const featureExtractionCost = application === 'cadastral' || application === 'topographical' ? Math.ceil(areaHa * 500) : 0;
  const digitizationCost = application === 'cadastral' ? Math.ceil(areaHa * 1000) : 0;
  const volumeComputationCost = application === 'engineering' || application === 'stockpile' ? 5000 : 0;
  const deliverableGenerationCost = 3000;

  const totalCost = gcpSurveyCost + droneFlightCost + processingCost +
    featureExtractionCost + digitizationCost + volumeComputationCost + deliverableGenerationCost;

  // Time estimates
  const estimatedTotalTimeHours = 4 + (areaHa / 100) + (application === 'cadastral' ? areaHa / 50 : 2);

  // Total station equivalent (much slower, more expensive)
  const totalStationEquivalentCost = Math.ceil(areaHa * 5000);  // KSh 5000/ha
  const totalStationEquivalentTimeHours = Math.ceil(areaHa * 2);  // 2hr/ha

  const costSavings = totalStationEquivalentCost - totalCost;
  const timeSavings = totalStationEquivalentTimeHours - estimatedTotalTimeHours;

  return {
    gcpSurveyCost,
    droneFlightCost,
    processingCost,
    featureExtractionCost,
    digitizationCost,
    volumeComputationCost,
    deliverableGenerationCost,
    totalCost,
    estimatedTotalTimeHours,
    totalStationEquivalentCost,
    totalStationEquivalentTimeHours,
    costSavings,
    timeSavings,
  };
}
