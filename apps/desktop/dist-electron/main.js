"use strict";
/**
 * METARDU Desktop — Electron Main Process
 *
 * This is the trust boundary. Only the main process can:
 *   - Touch the filesystem
 *   - Open the SQLite database
 *   - Spawn the Python RINEX worker
 *   - Access the serial port (total station) / BLE (GNSS rover)
 *   - Make network requests (auto-update, basemap tiles)
 *
 * The renderer is sandboxed and talks to main exclusively via contextBridge
 * IPC handlers exposed in preload.ts.
 *
 * Phase 2 walking skeleton:
 *   - Open a BrowserWindow with React + OpenLayers
 *   - Register IPC handlers for:
 *       db:query      — run a SQL query against the project SQLite
 *       db:execute    — run a SQL statement (insert/update/delete)
 *       fs:openProject — open a .metardu (SQLite) file
 *       fs:importCsv  — parse a CSV of survey points, insert into DB
 *       app:version   — return app version
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("node:path"));
const main_1 = __importDefault(require("electron-log/main"));
const ipc_js_1 = require("./ipc.js");
// __dirname is a CommonJS global; no need to define it
main_1.default.initialize();
main_1.default.info('METARDU Desktop starting…');
const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL;
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
let mainWindow = null;
let database = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        title: 'METARDU Desktop',
        backgroundColor: '#0B2545',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
        if (isDev)
            mainWindow?.webContents.openDevTools({ mode: 'detach' });
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    if (isDev && VITE_DEV_SERVER_URL) {
        main_1.default.info(`Loading Vite dev server: ${VITE_DEV_SERVER_URL}`);
        mainWindow.loadURL(VITE_DEV_SERVER_URL);
    }
    else {
        const indexPath = path.join(__dirname, '../dist/index.html');
        main_1.default.info(`Loading production build: ${indexPath}`);
        mainWindow.loadFile(indexPath);
    }
}
function createMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Project…',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => mainWindow?.webContents.send('menu:file:new'),
                },
                {
                    label: 'Open Project…',
                    accelerator: 'CmdOrCtrl+O',
                    click: async () => {
                        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
                            title: 'Open METARDU Project',
                            filters: [{ name: 'METARDU Project', extensions: ['metardu'] }],
                            properties: ['openFile'],
                        });
                        if (!result.canceled && result.filePaths.length > 0) {
                            mainWindow?.webContents.send('menu:file:opened', result.filePaths[0]);
                        }
                    },
                },
                { type: 'separator' },
                {
                    label: 'Import CSV…',
                    click: async () => {
                        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
                            title: 'Import Survey Points from CSV',
                            filters: [{ name: 'CSV', extensions: ['csv'] }],
                            properties: ['openFile'],
                        });
                        if (!result.canceled && result.filePaths.length > 0) {
                            mainWindow?.webContents.send('menu:file:importCsv', result.filePaths[0]);
                        }
                    },
                },
                { type: 'separator' },
                { role: 'quit' },
            ],
        },
        {
            label: 'Edit',
            submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        {
            label: 'Window',
            submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
        },
    ];
    electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
}
// Single-instance lock
if (!electron_1.app.requestSingleInstanceLock()) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
    });
    electron_1.app.whenReady().then(() => {
        createMenu();
        createWindow();
        // Initialize database connection (will be null until user opens a project)
        (0, ipc_js_1.registerIpcHandlers)(() => database, (db) => { database = db; });
        electron_1.app.on('activate', () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0)
                createWindow();
        });
    });
}
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('before-quit', () => {
    database?.close();
});
//# sourceMappingURL=main.js.map