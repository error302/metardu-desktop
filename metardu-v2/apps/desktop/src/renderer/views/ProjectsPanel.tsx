/**
 * Projects Panel — manage the persisted local project store.
 *
 * The local half of the sync loop: every project here is a real,
 * disk-persisted object (ProjectStore, metardu:projects:*) that workflow
 * views save into, the ExportPanel exports from, and the SyncPanel
 * reconciles against metardu web. This panel gives the surveyor the
 * workspace-level controls that were missing:
 *
 *   1. Create a named project (auto-becomes active — subsequent workflow
 *      runs save into it),
 *   2. Switch which project is active,
 *   3. Rename a project (inline edit),
 *   4. Delete a project (two-click armed confirm; the active project
 *      moves to the most recent remaining).
 *
 * All state flows through SurveyStateContext, which mirrors the
 * main-process store over IPC and subscribes to live `onChanged`
 * broadcasts. In a plain browser (no Electron), the panel degrades to a
 * "not available" notice.
 *
 * Keyboard shortcut: `g p`.
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Plus, FolderOpen, Folder, Pencil, Trash2, Check, X, Loader2, Star, FolderArchive, Sparkles, ChevronRight, Eye, EyeOff } from "lucide-react";
import { useSurveyState } from "../SurveyStateContext.js";
import { PROJECT_TEMPLATES, getTemplateById, type ProjectTemplate } from "../project-templates.js";

// The supported-country list drives the create form's country picker.
// Source of truth remains @metardu/country-config; this is the subset
// surfaced in the Projects panel UI.
const COUNTRIES: Array<{ code: string; label: string }> = [
  { code: "KE", label: "Kenya" },
  { code: "AU", label: "Australia" },
  { code: "AE", label: "United Arab Emirates" },
  { code: "ZA", label: "South Africa" },
  { code: "GB", label: "United Kingdom" },
  { code: "DE", label: "Germany" },
  { code: "US", label: "United States" },
];

const SURVEY_TYPES = [
  "cadastral",
  "topographic",
  "engineering",
  "sectional",
  "setting-out",
  "utility-mapping",
  "surface-comparison",
];

function getProjectsApi(): unknown {
  return (window as unknown as { metardu?: { projects?: unknown } }).metardu?.projects;
}

export const ProjectsPanel: React.FC = () => {
  const {
    projects,
    activeProject,
    setActiveProject,
    createProject,
    updateProject,
    deleteProject,
  } = useSurveyState();

  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("KE");
  const [surveyType, setSurveyType] = useState("cadastral");
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null);
  const [showTemplateInfo, setShowTemplateInfo] = useState<string | null>(null);
  // Inline rename state: which project is being renamed + the draft value.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Two-click delete: first click arms, second click deletes.
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const armTimer = useRef<number | null>(null);
  // Multi-select for batch scheme-booklet export: ids of selected projects.
  // Only projects with survey output can be selected (a plan needs geometry).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [schemeExporting, setSchemeExporting] = useState(false);
  const [schemeResult, setSchemeResult] = useState<string | null>(null);
  const [schemeError, setSchemeError] = useState<string | null>(null);
  // Rename double-commit guard: blur fires after Enter/click commit, and
  // blur fires again on unmount — this ref stops the second write. Reset
  // in startRename, latched on commit/cancel.
  const committingRef = useRef(false);

  const electronMode = getProjectsApi() !== undefined;

  // Reset the armed-delete state after 2.5s so a stray second click
  // can't delete by accident.
  useEffect(() => {
    if (armedDeleteId !== null && armTimer.current === null) {
      armTimer.current = window.setTimeout(() => {
        setArmedDeleteId(null);
        armTimer.current = null;
      }, 2500);
    }
    return () => {
      if (armTimer.current !== null) {
        window.clearTimeout(armTimer.current);
        armTimer.current = null;
      }
    };
  }, [armedDeleteId]);

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Project name is required."); return; }
    setBusy(true); setError(null); setLastResult(null);
    try {
      const templateNote = selectedTemplate ? ` (template: ${selectedTemplate.name})` : "";
      await createProject({ name: trimmed, countryCode: country, surveyType });
      setLastResult(`Created "${trimmed}"${templateNote} — now active.`);
      setName("");
      setSelectedTemplate(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [name, country, surveyType, createProject, selectedTemplate]);

  const handleSetActive = useCallback(async (id: string) => {
    setBusy(true); setError(null);
    try {
      await setActiveProject(id);
      setLastResult("Active project switched.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [setActiveProject]);

  const startRename = useCallback((id: string, currentName: string) => {
    setEditingId(id);
    setDraft(currentName);
    committingRef.current = false;
  }, []);

  const commitRename = useCallback(async () => {
    if (editingId === null || committingRef.current) return;
    committingRef.current = true;
    const trimmed = draft.trim();
    if (trimmed) {
      setBusy(true); setError(null);
      try {
        await updateProject(editingId, { name: trimmed });
        setLastResult(`Renamed to "${trimmed}".`);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }
    setEditingId(null);
  }, [editingId, draft, updateProject]);

  const cancelRename = useCallback(() => {
    committingRef.current = true;
    setEditingId(null);
  }, []);

  // Prune stale selections when a project is deleted or the list changes.
  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(projects.map((p) => p.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [projects]);

  const hasOutput = (p: { output?: unknown }): boolean => p.output !== null && p.output !== undefined;
  const selectable = projects.filter(hasOutput);
  const allSelected = selectable.length > 0 && selectable.every((p) => selectedIds.has(p.id));

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) selectable.forEach((p) => next.delete(p.id));
      else selectable.forEach((p) => next.add(p.id));
      return next;
    });
  }, [allSelected, selectable]);

  // Batch export: one 300 DPI plan per parcel across the selected projects,
  // compiled into a booklet PDF with a master index grouped by project.
  const exportSchemeBooklet = useCallback(async () => {
    const selected = projects.filter((p) => selectedIds.has(p.id) && hasOutput(p));
    if (selected.length === 0) {
      setSchemeError("Select at least one project with survey output.");
      return;
    }
    setSchemeExporting(true);
    setSchemeResult(null);
    setSchemeError(null);
    try {
      const w = window as unknown as {
        metardu?: { map?: { exportProjectsBooklet?: (input: {
          projects: Array<{ name: string; countryCode?: string; surveyOutput: unknown }>;
          date?: string;
        }) => Promise<{ canceled: true } | { canceled: false; bookletPath: string; pageCount: number; pngFiles: Array<{ label: string; path: string; bytes: number }>; reportFiles: Array<{ label: string; path: string; bytes: number }> }> } };
      };
      const api = w.metardu?.map?.exportProjectsBooklet;
      if (!api) {
        setSchemeError("Scheme booklet export not available — run in the Electron app.");
        return;
      }
      const result = await api({
        projects: selected.map((p) => ({
          name: p.name,
          countryCode: p.countryCode,
          surveyOutput: p.output,
        })),
        date: new Date().toISOString().split("T")[0],
      });
      if (result.canceled) {
        setSchemeResult("Export cancelled.");
      } else {
        setSchemeResult(
          `Scheme booklet (${result.pageCount} pages, master index) → ${result.bookletPath}. ` +
          `${result.reportFiles.length} per-sheet statutory reports + ${result.pngFiles.length} 300 DPI PNGs written beside it.`,
        );
      }
    } catch (e) {
      setSchemeError((e as Error).message);
    } finally {
      setSchemeExporting(false);
    }
  }, [projects, selectedIds]);

  const handleDelete = useCallback(async (id: string) => {
    if (armedDeleteId !== id) {
      // Arming a different row resets the previous arm window so the
      // new row gets a full 2.5s to confirm.
      if (armTimer.current !== null) {
        window.clearTimeout(armTimer.current);
        armTimer.current = null;
      }
      setArmedDeleteId(id);
      return;
    }
    setArmedDeleteId(null);
    setBusy(true); setError(null);
    try {
      await deleteProject(id);
      // Offline-first tombstone: if this project exists on the metardu
      // web server (the SyncClient has seen it via fetch/upload), queue
      // its remote delete so it flushes on the next sync — preventing
      // orphaned remote projects. Never-pushed projects are skipped
      // (queued: false) with an honest note.
      let syncNote = "";
      const syncApi = (window as unknown as {
        metardu?: { sync?: { queueDelete?: (projectId: string) => Promise<{ ok: boolean; queued: boolean; reason?: string }> } };
      }).metardu?.sync;
      if (syncApi?.queueDelete) {
        try {
          const res = await syncApi.queueDelete(id);
          if (res.queued) {
            syncNote = res.reason === "offline"
              ? " Remote deletion queued — will sync when back online."
              : " Remote copy queued for deletion.";
          }
          // res.queued === false with reason "not-seen"/"not-logged-in"
          // → nothing to tombstone; plain "Project deleted." is honest.
        } catch {
          // Sync client unavailable — the local delete stands, but the
          // remote copy may now be orphaned; say so honestly instead of
          // silently dropping the tombstone.
          syncNote = " Remote deletion could not be queued (sync unavailable).";
        }
      }
      setLastResult("Project deleted." + syncNote);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [armedDeleteId, deleteProject]);

  if (!electronMode) {
    return (
      <div style={{ padding: "24px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)" }}>Projects</h2>
        <p style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: "8px" }}>
          Project store not available — running in browser mode. Launch the Electron app to create and manage projects.
        </p>
      </div>
    );
  }

  const activeId = activeProject?.id ?? null;

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
          Projects
        </h2>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Every workflow run saves into the active project. Switch projects to keep
          surveys organized, then push them to metardu web from the Sync panel.
        </p>
      </div>

      {/* ─── Create ─────────────────────────────────────────────── */}
      <div style={{ border: "1px solid var(--border-default)", borderRadius: "10px", padding: "16px", background: "var(--bg-secondary)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>New project</label>
          {selectedTemplate && (
            <span style={{ fontSize: "11px", color: "var(--accent-primary)", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: "4px" }}>
              <Sparkles size={12} /> Template: {selectedTemplate.name}
              <button onClick={() => setSelectedTemplate(null)} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 0, fontSize: "11px" }}>✕</button>
            </span>
          )}
        </div>

        {/* ─── Template Cards ──────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "8px", marginBottom: "12px" }}>
          {PROJECT_TEMPLATES.filter((t) => t.countryCode === country).map((tmpl) => (
            <div
              key={tmpl.id}
              onClick={() => {
                setSelectedTemplate(tmpl);
                setSurveyType(tmpl.surveyType);
                if (!name.trim()) setName(`${tmpl.name} — `);
              }}
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                border: selectedTemplate?.id === tmpl.id ? "2px solid var(--accent-primary)" : "1px solid var(--border-default)",
                background: selectedTemplate?.id === tmpl.id ? "rgba(255,149,0,0.08)" : "var(--bg-primary)",
                cursor: "pointer",
                transition: "all 0.15s ease",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "16px" }}>{tmpl.icon}</span>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>{tmpl.name}</span>
                <span style={{ flex: 1 }} />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowTemplateInfo(showTemplateInfo === tmpl.id ? null : tmpl.id);
                  }}
                  title="Show workflow details"
                  style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 0, display: "flex" }}
                >
                  {showTemplateInfo === tmpl.id ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.3 }}>
                {tmpl.description.substring(0, 80)}{tmpl.description.length > 80 ? "…" : ""}
              </div>
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "2px" }}>
                {tmpl.views.filter((v) => v.required).slice(0, 4).map((v) => (
                  <span key={v.viewId} style={{ fontSize: "9px", padding: "1px 5px", borderRadius: "3px", background: "var(--bg-tertiary)", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    {v.label}
                  </span>
                ))}
                {tmpl.views.filter((v) => v.required).length > 4 && (
                  <span style={{ fontSize: "9px", padding: "1px 5px", borderRadius: "3px", background: "var(--bg-tertiary)", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    +{tmpl.views.filter((v) => v.required).length - 4} more
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ─── Template Info Panel ─────────────────────────────── */}
        {showTemplateInfo && (() => {
          const tmpl = getTemplateById(showTemplateInfo);
          if (!tmpl) return null;
          return (
            <div style={{ marginBottom: "12px", padding: "12px", borderRadius: "8px", border: "1px solid var(--border-default)", background: "var(--bg-primary)", fontSize: "11px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: "12px" }}>{tmpl.icon} {tmpl.name} — Workflow</span>
                <button onClick={() => setShowTemplateInfo(null)} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}>✕</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {tmpl.views.map((v, i) => (
                  <div key={v.viewId} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                    <span style={{ fontFamily: "var(--font-mono)", color: v.required ? "var(--accent-primary)" : "var(--text-disabled)", minWidth: "18px", textAlign: "right" }}>{i + 1}.</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: v.required ? 600 : 400, color: "var(--text-primary)", marginRight: "6px" }}>{v.label}</span>
                      {!v.required && <span style={{ color: "var(--text-disabled)", fontSize: "10px" }}>(optional)</span>}
                      <div style={{ color: "var(--text-tertiary)", fontSize: "10px", marginTop: "1px" }}>{v.purpose}</div>
                    </div>
                    <ChevronRight size={10} style={{ color: "var(--text-disabled)", marginTop: 3, flexShrink: 0 }} />
                  </div>
                ))}
              </div>
              {tmpl.statutoryNotes.length > 0 && (
                <div style={{ marginTop: "8px", padding: "8px", borderRadius: "4px", background: "rgba(255,149,0,0.05)", borderLeft: "3px solid var(--accent-primary)" }}>
                  <div style={{ fontWeight: 600, color: "var(--accent-primary)", marginBottom: "4px", fontSize: "10px", textTransform: "uppercase" }}>Statutory Requirements</div>
                  {tmpl.statutoryNotes.map((note, i) => (
                    <div key={i} style={{ color: "var(--text-secondary)", fontSize: "10px", lineHeight: 1.4, marginTop: "2px" }}>• {note}</div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: "6px", fontSize: "10px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", display: "flex", gap: "12px" }}>
                <span>{tmpl.regulatoryRef}</span>
                <span>Fee: area={tmpl.feeDefaults.areaHa}Ha, {tmpl.feeDefaults.beaconCount} beacons, {tmpl.feeDefaults.traverseKm}km traverse</span>
              </div>
            </div>
          );
        })()}

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 220px", minWidth: 180 }}>
            <label style={subLabelStyle}>Name</label>
            <input
              style={inputStyle}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
              placeholder="e.g. Kasarani Cadastral 2026"
              spellCheck={false}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={subLabelStyle}>Country</label>
            <select style={inputStyle} value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={subLabelStyle}>Survey type</label>
            <select style={inputStyle} value={surveyType} onChange={(e) => setSurveyType(e.target.value)}>
              {SURVEY_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <button onClick={() => void handleCreate()} disabled={busy} style={primaryButton(busy)}>
            {busy ? <Loader2 size={16} strokeWidth={2} /> : <Plus size={16} strokeWidth={2} />}
            Create
          </button>
        </div>
      </div>

      {/* ─── List ───────────────────────────────────────────────── */}
      {projects.length === 0 ? (
        <div style={{ border: "1px dashed var(--border-default)", borderRadius: "10px", padding: "32px 24px", textAlign: "center" }}>
          <FolderOpen size={36} strokeWidth={1.25} style={{ color: "var(--text-disabled)" }} />
          <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginTop: "10px" }}>No projects yet</div>
          <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: "4px" }}>
            Create one above, or run any workflow view — it auto-creates a project from your survey.
          </div>
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border-default)", borderRadius: "10px", overflow: "auto", maxHeight: "520px", background: "var(--bg-primary)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", fontFamily: "var(--font-mono)" }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-default)" }}>
              <tr>
                <th style={{ ...th, width: 30 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    disabled={selectable.length === 0 || schemeExporting}
                    title={allSelected ? "Clear selection" : "Select all projects with output"}
                    style={{ accentColor: "var(--accent-primary)", cursor: "pointer" }}
                  />
                </th>
                <th style={th}>Name</th>
                <th style={th}>Country</th>
                <th style={th}>Type</th>
                <th style={th}>Source</th>
                <th style={th}>Ver</th>
                <th style={th}>Updated</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const isActive = p.id === activeId;
                const isEditing = editingId === p.id;
                const isArmed = armedDeleteId === p.id;
                const hasOutput = p.output !== null && p.output !== undefined;
                return (
                  <tr
                    key={p.id}
                    style={{
                      borderBottom: "1px solid var(--border-subtle)",
                      background: isActive ? "var(--bg-hover)" : undefined,
                    }}
                  >
                    <td style={{ ...td, width: 30 }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        disabled={!hasOutput || schemeExporting}
                        title={hasOutput ? "Include in scheme booklet" : "No survey output to export"}
                        style={{ accentColor: "var(--accent-primary)", cursor: hasOutput ? "pointer" : "not-allowed", opacity: hasOutput ? 1 : 0.35 }}
                      />
                    </td>
                    <td style={{ ...td, fontWeight: 500, color: isActive ? "var(--accent-primary)" : "var(--text-secondary)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {isActive ? (
                          <Star size={13} strokeWidth={2} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
                        ) : (
                          <Folder size={13} strokeWidth={1.75} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                        )}
                        {isEditing ? (
                          <input
                            style={{ ...inputStyle, padding: "4px 8px", fontSize: "12px" }}
                            value={draft}
                            autoFocus
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void commitRename();
                              if (e.key === "Escape") cancelRename();
                            }}
                            onBlur={() => void commitRename()}
                          />
                        ) : (
                          <span>{p.name}</span>
                        )}
                        {!hasOutput && (
                          <span style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>(empty)</span>
                        )}
                      </div>
                    </td>
                    <td style={td}>{p.countryCode}</td>
                    <td style={td}>{p.surveyType}</td>
                    <td style={td}>{p.sourceView}</td>
                    <td style={td}>v{p.version}</td>
                    <td style={td}>{new Date(p.updatedAt).toLocaleString()}</td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                        {!isActive && (
                          <button
                            onClick={() => void handleSetActive(p.id)}
                            disabled={busy}
                            title="Make this the active project"
                            style={tinyButton(busy)}
                          >
                            Set active
                          </button>
                        )}
                        {isEditing ? (
                          <>
                            {/* onMouseDown preventDefault stops the input from
                                blurring before the click, so the rename isn't
                                committed twice (blur + click). */}
                            <button onMouseDown={(e) => e.preventDefault()} onClick={() => void commitRename()} disabled={busy} title="Save name" style={{ ...tinyButton(busy), color: "var(--text-success)" }}>
                              <Check size={12} strokeWidth={2} />
                            </button>
                            <button onMouseDown={(e) => e.preventDefault()} onClick={cancelRename} disabled={busy} title="Cancel" style={{ ...tinyButton(busy), color: "var(--text-error)" }}>
                              <X size={12} strokeWidth={2} />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => startRename(p.id, p.name)}
                            disabled={busy}
                            title="Rename"
                            style={tinyButton(busy)}
                          >
                            <Pencil size={12} strokeWidth={2} />
                          </button>
                        )}
                        <span
                          title={isArmed ? "Click again to confirm deletion" : "Delete project"}
                          style={{ display: "inline-flex" }}
                        >
                          <button
                            onClick={() => void handleDelete(p.id)}
                            disabled={busy}
                            style={{
                              ...tinyButton(busy),
                              borderColor: isArmed ? "var(--border-error)" : "var(--border-default)",
                              color: isArmed ? "var(--text-error)" : "var(--text-tertiary)",
                              background: isArmed ? "var(--bg-error)" : undefined,
                              opacity: isArmed ? 1 : 0.75,
                            }}
                          >
                            {isArmed ? "Confirm" : <Trash2 size={12} strokeWidth={2} />}
                          </button>
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Batch scheme-booklet export ──────────────────────────── */}
      {projects.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
          padding: "12px 16px", borderRadius: "10px",
          border: "1px solid var(--border-default)", background: "var(--bg-secondary)",
        }}>
          <button
            onClick={() => void exportSchemeBooklet()}
            disabled={schemeExporting || selectedIds.size === 0}
            title="One 300 DPI plan per parcel across selected projects + a booklet PDF with a master index"
            style={{
              display: "inline-flex", alignItems: "center", gap: "8px",
              padding: "8px 16px", borderRadius: "8px", border: "none",
              background: schemeExporting || selectedIds.size === 0 ? "var(--bg-hover)" : "var(--accent-primary)",
              color: schemeExporting || selectedIds.size === 0 ? "var(--text-tertiary)" : "#fff",
              fontSize: "13px", fontWeight: 500,
              cursor: schemeExporting ? "wait" : selectedIds.size === 0 ? "not-allowed" : "pointer",
              opacity: schemeExporting || selectedIds.size === 0 ? 0.7 : 1,
            }}
          >
            <FolderArchive size={16} strokeWidth={2} />
            {schemeExporting ? "Building scheme booklet…" : `Export Scheme Booklet (${selectedIds.size})`}
          </button>
          <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
            {selectable.length > 0
              ? `${selectable.length} project${selectable.length === 1 ? " has" : "s have"} output. Projects without output can't be selected.`
              : "Run a workflow in any project first — plans need survey output."}
          </span>
        </div>
      )}

      {schemeResult && (
        <div style={{ padding: "10px 14px", borderRadius: "8px", background: "var(--bg-success)", border: "1px solid var(--border-success)", fontSize: "12px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
          ✓ {schemeResult}
        </div>
      )}
      {schemeError && (
        <div style={{ padding: "10px 14px", borderRadius: "8px", background: "var(--bg-error)", border: "1px solid var(--border-error)", fontSize: "12px", color: "var(--text-error)" }}>
          ✗ {schemeError}
        </div>
      )}

      {lastResult && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-success)" }}>
          <Check size={14} strokeWidth={2} /> {lastResult}
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
  marginBottom: "8px",
  fontFamily: "var(--font-mono)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const subLabelStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid var(--border-default)",
  background: "var(--bg-primary)",
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

const tinyButton = (busy: boolean): React.CSSProperties => ({
  padding: "4px 10px", borderRadius: "6px",
  border: "1px solid var(--border-default)",
  background: "var(--bg-secondary)",
  color: "var(--text-secondary)",
  fontSize: "11px", cursor: busy ? "not-allowed" : "pointer",
  whiteSpace: "nowrap",
  display: "inline-flex", alignItems: "center", gap: "4px",
});

const th: React.CSSProperties = {
  padding: "8px 10px", textAlign: "left",
  fontSize: "11px", fontWeight: 500,
  color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em",
};

const td: React.CSSProperties = {
  padding: "7px 10px", color: "var(--text-secondary)", whiteSpace: "nowrap",
};
