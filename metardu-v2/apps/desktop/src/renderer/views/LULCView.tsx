/**
 * LULC thematic workspace.
 *
 * Geometry is retained as raw source coordinates. CRS interpretation, raster
 * processing, classification, and survey-grade area computation are unavailable
 * until backed by the project reference context and Rust sidecar.
 */

import React, { useState, useCallback, useMemo } from "react";
import { SurveyCanvas, type SurveyPoint, type SurveyPolygon } from "@metardu/ui-components";
import { useSurveyState } from "../SurveyStateContext.js";
import { Layers, Plus, Trash2, Upload, Download, FileText } from "lucide-react";
import { COUNTRY_OPTIONS } from "../countries.js";

// ─── Types ────────────────────────────────────────────────────────

type LulcCategory =
  | "unclassified" | "residential" | "agricultural" | "commercial" | "institutional"
  | "forest" | "grassland" | "wetland" | "bareland" | "water" | "infrastructure";

interface LulcZone {
  id: string;
  name: string;
  category: LulcCategory;
  points: Array<{ easting: number; northing: number }>;
  color: string;
  source: "manual" | "imported";
  parcelId?: string; // original parcel ID from import
  attributes?: Record<string, unknown>;
}

interface LulcCategoryInfo {
  key: LulcCategory;
  label: string;
  color: string;
  description: string;
}

interface ImportedParcel {
  id: string;
  name: string;
  points: Array<{ easting: number; northing: number }>;
  category?: LulcCategory;
  attributes?: Record<string, unknown>;
}

// These are generic thematic tags for project organization, not a country's
// statutory land-use classification and not image-derived classifications.
const LULC_CATEGORIES: LulcCategoryInfo[] = [
  { key: "unclassified", label: "Unclassified", color: "#64748b", description: "No class assigned" },
  { key: "residential", label: "Residential", color: "#ef4444", description: "Residential use" },
  { key: "agricultural", label: "Agricultural", color: "#22c55e", description: "Agricultural use" },
  { key: "commercial", label: "Commercial", color: "#f59e0b", description: "Commercial use" },
  { key: "institutional", label: "Institutional", color: "#3b82f6", description: "Institutional use" },
  { key: "forest", label: "Forest", color: "#166534", description: "Forest cover" },
  { key: "grassland", label: "Grassland", color: "#84cc16", description: "Grassland cover" },
  { key: "wetland", label: "Wetland", color: "#06b6d4", description: "Wetland cover" },
  { key: "bareland", label: "Bare land", color: "#a3a3a3", description: "Bare or cleared land" },
  { key: "water", label: "Water", color: "#2563eb", description: "Water cover" },
  { key: "infrastructure", label: "Infrastructure", color: "#7c3aed", description: "Infrastructure use" },
];

// ─── Helpers ──────────────────────────────────────────────────────

function getCategoryInfo(cat: LulcCategory): LulcCategoryInfo {
  return LULC_CATEGORIES.find((c) => c.key === cat) ?? LULC_CATEGORIES[0]!;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLulcCategory(value: string): value is LulcCategory {
  return LULC_CATEGORIES.some((category) => category.key === value);
}

function parseCsvLine(line: string): string[] | null {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      fields.push(field.trim());
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) return null;
  fields.push(field.trim());
  return fields;
}

