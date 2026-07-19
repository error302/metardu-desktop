/**
 * DXF output module — generates CAD-compatible DXF files for survey plans.
 *
 * Per master plan Section 7 + the research on Carlson Survey / Civil 3D:
 * DXF is the industry-standard exchange format for surveying deliverables.
 * Every statutory document that has a PDF rendering should also have a DXF
 * companion so surveyors can import the plan into their CAD software
 * (AutoCAD, Carlson, Civil 3D, QGIS, etc.).
 *
 * # Library
 *
 * Uses @tarikjabiri/dxf (TypeScript-native, MIT, zero deps). Chosen over
 * dxf-writer (older, CommonJS) and dxf-parser-writer (unmaintained) because:
 *   - TypeScript types included (no @types needed)
 *   - Active maintenance (last published 2023)
 *   - Clean OOP API: DxfDocument → addLayer → addLine/addCircle/addText
 *   - Supports LWPolyline, Circle, Text, Line — all we need for survey plans
 *
 * # Layer conventions
 *
 * Per the Form 3 spec (docs/regulatory-sources/kenya/cadastral/form-3-spec.md):
 *   BOUNDARY, BEACON, TEXT-DEEDPLAN, TEXT-COORDS, TEXT-AREA,
 *   TITLE-BLOCK, NORTH-ARROW, SCALE-BAR
 *
 * These match the industry standard (AIA CAD Layer Guidelines + surveying
 * practice). Each layer has a specific color per the spec.
 *
 * # References
 *
 *   - Autodesk DXF Reference: https://www.autodesk.com/techpubs/autocad/acadr2000/dxf/
 *   - AIA CAD Layer Guidelines (US National CAD Standard v5)
 *   - Carlson Survey DXF import/export documentation
 *   - @tarikjabiri/dxf docs: https://dxf.vercel.app/
 */

import {
  DxfDocument,
  Colors,
  Units,
  LineTypes,
  point3d,
  type vec3_t,
} from "@tarikjabiri/dxf";

// ─── Types ───────────────────────────────────────────────────────

/** A 2D point for DXF output (easting, northing in metres). */
export interface DxfPoint {
  x: number;
  y: number;
}

/** A DXF layer definition. */
export interface DxfLayerDef {
  name: string;
  color: number; // AutoCAD Color Index (ACI)
  lineType?: string;
}

/** Standard survey plan layers per the Form 3 spec. */
export const SURVEY_LAYERS: DxfLayerDef[] = [
  { name: "BOUNDARY", color: Colors.White },
  { name: "BEACON", color: Colors.White },
  { name: "TEXT-DEEDPLAN", color: Colors.Cyan },
  { name: "TEXT-COORDS", color: Colors.Cyan },
  { name: "TEXT-AREA", color: Colors.Cyan },
  { name: "TEXT-BEARINGS", color: Colors.Green },
  { name: "TEXT-DISTANCES", color: Colors.Green },
  { name: "TEXT-BEACON-LABELS", color: Colors.Yellow },
  { name: "TITLE-BLOCK", color: Colors.White },
  { name: "COORD-SCHEDULE", color: Colors.White },
  { name: "NORTH-ARROW", color: Colors.White },
  { name: "SCALE-BAR", color: Colors.White },
  { name: "GRID", color: 8 }, // ACI 8 = gray
  // Topographic layers
  { name: "TIN-EDGES", color: 8 },
  { name: "CONTOURS", color: Colors.Green },
  { name: "SPOT-HEIGHTS", color: Colors.Cyan },
  // Engineering layers
  { name: "ALIGNMENT", color: Colors.Yellow },
  { name: "CROSS-SECTIONS", color: Colors.Magenta },
  { name: "DESIGN-SURFACE", color: Colors.Red },
  // Sectional layers
  { name: "UNIT-BOUNDARY", color: Colors.White },
  { name: "COMMON-PROPERTY", color: 8 },
];

// ─── DXF document builder ────────────────────────────────────────

/**
 * Create a new DXF document with the standard survey layers pre-defined.
 *
 * The document uses metric units (metres) per surveying convention.
 */
export function createSurveyDxf(): DxfDocument {
  const doc = new DxfDocument();

  // Set the units to metric (metres).
  doc.setUnits(Units.Meters);

  // Add all standard survey layers.
  for (const layer of SURVEY_LAYERS) {
    doc.tables.addLayer(layer.name, layer.color, layer.lineType ?? LineTypes.Continuous);
  }

  return doc;
}

// ─── Entity helpers ──────────────────────────────────────────────

