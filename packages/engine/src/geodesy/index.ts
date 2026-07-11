/**
 * Geodesy Core
 * ============
 *
 * The pure-geodetic math layer of Metardu. This module contains only
 * coordinate-system transformations, datum parameters, scale factors,
 * and GNSS baseline computations — the foundational math that the
 * workflow hubs (cadastral, engineering, topographic) build on top of.
 *
 * Design principle
 * ----------------
 * The workflow hubs should NEVER run their own datum transforms or
 * scale factor reductions inline. They import from this module instead.
 * This keeps the geodetic math in one auditable place and prevents the
 * kind of drift where three different modules compute "UTM scale factor"
 * three slightly different ways.
 *
 * What lives here
 * ---------------
 *   - utmZones.ts        — UTM zone lookup from longitude
 *   - coordinates.ts     — geographic ↔ UTM conversion (WGS84, Clarke 1880)
 *   - datums.ts          — datum registry + WGS84 transformation parameters
 *   - scaleFactor.ts     — Combined Scale Factor (CSF) engine
 *   - gnss.ts            — GNSS baseline processing (ECEF, ENU, baseline vectors)
 *   - geodesicArea.ts    — geodesic polygon area on the ellipsoid
 *
 * What does NOT live here
 * -----------------------
 *   - Traverse adjustment, leveling, COGO, curves, volumes — these are
 *     workflow-specific calculations that live in src/lib/engine/.
 *   - Survey point types — live in src/types/surveyPoint.ts.
 *   - CRS string definitions for proj4 — live in src/lib/map/ (because
 *     they're coupled to the OpenLayers rendering layer).
 *
 * Backwards compatibility
 * -----------------------
 * src/lib/engine/index.ts re-exports everything from this module, so
 * existing `import { computeCombinedScaleFactor } from '@/lib/engine'`
 * calls continue to work. New code should import from '@/lib/geodesy'
 * directly to make the geodesy dependency explicit.
 */

export * from './utmZones'
export * from './coordinates'
export * from './datums'
export * from './scaleFactor'
export * from './gnss'
export * from './geodesicArea'
