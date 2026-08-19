export { AppShell } from "./panels/AppShell.js";
export { CommandPalette } from "./panels/CommandPalette.js";
export type {
  CommandPaletteViewId,
  CommandPaletteNavItem,
  CommandPalettePoint,
  CommandPaletteProject,
} from "./panels/CommandPalette.js";
export { SurveyCanvas } from "./canvas/SurveyCanvas.js";
export type {
  SurveyPoint,
  SurveyLine,
  SurveyPolygon,
  SurveyContour,
  SurveyTriangle,
  SurveyEllipse,
  SurveyCanvasProps,
} from "./canvas/SurveyCanvas.js";
export { generateContours, delaunayTriangulate, computeIndexElevations, contourColor } from "./canvas/contour-generation.js";
export type {
  ContourInputPoint,
  ContourLine,
  ContourResult,
  ContourOptions,
} from "./canvas/contour-generation.js";
export { useInstrumentConnection } from "./hooks/useInstrumentConnection.js";
export type {
  ConnectionType,
  SerialPortInfo,
  BleDeviceInfo,
  ConnectionState,
  RawObservation,
  ConnectionStatus,
  ConnectParams,
  UseInstrumentConnectionReturn,
} from "./hooks/useInstrumentConnection.js";
