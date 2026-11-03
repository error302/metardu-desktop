import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CommunityExtensionPackageFiles } from "../main/community-extension-packages.js";
import { registerCommunityExtensionPackageRoutes } from "../main/community-extension-routes.js";

const moduleBytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const moduleSha256 = createHash("sha256").update(moduleBytes).digest("hex");
const packageSha256 = "b".repeat(64);
const installedPackage: CommunityExtensionPackageFiles = {
  manifest: {
    format: "metardu-extension",
    formatVersion: 1,
    abiVersion: 1,
    id: "community.example.point-summary",
    version: "0.1.0",
    name: "Point summary",
    description: "Summarizes explicitly supplied survey points.",
    publisherName: "Example Community",
    licenseId: "MIT",
    moduleSha256,
  },
  moduleBytes,
  licenseText: "MIT License\n",
  packageSha256,
};

function routeFixture() {
  const routes = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const installSelectedPackage = vi.fn(async () => ({ canceled: true }));
  const loadForRun = vi.fn(async () => installedPackage);
  const sidecarCall = vi.fn(async <T = unknown>() => ({
    module_sha256: moduleSha256,
    trust_state: "community-draft",
    output: { accepted: true },
  }) as T);

  registerCommunityExtensionPackageRoutes({
    register: (channel, handler) => routes.set(channel, handler),
    installSelectedPackage,
    store: {
      list: async () => ({ packages: [], issues: [] }),
      loadForRun,
    },
    getSidecar: () => ({ isRunning: () => true, call: sidecarCall }),
  });

  return { routes, installSelectedPackage, loadForRun, sidecarCall };
}

describe("community extension package IPC routes", () => {
  it("imports through the file-selection service without invoking the module runner", async () => {
    const fixture = routeFixture();
    const installResult = await fixture.routes.get("metardu:plugins:installPackage")!({}, undefined);

    expect(installResult).toEqual({ canceled: true });
    expect(fixture.installSelectedPackage).toHaveBeenCalledOnce();
    expect(fixture.sidecarCall).not.toHaveBeenCalled();
  });

  it("loads a digest-verified installed package and runs only its declared module identity", async () => {
    const fixture = routeFixture();
    const result = await fixture.routes.get("metardu:plugins:runInstalled")!({}, {
      packageSha256,
      input: { points: [{ x: 1, y: 2, z: 3 }] },
    });

    expect(fixture.loadForRun).toHaveBeenCalledWith(packageSha256);
    expect(fixture.sidecarCall).toHaveBeenCalledWith("plugin.run", {
      plugin_id: installedPackage.manifest.id,
      plugin_version: installedPackage.manifest.version,
      module_base64: moduleBytes.toString("base64"),
      input: { points: [{ x: 1, y: 2, z: 3 }] },
    });
    expect(result).toMatchObject({
      module_sha256: moduleSha256,
      package_sha256: packageSha256,
      license_id: "MIT",
      trust_state: "community-draft",
      output: { accepted: true },
    });
  });

  it("rejects invalid package digests and storage failures before invoking the runner", async () => {
    const invalid = routeFixture();
    await expect(invalid.routes.get("metardu:plugins:runInstalled")!({}, {
      packageSha256: "../outside",
      input: {},
    })).rejects.toThrow(/Invalid installed extension request/);
    expect(invalid.loadForRun).not.toHaveBeenCalled();
    expect(invalid.sidecarCall).not.toHaveBeenCalled();

    const tampered = routeFixture();
    tampered.loadForRun.mockRejectedValue(new Error("Installed package integrity check failed."));
    await expect(tampered.routes.get("metardu:plugins:runInstalled")!({}, {
      packageSha256,
      input: {},
    })).rejects.toThrow(/integrity check failed/);
    expect(tampered.sidecarCall).not.toHaveBeenCalled();
  });
});
