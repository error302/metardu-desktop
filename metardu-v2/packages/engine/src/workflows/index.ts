/**
 * Workflows — vertical slices that tie together sidecar compute +
 * country-config + document renderers into end-to-end survey
 * pipelines.
 *
 * Each workflow module is a single function that the Electron main
 * process (or a script) can call. Per master plan Section 9, the
 * workflow families are:
 *   - Cadastral (Phase 6 — implemented here)
 *   - Topographic (future)
 *   - Engineering (future)
 *   - Construction Setting-Out (future)
 *   - Sectional Properties (future)
 */

export {
  runCadastralWorkflow,
  type CadastralWorkflowInput,
  type CadastralWorkflowOutput,
  type DistanceObservation,
} from "./cadastral.js";
