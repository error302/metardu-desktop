"use strict";
/**
 * Preload script — the secure bridge between the sandboxed renderer and the
 * privileged main process.
 *
 * Per ADR-004: contextBridge is the ONLY channel. The renderer sees a small,
 * typed API on `window.metardu`. No direct `require()` access, no Node APIs.
 *
 * Every method here is a thin wrapper around `ipcRenderer.invoke(channel, ...args)`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    app: {
        version: () => electron_1.ipcRenderer.invoke('app:version'),
        platform: () => electron_1.ipcRenderer.invoke('app:platform'),
    },
    fs: {
        newProject: (filePath, name, countryPack) => electron_1.ipcRenderer.invoke('fs:newProject', { filePath, name, countryPack }),
        openProject: (filePath) => electron_1.ipcRenderer.invoke('fs:openProject', filePath),
        importCsv: (filePath, projectId) => electron_1.ipcRenderer.invoke('fs:importCsv', filePath, projectId),
    },
    db: {
        query: (sql, params) => electron_1.ipcRenderer.invoke('db:query', sql, params),
        execute: (sql, params) => electron_1.ipcRenderer.invoke('db:execute', sql, params),
        getPoints: (projectId) => electron_1.ipcRenderer.invoke('db:getPoints', projectId),
        listProjects: () => electron_1.ipcRenderer.invoke('db:listProjects'),
    },
    menu: {
        onFileNew: (cb) => electron_1.ipcRenderer.on('menu:file:new', cb),
        onFileOpened: (cb) => electron_1.ipcRenderer.on('menu:file:opened', (_e, filePath) => cb(filePath)),
        onImportCsv: (cb) => electron_1.ipcRenderer.on('menu:file:importCsv', (_e, filePath) => cb(filePath)),
    },
};
electron_1.contextBridge.exposeInMainWorld('metardu', api);
//# sourceMappingURL=preload.js.map