# Tier 1 #3 — Instrument Data Import

**Task ID:** tier1-instrument-import
**Agent:** Main (session 2026-07-25)
**Pace:** One task per turn
**Scope:** ONE PR — wire the existing TS parser through to a usable UI, and add the Rust sidecar parser for RINEX epoch data (the one piece the TS parser deliberately stubs).

## Problem

The engine has a complete TS parser (`packages/engine/src/import/instrument-import.ts`, 317 lines) for Leica GSI, Sokkia SDR, Trimble DC/JOB, and RINEX header — but it is unreachable from the desktop UI:

1. **No IPC channel** — `metardu:import:*` does not exist in `apps/desktop/src/main/index.ts:registerIpcHandlers()`.
2. **No preload bridge** — `window.metardu.import` is not exposed in `apps/desktop/src/preload/index.ts:metarduApi`.
3. **No view** — there is no `ImportPanel.tsx`; the user has no way to pick an instrument file from disk.
4. **RINEX epoch data is stubbed** — `instrument-import.ts:298` explicitly warns: *"Full epoch-by-epoch GNSS processing requires the sidecar's Rust import module."* The sidecar has no `import.*` handlers (verified: `dispatcher.rs::register_builtins` ends at `adjustment.run`).

## Goal

A surveyor can:

1. Open the desktop app → press `g i` → land on the **Import** panel.
2. Click **Pick instrument file** → OS file picker opens with filters for `.gsi`, `.sdr`, `.dc`, `.job`, `.rinex`, `.obs`.
3. File is read by the main process, content passed to `importFieldData(filename, content)`.
4. Observations render in a table (pointId, type, coordinates, codes) with a warnings/errors panel.
5. (Phase 2) For RINEX files, the main process invokes the sidecar's new `import.rinex_epochs` handler to parse epoch records; the result is merged into the `ImportResult`.

## Non-Goals (deferred)

- Sidecar parsers for GSI/SDR/DC — the TS parser is adequate for these text formats. Sidecar is only needed for RINEX epoch-by-epoch (large files, binary variants).
- Persisting imported observations to a project database — that's a later task.
- Inverse of import (export back to instrument format) — out of scope.
- Live streaming from instruments over Bluetooth/serial — out of scope.

## Invariants (from AGENT.md)

