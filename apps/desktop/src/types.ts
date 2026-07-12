/**
 * Shared types between the renderer and the preload script.
 *
 * The preload script is compiled as CommonJS (for Electron's main-side require),
 * while the renderer is bundled by Vite. To avoid cross-compile-unit imports,
 * shared types live here and are imported by both sides.
 */

export interface SurveyPoint {
  point_number: string;
  easting: number;
  northing: number;
  elevation: number | null;
  code: string | null;
  description: string | null;
  source: 'csv' | 'gnss' | 'total_station' | 'manual';
}

export interface ProjectRow {
  id: string;
  name: string;
  country_pack: string;
  default_crs_epsg: number;
  created_at: string;
  updated_at: string;
}

/**
 * The bridge API exposed by the preload script via contextBridge.
 * The renderer accesses this as `window.metardu`.
 */
export interface MetarduApi {
  app: {
    version: () => Promise<string>;
    platform: () => Promise<string>;
  };
  fs: {
    newProject: (filePath: string, name: string, countryPack?: string) =>
      Promise<{ filePath: string; projectId: string }>;
    openProject: (filePath: string) => Promise<{ filePath: string }>;
    importCsv: (filePath: string, projectId?: string) =>
      Promise<{ imported: number; projectId: string }>;
  };
  db: {
    query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
    execute: (sql: string, params?: unknown[]) =>
      Promise<{ changes: number; lastInsertRowid: number }>;
    getPoints: (projectId?: string) => Promise<SurveyPoint[]>;
    listProjects: () => Promise<ProjectRow[]>;
  };
  menu: {
    onFileNew: (cb: () => void) => void;
    onFileOpened: (cb: (filePath: string) => void) => void;
    onImportCsv: (cb: (filePath: string) => void) => void;
  };
  map?: {
    getLayers: () => Promise<any>;
    getProjections: () => Promise<any>;
    getMapSheets: () => Promise<any>;
    getGridConfigs: () => Promise<any>;
    getBeaconSymbology: () => Promise<any>;
    getControlSymbology: () => Promise<any>;
    getPapStatusColors: () => Promise<any>;
    measureDistance: (points: any) => Promise<any>;
    measureArea: (points: any) => Promise<any>;
    measureBearing: (p1: any, p2: any) => Promise<any>;
    generateScaleBar: (scaleDenominator: number, paperWidthMM?: number) => Promise<any>;
    getLayersForSurveyType: (surveyType: string) => Promise<any>;
  };
}
