import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Zip, ZipPassThrough } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  CommunityExtensionPackageStore,
  MAX_COMMUNITY_EXTENSION_MODULE_BYTES,
  MAX_COMMUNITY_EXTENSION_PACKAGE_BYTES,
  parseCommunityExtensionPackage,
} from "../main/community-extension-packages.js";
import { createHash } from "node:crypto";

const tempDirectories: string[] = [];
const wasmHeader = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function manifestFor(moduleBytes: Buffer) {
  // Keep keys in ABI v1 canonical order. Duplicate/ambiguous JSON is rejected.
  return {
    format: "metardu-extension",
    formatVersion: 1,
    abiVersion: 1,
    id: "community.example.point-summary",
    version: "0.1.0",
    name: "Point summary",
    description: "Summarizes explicitly supplied survey points.",
    publisherName: "Example Community",
    licenseId: "MIT",
    moduleSha256: sha256(moduleBytes),
  };
}

function makeZip(entries: Array<[string, Buffer]>): Buffer {
  const chunks: Buffer[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, data) => {
    if (error) failure = error;
    else chunks.push(Buffer.from(data));
  });
  for (const [name, contents] of entries) {
    const file = new ZipPassThrough(name);
    zip.add(file);
    file.push(contents, true);
  }
  zip.end();
  if (failure) throw failure;
  return Buffer.concat(chunks);
}

function makePackage(options: {
  moduleBytes?: Buffer;
  entries?: Array<[string, Buffer]>;
  manifestText?: string;
} = {}): Buffer {
  const moduleBytes = options.moduleBytes ?? wasmHeader;
  const entries = options.entries ?? [
    ["manifest.json", Buffer.from(options.manifestText ?? JSON.stringify(manifestFor(moduleBytes)))],
    ["module.wasm", moduleBytes],
    ["LICENSE.txt", Buffer.from("MIT License\n")],
  ];
  return makeZip(entries);
}

async function tempUserData(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "metardu-community-extension-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local community extension package store", () => {
  it("installs immutable content-addressed bytes and lists claimed metadata as Community / Draft", async () => {
    const archive = makePackage();
    const userData = await tempUserData();
    const store = new CommunityExtensionPackageStore(userData);

    const installed = await store.install(archive);
    expect(installed.alreadyInstalled).toBe(false);
    expect(installed.package).toMatchObject({
      packageSha256: sha256(archive),
      moduleSha256: sha256(wasmHeader),
      id: "community.example.point-summary",
      licenseId: "MIT",
      trustState: "community-draft",
    });
    expect((await store.install(archive)).alreadyInstalled).toBe(true);
    const listing = await store.list();
    expect(listing.packages).toEqual([installed.package]);
    expect(listing.issues).toEqual([]);

    const loaded = await store.loadForRun(installed.package.packageSha256);
    expect(loaded.moduleBytes).toEqual(wasmHeader);
    expect(loaded.packageSha256).toBe(installed.package.packageSha256);
    expect(loaded.licenseText).toBe("MIT License\n");
  });

  it("rejects path-bearing, extra, and duplicate archive members", async () => {
    const manifest = Buffer.from(JSON.stringify(manifestFor(wasmHeader)));
    const module = wasmHeader;
    const license = Buffer.from("MIT License\n");

    await expect(parseCommunityExtensionPackage(makePackage({ entries: [
      ["manifest.json", manifest], ["module.wasm", module], ["../LICENSE.txt", license],
    ] }))).rejects.toThrow(/unsupported|path-bearing|exactly|invalid relative path/);
    await expect(parseCommunityExtensionPackage(makePackage({ entries: [
      ["manifest.json", manifest], ["module.wasm", module], ["LICENSE.txt", license], ["README.md", Buffer.from("extra")],
    ] }))).rejects.toThrow(/member count|unsupported/);
    await expect(parseCommunityExtensionPackage(makePackage({ entries: [
      ["manifest.json", manifest], ["manifest.json", manifest], ["module.wasm", module],
    ] }))).rejects.toThrow(/member count|duplicate|exactly/);
  });

  it("rejects non-canonical manifests and module digest mismatches", async () => {
    const nonCanonical = JSON.stringify(manifestFor(wasmHeader), null, 2);
    await expect(parseCommunityExtensionPackage(makePackage({ manifestText: nonCanonical }))).rejects.toThrow(/canonical/);

    const tamperedManifest = { ...manifestFor(wasmHeader), moduleSha256: "0".repeat(64) };
    await expect(parseCommunityExtensionPackage(makePackage({ manifestText: JSON.stringify(tamperedManifest) }))).rejects.toThrow(/does not match/);
  });

  it("rejects empty licences, unsupported module bytes, and expanded modules over 8 MiB", async () => {
    await expect(parseCommunityExtensionPackage(makePackage({
      entries: [
        ["manifest.json", Buffer.from(JSON.stringify(manifestFor(wasmHeader)))],
        ["module.wasm", wasmHeader],
        ["LICENSE.txt", Buffer.alloc(0)],
      ],
    }))).rejects.toThrow(/LICENSE/);

    const notWasm = Buffer.from("not-wasm");
    await expect(parseCommunityExtensionPackage(makePackage({
      moduleBytes: notWasm,
      entries: [
        ["manifest.json", Buffer.from(JSON.stringify(manifestFor(notWasm)))],
        ["module.wasm", notWasm],
        ["LICENSE.txt", Buffer.from("MIT License\n")],
      ],
    }))).rejects.toThrow(/WebAssembly/);

    const oversized = Buffer.concat([
      Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
      Buffer.alloc(MAX_COMMUNITY_EXTENSION_MODULE_BYTES - 7, 65),
    ]);
    expect(oversized.length).toBe(MAX_COMMUNITY_EXTENSION_MODULE_BYTES + 1);
    await expect(parseCommunityExtensionPackage(makePackage({ moduleBytes: oversized }))).rejects.toThrow(/size limit|size limit|size/);
  });

  it("rejects oversized compressed packages before ZIP parsing", async () => {
    const oversized = Buffer.alloc(MAX_COMMUNITY_EXTENSION_PACKAGE_BYTES + 1);
    await expect(parseCommunityExtensionPackage(oversized)).rejects.toThrow(/no larger than/);
  });

  it("surfaces post-install tampering and refuses to load the altered package", async () => {
    const archive = makePackage();
    const userData = await tempUserData();
    const store = new CommunityExtensionPackageStore(userData);
    const installed = await store.install(archive);
    const packagePath = path.join(userData, "community-extensions", "packages", `${installed.package.packageSha256}.mdplug`);
    await writeFile(packagePath, Buffer.concat([await readFile(packagePath), Buffer.from([0]) ]));

    const listing = await store.list();
    expect(listing.packages).toEqual([]);
    expect(listing.issues).toEqual([expect.objectContaining({
      packageSha256: installed.package.packageSha256,
      message: expect.stringContaining("content-addressed package digest"),
    })]);
    await expect(store.loadForRun(installed.package.packageSha256)).rejects.toThrow(/integrity check failed/);
  });

  it("rejects non-digest renderer input without touching a storage path", async () => {
    const store = new CommunityExtensionPackageStore(await tempUserData());
    await expect(store.loadForRun("..\\package.mdplug")).rejects.toThrow(/digest is invalid/);
  });
});
