"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCsvPoints = parseCsvPoints;
function parseCsvPoints(csvContent) {
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0)
        return [];
    // Detect delimiter (comma, semicolon, tab)
    const firstLine = lines[0];
    const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
    // Parse header
    const header = lines[0].split(delimiter).map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));
    const colIdx = {};
    header.forEach((name, i) => { colIdx[name] = i; });
    // Required columns (with synonym fallback)
    const eastingCol = colIdx['easting'] ?? colIdx['east'] ?? colIdx['x'] ?? colIdx['e'];
    const northingCol = colIdx['northing'] ?? colIdx['north'] ?? colIdx['y'] ?? colIdx['n'];
    const pointCol = colIdx['point_number'] ?? colIdx['point'] ?? colIdx['pt'] ?? colIdx['pid'] ?? colIdx['id'];
    const elevCol = colIdx['elevation'] ?? colIdx['elev'] ?? colIdx['z'] ?? colIdx['height'];
    const codeCol = colIdx['code'] ?? colIdx['feature_code'] ?? colIdx['fc'];
    const descCol = colIdx['description'] ?? colIdx['desc'] ?? colIdx['remark'] ?? colIdx['note'];
    if (pointCol === undefined || eastingCol === undefined || northingCol === undefined) {
        throw new Error(`CSV header is missing required columns. Need point_number (or point/pt/pid/id), easting (or east/x/e), northing (or north/y/n). Got: ${header.join(', ')}`);
    }
    const points = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(delimiter).map((c) => c.trim().replace(/['"]/g, ''));
        if (cells.length < 3)
            continue;
        const point_number = cells[pointCol];
        const easting = parseFloat(cells[eastingCol]);
        const northing = parseFloat(cells[northingCol]);
        const elevation = elevCol !== undefined && cells[elevCol] ? parseFloat(cells[elevCol]) : null;
        const code = codeCol !== undefined ? cells[codeCol] || null : null;
        const description = descCol !== undefined ? cells[descCol] || null : null;
        if (!point_number || isNaN(easting) || isNaN(northing)) {
            continue; // Skip malformed rows silently — the GIS QA gate will surface them in M2
        }
        points.push({ point_number, easting, northing, elevation, code, description, source: 'csv' });
    }
    return points;
}
//# sourceMappingURL=csv-importer.js.map