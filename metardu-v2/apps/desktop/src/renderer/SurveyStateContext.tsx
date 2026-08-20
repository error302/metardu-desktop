/**
 * Survey State Context — shared state layer that lets survey views
 * store their workflow output, which the ExportPanel reads.
 *
 * Replaces the demo data in ExportPanel with real survey data from
 * whatever the surveyor last computed in any workflow view.
 *
 * # Architecture
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  SurveyStateProvider (wraps the entire app)  │
 *   │     ↓                                        │
 *   │  useSurveyState() hook                       │
 *   │     ↓                                        │
 *   │  TopographicView → setSurveyOutput(output)   │
 *   │  EngineeringView → setSurveyOutput(output)   │
 *   │  SettingOutView → setSurveyOutput(output)    │
 *   │  SectionalView → setSurveyOutput(output)     │
 *   │     ↓                                        │
 *   │  ExportPanel → const { output } = useSurveyState()
 *   └─────────────────────────────────────────────┘
 *
 * The context stores the most recent survey output from any view +
 * metadata about which view produced it (so the ExportPanel can show
 * "Exporting: Topographic Survey from TopographicView").
 *
 * # Project store integration (ProjectStore)
 *
 * Every `setSurveyOutput` call ALSO persists into the project store
 * (metardu:projects:* IPC): the active project's output/surveyType/
 * sourceView/countryCode are updated, or a project is created if none
 * is active. This gives the app a real, disk-persisted project layer
 * that the SyncPanel reconciles against metardu web and the shell
 * toolbar displays — replacing the "project: untitled" placeholder.
 * Views keep calling the exact same setSurveyOutput signature; no view
 * code changes were needed.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { StoredProject, ProjectStoreState, CreateProjectInput, UpdateProjectInput } from "../main/project-store-core.js";
import { detectAutoExportKind } from "./map-geometry.js";
import { CrossImportBus, bus } from "./cross-import-bus.js";

/**
 * The survey output stored in context. This is the `SurveyOutput` union
 * type from the engine — but we keep it as `unknown` here to avoid
 * coupling the renderer to the engine's type system (which would pull
 * the entire engine into the renderer bundle).
 */
export interface SurveyState {
  /** The most recent workflow output from any view. */
  output: unknown;
  /** Which survey type produced this output (from detectSurveyType). */
  surveyType: string;
  /** Which view produced this output (e.g., "TopographicView"). */
  sourceView: string;
  /** When the output was set (ISO 8601 timestamp). */
  timestamp: string;
  /** The country code used when running the workflow. */
  countryCode: string;
}

interface ProjectsApi {
  list?: () => Promise<ProjectStoreState>;
  create?: (input: CreateProjectInput) => Promise<StoredProject | null>;
  update?: (input: UpdateProjectInput) => Promise<StoredProject | null>;
  setActive?: (id: string) => Promise<{ ok: boolean }>;
  delete?: (id: string) => Promise<{ ok: boolean }>;
  onChanged?: (cb: (state: ProjectStoreState) => void) => () => void;
}

/** Auto-export outcome surfaced to the views (banner after a run). */
export interface AutoExportStatus {
  status: "running" | "done" | "error";
  message: string;
  /** Directory the plan(s) were written to (done only). */
  directory?: string;
  /** Booklet page count / files written (done only). */
  kind?: "png" | "booklet";
  pageCount?: number;
  /** Statutory report PDF (cover + embedded map) written alongside the plan. */
  reportFile?: { path: string; bytes: number };
}

interface MapApi {
  autoExport?: (input: {
    surveyOutput: unknown;
    projectName: string;
    countryCode?: string;
    surveyorName?: string;
    date?: string;
    sheetSize?: string;
    orientation?: "landscape" | "portrait";
    scaleDenominator?: number;
  }) => Promise<{
    kind: "png" | "booklet";
    directory: string;
    files: Array<{ label: string; path: string; bytes: number }>;
    pageCount?: number;
    scaleDenominator: number;
    summary: string;
    reportFile?: { path: string; bytes: number };
  }>;
}

