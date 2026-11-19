import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectBundleSnapshot } from "@metardu/ipc-schemas";
import {
  exportProjectBundleDirectory,
  stageProjectBundleDirectory,
} from "../main/project-bundle.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "metardu-project-bundle-test-"));
  temporaryRoots.push(root);
  return root;
}

function makeHeader() {
  return {
    format: "LAZ" as const,
    version: "1.4",
    headerDeclaredPointCount: "0",
    pointFormatId: 6,
    pointRecordAttributes: { gpsTime: true, rgb: false, nearInfrared: false, waveform: false, extraBytes: 0 },
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
    coordinateScale: { x: 0.001, y: 0.001, z: 0.001 },
    coordinateOffset: { x: 0, y: 0, z: 0 },
    crsEvidence: { hasAnyCrsRecord: false, hasWktCrs: false, wktCrs: null, geoTiffCrsDecoded: false },
    headerDeclaredPointsByReturn: [],
    copcInfoRecordPresent: false,
    warnings: [],
  };
}

function makeSnapshot(sourceBytes: Buffer): ProjectBundleSnapshot {
  const projectId = randomUUID();
  const sourceId = randomUUID();
  const digest = createHash("sha256").update(sourceBytes).digest("hex");
  const readerVersion = "test-reader 1.0";
  return {
    format: "metardu-project-bundle",
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      id: projectId,
      name: "Global topo project",
      description: "A persisted desktop project",
      countryCode: "",
      crsSrid: null,
      coordinateContextJson: "legacy raw coordinate context",
      surveyType: "topographic",
      sourceView: "PointCloudView",
      outputJson: JSON.stringify({ boundaries: [] }),
      planSheetJson: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z",
      version: 3,
    },
    pointCloudSources: [{
      id: sourceId,
      projectId,
      fileName: "terrain.laz",
      storageKey: `${digest}.laz`,
      contentSha256: digest,
      fileSizeBytes: sourceBytes.byteLength.toString(),
      sourceExtension: "laz",
      format: "LAZ",
      headerJson: JSON.stringify(makeHeader()),
      coordinateContextJson: "legacy raw source declaration",
      importedAt: "2026-10-01T01:00:00.000Z",
      inspections: [{
        id: randomUUID(),
        sourceId,
        sourceSha256: digest,
        readerVersion,
        inspectionJson: JSON.stringify({ readerVersion, decodedPointCount: "0" }),
        inspectedAt: "2026-10-01T02:00:00.000Z",
      }],
    }],
  };
}

async function exportFixture(root: string, sourceBytes: Buffer) {
  const parent = path.join(root, "backups");
  const objects = path.join(root, "objects");
  await fs.mkdir(parent);
  await fs.mkdir(objects);
  const source = path.join(objects, "managed-source.laz");
  await fs.writeFile(source, sourceBytes);
  const snapshot = makeSnapshot(sourceBytes);
  const controller = new AbortController();
  const result = await exportProjectBundleDirectory({
    operationId: randomUUID(),
    signal: controller.signal,
    onProgress: () => undefined,
    destinationParent: parent,
    snapshot,
    getCurrentSnapshot: () => ({ ...snapshot, exportedAt: new Date().toISOString() }),
    resolveSourcePath: () => source,
    inspectHeader: async () => makeHeader(),
  });
  return { parent, source, snapshot, bundlePath: result.bundlePath };
}