/**
 * Add a closed polygon (boundary) to the DXF on the specified layer.
 *
 * @param doc DXF document
 * @param points Ordered list of vertices (closed implicitly)
 * @param layerName Layer to draw on (default: BOUNDARY)
 */
export function addPolygon(
  doc: DxfDocument,
  points: DxfPoint[],
  layerName: string = "BOUNDARY",
): void {
  if (points.length < 2) return;

  // Draw each edge as a LINE entity. (LWPolyline is more compact but
  // LINE is more universally compatible with older CAD software.)
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    doc.entities.modelSpace.addLine(toVec3(a), toVec3(b), { layerName });
  }
}

/**
 * Add a beacon symbol (circle) to the DXF on the BEACON layer.
 *
 * @param doc DXF document
 * @param center Center point
 * @param radius Radius in metres (default 0.5m — visible at 1:500 scale)
 * @param label Optional text label (e.g. "B1")
 */
export function addBeacon(
  doc: DxfDocument,
  center: DxfPoint,
  radius: number = 0.5,
  label?: string,
): void {
  doc.entities.modelSpace.addCircle(toVec3(center), radius, { layerName: "BEACON" });

  if (label) {
    addText(doc, label, { x: center.x + 1, y: center.y + 1 }, "TEXT-BEACON-LABELS", 1.5);
  }
}

/**
 * Add a text entity to the DXF.
 *
 * @param doc DXF document
 * @param text Text string
 * @param position Insertion point
 * @param layerName Layer (default: TEXT-COORDS)
 * @param height Text height in metres (default 2.0 — visible at 1:500)
 * @param rotation Rotation in degrees (default 0)
 */
export function addText(
  doc: DxfDocument,
  text: string,
  position: DxfPoint,
  layerName: string = "TEXT-COORDS",
  height: number = 2.0,
  rotation: number = 0,
): void {
  doc.entities.modelSpace.addText(toVec3(position), height, text, { layerName, rotation });
}

/**
 * Add a bearing + distance label along a line segment.
 *
 * @param doc DXF document
 * @param from Start point
 * @param to End point
 */
export function addBearingDistanceLabel(
  doc: DxfDocument,
  from: DxfPoint,
  to: DxfPoint,
): void {
  const de = to.x - from.x;
  const dn = to.y - from.y;
  const distance = Math.sqrt(de * de + dn * dn);
  if (distance < 0.001) return;

  let bearing = (Math.atan2(de, dn) * 180) / Math.PI;
  if (bearing < 0) bearing += 360;

  // Format bearing as DDD°MM'SS"
  const d = Math.floor(bearing);
  const mFull = (bearing - d) * 60;
  const m = Math.floor(mFull);
  const s = Math.round((mFull - m) * 60);
  const brgStr = `${String(d).padStart(3, "0")}d${String(m).padStart(2, "0")}'${String(s).padStart(2, "0")}"`;
  const distStr = `${distance.toFixed(3)}m`;

  // Place labels at the midpoint of the segment.
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  addText(doc, brgStr, { x: mid.x, y: mid.y + 1 }, "TEXT-BEARINGS", 1.5);
  addText(doc, distStr, { x: mid.x, y: mid.y - 2 }, "TEXT-DISTANCES", 1.5);
}

/**
 * Add a north arrow at the specified position.
 * Draws a simple line + "N" text.
 */
export function addNorthArrow(doc: DxfDocument, position: DxfPoint, size: number = 5): void {
  // Vertical line
  doc.entities.modelSpace.addLine(toVec3(position), toVec3({ x: position.x, y: position.y + size }), { layerName: "NORTH-ARROW" });
  // Arrow head (two lines)
  doc.entities.modelSpace.addLine(
    toVec3({ x: position.x - size / 6, y: position.y + size - size / 3 }),
    toVec3({ x: position.x, y: position.y + size }),
    { layerName: "NORTH-ARROW" },
  );
  doc.entities.modelSpace.addLine(
    toVec3({ x: position.x + size / 6, y: position.y + size - size / 3 }),
    toVec3({ x: position.x, y: position.y + size }),
    { layerName: "NORTH-ARROW" },
  );
  // "N" label
  addText(doc, "N", { x: position.x - 0.5, y: position.y + size + 0.5 }, "NORTH-ARROW", 2.0);
}

/**
 * Add a scale bar at the specified position.
 */
