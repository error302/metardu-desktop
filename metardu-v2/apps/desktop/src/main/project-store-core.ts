/**
 * ProjectStore — pure CRUD core (no Electron, no fs).
 *
 * The persisted project layer that lets every workflow view, the
 * SyncPanel, and the ExportPanel share real project objects. This module
 * is deliberately free of Electron/node imports so it can be unit-tested
 * in isolation (apps/desktop/src/tests/project-store-core.test.ts).
 *
 * The main process wires this to disk (userData/projects.json) and IPC
 * in main/projects.ts. The renderer's SurveyStateContext feeds it: every
 * `setSurveyOutput` call auto-saves into the active project (creating one
 * if none exists), so workflow views persist without any view changes.
 *
 * Sync alignment: each project carries the fields SyncProject needs
 * (id, name, countryCode, surveyType, updatedAt, version) so SyncPanel
 * can map stored projects straight into the sync client. Version bumps on
 * every update make re-pushes genuine PUTs, not POST duplicates.
 */

/**
 * A project's remembered statutory print-plan choices (sheet size,
 * orientation, fixed scale). Persisted on the project so every project
 * keeps its own print settings across restarts and sync — the MapView
 * print preview and the ExportPanel seed their controls from this and
 * save back into it on change.
 */
export interface PlanSheetSettings {
  /** Named ISO/ANSI sheet (a4..a0, letter, legal). */
  sheetSize?: string;
  /** Paper orientation. */
  orientation?: "landscape" | "portrait";
  /** True = auto-fit the sheet; false = fixed 1:D scale. */
  scaleFit?: boolean;
  /** Fixed scale denominator (1:D) when scaleFit is false. */
  scaleDenominator?: number;
}

export interface StoredProject {
  id: string;
  name: string;
  description?: string;
  countryCode: string;
  surveyType: string;
  /** Which workflow view produced the output (e.g. "TopographicView"). */
  sourceView: string;
  /** The survey workflow output (serializable for IPC + disk). */
  output: unknown;
  /** Remembered statutory print-plan settings (sheet/orientation/scale). */
  planSheet?: PlanSheetSettings;
  createdAt: string;
  updatedAt: string;
  /** Local version — bumped on every update; feeds SyncProject.version. */
  version: number;
}

export interface ProjectStoreState {
  projects: StoredProject[];
  activeProjectId: string | null;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  countryCode: string;
  surveyType: string;
  sourceView: string;
  output?: unknown;
  planSheet?: PlanSheetSettings;
}

export interface UpdateProjectInput {
  id: string;
  name?: string;
  description?: string;
  countryCode?: string;
  surveyType?: string;
  sourceView?: string;
  output?: unknown;
  planSheet?: PlanSheetSettings;
}

export function emptyProjectStore(): ProjectStoreState {
  return { projects: [], activeProjectId: null };
}

export function createProject(
  state: ProjectStoreState,
  input: CreateProjectInput,
): ProjectStoreState {
  const now = new Date().toISOString();
  const project: StoredProject = {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    countryCode: input.countryCode,
    surveyType: input.surveyType,
    sourceView: input.sourceView,
    output: input.output ?? null,
    planSheet: input.planSheet,
    createdAt: now,
    updatedAt: now,
    version: 0,
  };
  return {
    projects: [...state.projects, project],
    // The newly created project becomes active — the common "create then
    // work on it" flow, and what setSurveyOutput expects.
    activeProjectId: project.id,
  };
}

export function updateProject(
  state: ProjectStoreState,
  input: UpdateProjectInput,
): ProjectStoreState {
  const now = new Date().toISOString();
  let found = false;
  const projects = state.projects.map((p) => {
    if (p.id !== input.id) return p;
    found = true;
    return {
      ...p,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {}),
      ...(input.surveyType !== undefined ? { surveyType: input.surveyType } : {}),
      ...(input.sourceView !== undefined ? { sourceView: input.sourceView } : {}),
      ...(input.output !== undefined ? { output: input.output } : {}),
      ...(input.planSheet !== undefined ? { planSheet: input.planSheet } : {}),
      updatedAt: now,
      version: p.version + 1,
    };
  });
  if (!found) return state;
  return { ...state, projects };
}

export function deleteProject(state: ProjectStoreState, id: string): ProjectStoreState {
  const projects = state.projects.filter((p) => p.id !== id);
  let activeProjectId = state.activeProjectId;
  if (activeProjectId === id) {
    activeProjectId = projects.length > 0 ? projects[projects.length - 1]!.id : null;
  }
  return { projects, activeProjectId };
}

export function setActiveProject(state: ProjectStoreState, id: string): ProjectStoreState {
  if (!state.projects.some((p) => p.id === id)) return state;
  return { ...state, activeProjectId: id };
}

export function activeProjectOf(state: ProjectStoreState): StoredProject | null {
  return state.projects.find((p) => p.id === state.activeProjectId) ?? null;
}

export function findProject(state: ProjectStoreState, id: string): StoredProject | null {
  return state.projects.find((p) => p.id === id) ?? null;
}
