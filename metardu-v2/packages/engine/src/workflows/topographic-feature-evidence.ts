import { MAX_TOPOGRAPHIC_TIN_POINTS } from "./topographic.js";

export interface TopographicPointCodeCount {
  /** First spelling retained from the project output; matching is case-insensitive. */
  code: string;
  vertexCount: number;
}

export type TopographicPointCodeEvidence =
  | {
    state: "available";
    vertexCount: number;
    codedVertexCount: number;
    codeCounts: TopographicPointCodeCount[];
  }
  | {
    state: "unavailable" | "invalid";
    message: string;
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Summarize codes carried by the vertices of a retained, unadjusted
 * topographic draft. This reports code presence only: it does not establish
 * feature geometry, sampling density, breaklines, coverage, or accuracy.
 */
export function summarizeTopographicPointCodes(output: unknown): TopographicPointCodeEvidence {
  if (!isRecord(output) || output.evidenceStatus !== "computed-draft-unadjusted") {
    return {
      state: "unavailable",
      message: "This project has no retained computed topographic draft to inspect.",
    };
  }

  const tin = output.tin;
  if (!isRecord(tin) || !Array.isArray(tin.vertices)) {
    return { state: "invalid", message: "The retained topographic draft has no valid TIN vertex list." };
  }
  if (tin.vertices.length < 3 || tin.vertices.length > MAX_TOPOGRAPHIC_TIN_POINTS) {
    return {
      state: "invalid",
      message: `The retained topographic draft vertex count is outside the supported range of 3 to ${MAX_TOPOGRAPHIC_TIN_POINTS.toLocaleString()}.`,
    };
  }

  const pointIds = new Set<string>();
  const codeCounts = new Map<string, TopographicPointCodeCount>();
  let codedVertexCount = 0;

  for (const [index, value] of tin.vertices.entries()) {
    if (!isRecord(value)
      || typeof value.id !== "string"
      || value.id.trim() === ""
      || value.id.length > 120
      || !Number.isFinite(value.easting)
      || !Number.isFinite(value.northing)
      || !Number.isFinite(value.elevation)) {
      return { state: "invalid", message: `Retained topographic draft vertex ${index + 1} is malformed.` };
    }
    if (pointIds.has(value.id)) {
      return { state: "invalid", message: `Retained topographic draft contains duplicate point ID '${value.id}'.` };
    }
    pointIds.add(value.id);

    if (value.code === undefined) continue;
    if (typeof value.code !== "string" || value.code.length > 120) {
      return { state: "invalid", message: `Retained topographic draft vertex ${index + 1} has a malformed point code.` };
    }
    const code = value.code.trim();
    if (!code) continue;
    codedVertexCount += 1;
    const normalized = code.toUpperCase();
    const current = codeCounts.get(normalized);
    if (current) current.vertexCount += 1;
    else codeCounts.set(normalized, { code, vertexCount: 1 });
  }

  return {
    state: "available",
    vertexCount: tin.vertices.length,
    codedVertexCount,
    codeCounts: [...codeCounts.values()].sort((left, right) => left.code.localeCompare(right.code)),
  };
}
