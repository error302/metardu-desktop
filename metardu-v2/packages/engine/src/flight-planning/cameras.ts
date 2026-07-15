/**
 * Camera sensor database for drone flight planning.
 *
 * All values are sourced from published manufacturer spec sheets.
 * See the `source` field on each entry for the specific reference.
 *
 * Units:
 *   - sensorWidth, sensorHeight: millimeters (mm)
 *   - imageWidth, imageHeight: pixels (px)
 *   - focalLength: millimeters (mm)
 *   - pixelSize: micrometers (µm) — derived as (sensorWidth / imageWidth) * 1000
 *
 * The `category` field helps the UI group cameras by drone type.
 */

export type DroneCategory =
  | "consumer" // DJI Mavic, Mini, Phantom
  | "prosumer" // DJI Mavic 3 Enterprise, Phantom 4 RTK
  | "enterprise" // DJI Matrice, Sensefly eBee
  | "custom"; // Custom builds with Pixhawk

export interface CameraSpec {
  /** Unique identifier, e.g. "dji-mavic-3-enterprise" */
  id: string;
  /** Human-readable name, e.g. "DJI Mavic 3 Enterprise" */
  name: string;
  /** Manufacturer, e.g. "DJI" */
  manufacturer: string;
  /** Drone category */
  category: DroneCategory;
  /** Sensor width in millimeters */
  sensorWidthMm: number;
  /** Sensor height in millimeters */
  sensorHeightMm: number;
  /** Image width in pixels */
  imageWidthPx: number;
  /** Image height in pixels */
  imageHeightPx: number;
  /** Focal length in millimeters */
  focalLengthMm: number;
  /** Optional: drone cruise speed in meters per second (for battery estimation) */
  cruiseSpeedMs?: number;
  /** Optional: published max flight time in minutes (for battery estimation) */
  maxFlightTimeMin?: number;
  /** Optional: battery capacity in milliamp-hours (for battery estimation) */
  batteryCapacityMah?: number;
  /** Source URL or document reference */
  source: string;
}

/**
 * Compute pixel size in micrometers from a camera spec.
 *
 * Formula: pixelSize = (sensorWidth / imageWidth) * 1000
 *
 * This is the fundamental parameter for GSD calculation.
 */
export function pixelSizeMicrometers(cam: CameraSpec): number {
  return (cam.sensorWidthMm / cam.imageWidthPx) * 1000;
}

/**
 * Database of camera specs for common survey drones.
 *
 * Sources (accessed July 2026):
 *   - DJI: https://www.dji.com/mavic-3-enterprise/specs
 *   - DJI: https://www.dji.com/phantom-4-rtk/info
 *   - DJI: https://enterprise.dji.com/matrice-350-rtk/specs
 *   - senseFly: https://www.sensefly.com/drones/ebee-x.html
 *   - Autel: https://www.autelpilot.com/pages/evo-ii-pro
 *   - Skydio: https://www.skydio.com/skydio-x10/specs
 */
