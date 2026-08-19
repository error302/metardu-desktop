/**
 * Mock Metardu Web REST server — in-memory stand-in for the metardu web
 * API that SyncClient talks to. Used by:
 *
 *   1. packages/engine/src/sync/sync-client.test.ts (integration test on
 *      an ephemeral port), and
 *   2. `node scripts/mock-sync-server.mjs` (manual smoke run).
 *
 * Endpoints implemented (mirrors SyncClient's expectations):
 *   POST   /api/auth/callback            → { token }   (any email/password)
 *   GET    /api/projects                 → SyncProject[]
 *   POST   /api/projects                 → created SyncProject (version bump)
 *   PUT    /api/projects/:id             → updated SyncProject (version bump)
 *   DELETE /api/projects/:id             → { ok: true }
 *
 * Storage is per-token in memory; it resets when the process exits.
 * No dependencies — stdlib http only.
 */

import { createServer } from "node:http";

export function startMockSyncServer({ port = 0, seedProjects = [] } = {}) {
  const projectsByToken = new Map(); // token → Map<id, SyncProject>
  const tokens = new Set();

  function parseJson(body) {
    try {
      return body ? JSON.parse(body) : {};
    } catch {
      return {};
    }
  }

  function send(res, status, payload) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  }

  function auth(req) {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Bearer ")) return null;
    const token = header.slice(7);
    return tokens.has(token) ? token : null;
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const payload = parseJson(body);

      // ─── Auth callback ──────────────────────────────────────────
      if (url.pathname === "/api/auth/callback" && method === "POST") {
        const token = `mock-token-${tokens.size + 1}`;
        tokens.add(token);
        const store = new Map();
        // Seed the FIRST account's store with pre-existing projects —
        // simulates projects synced in a previous session that a fresh
        // client pulls on login (used by the queueDelete tests).
        if (tokens.size === 1) {
          for (const p of seedProjects) {
            if (p && p.id) store.set(p.id, { ...p, version: p.version ?? 1 });
          }
        }
        projectsByToken.set(token, store);
        return send(res, 200, { token });
      }

      const token = auth(req);
      if (!token) return send(res, 401, { error: "unauthorized" });
      const store = projectsByToken.get(token);

      // ─── Projects collection ────────────────────────────────────
      if (url.pathname === "/api/projects" && method === "GET") {
        return send(res, 200, [...store.values()]);
      }
      if (url.pathname === "/api/projects" && method === "POST") {
        const project = payload;
        if (!project.id) return send(res, 400, { error: "project.id required" });
        // SyncClient sends version+1 in the body (0 → 1 on create). The
        // server stores the client-provided version — same contract as
        // the real metardu web API.
        const stored = { ...project, version: project.version ?? 1, updatedAt: new Date().toISOString() };
        store.set(project.id, stored);
        return send(res, 201, stored);
      }

      // ─── Single project ─────────────────────────────────────────
      const match = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        if (method === "PUT") {
          const existing = store.get(id);
          if (!existing) return send(res, 404, { error: "not found" });
          // SyncClient bumps version in the body (1 → 2 on update); the
          // server stores it. Also accept a legacy fallback that keeps
          // the server-side bump if the client sent no version.
          const version = typeof payload.version === "number" ? payload.version : existing.version + 1;
          const stored = { ...existing, ...payload, id, version, updatedAt: new Date().toISOString() };
          store.set(id, stored);
          return send(res, 200, stored);
        }
        if (method === "DELETE") {
          // Real-backend semantics: deleting a missing project is a 404.
          // SyncClient treats 404 as an idempotent success, so forced
          // (offline) tombstones for never-pushed projects flush cleanly.
          if (!store.has(id)) return send(res, 404, { error: "not found" });
          store.delete(id);
          return send(res, 200, { ok: true });
        }
        if (method === "GET") {
          const p = store.get(id);
          return p ? send(res, 200, p) : send(res, 404, { error: "not found" });
        }
      }

      return send(res, 404, { error: `no route: ${method} ${url.pathname}` });
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        port: actualPort,
        baseUrl: `http://127.0.0.1:${actualPort}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// Manual smoke run: `node scripts/mock-sync-server.mjs [port]`
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  const port = Number(process.argv[2] ?? 8787);
  const { baseUrl } = await startMockSyncServer({ port });
  console.log(`[mock-sync-server] listening on ${baseUrl}`);
  console.log(`  POST   ${baseUrl}/api/auth/callback`);
  console.log(`  GET    ${baseUrl}/api/projects`);
  console.log(`  POST   ${baseUrl}/api/projects`);
  console.log(`  PUT    ${baseUrl}/api/projects/:id`);
  console.log(`  DELETE ${baseUrl}/api/projects/:id`);
}