/** Import simple Polygon geometries without interpreting their CRS. */
export function parseGeoJsonPolygons(content: string): ImportedParcel[] {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed)) return [];
    const features: unknown[] = parsed.type === "FeatureCollection" && Array.isArray(parsed.features)
      ? parsed.features
      : parsed.type === "Feature"
        ? [parsed]
        : parsed.type === "Polygon"
          ? [{ geometry: parsed }]
          : [];
    const parcels = features.map((feature, index): ImportedParcel | null => {
      if (!isRecord(feature) || !isRecord(feature.geometry) || feature.geometry.type !== "Polygon") return null;
      const rings = feature.geometry.coordinates;
      // Reject unsupported holes, malformed rings, and non-finite coordinates as a whole.
      if (!Array.isArray(rings) || rings.length !== 1 || !Array.isArray(rings[0]) || rings[0].length < 3) return null;
      const points = rings[0].map((coordinate): { easting: number; northing: number } | null => {
        if (!Array.isArray(coordinate) || coordinate.length !== 2 || typeof coordinate[0] !== "number" || typeof coordinate[1] !== "number"
          || !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) return null;
        return { easting: coordinate[0], northing: coordinate[1] };
      });
      const validPoints = points.filter((point): point is { easting: number; northing: number } => point !== null);
      if (validPoints.length !== points.length) return null;
      const properties = isRecord(feature.properties) ? feature.properties : {};
      const id = properties.id ?? properties.PARCEL_ID ?? `IMP${index + 1}`;
      const name = properties.name ?? properties.NAME ?? `Imported Polygon ${index + 1}`;
      const classValue = properties.class ?? properties.category;
      return {
        id: String(id),
        name: String(name),
        points: validPoints,
        attributes: properties,
        ...(typeof classValue === "string" && isLulcCategory(classValue) ? { category: classValue } : {}),
      };
    });
    const validParcels = parcels.filter((parcel): parcel is ImportedParcel => parcel !== null);
    return validParcels.length === parcels.length ? validParcels : [];
  } catch {
    return [];
  }
}

/** Parse raw X/Y rows or this view's metadata-preserving draft CSV export. */
export function parseCsvParcels(content: string): ImportedParcel[] {
  const lines = content.split(/\r?\n/);
  const dataLines = lines.filter((line) => line.trim() && !line.trimStart().startsWith("#"));
  const parsedLines = dataLines.map(parseCsvLine);
  if (parsedLines.some((line) => line === null)) return [];
  const rows = parsedLines.filter((line): line is string[] => line !== null);
  const header = rows[0]?.map((field) => field.trim().toLowerCase()) ?? [];
  const idColumn = header.indexOf("zone_id");
  const xColumn = header.indexOf("x_raw");
  const yColumn = header.indexOf("y_raw");
  if (idColumn >= 0 && xColumn >= 0 && yColumn >= 0) {
    const nameColumn = header.indexOf("name");
    const classColumn = header.indexOf("class");
    const originalIdColumn = header.indexOf("original_id");
    const attributesColumn = header.indexOf("source_attributes_json");
    const grouped = new Map<string, ImportedParcel>();
    for (const row of rows.slice(1)) {
      const id = row[idColumn]?.trim();
      const x = Number(row[xColumn]);
      const y = Number(row[yColumn]);
      if (!id || !Number.isFinite(x) || !Number.isFinite(y)) return [];
      let parcel = grouped.get(id);
      if (!parcel) {
        const name = nameColumn >= 0 ? row[nameColumn] || id : id;
        const categoryValue = classColumn >= 0 ? row[classColumn] : "";
        let attributes: Record<string, unknown> = {};
        if (attributesColumn >= 0 && row[attributesColumn]) {
          try {
            const parsedAttributes: unknown = JSON.parse(row[attributesColumn]);
            if (!isRecord(parsedAttributes)) return [];
            attributes = parsedAttributes;
          } catch {
            return [];
          }
        }
        parcel = {
          id: originalIdColumn >= 0 ? row[originalIdColumn] || id : id,
          name,
          points: [],
          attributes,
          ...(categoryValue && isLulcCategory(categoryValue) ? { category: categoryValue } : {}),
        };
        grouped.set(id, parcel);
      }
      parcel.points.push({ easting: x, northing: y });
    }
    return Array.from(grouped.values()).every((parcel) => parcel.points.length >= 3) ? Array.from(grouped.values()) : [];
  }

  // Legacy ID,X,Y rows remain grouped by blank lines between polygons.
  const parcels: ImportedParcel[] = [];
  const blocks = content.split(/\r?\n\s*\r?\n/).filter((block) => block.trim());
  for (let bi = 0; bi < blocks.length; bi++) {
    const blockLines = blocks[bi].split(/\r?\n/).filter((line) => line.trim() && !line.trimStart().startsWith("#"));
    const lines = blockLines.map(parseCsvLine);
    if (lines.some((line) => line === null)) return [];
    const fields = lines.filter((line): line is string[] => line !== null);
    if (fields.length < 3) return [];
    const points: Array<{ easting: number; northing: number }> = [];
    let id = `CSV${bi + 1}`;
    for (const parts of fields) {
      if (parts.length >= 2) {
        if (["id", "zone_id"].includes(parts[0].toLowerCase())
          && ["e", "x", "easting", "x_raw"].includes(parts[1].toLowerCase())) continue;
        if (parts.length !== 2 && parts.length !== 3) return [];
        if (parts.length >= 3 && isNaN(parseFloat(parts[0]))) {
          id = parts[0];
          const easting = Number(parts[1]);
          const northing = Number(parts[2]);
          if (!Number.isFinite(easting) || !Number.isFinite(northing)) return [];
          points.push({ easting, northing });
        } else {
          const easting = Number(parts[0]);
          const northing = Number(parts[1]);
          if (!Number.isFinite(easting) || !Number.isFinite(northing)) return [];
          points.push({ easting, northing });
        }
      }
    }
    if (points.length < 3) return [];
    parcels.push({ id, name: `Parcel ${id}`, points });
  }
  return parcels;
}

