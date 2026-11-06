import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PublicMapReferenceService, type PublicMapReferenceDependencies } from "../main/public-map-reference.js";

const temporaryDirectories: string[] = [];

async function makeDependencies(
  overrides: Partial<PublicMapReferenceDependencies> = {},
): Promise<PublicMapReferenceDependencies> {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "metardu-public-map-"));
  temporaryDirectories.push(userDataPath);
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value: string) => Buffer.from([...Buffer.from(value)].reverse()),
    decryptStringAsync: async (value: Buffer) => ({
      result: Buffer.from([...value].reverse()).toString("utf8"),
      shouldReEncrypt: false,
    }),
    getSelectedStorageBackend: () => "gnome_libsecret",
  };
  const fetch = async (): Promise<Response> => new Response("", { status: 500 });
  return { userDataPath, platform: "linux", safeStorage, fetch, ...overrides };
}

function response(status: number, contentType: string, bytes: Uint8Array): Response {
  return new Response(bytes, { status, headers: { "content-type": contentType } });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("main-process public map reference service", () => {
  it("stores a LINZ key encrypted and returns only its configuration status", async () => {
    const deps = await makeDependencies();
    const service = new PublicMapReferenceService(deps);
    const key = "linz-test-key-123456789";

    await expect(service.saveLinzApiKey(key)).resolves.toEqual({ configured: true, secureStorageAvailable: true });
    const saved = await fs.readFile(path.join(deps.userDataPath, "linz-lds-api-key.enc"), "utf8");
    expect(saved).not.toContain(key);
    await expect(service.getLinzCredentialStatus()).resolves.toEqual({ configured: true, secureStorageAvailable: true });
  });

  it("refuses key persistence when Linux has only Electron basic_text storage", async () => {
    const deps = await makeDependencies({
      safeStorage: {
        isAsyncEncryptionAvailable: async () => true,
        encryptStringAsync: async (value: string) => Buffer.from(value),
        decryptStringAsync: async (value: Buffer) => ({ result: value.toString("utf8"), shouldReEncrypt: false }),
        getSelectedStorageBackend: () => "basic_text",
      },
    });
    const service = new PublicMapReferenceService(deps);

    await expect(service.saveLinzApiKey("linz-test-key-123456789")).rejects.toThrow("Secure OS credential storage is unavailable");
    await expect(fs.stat(path.join(deps.userDataPath, "linz-lds-api-key.enc"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("builds the fixed PDOK WMS URL in the main process and validates the image", async () => {
    let requestedUrl = "";
    const deps = await makeDependencies({
      fetch: async (url) => {
        requestedUrl = url;
        return response(200, "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      },
    });
    const service = new PublicMapReferenceService(deps);

    await expect(service.fetchPdokTile({ bbox3857: [1, 2, 3, 4], width: 256, height: 256 }))
      .resolves.toHaveLength(8);
    const url = new URL(requestedUrl);
    expect(url.origin).toBe("https://service.pdok.nl");
    expect(url.searchParams.get("LAYERS")).toBe("KadastraleGrens");
    expect(url.searchParams.get("CRS")).toBe("EPSG:3857");
    expect(url.searchParams.get("BBOX")).toBe("1,2,3,4");
  });

  it("limits LINZ requests to a keyed, viewport-filtered parcel query and strips attributes", async () => {
    let requestedUrl = "";
    const featureCollection = {
      type: "FeatureCollection",
      numberMatched: 1,
      features: [{
        type: "Feature",
        id: 12,
        properties: { appellation: "private title data is not needed by this map", titles: ["ABC/123"] },
        geometry: {
          type: "Polygon",
          coordinates: [[[174.7, -41.2], [174.8, -41.2], [174.8, -41.1], [174.7, -41.2]]],
        },
      }],
    };
    const deps = await makeDependencies({
      fetch: async (url) => {
        requestedUrl = url;
        return response(200, "application/json", new TextEncoder().encode(JSON.stringify(featureCollection)));
      },
    });
    const service = new PublicMapReferenceService(deps);
    await service.saveLinzApiKey("linz-test-key-123456789");

    const result = await service.fetchLinzPrimaryParcels({ bbox4326: [174.7, -41.2, 174.8, -41.1] });
    const url = new URL(requestedUrl);
    expect(url.origin).toBe("https://data.linz.govt.nz");
    expect(url.pathname).toContain(";key=linz-test-key-123456789/wfs");
    expect(url.searchParams.get("typeNames")).toBe("layer-50772");
    expect(url.searchParams.get("count")).toBe("1000");
    expect(url.searchParams.get("outputformat")).toBe("json");
    expect(url.searchParams.get("cql_filter")).toBe("bbox(shape,-41.2,174.7,-41.1,174.8)");
    expect(result.features[0]?.properties).toEqual({});
    expect(JSON.stringify(result)).not.toContain("ABC/123");
  });

  it("rejects invalid provider extents before any network request", async () => {
    let requestCount = 0;
    const deps = await makeDependencies({ fetch: async () => { requestCount += 1; throw new Error("unexpected request"); } });
    const service = new PublicMapReferenceService(deps);

    await expect(service.fetchPdokTile({ bbox3857: [3, 2, 1, 4], width: 256, height: 256 })).rejects.toThrow("Invalid PDOK");
    await expect(service.fetchLinzPrimaryParcels({ bbox4326: [-1, 0, 1, 2] })).rejects.toThrow("Invalid LINZ map extent");
    expect(requestCount).toBe(0);
  });
});
