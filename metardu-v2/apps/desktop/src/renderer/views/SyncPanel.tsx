/**
 * Sync Panel — Metardu Web ↔ Desktop synchronization.
 *
 * The inflow half of the product thesis: "data collected with Metardu
 * Access / Metardu Web syncs automatically to Metardu Desktop." This
 * panel lets the surveyor:
 *
 *   1. Connect to their metardu web account (server URL + credentials),
 *   2. Pull remote projects down to the desktop,
 *   3. Push the current survey (from SurveyStateContext) back up,
 *   4. Run a full sync (download + queue flush) with live status,
 *   5. Resolve version conflicts (local vs remote) manually.
 *
 * The SyncClient singleton lives in the main process; this view only
 * talks to it through the preload bridge (`window.metardu.sync.*`).
 * When running in a plain browser (no Electron), the panel degrades to
 * a "not available" state.
 *
 * Keyboard shortcut: `g u`.
 */

import React, { useState, useCallback, useEffect } from "react";
import { CloudUpload, CloudDownload, RefreshCw, LogOut, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import { useSurveyState } from "../SurveyStateContext.js";
import { projectFromStored, type SyncProjectWire } from "../sync-projects.js";

interface SyncStatus {
  state: "idle" | "syncing" | "offline" | "error";
  lastSyncAt?: string;
  pendingUploads: number;
  pendingDownloads: number;
  /** Queued delete tombstones (operation "delete" in the queue). */
  pendingDeletes: number;
  conflicts: Array<{ projectId: string; field: string; localValue: unknown; remoteValue: unknown }>;
  error?: string;
}

type SyncProject = SyncProjectWire;

interface SyncApi {
  login: (config: { serverUrl: string; email: string; password: string }) => Promise<{ ok: boolean }>;
  logout: () => Promise<{ ok: boolean }>;
  isLoggedIn: () => Promise<boolean>;
  getConnection: () => Promise<{ serverUrl: string; email: string } | null>;
  getStatus: () => Promise<SyncStatus>;
  getConflicts: () => Promise<SyncStatus["conflicts"]>;
  fetchProjects: () => Promise<SyncProject[]>;
  uploadProject: (project: SyncProject) => Promise<SyncProject>;
  queueChange: (project: SyncProject, operation: "create" | "update" | "delete") => Promise<{ ok: boolean }>;
  flushQueue: () => Promise<{ uploaded: number; deleted: number; failed: number; errors: string[] }>;
  sync: (localProjects: SyncProject[]) => Promise<{ downloaded: number; uploaded: number; deleted: number; conflicts: SyncStatus["conflicts"]; errors: string[] }>;
  resolveConflict: (projectId: string, choice: "local" | "remote") => Promise<{ ok: boolean }>;
  onStatus: (callback: (status: SyncStatus) => void) => () => void;
}

function getSyncApi(): SyncApi | null {
  const api = (window as unknown as { metardu?: { sync?: SyncApi } }).metardu?.sync;
  return api ?? null;
}

export const SyncPanel: React.FC = () => {
  const [api] = useState<SyncApi | null>(getSyncApi);
  const [busy, setBusy] = useState(false);
  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:8787");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [projects, setProjects] = useState<SyncProject[]>([]);
  const [conflicts, setConflicts] = useState<SyncStatus["conflicts"]>([]);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tracks the server's last-known version per project id so re-pushing
  // the same survey is a PUT update, not a fresh POST duplicate.
  const [savedVersions, setSavedVersions] = useState<Record<string, number>>({});

  const { state: surveyState, projects, activeProject } = useSurveyState();

  // Subscribe to live status changes pushed from the main process. The
  // logged-in flag MUST come from isLoggedIn() — getStatus() resolves
  // with an idle status even when no client exists (it never rejects),
  // so using it to derive login state would show the connected UI
  // without any authentication. Also prefill serverUrl/email from the
  // main process's last connection so reconnect is one click.
  useEffect(() => {
    if (!api) return;
    let unsubscribe: (() => void) | undefined;
    api
      .isLoggedIn()
      .then((isIn) => {
        setLoggedIn(isIn);
        return isIn ? api.getStatus() : null;
      })
      .then((s) => { if (s) setStatus(s); })
      .catch(() => { setLoggedIn(false); });
    api
      .getConnection()
      .then((conn) => {
        if (conn) {
          setServerUrl(conn.serverUrl);
          setEmail(conn.email);
        }
      })
      .catch(() => {});
    unsubscribe = api.onStatus((s) => setStatus(s));
    return () => unsubscribe?.();
  }, [api]);

  const refreshConflicts = useCallback(async () => {
    if (!api) return;
    try { setConflicts(await api.getConflicts()); } catch { /* not logged in */ }
  }, [api]);

  const handleLogin = useCallback(async () => {
    if (!api) { setError("Sync not available — run in Electron app."); return; }
    setBusy(true); setError(null); setLastResult(null);
    try {
      await api.login({ serverUrl: serverUrl.trim(), email: email.trim(), password });
      setLoggedIn(true);
      setStatus(await api.getStatus());
      setProjects(await api.fetchProjects());
      setLastResult(`Connected as ${email.trim()}.`);
    } catch (e) {
      setError((e as Error).message);
      setLoggedIn(false);
    } finally {
      setBusy(false);
    }
  }, [api, serverUrl, email, password]);

  const handleLogout = useCallback(async () => {
    if (!api) return;
    setBusy(true); setError(null);
    try {
      await api.logout();
      setLoggedIn(false); setProjects([]); setConflicts([]); setStatus(null);
      setLastResult("Disconnected.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [api]);

  const handlePull = useCallback(async () => {
    if (!api) return;
    setBusy(true); setError(null);
    try {
      const list = await api.fetchProjects();
      setProjects(list);
      setLastResult(`Pulled ${list.length} remote project${list.length === 1 ? "" : "s"}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [api]);

  const handlePushCurrent = useCallback(async () => {
    if (!api) return;
    if (!activeProject) { setError("No active project — run a workflow view first."); return; }
    setBusy(true); setError(null);
    try {
      const project = projectFromStored(activeProject, savedVersions[activeProject.id] ?? 0);
      const saved = await api.uploadProject(project);
      setSavedVersions((prev) => ({ ...prev, [project.id]: saved.version }));
      setLastResult(`Pushed "${saved.name}" (v${saved.version}).`);
      setProjects(await api.fetchProjects());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [api, activeProject, savedVersions]);

  const handleSyncAll = useCallback(async () => {
    if (!api) return;
    setBusy(true); setError(null);
    try {
      // Reconcile ALL stored projects, not just the active survey.
      const local = projects.map((p) => projectFromStored(p, savedVersions[p.id] ?? 0));
      const result = await api.sync(local);
      setConflicts(result.conflicts);
      setProjects(await api.fetchProjects());
      setLastResult(
        `Sync complete — ${result.downloaded} downloaded, ${result.uploaded} uploaded, ` +
        `${result.deleted} deleted, ` +
        `${result.conflicts.length} conflict${result.conflicts.length === 1 ? "" : "s"}${result.errors.length ? `, ${result.errors.length} error(s)` : ""}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [api, projects, savedVersions]);

  const handleResolve = useCallback(async (projectId: string, choice: "local" | "remote") => {
    if (!api) return;
    setBusy(true); setError(null);
    try {
      // "Keep local" genuinely re-pushes the active project's local
      // version to the server (queue + flush) before clearing the
      // conflict — the engine's resolveConflict only dismisses it, so
      // the actual data reconciliation happens here. If the push fails,
      // we surface the error and leave the conflict listed (no false
      // "resolved" claim).
      if (choice === "local" && activeProject && activeProject.id === projectId) {
        const project = projectFromStored(activeProject, savedVersions[projectId] ?? 0);
        await api.queueChange(project, "update");
        const flush = await api.flushQueue();
        if (flush.failed > 0) {
          setError(`Failed to push local version: ${flush.errors.join("; ") || "unknown error"}`);
          setLastResult(null);
          return;
        }
        setSavedVersions((prev) => ({ ...prev, [projectId]: project.version + 1 }));
      }
      await api.resolveConflict(projectId, choice);
      await refreshConflicts();
      setLastResult(`Resolved ${projectId} → ${choice}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [api, surveyState, savedVersions, refreshConflicts]);

  if (!api) {
    return (
      <div style={{ padding: "24px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)" }}>Sync with Metardu Web</h2>
        <p style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: "8px" }}>
          Sync not available — running in browser mode. Launch the Electron app to connect to your metardu web account.
        </p>
      </div>
    );
  }

  const statusColor = status?.state === "error" ? "var(--text-error)"
    : status?.state === "syncing" ? "var(--accent-primary)"
    : status?.state === "offline" ? "var(--text-warning)"
    : "var(--text-success)";

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
          Sync with Metardu Web
        </h2>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Field data collected with Metardu Access / Metardu Web flows into Desktop automatically.
          Queue-based sync keeps local changes even when offline.
        </p>
      </div>

      {/* Connection status */}
      {status && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontFamily: "var(--font-mono)" }}>
          <span style={{ color: statusColor }}>●</span>
          <span style={{ color: "var(--text-secondary)" }}>state: {status.state}</span>
          <span style={{ color: "var(--text-tertiary)" }}>
            {status.pendingUploads > 0 ? ` · ${status.pendingUploads} pending upload` : ""}
            {status.pendingDeletes > 0 ? (
              <span style={{ color: "var(--text-warning)" }}> · {status.pendingDeletes} deletion{status.pendingDeletes === 1 ? "" : "s"} queued</span>
            ) : ""}
            {status.lastSyncAt ? ` · last sync ${new Date(status.lastSyncAt).toLocaleTimeString()}` : ""}
          </span>
        </div>
      )}

      {!loggedIn ? (
        /* ─── Login form ─────────────────────────────────────────── */
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: 480 }}>
          <label style={labelStyle}>Server URL</label>
          <input
            style={inputStyle}
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://127.0.0.1:8787"
            spellCheck={false}
          />
          <label style={labelStyle}>Email</label>
          <input
            style={inputStyle}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="surveyor@metardu.space"
            spellCheck={false}
          />
          <label style={labelStyle}>Password</label>
          <input
            style={inputStyle}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          <button
            onClick={handleLogin}
            disabled={busy || !serverUrl.trim() || !email.trim() || !password}
            style={primaryButton(busy)}
          >
            <CloudUpload size={16} strokeWidth={2} />
            {busy ? "Connecting…" : "Connect to Metardu Web"}
          </button>
          <p style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
            Tip: run <span style={{ fontFamily: "var(--font-mono)" }}>node scripts/mock-sync-server.mjs</span> for a local test server.
          </p>
        </div>
      ) : (
        /* ─── Connected view ─────────────────────────────────────── */
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button onClick={handlePull} disabled={busy} style={secondaryButton(busy)}>
              <CloudDownload size={16} strokeWidth={2} /> Pull projects
            </button>
            <button onClick={handlePushCurrent} disabled={busy || !surveyState} style={secondaryButton(busy)}>
              <CloudUpload size={16} strokeWidth={2} /> Push current survey
            </button>
            <button onClick={handleSyncAll} disabled={busy} style={primaryButton(busy)}>
              {busy ? <Loader2 size={16} strokeWidth={2} /> : <RefreshCw size={16} strokeWidth={2} />}
              Sync now
            </button>
            <button onClick={handleLogout} disabled={busy} style={ghostButton(busy)}>
              <LogOut size={16} strokeWidth={2} /> Disconnect
            </button>
          </div>

          {!surveyState && (
            <p style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
              No survey computed yet — run a workflow view (Topographic, Engineering, Setting-Out, Sectional) to enable "Push current survey".
            </p>
          )}

          {/* Conflicts */}
          {conflicts.length > 0 && (
            <div style={{ border: "1px solid var(--border-warning)", borderRadius: "8px", padding: "12px 14px", background: "var(--bg-warning)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <AlertTriangle size={14} strokeWidth={2} color="var(--text-warning)" />
                <strong style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                  {conflicts.length} sync conflict{conflicts.length === 1 ? "" : "s"}
                </strong>
              </div>
              {conflicts.map((c) => {
                // "Keep local" can only genuinely reconcile the active
                // project — for other conflicts it's disabled rather
                // than silently dismissing (honest UI).
                const isCurrent = activeProject !== null && activeProject.id === c.projectId;
                return (
                  <div key={c.projectId} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "6px 0", borderTop: "1px solid var(--border-subtle)" }}>
                    <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--text-secondary)", flex: 1 }}>
                      {c.projectId} · {c.field}: local <strong>{String(c.localValue)}</strong> vs remote <strong>{String(c.remoteValue)}</strong>
                    </span>
                    {/* Span wrapper carries the tooltip — disabled buttons
                        don't fire pointer events, so the title wouldn't show. */}
                    <span
                      title={isCurrent ? "Push the current survey's version and dismiss" : "Only the current survey's local data can be pushed"}
                      style={{ display: "inline-flex" }}
                    >
                      <button
                        onClick={() => handleResolve(c.projectId, "local")}
                        disabled={busy || !isCurrent}
                        style={{ ...tinyButton(busy), opacity: !isCurrent ? 0.45 : undefined, cursor: !isCurrent ? "not-allowed" : undefined }}
                      >
                        Keep local
                      </button>
                    </span>
                    <button onClick={() => handleResolve(c.projectId, "remote")} disabled={busy} style={tinyButton(busy)}>Keep remote</button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Remote projects */}
          <div>
            <label style={labelStyle}>Remote projects ({projects.length})</label>
            {projects.length === 0 ? (
              <p style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>No remote projects. Click "Pull projects" or push the current survey.</p>
            ) : (
              <div style={{ border: "1px solid var(--border-default)", borderRadius: "8px", overflow: "auto", maxHeight: "320px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", fontFamily: "var(--font-mono)" }}>
                  <thead style={{ position: "sticky", top: 0, background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-default)" }}>
                    <tr>
                      <th style={th}>Name</th>
                      <th style={th}>Country</th>
                      <th style={th}>Type</th>
                      <th style={th}>Ver</th>
                      <th style={th}>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr key={p.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ ...td, fontWeight: 500 }}>{p.name}</td>
                        <td style={td}>{p.countryCode}</td>
                        <td style={td}>{p.surveyType}</td>
                        <td style={td}>v{p.version}</td>
                        <td style={td}>{new Date(p.updatedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {lastResult && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-success)" }}>
              <CheckCircle size={14} strokeWidth={2} /> {lastResult}
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ padding: "12px 14px", borderRadius: "8px", background: "var(--bg-error)", border: "1px solid var(--border-error)", fontSize: "12px", color: "var(--text-error)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  color: "var(--text-tertiary)",
  marginBottom: "4px",
  fontFamily: "var(--font-mono)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid var(--border-default)",
  background: "var(--bg-secondary)",
  color: "var(--text-primary)",
  fontSize: "13px",
  fontFamily: "var(--font-mono)",
  outline: "none",
};

const primaryButton = (busy: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: "8px",
  padding: "10px 18px", borderRadius: "8px",
  border: "1px solid var(--accent-primary)",
  background: busy ? "var(--bg-hover)" : "var(--accent-primary)",
  color: busy ? "var(--text-tertiary)" : "#fff",
  fontSize: "13px", fontWeight: 500, cursor: busy ? "not-allowed" : "pointer",
  opacity: busy ? 0.6 : 1,
});

const secondaryButton = (busy: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: "8px",
  padding: "10px 14px", borderRadius: "8px",
  border: "1px solid var(--border-default)",
  background: "var(--bg-secondary)",
  color: "var(--text-secondary)",
  fontSize: "13px", cursor: busy ? "not-allowed" : "pointer",
  opacity: busy ? 0.6 : 1,
});

const ghostButton = (busy: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: "8px",
  padding: "10px 14px", borderRadius: "8px",
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--text-tertiary)",
  fontSize: "13px", cursor: busy ? "not-allowed" : "pointer",
});

const tinyButton = (busy: boolean): React.CSSProperties => ({
  padding: "4px 10px", borderRadius: "6px",
  border: "1px solid var(--border-default)",
  background: "var(--bg-secondary)",
  color: "var(--text-secondary)",
  fontSize: "11px", cursor: busy ? "not-allowed" : "pointer",
  whiteSpace: "nowrap",
});

const th: React.CSSProperties = {
  padding: "8px 10px", textAlign: "left",
  fontSize: "11px", fontWeight: 500,
  color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em",
};

const td: React.CSSProperties = {
  padding: "6px 10px", color: "var(--text-secondary)", whiteSpace: "nowrap",
};
