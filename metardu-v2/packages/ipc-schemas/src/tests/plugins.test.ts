import { describe, expect, it } from "vitest";
import { PLUGIN_RUN_INPUT_SCHEMA } from "../namespaces/plugins.js";

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
