import { randomUUID } from "node:crypto";
import {
  POINT_CLOUD_CHUNK_STREAM_ID_SCHEMA,
  POINT_CLOUD_CHUNK_STREAM_READ_SCHEMA,
  POINT_CLOUD_CHUNK_STREAM_START_SCHEMA,
  POINT_CLOUD_CHUNK_STREAM_STATUS_SCHEMA,
  POINT_CLOUD_SOURCE_ID_SCHEMA,
  type PointCloudChunkStreamMetadata,
  type PointCloudChunkStreamRead,
  type PointCloudChunkStreamStatus,
} from "@metardu/ipc-schemas";
import type { StoredPointCloudSource, StoredProject } from "./database.js";
import { pointCloudObjectPath, verifyPointCloudObject } from "./point-cloud-store.js";

const MAX_STREAMS = 8;
const STREAM_TTL_MS = 30 * 60 * 1000;

type PointCloudChunkSidecar = {
  isRunning(): boolean;
  call<T = unknown>(method: string, params: unknown, options?: { timeoutMs?: number }): Promise<T>;
};

export interface PointCloudChunkStreamStore {
  getActiveProject(): StoredProject | null;
  getSource(projectId: string, sourceId: string): StoredPointCloudSource | undefined;
}

export interface PointCloudChunkStreamDependencies {
  store: PointCloudChunkStreamStore;
  getSidecar(): PointCloudChunkSidecar | null;
  getUserDataPath(): string;
  newStreamId?: () => string;
  now?: () => number;
}

type StreamState = "running" | "cancelling" | "completed" | "cancelled" | "failed";

interface ManagedStream {
  id: string;
  sidecarId: string;
  projectId: string;
  sourceId: string;
  storageKey: string;
  contentSha256: string;
  fileSizeBytes: string;
  metadata: PointCloudChunkStreamMetadata;
  state: StreamState;
  nextChunkIndex: bigint;
  nextPointIndex: bigint;
  createdAt: number;
  readPending: boolean;
  message?: string;
}

export interface PointCloudChunkStreamOpen {
  streamId: string;
  sourceId: string;
  sourceSha256: string;
  metadata: PointCloudChunkStreamMetadata;
}

function sourceId(value: unknown): string {
  const parsed = POINT_CLOUD_SOURCE_ID_SCHEMA.safeParse(value);
  if (!parsed.success) throw new Error("Point-cloud source identifier is invalid.");
  return parsed.data.toLowerCase();
}

function streamId(value: unknown): string {
  const parsed = POINT_CLOUD_CHUNK_STREAM_ID_SCHEMA.safeParse(value);
  if (!parsed.success) throw new Error("Point-cloud stream identifier is invalid.");
  return parsed.data.toLowerCase();
}

function terminal(state: StreamState): boolean {
  return state === "completed" || state === "cancelled" || state === "failed";
}

interface SourceFingerprint {
  projectId: string;
  sourceId: string;
  storageKey: string;
  contentSha256: string;
  fileSizeBytes: string;
}

function sameSource(left: StoredPointCloudSource | undefined, right: SourceFingerprint): boolean {
  return !!left
    && left.id === right.sourceId
    && left.projectId === right.projectId
    && left.storageKey === right.storageKey
    && left.contentSha256 === right.contentSha256
    && left.fileSizeBytes === right.fileSizeBytes;
}

/**
 * Main-process-only source reader for trusted analysis hosts. It is not
 * registered through Electron IPC and never sends paths or complete clouds to
 * the renderer. Derived-output persistence remains a separate contract.
 */
export class PointCloudChunkStreamController {
  private readonly streams = new Map<string, ManagedStream>();
  private opening = false;
  private readonly newId: () => string;
  private readonly now: () => number;

  constructor(private readonly dependencies: PointCloudChunkStreamDependencies) {
    this.newId = dependencies.newStreamId ?? randomUUID;
    this.now = dependencies.now ?? Date.now;
  }

  private prune(): void {
    const now = this.now();
    for (const [id, stream] of this.streams) {
      if (terminal(stream.state) && now - stream.createdAt >= STREAM_TTL_MS) {
        this.streams.delete(id);
      }
    }
    while (this.streams.size >= MAX_STREAMS) {
      const oldestTerminal = [...this.streams.values()]
        .filter((stream) => terminal(stream.state))
        .sort((left, right) => left.createdAt - right.createdAt)[0];
      if (!oldestTerminal) throw new Error("The bounded point-cloud stream store is full.");
      this.streams.delete(oldestTerminal.id);
    }
  }

  private requireStream(rawStreamId: unknown): ManagedStream {
    const id = streamId(rawStreamId);
    const stream = this.streams.get(id);
    if (!stream) throw new Error("Point-cloud stream is unknown or expired.");
    return stream;
  }

