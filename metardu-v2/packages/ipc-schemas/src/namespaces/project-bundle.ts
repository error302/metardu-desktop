import { z } from "zod";

export const PROJECT_BUNDLE_OPERATION_ID_SCHEMA = z.string().uuid();
export const PROJECT_BUNDLE_MAX_MANIFEST_BYTES = 128 * 1024 * 1024;

const decimalBytes = z.string().regex(/^(0|[1-9]\d{0,19})$/).refine((value) => {
  try {
    return BigInt(value) <= 18_446_744_073_709_551_615n;
  } catch {
    return false;
  }
}, "Byte count exceeds the supported unsigned 64-bit range.");

const isoOrLegacyTimestamp = z.string().min(1).max(100);
const rawJson = (maxBytes: number) => z.string().max(maxBytes).superRefine((value, context) => {
  try {
    JSON.parse(value);
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Stored project data is not valid JSON." });
  }
});

const PROJECT_ROW_SCHEMA = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(16_384),
  description: z.string().max(65_536).nullable(),
  countryCode: z.string().max(128),
  crsSrid: z.number().int().nullable(),
  coordinateContextJson: z.string().max(16_384).nullable(),
  surveyType: z.string().max(512),
  sourceView: z.string().max(512),
  outputJson: rawJson(PROJECT_BUNDLE_MAX_MANIFEST_BYTES).nullable(),
  planSheetJson: rawJson(65_536).nullable(),
  createdAt: isoOrLegacyTimestamp,
  updatedAt: isoOrLegacyTimestamp,
  version: z.number().int().nonnegative(),
}).strict();

const INSPECTION_ROW_SCHEMA = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  readerVersion: z.string().min(1).max(256),
  inspectionJson: rawJson(16 * 1024 * 1024),
  inspectedAt: isoOrLegacyTimestamp,
}).strict();

const SOURCE_ROW_SCHEMA = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  fileName: z.string().min(1).max(16_384).refine((value) => !/[\\/\0]/.test(value), "Source names must not contain path separators."),
  storageKey: z.string().regex(/^[a-f0-9]{64}\.(las|laz)$/),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  fileSizeBytes: decimalBytes,
  sourceExtension: z.enum(["las", "laz"]),
  format: z.enum(["LAS", "LAZ"]),
  headerJson: rawJson(16 * 1024 * 1024),
  coordinateContextJson: z.string().max(16_384).nullable(),
  importedAt: isoOrLegacyTimestamp,
  inspections: z.array(INSPECTION_ROW_SCHEMA).max(100_000),
}).strict().superRefine((source, context) => {
  if (source.storageKey !== `${source.contentSha256}.${source.sourceExtension}`) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["storageKey"], message: "Storage key must be derived from its source digest and extension." });
  }
  for (const [index, inspection] of source.inspections.entries()) {
    if (inspection.sourceId !== source.id) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["inspections", index, "sourceId"], message: "Inspection references a different source." });
    }
    if (inspection.sourceSha256 !== source.contentSha256) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["inspections", index, "sourceSha256"], message: "Inspection digest differs from its source." });
    }
    try {
      const report = JSON.parse(inspection.inspectionJson) as { readerVersion?: unknown };
      if (report.readerVersion !== inspection.readerVersion) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["inspections", index, "readerVersion"], message: "Inspection reader version differs from its report." });
      }
    } catch {
      // The nested JSON schema already reports invalid JSON.
    }
  }
});

export const PROJECT_BUNDLE_SNAPSHOT_SCHEMA = z.object({
  format: z.literal("metardu-project-bundle"),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  project: PROJECT_ROW_SCHEMA,
  pointCloudSources: z.array(SOURCE_ROW_SCHEMA).max(10_000),
}).strict().superRefine((bundle, context) => {
  const sourceIds = new Set<string>();
  const storageKeys = new Set<string>();
  for (const [index, source] of bundle.pointCloudSources.entries()) {
    if (source.projectId !== bundle.project.id) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["pointCloudSources", index, "projectId"], message: "Source is not linked to the bundled project." });
    }
    if (sourceIds.has(source.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["pointCloudSources", index, "id"], message: "Duplicate point-cloud source identity." });
    }
    sourceIds.add(source.id);
    if (storageKeys.has(source.storageKey)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["pointCloudSources", index, "storageKey"], message: "Duplicate point-cloud source object." });
    }
    storageKeys.add(source.storageKey);
  }
});

export const PROJECT_BUNDLE_EXPORT_INPUT_SCHEMA = z.object({
  operationId: PROJECT_BUNDLE_OPERATION_ID_SCHEMA,
  projectId: z.string().uuid(),
}).strict();

export const PROJECT_BUNDLE_IMPORT_INPUT_SCHEMA = z.object({
  operationId: PROJECT_BUNDLE_OPERATION_ID_SCHEMA,
}).strict();

export const PROJECT_BUNDLE_CANCEL_INPUT_SCHEMA = z.object({
  operationId: PROJECT_BUNDLE_OPERATION_ID_SCHEMA,
}).strict();

export const PROJECT_BUNDLE_PROGRESS_SCHEMA = z.object({
  operationId: PROJECT_BUNDLE_OPERATION_ID_SCHEMA,
  operation: z.enum(["export", "import"]),
  phase: z.enum(["preparing", "copying", "verifying", "publishing", "complete"]),
  completedBytes: decimalBytes,
  totalBytes: decimalBytes,
  completedFiles: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
}).strict();

export const PROJECT_BUNDLE_EXPORT_RESULT_SCHEMA = z.discriminatedUnion("canceled", [
  z.object({ canceled: z.literal(true) }).strict(),
  z.object({
    canceled: z.literal(false),
    bundlePath: z.string().min(1).max(32_768),
    projectName: z.string().min(1).max(16_384),
    sourceCount: z.number().int().nonnegative().max(10_000),
    totalBytes: decimalBytes,
  }).strict(),
]);

export const PROJECT_BUNDLE_IMPORT_RESULT_SCHEMA = z.discriminatedUnion("canceled", [
  z.object({ canceled: z.literal(true) }).strict(),
  z.object({
    canceled: z.literal(false),
    project: z.object({ id: z.string().uuid(), name: z.string().min(1).max(16_384) }).strict(),
    sourceCount: z.number().int().nonnegative().max(10_000),
    totalBytes: decimalBytes,
  }).strict(),
]);

export const PROJECT_BUNDLE_CANCEL_RESULT_SCHEMA = z.object({ accepted: z.boolean() }).strict();

export type ProjectBundleSnapshot = z.infer<typeof PROJECT_BUNDLE_SNAPSHOT_SCHEMA>;
export type ProjectBundleProgress = z.infer<typeof PROJECT_BUNDLE_PROGRESS_SCHEMA>;
export type ProjectBundleExportInput = z.infer<typeof PROJECT_BUNDLE_EXPORT_INPUT_SCHEMA>;
export type ProjectBundleImportInput = z.infer<typeof PROJECT_BUNDLE_IMPORT_INPUT_SCHEMA>;
export type ProjectBundleCancelInput = z.infer<typeof PROJECT_BUNDLE_CANCEL_INPUT_SCHEMA>;
export type ProjectBundleCancelResult = z.infer<typeof PROJECT_BUNDLE_CANCEL_RESULT_SCHEMA>;
export type ProjectBundleExportResult = z.infer<typeof PROJECT_BUNDLE_EXPORT_RESULT_SCHEMA>;
export type ProjectBundleImportResult = z.infer<typeof PROJECT_BUNDLE_IMPORT_RESULT_SCHEMA>;
