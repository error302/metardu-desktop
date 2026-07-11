/**
 * CSV importer — parses a survey points CSV into SurveyPoint[].
 *
 * This is a simplified inline implementation for the walking skeleton.
 * In M1 (engine extraction), this is replaced by the reused metardu
 * CSV importer at packages/engine/src/importers/parsers/csv.ts, which
 * handles 10+ CSV dialects (Leica, Trimble, South, Sokkia, custom).
 *
 * Walking-skeleton accepted CSV formats:
 *
 *   point_number,easting,northing,elevation,code,description
 *   1,517234.56,9876543.21,1523.45,BM,Control point on rock
 *   2,517245.78,9876555.32,1524.10,BM,
 *
 *   — or —
 *
 *   point_number,easting,northing
 *   1,517234.56,9876543.21
 *
 * First row is treated as header. Columns can be in any order as long
 * as the header names match.
 */
export interface CsvParseResult {
    points: SurveyPoint[];
    errors: {
        row: number;
        line: string;
        error: string;
    }[];
}
export interface SurveyPoint {
    point_number: string;
    easting: number;
    northing: number;
    elevation: number | null;
    code: string | null;
    description: string | null;
    source: 'csv' | 'gnss' | 'total_station' | 'manual';
}
export declare function parseCsvPoints(csvContent: string): SurveyPoint[];
//# sourceMappingURL=csv-importer.d.ts.map