  private requireSidecar(): PointCloudChunkSidecar {
    const sidecar = this.dependencies.getSidecar();
    if (!sidecar || !sidecar.isRunning()) throw new Error("Rust sidecar is not running; point-cloud streaming is unavailable.");
    return sidecar;
  }

  private assertActiveSource(stream: ManagedStream): void {
    const project = this.dependencies.store.getActiveProject();
    if (!project || project.id !== stream.projectId) {
      throw new Error("The active project changed during point-cloud processing.");
    }
    if (!sameSource(this.dependencies.store.getSource(stream.projectId, stream.sourceId), stream)) {
      throw new Error("The point-cloud source was detached or changed during processing.");
    }
  }

  private localStatus(stream: ManagedStream): PointCloudChunkStreamStatus {
    if (stream.state === "completed") {
      return {
        status: "completed",
        decodedPointCount: stream.nextPointIndex.toString(),
        declaredPointCount: stream.metadata.declaredPointCount,
      };
    }
    if (stream.state === "cancelled") return { status: "cancelled" };
    if (stream.state === "failed") {
      return { status: "failed", message: stream.message ?? "Point-cloud stream failed; its result is invalid." };
    }
    return {
      status: stream.state === "cancelling" ? "cancelling" : "running",
      decodedPointCount: stream.nextPointIndex.toString(),
      declaredPointCount: stream.metadata.declaredPointCount,
    };
  }

  private async expireIfNeeded(stream: ManagedStream): Promise<void> {
    if (!terminal(stream.state) && this.now() - stream.createdAt >= STREAM_TTL_MS) {
      await this.requestCancel(stream);
    }
  }

  private async refreshStatus(stream: ManagedStream): Promise<PointCloudChunkStreamStatus> {
    this.assertActiveSource(stream);
    const sidecar = this.requireSidecar();
    const rawStatus = await sidecar.call("pointcloud.chunk_stream_status", { streamId: stream.sidecarId });
    const parsed = POINT_CLOUD_CHUNK_STREAM_STATUS_SCHEMA.safeParse(rawStatus);
    if (!parsed.success) throw new Error("Rust sidecar returned an invalid point-cloud stream status.");
    if (parsed.data.status === "cancelled") {
      stream.state = "cancelled";
      return { status: "cancelled" };
    }
    if (parsed.data.status === "completed") {
      await this.finalize(stream, parsed.data.decodedPointCount, parsed.data.declaredPointCount);
      return this.localStatus(stream);
    }
    if (parsed.data.status === "failed") {
      stream.state = "failed";
      stream.message = parsed.data.message;
      return parsed.data;
    }
    if (streamState(stream) === "cancelling" || parsed.data.status === "cancelling") {
      stream.state = "cancelling";
      return this.localStatus(stream);
    }
    return parsed.data;
  }

  private async verifyFinalSource(stream: ManagedStream): Promise<void> {
    this.assertActiveSource(stream);
    const integrity = await verifyPointCloudObject(
      this.dependencies.getUserDataPath(),
      stream.storageKey,
      stream.contentSha256,
      stream.fileSizeBytes,
    );
    if (integrity.status !== "verified") {
      throw new Error("Point-cloud source integrity changed during processing.");
    }
    this.assertActiveSource(stream);
  }

  private async requestCancel(stream: ManagedStream): Promise<boolean> {
    const sidecar = this.dependencies.getSidecar();
    if (!sidecar || !sidecar.isRunning()) {
      stream.state = "failed";
      stream.message = "The Rust sidecar stopped; the point-cloud stream is invalid.";
      return false;
    }
    try {
      const result = await sidecar.call<{ accepted: boolean }>("pointcloud.cancel_chunk_stream", {
        streamId: stream.sidecarId,
      });
      if (result.accepted && !terminal(stream.state)) stream.state = "cancelling";
      return result.accepted;
    } catch {
      stream.state = "failed";
      stream.message = "The point-cloud stream could not be cancelled; its result is invalid.";
      return false;
    }
  }

  private asTerminalRead(stream: ManagedStream): PointCloudChunkStreamRead | null {
    if (stream.state === "completed") {
      return {
        status: "completed",
        decodedPointCount: stream.nextPointIndex.toString(),
        declaredPointCount: stream.metadata.declaredPointCount,
      };
    }
    if (stream.state === "cancelled") return { status: "cancelled" };
    if (stream.state === "failed") {
      return { status: "failed", message: stream.message ?? "Point-cloud stream failed; its result is invalid." };
    }
    if (stream.state === "cancelling") return { status: "cancelling" };
    return null;
  }

