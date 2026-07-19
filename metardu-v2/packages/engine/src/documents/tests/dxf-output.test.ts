/**
 * Tests for the DXF output module.
 *
 * Verifies that the DXF output is valid, contains the expected
 * entities + layers, and can be serialized without errors.
 */

import { describe, it, expect } from "vitest";
import {
  createSurveyDxf,
  addPolygon,
  addBeacon,
  addText,
  addNorthArrow,
  addScaleBar,
  addTIN,
  addContours,
  addSpotHeights,
  generateForm3Dxf,
  serializeDxf,
  SURVEY_LAYERS,
} from "../dxf-output.js";

describe("DXF output module", () => {
  it("createSurveyDxf creates a document with all standard layers", () => {
    const doc = createSurveyDxf();
    const dxf = serializeDxf(doc);
    // Every layer name should appear in the DXF output.
    for (const layer of SURVEY_LAYERS) {
      expect(dxf).toContain(layer.name);
    }
  });

  it("DXF starts with standard DXF header", () => {
    const doc = createSurveyDxf();
    const dxf = serializeDxf(doc);
    expect(dxf).toContain("SECTION");
    expect(dxf).toContain("HEADER");
    expect(dxf).toContain("ENTITIES");
    expect(dxf).toContain("ENDSEC");
    expect(dxf).toContain("EOF");
  });

  it("addPolygon draws N line entities for an N-vertex polygon", () => {
    const doc = createSurveyDxf();
    addPolygon(doc, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const dxf = serializeDxf(doc);
    // 4 edges → 4 LINE entities. Each LINE entity has AcDbLine subclass
    // marker appearing once, so the count should match.
    const lineCount = (dxf.match(/^AcDbLine$/gm) || []).length;
    expect(lineCount).toBe(4);
  });

  it("addBeacon draws a circle + optional label text", () => {
    const doc = createSurveyDxf();
    addBeacon(doc, { x: 50, y: 50 }, 0.5, "B1");
    const dxf = serializeDxf(doc);
    expect(dxf).toContain("AcDbCircle");
    expect(dxf).toContain("B1");
    expect(dxf).toContain("BEACON");
  });

  it("addText adds text on the specified layer", () => {
    const doc = createSurveyDxf();
    addText(doc, "Hello World", { x: 10, y: 20 }, "TEXT-COORDS", 2.5);
    const dxf = serializeDxf(doc);
    expect(dxf).toContain("Hello World");
    expect(dxf).toContain("TEXT-COORDS");
  });

  it("addNorthArrow draws the arrow + N label", () => {
    const doc = createSurveyDxf();
    addNorthArrow(doc, { x: 100, y: 100 });
    const dxf = serializeDxf(doc);
    expect(dxf).toContain("NORTH-ARROW");
    expect(dxf).toContain("N\n");
  });

  it("addScaleBar draws the bar + labels", () => {
    const doc = createSurveyDxf();
    addScaleBar(doc, { x: 0, y: 0 }, 100, 4);
    const dxf = serializeDxf(doc);
    expect(dxf).toContain("SCALE-BAR");
    expect(dxf).toContain("100m");
  });

  it("addTIN draws 3 lines per triangle", () => {
    const doc = createSurveyDxf();
    addTIN(
      doc,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ],
      [[0, 1, 2]],
    );
    const dxf = serializeDxf(doc);
    // 1 triangle → 3 edges → 3 LINE entities
    const lineCount = (dxf.match(/^AcDbLine$/gm) || []).length;
    expect(lineCount).toBe(3);
  });

  it("addContours draws line segments on the CONTOURS layer", () => {
    const doc = createSurveyDxf();
    addContours(doc, [
      {
        elevation: 100,
        coordinates: [[0, 0], [10, 0], [20, 0], [30, 0]],
      },
    ]);
    const dxf = serializeDxf(doc);
    expect(dxf).toContain("CONTOURS");
    // 4 coords → 2 segments (pairs)
    const lineCount = (dxf.match(/^AcDbLine$/gm) || []).length;
    expect(lineCount).toBeGreaterThanOrEqual(2);
  });

  it("addSpotHeights draws cross markers + elevation text", () => {
    const doc = createSurveyDxf();
    addSpotHeights(doc, [
      { x: 10, y: 10, elevation: 102.5 },
    ]);
    const dxf = serializeDxf(doc);
    expect(dxf).toContain("SPOT-HEIGHTS");
    expect(dxf).toContain("102.50");
  });

  it("generateForm3Dxf produces a complete Form 3 DXF", () => {
    const dxf = generateForm3Dxf(
      [
        { label: "B1", position: { easting: 257100, northing: 9857700 }, description: "Concrete pillar" },
        { label: "B2", position: { easting: 257150, northing: 9857700 }, description: "Concrete pillar" },
        { label: "B3", position: { easting: 257150, northing: 9857750 }, description: "Concrete pillar" },
        { label: "B4", position: { easting: 257100, northing: 9857750 }, description: "Concrete pillar" },
      ],
      21037,
    );
    // DXF header
    expect(dxf).toContain("SECTION");
    expect(dxf).toContain("EOF");
    // Layers
    expect(dxf).toContain("BOUNDARY");
    expect(dxf).toContain("BEACON");
    expect(dxf).toContain("TEXT-COORDS");
    expect(dxf).toContain("NORTH-ARROW");
    expect(dxf).toContain("SCALE-BAR");
    // Beacon labels
    expect(dxf).toContain("B1");
    expect(dxf).toContain("B2");
    expect(dxf).toContain("B3");
    expect(dxf).toContain("B4");
    // Coordinate schedule
    expect(dxf).toContain("257100");
    expect(dxf).toContain("9857700");
    expect(dxf).toContain("SRID 21037");
    // Concrete pillar descriptions
    expect(dxf).toContain("Concrete pillar");
    // DXF should be > 5KB for a 4-beacon parcel
    expect(dxf.length).toBeGreaterThan(5000);
  });

  it("DXF output is parseable (no invalid characters)", () => {
    const dxf = generateForm3Dxf(
      [
        { label: "B1", position: { easting: 0, northing: 0 }, description: "Test" },
        { label: "B2", position: { easting: 10, northing: 0 }, description: "Test" },
        { label: "B3", position: { easting: 10, northing: 10 }, description: "Test" },
      ],
      21037,
    );
    // No null bytes, no non-ASCII (DXF is ASCII)
    for (let i = 0; i < dxf.length; i++) {
      const code = dxf.charCodeAt(i);
      expect(code).toBeLessThan(128);
    }
  });

  it("handles empty beacons array gracefully (no crash)", () => {
    expect(() => generateForm3Dxf([], 21037)).not.toThrow();
  });

  it("handles single beacon (degenerate polygon)", () => {
    expect(() => generateForm3Dxf(
      [{ label: "B1", position: { easting: 0, northing: 0 }, description: "Test" }],
      21037,
    )).not.toThrow();
  });
});
