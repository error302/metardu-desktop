#!/usr/bin/env node
/**
 * Demo: Generate a real PDF flight plan report from the engine's JSON output.
 */
import {
  getCameraById,
  computeFlightPlanParameters,
  generateLawnmowerWaypoints,
  computeBoundingBox,
  computeMissionStats,
  estimateBatteryAndTime,
  generateFlightPlanReport,
} from "../packages/engine/src/index.ts";
import { renderReportToPdf } from "../packages/report-pdf/src/index.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "demo-output");
mkdirSync(OUTPUT_DIR, { recursive: true });

console.log("Generating flight plan report PDF...");

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
const waypoints = generateLawnmowerWaypoints({ params, area: surveyArea });
const bbox = computeBoundingBox(surveyArea);
const stats = computeMissionStats(waypoints, camera.cruiseSpeedMs ?? 15);
const battery = estimateBatteryAndTime(waypoints, { camera });

const report = generateFlightPlanReport({
  camera, params, boundingBox: bbox, waypoints, battery, missionStats: stats,
  missionName: "Nairobi 50ha Demo Survey",
  surveyorName: "error302",
  projectRef: "METARDU-V2-001",
});

const pdfBytes = await renderReportToPdf(report);
const pdfPath = join(OUTPUT_DIR, "nairobi-50ha-mission-report.pdf");
writeFileSync(pdfPath, pdfBytes);

console.log(`✓ PDF generated: ${pdfPath}`);
console.log(`  Size: ${(pdfBytes.length / 1024).toFixed(1)} KB`);
console.log(`  Pages: 4 (cover, summary, compliance+battery, diagrams)`);