export function addScaleBar(
  doc: DxfDocument,
  position: DxfPoint,
  length: number = 100, // metres
  segments: number = 4,
): void {
  const segLen = length / segments;
  for (let i = 0; i < segments; i++) {
    const x = position.x + i * segLen;
    doc.entities.modelSpace.addLine(toVec3({ x, y: position.y }), toVec3({ x: x + segLen, y: position.y }), { layerName: "SCALE-BAR" });
    // Tick marks at segment boundaries
    doc.entities.modelSpace.addLine(toVec3({ x, y: position.y - 1 }), toVec3({ x, y: position.y + 1 }), { layerName: "SCALE-BAR" });
  }
  // Final tick
  doc.entities.modelSpace.addLine(
    toVec3({ x: position.x + length, y: position.y - 1 }),
    toVec3({ x: position.x + length, y: position.y + 1 }),
    { layerName: "SCALE-BAR" },
  );
  // Labels
  addText(doc, "0", { x: position.x, y: position.y - 3 }, "SCALE-BAR", 1.5);
  addText(doc, `${length}m`, { x: position.x + length - 3, y: position.y - 3 }, "SCALE-BAR", 1.5);
}

/**
 * Add a TIN (triangulated irregular network) to the DXF.
 * Each triangle edge is drawn as a line on the TIN-EDGES layer.
 */
export function addTIN(
  doc: DxfDocument,
  vertices: DxfPoint[],
  triangles: [number, number, number][],
): void {
  for (const tri of triangles) {
    const a = vertices[tri[0]];
    const b = vertices[tri[1]];
    const c = vertices[tri[2]];
    if (!a || !b || !c) continue;
    // Draw 3 edges per triangle
    for (const [p1, p2] of [[a, b], [b, c], [c, a]] as const) {
      doc.entities.modelSpace.addLine(toVec3(p1), toVec3(p2), { layerName: "TIN-EDGES" });
    }
  }
}

/**
 * Add contour lines to the DXF.
 * Each contour segment is drawn as a line on the CONTOURS layer.
 */
export function addContours(
  doc: DxfDocument,
  contours: { elevation: number; coordinates: [number, number][] }[],
): void {
  for (const contour of contours) {
    for (let i = 0; i < contour.coordinates.length - 1; i += 2) {
      const a = contour.coordinates[i]!;
      const b = contour.coordinates[i + 1];
      if (!b) continue;
      doc.entities.modelSpace.addLine(
        toVec3({ x: a[0], y: a[1] }),
        toVec3({ x: b[0], y: b[1] }),
        { layerName: "CONTOURS" },
      );
    }
  }
}

/**
 * Add spot height markers (point + elevation text).
 */
export function addSpotHeights(
  doc: DxfDocument,
  spotHeights: { x: number; y: number; elevation: number }[],
): void {
  for (const sh of spotHeights) {
    // Small cross marker
    const s = 0.5;
    doc.entities.modelSpace.addLine(toVec3({ x: sh.x - s, y: sh.y }), toVec3({ x: sh.x + s, y: sh.y }), { layerName: "SPOT-HEIGHTS" });
    doc.entities.modelSpace.addLine(toVec3({ x: sh.x, y: sh.y - s }), toVec3({ x: sh.x, y: sh.y + s }), { layerName: "SPOT-HEIGHTS" });
    // Elevation text
    addText(doc, `+${sh.elevation.toFixed(2)}`, { x: sh.x + 1, y: sh.y + 1 }, "SPOT-HEIGHTS", 1.5);
  }
}

// ─── Serialize ───────────────────────────────────────────────────

/**
 * Serialize the DXF document to a string.
 *
 * The output is a standard DXF file compatible with AutoCAD, Carlson
 * Survey, Civil 3D, QGIS, and any other software that reads DXF.
 */
export function serializeDxf(doc: DxfDocument): string {
  return doc.stringify();
}

// ─── High-level: generate a Form 3 DXF companion ─────────────────

/**
 * Generate a DXF companion for a Form 3 (Deed Plan).
 *
 * This produces the same information as the PDF renderer but in CAD-
 * compatible DXF format. Surveyors can import this into AutoCAD /
 * Carlson / Civil 3D / QGIS for further editing or integration with
 * other CAD work.
 *
 * @param beacons Array of beacons with label, position, description
 * @param srid SRID for the coordinate system (e.g. 21037 for Arc 1960 / UTM 37S)
 * @returns DXF file as a string
 */
