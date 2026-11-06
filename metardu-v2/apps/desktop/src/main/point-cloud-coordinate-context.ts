import {
  POINT_CLOUD_COORDINATE_CONTEXT_SCHEMA,
  type PointCloudCoordinateContext,
} from "@metardu/ipc-schemas";

export interface ParsedPointCloudCoordinateContext {
  coordinateContext?: PointCloudCoordinateContext;
  coordinateContextStatus?: "invalid";
}

/** Parse renderer-safe metadata without deleting or repairing an invalid database value. */
export function parsePointCloudCoordinateContext(
  storedJson: string | null | undefined,
): ParsedPointCloudCoordinateContext {
  if (storedJson === null || storedJson === undefined) return {};
  try {
    const parsed = POINT_CLOUD_COORDINATE_CONTEXT_SCHEMA.safeParse(JSON.parse(storedJson) as unknown);
    return parsed.success
      ? { coordinateContext: parsed.data }
      : { coordinateContextStatus: "invalid" };
  } catch {
    return { coordinateContextStatus: "invalid" };
  }
}
