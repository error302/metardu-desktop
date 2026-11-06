import { createHash, randomUUID } from "node:crypto";
import { COMMUNITY_EXTENSION_PACKAGE_RUN_INPUT_SCHEMA } from "@metardu/ipc-schemas";
import {
  COMMUNITY_EXTENSION_PROJECT_ARTIFACT_LIST_INPUT_SCHEMA,
  COMMUNITY_EXTENSION_PROJECT_RUN_INPUT_SCHEMA,
  COMMUNITY_PLUGIN_JSON_VALUE_SCHEMA,
} from "@metardu/ipc-schemas";
import {
  getDatabase,
  getProject,
  listCommunityExtensionProjectArtifacts,
  saveCommunityExtensionProjectArtifact,
} from "./database.js";
import type { CommunityExtensionPackageFiles, CommunityExtensionPackageStore } from "./community-extension-packages.js";

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

async function runInstalledPackage(
  dependencies: CommunityExtensionRouteDependencies,
  pkg: CommunityExtensionPackageFiles,
  input: unknown,
): Promise<Record<string, unknown>> {
  const sidecar = dependencies.getSidecar();
  if (!sidecar || !sidecar.isRunning()) throw new Error("Rust sidecar is not running; plugin execution is unavailable.");

  const untrustedResult: unknown = await sidecar.call("plugin.run", {
    plugin_id: pkg.manifest.id,
    plugin_version: pkg.manifest.version,
    module_base64: pkg.moduleBytes.toString("base64"),
    input,
  });
  if (!untrustedResult || typeof untrustedResult !== "object" || Array.isArray(untrustedResult)) {
    throw new Error("Rust sidecar returned an invalid extension result envelope.");
  }
  const result = untrustedResult as Record<string, unknown>;
  if (result.module_sha256 !== pkg.manifest.moduleSha256 || result.trust_state !== "community-draft") {
    throw new Error("Rust sidecar returned module identity or trust metadata that does not match the installed package.");
  }
  return {
    ...result,
    package_sha256: pkg.packageSha256,
    license_id: pkg.manifest.licenseId,
  };
}

function stringifyBoundedJson(value: unknown, label: string): string {
  const validation = COMMUNITY_PLUGIN_JSON_VALUE_SCHEMA.safeParse(value);
  if (!validation.success) throw new Error(`${label} is not bounded JSON within the extension ABI limits.`);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error(`${label} could not be serialized as JSON.`);
  return serialized;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
    return runInstalledPackage(dependencies, pkg, parsed.data.input);
  });

  dependencies.register("metardu:plugins:runInstalledAndSave", async (_event, input) => {
    const parsed = COMMUNITY_EXTENSION_PROJECT_RUN_INPUT_SCHEMA.safeParse(input);
    if (!parsed.success) {
      throw new Error(`Invalid project extension request: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    }

    const database = getDatabase();
    const project = getProject(database, parsed.data.projectId);
    if (!project) throw new Error("The target project no longer exists.");
    if (project.version !== parsed.data.expectedProjectVersion) {
      throw new Error("The project changed after this extension input was prepared. Refresh the project and try again.");
    }

    const pkg = await dependencies.store.loadForRun(parsed.data.packageSha256);
    const result = await runInstalledPackage(dependencies, pkg, parsed.data.input);
    if (!("output" in result)) throw new Error("Extension did not return an output value to save.");

    const inputJson = stringifyBoundedJson(parsed.data.input, "Extension input");
    const outputJson = stringifyBoundedJson(result.output, "Extension output");
    const artifact = saveCommunityExtensionProjectArtifact(database, {
      id: randomUUID(),
      projectId: project.id,
      projectVersion: parsed.data.expectedProjectVersion,
      pluginId: pkg.manifest.id,
      pluginVersion: pkg.manifest.version,
      pluginName: pkg.manifest.name,
      publisherName: pkg.manifest.publisherName,
      licenseId: pkg.manifest.licenseId,
      packageSha256: pkg.packageSha256,
      moduleSha256: pkg.manifest.moduleSha256,
      inputJson,
      inputSha256: sha256(inputJson),
      outputJson,
      outputSha256: sha256(outputJson),
      trustState: "community-draft",
      createdAt: new Date().toISOString(),
    });
    return { result, artifact };
  });

  dependencies.register("metardu:plugins:listProjectArtifacts", async (_event, input) => {
    const parsed = COMMUNITY_EXTENSION_PROJECT_ARTIFACT_LIST_INPUT_SCHEMA.safeParse(input);
    if (!parsed.success) {
      throw new Error(`Invalid project artifact request: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    }
    return { artifacts: listCommunityExtensionProjectArtifacts(getDatabase(), parsed.data.projectId) };
  });
}
