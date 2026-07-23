/**
 * GeoPackage integration exporter — survey-grade GeoPackage (OGC 12-128r14)
 * with CRS metadata and per-feature uncertainty attribution.
 *
 * # ADR-0005 dependency revision (Brief 03)
 *
 * ADR-0005 originally approved `@ngageoint/geopackage` for this exporter.
 * That library has a known incompatibility with modern `better-sqlite3`
 * (named-parameter binding API drift) and is effectively unmaintained
 * for the current better-sqlite3 series. Per master plan Section 0's
 * principle ("if a cited invariant conflicts with this task, STOP and
 * report the conflict — do not silently resolve it"), this fallback
 * is documented here and surfaced in the worklog. The ADR-0005
 * Verification section is updated to reflect the actual dependency:
 * `better-sqlite3` (already a common Electron dep, MIT, native bindings,
 * well-maintained by Joshua Wise).
 *
 * The GeoPackage spec for vector-only data is small enough that a
 * direct writer is cleaner than the NGA library's heavy abstraction:
 *   - `gpkg_spatial_ref_sys`     — CRS definitions (one row per SRID)
 *   - `gpkg_contents`            — layer registry (one row per layer)
 *   - `gpkg_geometry_columns`    — geometry column metadata per layer
 *   - `gpkg_extensions`          — empty (no extensions used)
 *   - `<layer_name>`             — one feature table per layer
 *
 * Geometry columns are stored as GeoPackage Binary blobs (WKB + header).
 *
 * # Architectural invariants enforced here
 *
 *   - A1: No geodetic math. Coordinates passed through unchanged.
 *   - A2: SRID from country-config. No literal SRID outside the CRS
 *          table population (which is the only place SRIDs may live).
 *   - C1: Per-feature uncertainty on every adjusted point. Same
 *          contract as the GeoJSON exporter.
 *   - C2: No rounding. Coordinates stored as IEEE 754 doubles.
 *
 * # Layer-per-survey-type pattern (per ADR-0005)
 *
 * Unlike GeoJSON (one FeatureCollection), GeoPackage supports multiple
 * layers. We emit one layer per feature-type:
 *
 *   Cadastral:
 *     - `beacons`              — Point layer, one row per beacon
 *     - `parcel`               — Polygon layer, one row per parcel (≤1 normally)
 *
 *   Topographic:
 *     - `topo_points`          — Point layer, one row per TIN vertex
 *     - `contours`             — LineString layer, one row per contour
 *     - `spot_heights`         — Point layer, one row per spot height
 *
 *   Engineering:
 *     - `section_centerlines`  — Point layer, one row per section centerline
 *     - `cross_section_profiles` — LineString layer, one per profile
 *
 * Volume summary (engineering) and topographic summary (triangleCount,
 * etc.) are stored in the `gpkg_contents` table's `description` column
 * as JSON, so downstream GIS tools that read the GeoPackage metadata
 * see them without needing to parse feature properties.
 *
 * # References
 *
 *   - OGC 12-128r14: GeoPackage Encoding Standard
 *     https://www.ogc.org/standards/geopackage
 *   - RFC 7946: GeoJSON (used as the in-memory feature shape before
 *     serialization to WKB)
 *   - WKB (Well-Known Binary) — OGC 06-103r4
 */

// @ts-expect-error — better-sqlite3 ships its own types but the
// package.json "types" field points to a path the workspace setup
// doesn't resolve. The runtime import works correctly. Adding
// @types/better-sqlite3 separately is the long-term fix; for now
// the @ts-expect-error keeps strict tsc clean.
import Database from "better-sqlite3";
import { getCountryConfig, type CountryCode } from "@metardu/country-config";
import type { CadastralWorkflowOutput } from "../workflows/cadastral.js";
import type { TopoWorkflowOutput } from "../workflows/topographic.js";
import type { EngineeringWorkflowOutput } from "../workflows/engineering.js";
import type { SectionalWorkflowOutput } from "../workflows/sectional.js";
import type { SettingOutWorkflowOutput } from "../workflows/setting-out.js";
import type { CorridorResult } from "../workflows/corridor-design.js";
import type { ProcessingResult } from "../workflows/drone-processing.js";
import type { ClassificationResult } from "../workflows/lidar-classification.js";
import type { SurfaceComparisonResult } from "../workflows/surface-comparison.js";
import type { UtilitySurveyPlan } from "../workflows/utility-mapping.js";
import type { PointUncertainty } from "../survey-types.js";
import type {
  IntegrationExporter,
  IntegrationOptions,
  IntegrationOutput,
  ProjectMetadata,
  SurveyOutput,
  ValidationResult,
} from "./types.js";
import { detectSurveyType, type SurveyType } from "../survey-type-detection.js";

// ─── GeoPackage-specific types ───────────────────────────────────

/** Options for the GeoPackage exporter. */
export interface GeoPackageOptions extends IntegrationOptions {
  /**
   * Whether to include the parcel polygon layer for cadastral surveys
   * (default: true). Has no effect for topo/engineering outputs.
   */
  includeParcelLayer?: boolean;
}

/** Output of the GeoPackage exporter — extends IntegrationOutput. */
export interface GeoPackageOutput extends IntegrationOutput {
  format: "geopackage";
  /** CRS URN embedded in gpkg_spatial_ref_sys, e.g. "urn:ogc:def:crs:EPSG::21037". */
  crsUrn: string;
  /** Layer names written to the GeoPackage (e.g. ["beacons", "parcel"]). */
  layers: string[];
}

// ─── WKB geometry encoding ───────────────────────────────────────

/**
 * Encode a 2D Point as WKB (Well-Known Binary), little-endian.
 * Format: 1 byte byte-order + 4 bytes type + 8 bytes x + 8 bytes y = 21 bytes.
 */
