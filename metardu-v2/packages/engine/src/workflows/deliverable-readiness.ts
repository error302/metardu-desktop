/**
 * Country-neutral completeness gate for a survey deliverable package.
 *
 * A practice or client supplies the profile: METARDU does not prescribe
 * jurisdictional feature codes, accuracy tolerances, or legal requirements.
 * This evaluator checks that the declared review, reference, QA, and output
 * records are present before a package is handed to a surveyor for review.
 * It does not inspect geometry, recompute survey accuracy, hash files, or
 * approve a professional deliverable.
 */

import { MAX_TOPOGRAPHIC_TIN_POINTS } from "./topographic.js";
import type { TopographicPointCodeEvidence } from "./topographic-feature-evidence.js";

export type CoordinateReferenceField = "horizontal-crs" | "vertical-reference" | "linear-unit" | "coordinate-epoch";

export interface DeliverableRequirement {
  id: string;
  label: string;
  required: boolean;
}

export interface FeatureRequirement extends DeliverableRequirement {
  /** A reviewed feature may be marked not applicable only when this is true. */
  allowNotApplicable?: boolean;
  /** Optional client/practice point codes to check for presence in a retained topographic draft. */
  sourceCodes?: string[];
}

export interface OutputRequirement extends DeliverableRequirement {
  format: string;
}

export interface DeliverableProfile {
  id: string;
  name: string;
  /** Reference fields required by this project/client profile. */
  referenceFields: CoordinateReferenceField[];
  /** Feature classes to extract and review, defined by the project team. */
  features: FeatureRequirement[];
  /** Required project QA checks; criteria remain profile-owned. */
  checks: DeliverableRequirement[];
  /** Outputs expected in the handoff package. */
  outputs: OutputRequirement[];
}

export interface ReferenceValue {
  value: string;
  status: "missing" | "declared" | "verified";
  evidenceSummary?: string;
}

export interface DeliverableReferenceContext {
  "horizontal-crs"?: ReferenceValue;
  "vertical-reference"?: ReferenceValue;
  "linear-unit"?: ReferenceValue;
  "coordinate-epoch"?: ReferenceValue;
}

export interface FeatureReview {
  requirementId: string;
  status: "not-started" | "in-progress" | "reviewed" | "not-applicable";
  /** Evidence pointer or review record identifier; not fetched or validated here. */
  evidenceReferences?: string[];
  reason?: string;
}

export interface QualityCheckReview {
  requirementId: string;
  status: "not-run" | "pass" | "warning" | "fail";
  evidenceSummary?: string;
}

export interface IncludedArtifact {
  outputId: string;
  fileName: string;
  status: "draft" | "reviewed" | "included";
  /** Declared SHA-256 digest. This module validates its shape, not file bytes. */
  sha256?: string;
}

export interface DeliverableReadinessInput {
  profile: DeliverableProfile;
  referenceContext: DeliverableReferenceContext;
  featureReviews: FeatureReview[];
  qualityChecks: QualityCheckReview[];
  artifacts: IncludedArtifact[];
  /** Derived from the active project's retained TopographicView output; never persisted as review evidence. */
  topographicPointCodes?: TopographicPointCodeEvidence;
}

export type DeliverableReadinessState = "blocked" | "review-required" | "ready-for-surveyor-review";
export type DeliverableIssueSeverity = "blocker" | "review";

export interface DeliverableReadinessIssue {
  code:
    | "PROFILE_HORIZONTAL_CRS_REQUIRED"
    | "PROFILE_NO_REQUIRED_CHECK"
    | "PROFILE_NO_REQUIRED_OUTPUT"
    | "REFERENCE_MISSING"
    | "REFERENCE_UNVERIFIED"
    | "REFERENCE_EVIDENCE_MISSING"
    | "FEATURE_REVIEW_MISSING"
    | "FEATURE_REVIEW_INCOMPLETE"
    | "FEATURE_EVIDENCE_MISSING"
    | "FEATURE_NOT_APPLICABLE"
    | "FEATURE_POINT_CODE_EVIDENCE_UNAVAILABLE"
    | "FEATURE_POINT_CODES_NOT_OBSERVED"
    | "CHECK_NOT_RUN"
    | "CHECK_FAILED"
    | "CHECK_WARNING"
    | "CHECK_EVIDENCE_MISSING"
    | "OUTPUT_MISSING"
    | "OUTPUT_NOT_INCLUDED"
    | "OUTPUT_NAME_MISSING"
    | "OUTPUT_HASH_MISSING_OR_INVALID";
  severity: DeliverableIssueSeverity;
  itemId: string;
  message: string;
}

export interface DeliverableReadinessAssessment {
  state: DeliverableReadinessState;
  issues: DeliverableReadinessIssue[];
  blockerCount: number;
  reviewCount: number;
}

