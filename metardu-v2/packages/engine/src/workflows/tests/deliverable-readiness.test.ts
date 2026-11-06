import { describe, expect, it } from "vitest";
import {
  assessDeliverableReadiness,
  type DeliverableReadinessInput,
} from "../deliverable-readiness.js";

const digest = "a".repeat(64);

function completeInput(): DeliverableReadinessInput {
  return {
    profile: {
      id: "client-topographic-3d",
      name: "Client 3D topographic package",
      referenceFields: ["horizontal-crs", "vertical-reference", "linear-unit"],
      features: [
        { id: "kerbs", label: "Kerbs and edge of pavement", required: true },
        { id: "drainage", label: "Drainage paths", required: true, allowNotApplicable: true },
      ],
      checks: [
        { id: "control", label: "Control and residual review", required: true },
        { id: "coverage", label: "Feature coverage review", required: true },
      ],
      outputs: [
        { id: "drawing", label: "Coordinated drawing", format: "DXF", required: true },
        { id: "report", label: "QA report", format: "PDF", required: true },
      ],
    },
    referenceContext: {
      "horizontal-crs": { value: "Client-specified CRS", status: "verified", evidenceSummary: "Project control sheet" },
      "vertical-reference": { value: "Client-specified datum", status: "verified", evidenceSummary: "Level control record" },
      "linear-unit": { value: "metre", status: "verified", evidenceSummary: "Project specification" },
    },
    featureReviews: [
      { requirementId: "kerbs", status: "reviewed", evidenceReferences: ["feature-layer:KERB"] },
      { requirementId: "drainage", status: "reviewed", evidenceReferences: ["feature-layer:DRAIN"] },
    ],
    qualityChecks: [
      { requirementId: "control", status: "pass", evidenceSummary: "Control check report v2" },
      { requirementId: "coverage", status: "pass", evidenceSummary: "Coverage review v1" },
    ],
    artifacts: [
      { outputId: "drawing", fileName: "site-topo.dxf", status: "included", sha256: digest },
      { outputId: "report", fileName: "site-qa.pdf", status: "included", sha256: digest },
    ],
  };
}

describe("assessDeliverableReadiness", () => {
  it("marks a fully evidenced package ready for surveyor review, never approved", () => {
    const result = assessDeliverableReadiness(completeInput());

    expect(result).toEqual({
      state: "ready-for-surveyor-review",
      issues: [],
      blockerCount: 0,
      reviewCount: 0,
    });
    expect(result.state).not.toBe("approved");
  });

  it("blocks missing or only declared coordinate reference information", () => {
    const input = completeInput();
    delete input.referenceContext["vertical-reference"];
    input.referenceContext["horizontal-crs"] = { value: "Declared CRS", status: "declared" };

    const result = assessDeliverableReadiness(input);

    expect(result.state).toBe("blocked");
    expect(result.issues.map(({ code }) => code)).toContain("REFERENCE_MISSING");
    expect(result.issues.map(({ code }) => code)).toContain("REFERENCE_UNVERIFIED");
  });

  it("fails closed on an unrecognized stored reference status", () => {
    const input = completeInput();
    input.referenceContext["horizontal-crs"] = { value: "Unknown state", status: "unexpected" as "verified" };

    const result = assessDeliverableReadiness(input);

    expect(result.state).toBe("blocked");
    expect(result.issues.map(({ code }) => code)).toContain("REFERENCE_MISSING");
  });

  it("requires explicit feature review and evidence", () => {
    const input = completeInput();
    input.featureReviews = [
      { requirementId: "kerbs", status: "in-progress" },
      { requirementId: "drainage", status: "reviewed" },
    ];

    const result = assessDeliverableReadiness(input);

    expect(result.state).toBe("blocked");
    expect(result.issues.map(({ code }) => code)).toContain("FEATURE_REVIEW_INCOMPLETE");
    expect(result.issues.map(({ code }) => code)).toContain("FEATURE_EVIDENCE_MISSING");
  });

  it("records allowed not-applicable feature decisions for surveyor review", () => {
    const input = completeInput();
    input.featureReviews[1] = { requirementId: "drainage", status: "not-applicable", reason: "No drainage feature exists in the surveyed area." };

    const result = assessDeliverableReadiness(input);

    expect(result.state).toBe("review-required");
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "FEATURE_NOT_APPLICABLE",
      severity: "review",
      itemId: "drainage",
    }));
  });

  it("blocks required checks that were not run, failed, or have no supporting evidence", () => {
    const input = completeInput();
    input.qualityChecks = [
      { requirementId: "control", status: "not-run" },
      { requirementId: "coverage", status: "fail", evidenceSummary: "Unreviewed gaps remain." },
    ];

    const result = assessDeliverableReadiness(input);

    expect(result.state).toBe("blocked");
    expect(result.issues.map(({ code }) => code)).toContain("CHECK_NOT_RUN");
    expect(result.issues.map(({ code }) => code)).toContain("CHECK_FAILED");

    input.qualityChecks = [
      { requirementId: "control", status: "pass" },
      { requirementId: "coverage", status: "pass", evidenceSummary: "Coverage reviewed." },
    ];
    expect(assessDeliverableReadiness(input).issues.map(({ code }) => code)).toContain("CHECK_EVIDENCE_MISSING");
  });

  it("blocks required outputs that are absent, not included, or missing a declared digest", () => {
    const input = completeInput();
    input.artifacts = [
      { outputId: "drawing", fileName: "site-topo.dxf", status: "reviewed" },
      { outputId: "report", fileName: "site-qa.pdf", status: "included", sha256: "bad" },
    ];

    const result = assessDeliverableReadiness(input);

    expect(result.state).toBe("blocked");
    expect(result.issues.map(({ code }) => code)).toContain("OUTPUT_NOT_INCLUDED");
    expect(result.issues.map(({ code }) => code)).toContain("OUTPUT_HASH_MISSING_OR_INVALID");
  });

  it("rejects duplicate or unknown review records rather than silently ignoring them", () => {
    const input = completeInput();
    input.featureReviews.push(input.featureReviews[0]!);
    expect(() => assessDeliverableReadiness(input)).toThrow("duplicate id 'kerbs'");

    input.featureReviews.pop();
    input.qualityChecks.push({ requirementId: "invented-check", status: "pass", evidenceSummary: "Unknown" });
    expect(() => assessDeliverableReadiness(input)).toThrow("unknown requirement id");
  });

  it("allows project teams to define optional checks and outputs without inventing global requirements", () => {
    const input = completeInput();
    input.profile.features = input.profile.features.map((item) => ({ ...item, required: false }));
    input.profile.checks = [{ id: "optional", label: "Optional method check", required: false }];
    input.profile.outputs = [{ id: "optional", label: "Optional model", format: "IFC", required: false }];
    input.featureReviews = [];
    input.qualityChecks = [];
    input.artifacts = [];

    expect(assessDeliverableReadiness(input).state).toBe("ready-for-surveyor-review");
  });
});