  async open(rawSourceId: unknown): Promise<PointCloudChunkStreamOpen> {
    const validatedSourceId = sourceId(rawSourceId);
    await Promise.all([...this.streams.values()].map(async (stream) => {
      if (!terminal(stream.state)) await this.expireIfNeeded(stream);
      if (stream.state === "cancelling" && !stream.readPending) {
        try {
          await this.refreshStatus(stream);
        } catch {
          // A failed or unavailable old stream remains recorded and blocks a new one.
          stream.state = "failed";
          stream.message = "The prior point-cloud stream could not be reconciled.";
        }
      }
    }));
    const project = this.dependencies.store.getActiveProject();
    const source = project ? this.dependencies.store.getSource(project.id, validatedSourceId) : undefined;
    if (!project || !source || source.projectId !== project.id) {
      throw new Error("Point-cloud source is not attached to the active project.");
    }
    this.requireSidecar();
    this.prune();
    if (this.opening || [...this.streams.values()].some((stream) => !terminal(stream.state))) {
      throw new Error("A point-cloud chunk stream is already active.");
    }
    this.opening = true;
    try {
      const integrity = await verifyPointCloudObject(
        this.dependencies.getUserDataPath(),
        source.storageKey,
        source.contentSha256,
        source.fileSizeBytes,
      );
      if (integrity.status !== "verified") throw new Error(`Point-cloud stream stopped because the source is ${integrity.status}.`);
      const fingerprint: SourceFingerprint = {
        projectId: project.id,
        sourceId: source.id,
        storageKey: source.storageKey,
        contentSha256: source.contentSha256,
        fileSizeBytes: source.fileSizeBytes,
      };
      if (this.dependencies.store.getActiveProject()?.id !== project.id
        || !sameSource(this.dependencies.store.getSource(project.id, validatedSourceId), fingerprint)) {
        throw new Error("The active project or point-cloud source changed before streaming started.");
      }

      const sidecar = this.requireSidecar();
      const rawStart = await sidecar.call("pointcloud.start_chunk_stream", {
        path: pointCloudObjectPath(this.dependencies.getUserDataPath(), source.storageKey),
      });
      const parsedStart = POINT_CLOUD_CHUNK_STREAM_START_SCHEMA.safeParse(rawStart);
      if (!parsedStart.success) {
        const maybeId = (rawStart as { streamId?: unknown } | null)?.streamId;
        if (typeof maybeId === "string" && POINT_CLOUD_CHUNK_STREAM_ID_SCHEMA.safeParse(maybeId).success) {
          await sidecar.call("pointcloud.cancel_chunk_stream", { streamId: maybeId }).catch(() => undefined);
        }
        throw new Error("Rust sidecar returned invalid point-cloud stream metadata.");
      }
      const started = parsedStart.data;
      const storedHeader = JSON.parse(source.headerJson) as { headerDeclaredPointCount?: unknown };
      if (started.metadata.declaredPointCount !== storedHeader.headerDeclaredPointCount
        || started.metadata.format !== source.format) {
        await sidecar.call("pointcloud.cancel_chunk_stream", { streamId: started.streamId }).catch(() => undefined);
        throw new Error("Rust sidecar point-cloud metadata does not match the retained project source record.");
      }
      if (this.dependencies.store.getActiveProject()?.id !== project.id
        || !sameSource(this.dependencies.store.getSource(project.id, validatedSourceId), fingerprint)) {
        await sidecar.call("pointcloud.cancel_chunk_stream", { streamId: started.streamId }).catch(() => undefined);
        throw new Error("The active project or point-cloud source changed as the stream opened.");
      }

      const id = this.newId().toLowerCase();
      if (!POINT_CLOUD_CHUNK_STREAM_ID_SCHEMA.safeParse(id).success || this.streams.has(id)) {
        await sidecar.call("pointcloud.cancel_chunk_stream", { streamId: started.streamId }).catch(() => undefined);
        throw new Error("Point-cloud stream identifier could not be safely registered.");
      }
      const stream: ManagedStream = {
        id,
        sidecarId: started.streamId,
        projectId: project.id,
        sourceId: source.id,
        storageKey: source.storageKey,
        contentSha256: source.contentSha256,
        fileSizeBytes: source.fileSizeBytes,
        metadata: started.metadata,
        state: "running",
        nextChunkIndex: 0n,
        nextPointIndex: 0n,
        createdAt: this.now(),
        readPending: false,
      };
      this.streams.set(id, stream);
      return {
        streamId: id,
        sourceId: source.id,
        sourceSha256: source.contentSha256,
        metadata: stream.metadata,
      };
    } finally {
      this.opening = false;
    }
  }

