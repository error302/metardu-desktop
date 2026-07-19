# ADR-0002: Length-prefixed JSON over stdio as the sidecar IPC protocol

**Status:** Accepted
**Date:** 19 Jul 2026 (formalized; protocol predates this ADR)
**Supersedes:** None
**Superseded by:** None

## Context

The sidecar (Rust) and the engine/main (TypeScript/Node) need a wire
protocol. Options considered:
- gRPC over a local socket
- JSON-RPC over a Unix domain socket
- Length-prefixed JSON over stdio (chosen)
- MessagePack over stdio
- Cap'n Proto

## Decision

Use **4-byte big-endian length prefix + UTF-8 JSON payload** over the
sidecar's stdin (requests) and stdout (responses). Logs go to stderr.

Wire format for a request:
```
[4 bytes BE length][N bytes UTF-8 JSON]
```

JSON shape:
```json
{
  "id": "uuid-v4-string",
  "method": "ping",
  "params": null
}
```

Response:
```json
{
  "id": "same-uuid",
  "ok": true,
  "result": { ... }
}
```

Error:
```json
{
  "id": "same-uuid",
  "ok": false,
  "error": { "code": "MethodNotFound", "message": "..." }
}
```

## Rationale

- **No port conflicts.** Stdio is always available, no firewall issues,
  no socket cleanup on crash.
- **No serialization library mismatch.** JSON is built into both
  `serde_json` (Rust) and Node. Schema drift is caught by the
  zod-validated preload layer on the TypeScript side and Serde on the
  Rust side.
- **Trivial to debug.** Pipe a captured stream through `python3 -c
  "import sys, struct; ..."` and you can read every message.
- **Works the same in dev and packaged.** No localhost HTTP server to
  start, no socket file to clean up.

## Alternatives considered

- **gRPC.** Rejected: protobuf schema sync overhead, harder to debug,
  more dependencies, marginal performance benefit for our message
  volume (we're not streaming video).
- **JSON-RPC over UDS.** Rejected: socket file lifecycle is annoying
  on crash, and we don't need bidirectional streaming (yet).
- **MessagePack.** Rejected: smaller wire size but JSON's debuggability
  wins. Our messages are small.
- **Cap'n Proto.** Rejected: schema evolution story is great but the
  build complexity isn't worth it at this scale.

## Consequences

- Messages are length-capped at 16 MiB (set in `protocol.rs`).
  Anything bigger (e.g. a large GeoTIFF) goes via file path, not inline.
- The protocol is request/response only. For push events (e.g. live
  GNSS position updates) we'll need an extension — likely a "subscribe"
  method that streams multiple response frames for one request. Future
  ADR.
- All messages are valid UTF-8. Binary payloads must be base64-encoded
  (rare; we prefer file paths for big binaries).

## Verification

- `packages/metardu-sidecar/src/protocol.rs` — Rust read/write impl.
- `packages/electron-integration/src/index.ts` — Node read/write impl.
- Both have round-trip tests (Rust unit tests + TS vitest).
- `packages/electron-integration/src/tests/index.test.ts` exercises
  real ping/echo/version/list_methods calls against the built binary.
