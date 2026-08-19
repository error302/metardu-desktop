/**
 * Sync mapping — pure unit tests for projectFromStored (sync-projects.ts).
 *
 * Pins the guarantee that a project's remembered statutory print-plan
 * settings (sheet size, orientation, scale mode) ride along in the sync
 * payload, so they survive a push/pull round-trip and are available to
 * the metardu web app. The mapping is pure — no React/Electron — so it
 * is tested here in isolation.
 */

import { describe, it, expect } from "vitest";
import { projectFromStored, type StoredForSync } from "../renderer/sync-projects.js";

function makeStored(overrides: Partial<StoredForSync> = {}): StoredForSync {
  return {
    id: "proj-1",
    name: "Kasarani Cadastral",
    description: "Block 3 subdivision",
    countryCode: "KE",
    surveyType: "cadastral",
    sourceView: "TopographicView",
    output: { allBeacons: [] },
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("projectFromStored", () => {
  it("carries the remembered planSheet settings in the sync payload", () => {
    const wire = projectFromStored(
      makeStored({
        planSheet: { sheetSize: "a1", orientation: "portrait", scaleFit: false, scaleDenominator: 500 },
      }),
      3,
    );
    expect(wire.data.planSheet).toEqual({
      sheetSize: "a1",
      orientation: "portrait",
      scaleFit: false,
      scaleDenominator: 500,
    });
  });

  it("omits planSheet from the payload when the project has none saved", () => {
    const wire = projectFromStored(makeStored(), 0);
    expect(wire.data.planSheet).toBeUndefined();
    // The rest of the payload is still complete.
    expect(wire.data.output).toEqual({ allBeacons: [] });
    expect(wire.data.sourceView).toBe("TopographicView");
  });

  it("passes the saved version through so re-pushes stay PUTs (not POST duplicates)", () => {
    const wire = projectFromStored(makeStored(), 7);
    expect(wire.version).toBe(7);
    expect(wire.id).toBe("proj-1");
  });

  it("maps the stored identity fields onto the wire shape", () => {
    const wire = projectFromStored(makeStored(), 0);
    expect(wire).toMatchObject({
      id: "proj-1",
      name: "Kasarani Cadastral",
      description: "Block 3 subdivision",
      countryCode: "KE",
      surveyType: "cadastral",
      updatedAt: "2026-08-01T10:00:00.000Z",
    });
  });

  it("keeps a scale-fit-only planSheet (no denominator) intact through the payload", () => {
    const wire = projectFromStored(
      makeStored({ planSheet: { sheetSize: "a4", orientation: "landscape", scaleFit: true } }),
      2,
    );
    expect(wire.data.planSheet).toEqual({
      sheetSize: "a4",
      orientation: "landscape",
      scaleFit: true,
    });
  });
});
