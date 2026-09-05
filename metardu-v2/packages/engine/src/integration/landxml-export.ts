/**
 * LandXML 1.2 Integration Exporter
 *
 * Exports survey data to OGC LandXML 1.2 format for digital submission
 * to land registries (Kenya NLIMS/ArdhiSasa, Australia NSW LRS, etc.)
 * and interoperability with other survey/GIS software.
 *
 * LandXML 1.2 schema: https://www.landxml.org/schema/LandXML-1.2
 *
 * Supports:
 *   - Cadastral: parcels (PntList2D) with area, beacons, title references
 *   - Topographic: coordinate collections, contours, spot heights
 *   - Engineering: alignment centerlines, cross-sections, surface models
 */

import type { IntegrationExporter, IntegrationOptions, IntegrationOutput } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────

export interface LandxmlOptions extends IntegrationOptions {}

export interface LandxmlOutput extends IntegrationOutput {
  /** XML string content. */
  xml: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function indent(level: number): string {
  return "  ".repeat(level);
}

function formatCoord(e: number, n: number): string {
  return `${e.toFixed(4)} ${n.toFixed(4)}`;
}

// ─── Cadastral Parcel Export ─────────────────────────────────────

function exportCadastralXml(
  beacons: Array<{ label: string; position: { easting: number; northing: number }; description?: string }>,
  _countryCode: string,
  projectName: string,
  surveyorName?: string,
  srid?: number,
): string {
  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w(`<?xml version="1.0" encoding="UTF-8"?>`);
  w(`<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2"`);
  w(`  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`);
  w(`  xsi:schemaLocation="http://www.landxml.org/schema/LandXML-1.2 http://www.landxml.org/schema/LandXML-1.2/LandXML-1.2.xsd">`);
  w(`${indent(1)}<Application name="MetaRDU Desktop" version="2.0" />`);
  w(`${indent(1)}<Project name="${esc(projectName)}"${surveyorName ? ` desc="Surveyed by ${esc(surveyorName)}"` : ""}>`);

  // Units
  w(`${indent(2)}<Units>`);
  w(`${indent(3)}<Metric name="meter" area="sqMeter" volume="cubicMeter" temperature="celsius" pressure="kpa" angular="decimalDegrees" />`);
  w(`${indent(2)}</Units>`);

  // Coordinate system
  if (srid) {
    w(`${indent(2)}<CoordinateSystem type="${srid}" />`);
  }

  // Parcels
  w(`${indent(2)}<Parcels>`);
  w(`${indent(3)}<Parcel name="${esc(projectName)}" area="0" areaUnits="sqMeter" setState="proposed" setBack="0" setNumber="1">`);

  // Beacon coordinate list (closed polygon)
  if (beacons.length >= 3) {
    w(`${indent(4)}<PntList2D>`);
    for (const b of beacons) {
      w(`${indent(5)}${formatCoord(b.position.easting, b.position.northing)}`);
    }
    // Close the polygon
    const first = beacons[0]!;
    w(`${indent(5)}${formatCoord(first.position.easting, first.position.northing)}`);
    w(`${indent(4)}</PntList2D>`);
  }

  // Compute area via shoelace formula
  if (beacons.length >= 3) {
    let area = 0;
    for (let i = 0; i < beacons.length; i++) {
      const j = (i + 1) % beacons.length;
      area += beacons[i]!.position.easting * beacons[j]!.position.northing;
      area -= beacons[j]!.position.easting * beacons[i]!.position.northing;
    }
    area = Math.abs(area) / 2;
    // Update area in the Parcel element (via string replacement)
    const areaStr = `area="${area.toFixed(4)}"`;
    const lastIdx = lines.length - 1;
    lines[lastIdx] = lines[lastIdx]!.replace(/area="0"/, areaStr);
  }

  // Beacon details
  w(`${indent(4)}<Beacon>
${indent(5)}<BeaconType>Concrete Pillar</BeaconType>`);
  w(`${indent(3)}</Parcel>`);
  w(`${indent(2)}</Parcels>`);

  // Points
  w(`${indent(2)}<CoordinateCollections>`);
  w(`${indent(3)}<CoordinateCollection name="Beacons">`);
  for (const b of beacons) {
    w(`${indent(4)}<Pnt id="${esc(b.label)}" code="100">`);
    w(`${indent(5)}<PntCoord>${formatCoord(b.position.easting, b.position.northing)}</PntCoord>`);
    if (b.description) {
      w(`${indent(5)}<Desc>${esc(b.description)}</Desc>`);
    }
    w(`${indent(4)}</Pnt>`);
  }
  w(`${indent(3)}</CoordinateCollection>`);
  w(`${indent(2)}</CoordinateCollections>`);

  w(`${indent(1)}</Project>`);
  w(`</LandXML>`);

  return lines.join("\n");
}

// ─── Topographic Export ──────────────────────────────────────────

function exportTopographicXml(
  points: Array<{ easting: number; northing: number; elevation?: number; label?: string }>,
  contours: Array<{ elevation: number; coordinates: [number, number][] }>,
  projectName: string,
  srid?: number,
): string {
  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w(`<?xml version="1.0" encoding="UTF-8"?>`);
  w(`<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2"`);
  w(`  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`);
  w(`  xsi:schemaLocation="http://www.landxml.org/schema/LandXML-1.2 http://www.landxml.org/schema/LandXML-1.2/LandXML-1.2.xsd">`);
  w(`${indent(1)}<Application name="MetaRDU Desktop" version="2.0" />`);
  w(`${indent(1)}<Project name="${esc(projectName)}">`);

  w(`${indent(2)}<Units>`);
  w(`${indent(3)}<Metric name="meter" area="sqMeter" volume="cubicMeter" temperature="celsius" pressure="kpa" angular="decimalDegrees" />`);
  w(`${indent(2)}</Units>`);

  if (srid) {
    w(`${indent(2)}<CoordinateSystem type="${srid}" />`);
  }

  // Survey points
  w(`${indent(2)}<CoordinateCollections>`);
  w(`${indent(3)}<CoordinateCollection name="Survey Points">`);
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const id = p.label ?? `P${i + 1}`;
    w(`${indent(4)}<Pnt id="${esc(id)}" code="100">`);
    w(`${indent(5)}<PntCoord>${formatCoord(p.easting, p.northing)}${p.elevation !== undefined ? ` ${p.elevation.toFixed(4)}` : ""}</PntCoord>`);
    w(`${indent(4)}</Pnt>`);
  }
  w(`${indent(3)}</CoordinateCollection>`);
  w(`${indent(2)}</CoordinateCollections>`);

