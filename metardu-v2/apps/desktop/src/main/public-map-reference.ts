import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  PUBLIC_MAP_LINZ_KEY_SCHEMA,
  PUBLIC_MAP_LINZ_PARCEL_INPUT_SCHEMA,
  PUBLIC_MAP_PDOK_TILE_INPUT_SCHEMA,
  type PublicMapReferenceFeatureCollection,
} from "@metardu/ipc-schemas";

const MAX_PDOK_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_LINZ_JSON_BYTES = 10 * 1024 * 1024;
const MAX_LINZ_FEATURES = 1_000;
const MAX_LINZ_POSITIONS = 250_000;
const PDOK_WMS_URL = "https://service.pdok.nl/kadaster/brk-kadastrale-kaart/wms/v5_0";
const LINZ_WFS_URL = "https://data.linz.govt.nz/services;key={key}/wfs";
const LINUX_SECURE_BACKENDS = new Set(["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]);

export interface PublicMapSafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
  getSelectedStorageBackend(): string;
}

export interface PublicMapFetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}

export type PublicMapFetcher = (
  url: string,
  init: { headers: Record<string, string>; redirect: "error"; signal: AbortSignal },
) => Promise<PublicMapFetchResponse>;

export interface PublicMapReferenceDependencies {
  userDataPath: string;
  platform: string;
  safeStorage: PublicMapSafeStorage;
  fetch: PublicMapFetcher;
}

export interface LinzCredentialStatus {
  configured: boolean;
  secureStorageAvailable: boolean;
}

function toFixedCoordinate(value: number): string {
  return Number(value.toFixed(7)).toString();
}

async function readBoundedBody(response: PublicMapFetchResponse, maxBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error("The map provider response exceeded the permitted size.");
  }
  if (!response.body) throw new Error("The map provider returned an empty response.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The map provider response exceeded the permitted size.");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function requireFeatureCollection(value: unknown): PublicMapReferenceFeatureCollection {
  if (!value || typeof value !== "object") throw new Error("LINZ returned an invalid feature response.");
  const data = value as Record<string, unknown>;
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error("LINZ returned an unsupported feature response.");
  }
  if (data.features.length > MAX_LINZ_FEATURES) {
    throw new Error("LINZ returned more parcels than the desktop limit allows.");
  }

  let positions = 0;
  const sanitizeRing = (value: unknown): number[][] => {
    if (!Array.isArray(value) || value.length < 4) throw new Error("LINZ returned an invalid parcel ring.");
    const ring = value.map((coordinate) => {
      positions += 1;
      if (positions > MAX_LINZ_POSITIONS || !Array.isArray(coordinate) || coordinate.length < 2) {
        throw new Error("LINZ returned invalid or excessive parcel geometry.");
      }
      const [longitude, latitude] = coordinate;
      if (typeof longitude !== "number" || typeof latitude !== "number"
        || !Number.isFinite(longitude) || !Number.isFinite(latitude)
        || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
        throw new Error("LINZ returned invalid parcel coordinates.");
      }
      return [longitude, latitude];
    });
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      throw new Error("LINZ returned an unclosed parcel ring.");
    }
    return ring;
  };
  const sanitizePolygon = (value: unknown): number[][][] => {
    if (!Array.isArray(value) || value.length === 0) throw new Error("LINZ returned an invalid parcel polygon.");
    return value.map(sanitizeRing);
  };

  const features = data.features.map((feature): PublicMapReferenceFeatureCollection["features"][number] => {
    if (!feature || typeof feature !== "object") throw new Error("LINZ returned an invalid parcel feature.");
    const item = feature as Record<string, unknown>;
    const geometry = item.geometry as Record<string, unknown> | null;
    if (item.type !== "Feature" || !geometry || typeof geometry !== "object") {
      throw new Error("LINZ returned a parcel without polygon geometry.");
    }
    let sanitizedGeometry: PublicMapReferenceFeatureCollection["features"][number]["geometry"];
    if (geometry.type === "Polygon") {
      sanitizedGeometry = { type: "Polygon", coordinates: sanitizePolygon(geometry.coordinates) };
    } else if (geometry.type === "MultiPolygon") {
      if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
        throw new Error("LINZ returned an invalid multipart parcel.");
      }
      sanitizedGeometry = {
        type: "MultiPolygon",
        coordinates: geometry.coordinates.map(sanitizePolygon),
      };
    } else {
      throw new Error("LINZ returned a non-polygon parcel geometry.");
    }
    const id = typeof item.id === "string" || (typeof item.id === "number" && Number.isFinite(item.id))
      ? item.id
      : undefined;
    return {
      type: "Feature",
      ...(id === undefined ? {} : { id }),
      properties: {},
      geometry: sanitizedGeometry,
    };
  });

  const matchedValue = Number(data.numberMatched ?? data.totalFeatures);
  const truncated = features.length === MAX_LINZ_FEATURES
    || (Number.isFinite(matchedValue) && matchedValue > features.length);
  return { type: "FeatureCollection", features, truncated };
}

