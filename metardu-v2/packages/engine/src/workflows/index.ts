/**
 * Workflows — vertical slices that tie together sidecar compute +
 * country-config + document renderers into end-to-end survey
 * pipelines.
 *
 * Each workflow module is a single function that the Electron main
 * process (or a script) can call. Per master plan Section 9, the
 * workflow families are:
 *
 *   - Cadastral (Phase 6 — implemented, Kenya Form 3 end-to-end)
 *   - Topographic (Phase 9A — implemented, field data → TIN → contours)
 *   - Engineering (Phase 9B — implemented, cross-sections + cut/fill volumes)
 *   - Construction Setting-Out (Phase 9C — implemented, design → stakeout → as-built QC)
 *   - Sectional Properties (Phase 9D — implemented, building units + participation quotas)
 */

export {
  runCadastralWorkflow,
  type CadastralWorkflowInput,
  type CadastralWorkflowOutput,
  type DistanceObservation,
} from "./cadastral.js";

export {
  runTopographicWorkflow,
  type TopoPoint,
  type TIN,
  type Contour,
  type SpotHeight,
  type TopoWorkflowInput,
  type TopoWorkflowOutput,
} from "./topographic.js";

export {
  runEngineeringWorkflow,
  type DesignSurface,
  type Alignment,
  type CrossSection,
  type EngineeringWorkflowInput,
  type EngineeringWorkflowOutput,
} from "./engineering.js";

export {
  runSettingOutWorkflow,
  type DesignPoint,
  type ControlPoint,
  type StakeoutMethod,
  type StakeoutInstruction,
  type AsBuiltObservation,
  type AsBuiltResult,
  type SettingOutWorkflowInput,
  type SettingOutWorkflowOutput,
} from "./setting-out.js";

export {
  runSectionalWorkflow,
  type Polygon,
  type BuildingLevel,
  type SectionalUnit,
  type SectionalWorkflowInput,
  type SectionalWorkflowOutput,
} from "./sectional.js";

// Drone data processing (photogrammetry pipeline)
export {
  validatePhotos,
  computeGsd,
  altitudeForGsd,
  classifyAsprs,
  estimateOverlap,
  generateProcessingReport,
  type DronePhoto,
  type GCP,
  type ProcessingQuality,
  type ProcessingResult,
  type DroneProcessingInput,
} from "./drone-processing.js";