// ─── Component ────────────────────────────────────────────────────

export const LULCView: React.FC = () => {
  const { setSurveyOutput, activeProject } = useSurveyState();
  const [selectedCountryCode, setSelectedCountryCode] = useState("");
  const countryCode = activeProject?.countryCode || selectedCountryCode;
  const [zones, setZones] = useState<LulcZone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<"view" | "add_zone" | "import_parcel">("view");
  const [newZoneName, setNewZoneName] = useState("");
  const [newZoneCategory, setNewZoneCategory] = useState<LulcCategory>("unclassified");
  const [newZonePoints, setNewZonePoints] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const [parcelText, setParcelText] = useState("");
  const [parcelFormat, setParcelFormat] = useState<"geojson" | "csv">("geojson");

  // ── Add zone manually ───────────────────────────────────────────

  const addZone = useCallback(() => {
    if (!newZoneName.trim()) return;
    const pts = newZonePoints.trim().split("\n").filter((line) => line.trim()).map((line) => {
      const [eText, nText] = line.split(",").map((value) => value.trim());
      if (!eText || !nText) return null;
      const e = Number(eText);
      const n = Number(nText);
      return Number.isFinite(e) && Number.isFinite(n) ? { easting: e, northing: n } : null;
    });
    if (pts.length < 3 || pts.some((point) => point === null)) {
      setNotice("Enter at least three coordinate pairs, with two finite numbers on every line.");
      return;
    }
    const points = pts as Array<{ easting: number; northing: number }>;
    setZones((prev) => [...prev, {
      id: `Z${prev.length + 1}`, name: newZoneName.trim(), category: newZoneCategory,
      points, color: getCategoryInfo(newZoneCategory).color, source: "manual",
    }]);
    setNewZoneName(""); setNewZonePoints(""); setEditMode("view");
  }, [newZoneName, newZoneCategory, newZonePoints]);

  const removeZone = useCallback((id: string) => {
    setZones((prev) => prev.filter((z) => z.id !== id));
    if (selectedZoneId === id) setSelectedZoneId(null);
  }, [selectedZoneId]);

  // ── Import parcels ──────────────────────────────────────────────

  const importParcels = useCallback(() => {
    if (!parcelText.trim()) return;
    const parcels = parcelFormat === "geojson"
      ? parseGeoJsonPolygons(parcelText)
      : parseCsvParcels(parcelText);

    if (parcels.length === 0) {
      setNotice("No valid polygons found. Check format and try again.");
      return;
    }

    const newZones: LulcZone[] = parcels.map((parcel, index) => ({
      id: `IMP${zones.length + index + 1}`,
      name: parcel.name,
      category: parcel.category ?? "unclassified",
      points: parcel.points,
      color: getCategoryInfo(parcel.category ?? "unclassified").color,
      source: "imported",
      parcelId: parcel.id,
      attributes: parcel.attributes,
    }));

    setZones((prev) => [...prev, ...newZones]);
    setParcelText("");
    setEditMode("view");
    setNotice(`Imported ${newZones.length} polygons as unclassified raw coordinates. Confirm source CRS and units before survey use.`);
  }, [parcelText, parcelFormat, zones.length]);

  const setZoneCategory = useCallback((id: string, category: LulcCategory) => {
    const color = getCategoryInfo(category).color;
    setZones((prev) => prev.map((zone) => zone.id === id ? { ...zone, category, color } : zone));
  }, []);

  // ── Stats ───────────────────────────────────────────────────────

  const categoryBreakdown = useMemo(() => {
    const counts = new Map<LulcCategory, number>();
    for (const zone of zones) counts.set(zone.category, (counts.get(zone.category) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([category, count]) => ({ ...getCategoryInfo(category), count, pct: zones.length ? (count / zones.length) * 100 : 0 }))
      .sort((a, b) => b.count - a.count);
  }, [zones]);

  // ── Export classification report ────────────────────────────────

  const exportReport = useCallback(() => {
    const report: string[] = [
      "# METARDU LULC geometry export — DRAFT / UNVERIFIED",
      `# Jurisdiction: ${countryCode || "not specified"}`,
      "# Coordinate reference and units: unverified; values are exported unchanged",
      "# Classes: generic thematic tags; not statutory or image-derived",
      `# Export date: ${new Date().toISOString().split("T")[0]}`,
      "Zone_ID,Name,Vertex,X_raw,Y_raw,Class,Source,Original_ID,Source_Attributes_JSON",
    ];
    for (const zone of zones) {
      zone.points.forEach((point, index) => {
        report.push([zone.id, zone.name.replace(/[\r\n]+/g, " "), index + 1, point.easting, point.northing, zone.category, zone.source, zone.parcelId ?? "", JSON.stringify(zone.attributes ?? {})].map(csvCell).join(","));
      });
      report.push("");
    }

    const blob = new Blob([report.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lulc_geometry_draft_${countryCode || "unspecified"}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice("Draft geometry export saved. Coordinates and classification remain unverified.");
  }, [zones, countryCode]);

  // ── Push to survey state ────────────────────────────────────────

  const pushToSurvey = useCallback(() => {
    setSurveyOutput({
      type: "lulc_draft",
      status: "draft",
      classificationBasis: "manual thematic tags; not statutory or image-derived",
      jurisdiction: countryCode || null,
      coordinateReference: { status: "unverified", crs: null, units: null },
      zones: zones.map((zone) => ({
        id: zone.id, name: zone.name, category: zone.category, points: zone.points, source: zone.source,
        originalId: zone.parcelId ?? null, sourceAttributes: zone.attributes ?? {},
      })),
    }, "lulc", "LULCView", countryCode);
    setNotice("Saved as an unverified LULC geometry draft. No CRS, area, or statutory result was inferred.");
  }, [zones, countryCode, setSurveyOutput]);

  const sourceBreakdown = useMemo(() => {
    const manual = zones.filter((z) => z.source === "manual").length;
    const imported = zones.filter((z) => z.source === "imported").length;
    return { manual, imported };
  }, [zones]);

  // ── Canvas ──────────────────────────────────────────────────────

  const canvasPolygons: SurveyPolygon[] = zones.map((z) => ({
    points: z.points.map((p) => ({ easting: p.easting, northing: p.northing, label: z.id })),
    strokeColor: z.color, strokeWidth: selectedZoneId === z.id ? 3 : 1.5,
    fillColor: `${z.color}20`, label: z.name,
  }));

  const canvasPoints: SurveyPoint[] = zones.flatMap((z) =>
    z.points.map((p, i) => ({ easting: p.easting, northing: p.northing, label: `${z.id}_${i + 1}` }))
  );

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
        Land Use / Land Cover Workspace
      </h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
        Organize polygon geometry with generic thematic tags. These tags are not statutory land-use classes, and this workspace does not classify imagery or establish survey area.
      </p>
      <div style={{ padding: "8px 12px", background: "rgba(251,146,60,0.1)", border: "1px solid #fb923c", color: "#fb923c", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
        Draft only: coordinates remain raw and unverified. CRS, units, image metadata, and sidecar area measurement are unavailable here.
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--text-xs)" }}>
          Project jurisdiction
          <select value={countryCode} disabled={Boolean(activeProject?.countryCode)} onChange={(e) => setSelectedCountryCode(e.target.value)} style={{ minWidth: "160px" }}>
            <option value="">Not specified</option>
            {countryCode && !COUNTRY_OPTIONS.some((option) => option.code === countryCode) && <option value={countryCode}>{countryCode} (project context)</option>}
            {COUNTRY_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
        </label>
        <button className={editMode === "add_zone" ? "primary" : ""} onClick={() => setEditMode(editMode === "add_zone" ? "view" : "add_zone")}
          style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <Plus size={14} /> Add Zone
        </button>
        <button className={editMode === "import_parcel" ? "primary" : ""} onClick={() => setEditMode(editMode === "import_parcel" ? "view" : "import_parcel")}
          style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <Upload size={14} /> Import Parcels
        </button>
        <button disabled title="Raster metadata parsing and sidecar classification are not available yet"
          style={{ display: "flex", alignItems: "center", gap: "4px", opacity: 0.55, cursor: "not-allowed" }}>
          <Upload size={14} /> Imagery analysis unavailable
        </button>
        <button onClick={exportReport} disabled={zones.length === 0} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <Download size={14} /> Export Draft Geometry
        </button>
        <button onClick={pushToSurvey} disabled={zones.length === 0} style={{ display: "flex", alignItems: "center", gap: "4px", border: "1px solid var(--accent-primary)", color: "var(--accent-primary)" }}>
          <FileText size={14} /> Save to Project
        </button>
      </div>

      {/* Notice */}
      {notice && (
        <div style={{ padding: "8px 12px", background: "rgba(34,197,94,0.1)", border: "1px solid #22c55e", color: "#22c55e", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: "6px" }}>
          {notice}
          <button onClick={() => setNotice(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#22c55e", cursor: "pointer", fontSize: "var(--text-xs)" }}>dismiss</button>
        </div>
      )}

      {/* Add zone form */}
      {editMode === "add_zone" && (
        <div style={{ padding: "12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <input placeholder="Zone name" value={newZoneName} onChange={(e) => setNewZoneName(e.target.value)} style={{ width: "100%" }} />
            <select value={newZoneCategory} onChange={(e) => setNewZoneCategory(e.target.value as LulcCategory)} style={{ width: "100%" }}>
              {LULC_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label} — {c.description}</option>)}
            </select>
            <button className="primary" onClick={addZone} disabled={!newZoneName.trim() || !newZonePoints.trim()}>Add Zone</button>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)", marginBottom: "4px" }}>Raw coordinate pairs (two values per line; reference and units stay unverified)</label>
            <textarea value={newZonePoints} onChange={(e) => setNewZonePoints(e.target.value)}
              style={{ width: "100%", height: "100px", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }} />
          </div>
        </div>
      )}

      {/* Import parcels form */}
      {editMode === "import_parcel" && (
        <div style={{ padding: "12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px" }}>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)", marginBottom: "4px" }}>
              Polygon coordinates ({parcelFormat === "geojson" ? "GeoJSON Polygon" : "CSV: ID,X,Y per line, blank line between polygons"})
            </label>
            <textarea value={parcelText} onChange={(e) => setParcelText(e.target.value)}
              placeholder={parcelFormat === "geojson"
                ? '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[x1,y1],[x2,y2],[x3,y3],[x1,y1]]]},"properties":{"id":"P1","name":"Polygon name"}}]}'
                : 'P1, x1, y1\nP1, x2, y2\nP1, x3, y3\n\nP2, x1, y1\nP2, x2, y2\nP2, x3, y3'}
              style={{ width: "100%", height: "120px", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)", marginBottom: "4px" }}>Format</label>
              <select value={parcelFormat} onChange={(e) => setParcelFormat(e.target.value as "geojson" | "csv")} style={{ width: "100%" }}>
                <option value="geojson">GeoJSON</option>
                <option value="csv">CSV</option>
              </select>
            </div>
              <button className="primary" onClick={importParcels} disabled={!parcelText.trim()} style={{ marginTop: "auto" }}>
              Import as Unclassified
            </button>
          </div>
        </div>
      )}

      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(categoryBreakdown.length + 1, 6)}, 1fr)`, gap: "8px" }}>
        <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textTransform: "uppercase" }}>Geometry count</div>
          <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)" }}>{zones.length} zones</div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Area unavailable</div>
        </div>
        {categoryBreakdown.slice(0, 5).map((c) => (
          <div key={c.key} style={{ padding: "8px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
            <div style={{ fontSize: "var(--text-xs)", color: c.color, textTransform: "uppercase" }}>{c.label}</div>
            <div style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-mono)" }}>{c.count}</div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>{c.count} zone{c.count !== 1 ? "s" : ""}</div>
          </div>
        ))}
      </div>

      {/* Source breakdown */}
      <div style={{ display: "flex", gap: "16px", fontSize: "var(--text-xs)", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
        <span>{sourceBreakdown.manual} manual</span>
        <span>{sourceBreakdown.imported} imported</span>
      </div>

      {/* Zone table */}
      <div>
        <h3 style={{ fontSize: "var(--text-md)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
          <Layers size={14} style={{ verticalAlign: "middle", marginRight: "6px" }} />
          Thematic zones ({zones.length})
        </h3>
        {zones.length === 0 && (
          <p style={{ padding: "12px", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
            No geometry loaded. Import a simple 2D polygon or add raw coordinate pairs to start a draft.
          </p>
        )}
        <div style={{ maxHeight: "250px", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
            <thead>
              <tr style={{ background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>ID</th>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Name</th>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Category</th>
                <th style={{ padding: "6px 8px", textAlign: "center" }}>Source</th>
                <th style={{ padding: "6px 8px", textAlign: "center" }}></th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => {
                return (
                  <tr key={z.id} onClick={() => setSelectedZoneId(z.id)}
                    style={{ borderBottom: "1px solid var(--border-subtle)", cursor: "pointer", background: selectedZoneId === z.id ? "rgba(255,149,0,0.08)" : undefined }}>
                    <td style={{ padding: "6px 8px", fontWeight: "bold" }}>{z.id}</td>
                    <td style={{ padding: "6px 8px" }}>{z.name}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <select aria-label={`Thematic category for ${z.name}`} value={z.category} onChange={(e) => setZoneCategory(z.id, e.target.value as LulcCategory)}>
                        {LULC_CATEGORIES.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "center" }}>
                      <span style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "10px",
                        background: z.source === "imported" ? "rgba(59,130,246,0.15)" : "rgba(34,197,94,0.15)",
                        color: z.source === "imported" ? "#3b82f6" : "#22c55e" }}>
                        {z.source === "imported" ? "IMPORT" : "MANUAL"}
                      </span>
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "center" }}>
                      <button onClick={(e) => { e.stopPropagation(); removeZone(z.id); }}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)" }}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Full category breakdown bar */}
      <div>
        <h4 style={{ fontSize: "var(--text-sm)", marginBottom: "6px", fontFamily: "var(--font-mono)" }}>Zone count by thematic tag</h4>
        <div style={{ display: "flex", height: "24px", borderRadius: "4px", overflow: "hidden", border: "1px solid var(--border-default)" }}>
          {categoryBreakdown.map((c) => (
            <div key={c.key} style={{ width: `${c.pct}%`, background: c.color, minWidth: c.pct > 0 ? "2px" : "0", position: "relative" }}
              title={`${c.label}: ${c.count} zones (${c.pct.toFixed(1)}% of zones)`} />
          ))}
        </div>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "6px", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
          {categoryBreakdown.map((c) => (
            <span key={c.key} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: c.color, display: "inline-block" }} />
              {c.label} ({c.count} zones)
            </span>
          ))}
        </div>
      </div>

      {/* Canvas */}
      {canvasPolygons.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
          <SurveyCanvas height={400} title="LULC geometry preview — raw coordinates" polygons={canvasPolygons} points={canvasPoints}
            showPointLabels={false} showNorthArrow={false} showScaleBar={false} />
        </div>
      )}
    </div>
  );
};
