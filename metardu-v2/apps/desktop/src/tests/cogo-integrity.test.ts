import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cogoView = readFileSync(new URL("../renderer/views/COGOView.tsx", import.meta.url), "utf8");
const surveyState = readFileSync(new URL("../renderer/SurveyStateContext.tsx", import.meta.url), "utf8");

describe("COGO draft integrity contract", () => {
  it("delegates every geometric calculation to Rust and has no statutory handoff", () => {
    for (const method of ["radiation", "bearing_bearing", "distance_distance", "midpoint_offset"]) {
      expect(cogoView).toContain(`method = "cogo.${method}"`);
    }
    expect(cogoView).toContain('callSidecar("cogo.area"');
    expect(cogoView).toContain("callSidecar(method, params)");
    expect(cogoView).not.toMatch(/setSurveyOutput|AutoExportBanner|pushToDeedPlan|Form 4|shoelace|Math\.atan2|Math\.sqrt/);
  });

  it("starts coordinate inputs empty and saves an explicitly unverified draft", () => {
    expect(cogoView).toContain("const EMPTY_INPUTS: Record<string, string> = {};");
    expect(cogoView).toContain('value={inputs[field.key] ?? ""}');
    expect(cogoView).toContain('evidenceStatus: "draft_unverified"');
    expect(cogoView).toContain("coordinateReference: null");
    expect(cogoView).toContain("verticalReference: null");
    expect(cogoView).toContain('jurisdictionAcceptance: "not_evaluated"');
    expect(cogoView).not.toMatch(/uncertainty\s*:\s*\d|adjusted\s*:\s*true/);
  });

  it("uses the project-store-only save path without changing export state", () => {
    const method = surveyState.match(/const saveDraftToProject = useCallback\(([\s\S]*?)\n  \);/)?.[1];
    expect(method).toBeTruthy();
    expect(method).toContain("await storeSave(output, surveyType, sourceView, countryCode)");
    expect(method).not.toMatch(/setState|triggerAutoExport|setSurveyOutput/);
  });
});
