/**
 * zod IPC schemas for the `pipeline:*` namespace (Aerial survey pipeline).
 *
 * 9 handlers in v1.0:
 *   - pipeline:start (start the 13-stage aerial pipeline)
 *   - pipeline:status (get current status of a running pipeline)
 *   - pipeline:cancel (cancel a running pipeline)
 *   - pipeline:list (list all pipelines for a project)
 *   - pipeline:get (get a specific pipeline)
 *   - pipeline:cost.estimate (estimate cost of a pipeline run)
 *   - pipeline:stage.execute (execute a specific stage manually)
 *   - pipeline:stage.skip (skip a stage)
 *   - pipeline:report.generate (generate the final statutory report)
 */

import { z } from "zod";

export const LatitudeSchema = z.number().min(-90).max(90);
export const LongitudeSchema = z.number().min(-180).max(180);
export const DatasetIdSchema = z.string().uuid();
export const ProjectIdSchema = z.string().uuid();

/** 13 stages of the aerial pipeline */
export const PipelineStageSchema = z.enum([
  "planning",          // 1. Flight planning
  "gcp_survey",        // 2. GCP field survey
  "drone_capture",     // 3. Drone flight (external)
  "processing",        // 4. Photogrammetry (external or local ODM)
  "import",            // 5. Import outputs into MetaRDU
  "verification",      // 6. GCP residual verification
  "extraction",        // 7. Feature extraction (ML)
  "contouring",        // 8. Contour generation (GDAL)
  "digitization",      // 9. Manual digitization (user task)
  "volume",            // 10. Stockpile/cut-fill volume computation
  "deliverables",      // 11. Generate statutory deliverables (Form No. 4, etc.)
  "seal",              // 12. RSA-2048 cryptographic seal
  "submission",        // 13. NLIMS/ArdhiSasa submission
]);

// ─── pipeline:start ────────────────────────────────────────────────

export const PipelineStartInputSchema = z.object({
  projectId: ProjectIdSchema,
  /** Optional: survey area (required if no flight plan exists yet) */
  area: z.object({
    coordinates: z.array(z.object({
      lat: LatitudeSchema,
      lng: LongitudeSchema,
    })).min(4).max(10_000),
  }).optional(),
  /** Optional: existing flight plan to use (skips stage 1) */
  flightPlanId: z.string().uuid().optional(),
  /** Optional: existing GCP survey to use (skips stage 2) */
  gcpSurveyId: z.string().uuid().optional(),
  /** Stages to skip (e.g., if drone capture was done externally) */
  skipStages: z.array(PipelineStageSchema).max(13).optional(),
}).strict();

// ─── pipeline:status ───────────────────────────────────────────────

export const PipelineStatusInputSchema = z.object({
  pipelineId: z.string().uuid(),
}).strict();

// ─── pipeline:cancel ───────────────────────────────────────────────

export const PipelineCancelInputSchema = z.object({
  pipelineId: z.string().uuid(),
  confirm: z.literal(true),
}).strict();

// ─── pipeline:list ─────────────────────────────────────────────────

export const PipelineListInputSchema = z.object({
  projectId: ProjectIdSchema,
  /** Optional: filter by status */
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]).optional(),
}).strict();

// ─── pipeline:get ──────────────────────────────────────────────────

export const PipelineGetInputSchema = z.object({
  pipelineId: z.string().uuid(),
}).strict();

// ─── pipeline:cost.estimate ────────────────────────────────────────

export const PipelineCostEstimateInputSchema = z.object({
  /** Survey area in hectares */
  areaHectares: z.number().positive().max(10_000),
  /** Camera to use (affects flight time and battery count) */
  cameraId: z.string().min(1).max(100),
  /** Altitude in meters AGL */
  altitudeM: z.number().positive().max(500),
  /** Optional: number of GCPs to survey (affects field work cost) */
  gcpCount: z.number().int().positive().max(500).optional(),
  /** Optional: currency for the estimate (default KES) */
  currency: z.enum(["KES", "USD", "EUR", "GBP"]).optional(),
}).strict();

// ─── pipeline:stage.execute ────────────────────────────────────────

export const PipelineStageExecuteInputSchema = z.object({
  pipelineId: z.string().uuid(),
  stage: PipelineStageSchema,
  /** Optional: stage-specific parameters */
  params: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ─── pipeline:stage.skip ───────────────────────────────────────────

export const PipelineStageSkipInputSchema = z.object({
  pipelineId: z.string().uuid(),
  stage: PipelineStageSchema,
  /** Reason for skipping (required for audit log) */
  reason: z.string().min(1).max(500),
}).strict();

// ─── pipeline:report.generate ──────────────────────────────────────

export const PipelineReportGenerateInputSchema = z.object({
  pipelineId: z.string().uuid(),
  /** Report format */
  format: z.enum(["pdf", "docx", "json"]),
  /** Optional: include specific sections */
  includeSections: z.array(z.enum([
    "summary",
    "flight_plan",
    "gcp_report",
    "accuracy_report",
    "volume_report",
    "deliverables_list",
    "seal_certificate",
    "compliance_check",
  ])).optional(),
}).strict();

// ─── Registry ──────────────────────────────────────────────────────

export const PIPELINE_SCHEMAS = {
  "pipeline:start": PipelineStartInputSchema,
  "pipeline:status": PipelineStatusInputSchema,
  "pipeline:cancel": PipelineCancelInputSchema,
  "pipeline:list": PipelineListInputSchema,
  "pipeline:get": PipelineGetInputSchema,
  "pipeline:cost.estimate": PipelineCostEstimateInputSchema,
  "pipeline:stage.execute": PipelineStageExecuteInputSchema,
  "pipeline:stage.skip": PipelineStageSkipInputSchema,
  "pipeline:report.generate": PipelineReportGenerateInputSchema,
} as const;

export type PipelineSchemaName = keyof typeof PIPELINE_SCHEMAS;