  async readNext(rawStreamId: unknown): Promise<PointCloudChunkStreamRead> {
    const stream = this.requireStream(rawStreamId);
    await this.expireIfNeeded(stream);
    const terminalRead = this.asTerminalRead(stream);
    if (terminalRead) return terminalRead;
    if (stream.readPending) throw new Error("A point-cloud chunk read is already pending for this stream.");
    stream.readPending = true;
    try {
      this.assertActiveSource(stream);
      const sidecar = this.requireSidecar();
      const rawResult = await sidecar.call("pointcloud.read_chunk", { streamId: stream.sidecarId });
      const parsed = POINT_CLOUD_CHUNK_STREAM_READ_SCHEMA.safeParse(rawResult);
      if (!parsed.success) throw new Error("Rust sidecar returned an invalid point-cloud chunk response.");
      const result = parsed.data;
      if (stream.state === "cancelling") {
        if (result.status === "cancelled") {
          stream.state = "cancelled";
          return result;
        }
        if (result.status === "failed") {
          stream.state = "failed";
          stream.message = result.message;
          return result;
        }
        if (result.status === "completed") {
          await this.finalize(stream, result.decodedPointCount, result.declaredPointCount);
          return this.asTerminalRead(stream)!;
        }
        return { status: "cancelling" };
      }
      if (result.status === "chunk") {
        this.assertActiveSource(stream);
        const firstPointIndex = BigInt(result.firstPointIndex);
        const chunkIndex = BigInt(result.chunkIndex);
        const decodedPointCount = BigInt(result.decodedPointCount);
        if (chunkIndex !== stream.nextChunkIndex
          || firstPointIndex !== stream.nextPointIndex
          || result.declaredPointCount !== stream.metadata.declaredPointCount
          || decodedPointCount !== firstPointIndex + BigInt(result.points.length)
          || result.points.some((point, index) => BigInt(point.pointIndex) !== firstPointIndex + BigInt(index))) {
          throw new Error("Point-cloud chunk sequence or source indices are inconsistent.");
        }
        stream.nextChunkIndex += 1n;
        stream.nextPointIndex = decodedPointCount;
        return result;
      }
      if (result.status === "completed") {
        await this.finalize(stream, result.decodedPointCount, result.declaredPointCount);
        return this.asTerminalRead(stream)!;
      }
      if (result.status === "cancelled") {
        stream.state = "cancelled";
        return result;
      }
      if (result.status === "failed") {
        stream.state = "failed";
        stream.message = result.message;
        return result;
      }
      stream.state = "cancelling";
      return result;
    } catch (error) {
      stream.state = "failed";
      stream.message = error instanceof Error ? error.message : String(error);
      await this.requestCancel(stream);
      return { status: "failed", message: stream.message };
    } finally {
      stream.readPending = false;
    }
  }

  private async finalize(stream: ManagedStream, decodedPointCount: string, declaredPointCount: string): Promise<void> {
    if (decodedPointCount !== declaredPointCount
      || decodedPointCount !== stream.metadata.declaredPointCount
      || BigInt(decodedPointCount) !== stream.nextPointIndex) {
      throw new Error("Point-cloud stream ended before all header-declared points were decoded.");
    }
    await this.verifyFinalSource(stream);
    stream.state = "completed";
  }

  async status(rawStreamId: unknown): Promise<PointCloudChunkStreamStatus> {
    const stream = this.requireStream(rawStreamId);
    await this.expireIfNeeded(stream);
    if (stream.state === "completed") return {
      status: "completed",
      decodedPointCount: stream.nextPointIndex.toString(),
      declaredPointCount: stream.metadata.declaredPointCount,
    };
    if (stream.state === "cancelled") return { status: "cancelled" };
    if (stream.state === "failed") return {
      status: "failed",
      message: stream.message ?? "Point-cloud stream failed; its result is invalid.",
    };
    if (stream.readPending) return this.localStatus(stream);
    try {
      return await this.refreshStatus(stream);
    } catch (error) {
      stream.state = "failed";
      stream.message = error instanceof Error ? error.message : String(error);
      await this.requestCancel(stream);
      return { status: "failed", message: stream.message };
    }
  }

  async cancel(rawStreamId: unknown): Promise<{ accepted: boolean }> {
    const stream = this.requireStream(rawStreamId);
    if (terminal(stream.state)) return { accepted: false };
    const accepted = await this.requestCancel(stream);
    return { accepted };
  }

  /** Called by the trusted host when the active project changes or the app exits. */
  async cancelActiveStreams(): Promise<void> {
    const active = [...this.streams.values()].filter((stream) => !terminal(stream.state));
    await Promise.all(active.map(async (stream) => {
      await this.requestCancel(stream);
    }));
  }
}

function streamState(stream: ManagedStream): StreamState {
  return stream.state;
}
