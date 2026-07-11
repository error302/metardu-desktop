/**
 * Cassini ↔ UTM — Constants
 *
 * proj4 CRS definitions and ellipsoid constants for the Kenyan Cassini-Soldner
 * ↔ UTM coordinate conversion subsystem.
 *
 * ALL Cassini inputs/outputs are in FEET on Clarke 1858.
 * ALL UTM inputs/outputs are in METRES on Clarke 1880 / Arc 1960.
 */

import proj4 from 'proj4'

// ─── proj4 Definitions ──────────────────────────────────────────────────────

/** WGS84 geographic CRS (lat/lon in degrees) */
export const WGS84_DEF = '+proj=longlat +datum=WGS84 +no_defs'

/** UTM Zone 37 South — Arc 1960 datum (Clarke 1880 ellipsoid, EPSG:1284 7-param shift to WGS84) */
export const ARC1960_UTM37S_DEF = '+proj=utm +zone=37 +south +a=6378249.145 +b=6356514.87 +towgs84=-160,-6,-302,-0.807,0.339,-1.619,-2.554 +units=m +no_defs'

/** UTM Zone 36 South — Arc 1960 datum (for sheets near zone boundary) */
export const ARC1960_UTM36S_DEF = '+proj=utm +zone=36 +south +a=6378249.145 +b=6356514.87 +towgs84=-160,-6,-302,-0.807,0.339,-1.619,-2.554 +units=m +no_defs'

export { proj4 }

// ─── Ellipsoid Constants ──────────────────────────────────────────────────

export const CLARKE_1858_A_FT = 20_926_348
export const CLARKE_1858_B_FT = 20_855_232.84
export const CLARKE_1858_F = 0.003398355
export const CLARKE_1880_A_M = 6_378_249.145
export const CLARKE_1880_B_M = 6_356_514.87
export const CLARKE_1880_F = (CLARKE_1880_A_M - CLARKE_1880_B_M) / CLARKE_1880_A_M
export const FT_TO_M = 0.3048
export const DEG_TO_RAD = Math.PI / 180
export const RAD_TO_DEG = 180 / Math.PI
export const CLARKE_1858_A_M = CLARKE_1858_A_FT * FT_TO_M
export const CLARKE_1858_B_M = CLARKE_1858_B_FT * FT_TO_M
