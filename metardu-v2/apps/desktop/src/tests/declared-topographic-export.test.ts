import { describe, it, expect } from "vitest";
import { getCountryConfig } from "@metardu/country-config";
import { canExportDeclaredTopographicDxf } from "../renderer/declared-topographic-export.js";

const srid = getCountryConfig("GB").geodeticFramework.primarySRID;
const context = { horizontalCrsEpsg: srid, horizontalCrsLabel: "Declared source", horizontalUnits: "m", verticalReference: "Local benchmark, unverified", referenceStatus: "user-declared-unverified" };
const output = { evidenceStatus: "computed-draft-unadjusted", coordinateContext: context, tin: { vertices: [{ easting: 1, northing: 2, elevation: 3 }], triangles: [] }, contours: [] };
describe("declared topographic DXF exception", () => {
  it("permits a native computed draft with exactly matching retained reference", () => {
    expect(canExportDeclaredTopographicDxf("dxf", output, srid, false)).toBe(true);
  });
  it("preserves refusal for other formats, WGS84 conversion, or another project reference", () => {
    expect(canExportDeclaredTopographicDxf("geojson", output, srid, false)).toBe(false);
    expect(canExportDeclaredTopographicDxf("dxf", output, srid, true)).toBe(false);
    expect(canExportDeclaredTopographicDxf("dxf", output, getCountryConfig("KE").geodeticFramework.primarySRID, false)).toBe(false);
  });
  it.each([undefined, null, {}, { ...output, evidenceStatus: "approved" }, { ...output, coordinateContext: { ...context, horizontalUnits: "ft" } }, { ...output, coordinateContext: { ...context, verticalReference: " " } }, { ...output, coordinateContext: { ...context, referenceStatus: "verified" } }])("refuses missing or contradictory context", (candidate) => {
    expect(canExportDeclaredTopographicDxf("dxf", candidate, srid, false)).toBe(false);
  });
});
