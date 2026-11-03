import { COMMUNITY_EXTENSION_PACKAGE_RUN_INPUT_SCHEMA } from "@metardu/ipc-schemas";
import type { CommunityExtensionPackageStore } from "./community-extension-packages.js";

type RouteHandler = (...args: unknown[]) => Promise<unknown>;

export interface CommunityExtensionSidecar {
  isRunning(): boolean;
  call<T = unknown>(method: string, params: unknown): Promise<T>;
}

export interface CommunityExtensionRouteDependencies {
  register(channel: string, handler: RouteHandler): void;
  installSelectedPackage(): Promise<unknown>;
  store: Pick<CommunityExtensionPackageStore, "list" | "loadForRun">;
  getSidecar(): CommunityExtensionSidecar | null;
}

/** Register the narrow local package routes separately from Electron startup for direct contract tests. */
export function registerCommunityExtensionPackageRoutes(dependencies: CommunityExtensionRouteDependencies): void {
  dependencies.register("metardu:plugins:installPackage", async () => dependencies.installSelectedPackage());
  dependencies.register("metardu:plugins:listInstalled", async () => dependencies.store.list());
  dependencies.register("metardu:plugins:runInstalled", async (_event, input) => {
    const parsed = COMMUNITY_EXTENSION_PACKAGE_RUN_INPUT_SCHEMA.safeParse(input);
    if (!parsed.success) {
      throw new Error(`Invalid installed extension request: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    }

    const pkg = await dependencies.store.loadForRun(parsed.data.packageSha256);
    const sidecar = dependencies.getSidecar();
    if (!sidecar || !sidecar.isRunning()) throw new Error("Rust sidecar is not running; plugin execution is unavailable.");

    const result = await sidecar.call<Record<string, unknown>>("plugin.run", {
      plugin_id: pkg.manifest.id,
      plugin_version: pkg.manifest.version,
      module_base64: pkg.moduleBytes.toString("base64"),
      input: parsed.data.input,
    });
    if (result.module_sha256 !== pkg.manifest.moduleSha256 || result.trust_state !== "community-draft") {
      throw new Error("Rust sidecar returned module identity or trust metadata that does not match the installed package.");
    }
    return {
      ...result,
      package_sha256: pkg.packageSha256,
      license_id: pkg.manifest.licenseId,
    };
  });
}
