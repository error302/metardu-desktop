import { describe, expect, it } from "vitest";
import { parseCsvParcels, parseGeoJsonPolygons } from "../renderer/views/LULCView.js";
import { readFileSync } from "node:fs";

const lulcViewSource = readFileSync(new URL("../renderer/views/LULCView.tsx", import.meta.url), "utf8");

describe("LULC raw geometry import", () => {
  it("does not ship a Kenya sample, guessed CRS, raster metadata, or renderer area calculation", () => {
    expect(lulcViewSource).toContain("useState<LulcZone[]>([])");
    expect(lulcViewSource).toContain("Imagery analysis unavailable");
    expect(lulcViewSource).not.toMatch(/SAMPLE_ZONES|UTM 37S|autoClassify|shoelaceArea|4096/);
  });

  it("preserves simple GeoJSON coordinates without assigning a CRS or area", () => {
    const polygons = parseGeoJsonPolygons(JSON.stringify({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { id: "lot-7", name: "North Lot", category: "forest" },
        geometry: { type: "Polygon", coordinates: [[[36.8, -1.2], [36.9, -1.2], [36.9, -1.1], [36.8, -1.2]]] },
      }],
    }));

    expect(polygons).toEqual([{
      id: "lot-7",
      name: "North Lot",
      category: "forest",
      attributes: { id: "lot-7", name: "North Lot", category: "forest" },
      points: [
        { easting: 36.8, northing: -1.2 },
        { easting: 36.9, northing: -1.2 },
        { easting: 36.9, northing: -1.1 },
        { easting: 36.8, northing: -1.2 },
      ],
    }]);
  });

  it("rejects a collection containing unsupported rings rather than importing partial geometry", () => {
    const polygons = parseGeoJsonPolygons(JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { id: "valid" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1]]] } },
        { type: "Feature", properties: { id: "has-hole" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2]], [[0.5, 0.5], [1, 0.5], [1, 1]]] } },
      ],
    }));

    expect(polygons).toEqual([]);
  });

  it("round-trips draft CSV labels, classes, identifiers, and raw coordinate values", () => {
    const polygons = parseCsvParcels([
      "# METARDU LULC geometry export — DRAFT / UNVERIFIED",
      "Zone_ID,Name,Vertex,X_raw,Y_raw,Class,Source,Original_ID,Source_Attributes_JSON",
      'Z1,"Forest, reserve",1,100.25,200.5,forest,imported,P1,"{""parcel_ref"":""A,1"",""source"":""crew""}"',
      'Z1,"Forest, reserve",2,101.25,200.5,forest,imported,P1,"{""parcel_ref"":""A,1"",""source"":""crew""}"',
      'Z1,"Forest, reserve",3,101.25,201.5,forest,imported,P1,"{""parcel_ref"":""A,1"",""source"":""crew""}"',
    ].join("\n"));

    expect(polygons).toEqual([{
      id: "P1",
      name: "Forest, reserve",
      category: "forest",
      attributes: { parcel_ref: "A,1", source: "crew" },
      points: [
        { easting: 100.25, northing: 200.5 },
        { easting: 101.25, northing: 200.5 },
        { easting: 101.25, northing: 201.5 },
      ],
    }]);
  });
});
