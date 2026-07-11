"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
const fs = __importStar(require("node:fs"));
const main_1 = __importDefault(require("electron-log/main"));
const database_js_1 = require("./database.js");
const csv_importer_js_1 = require("./csv-importer.js");
function registerIpcHandlers(getDb, setDb) {
    // -------- app:* --------
    electron_1.ipcMain.handle('app:version', () => electron_1.app.getVersion());
    electron_1.ipcMain.handle('app:platform', () => process.platform);
    // -------- fs:newProject --------
    electron_1.ipcMain.handle('fs:newProject', async (_evt, opts) => {
        if (!opts?.filePath || !opts?.name) {
            throw new Error('filePath and name are required');
        }
        // Make sure the file ends in .metardu
        const filePath = opts.filePath.endsWith('.metardu') ? opts.filePath : `${opts.filePath}.metardu`;
        if (fs.existsSync(filePath)) {
            throw new Error(`File already exists: ${filePath}`);
        }
        // Create an empty file first (better-sqlite3 will init it)
        fs.writeFileSync(filePath, Buffer.alloc(0));
        const db = new database_js_1.MetarduDatabase(filePath);
        const projectId = db.initProject(opts.name, opts.countryPack ?? 'KEN');
        setDb(db);
        main_1.default.info(`New project created: ${filePath} (id=${projectId})`);
        return { filePath, projectId };
    });
    // -------- fs:openProject --------
    electron_1.ipcMain.handle('fs:openProject', async (_evt, filePath) => {
        if (!filePath || !fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        // Close existing db if any
        const existing = getDb();
        if (existing)
            existing.close();
        const db = new database_js_1.MetarduDatabase(filePath);
        setDb(db);
        main_1.default.info(`Project opened: ${filePath}`);
        return { filePath };
    });
    // -------- fs:importCsv --------
    electron_1.ipcMain.handle('fs:importCsv', async (_evt, filePath, projectId) => {
        const db = getDb();
        if (!db)
            throw new Error('No project is open. Open or create a .metardu file first.');
        if (!filePath || !fs.existsSync(filePath)) {
            throw new Error(`CSV file not found: ${filePath}`);
        }
        const csvContent = fs.readFileSync(filePath, 'utf-8');
        const points = (0, csv_importer_js_1.parseCsvPoints)(csvContent);
        if (points.length === 0) {
            throw new Error('No points found in CSV. Expected columns: point_number, easting, northing, elevation?, code?, description?');
        }
        const targetProjectId = projectId ?? getSingleProjectId(db);
        const inserted = db.insertPoints(targetProjectId, points);
        main_1.default.info(`Imported ${inserted} points from ${filePath}`);
        return { imported: inserted, projectId: targetProjectId };
    });
    // -------- db:query --------
    electron_1.ipcMain.handle('db:query', (_evt, sql, params) => {
        const db = getDb();
        if (!db)
            throw new Error('No project is open.');
        // Safety: only allow SELECT statements
        const trimmed = sql.trim().toLowerCase();
        if (!trimmed.startsWith('select') && !trimmed.startsWith('with')) {
            throw new Error('db:query only allows SELECT or WITH statements. Use db:execute for writes.');
        }
        return db.query(sql, params ?? []);
    });
    // -------- db:execute --------
    electron_1.ipcMain.handle('db:execute', (_evt, sql, params) => {
        const db = getDb();
        if (!db)
            throw new Error('No project is open.');
        const result = db.execute(sql, params ?? []);
        return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
    });
    // -------- db:getPoints --------
    electron_1.ipcMain.handle('db:getPoints', (_evt, projectId) => {
        const db = getDb();
        if (!db)
            throw new Error('No project is open.');
        const targetProjectId = projectId ?? getSingleProjectId(db);
        return db.getPoints(targetProjectId);
    });
    // -------- db:listProjects --------
    electron_1.ipcMain.handle('db:listProjects', () => {
        const db = getDb();
        if (!db)
            throw new Error('No project is open.');
        return db.query('SELECT id, name, country_pack, default_crs_epsg, created_at, updated_at FROM projects');
    });
    main_1.default.info('IPC handlers registered');
}
function getSingleProjectId(db) {
    const projects = db.query('SELECT id FROM projects ORDER BY created_at DESC LIMIT 1');
    if (projects.length === 0) {
        // Auto-create a default project if none exists
        return db.initProject('Default Project');
    }
    return projects[0].id;
}
//# sourceMappingURL=ipc.js.map