/**
 * Map Sheet Indexing Module for MetaRDU Desktop v2.0.
 *
 * Provides automatic map sheet identification for Kenya (Y717 series),
 * Tanzania, Uganda, and other East African countries.
 *
 * The Kenya Y717 series uses a grid system where each sheet covers
 * 30' × 30' (0.5° × 0.5°), numbered from south to north and west to east.
 *
 * Sheet naming: < quadrant >< column >< row > (e.g., "SA 37")
 *   - Quadrant: N, S, E, W (relative to equator and 36°E meridian)
 *   - Column: 1-4 (each 30' wide)
 *   - Row: number increases northward
 *
 * References:
 *   - Survey of Kenya: Y717 Topographic Map Series specification
 *   - East African Mapping Service: Joint map sheet numbering
 */

// ─── Types ─────────────────────────────────────────────────────────

export interface MapSheet {
  /** Sheet number (e.g., "SA 37") */
  sheetNumber: string;
  /** Sheet name */
  sheetName: string;
  /** South edge (degrees) */
  south: number;
  /** West edge (degrees) */
  west: number;
  /** North edge (degrees) */
  north: number;
  /** East edge (degrees) */
  east: number;
  /** Scale */
  scale: string;
  /** Country */
  country: string;
}

// ─── Kenya Y717 series ─────────────────────────────────────────────

/** Kenya Y717 map sheets (1:50,000, 30' × 30' cells). */
export function findKenyaMapSheet(lat: number, lng: number): MapSheet | null {
  // Kenya bounds: lat -5 to 5, lng 33 to 42
  if (lat < -5 || lat > 5 || lng < 33 || lng > 42) return null;

  // Grid: 30' × 30' cells
  const cellSize = 0.5; // degrees

  // Compute cell indices
  const col = Math.floor((lng - 33) / cellSize);
  const row = Math.floor((lat - (-5)) / cellSize);

  // Sheet bounds
  const south = -5 + row * cellSize;
  const north = south + cellSize;
  const west = 33 + col * cellSize;
  const east = west + cellSize;

  // Sheet number: quadrant + column letter + row number
  // Quadrant relative to equator (0°) and 36°E
  let quadrant: string;
  if (lat >= 0 && lng >= 36) quadrant = "NE";
  else if (lat >= 0 && lng < 36) quadrant = "NW";
  else if (lat < 0 && lng >= 36) quadrant = "SE";
  else quadrant = "SW";

  // Column letter (A-D within each quadrant)
  const localCol = Math.floor((lng - (lng >= 36 ? 36 : 33)) / cellSize);
  const colLetter = String.fromCharCode(65 + localCol);

  // Row number (increasing northward)
  const localRow = Math.floor(Math.abs(lat) / cellSize) + 1;

  const sheetNumber = `${quadrant} ${colLetter}${localRow}`;

  // Common sheet names (major cities)
  const sheetNames: Record<string, string> = {
    "SE A1": "Nairobi South",
    "SE A2": "Nairobi East",
    "SE B1": "Nairobi North",
    "SE B2": "Thika",
    "SE C3": "Embu",
    "SE D4": "Meru",
    "SW A1": "Nakuru South",
    "SW B1": "Nakuru North",
    "SW A5": "Kisumu",
    "SE E3": "Garissa",
    "SE F4": "Mombasa North",
    "SE F3": "Mombasa West",
  };

  return {
    sheetNumber,
    sheetName: sheetNames[sheetNumber] ?? `Sheet ${sheetNumber}`,
    south,
    west,
    north,
    east,
    scale: "1:50,000",
    country: "Kenya",
  };
}

// ─── Multi-country map sheet lookup ────────────────────────────────

export function findMapSheet(lat: number, lng: number, country?: string): MapSheet | null {
  // Auto-detect country from coordinates
  if (!country) {
    if (lat >= -5 && lat <= 5 && lng >= 33 && lng <= 42) country = "Kenya";
    else if (lat >= -12 && lat <= 0 && lng >= 29 && lng <= 41) country = "Tanzania";
    else if (lat >= -2 && lat <= 5 && lng >= 29 && lng <= 35) country = "Uganda";
    else return null;
  }

  switch (country) {
    case "Kenya":
      return findKenyaMapSheet(lat, lng);
    case "Tanzania":
      return findTanzaniaMapSheet(lat, lng);
    case "Uganda":
      return findUgandaMapSheet(lat, lng);
    default:
      return null;
  }
}

