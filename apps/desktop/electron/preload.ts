/**
 * Preload script — the secure bridge between the sandboxed renderer and the
 * privileged main process.
 *
 * Per ADR-004: contextBridge is the ONLY channel. The renderer sees a small,
 * typed API on `window.metardu`. No direct `require()` access, no Node APIs.
 *
 * Every method here is a thin wrapper around `ipcRenderer.invoke(channel, ...args)`.
 */

import { contextBridge, ipcRenderer } from 'electron';

const api = {
  app: {
    version: () => ipcRenderer.invoke('app:version') as Promise<string>,
    platform: () => ipcRenderer.invoke('app:platform') as Promise<string>,
  },
  fs: {
    newProject: (filePath: string, name: string, countryPack?: string) =>
      ipcRenderer.invoke('fs:newProject', { filePath, name, countryPack }) as Promise<{ filePath: string; projectId: string }>,
    openProject: (filePath: string) =>
      ipcRenderer.invoke('fs:openProject', filePath) as Promise<{ filePath: string }>,
    importCsv: (filePath: string, projectId?: string) =>
      ipcRenderer.invoke('fs:importCsv', filePath, projectId) as Promise<{ imported: number; projectId: string }>,
  },
  db: {
    query: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:query', sql, params) as Promise<unknown[]>,
    execute: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:execute', sql, params) as Promise<{ changes: number; lastInsertRowid: number }>,
    getPoints: (projectId?: string) =>
      ipcRenderer.invoke('db:getPoints', projectId) as Promise<SurveyPoint[]>,
    listProjects: () =>
      ipcRenderer.invoke('db:listProjects') as Promise<ProjectRow[]>,
  },
  menu: {
    onFileNew: (cb: () => void) => ipcRenderer.on('menu:file:new', cb),
    onFileOpened: (cb: (filePath: string) => void) => ipcRenderer.on('menu:file:opened', (_e, filePath: string) => cb(filePath)),
    onImportCsv: (cb: (filePath: string) => void) => ipcRenderer.on('menu:file:importCsv', (_e, filePath: string) => cb(filePath)),
  },
  map: {
    getLayers: () => ipcRenderer.invoke('map:getLayers'),
    getProjections: () => ipcRenderer.invoke('map:getProjections'),
    getMapSheets: () => ipcRenderer.invoke('map:getMapSheets'),
    getGridConfigs: () => ipcRenderer.invoke('map:getGridConfigs'),
    getBeaconSymbology: () => ipcRenderer.invoke('map:getBeaconSymbology'),
    getControlSymbology: () => ipcRenderer.invoke('map:getControlSymbology'),
    getPapStatusColors: () => ipcRenderer.invoke('map:getPapStatusColors'),
    measureDistance: (points: any) => ipcRenderer.invoke('map:measureDistance', points),
    measureArea: (points: any) => ipcRenderer.invoke('map:measureArea', points),
    measureBearing: (p1: any, p2: any) => ipcRenderer.invoke('map:measureBearing', p1, p2),
    generateScaleBar: (scaleDenominator: number, paperWidthMM?: number) =>
      ipcRenderer.invoke('map:generateScaleBar', scaleDenominator, paperWidthMM),
    getLayersForSurveyType: (surveyType: string) => ipcRenderer.invoke('map:getLayersForSurveyType', surveyType),
  },
};

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

contextBridge.exposeInMainWorld('metardu', api);

// Type declaration for the renderer (declared globally so React can use it)
export type MetarduApi = typeof api;