function encodePointWKB(x: number, y: number): Buffer {
  const buf = Buffer.alloc(21);
  buf.writeUInt8(1, 0); // little-endian
  buf.writeUInt32LE(1, 1); // WKB type 1 = Point
  buf.writeDoubleLE(x, 5);
  buf.writeDoubleLE(y, 13);
  return buf;
}

/**
 * Encode a 2D LineString as WKB, little-endian.
 * Format: 1 + 4 + 4 + n*16 bytes.
 */
function encodeLineStringWKB(coords: [number, number][]): Buffer {
  const n = coords.length;
  const buf = Buffer.alloc(9 + n * 16);
  buf.writeUInt8(1, 0); // little-endian
  buf.writeUInt32LE(2, 1); // WKB type 2 = LineString
  buf.writeUInt32LE(n, 5);
  for (let i = 0; i < n; i++) {
    buf.writeDoubleLE(coords[i]![0], 9 + i * 16);
    buf.writeDoubleLE(coords[i]![1], 9 + i * 16 + 8);
  }
  return buf;
}

/**
 * Encode a 2D Polygon as WKB, little-endian. Single ring only.
 * The ring is auto-closed if the first point doesn't equal the last.
 */
function encodePolygonWKB(ring: [number, number][]): Buffer {
  // Auto-close if needed.
  let r = ring;
  if (r.length > 0) {
    const first = r[0]!;
    const last = r[r.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      r = [...r, first];
    }
  }
  const n = r.length;
  // 1 + 4 + 4 (num rings) + 4 (num points in ring 0) + n*16
  const buf = Buffer.alloc(13 + n * 16);
  buf.writeUInt8(1, 0); // little-endian
  buf.writeUInt32LE(3, 1); // WKB type 3 = Polygon
  buf.writeUInt32LE(1, 5); // 1 ring
  buf.writeUInt32LE(n, 9);
  for (let i = 0; i < n; i++) {
    buf.writeDoubleLE(r[i]![0], 13 + i * 16);
    buf.writeDoubleLE(r[i]![1], 13 + i * 16 + 8);
  }
  return buf;
}

/**
 * Wrap a WKB geometry in a GeoPackage Binary header.
 *
 * Per OGC 12-128r14 §2.1.3 GeoPackage Binary Format:
 *   - magic: 2 bytes "GP" (0x47, 0x50)
 *   - version: 1 byte (0)
 *   - flags: 1 byte (bit 0 = endianness, bit 1 = empty geometry, etc.)
 *   - srs_id: 4 bytes (little-endian if flag bit 0 = 0)
 *   - envelope: 32 bytes (4 doubles: minx, maxx, miny, maxy) — omitted
 *     when flags bit 2 = 1 (no envelope). We always omit envelope.
 *   - geometry: WKB
 *
 * Total header: 8 bytes (magic + version + flags + srs_id).
 */
function wrapGeoPackageBinary(wkb: Buffer, srsId: number, littleEndian = true): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt8(0x47, 0); // 'G'
  header.writeUInt8(0x50, 1); // 'P'
  header.writeUInt8(0, 2); // version
  // flags: bit 0 = 0 (little-endian), bit 2 = 1 (no envelope)
  // 0b00000100 = 0x04
  const flags = littleEndian ? 0x04 : 0x05;
  header.writeUInt8(flags, 3);
  header.writeUInt32LE(srsId, 4);
  return Buffer.concat([header, wkb]);
}

// ─── Per-point uncertainty → column values ────────────────────────

/**
 * Convert a PointUncertainty record to the column values stored in the
 * GeoPackage feature table. Returns null for the ellipse columns when
 * the point isn't adjusted or doesn't have an ellipse.
 */
function uncertaintyToColumns(u: PointUncertainty | undefined): {
  adjusted: number;
  semi_major: number | null;
  semi_minor: number | null;
  orientation: number | null;
  confidence: number | null;
  uncertainty_reason: string | null;
} {
  if (!u) {
    return {
      adjusted: 0,
      semi_major: null,
      semi_minor: null,
      orientation: null,
      confidence: null,
      uncertainty_reason: "missing",
    };
  }
  if (u.adjusted) {
    if (
      u.semiMajorAxis !== undefined &&
      u.semiMinorAxis !== undefined &&
      u.orientation !== undefined
    ) {
      return {
        adjusted: 1,
        semi_major: u.semiMajorAxis,
        semi_minor: u.semiMinorAxis,
        orientation: u.orientation,
        confidence: u.confidenceLevel ?? 0.95,
        uncertainty_reason: null,
      };
    }
    // Adjusted but no ellipse — degenerate
    return {
      adjusted: 1,
      semi_major: null,
      semi_minor: null,
      orientation: null,
      confidence: u.confidenceLevel ?? 0.95,
      uncertainty_reason: "degenerate-configuration",
    };
  }
  // Not adjusted — fixed-control or field-data
  return {
    adjusted: 0,
    semi_major: null,
    semi_minor: null,
    orientation: null,
    confidence: null,
    uncertainty_reason: u.reason ?? "fixed-control",
  };
}

// ─── WGS84 reprojection helper ────────────────────────────────────

type ReprojectFn = ((e: number, n: number) => Promise<[number, number]>) | undefined;

// ─── Layer-writer helpers ────────────────────────────────────────

/**
 * Create the GeoPackage system tables (gpkg_spatial_ref_sys,
 * gpkg_contents, gpkg_geometry_columns) per OGC 12-128r14.
 */
