/**
 * METARDU Desktop — Electron Main Process
 *
 * This is the trust boundary. Only the main process can:
 *   - Touch the filesystem
 *   - Open the SQLite database
 *   - Spawn the Python RINEX worker
 *   - Access the serial port (total station) / BLE (GNSS rover)
 *   - Make network requests (auto-update, basemap tiles)
 *
 * The renderer is sandboxed and talks to main exclusively via contextBridge
 * IPC handlers exposed in preload.ts.
 *
 * Phase 2 walking skeleton:
 *   - Open a BrowserWindow with React + OpenLayers
 *   - Register IPC handlers for:
 *       db:query      — run a SQL query against the project SQLite
 *       db:execute    — run a SQL statement (insert/update/delete)
 *       fs:openProject — open a .metardu (SQLite) file
 *       fs:importCsv  — parse a CSV of survey points, insert into DB
 *       app:version   — return app version
 */
export {};
//# sourceMappingURL=main.d.ts.map