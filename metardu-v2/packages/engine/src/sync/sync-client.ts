/**
 * Sync client — synchronizes projects between MetaRDU Desktop and the
 * MetaRDU web app.
 *
 * Architecture:
 *   Desktop (local) ←→ SyncClient ←→ REST API ←→ Web App (server)
 *
 * Queue-based: local changes are queued, flushed when online.
 * Conflicts: last-write-wins or manual override.
 */

// ─── Types ───────────────────────────────────────────────────────

export interface SyncConfig {
  serverUrl: string;
  email: string;
  password: string;
  syncIntervalMs?: number;
  conflictStrategy?: "last_write_wins" | "manual";
}

export interface SyncProject {
  id: string;
  name: string;
  description?: string;
  countryCode: string;
  surveyType: string;
  updatedAt: string;
  version: number;
  data: Record<string, unknown>;
}

export interface SyncQueueItem {
  id: string;
  projectId: string;
  operation: "create" | "update" | "delete";
  data?: SyncProject;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface SyncConflict {
  projectId: string;
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
}

export interface SyncStatus {
  state: "idle" | "syncing" | "offline" | "error";
  lastSyncAt?: string;
  pendingUploads: number;
  pendingDownloads: number;
  conflicts: SyncConflict[];
  error?: string;
}

// ─── Sync client ─────────────────────────────────────────────────

export class SyncClient {
  private config: Required<SyncConfig>;
  private token: string | null = null;
  private queue: SyncQueueItem[] = [];
  private conflicts: SyncConflict[] = [];
  private status: SyncStatus = { state: "idle", pendingUploads: 0, pendingDownloads: 0, conflicts: [] };

  constructor(config: SyncConfig) {
    this.config = { syncIntervalMs: 60_000, conflictStrategy: "last_write_wins", ...config };
  }

  async login(): Promise<void> {
    try {
      const response = await fetch(`${this.config.serverUrl}/api/auth/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: this.config.email, password: this.config.password }),
      });
      if (!response.ok) throw new Error(`Login failed: ${response.status}`);
      const data = await response.json() as { token?: string; session?: { access_token?: string } };
      this.token = data.token ?? data.session?.access_token ?? null;
      if (!this.token) throw new Error("No token returned");
      this.setStatus({ state: "idle", error: undefined });
    } catch (err) {
      this.setStatus({ state: "error", error: (err as Error).message });
      throw err;
    }
  }

  isLoggedIn(): boolean { return this.token !== null; }

  async fetchProjects(): Promise<SyncProject[]> {
    if (!this.token) throw new Error("Not logged in");
    const r = await fetch(`${this.config.serverUrl}/api/projects`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
    const data = await r.json(); return data as SyncProject[];
  }

  async uploadProject(project: SyncProject): Promise<SyncProject> {
    if (!this.token) throw new Error("Not logged in");
    const method = project.version > 0 ? "PUT" : "POST";
    const url = method === "PUT" ? `${this.config.serverUrl}/api/projects/${project.id}` : `${this.config.serverUrl}/api/projects`;
    const r = await fetch(url, {
      method, headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...project, version: project.version + 1 }),
    });
    if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
    const data = await r.json(); return data as SyncProject;
  }

  async deleteProject(id: string): Promise<void> {
    if (!this.token) throw new Error("Not logged in");
    const r = await fetch(`${this.config.serverUrl}/api/projects/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${this.token}` } });
    if (!r.ok) throw new Error(`Delete failed: ${r.status}`);
  }

  queueChange(project: SyncProject, operation: "create" | "update" | "delete"): void {
    this.queue.push({ id: crypto.randomUUID(), projectId: project.id, operation, data: operation === "delete" ? undefined : project, queuedAt: new Date().toISOString(), attempts: 0 });
    this.setStatus({ pendingUploads: this.queue.length });
  }

  async flushQueue(): Promise<{ uploaded: number; failed: number; errors: string[] }> {
    if (!this.token) throw new Error("Not logged in");
    let uploaded = 0, failed = 0; const errors: string[] = []; const remaining: SyncQueueItem[] = [];
    for (const item of this.queue) {
      try {
        if (item.operation === "delete") await this.deleteProject(item.projectId);
        else if (item.data) await this.uploadProject(item.data);
        uploaded++;
      } catch (err) {
        failed++; item.attempts++; item.lastError = (err as Error).message; errors.push(`${item.projectId}: ${item.lastError}`);
        if (item.attempts < 5) remaining.push(item);
      }
    }
    this.queue = remaining;
    this.setStatus({ pendingUploads: this.queue.length });
    return { uploaded, failed, errors };
  }

  async sync(localProjects: SyncProject[]): Promise<{ downloaded: number; uploaded: number; conflicts: SyncConflict[]; errors: string[] }> {
    if (!this.token) throw new Error("Not logged in");
    this.setStatus({ state: "syncing" });
    try {
      const remote = await this.fetchProjects();
      let downloaded = 0; this.conflicts = [];
      const localMap = new Map(localProjects.map((p) => [p.id, p]));
      for (const rp of remote) {
        const lp = localMap.get(rp.id);
        if (!lp) { downloaded++; continue; }
        if (lp.version !== rp.version && lp.updatedAt > rp.updatedAt) {
          this.conflicts.push({ projectId: rp.id, field: "version", localValue: lp.version, remoteValue: rp.version, localUpdatedAt: lp.updatedAt, remoteUpdatedAt: rp.updatedAt });
        }
      }
      const flush = await this.flushQueue();
      if (this.config.conflictStrategy === "last_write_wins") this.conflicts = [];
      this.setStatus({ state: "idle", lastSyncAt: new Date().toISOString(), conflicts: this.conflicts });
      return { downloaded, uploaded: flush.uploaded, conflicts: this.conflicts, errors: flush.errors };
    } catch (err) {
      this.setStatus({ state: "error", error: (err as Error).message });
      throw err;
    }
  }

  getStatus(): SyncStatus { return { ...this.status }; }
  getConflicts(): SyncConflict[] { return [...this.conflicts]; }
  resolveConflict(projectId: string, _choice: "local" | "remote"): void {
    this.conflicts = this.conflicts.filter((c) => c.projectId !== projectId);
    this.setStatus({ conflicts: this.conflicts });
  }
  logout(): void { this.token = null; this.setStatus({ state: "idle" }); }
  private setStatus(s: Partial<SyncStatus>): void { this.status = { ...this.status, ...s }; }
}
