import { describe, expect, it } from "vitest";
import { PROJECT_COORDINATE_CONTEXT_SCHEMA } from "../index.js";

const context = {
  schemaVersion: 1,
  horizontalUnit: "us_survey_foot",
  coordinateEpoch: 2020.25,
  verticalReference: {
    kind: "local",
    name: "Project benchmark datum",
    unit: "metre",
  },
  evidenceStatus: "user_declared_unverified",
} as const;

describe("project coordinate declarations", () => {
  it("accepts finite, explicitly unverified unit, epoch, and vertical-reference declarations", () => {
    expect(PROJECT_COORDINATE_CONTEXT_SCHEMA.parse(context)).toEqual(context);
  });

  it("allows unresolved declarations without assigning a unit or vertical reference", () => {
    expect(PROJECT_COORDINATE_CONTEXT_SCHEMA.parse({
      schemaVersion: 1,
      horizontalUnit: "unknown",
      coordinateEpoch: null,
      verticalReference: null,
      evidenceStatus: "user_declared_unverified",
    })).toMatchObject({ horizontalUnit: "unknown", coordinateEpoch: null, verticalReference: null });
  });

  it("rejects non-finite epochs, unsupported units, empty reference names, and verified claims", () => {
    expect(PROJECT_COORDINATE_CONTEXT_SCHEMA.safeParse({ ...context, coordinateEpoch: Number.NaN }).success).toBe(false);
    expect(PROJECT_COORDINATE_CONTEXT_SCHEMA.safeParse({ ...context, horizontalUnit: "feet" }).success).toBe(false);
    expect(PROJECT_COORDINATE_CONTEXT_SCHEMA.safeParse({
      ...context,
      verticalReference: { ...context.verticalReference, name: " " },
    }).success).toBe(false);
    expect(PROJECT_COORDINATE_CONTEXT_SCHEMA.safeParse({ ...context, evidenceStatus: "verified" }).success).toBe(false);
  });
});