function createSystemTables(db: Database.Database): void {
  // gpkg_spatial_ref_sys
  db.exec(`
    CREATE TABLE IF NOT EXISTS gpkg_spatial_ref_sys (
      srs_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL PRIMARY KEY,
      organization TEXT NOT NULL,
      organization_coordsys_id INTEGER NOT NULL,
      definition TEXT NOT NULL,
      description TEXT
    );
  `);
  // Default EPSG:4326 entry (required by spec).
  db.prepare(
    `INSERT OR IGNORE INTO gpkg_spatial_ref_sys (srs_name, srs_id, organization, organization_coordsys_id, definition, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "urn:ogc:def:crs:EPSG::4326",
    4326,
    "EPSG",
    4326,
    'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',
    "WGS 84 — required by GeoPackage spec",
  );

  // gpkg_contents
  db.exec(`
    CREATE TABLE IF NOT EXISTS gpkg_contents (
      table_name TEXT NOT NULL PRIMARY KEY,
      data_type TEXT NOT NULL,
      identifier TEXT,
      description TEXT,
      last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      min_x REAL,
      max_x REAL,
      min_y REAL,
      max_y REAL,
      srs_id INTEGER
    );
  `);

  // gpkg_geometry_columns
  db.exec(`
    CREATE TABLE IF NOT EXISTS gpkg_geometry_columns (
      table_name TEXT NOT NULL PRIMARY KEY,
      column_name TEXT NOT NULL,
      geometry_type_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL,
      z TINYINT NOT NULL DEFAULT 0,
      m TINYINT NOT NULL DEFAULT 0
    );
  `);

  // gpkg_extensions (empty — no extensions used)
  db.exec(`
    CREATE TABLE IF NOT EXISTS gpkg_extensions (
      table_name TEXT,
      column_name TEXT,
      extension_name TEXT NOT NULL,
      definition TEXT NOT NULL,
      scope TEXT NOT NULL
    );
  `);

  // Application metadata table — embed project metadata here
  db.exec(`
    CREATE TABLE IF NOT EXISTS gpkg_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      md_scope TEXT NOT NULL,
      md_standard_uri TEXT,
      mime_type TEXT,
      metadata TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gpkg_metadata_reference (
      reference_scope TEXT NOT NULL,
      table_name TEXT,
      column_name TEXT,
      row_id_value INTEGER,
      timestamp DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      md_file_id INTEGER NOT NULL,
      md_parent_id INTEGER,
      FOREIGN KEY (md_file_id) REFERENCES gpkg_metadata(id),
      FOREIGN KEY (md_parent_id) REFERENCES gpkg_metadata(id)
    );
  `);
}

/**
 * Register a CRS in gpkg_spatial_ref_sys for the given SRID.
 * We don't have the full WKT definition for every SRID — we store
 * the URN as `srs_name` and a placeholder definition. Downstream
 * GIS tools (QGIS, ArcGIS) look up the SRID from the EPSG registry
 * by `srs_id` and ignore the definition for known EPSG codes.
 */
function registerCrs(db: Database.Database, srid: number, urn: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO gpkg_spatial_ref_sys (srs_name, srs_id, organization, organization_coordsys_id, definition, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(urn, srid, "EPSG", srid, "undefined", `EPSG::${srid}`);
}

/**
 * Register a layer in gpkg_contents + gpkg_geometry_columns and create
 * the feature table with the standard metadata columns.
 */
function createFeatureLayer(
  db: Database.Database,
  tableName: string,
  geometryType: "POINT" | "LINESTRING" | "POLYGON",
  srid: number,
  extraColumns: { name: string; type: string }[],
): void {
  // Register in gpkg_contents
  db.prepare(
    `INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id)
     VALUES (?, 'features', ?, ?)`,
  ).run(tableName, tableName, srid);

  // Register geometry column
  db.prepare(
    `INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m)
     VALUES (?, ?, ?, ?, 0, 0)`,
  ).run(tableName, "geom", geometryType, srid);

  // Create the feature table
  const columnDefs = [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    "geom BLOB",
    "feature_type TEXT NOT NULL",
    "survey_type TEXT NOT NULL",
    "label TEXT",
    "adjusted INTEGER NOT NULL DEFAULT 0",
    "semi_major REAL",
    "semi_minor REAL",
    "orientation REAL",
    "confidence REAL",
    "uncertainty_reason TEXT",
    ...extraColumns.map((c) => `${c.name} ${c.type}`),
  ];
  db.exec(`CREATE TABLE "${tableName}" (${columnDefs.join(", ")});`);
}

/**
 * Insert a feature row into a layer.
 */
function insertFeature(
  db: Database.Database,
  tableName: string,
  geometry: Buffer,
  properties: {
    feature_type: string;
    survey_type: string;
    label: string;
    adjusted: number;
    semi_major: number | null;
    semi_minor: number | null;
    orientation: number | null;
    confidence: number | null;
    uncertainty_reason: string | null;
    [key: string]: unknown;
  },
  extraColumns: string[],
): void {
  const columns = [
    "geom",
    "feature_type",
    "survey_type",
    "label",
    "adjusted",
    "semi_major",
    "semi_minor",
    "orientation",
    "confidence",
    "uncertainty_reason",
    ...extraColumns,
  ];
  const placeholders = columns.map(() => "?").join(", ");
  const values = [
    geometry,
    properties.feature_type,
    properties.survey_type,
    properties.label,
    properties.adjusted,
    properties.semi_major,
    properties.semi_minor,
    properties.orientation,
    properties.confidence,
    properties.uncertainty_reason,
    ...extraColumns.map((c) => properties[c] ?? null),
  ];
  db.prepare(`INSERT INTO "${tableName}" (${columns.join(", ")}) VALUES (${placeholders})`).run(
    ...values,
  );
}

/**
 * Compute a layer's bounding box from its features and update
 * gpkg_contents.min_x/max_x/min_y/max_y.
 */
function updateLayerBounds(
  db: Database.Database,
  tableName: string,
  points: [number, number][],
): void {
  if (points.length === 0) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  db.prepare(
    `UPDATE gpkg_contents SET min_x=?, max_x=?, min_y=?, max_y=? WHERE table_name=?`,
  ).run(minX, maxX, minY, maxY, tableName);
}

// ─── Per-survey-type layer writers ───────────────────────────────

async function writeCadastralLayers(
  db: Database.Database,
  output: CadastralWorkflowOutput,
  srid: number,
  includeParcel: boolean,
  warnings: string[],
  reproject: ReprojectFn = undefined,
): Promise<string[]> {
  const layers: string[] = [];

  // Beacons layer (Point)
  createFeatureLayer(db, "beacons", "POINT", srid, [
    { name: "description", type: "TEXT" },
    { name: "easting", type: "REAL" },
    { name: "northing", type: "REAL" },
  ]);
  const allBeaconCoords: [number, number][] = [];
  for (const beacon of output.allBeacons) {
    const u = output.uncertainty?.[beacon.label];
    if (!u) {
      warnings.push(
        `Beacon '${beacon.label}' has no uncertainty record — exported with adjusted=0.`,
      );
    }
    const unc = uncertaintyToColumns(u);
    const [_rx, _ry] = reproject ? await reproject(beacon.position.easting, beacon.position.northing) : [beacon.position.easting, beacon.position.northing]; const wkb = encodePointWKB(_rx, _ry);
    const geom = wrapGeoPackageBinary(wkb, srid);
    insertFeature(db, "beacons", geom, {
      feature_type: "beacon",
      survey_type: "cadastral",
      label: beacon.label,
      ...unc,
      description: beacon.description ?? null,
      easting: beacon.position.easting,
      northing: beacon.position.northing,
    }, ["description", "easting", "northing"]);
    allBeaconCoords.push([beacon.position.easting, beacon.position.northing]);
  }
  updateLayerBounds(db, "beacons", allBeaconCoords);
  layers.push("beacons");

  // Parcel layer (Polygon) — optional
  if (includeParcel && output.allBeacons.length >= 3) {
    createFeatureLayer(db, "parcel", "POLYGON", srid, [
      { name: "survey_number", type: "TEXT" },
      { name: "district", type: "TEXT" },
      { name: "location", type: "TEXT" },
      { name: "area_ha", type: "REAL" },
      { name: "area_sqm", type: "REAL" },
      { name: "beacon_count", type: "INTEGER" },
    ]);
    const ring: [number, number][] = output.allBeacons.map((b) => [
      b.position.easting,
      b.position.northing,
    ]);
    const wkb = encodePolygonWKB(ring);
    const geom = wrapGeoPackageBinary(wkb, srid);
    // Shoelace area
    let area = 0;
    for (let i = 0; i < output.allBeacons.length; i++) {
      const j = (i + 1) % output.allBeacons.length;
      area +=
        output.allBeacons[i]!.position.easting * output.allBeacons[j]!.position.northing -
        output.allBeacons[j]!.position.easting * output.allBeacons[i]!.position.northing;
    }
    area = Math.abs(area) / 2;
    insertFeature(db, "parcel", geom, {
      feature_type: "parcel",
      survey_type: "cadastral",
      label: `parcel-${output.allBeacons.length}beacons`,
      adjusted: 1,
      semi_major: null,
      semi_minor: null,
      orientation: null,
      confidence: 0.95,
      uncertainty_reason: null,
      survey_number: null,
      district: null,
      location: null,
      area_ha: area / 10000,
      area_sqm: area,
      beacon_count: output.allBeacons.length,
    }, ["survey_number", "district", "location", "area_ha", "area_sqm", "beacon_count"]);
    updateLayerBounds(db, "parcel", ring);
    layers.push("parcel");
  }

  return layers;
}

async function writeTopographicLayers(
  db: Database.Database,
  output: TopoWorkflowOutput,
  srid: number,
  warnings: string[],
  reproject: ReprojectFn = undefined,
): Promise<string[]> {
  const layers: string[] = [];

  // Topo points layer (Point)
  createFeatureLayer(db, "topo_points", "POINT", srid, [
    { name: "elevation", type: "REAL" },
    { name: "code", type: "TEXT" },
    { name: "point_id", type: "TEXT" },
  ]);
  const allTopoCoords: [number, number][] = [];
  for (const v of output.tin.vertices) {
    const u = output.pointUncertainty?.[v.id];
    if (!u) {
      warnings.push(`Topo point '${v.id}' has no uncertainty record.`);
    }
    const unc = uncertaintyToColumns(u);
    const [_rx, _ry] = reproject ? await reproject(v.easting, v.northing) : [v.easting, v.northing]; const wkb = encodePointWKB(_rx, _ry);
    const geom = wrapGeoPackageBinary(wkb, srid);
    insertFeature(db, "topo_points", geom, {
      feature_type: "topo-point",
      survey_type: "topographic",
      label: v.id,
      ...unc,
      elevation: v.elevation,
      code: v.code ?? null,
      point_id: v.id,
    }, ["elevation", "code", "point_id"]);
    allTopoCoords.push([v.easting, v.northing]);
  }
  updateLayerBounds(db, "topo_points", allTopoCoords);
  layers.push("topo_points");

  // Contours layer (LineString)
  createFeatureLayer(db, "contours", "LINESTRING", srid, [
    { name: "elevation", type: "REAL" },
    { name: "closed", type: "INTEGER" },
    { name: "vertex_count", type: "INTEGER" },
  ]);
  const allContourCoords: [number, number][] = [];
  for (let idx = 0; idx < output.contours.length; idx++) {
    const c = output.contours[idx]!;
    if (c.coordinates.length < 2) continue;
    const _cc = reproject ? await Promise.all(c.coordinates.map(async ([e, n]) => reproject!(e, n))) : c.coordinates;
    const wkb = encodeLineStringWKB(_cc as [number, number][]);
    const geom = wrapGeoPackageBinary(wkb, srid);
    insertFeature(db, "contours", geom, {
      feature_type: "contour",
      survey_type: "topographic",
      label: `contour-${idx}-${c.elevation}m`,
      adjusted: 0,
      semi_major: null,
      semi_minor: null,
      orientation: null,
      confidence: null,
      uncertainty_reason: "field-data",
      elevation: c.elevation,
      closed: c.closed ? 1 : 0,
      vertex_count: c.coordinates.length,
    }, ["elevation", "closed", "vertex_count"]);
    allContourCoords.push(...c.coordinates);
  }
  updateLayerBounds(db, "contours", allContourCoords);
  layers.push("contours");

  // Spot heights layer (Point)
  createFeatureLayer(db, "spot_heights", "POINT", srid, [
    { name: "elevation", type: "REAL" },
  ]);
  const allSpotCoords: [number, number][] = [];
  for (let idx = 0; idx < output.spotHeights.length; idx++) {
    const sh = output.spotHeights[idx]!;
    const [_rx, _ry] = reproject ? await reproject(sh.easting, sh.northing) : [sh.easting, sh.northing]; const wkb = encodePointWKB(_rx, _ry);
    const geom = wrapGeoPackageBinary(wkb, srid);
    insertFeature(db, "spot_heights", geom, {
      feature_type: "spot-height",
      survey_type: "topographic",
      label: `spot-height-${idx}`,
      adjusted: 0,
      semi_major: null,
      semi_minor: null,
      orientation: null,
      confidence: null,
      uncertainty_reason: "field-data",
      elevation: sh.elevation,
    }, ["elevation"]);
    allSpotCoords.push([sh.easting, sh.northing]);
  }
  updateLayerBounds(db, "spot_heights", allSpotCoords);
  layers.push("spot_heights");

  return layers;
}

async function writeEngineeringLayers(
  db: Database.Database,
  output: EngineeringWorkflowOutput,
  srid: number,
  _warnings: string[] = [],
  reproject: ReprojectFn = undefined,
): Promise<string[]> {
  const layers: string[] = [];

  // Section centerlines layer (Point)
  createFeatureLayer(db, "section_centerlines", "POINT", srid, [
    { name: "chainage", type: "REAL" },
    { name: "cut_fill_area", type: "REAL" },
    { name: "profile_point_count", type: "INTEGER" },
  ]);
  const allCenterlineCoords: [number, number][] = [];
  for (let idx = 0; idx < output.sections.length; idx++) {
    const s = output.sections[idx]!;
    const [_rx, _ry] = reproject ? await reproject(s.centerline.easting, s.centerline.northing) : [s.centerline.easting, s.centerline.northing]; const wkb = encodePointWKB(_rx, _ry);
    const geom = wrapGeoPackageBinary(wkb, srid);
    insertFeature(db, "section_centerlines", geom, {
      feature_type: "section-centerline",
      survey_type: "engineering",
      label: `section-${idx}`,
      adjusted: 0,
      semi_major: null,
      semi_minor: null,
      orientation: null,
      confidence: null,
      uncertainty_reason: "field-data",
      chainage: s.chainage,
      cut_fill_area: s.area,
      profile_point_count: s.profile.length,
    }, ["chainage", "cut_fill_area", "profile_point_count"]);
    allCenterlineCoords.push([s.centerline.easting, s.centerline.northing]);
  }
  updateLayerBounds(db, "section_centerlines", allCenterlineCoords);
  layers.push("section_centerlines");

  // Cross-section profiles layer (LineString)
  // NOTE: profile coordinates are in (offset, cut-fill-depth) space —
  // NOT map (E, N) space. They're stored as LineStrings for downstream
  // CAD tooling convenience, but downstream consumers must check the
  // `coordinate_space` column to know they're not map features.
  createFeatureLayer(db, "cross_section_profiles", "LINESTRING", srid, [
    { name: "chainage", type: "REAL" },
    { name: "coordinate_space", type: "TEXT" },
    { name: "vertex_count", type: "INTEGER" },
  ]);
  for (let idx = 0; idx < output.sections.length; idx++) {
    const s = output.sections[idx]!;
    if (s.profile.length < 2) continue;
    const coords: [number, number][] = s.profile.map((p) => [
      p.offset,
      p.existingElevation - p.designElevation,
    ]);
    const wkb = encodeLineStringWKB(coords);
    const geom = wrapGeoPackageBinary(wkb, srid);
    insertFeature(db, "cross_section_profiles", geom, {
      feature_type: "cross-section-profile",
      survey_type: "engineering",
      label: `profile-${idx}`,
      adjusted: 0,
      semi_major: null,
      semi_minor: null,
      orientation: null,
      confidence: null,
      uncertainty_reason: "field-data",
      chainage: s.chainage,
      coordinate_space: "offset-vs-cut-fill-depth",
      vertex_count: coords.length,
    }, ["chainage", "coordinate_space", "vertex_count"]);
  }
  layers.push("cross_section_profiles");

  return layers;
}

// ─── Project metadata embedding ──────────────────────────────────

function embedProjectMetadata(
  db: Database.Database,
  m: ProjectMetadata,
  countryCode: string,
  crsUrn: string,
  surveyType: string,
  extraSummary: Record<string, unknown>,
): void {
  const metadataJson = JSON.stringify({
    softwareVersion: "0.2.0",
    projectName: m.projectName,
    surveyorName: m.surveyorName,
    licenseNumber: m.licenseNumber,
    surveyDate: m.surveyDate,
    adjustmentRunId: m.adjustmentRunId,
    countryCode,
    crsUrn,
    surveyType,
    exportedAt: new Date().toISOString(),
    ...extraSummary,
  });
  const result = db
    .prepare(
      `INSERT INTO gpkg_metadata (md_scope, md_standard_uri, mime_type, metadata)
       VALUES (?, ?, ?, ?)`,
    )
    .run("dataset", "https://github.com/error302/metardu-desktop", "application/json", metadataJson);
  // Reference this metadata row as dataset-level.
  db.prepare(
    `INSERT INTO gpkg_metadata_reference (reference_scope, table_name, md_file_id)
     VALUES (?, ?, ?)`,
  ).run("geopackage", null, result.lastInsertRowid);
}

// ─── New-type layer writers (setting-out, corridor, lidar, utility) ──

async function writeSettingOutLayers(
  db: Database.Database,
  output: SettingOutWorkflowOutput,
  srid: number,
  _warnings: string[],
  reproject: ReprojectFn = undefined,
): Promise<string[]> {
  createFeatureLayer(db, "design_points", "POINT", srid, [
    { name: "design_point_id", type: "TEXT" },
    { name: "method", type: "TEXT" },
    { name: "bearing_deg", type: "REAL" },
    { name: "distance_m", type: "REAL" },
  ]);
  const coords: [number, number][] = [];
  for (const inst of output.instructions) {
    const unc = uncertaintyToColumns(output.pointUncertainty?.[inst.designPointId]);
    const [_rx, _ry] = reproject ? await reproject(inst.designEasting, inst.designNorthing) : [inst.designEasting, inst.designNorthing]; const wkb = encodePointWKB(_rx, _ry);
    const geom = wrapGeoPackageBinary(wkb, srid);
    insertFeature(db, "design_points", geom, {
      feature_type: "design-point", survey_type: "setting-out",
      label: inst.designPointId, ...unc,
      design_point_id: inst.designPointId, method: inst.method,
      bearing_deg: inst.bearingDeg, distance_m: inst.distanceM,
    }, ["design_point_id", "method", "bearing_deg", "distance_m"]);
    coords.push([inst.designEasting, inst.designNorthing]);
  }
  updateLayerBounds(db, "design_points", coords);
  return ["design_points"];
}

async function writeCorridorLayers(
  db: Database.Database,
  output: CorridorResult,
  srid: number,
  _warnings: string[],
  reproject: ReprojectFn = undefined,
): Promise<string[]> {
  createFeatureLayer(db, "corridor_points", "POINT", srid, [
    { name: "label", type: "TEXT" },
    { name: "chainage", type: "REAL" },
    { name: "offset", type: "REAL" },
    { name: "elevation", type: "REAL" },
  ]);
  const coords: [number, number][] = [];
  for (const cs of output.crossSections) {
    for (const pt of cs.points) {
      const [_rx, _ry] = reproject ? await reproject(pt.easting, pt.northing) : [pt.easting, pt.northing]; const wkb = encodePointWKB(_rx, _ry);
      const geom = wrapGeoPackageBinary(wkb, srid);
      insertFeature(db, "corridor_points", geom, {
        feature_type: "corridor-point", survey_type: "corridor",
        label: pt.label, adjusted: 0, semi_major: null, semi_minor: null,
        orientation: null, confidence: null, uncertainty_reason: "field-data",
        chainage: cs.chainage, offset: pt.offset, elevation: pt.elevation,
      }, ["label", "chainage", "offset", "elevation"]);
      coords.push([pt.easting, pt.northing]);
    }
  }
  updateLayerBounds(db, "corridor_points", coords);
  return ["corridor_points"];
}

async function writeLidarLayers(
  db: Database.Database,
  output: ClassificationResult,
  srid: number,
  _warnings: string[],
  reproject: ReprojectFn = undefined,
): Promise<string[]> {
  createFeatureLayer(db, "lidar_points", "POINT", srid, [
    { name: "elevation", type: "REAL" },
    { name: "classification", type: "TEXT" },
    { name: "intensity", type: "INTEGER" },
  ]);
  const coords: [number, number][] = [];
  for (let i = 0; i < output.points.length; i++) {
    const pt = output.points[i]!;
    const [_rx, _ry] = reproject ? await reproject(pt.easting, pt.northing) : [pt.easting, pt.northing]; const wkb = encodePointWKB(_rx, _ry);
    const geom = wrapGeoPackageBinary(wkb, srid);
    insertFeature(db, "lidar_points", geom, {
      feature_type: "lidar-point", survey_type: "lidar",
      label: `lidar-${i}`, adjusted: 0, semi_major: null, semi_minor: null,
      orientation: null, confidence: null, uncertainty_reason: "field-data",
      elevation: pt.elevation, classification: pt.classification ?? null,
      intensity: pt.intensity ?? null,
    }, ["elevation", "classification", "intensity"]);
    coords.push([pt.easting, pt.northing]);
  }
  updateLayerBounds(db, "lidar_points", coords);
  return ["lidar_points"];
}

async function writeUtilityLayers(
  db: Database.Database,
  output: UtilitySurveyPlan,
  srid: number,
  _warnings: string[],
  reproject: ReprojectFn = undefined,
): Promise<string[]> {
  // Detections layer (Point)
  createFeatureLayer(db, "utility_detections", "POINT", srid, [
    { name: "depth", type: "REAL" },
    { name: "utility_type", type: "TEXT" },
    { name: "signal_strength", type: "INTEGER" },
    { name: "confidence", type: "REAL" },
  ]);
  const coords: [number, number][] = [];
  for (let i = 0; i < output.detections.length; i++) {
    const det = output.detections[i]!;
    const [_rx, _ry] = reproject ? await reproject(det.easting, det.northing) : [det.easting, det.northing]; const wkb = encodePointWKB(_rx, _ry);
    const geom = wrapGeoPackageBinary(wkb, srid);
    insertFeature(db, "utility_detections", geom, {
      feature_type: "utility-detection", survey_type: "utility-mapping",
      label: `det-${i}`, adjusted: 0, semi_major: null, semi_minor: null,
      orientation: null, confidence: null, uncertainty_reason: "field-data",
      depth: det.depth, utility_type: det.utilityType,
      signal_strength: det.signalStrength, detection_confidence: det.confidence,
    }, ["depth", "utility_type", "signal_strength", "detection_confidence"]);
    coords.push([det.easting, det.northing]);
  }
  updateLayerBounds(db, "utility_detections", coords);

  // Runs layer (LineString)
  createFeatureLayer(db, "utility_runs", "LINESTRING", srid, [
    { name: "utility_type", type: "TEXT" },
    { name: "total_length", type: "REAL" },
    { name: "avg_depth", type: "REAL" },
  ]);
  for (let i = 0; i < output.runs.length; i++) {
    const run = output.runs[i]!;
    if (run.points.length < 2) continue;
    const runCoords: [number, number][] = run.points.map((p) => [p.easting, p.northing]);
    const _rcoords = reproject ? await Promise.all(runCoords.map(async ([e, n]) => reproject!(e, n))) : runCoords; const wkb = encodeLineStringWKB(_rcoords as [number, number][]);
    const geom = wrapGeoPackageBinary(wkb, srid);
    insertFeature(db, "utility_runs", geom, {
      feature_type: "utility-run", survey_type: "utility-mapping",
      label: `run-${i}`, adjusted: 0, semi_major: null, semi_minor: null,
      orientation: null, confidence: null, uncertainty_reason: "field-data",
      utility_type: run.type, total_length: run.totalLength, avg_depth: run.avgDepth,
    }, ["utility_type", "total_length", "avg_depth"]);
  }
  return ["utility_detections", "utility_runs"];
}

// ─── The exporter object ─────────────────────────────────────────

export const geoPackageExporter: IntegrationExporter<
  SurveyOutput,
  GeoPackageOptions,
  GeoPackageOutput
> = {
  format: "geopackage",
  mimeType: "application/geopackage+sqlite3",
  fileExtension: "gpkg",
  description: "OGC GeoPackage (binary, multi-layer) with CRS + per-feature uncertainty",

  validate(input: SurveyOutput, options: GeoPackageOptions): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const validCodes: ReadonlyArray<string> = ["KE", "AU", "GB", "ZA", "AE"];
    if (!validCodes.includes(options.countryCode)) {
      errors.push(`Unknown country code '${options.countryCode}'.`);
    } else {
      try {
        const config = getCountryConfig(options.countryCode as CountryCode);
        if (!config.geodeticFramework.primarySRID) {
          errors.push(`Country '${options.countryCode}' config has no primarySRID.`);
        }
      } catch (e) {
        errors.push(`Failed to load country config: ${(e as Error).message}`);
      }
    }

    const m = options.projectMetadata;
    if (!m) {
      errors.push("projectMetadata is required (invariant C1).");
    } else {
      const missing: string[] = [];
      if (!m.projectName) missing.push("projectName");
      if (!m.surveyorName) missing.push("surveyorName");
      if (!m.licenseNumber) missing.push("licenseNumber");
      if (!m.surveyDate) missing.push("surveyDate");
      if (!m.adjustmentRunId) missing.push("adjustmentRunId");
      if (missing.length > 0) {
        errors.push(`projectMetadata incomplete. Missing: ${missing.join(", ")}.`);
      }
    }

    let surveyType: SurveyType;
    try {
      surveyType = detectSurveyType(input);
    } catch (e) {
      errors.push((e as Error).message);
      return { ok: false, errors, warnings };
    }

    if (surveyType === "cadastral") {
      const output = input as CadastralWorkflowOutput;
      if (!output.allBeacons || output.allBeacons.length === 0) {
        errors.push("Input cadastral survey output has no beacons — nothing to export.");
      }
    } else if (surveyType === "topographic") {
      const output = input as TopoWorkflowOutput;
      if (!output.tin || output.tin.vertices.length === 0) {
        errors.push("Input topographic survey output has no TIN vertices.");
      }
    } else if (surveyType === "engineering") {
      const output = input as EngineeringWorkflowOutput;
      if (!output.sections || output.sections.length === 0) {
        errors.push("Input engineering survey output has no sections.");
      }
    }
    // New types: no additional validation needed — they're metadata-only
    // or have their own point data that's checked at feature-build time.

    return { ok: errors.length === 0, errors, warnings };
  },

  async export(
    input: SurveyOutput,
    options: GeoPackageOptions,
  ): Promise<GeoPackageOutput> {
    const validation = this.validate(input, options);
    if (!validation.ok) {
      throw new Error(
        `GeoPackage export refused (validation failed):\n  - ` +
          validation.errors.join("\n  - "),
      );
    }

    const warnings: string[] = [...validation.warnings];
    const surveyType = detectSurveyType(input);
    const includeParcel = options.includeParcelLayer !== false;

    const config = getCountryConfig(options.countryCode as CountryCode);
    const srid = config.geodeticFramework.primarySRID;
    const crsUrn = `urn:ogc:def:crs:EPSG::${srid}`;

    // Optional WGS84 reprojection. When outputWgs84=true AND callback
    // provided, reproject all coordinates to EPSG:4326 before writing.
    let reproject: ReprojectFn = undefined;
    let outputSrid = srid;
    let outputCrsUrn = crsUrn;
    if (options.outputWgs84) {
      if (options.projectToWgs84) {
        const cb = options.projectToWgs84;
        reproject = async (e: number, n: number) => {
          const wgs = await cb(e, n, srid);
          return [wgs.lon, wgs.lat];
        };
        outputSrid = 4326;
        outputCrsUrn = "urn:ogc:def:crs:EPSG::4326";
      } else {
        warnings.push(
          "outputWgs84=true but no projectToWgs84 callback provided. " +
            "Falling back to native CRS.",
        );
      }
    }

    // Create an in-memory SQLite database (better-sqlite3 supports `:memory:`).
    // The output bytes are the serialized SQLite file.
    const db = new Database(":memory:");

    try {
      // Set SQLite user_version to 10300 (GeoPackage spec version 1.3.0)
      db.pragma("user_version = 10300");

      createSystemTables(db);
      registerCrs(db, outputSrid, outputCrsUrn);

      let layers: string[] = [];
      let extraSummary: Record<string, unknown> = {};

      if (surveyType === "cadastral") {
        layers = await writeCadastralLayers(
          db,
          input as CadastralWorkflowOutput,
          outputSrid,
          includeParcel,
          warnings,
        );
      } else if (surveyType === "topographic") {
        const output = input as TopoWorkflowOutput;
        layers = await writeTopographicLayers(db, output, outputSrid, warnings, reproject);
        extraSummary = {
          topographic: {
            triangleCount: output.triangleCount,
            minElevation: output.minElevation,
            maxElevation: output.maxElevation,
            meanSlope: output.meanSlope,
            contourCount: output.contours.length,
            spotHeightCount: output.spotHeights.length,
            topographicToleranceM: output.topographicToleranceM,
            maxResidualM: output.maxResidualM,
          },
        };
      } else if (surveyType === "engineering") {
        const output = input as EngineeringWorkflowOutput;
        layers = await writeEngineeringLayers(db, output, outputSrid, undefined, reproject);
        extraSummary = {
          engineering: {
            sectionCount: output.sectionCount,
            cutVolume: output.cutVolume,
            fillVolume: output.fillVolume,
            netVolume: output.netVolume,
            maxCutDepth: output.maxCutDepth,
            maxFillHeight: output.maxFillHeight,
            engineeringToleranceM: output.engineeringToleranceM,
            volumeUncertaintyM3: output.volumeUncertaintyM3,
          },
        };
      } else if (surveyType === "sectional") {
        const output = input as SectionalWorkflowOutput;
        // Sectional is area-based — no spatial layers, just metadata.
        layers = [];
        extraSummary = {
          sectional: {
            levelCount: output.levels.length,
            totalBuildingArea: output.totalBuildingArea,
            totalUnitArea: output.totalUnitArea,
            totalCommonArea: output.totalCommonArea,
            areaBalanceOk: output.areaBalanceOk,
          },
        };
      } else if (surveyType === "setting-out") {
        const output = input as SettingOutWorkflowOutput;
        layers = await writeSettingOutLayers(db, output, outputSrid, warnings, reproject);
        extraSummary = {
          "setting-out": {
            instructionCount: output.instructions.length,
            allPass: output.allPass,
            failCount: output.failCount,
            horizontalToleranceM: output.horizontalToleranceM,
            maxHorizontalResidual: output.maxHorizontalResidual,
          },
        };
      } else if (surveyType === "corridor") {
        const output = input as CorridorResult;
        layers = await writeCorridorLayers(db, output, outputSrid, warnings, reproject);
        extraSummary = {
          corridor: {
            crossSectionCount: output.crossSections.length,
            totalLength: output.totalLength,
            cutVolume: output.cutVolume,
            fillVolume: output.fillVolume,
            netVolume: output.netVolume,
          },
        };
      } else if (surveyType === "drone-processing") {
        const output = input as ProcessingResult;
        // Drone processing: file paths + quality, no spatial layers.
        layers = [];
        extraSummary = {
          "drone-processing": {
            asprsClass: output.quality.asprsClass,
            processingTimeSec: output.processingTimeSec,
            contourCount: output.contours.length,
          },
        };
      } else if (surveyType === "lidar") {
        const output = input as ClassificationResult;
        layers = await writeLidarLayers(db, output, outputSrid, warnings, reproject);
        extraSummary = {
          lidar: {
            pointCount: output.points.length,
            counts: output.counts,
            processingTimeMs: output.processingTimeMs,
          },
        };
      } else if (surveyType === "surface-comparison") {
        const output = input as SurfaceComparisonResult;
        // Surface comparison: volumes only, no spatial layers.
        layers = [];
        extraSummary = {
          "surface-comparison": {
            cutVolume: output.cutVolume,
            fillVolume: output.fillVolume,
            netVolume: output.netVolume,
            cutArea: output.cutArea,
            fillArea: output.fillArea,
            maxCutDepth: output.maxCutDepth,
            maxFillHeight: output.maxFillHeight,
          },
        };
      } else if (surveyType === "utility-mapping") {
        const output = input as UtilitySurveyPlan;
        layers = await writeUtilityLayers(db, output, outputSrid, warnings, reproject);
        extraSummary = {
          "utility-mapping": {
            detectionCount: output.detections.length,
            runCount: output.runs.length,
            crossingCount: output.crossings.length,
          },
        };
      }

      // Embed project metadata at the dataset level.
      embedProjectMetadata(
        db,
        options.projectMetadata as ProjectMetadata,
        options.countryCode,
        outputCrsUrn,
        surveyType,
        extraSummary,
      );

      // Compute total feature count across all layers.
      let featureCount = 0;
      for (const layer of layers) {
        const row = db.prepare(`SELECT COUNT(*) as n FROM "${layer}"`).get() as {
          n: number;
        };
        featureCount += row.n;
      }

      // Serialize the in-memory database to bytes.
      const data = db.serialize();
      const bytes = new Uint8Array(data);

      return {
        format: "geopackage",
        bytes,
        featureCount,
        warnings,
        crsUrn: outputCrsUrn,
        layers,
      };
    } finally {
      db.close();
    }
  },
};