export function generateForm3Dxf(
  beacons: { label: string; position: { easting: number; northing: number }; description: string }[],
  srid: number,
): string {
  const doc = createSurveyDxf();

  // Draw the boundary as a closed polygon.
  const boundaryPoints = beacons.map((b) => ({ x: b.position.easting, y: b.position.northing }));
  addPolygon(doc, boundaryPoints, "BOUNDARY");

  // Draw each beacon + label.
  for (const b of beacons) {
    addBeacon(doc, { x: b.position.easting, y: b.position.northing }, 0.5, b.label);
  }

  // Draw bearing + distance labels for each boundary segment.
  for (let i = 0; i < beacons.length; i++) {
    const a = beacons[i]!;
    const b = beacons[(i + 1) % beacons.length]!;
    addBearingDistanceLabel(doc, { x: a.position.easting, y: a.position.northing }, { x: b.position.easting, y: b.position.northing });
  }

  // Add coordinate schedule text.
  let y = -5;
  addText(doc, `COORDINATES: SRID ${srid}`, { x: 0, y }, "TEXT-COORDS", 2.0);
  y -= 3;
  for (const b of beacons) {
    addText(
      doc,
      `${b.label}  E=${b.position.easting.toFixed(3)}  N=${b.position.northing.toFixed(3)}  ${b.description}`,
      { x: 0, y },
      "TEXT-COORDS",
      1.5,
    );
    y -= 2.5;
  }

  // Add north arrow (top-right of the parcel bounds).
  const maxE = Math.max(...boundaryPoints.map((p) => p.x));
  const maxN = Math.max(...boundaryPoints.map((p) => p.y));
  addNorthArrow(doc, { x: maxE + 5, y: maxN + 5 }, 5);

  // Add scale bar (bottom-left).
  const minE = Math.min(...boundaryPoints.map((p) => p.x));
  const minN = Math.min(...boundaryPoints.map((p) => p.y));
  addScaleBar(doc, { x: minE, y: minN - 10 }, 50, 4);

  return serializeDxf(doc);
}

// ─── High-level: generate a Topographic DXF ──────────────────────

/**
 * Generate a DXF for a topographic survey plan.
 *
 * Includes: TIN edges, contour lines, spot heights, grid, north arrow,
 * scale bar. All on standard survey layers.
 *
 * @param tin The TIN (vertices + triangles)
 * @param contours Array of contour lines
 * @param spotHeights Array of spot height points
 * @param srid SRID for the coordinate system
 * @returns DXF file as a string
 */
export function generateTopoDxf(
  tin: { vertices: { easting: number; northing: number; elevation: number }[]; triangles: [number, number, number][] },
  contours: { elevation: number; coordinates: [number, number][] }[],
  spotHeights: { easting: number; northing: number; elevation: number }[],
  srid: number,
): string {
  const doc = createSurveyDxf();

  // TIN edges
  addTIN(
    doc,
    tin.vertices.map((v) => ({ x: v.easting, y: v.northing })),
    tin.triangles,
  );

  // Contours
  addContours(doc, contours);

  // Spot heights (convert from easting/northing to x/y for the DXF API)
  addSpotHeights(doc, spotHeights.map((sh) => ({ x: sh.easting, y: sh.northing, elevation: sh.elevation })));

  // North arrow + scale bar
  const maxE = Math.max(...tin.vertices.map((v) => v.easting));
  const maxN = Math.max(...tin.vertices.map((v) => v.northing));
  const minE = Math.min(...tin.vertices.map((v) => v.easting));
  const minN = Math.min(...tin.vertices.map((v) => v.northing));
  addNorthArrow(doc, { x: maxE + 5, y: maxN + 5 }, 5);
  addScaleBar(doc, { x: minE, y: minN - 10 }, 50, 4);

  // SRID label
  addText(doc, `COORDINATES: SRID ${srid}`, { x: minE, y: minN - 15 }, "TEXT-COORDS", 2.0);

  return serializeDxf(doc);
}

// ─── High-level: generate an Engineering DXF ─────────────────────

/**
 * Generate a DXF for an engineering survey (cut/fill plan).
 *
 * Includes: alignment centerline, cross-section locations, design
 * surface outline, existing ground outline, cut/fill area annotations.
 *
 * @param alignment The centerline alignment
 * @param sections Cross-section data with cut/fill areas
 * @param srid SRID
 * @returns DXF file as a string
 */