describe("portable project bundle directory", () => {
  it("streams source bytes, then stages a verified round-trip without changing declarations", async () => {
    const root = await temporaryDirectory();
    const sourceBytes = Buffer.from("synthetic test bytes; the injected inspector stands in for the LAS sidecar");
    const { bundlePath, snapshot, source } = await exportFixture(root, sourceBytes);
    const progress: string[] = [];
    const staged = await stageProjectBundleDirectory({
      operationId: randomUUID(),
      signal: new AbortController().signal,
      onProgress: (item) => progress.push(item.phase),
      bundlePath,
      userDataPath: path.join(root, "restored-app-data"),
      inspectHeader: async () => makeHeader(),
    });
    temporaryRoots.push(staged.stagingDirectory);

    expect(await fs.readFile(staged.stagedSources[0]!.stagingPath)).toEqual(sourceBytes);
    expect(await fs.readFile(source)).toEqual(sourceBytes);
    expect(staged.snapshot.project.name).toBe(snapshot.project.name);
    expect(staged.snapshot.project.coordinateContextJson).toBe("legacy raw coordinate context");
    expect(staged.snapshot.pointCloudSources[0]?.coordinateContextJson).toBe("legacy raw source declaration");
    expect(staged.snapshot.pointCloudSources[0]?.inspections).toEqual(snapshot.pointCloudSources[0]?.inspections);
    expect(JSON.parse(staged.snapshot.pointCloudSources[0]!.headerJson)).toEqual(makeHeader());
    expect(progress).toContain("copying");
    expect(progress).toContain("verifying");
  });

  it("rejects a changed source before import staging completes", async () => {
    const root = await temporaryDirectory();
    const { bundlePath } = await exportFixture(root, Buffer.from("verified source bytes"));
    const bundledSource = path.join(bundlePath, "sources", (await fs.readdir(path.join(bundlePath, "sources")))[0]!);
    await fs.writeFile(bundledSource, Buffer.from("modified source bytes"));

    await expect(stageProjectBundleDirectory({
      operationId: randomUUID(),
      signal: new AbortController().signal,
      onProgress: () => undefined,
      bundlePath,
      userDataPath: path.join(root, "restored-app-data"),
      inspectHeader: async () => makeHeader(),
    })).rejects.toThrow(/SHA-256 or size verification/);
  });

  it("rejects unexpected members and a manifest digest mismatch", async () => {
    const root = await temporaryDirectory();
    const { bundlePath } = await exportFixture(root, Buffer.from("source bytes"));
    await fs.writeFile(path.join(bundlePath, "extra.txt"), "not part of v1");
    const options = {
      operationId: randomUUID(),
      signal: new AbortController().signal,
      onProgress: () => undefined,
      bundlePath,
      userDataPath: path.join(root, "restored-app-data"),
      inspectHeader: async () => makeHeader(),
    };
    await expect(stageProjectBundleDirectory(options)).rejects.toThrow(/more entries|unexpected top-level entries/);
    await fs.rm(path.join(bundlePath, "extra.txt"));
    await fs.rename(path.join(bundlePath, "manifest.json"), path.join(root, "missing-manifest.json"));
    await expect(stageProjectBundleDirectory(options)).rejects.toThrow(/unexpected top-level entries/);
    await fs.rename(path.join(root, "missing-manifest.json"), path.join(bundlePath, "manifest.json"));
    await fs.writeFile(path.join(bundlePath, "manifest.sha256"), `${"0".repeat(64)}\n`);
    await expect(stageProjectBundleDirectory(options)).rejects.toThrow(/manifest failed SHA-256 verification/);
  });

  it("rejects a stable-snapshot mismatch without publishing a final bundle", async () => {
    const root = await temporaryDirectory();
    const parent = path.join(root, "backups");
    const source = path.join(root, "source.laz");
    await fs.mkdir(parent);
    const sourceBytes = Buffer.from("source bytes");
    await fs.writeFile(source, sourceBytes);
    const snapshot = makeSnapshot(sourceBytes);
    await expect(exportProjectBundleDirectory({
      operationId: randomUUID(),
      signal: new AbortController().signal,
      onProgress: () => undefined,
      destinationParent: parent,
      snapshot,
      getCurrentSnapshot: () => ({ ...snapshot, project: { ...snapshot.project, name: "changed while exporting" } }),
      resolveSourcePath: () => source,
      inspectHeader: async () => makeHeader(),
    })).rejects.toThrow(/changed during bundle export/);
    expect(await fs.readdir(parent)).toEqual([]);
  });

  it("rejects a shortened source by its recorded size", async () => {
    const root = await temporaryDirectory();
    const { bundlePath } = await exportFixture(root, Buffer.from("source with an exact recorded length"));
    const bundledSource = path.join(bundlePath, "sources", (await fs.readdir(path.join(bundlePath, "sources")))[0]!);
    await fs.writeFile(bundledSource, Buffer.from("short"));
    await expect(stageProjectBundleDirectory({
      operationId: randomUUID(),
      signal: new AbortController().signal,
      onProgress: () => undefined,
      bundlePath,
      userDataPath: path.join(root, "restored-app-data"),
      inspectHeader: async () => makeHeader(),
    })).rejects.toThrow(/size differs from its saved project record/);
  });

  it("rejects path traversal embedded in a recomputed manifest", async () => {
    const root = await temporaryDirectory();
    const { bundlePath } = await exportFixture(root, Buffer.from("source bytes"));
    const manifestPath = path.join(bundlePath, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ProjectBundleSnapshot;
    manifest.pointCloudSources[0]!.fileName = "../../outside.laz";
    const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
    await fs.writeFile(manifestPath, manifestBytes);
    await fs.writeFile(path.join(bundlePath, "manifest.sha256"), `${createHash("sha256").update(manifestBytes).digest("hex")}\n`);

    await expect(stageProjectBundleDirectory({
      operationId: randomUUID(),
      signal: new AbortController().signal,
      onProgress: () => undefined,
      bundlePath,
      userDataPath: path.join(root, "restored-app-data"),
      inspectHeader: async () => makeHeader(),
    })).rejects.toThrow(/path separators/);
  });

  it("rejects symbolic-link manifest members where the host permits creating links", async () => {
    const root = await temporaryDirectory();
    const { bundlePath } = await exportFixture(root, Buffer.from("source bytes"));
    const originalManifest = path.join(bundlePath, "manifest.json");
    const savedManifest = path.join(root, "saved-manifest.json");
    await fs.rename(originalManifest, savedManifest);
    try {
      await fs.symlink(savedManifest, originalManifest, "file");
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "EPERM" || code === "EACCES" || code === "UNKNOWN") return;
      throw error;
    }

    await expect(stageProjectBundleDirectory({
      operationId: randomUUID(),
      signal: new AbortController().signal,
      onProgress: () => undefined,
      bundlePath,
      userDataPath: path.join(root, "restored-app-data"),
      inspectHeader: async () => makeHeader(),
    })).rejects.toThrow(/symbolic link/);
  });

  it("cancels a streamed export and removes its incomplete directory", async () => {
    const root = await temporaryDirectory();
    const parent = path.join(root, "backups");
    const source = path.join(root, "source.laz");
    await fs.mkdir(parent);
    const sourceBytes = Buffer.alloc(4 * 1024 * 1024, 0x41);
    await fs.writeFile(source, sourceBytes);
    const snapshot = makeSnapshot(sourceBytes);
    const controller = new AbortController();
    await expect(exportProjectBundleDirectory({
      operationId: randomUUID(),
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.phase === "copying" && BigInt(progress.completedBytes) > 0n) controller.abort();
      },
      destinationParent: parent,
      snapshot,
      getCurrentSnapshot: () => snapshot,
      resolveSourcePath: () => source,
      inspectHeader: async () => makeHeader(),
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(await fs.readdir(parent)).toEqual([]);
  });

  it("rejects cancellation before it creates managed staging state", async () => {
    const root = await temporaryDirectory();
    const controller = new AbortController();
    controller.abort();
    await expect(stageProjectBundleDirectory({
      operationId: randomUUID(),
      signal: controller.signal,
      onProgress: () => undefined,
      bundlePath: path.join(root, "missing.mdp"),
      userDataPath: path.join(root, "app-data"),
      inspectHeader: async () => makeHeader(),
    })).rejects.toMatchObject({ name: "AbortError" });
    await expect(fs.stat(path.join(root, "app-data", "point-cloud-sources"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cancels a streamed import and removes its private staging directory", async () => {
    const root = await temporaryDirectory();
    const { bundlePath } = await exportFixture(root, Buffer.alloc(2 * 1024 * 1024, 0x42));
    const userDataPath = path.join(root, "restore-app-data");
    const controller = new AbortController();
    await expect(stageProjectBundleDirectory({
      operationId: randomUUID(),
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.phase === "copying" && BigInt(progress.completedBytes) > 0n) controller.abort();
      },
      bundlePath,
      userDataPath,
      inspectHeader: async () => makeHeader(),
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(await fs.readdir(path.join(userDataPath, "point-cloud-sources", "staging"))).toEqual([]);
  });
});
