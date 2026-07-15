/**
 * @metardu/ui-components — React UI components for MetaRDU Desktop v2.0.
 *
 * Surveyor-facing panels for every workflow:
 *   - FlightPlanningPanel: drone mission planning + export
 *   - StakeoutPanel: real-time field guidance (cut/fill, left/right)
 *   - GnssPanel: GNSS monitoring (telemetry, skyplot, NTRIP)
 *   - DroneDashboard: live drone control (arm, mission, RTL)
 *   - AsBuiltPanel: design vs surveyed comparison
 *
 * Usage:
 *   import { FlightPlanningPanel, StakeoutPanel, GnssPanel } from "@metardu/ui-components";
 *
 *   <FlightPlanningPanel />
 *   <StakeoutPanel designPoints={points} />
 *   <GnssPanel />
 */

// Hooks
export {
  usePlatform,
  useApi,
  useFlightPlanning,
  useStakeout,
  useGnssTelemetry,
  useDroneControl,
  useAsBuiltComparison,
  useCrossSection,
  useLulcWorkflow,
} from "./hooks/index.js";

// Panels
export { FlightPlanningPanel } from "./panels/FlightPlanningPanel.js";
export { StakeoutPanel } from "./panels/StakeoutPanel.js";
export { GnssPanel } from "./panels/GnssPanel.js";
export { DroneDashboard } from "./panels/DroneDashboard.js";
export { AsBuiltPanel } from "./panels/AsBuiltPanel.js";
export { LulcPanel } from "./panels/LulcPanel.js";
export { CrossSectionPanel } from "./panels/CrossSectionPanel.js";
export { AppShell } from "./panels/AppShell.js";
