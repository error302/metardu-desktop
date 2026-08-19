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
  /** Queued delete tombstones (operation "delete" in the queue). Shown
   *  distinctly in the shell badge so users see a local delete waiting
   *  to flush to the server. */
  pendingDeletes: number;
  conflicts: SyncConflict[];
  error?: string;
}

/**
 * Serializable snapshot of the offline-first state — the queued changes
 * (create/update/delete) and the set of project ids known to exist on the
 * server. Persisted to disk by the desktop main process so queued
 * tombstones and changes survive app restarts. `email` namespaces the
 * snapshot: it is only restored when the same account logs back in, so a
 * crash-then-different-account login can never flush one user's changes
 * to another user's server. The auth token is intentionally NOT included
 * — it lives in memory only.
 */
export interface SyncSnapshot {
  email: string;
  queue: SyncQueueItem[];
  remoteIds: string[];
}

// ─── Sync client ─────────────────────────────────────────────────

export class SyncClient {
  private config: Required<SyncConfig>;
  private token: string | null = null;
  private queue: SyncQueueItem[] = [];
  private conflicts: SyncConflict[] = [];
  private status: SyncStatus = { state: "idle", pendingUploads: 0, pendingDownloads: 0, pendingDeletes: 0, conflicts: [] };
  // Project ids known to exist on the server. Populated by fetchProjects
  // and uploadProject, cleared by deleteProject. queueDelete only
  // tombstones ids in this set — never-pushed projects are skipped so
  // flushQueue never spins on 404s against a real backend.
  private remoteIds: Set<string> = new Set();

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
    const data = await r.json() as SyncProject[];
    this.remoteIds = new Set(data.map((p) => p.id));
    return data;
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
    const data = await r.json() as SyncProject;
    this.remoteIds.add(data.id);
    return data;
  }

  async deleteProject(id: string): Promise<void> {
    if (!this.token) throw new Error("Not logged in");
    const r = await fetch(`${this.config.serverUrl}/api/projects/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${this.token}` } });
    // Idempotent delete: a 404 means the remote copy is already gone,
    // which is exactly what a tombstone wants — treat it as success so
    // flushing a forced (offline) tombstone for a never-pushed project
    // doesn't spin in the retry loop.
    if (r.status === 404) { this.remoteIds.delete(id); return; }
    if (!r.ok) throw new Error(`Delete failed: ${r.status}`);
    this.remoteIds.delete(id);
  }

  /**
   * Queue an offline-first tombstone for a remote project. By default
   * only projects known to exist on the server (seen via fetch or upload)
   * are queued — deleting a never-pushed local project is a no-op, so
   * flushQueue never spins on pointless requests against a real backend.
   * Pass `force = true` to queue anyway when the client cannot verify
   * (e.g. offline) — the idempotent delete above makes a wrong guess
   * harmless.
   * @returns true if the delete was queued, false if it wasn't (and no
   *          force was given and the project isn't known remotely).
   */
  queueDelete(projectId: string, force = false): boolean {
    if (!force && !this.remoteIds.has(projectId)) return false;
    this.enqueue(projectId, "delete");
    return true;
  }

  queueChange(project: SyncProject, operation: "create" | "update" | "delete"): void {
    this.enqueue(project.id, operation, operation === "delete" ? undefined : project);
  }

  private enqueue(projectId: string, operation: SyncQueueItem["operation"], data?: SyncProject): void {
    this.queue.push({ id: crypto.randomUUID(), projectId, operation, data, queuedAt: new Date().toISOString(), attempts: 0 });
    this.setStatus({ pendingUploads: this.countPendingUploads(), pendingDeletes: this.countPendingDeletes() });
  }

  // pendingUploads counts only create/update items — a queued delete is a
  // tombstone, not an upload, so it's reported separately as
  // pendingDeletes. This keeps the shell badge's two indicators distinct:
  // `idle (0) · 1 del` instead of double-counting in the parenthetical.
  private countPendingUploads(): number {
    return this.queue.filter((i) => i.operation !== "delete").length;
  }

  private countPendingDeletes(): number {
    return this.queue.filter((i) => i.operation === "delete").length;
  }

  async flushQueue(): Promise<{ uploaded: number; deleted: number; failed: number; errors: string[] }> {
    if (!this.token) throw new Error("Not logged in");
    let uploaded = 0, deleted = 0, failed = 0; const errors: string[] = []; const remaining: SyncQueueItem[] = [];
    for (const item of this.queue) {
      try {
        if (item.operation === "delete") { await this.deleteProject(item.projectId); deleted++; }
        else if (item.data) { await this.uploadProject(item.data); uploaded++; }
      } catch (err) {
        failed++; item.attempts++; item.lastError = (err as Error).message; errors.push(`${item.projectId}: ${item.lastError}`);
        if (item.attempts < 5) remaining.push(item);
      }
    }
    this.queue = remaining;
    this.setStatus({ pendingUploads: this.countPendingUploads(), pendingDeletes: this.countPendingDeletes() });
    // A flushed tombstone is a deletion, not an upload — counted
    // separately so the UI never describes a deleted project as uploaded.
    return { uploaded, deleted, failed, errors };
  }

  async sync(localProjects: SyncProject[]): Promise<{ downloaded: number; uploaded: number; deleted: number; conflicts: SyncConflict[]; errors: string[] }> {
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
      return { downloaded, uploaded: flush.uploaded, deleted: flush.deleted, conflicts: this.conflicts, errors: flush.errors };
    } catch (err) {
      this.setStatus({ state: "error", error: (err as Error).message });
      throw err;
    }
  }

  /**
   * Serialize the offline-first state for disk persistence. The auth
   * token is deliberately excluded (memory only).
   */
  getSnapshot(): SyncSnapshot {
    return {
      email: this.config.email,
      queue: this.queue.map((i) => ({ ...i })),
      remoteIds: [...this.remoteIds],
    };
  }

  /**
   * Restore state previously captured by getSnapshot (e.g. after an app
   * restart, once the same account logs back in). The queue and remote
   * knowledge are replaced and the status counts recomputed so the shell
   * badge reflects restored tombstones immediately.
   * @returns false if the snapshot belongs to a different account — the
   *          caller should discard it rather than restore.
   */
  restoreSnapshot(snapshot: SyncSnapshot): boolean {
    // Case-insensitive email match: a user typing their address with
    // different casing across sessions shouldn't have their queued
    // changes discarded as a "different account".
    if (snapshot.email.toLowerCase() !== this.config.email.toLowerCase()) return false;
    this.queue = snapshot.queue.map((i) => ({ ...i }));
    this.remoteIds = new Set(snapshot.remoteIds);
    this.setStatus({ pendingUploads: this.countPendingUploads(), pendingDeletes: this.countPendingDeletes() });
    return true;
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
