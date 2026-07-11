/**
 * SQLite + SpatiaLite persistence layer.
 *
 * Per ADR-002: SQLite 3 with the SpatiaLite extension, accessed via better-sqlite3.
 * A "project" is a single .metardu file (which is just a SQLite database).
 *
 * The schema is ported from metardu's 47 PostgreSQL migrations. For the walking
 * skeleton we only need 4 tables: projects, points, observations, audit_log.
 * The full schema migration will happen in M2-M3 (cadastral UI).
 */
import type { Database as DatabaseType } from 'better-sqlite3';
export interface SurveyPoint {
    point_number: string;
    easting: number;
    northing: number;
    elevation: number | null;
    code: string | null;
    description: string | null;
    source: 'csv' | 'gnss' | 'total_station' | 'manual';
}
export declare class MetarduDatabase {
    private db;
    constructor(filePath: string);
    private migrate;
    initProject(name: string, countryPack?: string, crsEpsg?: number): string;
    insertPoints(projectId: string, points: SurveyPoint[]): number;
    getPoints(projectId: string): SurveyPoint[];
    query(sql: string, params?: unknown[]): unknown[];
    execute(sql: string, params?: unknown[]): {
        changes: number;
        lastInsertRowid: number | bigint;
    };
    audit(action: string, entity: string, entityId: string | null, payload: unknown): void;
    close(): void;
}
export type { DatabaseType };
//# sourceMappingURL=database.d.ts.map