export class PublicMapReferenceService {
  private readonly credentialPath: string;
  private lastLinzRequestAt = 0;

  constructor(private readonly dependencies: PublicMapReferenceDependencies) {
    this.credentialPath = path.join(dependencies.userDataPath, "linz-lds-api-key.enc");
  }

  private async secureStorageAvailable(): Promise<boolean> {
    try {
      if (!await this.dependencies.safeStorage.isAsyncEncryptionAvailable()) return false;
      if (this.dependencies.platform === "linux") {
        return LINUX_SECURE_BACKENDS.has(this.dependencies.safeStorage.getSelectedStorageBackend());
      }
      return true;
    } catch {
      return false;
    }
  }

  async getLinzCredentialStatus(): Promise<LinzCredentialStatus> {
    let configured = false;
    try {
      const stat = await fs.lstat(this.credentialPath);
      configured = stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 16_384;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Unable to inspect the LINZ credential store.");
    }
    return { configured, secureStorageAvailable: await this.secureStorageAvailable() };
  }

  async saveLinzApiKey(untrustedKey: unknown): Promise<LinzCredentialStatus> {
    const parsed = PUBLIC_MAP_LINZ_KEY_SCHEMA.safeParse(untrustedKey);
    if (!parsed.success) throw new Error("Enter a valid LINZ Data Service API key.");
    if (!await this.secureStorageAvailable()) {
      throw new Error("Secure OS credential storage is unavailable. The LINZ key was not saved.");
    }

    let encrypted: Buffer;
    try {
      encrypted = await this.dependencies.safeStorage.encryptStringAsync(parsed.data);
    } catch {
      throw new Error("The LINZ key could not be encrypted. It was not saved.");
    }
    const encryptedText = encrypted.toString("base64");
    await fs.mkdir(this.dependencies.userDataPath, { recursive: true });
    const tempPath = `${this.credentialPath}.${process.pid}.${Date.now()}.tmp`;
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(tempPath, "wx", 0o600);
      await handle.writeFile(encryptedText, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(tempPath, this.credentialPath);
    } catch {
      await handle?.close().catch(() => undefined);
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw new Error("Unable to save the LINZ key in secure local storage.");
    }
    return this.getLinzCredentialStatus();
  }

  async clearLinzApiKey(): Promise<LinzCredentialStatus> {
    try {
      await fs.rm(this.credentialPath, { force: true });
    } catch {
      throw new Error("Unable to remove the locally stored LINZ key.");
    }
    return this.getLinzCredentialStatus();
  }

  async fetchPdokTile(untrustedInput: unknown): Promise<Uint8Array> {
    const parsed = PUBLIC_MAP_PDOK_TILE_INPUT_SCHEMA.safeParse(untrustedInput);
    if (!parsed.success) throw new Error("Invalid PDOK map tile request.");
    const [minX, minY, maxX, maxY] = parsed.data.bbox3857;
    const requestUrl = new URL(PDOK_WMS_URL);
    requestUrl.searchParams.set("SERVICE", "WMS");
    requestUrl.searchParams.set("REQUEST", "GetMap");
    requestUrl.searchParams.set("VERSION", "1.3.0");
    requestUrl.searchParams.set("LAYERS", "KadastraleGrens");
    requestUrl.searchParams.set("STYLES", "");
    requestUrl.searchParams.set("CRS", "EPSG:3857");
    requestUrl.searchParams.set("BBOX", [minX, minY, maxX, maxY].map(toFixedCoordinate).join(","));
    requestUrl.searchParams.set("WIDTH", String(parsed.data.width));
    requestUrl.searchParams.set("HEIGHT", String(parsed.data.height));
    requestUrl.searchParams.set("FORMAT", "image/png");
    requestUrl.searchParams.set("TRANSPARENT", "TRUE");

    const response = await this.dependencies.fetch(requestUrl.toString(), {
      headers: { Accept: "image/png" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`PDOK map request failed (HTTP ${response.status}).`);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("image/png")) {
      throw new Error("PDOK returned an unexpected map image format.");
    }
    const bytes = await readBoundedBody(response, MAX_PDOK_IMAGE_BYTES);
    if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
      throw new Error("PDOK returned an invalid PNG image.");
    }
    return bytes;
  }

