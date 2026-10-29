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

export interface PointCloudProjectSourceList {
  activeProjectName: string | null;
  sources: PointCloudSourceSummary[];
}

export type PointCloudImportResult =
  | { canceled: true }
  | { canceled: false; projectName: string; source: PointCloudSourceSummary };
