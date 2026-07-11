/**
 * Preload script — the secure bridge between the sandboxed renderer and the
 * privileged main process.
 *
 * Per ADR-004: contextBridge is the ONLY channel. The renderer sees a small,
 * typed API on `window.metardu`. No direct `require()` access, no Node APIs.
 *
 * Every method here is a thin wrapper around `ipcRenderer.invoke(channel, ...args)`.
 */
declare const api: {
    app: {
        version: () => Promise<string>;
        platform: () => Promise<string>;
    };
    fs: {
        newProject: (filePath: string, name: string, countryPack?: string) => Promise<{
            filePath: string;
            projectId: string;
        }>;
        openProject: (filePath: string) => Promise<{
            filePath: string;
        }>;
        importCsv: (filePath: string, projectId?: string) => Promise<{
            imported: number;
            projectId: string;
        }>;
    };
    db: {
        query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
        execute: (sql: string, params?: unknown[]) => Promise<{
            changes: number;
            lastInsertRowid: number;
        }>;
        getPoints: (projectId?: string) => Promise<SurveyPoint[]>;
        listProjects: () => Promise<ProjectRow[]>;
    };
    menu: {
        onFileNew: (cb: () => void) => Electron.IpcRenderer;
        onFileOpened: (cb: (filePath: string) => void) => Electron.IpcRenderer;
        onImportCsv: (cb: (filePath: string) => void) => Electron.IpcRenderer;
    };
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
export type MetarduApi = typeof api;
export {};
//# sourceMappingURL=preload.d.ts.map