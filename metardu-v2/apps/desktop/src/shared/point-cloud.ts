export interface PointCloudHeaderDetails {
  format: "LAS" | "LAZ";
  version: string;
  headerDeclaredPointCount: string;
  pointFormatId: number;
  pointRecordAttributes: { gpsTime: boolean; rgb: boolean; nearInfrared: boolean; waveform: boolean; extraBytes: number };
  bounds: { min: Record<"x" | "y" | "z", number | null>; max: Record<"x" | "y" | "z", number | null> };
  coordinateScale: Record<"x" | "y" | "z", number | null>;
  coordinateOffset: Record<"x" | "y" | "z", number | null>;
  crsEvidence: { hasAnyCrsRecord: boolean; hasWktCrs: boolean; wktCrs: string | null; geoTiffCrsDecoded: boolean };
  headerDeclaredPointsByReturn: Array<{ returnNumber: number; headerDeclaredPointCount: string | null }>;
  copcInfoRecordPresent: boolean;
  warnings: string[];
}

/** Renderer-safe project source summary. The content-address key and any path stay in main. */
export interface PointCloudSourceSummary {
  id: string;
  fileName: string;
  fileSizeBytes: string;
  contentSha256: string;
  format: "LAS" | "LAZ";
  importedAt: string;
  storageStatus: PointCloudSourceIntegrityStatus;
  header: PointCloudHeaderDetails;
  recordInspection: PointCloudRecordInspection | null;
}

export interface PointCloudRecordInspection {
  id: string;
  sourceSha256: string;
  inspectedAt: string;
  format: "LAS" | "LAZ";
  version: string;
  pointFormatId: number;
  readerVersion: string;
  headerDeclaredPointCount: string;
  decodedPointCount: string;
  headerCountMatchesDecoded: boolean;
  classificationCounts: Array<{ code: number; count: string }>;
  returnCounts: Array<{ returnNumber: number; count: string }>;
  numberOfReturnsCounts: Array<{ numberOfReturns: number; count: string }>;
  headerReturnCountComparison: Array<{
    returnNumber: number;
    headerDeclaredCount: string | null;
    decodedCount: string;
    matchesHeader: boolean | null;
  }>;
  returnCountsMatchHeader: boolean;
  invalidReturnMetadataPointCount: string;
  nonFiniteCoordinatePointCount: string;
  decodedBounds: {
    min: Record<"x" | "y" | "z", number | null>;
    max: Record<"x" | "y" | "z", number | null>;
  };
  headerBoundsContainDecodedPoints: boolean | null;
  coordinateInterpretation: string;
  warnings: string[];
}

export type PointCloudSourceIntegrityStatus =
  | "verified"
  | "notChecked"
  | "missing"
  | "sizeMismatch"
  | "hashMismatch"
  | "unreadable";

export interface PointCloudSourceVerification {
  sourceId: string;
  status: PointCloudSourceIntegrityStatus;
  recordedSha256: string;
  actualSha256: string | null;
  recordedSizeBytes: string;
  actualSizeBytes: string | null;
}

export interface PointCloudRecordInspectionResult {
  source: PointCloudSourceSummary;
}

export interface PointCloudProjectSourceList {
  activeProjectName: string | null;
  sources: PointCloudSourceSummary[];
}

export type PointCloudImportResult =
  | { canceled: true }
  | { canceled: false; projectName: string; source: PointCloudSourceSummary };