function getMapApi(): MapApi {
  return (window as unknown as { metardu?: { map?: MapApi } }).metardu?.map ?? {};
}

/**
 * Cross-import payload — one view pushes data for another view to pick up.
 * Used to wire COGO → Traverse and Traverse → COGO area verification.
 */
export interface CrossImportPayload {
  /** "cogo_points" — COGOView pushes accumulated computed points. */
  type: "cogo_points";
  /** Points computed by COGO (radiation, intersections, offsets). */
  points: Array<{ id: string; easting: number; northing: number; source: string }>;
  /** Timestamp. */
  timestamp: string;
} | {
  /** "traverse_results" — TraverseView pushes LS adjusted coordinates. */
  type: "traverse_results";
  /** Adjusted coordinates from LS adjustment. */
  adjusted: Array<{ id: string; easting: number; northing: number; height: number | null }>;
  /** Residuals from the adjustment. */
  residuals: Array<{ from: string; to: string; kind: string; residual: number; wStatistic: number }>;
  /** A posteriori variance factor. */
  sigma0Squared: number;
  /** Precision ratio (linear misclosure / perimeter). */
  precisionRatio?: number;
  /** Timestamp. */
  timestamp: string;
}

interface SurveyStateContextValue {
  /** Current survey state, or null if no survey has been run yet. */
  state: SurveyState | null;
  /** Set the current survey output. Called by workflow views. */
  setSurveyOutput: (output: unknown, surveyType: string, sourceView: string, countryCode: string) => void;
  /** Clear the current survey state. */
  clear: () => void;
  /** Cross-import payload from another view (one-shot — consumed on read). @deprecated Use bus.on() / bus.emit() */
  crossImport: CrossImportPayload | null;
  /** Push a cross-import payload for another view. @deprecated Use bus.emit() */
  setCrossImport: (payload: CrossImportPayload | null) => void;
  /** Typed event bus for view-to-view data sharing. */
  bus: CrossImportBus;
  /**
   * Auto-export status after the last workflow run (plan auto-written to
   * userData/auto-exports/). Null until a run completes in Electron mode.
   */
  autoExportStatus: AutoExportStatus | null;
  /** Dismiss the auto-export banner. */
  dismissAutoExportStatus: () => void;
  /** All persisted projects, newest-last (from the main-process store). */
  projects: StoredProject[];
  /** The active project (the one views save into), or null. */
  activeProject: StoredProject | null;
  /** Switch which project new survey output is saved into. Resolves when the IPC write lands. */
  setActiveProject: (id: string) => Promise<void>;
  /** Create a new empty project and make it active. Resolves when the IPC write lands. */
  createProject: (input: Omit<CreateProjectInput, "sourceView" | "output">) => Promise<void>;
  /** Update a project's editable fields (name, description, countryCode, surveyType, planSheet). Resolves when the IPC write lands. */
  updateProject: (id: string, input: Partial<Pick<UpdateProjectInput, "name" | "description" | "countryCode" | "surveyType" | "planSheet">>) => Promise<void>;
  /** Delete a project (the active project moves to the most recent). Resolves when the IPC write lands. */
  deleteProject: (id: string) => Promise<void>;
}

const SurveyStateContext = createContext<SurveyStateContextValue | null>(null);

function getProjectsApi(): ProjectsApi {
  const api = (window as unknown as { metardu?: { projects?: ProjectsApi } }).metardu?.projects;
  return api ?? {};
}

/**
 * Provider component — wraps the app so all views + ExportPanel share
 * the same survey state and the same persisted project layer.
 */
