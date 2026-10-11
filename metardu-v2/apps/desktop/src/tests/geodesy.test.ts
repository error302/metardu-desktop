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

  it("rejects an SRID that is not part of the selected country's config", async () => {
    const { sidecar, call } = makeSidecar();
    const project = makeProjectToWgs84("AE", sidecar)!;

    await expect(project(500_000, 2_700_000, 9999)).rejects.toThrow(/not configured for country 'AE'/);
    expect(call).not.toHaveBeenCalled();
  });

  it("rejects invalid geographic coordinates from the sidecar", async () => {
    const { sidecar } = makeSidecar({ lat: 95, lon: 55.3 });
    const project = makeProjectToWgs84("AE", sidecar)!;

    await expect(project(500_000, 2_700_000, 32640)).rejects.toThrow(/invalid geographic coordinates/);
  });
});
