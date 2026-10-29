import { z } from "zod";

/** Opaque project source identifiers accepted by point-cloud IPC routes. */
export const POINT_CLOUD_SOURCE_ID_SCHEMA = z.string().uuid();

/** Host-issued job identifiers accepted by point-cloud status/cancel routes. */
export const POINT_CLOUD_INSPECTION_JOB_ID_SCHEMA = z.string().uuid();
