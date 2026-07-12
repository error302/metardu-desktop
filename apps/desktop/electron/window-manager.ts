/**
 * Multi-Window Workspace — Detachable Windows + Multi-Monitor Support
 *
 * OV6: Web apps are single-tab. Desktop can open multiple windows across
 * monitors. A surveyor with 2 monitors puts the map on one, the traverse
 * sheet on the other, the 3D view on a third.
 *
 * Window types:
 *   - main: the primary window (always open)
 *   - map: detachable OpenLayers map
 *   - traverse: traverse computation sheet
 *   - profile: cross-section / longitudinal profile viewer
 *   - deed-plan: deed plan preview
 *   - 3d: Three.js 3D scene
 *   - audit: audit log viewer
 *
 * Each window remembers its position, size, and state across sessions.
 * Selection is synchronized: click a point on the map, it highlights
 * in the traverse sheet and 3D view simultaneously.
 */

import { BrowserWindow, screen, ipcMain, app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import log from 'electron-log/main';

export type WindowType = 'main' | 'map' | 'traverse' | 'profile' | 'deed-plan' | '3d' | 'audit';

export interface WindowState {
  type: WindowType;
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
  monitorId: string;
}

const STATE_FILE = 'window-states.json';
const WINDOW_TITLES: Record<WindowType, string> = {
  'main': 'METARDU Desktop',
  'map': 'METARDU — Map View',
  'traverse': 'METARDU — Traverse Sheet',
  'profile': 'METARDU — Profile Viewer',
  'deed-plan': 'METARDU — Deed Plan',
  '3d': 'METARDU — 3D View',
  'audit': 'METARDU — Audit Log',
};

const WINDOW_SIZES: Record<WindowType, { width: number; height: number }> = {
  'main': { width: 1440, height: 900 },
  'map': { width: 1200, height: 800 },
  'traverse': { width: 1000, height: 700 },
  'profile': { width: 800, height: 400 },
  'deed-plan': { width: 1200, height: 800 },
  '3d': { width: 1200, height: 800 },
  'audit': { width: 800, height: 600 },
};

export class WindowManager {
  private windows: Map<WindowType, BrowserWindow> = new Map();
  private states: Map<WindowType, WindowState> = new Map();
  private statePath: string;
  private isDev: boolean;
  private viteDevServerUrl: string | undefined;

  constructor(isDev: boolean, viteDevServerUrl?: string) {
    this.isDev = isDev;
    this.viteDevServerUrl = viteDevServerUrl;
    this.statePath = path.join(app.getPath('userData'), STATE_FILE);
    this.loadStates();
  }

  private loadStates(): void {
    try {
      if (fs.existsSync(this.statePath)) {
        const data = JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
        for (const state of data) {
          this.states.set(state.type, state);
        }
        log.info(`Loaded ${this.states.size} window states`);
      }
    } catch (err) {
      log.warn('Failed to load window states:', err);
    }
  }

  private saveStates(): void {
    try {
      const data = Array.from(this.states.values());
      fs.writeFileSync(this.statePath, JSON.stringify(data, null, 2));
    } catch (err) {
      log.warn('Failed to save window states:', err);
    }
  }

  /**
   * Create or focus a window of the specified type.
   */
  createWindow(type: WindowType): BrowserWindow {
    // If window already exists, focus it
    const existing = this.windows.get(type);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return existing;
    }

    const savedState = this.states.get(type);
    const defaultSize = WINDOW_SIZES[type];

    const x = savedState?.x;
    const y = savedState?.y;
    const width = savedState?.width ?? defaultSize.width;
    const height = savedState?.height ?? defaultSize.height;

    const win = new BrowserWindow({
      title: WINDOW_TITLES[type],
      width,
      height,
      x: x !== undefined ? x : undefined,
      y: y !== undefined ? y : undefined,
      minWidth: 600,
      minHeight: 400,
      backgroundColor: type === '3d' ? '#1a1a2e' : '#f8f9fb',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    // Load the appropriate route
    const route = type === 'main' ? '' : `#/window/${type}`;
    if (this.isDev && this.viteDevServerUrl) {
      win.loadURL(`${this.viteDevServerUrl}${route}`);
    } else {
      const indexPath = path.join(__dirname, '../dist/index.html');
      if (route) {
        win.loadFile(indexPath, { hash: route.substring(1) });
      } else {
        win.loadFile(indexPath);
      }
    }

    // Track window state changes
    const updateState = () => {
      if (win.isDestroyed()) return;
      const bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds);
      this.states.set(type, {
        type,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized: win.isMaximized(),
        monitorId: display.id.toString(),
      });
      this.saveStates();
    };

    win.on('resize', updateState);
    win.on('move', updateState);
    win.on('maximize', updateState);
    win.on('unmaximize', updateState);

    win.on('closed', () => {
      this.windows.delete(type);
      this.emit('window-closed', type);
    });

    this.windows.set(type, win);
    this.emit('window-opened', type);
    log.info(`Window opened: ${type}`);

    return win;
  }

  /**
   * Close a specific window.
   */
  closeWindow(type: WindowType): void {
    const win = this.windows.get(type);
    if (win && !win.isDestroyed()) {
      win.close();
    }
  }

  /**
   * Close all windows except main.
   */
  closeAllExceptMain(): void {
    for (const [type, win] of this.windows) {
      if (type !== 'main' && !win.isDestroyed()) {
        win.close();
      }
    }
  }

  /**
   * Broadcast an event to all open windows (for synchronized selection).
   * When a point is selected on the map, all other windows get notified.
   */
  broadcast(channel: string, data: unknown): void {
    for (const [, win] of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  }

  /**
   * Send an event to a specific window.
   */
  sendToWindow(type: WindowType, channel: string, data: unknown): void {
    const win = this.windows.get(type);
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }

  getOpenWindows(): WindowType[] {
    return Array.from(this.windows.keys());
  }

  isWindowOpen(type: WindowType): boolean {
    const win = this.windows.get(type);
    return !!win && !win.isDestroyed();
  }

  private listeners: Map<string, Array<(type: WindowType) => void>> = new Map();

  on(event: string, cb: (type: WindowType) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(cb);
  }

  private emit(event: string, type: WindowType): void {
    const cbs = this.listeners.get(event);
    if (cbs) for (const cb of cbs) cb(type);
  }

  /**
   * Apply a workspace preset.
   */
  applyPreset(preset: 'field' | 'office' | 'review'): void {
    this.closeAllExceptMain();

    switch (preset) {
      case 'field':
        // Field mode: large map + minimal panels
        this.createWindow('map');
        if (this.isWindowOpen('main')) {
          this.windows.get('main')!.setSize(800, 600);
        }
        break;
      case 'office':
        // Office mode: full panels + data tables
        this.createWindow('map');
        this.createWindow('traverse');
        this.createWindow('3d');
        break;
      case 'review':
        // Review mode: deed plan + audit log
        this.createWindow('deed-plan');
        this.createWindow('audit');
        break;
    }

    log.info(`Workspace preset applied: ${preset}`);
  }
}