const MAX_REQUIREMENTS_PER_GROUP = 250;
const SHA256_HEX = /^[a-f0-9]{64}$/i;

function assertUniqueIds(items: readonly { id: string; label: string; required: boolean }[], group: string): void {
  if (!Array.isArray(items) || items.length > MAX_REQUIREMENTS_PER_GROUP) {
    throw new Error(`${group} must be an array of at most ${MAX_REQUIREMENTS_PER_GROUP} items.`);
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || item.id.trim() === "") {
      throw new Error(`${group} contains an item without a non-empty id.`);
    }
    if (!nonEmpty(item.label) || typeof item.required !== "boolean") {
      throw new Error(`${group} item '${item.id}' must have a label and required flag.`);
    }
    if (seen.has(item.id)) throw new Error(`${group} contains duplicate id '${item.id}'.`);
    seen.add(item.id);
  }
}

function assertKnownIds<T extends { requirementId: string }>(
  records: readonly T[], requirements: readonly DeliverableRequirement[], group: string,
): Map<string, T> {
  if (!Array.isArray(records) || records.length > MAX_REQUIREMENTS_PER_GROUP) {
    throw new Error(`${group} must be an array of at most ${MAX_REQUIREMENTS_PER_GROUP} items.`);
  }
  const known = new Set(requirements.map(({ id }) => id));
  const indexed = new Map<string, T>();
  for (const record of records) {
    if (!record || typeof record.requirementId !== "string" || !known.has(record.requirementId)) {
      throw new Error(`${group} contains an unknown requirement id.`);
    }
    if (indexed.has(record.requirementId)) throw new Error(`${group} contains duplicate id '${record.requirementId}'.`);
    indexed.set(record.requirementId, record);
  }
  return indexed;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function indexTopographicPointCodeEvidence(value: unknown): { counts?: Map<string, number>; message: string } {
  if (value === undefined) return { message: "No retained topographic draft is available for the mapped point codes." };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { message: "Retained topographic point-code evidence is malformed." };
  }
  const evidence = value as Record<string, unknown>;
  if (evidence.state !== "available") {
    return {
      message: typeof evidence.message === "string" && evidence.message.trim()
        ? evidence.message
        : "Retained topographic point-code evidence is unavailable.",
    };
  }
  if (!Number.isSafeInteger(evidence.vertexCount) || (evidence.vertexCount as number) < 3
    || (evidence.vertexCount as number) > MAX_TOPOGRAPHIC_TIN_POINTS
    || !Number.isSafeInteger(evidence.codedVertexCount) || (evidence.codedVertexCount as number) < 0
    || (evidence.codedVertexCount as number) > (evidence.vertexCount as number)
    || !Array.isArray(evidence.codeCounts)
    || evidence.codeCounts.length > (evidence.vertexCount as number)) {
    return { message: "Retained topographic point-code summary has invalid counts." };
  }
  const counts = new Map<string, number>();
  let summedCount = 0;
  for (const item of evidence.codeCounts) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { message: "Retained topographic point-code summary contains an invalid code record." };
    }
    const record = item as Record<string, unknown>;
    if (!nonEmpty(record.code) || record.code.length > 120
      || !Number.isSafeInteger(record.vertexCount) || (record.vertexCount as number) <= 0
      || (record.vertexCount as number) > (evidence.vertexCount as number)) {
      return { message: "Retained topographic point-code summary contains an invalid code count." };
    }
    const normalized = record.code.trim().toUpperCase();
    if (counts.has(normalized)) return { message: "Retained topographic point-code summary contains duplicate codes." };
    counts.set(normalized, record.vertexCount as number);
    summedCount += record.vertexCount as number;
  }
  if (summedCount !== evidence.codedVertexCount) {
    return { message: "Retained topographic point-code totals do not reconcile." };
  }
  return { counts, message: "" };
}

/**
 * Assess whether the package is complete enough for a surveyor's final review.
 * It intentionally never returns an approved, accurate, or legally complete state.
 */