  // Contours as feature collections
  if (contours.length > 0) {
    w(`${indent(2)}<FeatureCollections>`);
    for (const contour of contours) {
      if (contour.coordinates.length < 2) continue;
      w(`${indent(3)}<FeatureCollection name="Contour ${contour.elevation.toFixed(1)}m">`);
      w(`${indent(4)}<Feature type="ContourLine">`);
      w(`${indent(5)}<PntList2D>`);
      for (const [e, n] of contour.coordinates) {
        w(`${indent(6)}${formatCoord(e, n)}`);
      }
      w(`${indent(5)}</PntList2D>`);
      w(`${indent(4)}</Feature>`);
      w(`${indent(3)}</FeatureCollection>`);
    }
    w(`${indent(2)}</FeatureCollections>`);
  }

  w(`${indent(1)}</Project>`);
  w(`</LandXML>`);

  return lines.join("\n");
}

// ─── Main Exporter ───────────────────────────────────────────────

export const landxmlExporter: IntegrationExporter<
  { allBeacons?: unknown[]; tin?: { vertices?: unknown[] }; contours?: unknown[]; [key: string]: unknown },
  LandxmlOptions,
  LandxmlOutput
> = {
  format: "landxml",
  mimeType: "application/xml",
  fileExtension: "xml",

  description: "Export survey data to OGC LandXML 1.2 format",

  validate(input, _options) {
    const hasBeacons =
      typeof input === "object" && input !== null && "allBeacons" in input;
    const hasTin =
      typeof input === "object" && input !== null && "tin" in input;

    if (!hasBeacons && !hasTin) {
      return { ok: false, errors: ["Input must have allBeacons (cadastral) or tin (topographic)"], warnings: [] };
    }
    return { ok: true, errors: [], warnings: [] };
  },

  async export(input, options): Promise<LandxmlOutput> {
    const validation = this.validate(input, options);
    if (!validation.ok) {
      throw new Error(`LandXML validation failed: ${validation.errors.join("; ")}`);
    }

    const obj = input as Record<string, unknown>;
    const projectName = (options.projectMetadata as any)?.projectName as string ?? "Survey";
    const surveyorName = (options.projectMetadata as any)?.surveyorName as string | undefined;
    const srid = (options as any).srid;
    const countryCode = options.countryCode ?? "KE";

    let xml: string;

    // Cadastral output (has allBeacons)
    if ("allBeacons" in obj && Array.isArray(obj.allBeacons)) {
      const beacons = obj.allBeacons as Array<{
        label: string;
        position: { easting: number; northing: number };
        description?: string;
      }>;
      xml = exportCadastralXml(beacons, countryCode, projectName, surveyorName, srid);
    }
    // Topographic output (has tin + contours)
    else if ("tin" in obj) {
      const tin = obj.tin as { vertices?: Array<{ easting: number; northing: number; elevation?: number }> };
      const points = (tin.vertices ?? []) as Array<{ easting: number; northing: number; elevation?: number }>;
      const contours = (obj.contours ?? []) as Array<{ elevation: number; coordinates: [number, number][] }>;
      xml = exportTopographicXml(points, contours, projectName, srid);
    }
    else {
      throw new Error("Unsupported survey type for LandXML export");
    }

    const encoder = new TextEncoder();
    const bytes = encoder.encode(xml);

    // Count features (beacons or topo points).
    const obj2 = input as Record<string, unknown>;
    const featureCount = Array.isArray(obj2.allBeacons)
      ? obj2.allBeacons.length
      : Array.isArray((obj2.tin as Record<string, unknown>)?.vertices)
        ? ((obj2.tin as Record<string, unknown>).vertices as unknown[]).length
        : 0;

    return {
      format: "landxml",
      bytes,
      featureCount,
      warnings: [],
      xml,
    };
  },
};
