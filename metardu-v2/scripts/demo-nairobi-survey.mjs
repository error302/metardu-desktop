#!/usr/bin/env node
/**
 * Demo: Generate a complete drone survey mission for a 50ha site in Nairobi.
 *
 * This script demonstrates the full Phase 1 Action 3 deliverable:
 *   - Camera footprint math (GSD, footprint, spacing)
 *   - Lawnmower waypoint generation
 *   - Mission export in all 5 formats
 *
 * Usage:
 *   node scripts/demo-nairobi-survey.mjs
 *
 * Output files are written to /home/z/my-project/metardu-v2/demo-output/
 */

import {
  getCameraById,
  computeFlightPlanParameters,
  generateLawnmowerWaypoints,
  computeMissionStats,
  exportMission,
  SUPPORTED_EXPORT_FORMATS,
} from "../packages/engine/src/index.ts";

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "demo-output");
mkdirSync(OUTPUT_DIR, { recursive: true });

console.log("═".repeat(70));
console.log("  MetaRDU Desktop v2.0 — Flight Planning Demo");
console.log("  50-hectare survey site in Nairobi (-1.2864, 36.8172)");
console.log("═".repeat(70));

// ─── Step 1: Select camera ──────────────────────────────────────────
console.log("\n📋 Step 1: Camera selection");
const camera = getCameraById("dji-mavic-3-enterprise");
console.log(`  Camera: ${camera.name}`);
console.log(`  Sensor: ${camera.sensorWidthMm} × ${camera.sensorHeightMm} mm`);
console.log(`  Image:  ${camera.imageWidthPx} × ${camera.imageHeightPx} px`);
console.log(`  Focal:  ${camera.focalLengthMm} mm`);
const pixelSize = (camera.sensorWidthMm / camera.imageWidthPx) * 1000;
console.log(`  Pixel:  ${pixelSize.toFixed(3)} µm`);

// ─── Step 2: Compute flight parameters ──────────────────────────────
console.log("\n📐 Step 2: Flight parameters");
const ALTITUDE = 75; // meters AGL
const FRONT_OVERLAP = 0.75; // 75%
const SIDE_OVERLAP = 0.65; // 65%
const params = computeFlightPlanParameters(camera, ALTITUDE, FRONT_OVERLAP, SIDE_OVERLAP);

console.log(`  Altitude AGL:       ${params.altitudeM} m`);
console.log(`  Front overlap:      ${(params.frontOverlap * 100).toFixed(0)}%`);
console.log(`  Side overlap:       ${(params.sideOverlap * 100).toFixed(0)}%`);
console.log(`  GSD:                ${params.gsdCmPx.toFixed(2)} cm/px`);
console.log(`  Footprint width:    ${params.footprintWidthM.toFixed(2)} m`);
console.log(`  Footprint height:   ${params.footprintHeightM.toFixed(2)} m`);
console.log(`  Photo spacing:      ${params.photoSpacingM.toFixed(2)} m`);
console.log(`  Line spacing:       ${params.lineSpacingM.toFixed(2)} m`);

// ─── Step 3: Define survey area ─────────────────────────────────────
console.log("\n🗺️  Step 3: Survey area (50 hectares in Nairobi)");
const surveyArea = {
  coordinates: [
    { lat: -1.2864, lng: 36.8172 }, // SW
    { lat: -1.2774, lng: 36.8172 }, // NW (1000m north)
    { lat: -1.2774, lng: 36.8227 }, // NE (500m east of NW)
    { lat: -1.2864, lng: 36.8227 }, // SE
    { lat: -1.2864, lng: 36.8172 }, // close polygon
  ],
};
console.log(`  Polygon: ${surveyArea.coordinates.length} vertices`);
console.log(`  Area: ~50 hectares (500m × 1000m)`);

// ─── Step 4: Generate lawnmower waypoints ───────────────────────────
console.log("\n✈️  Step 4: Waypoint generation");
const waypoints = generateLawnmowerWaypoints({
  params,
  area: surveyArea,
  margin: 0.1,
});
console.log(`  Generated ${waypoints.length} waypoints`);

// ─── Step 5: Compute mission stats ──────────────────────────────────
console.log("\n📊 Step 5: Mission statistics");
const stats = computeMissionStats(waypoints, camera.cruiseSpeedMs ?? 15);
console.log(`  Total waypoints:    ${stats.totalWaypoints}`);
console.log(`  Total photos:       ${stats.totalPhotos}`);
console.log(`  Flight lines:       ${stats.flightLineCount}`);
console.log(`  Photos per line:    ${stats.photosPerLine}`);
console.log(`  Total distance:     ${(stats.totalDistanceMeters / 1000).toFixed(2)} km`);
console.log(`  Est. flight time:   ${stats.estimatedFlightTimeMin.toFixed(1)} min`);

// ─── Step 6: Export to all 5 formats ────────────────────────────────
console.log("\n💾 Step 6: Mission export (all 5 formats)");
for (const fmt of SUPPORTED_EXPORT_FORMATS) {
  const result = await exportMission(waypoints, { format: fmt.format });
  const filename = `nairobi-50ha-survey${result.fileExtension}`;
  const filepath = join(OUTPUT_DIR, filename);

  if (result.text) {
    writeFileSync(filepath, result.text, "utf-8");
    console.log(`  ✓ ${fmt.format.padEnd(22)} → ${filename} (${(result.text.length / 1024).toFixed(1)} KB)`);
  } else if (result.bytes) {
    writeFileSync(filepath, result.bytes);
    console.log(`  ✓ ${fmt.format.padEnd(22)} → ${filename} (${(result.bytes.length / 1024).toFixed(1)} KB)`);
  }
}

console.log("\n✅ Demo complete! Files written to:");
console.log(`   ${OUTPUT_DIR}/`);
console.log("");
console.log("Next steps:");
console.log("  - Open nairobi-50ha-survey.kml in Google Earth to visualize the flight path");
console.log("  - Upload nairobi-50ha-survey.kmz to DJI Pilot 2 to fly with a Mavic 3 Enterprise");
console.log("  - Load nairobi-50ha-survey.waypoints in QGroundControl for Pixhawk-based drones");
console.log("  - Import nairobi-50ha-survey.csv into Litchi for DJI Mavic/Phantom");
console.log("  - Open nairobi-50ha-survey.xml in senseFly eMotion for eBee X");
