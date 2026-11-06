import { describe, expect, it } from "vitest";
import { PROJECT_DELIVERABLE_REVIEW_SCHEMA } from "../namespaces/project-deliverable-review.js";

function reviewFixture() {
  return {
    profile: {
      id: "office-topo-v1",
      name: "Office topographic delivery",
      referenceFields: ["horizontal-crs", "vertical-reference"],
      features: [{ id: "kerb", label: "Kerb and road edges", required: true, allowNotApplicable: false }],
      checks: [{ id: "coverage", label: "Feature and coverage review", required: true }],
      outputs: [{ id: "cad", label: "CAD drawing", format: "DXF", required: true }],
    },
    referenceContext: {
      "horizontal-crs": { value: "Project CRS", status: "declared" },
      "vertical-reference": { value: "Project height reference", status: "declared" },
    },
    featureReviews: [{ requirementId: "kerb", status: "reviewed", evidenceReferences: ["layer:KERB"] }],
    qualityChecks: [{ requirementId: "coverage", status: "warning", evidenceSummary: "North boundary gap requires review." }],
    artifacts: [{ outputId: "cad", fileName: "site.dxf", status: "included", sha256: "a".repeat(64) }],
  };
}

describe("PROJECT_DELIVERABLE_REVIEW_SCHEMA", () => {
  it("accepts bounded project-defined requirements and review evidence", () => {
    expect(PROJECT_DELIVERABLE_REVIEW_SCHEMA.safeParse(reviewFixture()).success).toBe(true);
  });

  it("requires a required output and rejects unknown or duplicated review references", () => {
    const missingOutput = reviewFixture();
    missingOutput.profile.outputs[0]!.required = false;
    expect(PROJECT_DELIVERABLE_REVIEW_SCHEMA.safeParse(missingOutput).success).toBe(false);

    const unknownFeature = reviewFixture();
    unknownFeature.featureReviews[0]!.requirementId = "not-in-profile";
    expect(PROJECT_DELIVERABLE_REVIEW_SCHEMA.safeParse(unknownFeature).success).toBe(false);

    const duplicateFeature = reviewFixture();
    duplicateFeature.profile.features.push({ id: "kerb", label: "Duplicate", required: true });
    expect(PROJECT_DELIVERABLE_REVIEW_SCHEMA.safeParse(duplicateFeature).success).toBe(false);
  });

  it("rejects file paths, oversized fields, and unknown object keys", () => {
    const pathArtifact = reviewFixture();
    pathArtifact.artifacts[0]!.fileName = "C:\\private\\site.dxf";
    expect(PROJECT_DELIVERABLE_REVIEW_SCHEMA.safeParse(pathArtifact).success).toBe(false);

    const unknownKey = reviewFixture() as ReturnType<typeof reviewFixture> & { secret: string };
    unknownKey.secret = "not part of the project review contract";
    expect(PROJECT_DELIVERABLE_REVIEW_SCHEMA.safeParse(unknownKey).success).toBe(false);
  });
});
