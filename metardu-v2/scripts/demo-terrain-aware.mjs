#!/usr/bin/env node
/**
 * Enhanced demo: 50ha Nairobi survey with terrain-aware altitude + battery estimation.
 *
 * Builds on the basic demo by adding:
 *   - Simulated terrain (Nairobi plateau at 1700m AMSL with a small hill)
 *   - Terrain-aware altitude adjustment
 *   - Battery count and flight time estimation
 */

import {
  getCameraById,
  computeFlightPlanParameters,
  generateLawnmowerWaypoints,
  computeMissionStats,
  exportMission,
  elevationFromFunction,
  makeTerrainAware,
  computeTerrainStats,
  estimateBatteryAndTime,
} from "../packages/engine/src/index.ts";

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "demo-output");
mkdirSync(OUTPUT_DIR, { recursive: true });

console.log("═".repeat(72));
console.log("  MetaRDU Desktop v2.0 — Enhanced Demo");
console.log("  50ha Nairobi survey with terrain-aware altitude + battery estimation");
console.log("═".repeat(72));

// ─── Setup ──────────────────────────────────────────────────────────
const camera = getCameraById("dji-mavic-3-enterprise");
const params = computeFlightPlanParameters(camera, 75, 0.75, 0.65);
const surveyArea = {
  coordinates: [
    { lat: -1.2864, lng: 36.8172 },
    { lat: -1.2774, lng: 36.8172 },
    { lat: -1.2774, lng: 36.8227 },
    { lat: -1.2864, lng: 36.8227 },
    { lat: -1.2864, lng: 36.8172 },
  ],
};

console.log("\n📋 Camera:", camera.name);
console.log("📐 GSD:", params.gsdCmPx.toFixed(2), "cm/px at", params.altitudeM, "m AGL");

// ─── Generate flat-terrain waypoints ────────────────────────────────
const flatWaypoints = generateLawnmowerWaypoints({ params, area: surveyArea });
const flatStats = computeMissionStats(flatWaypoints, camera.cruiseSpeedMs ?? 15);
console.log("\n✈️  Generated", flatWaypoints.length, "waypoints (flat terrain)");
console.log("   Distance:", (flatStats.totalDistanceMeters / 1000).toFixed(2), "km");
console.log("   Flight time:", flatStats.estimatedFlightTimeMin.toFixed(1), "min");

// ─── Simulate Nairobi terrain with a small hill ─────────────────────
// Nairobi plateau: ~1700m AMSL
// Simulate a 30m hill in the north-east corner of the survey area
const elevation = elevationFromFunction((lat, lng) => {
  const baseElevation = 1700;
  // Hill centered at NE corner (-1.2774, 36.8227), 30m peak
  const hillCenterLat = -1.2774;
  const hillCenterLng = 36.8227;
  const dLat = (lat - hillCenterLat) * 111_320;
  const dLng = (lng - hillCenterLng) * 111_320 * Math.cos(lat * Math.PI / 180);
  const distFromHill = Math.sqrt(dLat * dLat + dLng * dLng);
  const hillRadius = 200; // meters
  if (distFromHill < hillRadius) {
    // Gaussian hill shape
    const hillHeight = 30 * Math.exp(-(distFromHill * distFromHill) / (2 * 80 * 80));
    return baseElevation + hillHeight;
  }
  return baseElevation;
});

// ─── Apply terrain-aware altitude ───────────────────────────────────
const terrainWaypoints = makeTerrainAware(flatWaypoints, elevation);
const terrainStats = computeTerrainStats(terrainWaypoints, elevation);

console.log("\n🏔️  Terrain statistics:");
console.log("   Min elevation:    ", terrainStats.minElevationM.toFixed(1), "m AMSL");
console.log("   Max elevation:    ", terrainStats.maxElevationM.toFixed(1), "m AMSL");
console.log("   Mean elevation:   ", terrainStats.meanElevationM.toFixed(1), "m AMSL");
console.log("   Elevation range:  ", terrainStats.elevationRangeM.toFixed(1), "m");
console.log("   Std deviation:    ", terrainStats.elevationStdDevM.toFixed(1), "m");
console.log("   Min drone altitude:", terrainStats.minAltitudeAMSLM.toFixed(1), "m AMSL");
console.log("   Max drone altitude:", terrainStats.maxAltitudeAMSLM.toFixed(1), "m AMSL");

// ─── Battery estimation ─────────────────────────────────────────────
const battery = estimateBatteryAndTime(terrainWaypoints, { camera });

console.log("\n🔋 Battery estimation:");
console.log("   Flight distance:    ", (battery.flightDistanceMeters / 1000).toFixed(2), "km");
console.log("   Active flight time: ", battery.flightTimeMin.toFixed(1), "min");
console.log("   Turn time:          ", battery.turnTimeMin.toFixed(1), "min (" + battery.turnCount + " turns)");
console.log("   Photo time:         ", battery.photoTimeMin.toFixed(1), "min (" + battery.photoCount + " photos)");
console.log("   Ascent time:        ", battery.ascentTimeMin.toFixed(2), "min");
console.log("   Usable per battery: ", battery.usableFlightTimePerBatteryMin.toFixed(1), "min (after 25% derating + 20% safety)");
console.log("   Batteries required: ", battery.batteryCount);
console.log("   RTH time:           ", battery.rthTimeMin, "min");
if (battery.batterySwapTimeMin > 0) {
  console.log("   Battery swap time:  ", battery.batterySwapTimeMin.toFixed(1), "min (" + (battery.batteryCount - 1) + " swaps)");
  console.log("   Swap at waypoints:  ", battery.batterySwapWaypoints.join(", "));
}
console.log("   ─────────────────────────────");
console.log("   Total mission time: ", battery.totalMissionTimeMin.toFixed(1), "min");

// ─── Export terrain-aware mission to all 5 formats ──────────────────
console.log("\n💾 Exporting terrain-aware mission to all 5 formats...");
const { SUPPORTED_EXPORT_FORMATS } = await import("../packages/engine/src/index.ts");
for (const fmt of SUPPORTED_EXPORT_FORMATS) {
  const result = await exportMission(terrainWaypoints, { format: fmt.format });
  const filename = `nairobi-50ha-terrain-aware${result.fileExtension}`;
  const filepath = join(OUTPUT_DIR, filename);

  if (result.text) {
    writeFileSync(filepath, result.text, "utf-8");
    console.log("   ✓", fmt.format.padEnd(22), "→", filename, `(${(result.text.length / 1024).toFixed(1)} KB)`);
  } else if (result.bytes) {
    writeFileSync(filepath, result.bytes);
    console.log("   ✓", fmt.format.padEnd(22), "→", filename, `(${(result.bytes.length / 1024).toFixed(1)} KB)`);
  }
}

console.log("\n✅ Demo complete!");
console.log("\nFiles in", OUTPUT_DIR + ":");
console.log("   - nairobi-50ha-survey.* (flat-terrain, from previous demo)");
console.log("   - nairobi-50ha-terrain-aware.* (terrain-adjusted altitudes)");
