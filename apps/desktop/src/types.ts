/**
 * Shared types between the renderer and the preload script.
 *
 * The preload script is compiled as CommonJS (for Electron's main-side require),
 * while the renderer is bundled by Vite. To avoid cross-compile-unit imports,
 * shared types live here and are imported by both sides.
 */

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

export interface TraverseLegInput {
  from_point_number: string;
  to_point_number: string;
  observed_distance: number;
  observed_bearing: number;
}

export interface TraverseComputeInput {
  project_id: string;
  name: string;
  survey_type?: string;
  adjustment_method?: 'bowditch' | 'transit' | 'none';
  legs: TraverseLegInput[];
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

/**
 * The bridge API exposed by the preload script via contextBridge.
 * The renderer accesses this as `window.metardu`.
 */
export interface MetarduApi {
  app: {
    version: () => Promise<string>;
    platform: () => Promise<string>;
  };
  fs: {
    newProject: (filePath: string, name: string, countryPack?: string) =>
      Promise<{ filePath: string; projectId: string }>;
    openProject: (filePath: string) => Promise<{ filePath: string }>;
    importCsv: (filePath: string, projectId?: string) =>
      Promise<{ imported: number; projectId: string }>;
  };
  db: {
    query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
    execute: (sql: string, params?: unknown[]) =>
      Promise<{ changes: number; lastInsertRowid: number }>;
    getPoints: (projectId?: string) => Promise<SurveyPoint[]>;
    listProjects: () => Promise<ProjectRow[]>;
  };
  traverse: {
    compute: (input: TraverseComputeInput) => Promise<TraverseComputeResultPayload>;
    list: (projectId?: string) => Promise<unknown[]>;
    get: (traverseId: string) => Promise<{ traverse: unknown; legs: unknown[]; stations: unknown[] }>;
  };
  parcel: {
    create: (data: ParcelCreateInput) => Promise<{ parcel_id: string }>;
    list: (projectId?: string) => Promise<unknown[]>;
    getPoints: (parcelId: string) => Promise<unknown[]>;
  };
  beacon: {
    create: (data: BeaconCreateInput) => Promise<{ beacon_id: string }>;
    list: (projectId?: string) => Promise<unknown[]>;
    update: (beaconId: string, updates: Record<string, unknown>) => Promise<{ changes: number }>;
    delete: (beaconId: string) => Promise<{ changes: number }>;
  };
  deedPlan: {
    generate: (opts: DeedPlanGenerateInput) => Promise<{ deed_plan_id: string; pdf_path: string; pdf_hash: string }>;
    list: (projectId?: string) => Promise<unknown[]>;
    seal: (deedPlanId: string, sealPayload: SealPayload) => Promise<{ certificate_id: string }>;
  };
  menu: {
    onFileNew: (cb: () => void) => void;
    onFileOpened: (cb: (filePath: string) => void) => void;
    onImportCsv: (cb: (filePath: string) => void) => void;
  };
  // Optional namespaces — present when the corresponding preload module is loaded.
  // Renderer code should feature-detect: `if (window.metardu.report) { ... }`.
  report?: {
    generate: (opts: any) => Promise<{
      pdfPath: string;
      pdfSizeBytes: number;
      pageCount: number;
      sealed: boolean;
      signatureFingerprint?: string;
      signedAt?: string;
      warnings: string[];
    }>;
  };
  form?: {
    generateFormP: (opts: any) => Promise<any>;
    generateTopoReport: (opts: any) => Promise<any>;
    generateCrossSections: (opts: any) => Promise<any>;
    generateRinexLog: (opts: any) => Promise<any>;
    generateLevelingBook: (opts: any) => Promise<any>;
  };
  plan?: {
    render: (opts: any) => Promise<any>;
    autoGenerate: (opts: any) => Promise<any>;
    renderTopo: (opts: any) => Promise<any>;
    renderEngineering: (opts: any) => Promise<any>;
    print: (opts: any) => Promise<any>;
    listPrinters: () => Promise<any>;
  };
  qa?: {
    gisReport: (opts: any) => Promise<any>;
    gate: (opts: any) => Promise<any>;
  };
  export?: {
    dxf: (opts: any) => Promise<any>;
    dxfSoK: (opts: any) => Promise<any>;
    landxml: (opts: any) => Promise<any>;
    geojson: (opts: any) => Promise<any>;
    shapefile: (opts: any) => Promise<any>;
  };
  profile?: {
    load: () => Promise<any>;
    save: (profile: any) => Promise<any>;
    validate: (profile: any) => Promise<{ valid: boolean; errors: string[] }>;
  };
  submission?: {
    create: (input: any) => Promise<any>;
    list: () => Promise<any[]>;
    get: (trackingNumber: string) => Promise<any>;
    updateStatus: (trackingNumber: string, newStatus: any, options?: any) => Promise<any>;
    delete: (trackingNumber: string) => Promise<boolean>;
    deadlineAlerts: () => Promise<any[]>;
  };
  audit?: {
    record: (event: any) => Promise<{ success: boolean }>;
    query: (options: any) => Promise<any[]>;
    verify: () => Promise<{ valid: boolean; brokenAt?: number; totalEvents: number }>;
  };
  wayleave?: {
    computeSummary: (project: any) => Promise<any>;
    exportPaps: (project: any, outputPath: string) => Promise<any>;
    exportLandSchedule: (project: any, outputPath: string) => Promise<any>;
    exportGeoJSON: (project: any, outputPath: string) => Promise<any>;
    exportArcGIS: (project: any, outputDir: string) => Promise<any>;
    exportLineProfile: (project: any, outputPath: string) => Promise<any>;
    exportMultiDisciplineReport: (project: any, outputPath: string) => Promise<any>;
  };
}

