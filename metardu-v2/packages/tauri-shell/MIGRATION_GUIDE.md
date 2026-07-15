# Tauri 2.x Migration Guide — Phase 3

This guide documents the migration from the Electron shell to Tauri 2.x,
reducing the binary from ~150 MB to <15 MB and eliminating the sidecar
process boundary.

## Overview

The Tauri migration is the Phase 3 deliverable from the upgrade plan.
It replaces the Electron shell while keeping the @metardu/engine TypeScript
package and the Rust sidecar modules (gdal, mavsdk, odm, ml) unchanged.

### Key architectural difference

| Aspect | Electron (Phase 1-2) | Tauri (Phase 3) |
|--------|---------------------|-----------------|
| Shell | Electron 31 (Chromium + Node.js) | Tauri 2.x (system WebView) |
| Binary size | ~150 MB | <15 MB |
| Idle memory | ~350 MB | <120 MB |
| Sidecar | Separate Rust process (stdin/stdout JSON) | Compiled into main binary (direct calls) |
| IPC | contextBridge → ipcMain → sidecar | invoke → Tauri command (direct) |
| Frontend | React 18 (unchanged) | React 18 (unchanged) |
| Engine | @metardu/engine (unchanged) | @metardu/engine (unchanged) |

### What stays the same

- **@metardu/engine** (TypeScript flight planning) — reused verbatim
- **Sidecar modules** (gdal.rs, mavsdk.rs, odm.rs, ml.rs) — reused verbatim
- **React components** — reused verbatim (just change the IPC calls)
- **zod IPC schemas** — reused for Tauri command validation

### What changes

- **Shell**: Electron → Tauri (rewrite main.ts → lib.rs + main.rs)
- **Transport**: stdin/stdout JSON → Tauri `#[command]` direct calls
- **Packaging**: electron-builder → tauri-cli
- **Auto-update**: electron-updater → tauri-plugin-updater
- **Database**: better-sqlite3 → rusqlite

## Step 1: Scaffold the Tauri project

The Tauri shell is at `packages/tauri-shell/`. It contains:

```
packages/tauri-shell/
├── Cargo.toml          # Tauri dependencies
├── tauri.conf.json     # Tauri configuration (window, bundle, updater)
├── build.rs            # Tauri build script
├── src/
│   ├── main.rs         # Entry point (calls lib::run())
│   ├── lib.rs          # App setup + command registration
│   ├── commands/
│   │   └── mod.rs      # 16 Tauri commands (direct function calls)
│   ├── gdal.rs         # Re-export from sidecar
│   ├── mavsdk.rs       # Re-export from sidecar
│   ├── odm.rs          # Re-export from sidecar
│   └── ml.rs           # Re-export from sidecar
└── icons/              # App icons (TODO: create)
```

## Step 2: Add the sidecar as a dependency

In `packages/tauri-shell/Cargo.toml`, add the sidecar as a path dependency:

```toml
[dependencies]
metardu-sidecar-lib = { path = "../metardu-sidecar", default-features = false, features = ["shell-out"] }
```

This compiles the sidecar modules directly into the Tauri binary.

## Step 3: Migrate the frontend

The React frontend stays the same, but the IPC calls change:

### Before (Electron):
```typescript
// preload.ts
contextBridge.exposeInMainWorld("metarduV2", {
  drone: {
    mission: {
      plan: (input) => ipcRenderer.invoke("drone:mission.plan", input),
    },
  },
});

// Component
const result = await window.metarduV2.drone.mission.plan(input);
```

### After (Tauri):
```typescript
// No preload needed — Tauri's @tauri-apps/api provides invoke directly
import { invoke } from "@tauri-apps/api/core";

// Component
const result = await invoke("drone_mission_plan", input);
```

## Step 4: Migrate IPC handlers

Each Electron IPC handler becomes a Tauri command:

### Before (Electron):
```typescript
// ipc.ts
ipcMain.handle("drone:mission.plan", async (event, input) => {
  const validation = validateIpcInput("drone:mission.plan", input);
  if (!validation.success) return { success: false, error: validation.error };
  return { success: true, data: planMission(validation.data) };
});
```

### After (Tauri):
```rust
// commands/mod.rs
#[tauri::command]
pub async fn drone_mission_plan(input: serde_json::Value) -> Result<serde_json::Value, String> {
    // Validate with zod (via the ipc-schemas package compiled to WASM)
    // Or validate in Rust using serde
    let result = plan_mission(input);
    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}
```

## Step 5: Migrate the database

Replace `better-sqlite3` with `rusqlite`:

### Before (Electron):
```typescript
import Database from "better-sqlite3";
const db = new Database("metardu.sqlite");
const rows = db.prepare("SELECT * FROM parcels").all();
```

### After (Tauri):
```rust
use rusqlite::Connection;
let db = Connection::open("metardu.sqlite")?;
let mut stmt = db.prepare("SELECT * FROM parcels")?;
let rows = stmt.query_map([], |row| { ... })?.collect::<Result<Vec<_>, _>>()?;
```

## Step 6: Migrate auto-update

Replace `electron-updater` with `tauri-plugin-updater`:

### Before (Electron):
```typescript
import { autoUpdater } from "electron-updater";
autoUpdater.checkForUpdatesAndNotify();
```

### After (Tauri):
```rust
// In lib.rs
.plugin(tauri_plugin_updater::Builder::new().build())
```

```typescript
// In frontend
import { check } from "@tauri-apps/plugin-updater";
const update = await check();
if (update) await update.downloadAndInstall();
```

## Step 7: Build and test

```bash
cd packages/tauri-shell
cargo tauri build
```

This produces:
- Windows: `.msi` and `.exe` installers
- macOS: `.dmg` (x64 + arm64)
- Linux: `.deb` and `.AppImage`

## Migration checklist

- [ ] Create app icons (32×32, 128×128, 128×128@2x, .icns, .ico)
- [ ] Add `metardu-sidecar-lib` as a path dependency in Cargo.toml
- [ ] Migrate the 118 IPC handlers from Electron to Tauri commands
- [ ] Replace `better-sqlite3` calls with `rusqlite`
- [ ] Replace `electron-updater` with `tauri-plugin-updater`
- [ ] Replace `electron-builder` config with `tauri.conf.json`
- [ ] Update the React frontend to use `@tauri-apps/api` instead of `window.metarduV2`
- [ ] Write a data migration script (better-sqlite3 → rusqlite, with checksum verification)
- [ ] Test all 118 IPC handlers on Tauri
- [ ] Verify auto-update works across a minor version bump
- [ ] Maintain a parallel Electron release branch for rollback

## Risk mitigation

The Tauri migration is the highest-risk item in the upgrade plan. Mitigations:

1. **Parallel Electron branch** — maintain the Electron shell as a fallback
   throughout Phase 3. If Tauri fails to stabilize, ship v2.0 on Electron.

2. **One namespace at a time** — migrate IPC handlers one namespace at a time
   (drone → gcp → pipeline → parcel → traverse), with full E2E coverage
   of each before moving to the next.

3. **Data migration script** — write and test the better-sqlite3 → rusqlite
   migration script on 10 sample databases before the actual migration.

4. **Reality Checker gate** — the Reality Checker agent runs a GO/NO-GO
   gate at the end of Phase 3 before the public v2.0 release.