- **§A1 (ADR-0005)** Heavy math lives in the sidecar (Rust). The TS engine orchestrates. → RINEX epoch parsing lives in the Rust sidecar.
- **§7** No guessing at regulatory formats. → Instrument formats are vendor-published: Leica GSI8/GSI16 (Leica Geo Office docs), Sokkia SDR (SDR Mapping Systems manual), Trimble DC/JOB (Trimble Business Center import docs), RINEX 3.04 (https://files.igs.org/pub/data/format/rinex304.pdf). The existing TS parser already encodes these — we trust the existing implementation and the test fixtures.
- **§10** One task = one scoped brief = one PR.
- **§4** Verification must paste verbatim terminal output into the worklog.

## Architecture Decision

Follow the established injected-callback pattern (same as `projectToWgs84` in `integration/types.ts:149-153`):

```ts
// engine: importFieldData gains an optional async callback
export async function importFieldDataAsync(
  filename: string,
  content: string,
  options?: {
    parseRinexEpochs?: (content: string) => Promise<RinexEpochResult>;
  },
): Promise<ImportResult>;
```

- If `options.parseRinexEpochs` is absent → fall back to the TS header-only parse (existing behaviour, emits the warning).
- If present → call it after the TS header parse; merge epoch observations into `ImportResult.observations`.
- The main process wires this callback to `sidecar.call("import.rinex_epochs", { content })`.

## Implementation Plan (ordered)

### Step 1 — Rust sidecar: `import` module

**Files to create:**

- `packages/metardu-sidecar/src/import/mod.rs` — re-exports + `ImportResult`/`RinexEpoch`/`RinexEpochResult` serde structs (mirror the TS `FieldObservation` shape so the JS side can merge without remapping).
- `packages/metardu-sidecar/src/import/rinex.rs` — `parse_rinex_epochs(content: &str) -> anyhow::Result<RinexEpochResult>` plus the async `handle_rinex_epochs(params: Value) -> Result<Value, HandlerError>` wrapper. Parses the body of a RINEX 3.04 observation file (skips header on `END OF HEADER`, then reads `> EPOCH` records and the following obs lines).

**Files to modify:**

- `packages/metardu-sidecar/src/main.rs:18` — add `mod import;` (alphabetical: after `gdal`, before `geodesy`).
- `packages/metardu-sidecar/src/dispatcher.rs:243` — register:
  ```rust
  self.register("import.rinex_epochs", |params: Value| async move {
      crate::import::handle_rinex_epochs(params).await
  });
  ```

**Tests:** inline `#[cfg(test)] mod tests` in `rinex.rs` with a small RINEX 3.04 fixture (header + 2 epochs, 4 obs types).

### Step 2 — Engine: async variant + types

**Files to modify:**

- `packages/engine/src/import/instrument-import.ts`:
  - Add `RinexEpoch` and `RinexEpochResult` interfaces (mirror sidecar shapes).
  - Add `importFieldDataAsync(filename, content, options?)` — async variant of `importFieldData`. If `options?.parseRinexEpochs` is provided AND format is detected as RINEX, the callback is awaited and epoch observations are appended; warnings and pointCount are updated; the "requires the sidecar" warning is replaced with `"Parsed N epoch records via sidecar."`.
  - Existing `importFieldData` and the four format-specific parsers stay unchanged (existing tests stay green).
- `packages/engine/src/import/tests/instrument-import.test.ts`:
  - Add a `describe("importFieldDataAsync — sidecar bridge")` block mirroring `integration/tests/gcp-export.test.ts:666-735` covering the three modes: callback-provided-success, callback-absent-fallback, callback-throws-with-warning-surfaced.
- `packages/engine/src/index.ts:243-252` — add `importFieldDataAsync`, `RinexEpoch`, `RinexEpochResult` to the re-export block.

### Step 3 — Electron main: IPC handler

**File to modify:** `apps/desktop/src/main/index.ts:registerIpcHandlers()` (after the `metardu:export:survey` block at line 298).

Add:
```ts
ipcMain.handle("metardu:import:pickAndRead", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "Import instrument data",
    properties: ["openFile"],
    filters: [
      { name: "Instrument files", extensions: ["gsi", "sdr", "dc", "job", "rinex", "obs", "txt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, filename: "", content: "" };
  }
  const filePath = result.filePaths[0]!;
  const content = fs.readFileSync(filePath, "utf-8");
  const filename = path.basename(filePath);
  return { canceled: false, filename, content };
});

ipcMain.handle("metardu:import:fieldData", async (_event, filename: string, content: string) => {
  // Wire the sidecar bridge for RINEX epoch parsing.
  const parseRinexEpochs = (sidecar && sidecar.isRunning())
    ? async (rinexContent: string) => {
        return sidecar!.call<RinexEpochResult>("import.rinex_epochs", { content: rinexContent });
      }
    : undefined;
  return importFieldDataAsync(filename, content, { parseRinexEpochs });
});
```

### Step 4 — Preload bridge

**File to modify:** `apps/desktop/src/preload/index.ts:metarduApi` (after the `export` block at line 85).

Add an `import` namespace mirroring `export`:
```ts
import: {
  pickAndRead: (): Promise<{ canceled: boolean; filename: string; content: string }> =>
    ipcRenderer.invoke("metardu:import:pickAndRead"),
  fieldData: async (filename: string, content: string): Promise<ImportResult> =>
    ipcRenderer.invoke("metardu:import:fieldData", filename, content),
},
```

The `MetarduApi` type flows forward automatically (`preload.d.ts` uses `typeof metarduApi`).

### Step 5 — ImportPanel view

**File to create:** `apps/desktop/src/renderer/views/ImportPanel.tsx`

Mirror `ExportPanel.tsx` structure:
- Named export `ImportPanel` (matches `main.tsx` lazy registration pattern).
- Defensive `window as unknown as { metardu?: { import?: {...} } }` cast (so it works in browser mode during dev).
- "Pick instrument file" button → `window.metardu.import.pickAndRead()` → calls `window.metardu.import.fieldData(filename, content)` → renders observations table + warnings/errors panels.
- A "Supported formats" grid (GSI/SDR/JOB/RINEX) mirroring `ExportPanel`'s format grid.

### Step 6 — Navigation registration

**Files to modify:**

- `packages/ui-components/src/panels/AppShell.tsx`:
  - `ViewId` (line 50-54): add `"import"`.
  - `NAV` (line 64-86): add `{ id: "import", label: "Import", icon: Upload, category: "Field Work", shortcut: "g i" }` (import `Upload` from lucide-react at line 1-21).
  - Shortcut map (line 169-175): add `i: "import"`.
- `apps/desktop/src/renderer/main.tsx`:
  - Add `const ImportPanel = lazy(() => import("./views/ImportPanel.js").then(m => ({ default: m.ImportPanel })));` near line 55.
  - Add `case "import": return <ImportPanel />;` to the `renderView` switch at line 70-80.

## Verification Commands

```powershell
# 1. Rust sidecar — cargo test
cd metardu-v2\packages\metardu-sidecar; cargo test --no-run; cargo test

# 2. Country-config + engine tsc + tests (existing bar)
cd metardu-v2\packages\country-config; npm run build
cd metardu-v2\packages\engine; npx tsc --noEmit
cd metardu-v2\packages\engine; npx vitest run src/import/tests/instrument-import.test.ts

# 3. Desktop tsc + lint
cd metardu-v2\apps\desktop; npx tsc --noEmit

# 4. Desktop renderer build (catches preload/main type drift)
cd metardu-v2\apps\desktop; npm run build:renderer
```

## Exit Criteria

- [ ] `cargo test` in `metardu-sidecar` passes (incl. new `import::rinex` tests).
- [ ] `npx tsc --noEmit` in `packages/engine` — 0 errors.
- [ ] `npx vitest run src/import/tests/instrument-import.test.ts` — all existing + new tests pass.
- [ ] `npx tsc --noEmit` in `apps/desktop` — 0 errors.
- [ ] `g i` keyboard shortcut + sidebar entry show the Import panel.
- [ ] Picking a `.gsi` fixture yields a populated observations table.
- [ ] Picking a `.rinex` fixture invokes the sidecar and surfaces epoch observations (when sidecar running) or falls back to header-only with a warning (when not).
- [ ] Worklog entry appended with verbatim verification output.
