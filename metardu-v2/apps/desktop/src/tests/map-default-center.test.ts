import { describe, expect, it } from "vitest";
import { COUNTRY_CENTERS, getDefaultCenter } from "../renderer/views/MapView.js";

describe("map default center", () => {
  it("starts at a neutral global view when no jurisdiction is selected", () => {
    expect(getDefaultCenter()).toEqual([0, 0]);
  });

  it("does not substitute Kenya for an unsupported jurisdiction", () => {
    expect(getDefaultCenter("ZZ")).toEqual([0, 0]);
  });

  it("uses the configured center for a known jurisdiction", () => {
    expect(getDefaultCenter("KE")).toEqual(COUNTRY_CENTERS.KE);
  });
});