export const SurveyStateProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<SurveyState | null>(null);
  const [crossImport, setCrossImportState] = useState<CrossImportPayload | null>(null);
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [autoExportStatus, setAutoExportStatus] = useState<AutoExportStatus | null>(null);
  const autoExportSeqRef = React.useRef(0);

  // Load the project store on mount and subscribe to live changes pushed
  // from the main process (every mutation broadcasts).
  useEffect(() => {
    const api = getProjectsApi();
    let unsubscribe: (() => void) | undefined;
    api.list?.().then((s) => {
      setProjects(s.projects);
      setActiveProjectId(s.activeProjectId);
    }).catch(() => {});
    unsubscribe = api.onChanged?.((s) => {
      setProjects(s.projects);
      setActiveProjectId(s.activeProjectId);
    });
    return () => unsubscribe?.();
  }, []);

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  // Persist a survey output into the project store. If no project is
  // active, create one named after the survey type. Fire-and-forget:
  // the in-memory state updates synchronously; the disk write is async.
  const persistToProject = useCallback((output: unknown, surveyType: string, sourceView: string, countryCode: string, active: StoredProject | null): void => {
    const api = getProjectsApi();
    if (!api.update || !api.create) return; // browser mode — in-memory only
    const now = new Date().toISOString();
    if (active) {
      // The core stamps its own updatedAt + version bump; don't send one.
      const update: UpdateProjectInput = {
        id: active.id,
        output,
        surveyType,
        sourceView,
        countryCode,
        name: active.name,
      };
      api.update(update).catch(() => {});
    } else {
      const name = `${surveyType.replace(/([A-Z])/g, " $1").trim()} — ${new Date(now).toLocaleString()}`;
      api.create({
        name,
        countryCode,
        surveyType,
        sourceView,
        output,
      }).then((created) => {
        if (created) setActiveProjectId(created.id);
      }).catch(() => {});
    }
  }, []);

  // Auto-export the freshly computed plan to userData/auto-exports/ the
  // moment a workflow run completes — no ExportPanel visit needed. Uses a
  // sequence guard so rapid successive runs can't let an older export's
  // result overwrite a newer run's status. Browser mode (no bridge) no-ops.
  const triggerAutoExport = useCallback(
    (output: unknown, surveyType: string, sourceView: string, countryCode: string) => {
      const mapApi = getMapApi();
      if (!mapApi.autoExport) return; // browser mode — nothing to do
      // Skip outputs with nothing plottable (e.g. sectional quota sheets):
      // firing would only produce a main-process "Nothing to plot" error
      // banner on every run. Same pure predicate main uses, so the two
      // sites can never drift apart.
      if (detectAutoExportKind(output) === "skip") {
        return;
      }
      const seq = ++autoExportSeqRef.current;
      const project = activeProjectRef.current;
      const projectName = project?.name ?? `${surveyType} — ${sourceView}`;
      const ps = project?.planSheet;
      setAutoExportStatus({ status: "running", message: "Auto-exporting statutory plan…" });
      void mapApi.autoExport({
        surveyOutput: output,
        projectName,
        countryCode,
        // The project's remembered print choices ride along when present;
        // main falls back to the country's statutory defaults otherwise.
        sheetSize: ps?.sheetSize,
        orientation: ps?.orientation,
        scaleDenominator: ps?.scaleDenominator,
      }).then((res) => {
        if (seq !== autoExportSeqRef.current) return; // superseded by a newer run
        const reportSuffix = res.reportFile
          ? ` + statutory report PDF (${(res.reportFile.bytes / 1024).toFixed(1)} KB)`
          : "";
        setAutoExportStatus({
          status: "done",
          message:
            res.kind === "booklet"
              ? `Auto-exported ${res.pageCount ?? res.files.length} sheets (${res.summary})${reportSuffix}`
              : `Auto-exported plan (${res.summary})${reportSuffix}`,
          directory: res.directory,
          kind: res.kind,
          pageCount: res.pageCount,
          reportFile: res.reportFile,
        });
      }).catch((err: unknown) => {
        if (seq !== autoExportSeqRef.current) return;
        setAutoExportStatus({
          status: "error",
          message: `Auto-export failed: ${(err as Error).message}`,
        });
      });
    },
    [],
  );

  const setSurveyOutput = useCallback(
    (output: unknown, surveyType: string, sourceView: string, countryCode: string) => {
      setState({
        output,
        surveyType,
        sourceView,
        timestamp: new Date().toISOString(),
        countryCode,
      });
      // Persist into the active project (create if none). We read the
      // current active project via a ref-free closure param — recomputed
      // below so the callback doesn't go stale between renders.
      persistToProjectRef.current(output, surveyType, sourceView, countryCode);
      // Auto-write the statutory plan sheet(s) — no ExportPanel visit.
      triggerAutoExportRef.current(output, surveyType, sourceView, countryCode);
    },
    [],
  );

  // Keep the latest activeProject available to setSurveyOutput without
  // re-creating the callback on every render (views memoize it).
  const activeProjectRef = React.useRef<StoredProject | null>(null);
  activeProjectRef.current = activeProject;
  const persistToProjectRef = React.useRef<(o: unknown, t: string, s: string, c: string) => void>(() => {});
  persistToProjectRef.current = (output, surveyType, sourceView, countryCode) => {
    persistToProject(output, surveyType, sourceView, countryCode, activeProjectRef.current);
  };
  const triggerAutoExportRef = React.useRef<(o: unknown, t: string, s: string, c: string) => void>(() => {});
  triggerAutoExportRef.current = triggerAutoExport;

  const clear = useCallback(() => setState(null), []);

  const setCrossImport = useCallback((payload: CrossImportPayload | null) => {
    setCrossImportState(payload);
  }, []);

  const setActiveProject = useCallback(async (id: string) => {
    // Optimistic local switch; the main-process broadcast corrects it on
    // failure. The returned promise rejects if the IPC write fails so
    // callers (ProjectsPanel) can surface the error.
    setActiveProjectId(id);
    const api = getProjectsApi();
    await api.setActive?.(id);
  }, []);

  const createProject = useCallback(async (input: Omit<CreateProjectInput, "sourceView" | "output">) => {
    const api = getProjectsApi();
    const created = await api.create?.({
      ...input,
      sourceView: "Projects",
      output: null,
    });
    if (created) setActiveProjectId(created.id);
  }, []);

  const updateProject = useCallback(async (id: string, input: Partial<Pick<UpdateProjectInput, "name" | "description" | "countryCode" | "surveyType" | "planSheet">>) => {
    const api = getProjectsApi();
    await api.update?.({ id, ...input });
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    const api = getProjectsApi();
    await api.delete?.(id);
  }, []);

  return (
    <SurveyStateContext.Provider
      value={{
        state,
        setSurveyOutput,
        clear,
        crossImport,
        setCrossImport,
        bus,
        autoExportStatus,
        dismissAutoExportStatus: () => setAutoExportStatus(null),
        projects,
        activeProject,
        setActiveProject,
        createProject,
        updateProject,
        deleteProject,
      }}
    >
      {children}
    </SurveyStateContext.Provider>
  );
};

/**
 * Hook for accessing the survey state. Must be used inside a
 * SurveyStateProvider.
 *
 * @example
 * // In a workflow view:
 * const { setSurveyOutput } = useSurveyState();
 * const result = runTopographicWorkflow({ ... });
 * setSurveyOutput(result, "topographic", "TopographicView", "KE");
 *
 * // In ExportPanel:
 * const { state } = useSurveyState();
 * if (state) { export(state.output, ...); }
 */
export function useSurveyState(): SurveyStateContextValue {
  const ctx = useContext(SurveyStateContext);
  if (!ctx) {
    throw new Error("useSurveyState must be used inside a SurveyStateProvider");
  }
  return ctx;
}
