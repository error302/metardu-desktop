import { describe, expect, it } from "vitest";
import { buildCommunityProjectOutputInput } from "../renderer/community-project-input.js";
import type { StoredProject } from "../renderer/useProjectStore.js";

const project = (overrides: Partial<StoredProject> = {}) => ({
  id: "private-project-id",
  name: "Client site",
  countryCode: "NZ",
  crsSrid: 2193,
  coordinateContext: {
    schemaVersion: 1,
    horizontalUnit: "metre" as const,
    coordinateEpoch: null,
    verticalReference: null,
    evidenceStatus: "user_declared_unverified" as const,
  },
  output: { points: [{ id: "P1", easting: 100, northing: 200, elevation: 10 }] },
  sourceView: "TopographicView",
  surveyType: "Topographic",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 1,
  ...overrides,
});

describe("buildCommunityProjectOutputInput", () => {
  it("packages saved output with explicitly declared project context and no project identity", () => {
    const result = buildCommunityProjectOutputInput(project());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = JSON.parse(result.value.json);
    expect(value).toEqual({
      schema: "metardu-project-output-input/v1",
      context: {
        surveyType: "Topographic",
        sourceView: "TopographicView",
        declaredCountryCode: "NZ",
        declaredHorizontalCrsSrid: 2193,
        declaredCoordinateContext: {
          schemaVersion: 1,
          horizontalUnit: "metre",
          coordinateEpoch: null,
          verticalReference: null,
          evidenceStatus: "user_declared_unverified",
        },
        coordinateContextState: "declared",
      },
      output: { points: [{ id: "P1", easting: 100, northing: 200, elevation: 10 }] },
    });
    expect(result.value.byteLength).toBe(new TextEncoder().encode(result.value.json).byteLength);
    expect(result.value.json).not.toContain("private-project-id");
    expect(result.value.json).not.toContain("Client site");
  });

  it("labels invalid coordinate declarations and refuses a project without output", () => {
    const invalid = buildCommunityProjectOutputInput(project({ coordinateContextStatus: "invalid", coordinateContext: undefined }));
    expect(invalid.ok).toBe(true);
    if (invalid.ok) expect(JSON.parse(invalid.value.json).context.coordinateContextState).toBe("invalid");

    expect(buildCommunityProjectOutputInput(project({ output: null }))).toEqual({
      ok: false,
      message: "The active project has no saved workflow output to provide.",
    });
  });

  it("rejects oversized or non-JSON output without truncating it", () => {
    const oversized = buildCommunityProjectOutputInput(project({ output: { payload: "x".repeat(4 * 1024 * 1024) } }));
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.message).toMatch(/4 MiB/);

    const invalid = buildCommunityProjectOutputInput(project({ output: { bad: Number.NaN } }));
    expect(invalid.ok).toBe(false);
  });
});
