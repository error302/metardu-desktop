import { describe, expect, it } from "vitest";
import { summarizeProjectCoordinates } from "../../../../packages/ui-components/src/panels/project-coordinate-status.js";

const declaredContext = {
  schemaVersion: 1 as const,
  horizontalUnit: "us_survey_foot",
  coordinateEpoch: 2020.25,
  verticalReference: {
    kind: "local",
    name: "Project benchmark datum",
    unit: "metre",
  },
  evidenceStatus: "user_declared_unverified" as const,
};

describe("persistent project coordinate status", () => {
  it("does not report an active-project absence while the saved list is loading", () => {
    const status = summarizeProjectCoordinates(undefined);
    expect(status.state).toBe("loading");
    expect(status.items).toHaveLength(5);
    expect(status.items[0]?.value).toBe("loading project state");
  });

  it("reports no active project without inventing coordinate context", () => {
    expect(summarizeProjectCoordinates(null)).toMatchObject({
      state: "no-project",
      items: [{ key: "evidence", value: "no active project" }],
    });
  });

  it("does not treat an unreadable project store as an empty project", () => {
    const status = summarizeProjectCoordinates("unavailable");
    expect(status.state).toBe("unavailable");
    expect(status.items.at(-1)?.value).toBe("project state unavailable");
    expect(status.helpText).toContain("Verify the project");
  });

  it("keeps legacy and incomplete project values explicitly unrecorded", () => {
    const status = summarizeProjectCoordinates({ crsSrid: 32756 });
    expect(status.state).toBe("not-recorded");
    expect(status.items).toEqual([
      { key: "crs", label: "CRS code", value: "EPSG:32756" },
      { key: "horizontal-unit", label: "Horizontal unit", value: "not recorded" },
      { key: "epoch", label: "Epoch", value: "not recorded" },
      { key: "vertical", label: "Vertical reference", value: "not recorded" },
      { key: "evidence", label: "Context status", value: "not recorded" },
    ]);
    expect(status.helpText).toContain("No units, epoch, vertical reference, CRS definition, or operation are inferred");
  });

  it("shows saved declarations and preserves their unverified evidence state", () => {
    const status = summarizeProjectCoordinates({ crsSrid: 32633, coordinateContext: declaredContext });
    expect(status.state).toBe("unverified");
    expect(status.items).toEqual([
      { key: "crs", label: "CRS code", value: "EPSG:32633" },
      { key: "horizontal-unit", label: "Horizontal unit", value: "US survey foot" },
      { key: "epoch", label: "Epoch", value: "2020.25" },
      { key: "vertical", label: "Vertical reference", value: "local — Project benchmark datum (metre)" },
      { key: "evidence", label: "Context status", value: "user-declared, unverified" },
    ]);
    expect(status.helpText).toContain("do not establish an operation or transform coordinates");
  });

  it("does not expose partial values from an invalid persisted context", () => {
    const status = summarizeProjectCoordinates({
      crsSrid: 32633,
      coordinateContext: declaredContext,
      coordinateContextStatus: "invalid",
    });
    expect(status.state).toBe("invalid");
    expect(status.items.map(({ value }) => value)).toEqual([
      "EPSG:32633",
      "unreadable",
      "unreadable",
      "unreadable",
      "invalid stored context — review in Projects",
    ]);
    expect(status.helpText).toContain("No partial values are displayed");
  });

  it("contains malformed runtime values and reports malformed CRS codes separately", () => {
    const malformedContext = summarizeProjectCoordinates({
      coordinateContext: { horizontalUnit: { unexpected: true } },
    });
    expect(malformedContext.state).toBe("invalid");
    expect(malformedContext.items[1]?.value).toBe("unreadable");

    const malformedCrs = summarizeProjectCoordinates({ crsSrid: Number.NaN, coordinateContext: declaredContext });
    expect(malformedCrs.state).toBe("unverified");
    expect(malformedCrs.items[0]?.value).toBe("invalid stored code");
    expect(malformedCrs.items.at(-1)?.value).toBe("user-declared, unverified");
  });
});