export function assessDeliverableReadiness(input: DeliverableReadinessInput): DeliverableReadinessAssessment {
  const { profile } = input;
  if (!profile || !nonEmpty(profile.id) || !nonEmpty(profile.name)) {
    throw new Error("Deliverable profile must have a non-empty id and name.");
  }
  assertUniqueIds(profile.features, "Profile features");
  for (const feature of profile.features) {
    if (feature.sourceCodes === undefined) continue;
    if (!Array.isArray(feature.sourceCodes) || feature.sourceCodes.length > 100) {
      throw new Error(`Feature '${feature.id}' source codes must be an array of at most 100 items.`);
    }
    const codes = new Set<string>();
    for (const code of feature.sourceCodes) {
      if (!nonEmpty(code) || code.trim().length > 120) {
        throw new Error(`Feature '${feature.id}' source codes must be non-empty strings of at most 120 characters.`);
      }
      const normalized = code.trim().toUpperCase();
      if (codes.has(normalized)) throw new Error(`Feature '${feature.id}' contains duplicate source code '${code}'.`);
      codes.add(normalized);
    }
  }
  assertUniqueIds(profile.checks, "Profile checks");
  assertUniqueIds(profile.outputs, "Profile outputs");
  if (profile.features.some(({ allowNotApplicable }) => allowNotApplicable !== undefined && typeof allowNotApplicable !== "boolean")) {
    throw new Error("Profile feature allowNotApplicable values must be boolean when provided.");
  }
  if (!Array.isArray(profile.referenceFields)
    || profile.referenceFields.length > MAX_REQUIREMENTS_PER_GROUP
    || new Set(profile.referenceFields).size !== profile.referenceFields.length
    || profile.referenceFields.some((field) => !["horizontal-crs", "vertical-reference", "linear-unit", "coordinate-epoch"].includes(field))) {
    throw new Error("Profile reference fields must be unique and within the supported limit.");
  }
  for (const output of profile.outputs) {
    if (!nonEmpty(output.format)) throw new Error(`Profile output '${output.id}' must have a format.`);
  }

  if (!Array.isArray(input.artifacts)) throw new Error("Artifacts must be an array.");

  const featureReviews = assertKnownIds(input.featureReviews, profile.features, "Feature reviews");
  const qualityChecks = assertKnownIds(input.qualityChecks, profile.checks, "Quality checks");
  for (const review of featureReviews.values()) {
    if (!("not-started in-progress reviewed not-applicable").split(" ").includes(review.status)) {
      throw new Error(`Feature '${review.requirementId}' has an invalid review status.`);
    }
    if (review.evidenceReferences !== undefined && !Array.isArray(review.evidenceReferences)) {
      throw new Error(`Feature '${review.requirementId}' evidence references must be an array.`);
    }
  }
  for (const check of qualityChecks.values()) {
    if (!("not-run pass warning fail").split(" ").includes(check.status)) {
      throw new Error(`Check '${check.requirementId}' has an invalid status.`);
    }
  }
  assertKnownIds(
    input.artifacts.map(({ outputId, ...artifact }) => ({ ...artifact, requirementId: outputId })),
    profile.outputs,
    "Artifacts",
  );
  const artifactByOutput = new Map<string, IncludedArtifact>();
  for (const artifact of input.artifacts) artifactByOutput.set(artifact.outputId, artifact);

  const issues: DeliverableReadinessIssue[] = [];
  const add = (code: DeliverableReadinessIssue["code"], severity: DeliverableIssueSeverity, itemId: string, message: string) => {
    issues.push({ code, severity, itemId, message });
  };
  const topographicPointCodeEvidence = indexTopographicPointCodeEvidence(input.topographicPointCodes);

  if (!profile.referenceFields.includes("horizontal-crs")) {
    add("PROFILE_HORIZONTAL_CRS_REQUIRED", "blocker", profile.id, "Every survey delivery profile must require an explicit horizontal coordinate reference; a local grid may be named without an EPSG code.");
  }
  if (!profile.checks.some(({ required }) => required)) {
    add("PROFILE_NO_REQUIRED_CHECK", "blocker", profile.id, "Configure at least one required QA check before assessing package readiness.");
  }
  if (!profile.outputs.some(({ required }) => required)) {
    add("PROFILE_NO_REQUIRED_OUTPUT", "blocker", profile.id, "Configure at least one required client deliverable before assessing package readiness.");
  }

  for (const field of profile.referenceFields) {
    const reference = input.referenceContext?.[field];
    if (!reference
      || !("missing declared verified").split(" ").includes(reference.status)
      || reference.status === "missing"
      || !nonEmpty(reference.value)) {
      add("REFERENCE_MISSING", "blocker", field, `Required ${field} is missing.`);
    } else if (reference.status === "declared") {
      add("REFERENCE_UNVERIFIED", "review", field, `${field} is declared but not verified.`);
    } else if (reference.status === "verified" && !nonEmpty(reference.evidenceSummary)) {
      add("REFERENCE_EVIDENCE_MISSING", "blocker", field, `Verified ${field} has no evidence summary.`);
    }
  }

  for (const requirement of profile.features) {
    const featureReview = featureReviews.get(requirement.id);
    const mappedCodes = requirement.sourceCodes ?? [];
    const isAllowedNotApplicable = featureReview?.status === "not-applicable"
      && requirement.allowNotApplicable
      && nonEmpty(featureReview.reason);
    if (requirement.required && mappedCodes.length > 0 && !isAllowedNotApplicable) {
      if (!topographicPointCodeEvidence.counts) {
        add(
          "FEATURE_POINT_CODE_EVIDENCE_UNAVAILABLE",
          "blocker",
          requirement.id,
          `Mapped point codes for '${requirement.label}' cannot be checked: ${topographicPointCodeEvidence.message}`,
        );
      } else {
        const matchingVertices = mappedCodes.reduce(
          (total, code) => total + (topographicPointCodeEvidence.counts!.get(code.trim().toUpperCase()) ?? 0),
          0,
        );
        if (matchingVertices === 0) {
          add(
            "FEATURE_POINT_CODES_NOT_OBSERVED",
            "blocker",
            requirement.id,
            `None of the mapped point codes (${mappedCodes.join(", ")}) for required feature '${requirement.label}' appear in the retained topographic draft.`,
          );
        }
      }
    }
    if (!requirement.required) continue;
    const review = featureReview;
    if (!review) {
      add("FEATURE_REVIEW_MISSING", "blocker", requirement.id, `Required feature '${requirement.label}' has no review record.`);
    } else if (review.status === "not-started" || review.status === "in-progress") {
      add("FEATURE_REVIEW_INCOMPLETE", "blocker", requirement.id, `Required feature '${requirement.label}' is not reviewed.`);
    } else if (review.status === "reviewed" && (!review.evidenceReferences?.some(nonEmpty))) {
      add("FEATURE_EVIDENCE_MISSING", "blocker", requirement.id, `Reviewed feature '${requirement.label}' has no evidence reference.`);
    } else if (review.status === "not-applicable") {
      if (!nonEmpty(review.reason)) {
        add("FEATURE_NOT_APPLICABLE", "blocker", requirement.id, `Feature '${requirement.label}' is marked not applicable without a reason.`);
      } else if (!requirement.allowNotApplicable) {
        add("FEATURE_NOT_APPLICABLE", "blocker", requirement.id, `Profile requires '${requirement.label}'; its not-applicable exception cannot satisfy the requirement.`);
      } else {
        add("FEATURE_NOT_APPLICABLE", "review", requirement.id, `Surveyor review is required for the '${requirement.label}' exception.`);
      }
    }
  }

  for (const requirement of profile.checks) {
    const check = qualityChecks.get(requirement.id);
    if (!check || check.status === "not-run") {
      if (requirement.required) add("CHECK_NOT_RUN", "blocker", requirement.id, `Required check '${requirement.label}' has not been run.`);
    } else if (check.status === "pass" && !nonEmpty(check.evidenceSummary)) {
      add("CHECK_EVIDENCE_MISSING", requirement.required ? "blocker" : "review", requirement.id, `Check '${requirement.label}' has no evidence summary.`);
    } else if (check.status === "warning") {
      add("CHECK_WARNING", "review", requirement.id, `Check '${requirement.label}' needs surveyor review${nonEmpty(check.evidenceSummary) ? `: ${check.evidenceSummary}` : "."}`);
    } else if (check.status === "fail") {
      add("CHECK_FAILED", requirement.required ? "blocker" : "review", requirement.id, `Check '${requirement.label}' failed${nonEmpty(check.evidenceSummary) ? `: ${check.evidenceSummary}` : "."}`);
    }
  }

  for (const requirement of profile.outputs) {
    const artifact = artifactByOutput.get(requirement.id);
    if (artifact && !("draft reviewed included").split(" ").includes(artifact.status)) {
      throw new Error(`Output '${requirement.id}' has an invalid inclusion status.`);
    }
    if (!requirement.required) continue;
    if (!artifact) {
      add("OUTPUT_MISSING", "blocker", requirement.id, `Required ${requirement.format} output '${requirement.label}' is missing.`);
    } else if (artifact.status !== "included") {
      add("OUTPUT_NOT_INCLUDED", "blocker", requirement.id, `Required output '${requirement.label}' is not included in the package.`);
    } else if (!nonEmpty(artifact.fileName)) {
      add("OUTPUT_NAME_MISSING", "blocker", requirement.id, `Included output '${requirement.label}' has no file name.`);
    } else if (!nonEmpty(artifact.sha256) || !SHA256_HEX.test(artifact.sha256)) {
      add("OUTPUT_HASH_MISSING_OR_INVALID", "blocker", requirement.id, `Included output '${requirement.label}' has no valid declared SHA-256 digest.`);
    }
  }

  const blockerCount = issues.filter(({ severity }) => severity === "blocker").length;
  const reviewCount = issues.length - blockerCount;
  const state: DeliverableReadinessState = blockerCount > 0
    ? "blocked"
    : reviewCount > 0
      ? "review-required"
      : "ready-for-surveyor-review";
  return { state, issues, blockerCount, reviewCount };
}