  async fetchLinzPrimaryParcels(untrustedInput: unknown): Promise<PublicMapReferenceFeatureCollection> {
    const parsed = PUBLIC_MAP_LINZ_PARCEL_INPUT_SCHEMA.safeParse(untrustedInput);
    if (!parsed.success) throw new Error("Invalid LINZ map extent. Zoom in within New Zealand and retry.");
    const key = await this.readLinzApiKey();
    const [west, south, east, north] = parsed.data.bbox4326;
    const requestUrl = new URL(LINZ_WFS_URL.replace("{key}", encodeURIComponent(key)));
    requestUrl.searchParams.set("service", "WFS");
    requestUrl.searchParams.set("version", "2.0.0");
    requestUrl.searchParams.set("request", "GetFeature");
    requestUrl.searchParams.set("typeNames", "layer-50772");
    requestUrl.searchParams.set("SRSName", "EPSG:4326");
    requestUrl.searchParams.set("count", String(MAX_LINZ_FEATURES));
    requestUrl.searchParams.set("outputformat", "json");
    requestUrl.searchParams.set("cql_filter", `bbox(shape,${toFixedCoordinate(south)},${toFixedCoordinate(west)},${toFixedCoordinate(north)},${toFixedCoordinate(east)})`);

    const now = Date.now();
    if (now - this.lastLinzRequestAt < 750) {
      throw new Error("LINZ requests are briefly rate-limited while the map is moving. Wait a moment and retry.");
    }
    this.lastLinzRequestAt = now;

    let response: PublicMapFetchResponse;
    try {
      response = await this.dependencies.fetch(requestUrl.toString(), {
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error("Could not reach LINZ Data Service. Check the connection and retry.");
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("LINZ rejected this API key or its access. Check the key and dataset terms.");
      }
      throw new Error(`LINZ parcel request failed (HTTP ${response.status}).`);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("json")) throw new Error("LINZ returned an unexpected parcel data format.");
    const bytes = await readBoundedBody(response, MAX_LINZ_JSON_BYTES);
    let parsedResponse: unknown;
    try {
      parsedResponse = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error("LINZ returned invalid parcel data.");
    }
    return requireFeatureCollection(parsedResponse);
  }

  private async readLinzApiKey(): Promise<string> {
    if (!await this.secureStorageAvailable()) {
      throw new Error("Secure OS credential storage is unavailable. The LINZ key cannot be read.");
    }
    let encryptedText: string;
    try {
      const stat = await fs.lstat(this.credentialPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 8 || stat.size > 16_384) {
        throw new Error("Credential file is invalid.");
      }
      encryptedText = await fs.readFile(this.credentialPath, "utf8");
    } catch {
      throw new Error("Add your LINZ Data Service API key in the public reference data panel first.");
    }
    let encrypted: Buffer;
    try {
      encrypted = Buffer.from(encryptedText, "base64");
      if (encrypted.toString("base64") !== encryptedText) throw new Error("Invalid encrypted key.");
    } catch {
      throw new Error("The saved LINZ key cannot be read from secure storage. Remove it and add it again.");
    }
    try {
      const decrypted = await this.dependencies.safeStorage.decryptStringAsync(encrypted);
      if (decrypted.shouldReEncrypt) {
        const rotated = await this.dependencies.safeStorage.encryptStringAsync(decrypted.result);
        const tempPath = `${this.credentialPath}.${process.pid}.${Date.now()}.rotate.tmp`;
        await fs.writeFile(tempPath, rotated.toString("base64"), { encoding: "utf8", mode: 0o600, flag: "wx" });
        await fs.rename(tempPath, this.credentialPath);
      }
      const validated = PUBLIC_MAP_LINZ_KEY_SCHEMA.safeParse(decrypted.result);
      if (!validated.success) throw new Error("Invalid decrypted credential.");
      return validated.data;
    } catch {
      throw new Error("The saved LINZ key cannot be decrypted by this OS credential store. Remove it and add it again.");
    }
  }
}
