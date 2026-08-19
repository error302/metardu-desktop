/**
 * SyncClient integration tests — run against the in-memory mock of the
 * metardu web REST API (scripts/mock-sync-server.mjs) on an ephemeral
 * port. This validates the full offline-first sync lifecycle:
 *
 *   login → fetch → upload (create/update) → queue → flush → sync →
 *   conflict detection → conflict resolution
 *
 * These tests were the first exercise of SyncClient anywhere in the
 * repo — the class was exported but never wired or tested before the
 * Electron sync pipeline work (Tier 1, vision: "Access/Web field data
 * syncs automatically to Desktop").
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startMockSyncServer } from "../../../../scripts/mock-sync-server.mjs";
import { SyncClient, type SyncProject } from "./sync-client.js";

describe("SyncClient against the mock metardu REST server", () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let cfg: { serverUrl: string; email: string; password: string };

  beforeAll(async () => {
    const server = await startMockSyncServer({ port: 0 });
    baseUrl = server.baseUrl;
    close = server.close;
    // cfg must be built AFTER baseUrl is assigned (beforeAll) — building
    // it at module scope would capture serverUrl as undefined.
    cfg = {
      serverUrl: baseUrl,
      email: "field-surveyor@metardu.test",
      password: "hunter2-not-a-real-password",
    };
  });

  afterAll(async () => {
    await close();
  });

  function makeProject(overrides: Partial<SyncProject> = {}): SyncProject {
    return {
      id: "proj-" + Math.random().toString(36).slice(2, 8),
      name: "Kasarani Subdivision",
      description: "Cadastral subdivision, Block 3",
      countryCode: "KE",
      surveyType: "cadastral",
      updatedAt: new Date().toISOString(),
      version: 0,
      data: { beacons: 4, tolerancePassed: true },
      ...overrides,
    };
  }

  it("logs in and flips isLoggedIn", async () => {
    const client = new SyncClient(cfg);
    expect(client.isLoggedIn()).toBe(false);
    await client.login();
    expect(client.isLoggedIn()).toBe(true);
    expect(client.getStatus().state).toBe("idle");
  });

  it("rejects a login against a bad server URL", async () => {
    const client = new SyncClient({ ...cfg, serverUrl: "http://127.0.0.1:1" });
    await expect(client.login()).rejects.toThrow();
    expect(client.isLoggedIn()).toBe(false);
  });

  it("fetches an empty project list after login", async () => {
    const client = new SyncClient(cfg);
    await client.login();
    const projects = await client.fetchProjects();
    expect(projects).toEqual([]);
  });

  it("uploads a project (create) then updates it (version bump via PUT)", async () => {
    const client = new SyncClient(cfg);
    await client.login();

    const created = await client.uploadProject(makeProject());
    expect(created.id).toBeTruthy();
    expect(created.version).toBe(1); // POST → server assigns v1

    const updated = await client.uploadProject({ ...created, name: "Kasarani Subdivision v2", version: created.version });
    expect(updated.version).toBe(2); // PUT → server bumps v1 → v2

    const list = await client.fetchProjects();
    expect(list.some((p) => p.id === created.id && p.name.includes("v2"))).toBe(true);
  });

  it("round-trips a project's planSheet print settings through upload + fetch", async () => {
    // The ProjectStore's per-project print choices (sheet size,
    // orientation, scale mode) ride in the sync payload's data; they must
    // survive a push → fetch round-trip so a surveyor's plan defaults
    // survive sync and are available to the web app.
    const client = new SyncClient(cfg);
    await client.login();

    const created = await client.uploadProject(makeProject({
      data: {
        output: { allBeacons: [] },
        sourceView: "TopographicView",
        planSheet: { sheetSize: "a1", orientation: "portrait", scaleFit: false, scaleDenominator: 500 },
      },
    }));

    const fetched = (await client.fetchProjects()).find((p) => p.id === created.id);
    expect(fetched).toBeDefined();
    expect((fetched!.data as { planSheet?: unknown }).planSheet).toEqual({
      sheetSize: "a1", orientation: "portrait", scaleFit: false, scaleDenominator: 500,
    });
  });

  it("keeps a failed queued change for later retry (offline resilience)", async () => {
    const client = new SyncClient(cfg);
    await client.login();

    // An invalid project (missing id) makes the server reject the POST
    // with 400 — simulating a transient failure the queue must survive.
    const invalid = makeProject({ id: "" });
    client.queueChange(invalid, "create");
    expect(client.getStatus().pendingUploads).toBe(1);

    // flushQueue swallows per-item errors and keeps the item queued
    // (attempts < 5) for a later retry.
    const result = await client.flushQueue();
    expect(result.uploaded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(client.getStatus().pendingUploads).toBe(1); // retried later

    // A valid change on a FRESH client flushes cleanly. (Re-flushing on
    // the same client would still carry the failed item — it survives
    // until attempts reach 5 — so its failed count would be 1.)
    const fresh = new SyncClient(cfg);
    await fresh.login();
    fresh.queueChange(makeProject(), "create");
    const ok = await fresh.flushQueue();
    expect(ok.uploaded).toBe(1);
    expect(ok.failed).toBe(0);
    expect(fresh.getStatus().pendingUploads).toBe(0);
  });

  it("detects conflicts on version divergence and resolves them", async () => {
    // Manual conflict strategy: the default (last_write_wins) auto-clears
    // conflicts inside sync(), which would hide the detection.
    const client = new SyncClient({ ...cfg, conflictStrategy: "manual" });
    await client.login();

    // Seed the server with a v2 project.
    const remote = await client.uploadProject(makeProject());
    const remoteV2 = await client.uploadProject({ ...remote, version: remote.version });
    expect(remoteV2.version).toBe(2);

    // Local copy still at v1 but touched more recently → conflict.
    const localStale = { ...remote, version: 1, updatedAt: new Date(Date.now() + 60_000).toISOString() };

    const result = await client.sync([localStale]);
    expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
    const conflict = client.getConflicts()[0];
    expect(conflict?.projectId).toBe(remote.id);
    expect(conflict?.localValue).toBe(1);
    expect(conflict?.remoteValue).toBe(2);

    client.resolveConflict(remote.id, "remote");
    expect(client.getConflicts().some((c) => c.projectId === remote.id)).toBe(false);
  });

  it("sync downloads remote-only projects the local side lacks", async () => {
    const client = new SyncClient(cfg);
    await client.login();

    await client.uploadProject(makeProject());
    const result = await client.sync([]); // local side empty
    expect(result.downloaded).toBeGreaterThanOrEqual(1);
    expect(result.errors).toEqual([]);
  });

  it("deletes a project remotely", async () => {
    const client = new SyncClient(cfg);
    await client.login();

    const p = await client.uploadProject(makeProject());
    await client.deleteProject(p.id);
    const list = await client.fetchProjects();
    expect(list.some((x) => x.id === p.id)).toBe(false);
  });

  it("queues an offline-first tombstone for a pushed project and flushes it", async () => {
    const client = new SyncClient(cfg);
    await client.login();

    // Push a project so the client knows it exists remotely, then delete
    // it locally via queueDelete — the remote copy must be tombstoned.
    const p = await client.uploadProject(makeProject());
    expect(client.queueDelete(p.id)).toBe(true);
    // A queued delete is a tombstone, not an upload: pendingUploads stays
    // 0 and the delete is surfaced distinctly as pendingDeletes (which
    // drives the shell badge's '· N del' segment).
    expect(client.getStatus().pendingUploads).toBe(0);
    expect(client.getStatus().pendingDeletes).toBe(1);

    const flush = await client.flushQueue();
    expect(flush.deleted).toBe(1); // a flushed tombstone is a deletion
    expect(flush.uploaded).toBe(0);
    expect(flush.failed).toBe(0);
    expect(client.getStatus().pendingUploads).toBe(0);
    expect(client.getStatus().pendingDeletes).toBe(0);

    const list = await client.fetchProjects();
    expect(list.some((x) => x.id === p.id)).toBe(false);
  });

  it("refuses to queue a delete for a project never seen on the server", async () => {
    const client = new SyncClient(cfg);
    await client.login();

    // A project that was only ever local (never pushed) must NOT get a
    // tombstone — flushing a delete for it would 404 against a real
    // backend and spin in the retry loop.
    expect(client.queueDelete("never-pushed-project")).toBe(false);
    expect(client.getStatus().pendingUploads).toBe(0);
    expect(client.getStatus().pendingDeletes).toBe(0);

    const flush = await client.flushQueue();
    expect(flush.uploaded).toBe(0);
    expect(flush.failed).toBe(0);
  });

  it("learns remote ids from fetchProjects so pulled projects can be tombstoned", async () => {
    // Seed the server with a project "synced in a previous session", then
    // a FRESH client logs in and pulls it — its local delete must
    // tombstone the remote copy even though this client never pushed it.
    // (The mock stores projects per-token, so the seed is the only way a
    // fresh client can see a pre-existing project.)
    const seeded = await startMockSyncServer({ port: 0, seedProjects: [makeProject({ id: "seeded-proj-1" })] });
    try {
      const client = new SyncClient({ ...cfg, serverUrl: seeded.baseUrl });
      await client.login();
      const list = await client.fetchProjects();
      expect(list.some((x) => x.id === "seeded-proj-1")).toBe(true);

      expect(client.queueDelete("seeded-proj-1")).toBe(true);
      const flush = await client.flushQueue();
      expect(flush.failed).toBe(0);
      expect((await client.fetchProjects()).some((x) => x.id === "seeded-proj-1")).toBe(false);
    } finally {
      await seeded.close();
    }
  });

  it("force-queues a tombstone when offline (can't verify) and flushes idempotently", async () => {
    const client = new SyncClient(cfg);
    await client.login();

    // Offline path: the main handler can't fetch to verify, so it queues
    // with force. The project may never have been pushed — the server
    // 404s, which the engine treats as an idempotent success, so the
    // flush completes instead of spinning on retries.
    expect(client.queueDelete("offline-deleted-proj", true)).toBe(true);
    expect(client.getStatus().pendingUploads).toBe(0); // tombstone, not upload
    expect(client.getStatus().pendingDeletes).toBe(1);

    const flush = await client.flushQueue();
    expect(flush.deleted).toBe(1); // 404 counted as an idempotent deletion
    expect(flush.uploaded).toBe(0);
    expect(flush.failed).toBe(0);
    expect(client.getStatus().pendingUploads).toBe(0);
    expect(client.getStatus().pendingDeletes).toBe(0);
  });

  it("treats deleting a missing remote project as an idempotent success", async () => {
    const client = new SyncClient(cfg);
    await client.login();
    // Never pushed — the mock returns 404; the engine must not throw.
    await expect(client.deleteProject("never-existed")).resolves.toBeUndefined();
  });

  it("round-trips queued changes + remote ids through a snapshot (restart survival)", async () => {
    // Session 1: push a project (remote id learned), queue a tombstone
    // and a queued create, then "app quits" — we keep only the snapshot.
    const first = new SyncClient(cfg);
    await first.login();
    const p = await first.uploadProject(makeProject());
    expect(first.queueDelete(p.id)).toBe(true); // tombstone
    first.queueChange(makeProject(), "create");
    expect(first.getStatus().pendingDeletes).toBe(1);
    expect(first.getStatus().pendingUploads).toBe(1);
    const snapshot = first.getSnapshot();

    // Session 2 (simulating an app restart + same-account re-login): a
    // brand-new client restores the snapshot — queued tombstones and
    // changes must survive, and remote-id knowledge must too.
    const second = new SyncClient(cfg);
    await second.login();
    expect(second.restoreSnapshot(snapshot)).toBe(true);
    expect(second.getStatus().pendingDeletes).toBe(1);
    expect(second.getStatus().pendingUploads).toBe(1);
    // remoteIds survived: the tombstone is queued without a fetch.
    expect(second.queueDelete(p.id)).toBe(true); // already queued — no-op? no: adds a 2nd delete
    expect(second.getStatus().pendingDeletes).toBe(2);

    // Flushing works after restore: the delete is idempotent, the create uploads.
    const flush = await second.flushQueue();
    expect(flush.uploaded).toBe(1);
    expect(flush.deleted).toBe(2);
    expect(flush.failed).toBe(0);
    expect(second.getStatus().pendingDeletes).toBe(0);
    expect(second.getStatus().pendingUploads).toBe(0);
  });

  it("refuses to restore a snapshot belonging to a different account", async () => {
    const first = new SyncClient(cfg);
    await first.login();
    first.queueChange(makeProject(), "create");
    const snapshot = first.getSnapshot();

    const other = new SyncClient({ ...cfg, email: "someone-else@metardu.test" });
    await other.login();
    // Different email — must NOT restore, or this account would flush
    // the other user's changes to its own server after a crash.
    expect(other.restoreSnapshot(snapshot)).toBe(false);
    expect(other.getStatus().pendingUploads).toBe(0);
    expect(other.getStatus().pendingDeletes).toBe(0);
  });

  it("throws when calling sync without logging in", async () => {
    const client = new SyncClient(cfg);
    await expect(client.sync([])).rejects.toThrow(/not logged in/i);
  });
});
