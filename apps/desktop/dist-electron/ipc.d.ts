/**
 * IPC handler registry.
 *
 * Per ADR-004: all renderer→main communication goes through contextBridge IPC.
 * Channels follow the naming convention: <namespace>:<verb>
 *
 *   db:query       — read-only SQL query
 *   db:execute     — write SQL statement
 *   fs:newProject  — create a new .metardu file
 *   fs:openProject — open an existing .metardu file
 *   fs:importCsv   — parse CSV file → insert as points
 *   app:version    — return app version
 *   app:platform   — return process.platform
 *
 * Security: every handler validates its arguments. No raw SQL from renderer
 * for fs:* handlers; only db:query and db:execute accept SQL (and they
 * will be tightened to a safe subset in v1.0).
 */
import { MetarduDatabase } from './database.js';
type DbGetter = () => MetarduDatabase | null;
type DbSetter = (db: MetarduDatabase | null) => void;
export declare function registerIpcHandlers(getDb: DbGetter, setDb: DbSetter): void;
export {};
//# sourceMappingURL=ipc.d.ts.map