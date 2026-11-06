import { afterEach, describe, expect, it } from "vitest";
import {
  closeDatabase,
  configureDatabasePath,
  createProjectInDb,
  getDatabase,
  getProject,
  getProjectBundleSnapshot,
  restoreProjectBundleSnapshot,
  updateProjectInDb,
} from "../main/database.js";

afterEach(() => {
  closeDatabase();
  configureDatabasePath(":memory:");
});

function reviewFixture() {
  return {
    profile: {
      id: "client-topo-v1",
      name: "Client topographic deliverables",
      referenceFields: ["horizontal-crs", "vertical-reference"],
      features: [{ id: "kerb", label: "Kerbs and road edges", required: true, allowNotApplicable: false }],
      checks: [{ id: "coverage", label: "Coverage and feature review", required: true }],
      outputs: [{ id: "cad", label: "CAD drawing", format: "DXF", required: true }],
    },
    referenceContext: {
      "horizontal-crs": { value: "Project CRS", status: "declared" },
      "vertical-reference": { value: "Project height reference", status: "declared" },
    },
    featureReviews: [{ requirementId: "kerb", status: "reviewed", evidenceReferences: ["layer:KERB"] }],
    qualityChecks: [{ requirementId: "coverage", status: "pass", evidenceSummary: "Coverage review record 2026-11-06" }],
    artifacts: [{ outputId: "cad", fileName: "site.dxf", status: "included", sha256: "c".repeat(64) }],
  };
}

describe("project delivery review persistence", () => {
  it("persists review records and carries them through portable project bundles", () => {
    configureDatabasePath(":memory:");
    const database = getDatabase();
    const project = createProjectInDb(database, {
      name: "International topographic job",
      countryCode: "",
      surveyType: "topographic",
      sourceView: "TopographicView",
      output: { evidenceStatus: "computed-draft-unadjusted" },
    });
    const review = reviewFixture();

    const updated = updateProjectInDb(database, { id: project.id, deliveryReview: review as never });
    expect(updated?.deliveryReview).toEqual(review);
    expect(getProject(database, project.id)?.deliveryReview).toEqual(review);

    const bundle = getProjectBundleSnapshot(database, project.id);
    expect(JSON.parse(bundle.project.deliveryReviewJson!)).toEqual(review);
    const restored = restoreProjectBundleSnapshot(database, bundle);
    expect(restored.deliveryReview).toEqual(review);
  });

  it("rejects invalid project review records instead of storing unknown fields", () => {
    configureDatabasePath(":memory:");
    const database = getDatabase();
    const project = createProjectInDb(database, {
      name: "Invalid review job",
      countryCode: "",
      surveyType: "topographic",
      sourceView: "TopographicView",
    });

    expect(() => updateProjectInDb(database, { id: project.id, deliveryReview: { ...reviewFixture(), unexpected: true } as never }))
      .toThrow("Project delivery review is invalid");
    expect(getProject(database, project.id)?.deliveryReview).toBeUndefined();
  });
});
