import { z } from "zod";

const ID = z.string().trim().min(1).max(120);
const LABEL = z.string().trim().min(1).max(300);
const REQUIREMENT = z.object({ id: ID, label: LABEL, required: z.boolean() }).strict();

export const PROJECT_DELIVERABLE_REVIEW_SCHEMA = z.object({
  profile: z.object({
    id: ID,
    name: LABEL,
    referenceFields: z.array(z.enum(["horizontal-crs", "vertical-reference", "linear-unit", "coordinate-epoch"])).max(4),
    features: z.array(REQUIREMENT.extend({
      allowNotApplicable: z.boolean().optional(),
      /** Optional project-local codes whose presence is checked against a retained topo draft. */
      sourceCodes: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
    })).max(250),
    checks: z.array(REQUIREMENT).max(250),
    outputs: z.array(REQUIREMENT.extend({ format: LABEL })).max(250),
  }).strict(),
  referenceContext: z.object({
    "horizontal-crs": z.object({ value: z.string().max(500), status: z.enum(["missing", "declared", "verified"]), evidenceSummary: z.string().max(2000).optional() }).strict().optional(),
    "vertical-reference": z.object({ value: z.string().max(500), status: z.enum(["missing", "declared", "verified"]), evidenceSummary: z.string().max(2000).optional() }).strict().optional(),
    "linear-unit": z.object({ value: z.string().max(100), status: z.enum(["missing", "declared", "verified"]), evidenceSummary: z.string().max(2000).optional() }).strict().optional(),
    "coordinate-epoch": z.object({ value: z.string().max(100), status: z.enum(["missing", "declared", "verified"]), evidenceSummary: z.string().max(2000).optional() }).strict().optional(),
  }).strict(),
  featureReviews: z.array(z.object({
    requirementId: ID,
    status: z.enum(["not-started", "in-progress", "reviewed", "not-applicable"]),
    evidenceReferences: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
    reason: z.string().max(2000).optional(),
  }).strict()).max(250),
  qualityChecks: z.array(z.object({
    requirementId: ID,
    status: z.enum(["not-run", "pass", "warning", "fail"]),
    evidenceSummary: z.string().max(2000).optional(),
  }).strict()).max(250),
  artifacts: z.array(z.object({
    outputId: ID,
    fileName: z.string().max(512).refine((value) => !/[\\/\0]/.test(value), "Store a file name, not a path."),
    status: z.enum(["draft", "reviewed", "included"]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  }).strict()).max(250),
}).strict().superRefine((review, context) => {
  const unique = (values: string[], path: (string | number)[], label: string) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) context.addIssue({ code: z.ZodIssueCode.custom, path: [...path, index], message: `${label} IDs must be unique.` });
      seen.add(value);
    });
  };
  unique(review.profile.referenceFields, ["profile", "referenceFields"], "Reference field");
  unique(review.profile.features.map(({ id }) => id), ["profile", "features"], "Feature");
  review.profile.features.forEach((feature, index) => {
    if (feature.sourceCodes) {
      unique(
        feature.sourceCodes.map((code) => code.toUpperCase()),
        ["profile", "features", index, "sourceCodes"],
        "Feature source code",
      );
    }
  });
  unique(review.profile.checks.map(({ id }) => id), ["profile", "checks"], "Check");
  unique(review.profile.outputs.map(({ id }) => id), ["profile", "outputs"], "Output");
  unique(review.featureReviews.map(({ requirementId }) => requirementId), ["featureReviews"], "Feature review");
  unique(review.qualityChecks.map(({ requirementId }) => requirementId), ["qualityChecks"], "Quality check");
  unique(review.artifacts.map(({ outputId }) => outputId), ["artifacts"], "Artifact");

  if (!review.profile.referenceFields.includes("horizontal-crs")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["profile", "referenceFields"], message: "A delivery profile must require an explicit horizontal coordinate reference." });
  }
  if (!review.profile.checks.some(({ required }) => required)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["profile", "checks"], message: "At least one required QA check must be defined." });
  }
  if (!review.profile.outputs.some(({ required }) => required)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["profile", "outputs"], message: "At least one required output must be defined." });
  }

  const featureIds = new Set(review.profile.features.map(({ id }) => id));
  review.featureReviews.forEach((item, index) => {
    if (!featureIds.has(item.requirementId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["featureReviews", index, "requirementId"], message: "Review references an unknown feature requirement." });
  });
  const checkIds = new Set(review.profile.checks.map(({ id }) => id));
  review.qualityChecks.forEach((item, index) => {
    if (!checkIds.has(item.requirementId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["qualityChecks", index, "requirementId"], message: "Review references an unknown QA requirement." });
  });
  const outputIds = new Set(review.profile.outputs.map(({ id }) => id));
  review.artifacts.forEach((item, index) => {
    if (!outputIds.has(item.outputId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["artifacts", index, "outputId"], message: "Artifact references an unknown output requirement." });
    if (item.status === "included" && item.fileName.trim() === "") context.addIssue({ code: z.ZodIssueCode.custom, path: ["artifacts", index, "fileName"], message: "Included outputs need a file name." });
  });
});

export type ProjectDeliverableReview = z.infer<typeof PROJECT_DELIVERABLE_REVIEW_SCHEMA>;