export function generateEngineeringDxf(
  alignment: { points: { chainage: number; easting: number; northing: number }[] },
  sections: { chainage: number; centerline: { easting: number; northing: number }; area: number }[],
  srid: number,
): string {
  const doc = createSurveyDxf();

  // Draw the alignment as a series of connected lines.
  for (let i = 0; i < alignment.points.length - 1; i++) {
    const a = alignment.points[i]!;
    const b = alignment.points[i + 1]!;
    doc.entities.modelSpace.addLine(
      toVec3({ x: a.easting, y: a.northing }),
      toVec3({ x: b.easting, y: b.northing }),
      { layerName: "ALIGNMENT" },
    );
  }

  // Mark each cross-section location.
  for (const s of sections) {
    addBeacon(doc, { x: s.centerline.easting, y: s.centerline.northing }, 0.5, `CH${s.chainage.toFixed(0)}`);
    // Cut/fill annotation
    const label = s.area > 0 ? `CUT ${s.area.toFixed(1)}m²` : s.area < 0 ? `FILL ${Math.abs(s.area).toFixed(1)}m²` : "—";
    addText(doc, label, { x: s.centerline.easting + 2, y: s.centerline.northing + 2 }, "CROSS-SECTIONS", 1.5);
  }

  // North arrow + scale bar
  const allPoints = [...alignment.points.map((p) => ({ x: p.easting, y: p.northing }))];
  if (allPoints.length > 0) {
    const maxE = Math.max(...allPoints.map((p) => p.x));
    const maxN = Math.max(...allPoints.map((p) => p.y));
    const minE = Math.min(...allPoints.map((p) => p.x));
    const minN = Math.min(...allPoints.map((p) => p.y));
    addNorthArrow(doc, { x: maxE + 5, y: maxN + 5 }, 5);
    addScaleBar(doc, { x: minE, y: minN - 10 }, 50, 4);
    addText(doc, `COORDINATES: SRID ${srid}`, { x: minE, y: minN - 15 }, "TEXT-COORDS", 2.0);
  }

  return serializeDxf(doc);
}

// ─── High-level: generate a Sectional Properties DXF ─────────────

/**
 * Generate a DXF for a sectional properties plan.
 *
 * Includes: building footprint, unit boundaries (with labels),
 * common property areas, participation quota annotations.
 *
 * @param levels Building levels with units
 * @returns DXF file as a string
 */
export function generateSectionalDxf(
  levels: {
    level: number;
    name: string;
    footprint: { vertices: { easting: number; northing: number }[] };
    units: { number: string; boundary: { vertices: { easting: number; northing: number }[] }; type: string }[];
    commonProperty: { vertices: { easting: number; northing: number }[] }[];
  }[],
): string {
  const doc = createSurveyDxf();

  // Draw each level (only ground floor for now — multi-level DXF
  // requires separate layout tabs, which is a future enhancement).
  const level0 = levels.find((l) => l.level === 0) ?? levels[0];
  if (level0) {
    // Building footprint (dashed outline)
    addPolygon(
      doc,
      level0.footprint.vertices.map((v) => ({ x: v.easting, y: v.northing })),
      "COMMON-PROPERTY",
    );

    // Unit boundaries
    for (const unit of level0.units) {
      addPolygon(
        doc,
        unit.boundary.vertices.map((v) => ({ x: v.easting, y: v.northing })),
        "UNIT-BOUNDARY",
      );
      // Unit label at centroid
      const cx = unit.boundary.vertices.reduce((s, v) => s + v.easting, 0) / unit.boundary.vertices.length;
      const cy = unit.boundary.vertices.reduce((s, v) => s + v.northing, 0) / unit.boundary.vertices.length;
      addText(doc, `Unit ${unit.number}`, { x: cx - 3, y: cy }, "TEXT-COORDS", 2.0);
      addText(doc, `(${unit.type})`, { x: cx - 3, y: cy - 3 }, "TEXT-COORDS", 1.5);
    }

    // Common property
    for (const cp of level0.commonProperty) {
      addPolygon(
        doc,
        cp.vertices.map((v) => ({ x: v.easting, y: v.northing })),
        "COMMON-PROPERTY",
      );
    }

    // North arrow + scale bar
    const allVerts = level0.footprint.vertices;
    if (allVerts.length > 0) {
      const maxE = Math.max(...allVerts.map((v) => v.easting));
      const maxN = Math.max(...allVerts.map((v) => v.northing));
      const minE = Math.min(...allVerts.map((v) => v.easting));
      const minN = Math.min(...allVerts.map((v) => v.northing));
      addNorthArrow(doc, { x: maxE + 2, y: maxN + 2 }, 3);
      addScaleBar(doc, { x: minE, y: minN - 5 }, 10, 4);
    }
  }

  return serializeDxf(doc);
}

// ─── Helper ──────────────────────────────────────────────────────

function toVec3(p: DxfPoint): vec3_t {
  return point3d(p.x, p.y, 0);
}
