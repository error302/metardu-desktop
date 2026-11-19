import { describe, expect, it } from "vitest";
import {
  COMMUNITY_EXTENSION_MANIFEST_SCHEMA,
  COMMUNITY_EXTENSION_PACKAGE_RUN_INPUT_SCHEMA,
  PLUGIN_RUN_INPUT_SCHEMA,
} from "../namespaces/plugins.js";

const validRequest = () => ({
  moduleToken: "123e4567-e89b-42d3-a456-426614174000",
  pluginId: "community.example.point-summary",
  version: "0.1.0",
  input: { points: [{ easting: 10, northing: 20, elevation: 3 }] },
});

describe("community plugin IPC input", () => {
  it("accepts bounded JSON with a claimed reverse-domain ID", () => {
    expect(PLUGIN_RUN_INPUT_SCHEMA.safeParse(validRequest()).success).toBe(true);
  });

  it("rejects a non-v4 module token and malformed claimed ID", () => {
    expect(PLUGIN_RUN_INPUT_SCHEMA.safeParse({ ...validRequest(), moduleToken: "not-a-token" }).success).toBe(false);
    expect(PLUGIN_RUN_INPUT_SCHEMA.safeParse({ ...validRequest(), pluginId: "Unknown Country!" }).success).toBe(false);
  });

  it("rejects non-finite numbers and cyclic payloads", () => {
    expect(PLUGIN_RUN_INPUT_SCHEMA.safeParse({ ...validRequest(), input: { value: Number.NaN } }).success).toBe(false);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(PLUGIN_RUN_INPUT_SCHEMA.safeParse({ ...validRequest(), input: cycle }).success).toBe(false);
  });

  it("rejects deeply nested JSON before it reaches the privileged process", () => {
    let input: unknown = null;
    for (let i = 0; i < 66; i += 1) input = { next: input };
    expect(PLUGIN_RUN_INPUT_SCHEMA.safeParse({ ...validRequest(), input }).success).toBe(false);
  });

  it("rejects JSON input above the 4 MiB byte limit", () => {
    const input = { payload: "x".repeat(4 * 1024 * 1024) };
    expect(PLUGIN_RUN_INPUT_SCHEMA.safeParse({ ...validRequest(), input }).success).toBe(false);
  });
});

describe("local community package metadata and run input", () => {
  const manifest = {
    format: "metardu-extension",
    formatVersion: 1,
    abiVersion: 1,
    id: "community.example.point-summary",
    version: "0.1.0",
    name: "Point summary",
    description: "Summarizes explicitly supplied survey points.",
    publisherName: "Example Community",
    licenseId: "MIT",
    moduleSha256: "a".repeat(64),
  };

  it("accepts a strict ABI v1 manifest and rejects unknown claims", () => {
    expect(COMMUNITY_EXTENSION_MANIFEST_SCHEMA.safeParse(manifest).success).toBe(true);
    expect(COMMUNITY_EXTENSION_MANIFEST_SCHEMA.safeParse({ ...manifest, signed: true }).success).toBe(false);
    expect(COMMUNITY_EXTENSION_MANIFEST_SCHEMA.safeParse({ ...manifest, id: "not an id" }).success).toBe(false);
  });

  it("accepts only a package digest and bounded JSON input for installed runs", () => {
    expect(COMMUNITY_EXTENSION_PACKAGE_RUN_INPUT_SCHEMA.safeParse({
      packageSha256: "b".repeat(64),
      input: { points: [{ x: 1, y: 2, z: 3 }] },
    }).success).toBe(true);
    expect(COMMUNITY_EXTENSION_PACKAGE_RUN_INPUT_SCHEMA.safeParse({
      packageSha256: "../outside",
      input: {},
    }).success).toBe(false);
  });
});