/** Tanzania map sheets (1:50,000, 30' × 30'). */
function findTanzaniaMapSheet(lat: number, lng: number): MapSheet | null {
  if (lat < -12 || lat > 0 || lng < 29 || lng > 41) return null;

  const cellSize = 0.5;
  const col = Math.floor((lng - 29) / cellSize);
  const row = Math.floor((lat - (-12)) / cellSize);

  const south = -12 + row * cellSize;
  const north = south + cellSize;
  const west = 29 + col * cellSize;
  const east = west + cellSize;

  return {
    sheetNumber: `TZ ${col + 1}/${row + 1}`,
    sheetName: `Tanzania Sheet ${col + 1}/${row + 1}`,
    south, west, north, east,
    scale: "1:50,000",
    country: "Tanzania",
  };
}

/** Uganda map sheets (1:50,000, 30' × 30'). */
function findUgandaMapSheet(lat: number, lng: number): MapSheet | null {
  if (lat < -2 || lat > 5 || lng < 29 || lng > 35) return null;

  const cellSize = 0.5;
  const col = Math.floor((lng - 29) / cellSize);
  const row = Math.floor((lat - (-2)) / cellSize);

  const south = -2 + row * cellSize;
  const north = south + cellSize;
  const west = 29 + col * cellSize;
  const east = west + cellSize;

  return {
    sheetNumber: `UG ${col + 1}/${row + 1}`,
    sheetName: `Uganda Sheet ${col + 1}/${row + 1}`,
    south, west, north, east,
    scale: "1:50,000",
    country: "Uganda",
  };
}

// ─── SoK (Survey of Kenya) map sheet registry ──────────────────────

/** Major SoK map sheets with names (for quick lookup). */
export const SOK_SHEET_REGISTRY: Array<{ sheetNumber: string; sheetName: string; centerLat: number; centerLng: number }> = [
  { sheetNumber: "SE A1", sheetName: "Nairobi South", centerLat: -1.25, centerLng: 36.75 },
  { sheetNumber: "SE A2", sheetName: "Nairobi East", centerLat: -1.25, centerLng: 37.25 },
  { sheetNumber: "SE B1", sheetName: "Nairobi North", centerLat: -0.75, centerLng: 36.75 },
  { sheetNumber: "SE B2", sheetName: "Thika", centerLat: -0.75, centerLng: 37.25 },
  { sheetNumber: "SW A1", sheetName: "Limuru", centerLat: -1.25, centerLng: 36.25 },
  { sheetNumber: "SW B1", sheetName: "Kiambu", centerLat: -0.75, centerLng: 36.25 },
  { sheetNumber: "SE C1", sheetName: "Magumu", centerLat: -0.25, centerLng: 36.75 },
  { sheetNumber: "SE C2", sheetName: "Ndumberi", centerLat: -0.25, centerLng: 37.25 },
  { sheetNumber: "SE D2", sheetName: "Embu", centerLat: 0.25, centerLng: 37.25 },
  { sheetNumber: "SE E3", sheetName: "Meru", centerLat: 0.75, centerLng: 37.75 },
  { sheetNumber: "SW A5", sheetName: "Kisumu", centerLat: -0.75, centerLng: 34.75 },
  { sheetNumber: "SW B5", sheetName: "Kakamega", centerLat: 0.25, centerLng: 34.75 },
  { sheetNumber: "SE F3", sheetName: "Mombasa West", centerLat: -4.25, centerLng: 39.25 },
  { sheetNumber: "SE F4", sheetName: "Mombasa North", centerLat: -4.25, centerLng: 39.75 },
  { sheetNumber: "SE E4", sheetName: "Garissa", centerLat: 0.25, centerLng: 39.25 },
  { sheetNumber: "SW D3", sheetName: "Nakuru", centerLat: -0.25, centerLng: 36.25 },
  { sheetNumber: "SW C3", sheetName: "Naivasha", centerLat: -0.75, centerLng: 36.25 },
  { sheetNumber: "SE B5", sheetName: "Nyeri", centerLat: -0.25, centerLng: 36.75 },
  { sheetNumber: "SE A5", sheetName: "Machakos", centerLat: -1.25, centerLng: 37.25 },
  { sheetNumber: "SW E1", sheetName: "Eldoret", centerLat: 0.75, centerLng: 35.25 },
];

/**
 * Find SoK sheet by name (partial match).
 */
export function findSheetByName(name: string): typeof SOK_SHEET_REGISTRY[number] | null {
  const lower = name.toLowerCase();
  const match = SOK_SHEET_REGISTRY.find(s =>
    s.sheetName.toLowerCase().includes(lower) ||
    s.sheetNumber.toLowerCase().includes(lower)
  );
  return match ?? null;
}
