import type { TopoPoint } from "@metardu/engine-flight-planning";

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Parse headerless id,easting,northing,elevation[,code] rows without defaults. */
export function parseTopographicCsv(csv: string): TopoPoint[] {
  const lines = csv.split(/\r?\n/);
  const points: TopoPoint[] = [];

  for (const [index, rawLine] of lines.entries()) {
    if (!rawLine.trim()) continue;
    const rowNumber = index + 1;
    const fields = rawLine.split(",").map((field) => field.trim());
    if (fields.length < 4 || fields.length > 5) {
      throw new Error(`CSV row ${rowNumber} must contain id,easting,northing,elevation and an optional code.`);
    }

    const [id, easting, northing, elevation, code] = fields;
    if (!id) throw new Error(`CSV row ${rowNumber} is missing a point ID.`);

    const parseCoordinate = (value: string | undefined, field: string): number => {
      if (!value || !DECIMAL.test(value)) {
        throw new Error(`CSV row ${rowNumber} has a missing or malformed ${field}.`);
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`CSV row ${rowNumber} has a non-finite ${field}.`);
      }
      return parsed;
    };

    points.push({
      id,
      easting: parseCoordinate(easting, "easting"),
      northing: parseCoordinate(northing, "northing"),
      elevation: parseCoordinate(elevation, "elevation"),
      ...(code ? { code } : {}),
    });
  }

  if (points.length === 0) throw new Error("Enter at least three field point rows before generating a surface.");
  return points;
}

/** Validate the JSON result received from the allowlisted Rust TIN method. */
export function parseTopographicTriangles(value: unknown, pointCount: number): [number, number, number][] {
  if (value === null || typeof value !== "object" || !Array.isArray((value as { triangles?: unknown }).triangles)) {
    throw new Error("Topographic sidecar returned a malformed TIN response.");
  }
  const triangles = (value as { triangles: unknown[] }).triangles;
  const maximumFaceCount = Math.max(0, 2 * pointCount - 5);
  if (triangles.length === 0 || triangles.length > maximumFaceCount) {
    throw new Error("Topographic sidecar returned an empty or oversized triangle list.");
  }

  const seen = new Set<string>();
  return triangles.map((value, index) => {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(
      (vertex) => Number.isSafeInteger(vertex) && Number(vertex) >= 0 && Number(vertex) < pointCount,
    )) {
      throw new Error(`Topographic sidecar triangle ${index} has invalid vertex indices.`);
    }
    const triangle = value as [number, number, number];
    const [a, b, c] = triangle;
    if (a === b || b === c || c === a) {
      throw new Error(`Topographic sidecar triangle ${index} repeats a vertex index.`);
    }
    const key = [a, b, c].sort((left, right) => left - right).join(":");
    if (seen.has(key)) throw new Error(`Topographic sidecar returned duplicate triangle ${key}.`);
    seen.add(key);
    return triangle;
  });
}
