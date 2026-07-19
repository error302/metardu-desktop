# ADR-0003: ContextBridge with method allowlist (no ipcRenderer passthrough)

**Status:** Accepted
**Date:** 19 Jul 2026
**Supersedes:** None
**Superseded by:** None

## Context

The web app's v1 had 118 IPC handlers, all accepting `input: any`. The
onboarding report (`docs/onboarding-report.md`) flagged this as a
security gap: a malformed payload from the renderer could crash the
privileged main process or execute unintended filesystem operations.

For the desktop pivot we needed to do better.

## Decision

The renderer (`apps/desktop/src/renderer/`) has:
- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- `allowRunningInsecureContent: false`

The preload script (`apps/desktop/src/preload/index.ts`) exposes a
curated `window.metardu` API via `contextBridge.exposeInMainWorld`. The
API has a hardcoded allowlist of sidecar method names:

```typescript
const ALLOWED_METHODS = new Set<string>([
  "ping", "echo", "version", "list_methods",
  "gdal_contour",
  "mavlink_connect", "odm_process", "ml_extract_buildings",
]);
```

Every call validates the method name against this set before forwarding
via `ipcRenderer.invoke`. `ipcRenderer` itself is never exposed.

## Rationale

- **Sandbox by default.** The renderer processes untrusted file contents
  (DXF, GeoJSON, GSI, SDR, RINEX, etc.). A parser bug in the renderer
  must not lead to arbitrary file access.
- **Allowlist, not blocklist.** New IPC methods must be added
  deliberately, with a comment explaining why. This forces an explicit
  security review per method.
- **Method name first, params second.** The sidecar's own Serde
  validators handle params shape; we don't reimplement every zod schema
  in the preload layer. The ipc-schemas package is used by the renderer
  for client-side validation before calling the bridge.

## Alternatives considered

- **Expose ipcRenderer.invoke directly.** Rejected: any renderer bug
  becomes a free path to every IPC handler.
- **Blocklist of dangerous methods.** Rejected: too easy to forget to
  add a new dangerous method to the blocklist.
- **Zod-validate every method in preload.** Rejected: duplicates
  schema work between preload and ipc-schemas. Keep preload thin;
  validate in the renderer (using ipc-schemas) and in the sidecar
  (using Serde).

## Consequences

- Adding a new sidecar method requires updating the preload allowlist.
  This is a feature, not a bug.
- The preload file is small and easy to audit. Keep it that way.
- Renderer code must import the type declaration in
  `apps/desktop/src/renderer/preload.d.ts` to get compile-time
  validation of bridge calls.

## Verification

- `apps/desktop/src/main/index.ts` webPreferences block.
- `apps/desktop/src/preload/index.ts` allowlist + validateMethod().
- `apps/desktop/src/renderer/preload.d.ts` type declarations.
- `packages/ipc-schemas/` zod schemas for client-side validation.
