/**
 * Field-to-Office Sync Service
 *
 * Connects metardu web (field) to metardu desktop (office).
 *
 * Workflow:
 *   1. Surveyor works in the field with metardu web (PWA, offline-capable)
 *   2. Web app picks up points via total station / GNSS
 *   3. When internet is available, web pushes field sessions to sync endpoint
 *   4. Surveyor returns to office, opens metardu desktop
 *   5. Desktop auto-pulls field sessions — points appear instantly
 *   6. Desktop does the heavy work (traverse, deed plan, NLIMS, machine-control)
 *
 * Sync endpoint:
 *   The sync endpoint can be:
 *   - ArdhiSasa API (if it supports field data upload)
 *   - A custom sync server (metardu-sync.go.ke)
 *   - A shared cloud storage (S3, Google Drive, Dropbox)
 *   - A local network share (for office-only sync)
 *
 * Conflict resolution:
 *   - Each field session has a unique ID + timestamp
 *   - Desktop checks for new sessions on launch and every 5 minutes
 *   - If a session already exists (by ID), skip it
 *   - All syncs are logged to the audit table
 *
 * Data format:
 *   The web app pushes a "field session" — a JSON payload containing:
 *   - Session metadata (surveyor, date, project, instrument)
 *   - All points picked up (with coordinates, codes, timestamps)
 *   - All observations (bearings, distances, angles)
 *   - Raw instrument data (for audit)
 */

import { net } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, EventEmitter } from 'electron';
import log from 'electron-log/main';

export interface SyncConfig {
  endpoint: string;        // e.g. "https://sync.metardu.go.ke/api" or "https://ardhisasa.go.ke/api/v1/sync"
  apiKey?: string;         // authentication token
  autoSync: boolean;       // sync automatically on launch + every 5 minutes
  syncInterval: number;    // milliseconds (default 300000 = 5 minutes)
  surveyorId?: string;     // identifies which surveyor's sessions to pull
  projectId?: string;      // filter by project
}

export interface FieldSession {
  sessionId: string;       // unique ID (UUID)
  surveyorId: string;
  surveyorName: string;
  surveyorLicense: string;
  projectName: string;
  projectId?: string;
  county: string;
  surveyType: string;      // 'cadastral' | 'topographic' | 'engineering'
  startDate: string;       // ISO
  endDate?: string;        // ISO
  instrument: {
    type: string;          // 'total_station' | 'gnss' | 'level'
    brand: string;         // 'topcon' | 'leica' | etc.
    model?: string;
    serialNumber?: string;
  };
  station?: {
    stationNumber: string;
    easting: number;
    northing: number;
    elevation: number;
    backsightNumber: string;
    backsightEasting: number;
    backsightNorthing: number;
    instrumentHeight: number;
  };
  points: Array<{
    pointNumber: string;
    easting: number;
    northing: number;
    elevation?: number;
    code?: string;
    description?: string;
    source: string;        // 'total_station' | 'gnss' | 'manual'
    timestamp: string;
    raw?: string;          // raw instrument data for audit
  }>;
  observations?: Array<{
    fromPoint: string;
    toPoint: string;
    distance: number;
    bearing: number;
    verticalAngle?: number;
    face?: string;
    timestamp: string;
  }>;
  crs: string;             // e.g. "EPSG:21037"
  syncStatus: 'pending' | 'synced' | 'failed';
  syncedAt?: string;
}

export interface SyncResult {
  sessionsPulled: number;
  sessionsFailed: number;
  totalPoints: number;
  sessions: Array<{
    sessionId: string;
    projectName: string;
    pointCount: number;
    surveyorName: string;
    date: string;
    status: 'pulled' | 'skipped' | 'failed';
    error?: string;
  }>;
}

export class SyncService extends EventEmitter {
  private config: SyncConfig | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private lastSyncAt: string | null = null;
  private syncedSessionIds: Set<string> = new Set();
  private cachePath: string;

  constructor() {
    super();
    this.cachePath = path.join(app.getPath('userData'), 'sync-cache.json');
    this.loadCache();
  }

  /**
   * Configure the sync service.
   */
  configure(config: SyncConfig): void {
    this.config = config;
    log.info(`Sync configured: ${config.endpoint} (auto=${config.autoSync})`);

    if (config.autoSync) {
      this.startAutoSync();
    } else {
      this.stopAutoSync();
    }
  }

  /**
   * Start automatic sync (on launch + every N minutes).
   */
  startAutoSync(): void {
    this.stopAutoSync();
    const interval = this.config?.syncInterval ?? 300000;  // 5 minutes

    // Sync immediately
    this.syncNow().catch((err) => {
      log.debug('Initial sync failed (likely offline):', err.message);
    });

    // Then sync periodically
    this.syncTimer = setInterval(async () => {
      try {
        await this.syncNow();
      } catch (err) {
        log.debug('Auto-sync failed:', (err as Error).message);
      }
    }, interval);

    log.info(`Auto-sync started (every ${interval / 1000}s)`);
  }

