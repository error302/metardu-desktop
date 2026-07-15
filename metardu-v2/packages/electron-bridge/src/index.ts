/**
 * @metardu/electron-bridge — Drop-in replacement files for metardu-desktop.
 *
 * This package contains the integration code that wires the v2.0 packages
 * (engine, sidecar, IPC schemas) into the existing metardu-desktop Electron app.
 *
 * See INTEGRATION_GUIDE.md for step-by-step instructions.
 */

// Sidecar lifecycle manager (added to main.ts)
export {
  startSidecar,
  stopSidecar,
  getApi,
  isSidecarRunning,
  getSidecarState,
} from "./main/sidecar-manager.js";

// IPC handler registrations (added to ipc.ts)
export { registerV2Handlers } from "./handlers/v2-handlers.js";

// Preload bridge (added to preload.ts)
export { exposeV2Api, type MetarduV2Api } from "./preload/v2-preload.js";

// Replacement for drone-imagery.ts
export {
  planMission,
  exportMissionToFile,
  generateContoursFromDSM,
  extractFeaturesFromOrthophoto,
  processPhotos,
  connectToDrone,
  getDroneTelemetry,
  uploadMissionToDrone,
  generateReport,
  listCameras,
  type DroneDataset,
  type FlightPlanResult,
  type ContourResult,
  type FeatureExtractionResult,
} from "./replacements/drone-imagery-v2.js";
