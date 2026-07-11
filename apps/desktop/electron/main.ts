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

import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import log from 'electron-log/main';

import { Database } from './database.js';
import { registerIpcHandlers } from './ipc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
log.initialize();
log.info('METARDU Desktop starting…');

const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL;
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let database: Database | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
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
    if (isDev) mainWindow?.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev && VITE_DEV_SERVER_URL) {
    log.info(`Loading Vite dev server: ${VITE_DEV_SERVER_URL}`);
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    log.info(`Loading production build: ${indexPath}`);
    mainWindow.loadFile(indexPath);
  }
}

function createMenu() {
  const template: Electron.Menu = [
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
            const result = await dialog.showOpenDialog(mainWindow!, {
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
            const result = await dialog.showOpenDialog(mainWindow!, {
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
  ] as Electron.Menu;

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Single-instance lock
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createMenu();
    createWindow();

    // Initialize database connection (will be null until user opens a project)
    registerIpcHandlers(() => database, (db) => { database = db; });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  database?.close();
});