  /**
   * Stop automatic sync.
   */
  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Pull field sessions from the sync endpoint.
   * This is the main sync operation — called on launch and periodically.
   */
  async syncNow(): Promise<SyncResult> {
    if (!this.config) {
      throw new Error('Sync not configured. Call configure() first.');
    }

    if (!net.online) {
      log.info('Sync skipped — offline');
      return { sessionsPulled: 0, sessionsFailed: 0, totalPoints: 0, sessions: [] };
    }

    log.info(`Syncing from ${this.config.endpoint}...`);
    this.emit('sync-started');

    const result: SyncResult = {
      sessionsPulled: 0,
      sessionsFailed: 0,
      totalPoints: 0,
      sessions: [],
    };

    try {
      // Fetch available sessions from the endpoint
      const sessions = await this.fetchSessionList();

      for (const sessionMeta of sessions) {
        // Skip already-synced sessions
        if (this.syncedSessionIds.has(sessionMeta.sessionId)) {
          result.sessions.push({
            sessionId: sessionMeta.sessionId,
            projectName: sessionMeta.projectName,
            pointCount: sessionMeta.pointCount ?? 0,
            surveyorName: sessionMeta.surveyorName,
            date: sessionMeta.date,
            status: 'skipped',
          });
          continue;
        }

        try {
          // Fetch the full session data
          const session = await this.fetchSession(sessionMeta.sessionId);

          // Save to local cache
          this.saveSession(session);

          // Emit event for the renderer to pick up
          this.emit('session-pulled', session);

          result.sessionsPulled++;
          result.totalPoints += session.points.length;
          result.sessions.push({
            sessionId: session.sessionId,
            projectName: session.projectName,
            pointCount: session.points.length,
            surveyorName: session.surveyorName,
            date: session.startDate,
            status: 'pulled',
          });

          this.syncedSessionIds.add(session.sessionId);
        } catch (err) {
          result.sessionsFailed++;
          result.sessions.push({
            sessionId: sessionMeta.sessionId,
            projectName: sessionMeta.projectName,
            pointCount: 0,
            surveyorName: sessionMeta.surveyorName,
            date: sessionMeta.date,
            status: 'failed',
            error: (err as Error).message,
          });
          log.warn(`Failed to fetch session ${sessionMeta.sessionId}:`, err);
        }
      }

      this.lastSyncAt = new Date().toISOString();
      this.saveCache();

      log.info(`Sync complete: ${result.sessionsPulled} pulled, ${result.sessionsFailed} failed, ${result.totalPoints} points`);
      this.emit('sync-complete', result);
    } catch (err) {
      log.error('Sync failed:', err);
      this.emit('sync-error', (err as Error).message);
      throw err;
    }

    return result;
  }

