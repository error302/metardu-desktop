import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  pointCloudObjectPath,
  publishPointCloudObject,
  removeStagedPointCloudSource,
  stagePointCloudSource,
  verifyPointCloudObject,
} from "../main/point-cloud-store.js";

const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "metardu-pointcloud-store-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project point-cloud object store", () => {
  it("streams a selected source into a hash-addressed object and reuses verified duplicates", async () => {
    const root = await createRoot();
    const source = path.join(root, "survey.las");
    const bytes = Buffer.alloc(512, 0x53);
    await writeFile(source, bytes);

    const staged = await stagePointCloudSource(source, root);
    expect(staged.fileName).toBe("survey.las");
    expect(staged.fileSizeBytes).toBe("512");
    expect(staged.contentSha256).toBe(createHash("sha256").update(bytes).digest("hex"));

    const published = await publishPointCloudObject(staged, root);
    expect(path.basename(path.dirname(published.objectPath))).toBe(`${staged.contentSha256}.las`);
    expect(await readFile(published.objectPath)).toEqual(bytes);
    expect(pointCloudObjectPath(root, published.storageKey)).toBe(published.objectPath);
    expect(await verifyPointCloudObject(root, published.storageKey, staged.contentSha256, staged.fileSizeBytes)).toMatchObject({
      status: "verified",
      actualSha256: staged.contentSha256,
      actualSizeBytes: "512",
    });

    const duplicate = await stagePointCloudSource(source, root);
    const reused = await publishPointCloudObject(duplicate, root);
    expect(reused).toEqual(published);
    expect(await readdir(path.join(root, "point-cloud-sources", "objects"))).toEqual([published.storageKey]);

    await removeStagedPointCloudSource(staged.stagingPath);
    await removeStagedPointCloudSource(duplicate.stagingPath);
  });

  it("refuses to overwrite a corrupted object that collides with its content key", async () => {
    const root = await createRoot();
    const source = path.join(root, "survey.laz");
    await writeFile(source, Buffer.alloc(512, 0x21));

    const staged = await stagePointCloudSource(source, root);
    const published = await publishPointCloudObject(staged, root);
    await writeFile(published.objectPath, Buffer.alloc(512, 0x22));

    const duplicate = await stagePointCloudSource(source, root);
    await expect(publishPointCloudObject(duplicate, root)).rejects.toThrow(/does not match its content-addressed key/);
    expect(await readFile(published.objectPath)).toEqual(Buffer.alloc(512, 0x22));
    expect(await verifyPointCloudObject(root, published.storageKey, staged.contentSha256, staged.fileSizeBytes)).toMatchObject({ status: "hashMismatch" });
    await removeStagedPointCloudSource(duplicate.stagingPath);
  });

  it("rejects unsupported source extensions and unsafe object keys", async () => {
    const root = await createRoot();
    const unsupported = path.join(root, "survey.xyz");
    await writeFile(unsupported, Buffer.alloc(512));

    await expect(stagePointCloudSource(unsupported, root)).rejects.toThrow(/\.las or \.laz/);
    expect(() => pointCloudObjectPath(root, "..\\outside.las")).toThrow(/storage key is invalid/);
  });
});
