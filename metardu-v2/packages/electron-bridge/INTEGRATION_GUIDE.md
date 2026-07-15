# Electron Integration Guide — Wiring v2.0 into metardu-desktop

This guide walks through the exact changes needed to integrate the v2.0
packages into the existing metardu-desktop Electron app (v1.0).

## Overview

The integration adds 3 things to the existing app:

1. **Sidecar lifecycle** — spawn the Rust sidecar on app startup
2. **IPC handlers** — 11 new handlers with zod validation
3. **Renderer API** — `window.metarduV2` exposed via contextBridge

The existing v1.0 handlers continue to work — v2.0 is additive.

## Step 1: Copy the bridge files

Copy these files from `packages/electron-bridge/src/` into `apps/desktop/electron/`:

```
packages/electron-bridge/src/main/sidecar-manager.ts  →  apps/desktop/electron/sidecar-manager.ts
packages/electron-bridge/src/handlers/v2-handlers.ts   →  apps/desktop/electron/v2-handlers.ts
packages/electron-bridge/src/preload/v2-preload.ts     →  apps/desktop/electron/v2-preload.ts
packages/electron-bridge/src/replacements/drone-imagery-v2.ts  →  apps/desktop/electron/drone-imagery-v2.ts
```

## Step 2: Modify main.ts

Add sidecar startup to `apps/desktop/electron/main.ts`:

```typescript
// At the top, after existing imports:
import { startSidecar, stopSidecar } from "./sidecar-manager.js";

// In app.whenReady():
app.whenReady().then(async () => {
  // Start the v2.0 sidecar before creating the window
  await startSidecar();

  // Existing window creation code...
  createWindow();
});

// In app.on("before-quit"):
app.on("before-quit", async (event) => {
  event.preventDefault();
  await stopSidecar();
  app.exit(0);
});
```

## Step 3: Modify ipc.ts

Register the v2.0 handlers in `apps/desktop/electron/ipc.ts`:

```typescript
// At the bottom of the file, after existing handler registrations:
import { registerV2Handlers } from "./v2-handlers.js";
registerV2Handlers();
```

## Step 4: Modify preload.ts

Expose the v2.0 API in `apps/desktop/electron/preload.ts`:

```typescript
// At the bottom, after existing contextBridge.exposeInMainWorld calls:
import { exposeV2Api } from "./v2-preload.js";
exposeV2Api();
```

## Step 5: Replace drone-imagery.ts (optional)

The v1.0 `drone-imagery.ts` has placeholder functions. To replace them with
real implementations:

1. Rename `drone-imagery.ts` to `drone-imagery-v1-backup.ts`
2. Rename `drone-imagery-v2.ts` to `drone-imagery.ts`
3. Update any imports that reference the old function signatures

The v2.0 file exports the same function names where possible, but with
real implementations instead of placeholders.

## Step 6: Add workspace dependencies

In `apps/desktop/package.json`, add:

```json
{
  "dependencies": {
    "@metardu/electron-integration": "workspace:*",
    "@metardu/engine-flight-planning": "workspace:*",
    "@metardu/ipc-schemas": "workspace:*",
    "@metardu/electron-bridge": "workspace:*"
  }
}
```

And in the root `package.json`, add the workspace packages:

```json
{
  "workspaces": [
    "apps/desktop",
    "packages/metardu-sidecar",
    "packages/engine",
    "packages/ipc-schemas",
    "packages/report-pdf",
    "packages/electron-integration",
    "packages/electron-bridge",
    "packages/e2e-tests"
  ]
}
```

## Step 7: Bundle the sidecar binary

In `apps/desktop/electron-builder.yml`, add the sidecar binary to the
`extraResources`:

```yaml
extraResources:
  - from: ../packages/metardu-sidecar/target/release/metardu-sidecar
    to: metardu-sidecar
    filter: ["**/*"]
```

This ensures the sidecar binary is bundled with the app installer.

## Step 8: Use the v2.0 API in the renderer

In any React component:

```typescript
// Check if the sidecar is running
const status = await window.metarduV2.system.sidecar.status();
console.log("Sidecar:", status);

// Plan a mission
const result = await window.metarduV2.drone.mission.plan({
  cameraId: "dji-mavic-3-enterprise",
  altitudeM: 75,
  frontOverlap: 0.75,
  sideOverlap: 0.65,
  area: {
    coordinates: [
      { lat: -1.2864, lng: 36.8172 },
      { lat: -1.2774, lng: 36.8172 },
      { lat: -1.2774, lng: 36.8227 },
      { lat: -1.2864, lng: 36.8227 },
      { lat: -1.2864, lng: 36.8172 },
    ],
  },
});

if (result.success) {
  console.log("Waypoints:", result.data.waypoints.length);
  console.log("GSD:", result.data.params.gsdCmPx, "cm/px");
  console.log("Batteries:", result.data.battery.batteryCount);
}
```

## What changes for the user

| Feature | v1.0 | v2.0 |
|---------|-------|------|
| Flight planning | Not available | Full lawnmower generation, 5 export formats |
| Contour generation | Returns synthetic circles | Real GDAL contours from GeoTIFF |
| Feature extraction | Returns 10 hardcoded squares | ONNX ML model (building/road extraction) |
| Photogrammetry | External WebODM server only | In-app ODM (Docker or native) |
| Live drone telemetry | Not available | MAVSDK-Rust live telemetry + mission upload |
| IPC validation | `input: any` (no validation) | zod schema per channel (strict) |
| Battery estimation | Not available | Full estimation with swap points |

## Fallback behavior

If the sidecar fails to start (e.g., binary not found, crash), the app
continues to work with reduced functionality:

- ✅ Flight planning (uses TypeScript engine directly)
- ✅ Mission export (TypeScript)
- ✅ Report generation (TypeScript)
- ❌ Contour generation (requires sidecar + GDAL)
- ❌ Feature extraction (requires sidecar + ONNX)
- ❌ Photogrammetry (requires sidecar + ODM)
- ❌ Live drone telemetry (requires sidecar + MAVSDK)

The renderer can check `window.metarduV2.system.sidecar.status()` to
determine which features are available.
