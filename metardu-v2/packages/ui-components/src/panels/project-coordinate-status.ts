export interface ShellCoordinateContext {
  schemaVersion: 1;
  horizontalUnit: string;
  coordinateEpoch: number | null;
  verticalReference: {
    kind: string;
    name: string;
    unit: string;
  } | null;
  evidenceStatus: "user_declared_unverified";
}

export interface ShellProjectCoordinates {
  crsSrid?: number;
  coordinateContext?: unknown;
  coordinateContextStatus?: "invalid";
}

export interface ProjectCoordinateStatusItem {
  key: "crs" | "horizontal-unit" | "epoch" | "vertical" | "evidence";
  label: string;
  value: string;
}

export type ProjectCoordinateStatusState = "loading" | "unavailable" | "no-project" | "not-recorded" | "unverified" | "invalid";

export interface ProjectCoordinateStatus {
  state: ProjectCoordinateStatusState;
  items: ProjectCoordinateStatusItem[];
  helpText: string;
}

const HORIZONTAL_UNITS: Record<string, string> = {
  metre: "metre",
  international_foot: "international foot",
  us_survey_foot: "US survey foot",
  degree: "degree",
  unknown: "not declared",
};

const VERTICAL_UNITS: Record<string, string> = {
  metre: "metre",
  international_foot: "international foot",
  us_survey_foot: "US survey foot",
  unknown: "unit not declared",
};

const VERTICAL_KINDS: Record<string, string> = {
  ellipsoidal: "ellipsoidal",
  orthometric: "orthometric",
  local: "local",
  other: "other",
};

function crsCodeValue(crsSrid: number | undefined): string {
  if (crsSrid === undefined) return "not assigned";
  if (!Number.isSafeInteger(crsSrid) || crsSrid <= 0) return "invalid stored code";
  return `EPSG:${crsSrid}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasKey<T extends Record<string, unknown>>(record: T, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isValidContext(value: unknown): value is ShellCoordinateContext {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1 || value.evidenceStatus !== "user_declared_unverified") return false;
  if (typeof value.horizontalUnit !== "string" || !hasKey(HORIZONTAL_UNITS, value.horizontalUnit)) return false;
  if (value.coordinateEpoch !== null
    && (typeof value.coordinateEpoch !== "number"
      || !Number.isFinite(value.coordinateEpoch)
      || value.coordinateEpoch <= 0)) return false;

  if (value.verticalReference === null) return true;
  if (!isRecord(value.verticalReference)) return false;
  return typeof value.verticalReference.kind === "string"
    && hasKey(VERTICAL_KINDS, value.verticalReference.kind)
    && typeof value.verticalReference.name === "string"
    && value.verticalReference.name.trim().length > 0
    && typeof value.verticalReference.unit === "string"
    && hasKey(VERTICAL_UNITS, value.verticalReference.unit);
}

function invalidContextStatus(project: ShellProjectCoordinates, crsValue: string): ProjectCoordinateStatus {
  return {
    state: "invalid",
    items: [
      { key: "crs", label: "CRS code", value: crsValue },
      { key: "horizontal-unit", label: "Horizontal unit", value: "unreadable" },
      { key: "epoch", label: "Epoch", value: "unreadable" },
      { key: "vertical", label: "Vertical reference", value: "unreadable" },
      { key: "evidence", label: "Context status", value: "invalid stored context — review in Projects" },
    ],
    helpText: `Stored coordinate declarations for this project are invalid${project.coordinateContextStatus === "invalid" ? "" : " or malformed"}. Review them in Projects. No partial values are displayed, and no values are inferred or transformed.`,
  };
}

export function summarizeProjectCoordinates(
  project: ShellProjectCoordinates | null | undefined | "unavailable",
): ProjectCoordinateStatus {
  if (project === "unavailable") {
    return {
      state: "unavailable",
      items: [
        { key: "crs", label: "CRS code", value: "unavailable" },
        { key: "horizontal-unit", label: "Horizontal unit", value: "unavailable" },
        { key: "epoch", label: "Epoch", value: "unavailable" },
        { key: "vertical", label: "Vertical reference", value: "unavailable" },
        { key: "evidence", label: "Context status", value: "project state unavailable" },
      ],
      helpText: "The local project state could not be read. Verify the project before relying on any coordinate context.",
    };
  }
  if (project === undefined) {
    return {
      state: "loading",
      items: [
        { key: "crs", label: "CRS code", value: "loading project state" },
        { key: "horizontal-unit", label: "Horizontal unit", value: "loading project state" },
        { key: "epoch", label: "Epoch", value: "loading project state" },
        { key: "vertical", label: "Vertical reference", value: "loading project state" },
        { key: "evidence", label: "Context status", value: "loading project state" },
      ],
      helpText: "The saved project list has not loaded yet. No coordinate values are inferred.",
    };
  }
  if (!project) {
    return {
      state: "no-project",
      items: [{ key: "evidence", label: "Coordinate context", value: "no active project" }],
      helpText: "There is no active project, so no project coordinate context is available.",
    };
  }

  const crsValue = crsCodeValue(project.crsSrid);

  if (project.coordinateContextStatus === "invalid") return invalidContextStatus(project, crsValue);

  const context = project.coordinateContext;
  if (context === undefined) {
    const items: ProjectCoordinateStatusItem[] = [
      { key: "crs", label: "CRS code", value: crsValue },
      { key: "horizontal-unit", label: "Horizontal unit", value: "not recorded" },
      { key: "epoch", label: "Epoch", value: "not recorded" },
      { key: "vertical", label: "Vertical reference", value: "not recorded" },
      { key: "evidence", label: "Context status", value: "not recorded" },
    ];
    return {
      state: "not-recorded",
      items,
      helpText: "Project coordinate context is not recorded. No units, epoch, vertical reference, CRS definition, or operation are inferred.",
    };
  }

  if (!isValidContext(context)) return invalidContextStatus(project, crsValue);

  const vertical = context.verticalReference;
  const items: ProjectCoordinateStatusItem[] = [
    { key: "crs", label: "CRS code", value: crsValue },
    { key: "horizontal-unit", label: "Horizontal unit", value: HORIZONTAL_UNITS[context.horizontalUnit]! },
    { key: "epoch", label: "Epoch", value: context.coordinateEpoch === null ? "not recorded" : String(context.coordinateEpoch) },
    {
      key: "vertical",
      label: "Vertical reference",
      value: vertical
        ? `${VERTICAL_KINDS[vertical.kind]} — ${vertical.name} (${VERTICAL_UNITS[vertical.unit]})`
        : "not recorded",
    },
    { key: "evidence", label: "Context status", value: "user-declared, unverified" },
  ];
  return {
    state: "unverified",
    items,
    helpText: "These project coordinate values were declared by the user and are unverified. They are not checked against the CRS code and do not establish an operation or transform coordinates.",
  };
}
