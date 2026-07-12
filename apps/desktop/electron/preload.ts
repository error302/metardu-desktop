/**
 * Preload script — the secure bridge between the sandboxed renderer and the
 * privileged main process.
 *
 * Per ADR-004: contextBridge is the ONLY channel. The renderer sees a small,
 * typed API on `window.metardu`. No direct `require()` access, no Node APIs.
 *
 * Every method here is a thin wrapper around `ipcRenderer.invoke(channel, ...args)`.
 */

import { contextBridge, ipcRenderer } from 'electron';

const api = {
  app: {
    version: () => ipcRenderer.invoke('app:version') as Promise<string>,
    platform: () => ipcRenderer.invoke('app:platform') as Promise<string>,
  },
  fs: {
    newProject: (filePath: string, name: string, countryPack?: string) =>
      ipcRenderer.invoke('fs:newProject', { filePath, name, countryPack }) as Promise<{ filePath: string; projectId: string }>,
    openProject: (filePath: string) =>
      ipcRenderer.invoke('fs:openProject', filePath) as Promise<{ filePath: string }>,
    importCsv: (filePath: string, projectId?: string) =>
      ipcRenderer.invoke('fs:importCsv', filePath, projectId) as Promise<{ imported: number; projectId: string }>,
  },
  db: {
    query: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:query', sql, params) as Promise<unknown[]>,
    execute: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:execute', sql, params) as Promise<{ changes: number; lastInsertRowid: number }>,
    getPoints: (projectId?: string) =>
      ipcRenderer.invoke('db:getPoints', projectId) as Promise<SurveyPoint[]>,
    listProjects: () =>
      ipcRenderer.invoke('db:listProjects') as Promise<ProjectRow[]>,
  },
  traverse: {
    compute: (input: TraverseComputeInput) =>
      ipcRenderer.invoke('traverse:compute', input) as Promise<TraverseComputeResultPayload>,
    list: (projectId?: string) =>
      ipcRenderer.invoke('traverse:list', projectId) as Promise<unknown[]>,
    get: (traverseId: string) =>
      ipcRenderer.invoke('traverse:get', traverseId) as Promise<{ traverse: unknown; legs: unknown[]; stations: unknown[] }>,
  },
  parcel: {
    create: (data: ParcelCreateInput) =>
      ipcRenderer.invoke('parcel:create', data) as Promise<{ parcel_id: string }>,
    list: (projectId?: string) =>
      ipcRenderer.invoke('parcel:list', projectId) as Promise<unknown[]>,
    getPoints: (parcelId: string) =>
      ipcRenderer.invoke('parcel:getPoints', parcelId) as Promise<unknown[]>,
  },
  beacon: {
    create: (data: BeaconCreateInput) =>
      ipcRenderer.invoke('beacon:create', data) as Promise<{ beacon_id: string }>,
    list: (projectId?: string) =>
      ipcRenderer.invoke('beacon:list', projectId) as Promise<unknown[]>,
    update: (beaconId: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('beacon:update', beaconId, updates) as Promise<{ changes: number }>,
    delete: (beaconId: string) =>
      ipcRenderer.invoke('beacon:delete', beaconId) as Promise<{ changes: number }>,
  },
  deedPlan: {
    generate: (opts: DeedPlanGenerateInput) =>
      ipcRenderer.invoke('deedPlan:generate', opts) as Promise<{ deed_plan_id: string; pdf_path: string; pdf_hash: string }>,
    list: (projectId?: string) =>
      ipcRenderer.invoke('deedPlan:list', projectId) as Promise<unknown[]>,
    seal: (deedPlanId: string, sealPayload: SealPayload) =>
      ipcRenderer.invoke('deedPlan:seal', deedPlanId, sealPayload) as Promise<{ certificate_id: string }>,
  },
  crypto: {
    getKeypair: () =>
      ipcRenderer.invoke('crypto:getKeypair') as Promise<{ publicKeyPem: string; fingerprint: string; createdAt: string }>,
    seal: (opts: CryptoSealInput) =>
      ipcRenderer.invoke('crypto:seal', opts) as Promise<CryptoSealResult>,
    verify: (opts: { documentHash: string; signature: string; publicKeyPem: string }) =>
      ipcRenderer.invoke('crypto:verify', opts) as Promise<{ valid: boolean; algorithm: string; keyFingerprint: string; verifiedAt: string }>,
  },
  nlims: {
    export: (opts: NlimsExportInput) =>
      ipcRenderer.invoke('nlims:export', opts) as Promise<{ submission_id: string; file_path: string; integrity_hash: string; validation_warnings: unknown[] }>,
  },
  workbook: {
    generate: (opts: WorkbookGenerateInput) =>
      ipcRenderer.invoke('workbook:generate', opts) as Promise<{ file_path: string; sheets: number }>,
  },
  mutation: {
    generate: (opts: MutationGenerateInput) =>
      ipcRenderer.invoke('mutation:generate', opts) as Promise<{ file_path: string; pdf_hash: string }>,
  },
  topo: {
    generateTin: (opts: TopoTinInput) =>
      ipcRenderer.invoke('topo:generateTin', opts) as Promise<TopoTinResult>,
    generateContours: (opts: TopoContourInput) =>
      ipcRenderer.invoke('topo:generateContours', opts) as Promise<TopoContourResult>,
    importRinex: (filePath: string) =>
      ipcRenderer.invoke('topo:importRinex', filePath) as Promise<{ file_path: string; header: unknown; file_size: number }>,
    importLas: (filePath: string) =>
      ipcRenderer.invoke('topo:importLas', filePath) as Promise<{ file_path: string; file_size: number; point_count: number; points: unknown[]; metadata: unknown }>,
    getFeatureCodes: (opts?: { category?: string }) =>
      ipcRenderer.invoke('topo:getFeatureCodes', opts) as Promise<unknown[]>,
    lookupFeatureCode: (code: string) =>
      ipcRenderer.invoke('topo:lookupFeatureCode', code) as Promise<unknown | null>,
    mapPointsToLayers: (points: Array<{ number: string; easting: number; northing: number; elevation?: number; code?: string }>) =>
      ipcRenderer.invoke('topo:mapPointsToLayers', points) as Promise<unknown[]>,
  },
  qa: {
    gisReport: (opts: { points: Array<{ number: string; easting: number; northing: number; elevation?: number; code?: string }>; sourceFormat: string; projectName?: string; expectedCrs?: string }) =>
      ipcRenderer.invoke('qa:gisReport', opts) as Promise<GisQaReportResult>,
    gate: (opts: any) =>
      ipcRenderer.invoke('qa:gate', opts) as Promise<any>,
  },
  export: {
    dxf: (opts: ExportDxfInput) =>
      ipcRenderer.invoke('export:dxf', opts) as Promise<{ file_path: string; size_bytes: number }>,
    dxfSoK: (opts: any) =>
      ipcRenderer.invoke('export:dxfSoK', opts) as Promise<{ file_path: string; size_bytes: number; layers: number }>,
    landxml: (opts: ExportLandXmlInput) =>
      ipcRenderer.invoke('export:landxml', opts) as Promise<{ file_path: string; size_bytes: number }>,
    geojson: (opts: ExportGeoJsonInput) =>
      ipcRenderer.invoke('export:geojson', opts) as Promise<{ file_path: string }>,
    shapefile: (opts: ExportShapefileInput) =>
      ipcRenderer.invoke('export:shapefile', opts) as Promise<{ file_path: string; size_bytes: number }>,
  },
  plan: {
    render: (opts: any) => ipcRenderer.invoke('plan:render', opts) as Promise<any>,
    autoGenerate: (opts: any) => ipcRenderer.invoke('plan:autoGenerate', opts) as Promise<any>,
    renderTopo: (opts: any) => ipcRenderer.invoke('plan:renderTopo', opts) as Promise<any>,
    renderEngineering: (opts: any) => ipcRenderer.invoke('plan:renderEngineering', opts) as Promise<any>,
    print: (opts: any) => ipcRenderer.invoke('plan:print', opts) as Promise<any>,
    listPrinters: () => ipcRenderer.invoke('plan:listPrinters') as Promise<any>,
  },
  report: {
    generate: (opts: any) => ipcRenderer.invoke('report:generate', opts) as Promise<{
      pdfPath: string;
      pdfSizeBytes: number;
      pageCount: number;
      sealed: boolean;
      signatureFingerprint?: string;
      signedAt?: string;
      warnings: string[];
    }>,
  },
  form: {
    generateFormP: (opts: any) => ipcRenderer.invoke('form:generateFormP', opts) as Promise<{
      pdfPath: string;
      pdfSizeBytes: number;
      pageCount: number;
      sealed: boolean;
      signatureFingerprint?: string;
      signedAt?: string;
      warnings: string[];
    }>,
    generateTopoReport: (opts: any) => ipcRenderer.invoke('form:generateTopoReport', opts) as Promise<{
      pdfPath: string;
      pdfSizeBytes: number;
      pageCount: number;
      sealed: boolean;
      signatureFingerprint?: string;
      signedAt?: string;
      warnings: string[];
    }>,
    generateCrossSections: (opts: any) => ipcRenderer.invoke('form:generateCrossSections', opts) as Promise<{
      pdfPath: string;
      pdfSizeBytes: number;
      pageCount: number;
      sealed: boolean;
      signatureFingerprint?: string;
      signedAt?: string;
      warnings: string[];
    }>,
  },
  menu: {
    onFileNew: (cb: () => void) => ipcRenderer.on('menu:file:new', cb),
    onFileOpened: (cb: (filePath: string) => void) => ipcRenderer.on('menu:file:opened', (_e, filePath: string) => cb(filePath)),
    onImportCsv: (cb: (filePath: string) => void) => ipcRenderer.on('menu:file:importCsv', (_e, filePath: string) => cb(filePath)),
  },
};

export interface SurveyPoint {
  point_number: string;
  easting: number;
  northing: number;
  elevation: number | null;
  code: string | null;
  description: string | null;
  source: 'csv' | 'gnss' | 'total_station' | 'manual';
}

export interface ProjectRow {
  id: string;
  name: string;
  country_pack: string;
  default_crs_epsg: number;
  created_at: string;
  updated_at: string;
}

export interface TraverseComputeInput {
  project_id: string;
  name: string;
  survey_type?: string;
  adjustment_method?: 'bowditch' | 'transit' | 'none';
  legs: Array<{
    from_point_number: string;
    to_point_number: string;
    observed_distance: number;
    observed_bearing: number;
  }>;
  start_point?: { point_number: string; easting: number; northing: number };
  closing_point?: { point_number: string; easting: number; northing: number };
}

export interface TraverseComputeResultPayload {
  traverse_id: string;
  perimeter: number;
  linear_misclosure: number;
  angular_misclosure?: number;
  precision_ratio: number;
  precision_passes: boolean;
  precision_minimum: number;
  adjusted_legs: Array<{
    from_point_number: string;
    to_point_number: string;
    observed_distance: number;
    observed_bearing: number;
    adjusted_distance?: number;
    adjusted_bearing?: number;
    latitude: number;
    departure: number;
  }>;
  stations: Array<{
    point_number: string;
    easting: number;
    northing: number;
    correction_easting?: number;
    correction_northing?: number;
  }>;
}

export interface ParcelCreateInput {
  parcel_number: string;
  lr_number?: string;
  registry?: string;
  area_sqm?: number;
  perimeter_m?: number;
  survey_type?: string;
  traverse_id?: string;
  points?: Array<{ point_number: string; easting: number; northing: number }>;
}

export interface BeaconCreateInput {
  beacon_number: string;
  beacon_type?: string;
  easting: number;
  northing: number;
  elevation?: number;
  placed_date?: string;
  placed_by?: string;
  description?: string;
}

export interface DeedPlanGenerateInput {
  parcel_id?: string;
  traverse_id?: string;
  points: Array<{ number: string; easting: number; northing: number; is_beacon?: boolean }>;
  title_data: {
    lrNumber: string;
    area: string;
    scale: number;
    surveyorName: string;
    surveyorLicense: string;
    date: string;
    county: string;
    subCounty?: string;
    registryMapSheet?: string;
    deedPlanNumber?: string;
    projection?: string;
    datum?: string;
  };
  paper_size?: 'A1' | 'A2' | 'A3' | 'A4';
  output_dir?: string;
}

export interface SealPayload {
  surveyor_name: string;
  surveyor_license: string;
  firm_name?: string;
  certificate_text: string;
  public_key?: string;
  signature?: string;
}

export interface CryptoSealInput {
  documentHash: string;
  surveyorName: string;
  surveyorLicense: string;
  firmName?: string;
  surveyDate: string;
  parcelNumber: string;
  lrNumber: string;
  areaText: string;
  precisionRatio: number;
  traverseLegs: number;
  adjustmentMethod: string;
  deedPlanId: string;
}

export interface CryptoSealResult {
  certificate_id: string;
  signature: string;
  public_key_pem: string;
  algorithm: string;
  key_fingerprint: string;
  signed_at: string;
  certificate_text: string;
}

export interface NlimsExportInput {
  projectId?: string;
  submissionType: 'mutation' | 'subdivision' | 'amalgamation' | 'new_registration' | 'boundary_adjustment';
  registry: string;
  county: string;
  subCounty: string;
  surveyor: {
    name: string;
    licenseNumber: string;
    firm?: string;
    iskMembershipNumber?: string;
  };
  parentParcel?: {
    parcelNumber: string;
    titleDeedNumber: string;
    registryMapSheet: string;
    areaHectares: number;
    coordinates: Array<{ easting: number; northing: number }>;
  };
  resultingParcels: Array<{
    parcelNumber: string;
    lrNumber: string;
    areaHectares: number;
    coordinates: Array<{ easting: number; northing: number }>;
  }>;
  beacons: Array<{
    beaconNumber: string;
    beaconType: string;
    easting: number;
    northing: number;
    elevation?: number;
  }>;
  encumbrances?: Array<{
    type: string;
    description: string;
    holder?: string;
  }>;
  outputDir?: string;
}

export interface WorkbookGenerateInput {
  projectId?: string;
  project: {
    name: string;
    lrNumber: string;
    parcelNumber: string;
    county: string;
    division: string;
    district: string;
    locality: string;
    surveyType: string;
    surveyDate: string;
    scaleDenominator: number;
  };
  surveyor: {
    name: string;
    iskNumber: string;
    firmName: string;
  };
  submission: {
    referenceNumber: string;
    revision: number;
    status: string;
  };
  fieldObservations: Array<{
    stationFrom: string;
    stationTo: string;
    observedBearingDeg?: number;
    observedDistanceM?: number;
    reducedLevelM?: number;
  }>;
  outputDir?: string;
}

export interface MutationGenerateInput {
  projectId?: string;
  parentLRNumber: string;
  parentParcelNumber: string;
  parentAreaHa: number;
  resultingParcels: Array<{
    parcelNumber: string;
    areaHa: number;
    owner?: string;
  }>;
  county: string;
  division: string;
  district: string;
  locality: string;
  registryMapSheet: string;
  mutationType: 'subdivision' | 'amalgamation' | 'boundary_adjustment' | 'resurvey';
  reasonForMutation: string;
  affectedBeacons: Array<{
    beaconId: string;
    action: 'new' | 'disturbed' | 'adopted' | 'cancelled';
    easting: number;
    northing: number;
  }>;
  surveyorName: string;
  iskNumber: string;
  firmName: string;
  surveyDate: string;
  referenceNumber: string;
  outputDir?: string;
}

// ─── Topographic types (M4) ────────────────────────────────────────────

export interface TopoTinInput {
  points: Array<{ easting: number; northing: number; elevation: number }>;
  breaklines?: Array<{
    points: Array<{ easting: number; northing: number; elevation: number }>;
    type: 'hard' | 'soft' | 'ridge' | 'valley';
  }>;
}

export interface TopoTinResult {
  triangle_count: number;
  point_count: number;
  removed_triangles: number;
  added_triangles: number;
  has_constraints: boolean;
  triangles: Array<{
    a: number; b: number; c: number;
    a_xyz: [number, number, number];
    b_xyz: [number, number, number];
    c_xyz: [number, number, number];
  }>;
}

export interface TopoContourInput {
  points: Array<{ easting: number; northing: number; elevation: number }>;
  interval: number;
  indexInterval?: number;
  gridResolution?: number;
  breaklines?: Array<{
    points: Array<{ easting: number; northing: number; elevation: number }>;
    type: 'hard' | 'soft' | 'ridge' | 'valley';
  }>;
}

export interface TopoContourResult {
  contour_count: number;
  interval: number;
  grid: { minE: number; minN: number; maxE: number; maxN: number; resolution: number; cols: number; rows: number };
  contours: Array<{
    elevation: number;
    isIndex: boolean;
    points: Array<[number, number]>;
  }>;
}

// ─── Export types (M4) ─────────────────────────────────────────────────

export interface ExportDxfInput {
  points: Array<{ number: string; easting: number; northing: number; elevation?: number; code?: string }>;
  parcel?: {
    parcelNumber: string;
    boundaries: Array<{ fromIndex: number; toIndex: number; bearing?: string; distance?: string }>;
  };
  traverse?: {
    legs: Array<{ from: string; to: string; distance: number; bearing: number }>;
  };
  contours?: Array<{ elevation: number; isIndex: boolean; points: Array<[number, number]> }>;
  outputDir?: string;
  fileName?: string;
}

export interface ExportLandXmlInput {
  project: {
    name: string;
    county: string;
    surveyDate: string;
    surveyorName: string;
    surveyorLicense: string;
  };
  points: Array<{ number: string; easting: number; northing: number; elevation: number; code?: string }>;
  outputDir?: string;
  fileName?: string;
}

export interface ExportGeoJsonInput {
  points: Array<{ number: string; easting: number; northing: number; elevation?: number; code?: string }>;
  parcel?: {
    parcelNumber: string;
    points: Array<{ easting: number; northing: number }>;
  };
  outputDir?: string;
  fileName?: string;
}

export interface ExportShapefileInput {
  parcel: {
    parcelNumber: string;
    area: number;
    perimeter: number;
    points: Array<{ easting: number; northing: number; beaconNumber?: string }>;
  };
  beacons?: Array<{
    beaconNumber: string;
    easting: number;
    northing: number;
    elevation?: number;
    beaconType?: string;
  }>;
  outputDir?: string;
  fileName?: string;
}

// ─── GIS QA Report types (M5) ──────────────────────────────────────────

export interface GisQaCheck {
  name: string;
  status: 'PASS' | 'CONDITIONAL' | 'FAIL';
  details: string;
  warnings?: string[];
}

export interface GisQaReportResult {
  overall: 'PASS' | 'CONDITIONAL' | 'FAIL';
  point_count: number;
  source_format: string;
  checks: GisQaCheck[];
  generated_at: string;
}

contextBridge.exposeInMainWorld('metardu', api);

// Type declaration for the renderer (declared globally so React can use it)
export type MetarduApi = typeof api;
