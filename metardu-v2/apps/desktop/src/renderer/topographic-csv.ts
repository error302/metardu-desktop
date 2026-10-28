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
