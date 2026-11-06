import { describe, expect, it } from "vitest";
import { getWgs84UtmProjectionZone, listWgs84UtmProjectionZones } from "../index.js";

describe("global WGS 84 UTM CRS definitions", () => {
  it("resolves EPSG northern and southern UTM codes to exact projection parameters", () => {
    expect(getWgs84UtmProjectionZone(32633)).toEqual({
      srid: 32633,
      name: "WGS 84 / UTM zone 33N",
      method: "Transverse Mercator",
      central_meridian_deg: 15,
      latitude_of_origin_deg: 0,
      false_easting_m: 500_000,
      false_northing_m: 0,
      scale_factor: 0.9996,
      ellipsoid: "WGS84",
    });
    expect(getWgs84UtmProjectionZone(32756)).toMatchObject({
      srid: 32756,
      name: "WGS 84 / UTM zone 56S",
      central_meridian_deg: 153,
      false_northing_m: 10_000_000,
    });
  });

  it("lists every authority code in the two 60-zone EPSG series", () => {
    const zones = listWgs84UtmProjectionZones();
    expect(zones).toHaveLength(120);
    expect(zones.map((zone) => zone.srid)).toEqual([
      ...Array.from({ length: 60 }, (_, index) => 32_601 + index),
      ...Array.from({ length: 60 }, (_, index) => 32_701 + index),
    ]);
  });

  it.each([0, 32600, 32661, 32700, 32761, 4326, 32601.5, Number.NaN])(
    "rejects unsupported CRS code %s",
    (srid) => {
      expect(getWgs84UtmProjectionZone(srid)).toBeNull();
    },
  );
});
