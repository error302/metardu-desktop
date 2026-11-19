import { describe, expect, it, vi } from "vitest";
import { makeProjectToWgs84, type GeodesySidecar } from "../main/geodesy.js";

function makeSidecar(result = { lat: 25.2, lon: 55.3 }) {
  const call = vi.fn(async (_method: string, _params: unknown) => result);
  const sidecar: GeodesySidecar = {
    isRunning: () => true,
    call: <T = unknown>(method: string, params: unknown) => call(method, params) as Promise<T>,
  };
  return { sidecar, call };
}

describe("makeProjectToWgs84", () => {
  it("requires a running Rust sidecar", () => {
    expect(makeProjectToWgs84("AE", null)).toBeNull();
    expect(makeProjectToWgs84("AE", { isRunning: () => false, call: async () => ({}) })).toBeNull();
  });

  it("refuses legacy and regional source datums when no datum operation is configured", () => {
    const { sidecar } = makeSidecar();
    expect(makeProjectToWgs84("KE", sidecar)).toBeNull();
    expect(makeProjectToWgs84("GB", sidecar)).toBeNull();
    expect(makeProjectToWgs84("DE", sidecar)).toBeNull();
  });

  it("dispatches the configured source SRID through the Rust inverse projection", async () => {
    const { sidecar, call } = makeSidecar();
    const project = makeProjectToWgs84("AE", sidecar);
    expect(project).not.toBeNull();

    await expect(project!(500_000, 2_700_000, 32640)).resolves.toEqual({ lat: 25.2, lon: 55.3 });
    expect(call).toHaveBeenCalledWith("geodesy.utm_inverse", {
      easting: 500_000,
      northing: 2_700_000,
      zone: 40,
      is_southern: false,
      ellipsoid: "WGS84",
    });
  });

  it("resolves an explicit global WGS84 UTM CRS without a country pack", async () => {
    const { sidecar, call } = makeSidecar();
    const project = makeProjectToWgs84(undefined, sidecar, 32633);
    expect(project).not.toBeNull();

    await expect(project!(391_779.2593, 5_820_072.1592, 32633)).resolves.toEqual({ lat: 25.2, lon: 55.3 });
    expect(call).toHaveBeenCalledWith("geodesy.utm_inverse", {
      easting: 391_779.2593,
      northing: 5_820_072.1592,
      zone: 33,
      is_southern: false,
      ellipsoid: "WGS84",
    });
  });

  it("allows a global WGS84 CRS with an unconfigured legal jurisdiction", async () => {
    const { sidecar, call } = makeSidecar();
    const project = makeProjectToWgs84("ZZ", sidecar, 32756);
    expect(project).not.toBeNull();

    await project!(334_368.6336, 6_250_948.3454, 32756);
    expect(call).toHaveBeenCalledWith("geodesy.utm_inverse", expect.objectContaining({
      zone: 56,
      is_southern: true,
      ellipsoid: "WGS84",
    }));
  });

  it("rejects coordinates labeled with a CRS other than the bound project CRS", async () => {
    const { sidecar, call } = makeSidecar();
    const project = makeProjectToWgs84("AE", sidecar)!;

    await expect(project(500_000, 2_700_000, 9999)).rejects.toThrow(/does not match project CRS EPSG:32640/);
    expect(call).not.toHaveBeenCalled();
  });

  it("does not create a transformation for an unknown CRS or a neutral project without a CRS", () => {
    const { sidecar } = makeSidecar();
    expect(makeProjectToWgs84(undefined, sidecar)).toBeNull();
    expect(makeProjectToWgs84("ZZ", sidecar, 9999)).toBeNull();
  });

  it("rejects invalid geographic coordinates from the sidecar", async () => {
    const { sidecar } = makeSidecar({ lat: 95, lon: 55.3 });
    const project = makeProjectToWgs84("AE", sidecar)!;

    await expect(project(500_000, 2_700_000, 32640)).rejects.toThrow(/invalid geographic coordinates/);
  });
});