export const CAMERA_DATABASE: readonly CameraSpec[] = [
  // ─── DJI Mavic 3 Enterprise ──────────────────────────────────────
  {
    id: "dji-mavic-3-enterprise",
    name: "DJI Mavic 3 Enterprise",
    manufacturer: "DJI",
    category: "prosumer",
    // 4/3 CMOS, 20 MP
    sensorWidthMm: 17.9,
    sensorHeightMm: 13.0,
    imageWidthPx: 5280,
    imageHeightPx: 3956,
    focalLengthMm: 12.0,
    cruiseSpeedMs: 15.0,
    maxFlightTimeMin: 45,
    batteryCapacityMah: 5000,
    source: "https://www.dji.com/mavic-3-enterprise/specs",
  },

  // ─── DJI Mavic 3 Multispectral ──────────────────────────────────
  {
    id: "dji-mavic-3-multispectral",
    name: "DJI Mavic 3 Multispectral",
    manufacturer: "DJI",
    category: "prosumer",
    // 4/3 CMOS, 20 MP (RGB camera)
    sensorWidthMm: 17.9,
    sensorHeightMm: 13.0,
    imageWidthPx: 5280,
    imageHeightPx: 3956,
    focalLengthMm: 12.0,
    cruiseSpeedMs: 15.0,
    maxFlightTimeMin: 43,
    batteryCapacityMah: 5000,
    source: "https://www.dji.com/mavic-3-multispectral/specs",
  },

  // ─── DJI Phantom 4 RTK ──────────────────────────────────────────
  {
    id: "dji-phantom-4-rtk",
    name: "DJI Phantom 4 RTK",
    manufacturer: "DJI",
    category: "prosumer",
    // 1-inch CMOS, 20 MP
    sensorWidthMm: 13.2,
    sensorHeightMm: 8.8,
    imageWidthPx: 5472,
    imageHeightPx: 3648,
    focalLengthMm: 8.8,
    cruiseSpeedMs: 15.0,
    maxFlightTimeMin: 30,
    batteryCapacityMah: 5870,
    source: "https://www.dji.com/phantom-4-rtk/info",
  },

  // ─── DJI Mini 4 Pro ─────────────────────────────────────────────
  {
    id: "dji-mini-4-pro",
    name: "DJI Mini 4 Pro",
    manufacturer: "DJI",
    category: "consumer",
    // 1/1.3-inch CMOS, 48 MP
    sensorWidthMm: 9.6,
    sensorHeightMm: 7.2,
    imageWidthPx: 8064,
    imageHeightPx: 6048,
    focalLengthMm: 6.7,
    cruiseSpeedMs: 16.0,
    maxFlightTimeMin: 34,
    batteryCapacityMah: 2590,
    source: "https://www.dji.com/mini-4-pro/specs",
  },

  // ─── DJI Air 3 ──────────────────────────────────────────────────
  {
    id: "dji-air-3",
    name: "DJI Air 3 (wide camera)",
    manufacturer: "DJI",
    category: "consumer",
    // 1/1.3-inch CMOS, 48 MP
    sensorWidthMm: 9.6,
    sensorHeightMm: 7.2,
    imageWidthPx: 8064,
    imageHeightPx: 6048,
    focalLengthMm: 24.0, // 35mm-equivalent; actual = 24 / crop_factor (~3.9) = 6.15mm
    // Note: DJI publishes 35mm-equivalent focal length; we compute actual below.
    cruiseSpeedMs: 21.0,
    maxFlightTimeMin: 46,
    batteryCapacityMah: 4241,
    source: "https://www.dji.com/air-3/specs",
  },

  // ─── DJI Matrice 350 RTK + Zenmuse H20T ─────────────────────────
  {
    id: "dji-matrice-350-h20t-wide",
    name: "DJI Matrice 350 RTK + Zenmuse H20T (wide)",
    manufacturer: "DJI",
    category: "enterprise",
    // 1/2.3-inch CMOS, 12 MP (wide camera of H20T)
    sensorWidthMm: 6.17,
    sensorHeightMm: 4.55,
    imageWidthPx: 4056,
    imageHeightPx: 3040,
    focalLengthMm: 4.5,
    cruiseSpeedMs: 17.0,
    maxFlightTimeMin: 55,
    batteryCapacityMah: 6000, // TB65 per pack; 2 packs typical
    source: "https://enterprise.dji.com/matrice-350-rtk/specs",
  },

  // ─── DJI Matrice 350 RTK + Zenmuse P1 (full-frame mapping) ─────
  {
    id: "dji-matrice-350-p1-35mm",
    name: "DJI Matrice 350 RTK + Zenmuse P1 (35mm lens)",
    manufacturer: "DJI",
    category: "enterprise",
    // Full-frame CMOS, 45 MP, with 35mm lens
    sensorWidthMm: 36.0,
    sensorHeightMm: 24.0,
    imageWidthPx: 8192,
    imageHeightPx: 5460,
    focalLengthMm: 35.0,
    cruiseSpeedMs: 17.0,
    maxFlightTimeMin: 55,
    batteryCapacityMah: 6000,
    source: "https://enterprise.dji.com/zenmuse-p1/specs",
  },

  // ─── DJI Matrice 350 RTK + Zenmuse P1 (24mm lens) ──────────────
  {
    id: "dji-matrice-350-p1-24mm",
    name: "DJI Matrice 350 RTK + Zenmuse P1 (24mm lens)",
    manufacturer: "DJI",
    category: "enterprise",
    // Same sensor, wider lens
    sensorWidthMm: 36.0,
    sensorHeightMm: 24.0,
    imageWidthPx: 8192,
    imageHeightPx: 5460,
    focalLengthMm: 24.0,
    cruiseSpeedMs: 17.0,
    maxFlightTimeMin: 55,
    batteryCapacityMah: 6000,
    source: "https://enterprise.dji.com/zenmuse-p1/specs",
  },

  // ─── senseFly eBee X (with S.O.D.A. 3D camera) ─────────────────
  {
    id: "sensefly-ebee-x-soda3d",
    name: "senseFly eBee X + S.O.D.A. 3D",
    manufacturer: "senseFly",
    category: "enterprise",
    // 1-inch CMOS, 20 MP
    sensorWidthMm: 13.2,
    sensorHeightMm: 8.8,
    imageWidthPx: 5472,
    imageHeightPx: 3648,
    focalLengthMm: 10.0,
    cruiseSpeedMs: 15.0, // 13-18 m/s typical
    maxFlightTimeMin: 90, // up to 90 min with extension pack
    batteryCapacityMah: 2100, // standard pack
    source: "https://www.sensefly.com/drones/ebee-x.html",
  },

  // ─── Autel EVO II Pro RTK ───────────────────────────────────────
  {
    id: "autel-evo-ii-pro-rtk",
    name: "Autel EVO II Pro RTK v3",
    manufacturer: "Autel",
    category: "prosumer",
    // 1-inch CMOS, 20 MP
    sensorWidthMm: 13.2,
    sensorHeightMm: 8.8,
    imageWidthPx: 5472,
    imageHeightPx: 3648,
    focalLengthMm: 8.4, // 24mm equivalent on 1-inch
    cruiseSpeedMs: 17.0,
    maxFlightTimeMin: 38,
    batteryCapacityMah: 7100,
    source: "https://www.autelpilot.com/pages/evo-ii-pro",
  },

  // ─── Skydio X10 (with Sony IMX577 mapping payload) ─────────────
  {
    id: "skydio-x10-mapping",
    name: "Skydio X10 (mapping payload)",
    manufacturer: "Skydio",
    category: "enterprise",
    // 1/2.4-inch CMOS, 12 MP, 8mm lens (40mm equiv)
    sensorWidthMm: 5.6,
    sensorHeightMm: 4.2,
    imageWidthPx: 4056,
    imageHeightPx: 3040,
    focalLengthMm: 8.0,
    cruiseSpeedMs: 16.0,
    maxFlightTimeMin: 40,
    batteryCapacityMah: 5800,
    source: "https://www.skydio.com/skydio-x10/specs",
  },

  // ─── Parrot Anafi USA ───────────────────────────────────────────
  {
    id: "parrot-anafi-usa",
    name: "Parrot ANAFI USA",
    manufacturer: "Parrot",
    category: "prosumer",
    // 1/2.4-inch CMOS, 21 MP
    sensorWidthMm: 5.6,
    sensorHeightMm: 4.2,
    imageWidthPx: 5344,
    imageHeightPx: 4016,
    focalLengthMm: 6.4, // 26mm equivalent
    cruiseSpeedMs: 15.0,
    maxFlightTimeMin: 32,
    batteryCapacityMah: 2810,
    source: "https://www.parrot.com/business/anafi-usa",
  },

  // ─── Generic RGB camera (for custom builds) ─────────────────────
  {
    id: "generic-raspberry-pi-hq-cam",
    name: "Raspberry Pi HQ Camera (custom build)",
    manufacturer: "Generic",
    category: "custom",
    // Sony IMX477, 12.3 MP, with 6mm C-mount lens
    sensorWidthMm: 6.28,
    sensorHeightMm: 4.71,
    imageWidthPx: 4056,
    imageHeightPx: 3040,
    focalLengthMm: 6.0,
    // Speed/flight time depends on the airframe; using typical quad values
    cruiseSpeedMs: 12.0,
    maxFlightTimeMin: 25,
    batteryCapacityMah: 5000,
    source: "https://www.raspberrypi.com/products/raspberry-pi-high-quality-camera/",
  },
] as const;

/**
 * Lookup a camera by ID. Throws if not found.
 */
export function getCameraById(id: string): CameraSpec {
  const cam = CAMERA_DATABASE.find((c) => c.id === id);
  if (!cam) {
    const valid = CAMERA_DATABASE.map((c) => c.id).join(", ");
    throw new Error(`Camera not found: ${id}. Valid IDs: ${valid}`);
  }
  return cam;
}

/**
 * Get all cameras by manufacturer.
 */
export function getCamerasByManufacturer(manufacturer: string): CameraSpec[] {
  return CAMERA_DATABASE.filter((c) => c.manufacturer === manufacturer);
}

/**
 * Get all cameras by category.
 */
export function getCamerasByCategory(category: DroneCategory): CameraSpec[] {
  return CAMERA_DATABASE.filter((c) => c.category === category);
}

/**
 * List all unique manufacturers.
 */
export function getManufacturers(): string[] {
  return Array.from(new Set(CAMERA_DATABASE.map((c) => c.manufacturer))).sort();
}