  /**
   * Fetch the list of available field sessions from the sync endpoint.
   * GET /sessions?surveyorId=xxx&projectId=yyy&since=timestamp
   */
  private async fetchSessionList(): Promise<Array<{
    sessionId: string;
    projectName: string;
    surveyorName: string;
    date: string;
    pointCount?: number;
  }>> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.config!.endpoint}/sessions`);
      if (this.config!.surveyorId) url.searchParams.set('surveyorId', this.config!.surveyorId);
      if (this.config!.projectId) url.searchParams.set('projectId', this.config!.projectId);
      if (this.lastSyncAt) url.searchParams.set('since', this.lastSyncAt);

      const request = net.request({
        method: 'GET',
        url: url.toString(),
        redirect: 'follow',
      });

      if (this.config!.apiKey) {
        request.setHeader('Authorization', `Bearer ${this.config!.apiKey}`);
      }
      request.setHeader('Accept', 'application/json');

      let body = '';
      const timeout = setTimeout(() => {
        request.abort();
        reject(new Error('Session list request timed out'));
      }, 15000);

      request.on('response', (response) => {
        response.on('data', (chunk) => { body += chunk.toString(); });
        response.on('end', () => {
          clearTimeout(timeout);
          if (response.statusCode === 200) {
            try {
              const data = JSON.parse(body);
              resolve(data.sessions ?? data ?? []);
            } catch (err) {
              reject(new Error(`Failed to parse session list: ${err}`));
            }
          } else {
            reject(new Error(`Session list returned ${response.statusCode}`));
          }
        });
      });

      request.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      request.end();
    });
  }

  /**
   * Fetch a single field session by ID.
   * GET /sessions/:id
   */
  private async fetchSession(sessionId: string): Promise<FieldSession> {
    return new Promise((resolve, reject) => {
      const url = `${this.config!.endpoint}/sessions/${encodeURIComponent(sessionId)}`;
      const request = net.request({ method: 'GET', url, redirect: 'follow' });

      if (this.config!.apiKey) {
        request.setHeader('Authorization', `Bearer ${this.config!.apiKey}`);
      }
      request.setHeader('Accept', 'application/json');

      let body = '';
      const timeout = setTimeout(() => {
        request.abort();
        reject(new Error('Session fetch timed out'));
      }, 30000);

      request.on('response', (response) => {
        response.on('data', (chunk) => { body += chunk.toString(); });
        response.on('end', () => {
          clearTimeout(timeout);
          if (response.statusCode === 200) {
            try {
              const session = JSON.parse(body) as FieldSession;
              session.syncStatus = 'synced';
              session.syncedAt = new Date().toISOString();
              resolve(session);
            } catch (err) {
              reject(new Error(`Failed to parse session: ${err}`));
            }
          } else {
            reject(new Error(`Session fetch returned ${response.statusCode}`));
          }
        });
      });

      request.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      request.end();
    });
  }

  /**
   * Push a field session FROM desktop to the sync endpoint.
   * This is used when the surveyor works on desktop and wants to sync back to web.
   * POST /sessions
   */
  async pushSession(session: FieldSession): Promise<{ pushed: boolean }> {
    if (!this.config) throw new Error('Sync not configured');
    if (!net.online) throw new Error('Offline — cannot push session');

    return new Promise((resolve, reject) => {
      const url = `${this.config!.endpoint}/sessions`;
      const body = JSON.stringify(session);
      const request = net.request({
        method: 'POST',
        url,
        redirect: 'follow',
      });

      if (this.config!.apiKey) {
        request.setHeader('Authorization', `Bearer ${this.config!.apiKey}`);
      }
      request.setHeader('Content-Type', 'application/json');
      request.setHeader('Content-Length', Buffer.byteLength(body).toString());

      const timeout = setTimeout(() => {
        request.abort();
        reject(new Error('Push session timed out'));
      }, 30000);

      request.on('response', (response) => {
        response.on('end', () => {
          clearTimeout(timeout);
          if (response.statusCode === 200 || response.statusCode === 201) {
            log.info(`Session pushed: ${session.sessionId}`);
            this.emit('session-pushed', session);
            resolve({ pushed: true });
          } else {
            reject(new Error(`Push returned ${response.statusCode}`));
          }
        });
      });

      request.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      request.write(body);
      request.end();
    });
  }

  /**
   * Import a field session from a file (manual sync — no internet needed).
   * The web app can export a .field-session JSON file, and the desktop
   * app imports it. This is the offline fallback.
   */
  importSessionFromFile(filePath: string): FieldSession {
    const content = fs.readFileSync(filePath, 'utf-8');
    const session = JSON.parse(content) as FieldSession;
    session.syncStatus = 'synced';
    session.syncedAt = new Date().toISOString();
    this.saveSession(session);
    this.syncedSessionIds.add(session.sessionId);
    this.emit('session-pulled', session);
    log.info(`Session imported from file: ${filePath} (${session.points.length} points)`);
    return session;
  }

  /**
   * Export a field session to a file (for manual sync to web or backup).
   */
  exportSessionToFile(session: FieldSession, filePath: string): void {
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
    log.info(`Session exported to file: ${filePath}`);
  }

  /**
   * Get all synced sessions from the local cache.
   */
  getSyncedSessions(): FieldSession[] {
    const cacheDir = path.join(app.getPath('userData'), 'field-sessions');
    if (!fs.existsSync(cacheDir)) return [];
    const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf-8')) as FieldSession;
      } catch {
        return null;
      }
    }).filter((s): s is FieldSession => s !== null);
  }

  /**
   * Get a specific synced session by ID.
   */
  getSession(sessionId: string): FieldSession | null {
    const cacheDir = path.join(app.getPath('userData'), 'field-sessions');
    const filePath = path.join(cacheDir, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as FieldSession;
  }

  /**
   * Save a session to the local cache.
   */
  private saveSession(session: FieldSession): void {
    const cacheDir = path.join(app.getPath('userData'), 'field-sessions');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const filePath = path.join(cacheDir, `${session.sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
  }

  private loadCache(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        const data = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
        this.syncedSessionIds = new Set(data.syncedSessionIds ?? []);
        this.lastSyncAt = data.lastSyncAt ?? null;
        log.info(`Sync cache loaded: ${this.syncedSessionIds.size} sessions already synced`);
      }
    } catch (err) {
      log.warn('Failed to load sync cache:', err);
    }
  }

  private saveCache(): void {
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify({
        syncedSessionIds: Array.from(this.syncedSessionIds),
        lastSyncAt: this.lastSyncAt,
      }, null, 2));
    } catch (err) {
      log.warn('Failed to save sync cache:', err);
    }
  }

  get isConfigured(): boolean {
    return this.config !== null;
  }

  get lastSync(): string | null {
    return this.lastSyncAt;
  }

  get isOnline(): boolean {
    return net.online;
  }
}
