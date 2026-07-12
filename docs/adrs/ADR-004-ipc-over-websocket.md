# ADR-004 — IPC Over WebSocket Collaboration

**Status:** Accepted
**Date:** 2025-07-11
**Decision Maker:** Software Architect agent
**Phase:** 0 (Initiation)

## Context

METARDU has a WebSocket collaboration server for multi-user editing. Desktop
apps are single-user by default. We need a clean communication model between
the Electron main process (which owns the database, filesystem, serial port)
and the renderer (which runs the React UI).

## Decision

**Drop the WebSocket server entirely. Use Electron IPC via contextBridge.**

The Python RINEX worker runs as a child process spawned by the main process
and communicates via stdin/stdout JSON lines.

## Consequences

**Positive:**
- Simpler security model (no open ports, no auth tokens).
- No need for Redis, Postgres LISTEN/NOTIFY, or WebSocket server.
- Single-process trust boundary — only the main process can touch the
  filesystem or network.
- Faster — no network round-trip for IPC.

**Negative:**
- Multi-user collaboration is deferred to v2.
- The Python RINEX worker is a separate child process, so we need to handle
  its lifecycle (crash, restart, timeout) carefully.

**IPC Channel Naming Convention:**

| Prefix | Direction | Purpose |
|--------|-----------|---------|
| `db:*` | renderer → main | Database queries (read/write) |
| `fs:*` | renderer → main | Filesystem access (CSV, DXF import/export) |
| `serial:*` | renderer → main | Total station / GNSS serial port |
| `worker:*` | renderer → main | Spawn Python RINEX worker |
| `app:*` | main → renderer | App events (project opened, etc.) |
| `update:*` | main → renderer | Auto-update events |

**Security Rule:** Every IPC handler must validate its arguments with a
JSON schema before executing. The preload script exposes a minimal surface
via `contextBridge.exposeInMainWorld('metardu', { ... })`.

## Alternatives Considered

- **Keep WebSocket server on localhost**: Rejected as premature complexity.
  We can re-add it in v2 if multi-window sync becomes a real need.
- **Tauri's command system**: Rejected because we chose Electron in ADR-001.

## References

- METARDU Desktop Master Plan §5
- Electron contextBridge: https://www.electronjs.org/docs/latest/api/context-bridge
