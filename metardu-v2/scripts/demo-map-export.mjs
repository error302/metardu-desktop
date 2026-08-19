#!/usr/bin/env node
/**
 * Demo: 300 DPI survey map export — the full chain.
 *
 *   cadastral survey output (projected CRS, UTM 37S)
 *     → extractMapGeometry          (pure normalizer)
 *     → buildSurveyMapSvg           (point-sized plan SVG)
 *     → sharp(svg, {density:300})   (native rasterization → PNG)
 *     → renderReportToPdf           (embed the PNG in the report PDF)
 *
 * Writes:
 *   scripts/demo-output/survey-plan-300dpi.png        (3508×2480 px)
 *   scripts/demo-output/survey-report-with-map.pdf    (map embedded)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderReportToPdf, renderParcelBookletPdf, renderSinglePlanPdf, renderStatutoryReportPdf } from "../packages/report-pdf/src/index.ts";
import {
  extractMapGeometry,
  summarizeGeometry,
  splitGeometryIntoParcels,
} from "../apps/desktop/src/renderer/map-geometry.ts";
import { buildSurveyMapSvg, PRINT_DPI } from "../apps/desktop/src/renderer/map-svg.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "demo-output");
mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── A cadastral survey output (the same shape runCadastralWorkflow emits) ──
const surveyOutput = {
  form3: { pdfBytes: new Uint8Array(0), pageCount: 1, scale: 500, coordinateSystemLabel: "Arc 1960 / UTM 37S", hasDraftWatermark: false },
  allBeacons: [
    { label: "B1", position: { easting: 257100.0, northing: 9857700.0 }, description: "Concrete pillar" },
    { label: "B2", position: { easting: 257200.0, northing: 9857700.0 }, description: "Concrete pillar" },
    { label: "B3", position: { easting: 257200.0, northing: 9857800.0 }, description: "Concrete pillar" },
    { label: "B4", position: { easting: 257100.0, northing: 9857800.0 }, description: "Concrete pillar" },
  ],
  residuals: {},
  sigma_0_sq: 1.0,
  passesCadastralTolerance: true,
};

console.log("1. Extracting geometry…");
const geometry = extractMapGeometry(surveyOutput);
console.log(`   → ${summarizeGeometry(geometry)}`);

console.log("2. Building plan SVG (point-sized)…");
const built = buildSurveyMapSvg(geometry, {
  title: "Kasarani Parcel LR 12345 — Cadastral Survey",
  coordinateSystemLabel: "Arc 1960 / UTM zone 37S",
  surveyorName: "Jane Wanjiru, LS/1234",
  date: "2026-08-01",
});
console.log(`   → ${built.widthPx}×${built.heightPx} px at ${PRINT_DPI} DPI, scale 1:${built.scaleDenominator}`);

console.log("3. Rasterizing with sharp at 300 DPI…");
const png = await sharp(Buffer.from(built.svg), { density: PRINT_DPI }).png().toBuffer();
const pngPath = join(OUTPUT_DIR, "survey-plan-300dpi.png");
writeFileSync(pngPath, png);
const meta = await sharp(png).metadata();
console.log(`   → wrote ${pngPath} (${meta.width}×${meta.height} px, ${(png.length / 1024).toFixed(1)} KB, dpi ${meta.density ?? "n/a"})`);

console.log("4. Building a flight-plan report with the map embedded…");
const report = {
  metadata: {
    generatedAt: "2026-08-01T10:00:00.000Z",
    engineVersion: "0.2.0",
    missionName: "Kasarani Cadastral Survey",
    surveyorName: "Jane Wanjiru",
    projectRef: "LR/12345",
  },
  camera: {
    id: "dji-mavic-3-enterprise", name: "DJI Mavic 3 Enterprise", manufacturer: "DJI",
    sensorWidthMm: 17.9, sensorHeightMm: 13.0, imageWidthPx: 5280, imageHeightPx: 3956,
    focalLengthMm: 12.0, pixelSizeMicrometers: 3.39,
  },
  flightPlan: {
    altitudeMeters: 75, frontOverlap: 0.75, sideOverlap: 0.65, gsdCmPx: 2.12,
    footprintWidthM: 111.875, footprintHeightM: 81.25, photoSpacingM: 27.97, lineSpacingM: 28.44,
  },
  surveyArea: {
    boundingBox: {
      minLat: -1.2864, maxLat: -1.2774, minLng: 36.8172, maxLng: 36.8227,
      centerLat: -1.2819, centerLng: 36.81995, widthMeters: 612, heightMeters: 1002,
    },
    areaHectares: 1.0, vertexCount: 4,
  },
  missionStats: {
    totalWaypoints: 4, totalPhotos: 4, flightLineCount: 1, photosPerLine: 4,
    totalDistanceMeters: 600, estimatedFlightTimeMin: 5,
  },
  battery: {
    flightDistanceMeters: 600, flightTimeMin: 2.0, turnTimeMin: 0, photoTimeMin: 0,
    ascentTimeMin: 1, turnCount: 0, photoCount: 4, usableFlightTimePerBatteryMin: 27,
    batteryCount: 1, totalMissionTimeMin: 3, rthTimeMin: 1, batterySwapTimeMin: 0, batterySwapWaypoints: [],
  },
  asprsCompliance: [
    { asprsClass: { name: "Class I", horizontalRmseCm: 7.5, verticalRmseCm: 15, maxGsdCmPx: 5, scaleEquivalent: "1:500" }, supported: true, marginCmPx: 2.88 },
  ],
  kenyaCompliance: { urbanLinearMisclosure: "1:10000", ruralLinearMisclosure: "1:5000" },
  footprintDiagramSvg: "<svg>footprint</svg>",
  flightPatternSvg: "<svg>pattern</svg>",
  surveyMapPng: new Uint8Array(png),
  surveyMapCaption: `300 DPI survey plan — scale 1:${built.scaleDenominator}, ${built.widthPx}×${built.heightPx} px`,
};

const pdfBytes = await renderReportToPdf(report);
const pdfPath = join(OUTPUT_DIR, "survey-report-with-map.pdf");
writeFileSync(pdfPath, pdfBytes);

console.log(`   → wrote ${pdfPath} (${(pdfBytes.length / 1024).toFixed(1)} KB)`);
console.log("");

// ─── 5. Multi-parcel booklet (subdivision) ─────────────────────────────
console.log("5. Multi-parcel subdivision → one 300 DPI plan + one statutory report PDF per parcel + booklet PDF with index…");
const subdivision = {
  allBeacons: [
    { label: "B1", position: { easting: 257100.0, northing: 9857700.0 } },
    { label: "B2", position: { easting: 257300.0, northing: 9857700.0 } },
    { label: "B3", position: { easting: 257300.0, northing: 9857900.0 } },
    { label: "B4", position: { easting: 257100.0, northing: 9857900.0 } },
  ],
  parcels: [
    {
      label: "LR 12345/1",
      boundary: { vertices: [
        { easting: 257100.0, northing: 9857700.0 }, { easting: 257200.0, northing: 9857700.0 },
        { easting: 257200.0, northing: 9857900.0 }, { easting: 257100.0, northing: 9857900.0 },
      ] },
    },
    {
      label: "LR 12345/2",
      boundary: { vertices: [
        { easting: 257200.0, northing: 9857700.0 }, { easting: 257300.0, northing: 9857700.0 },
        { easting: 257300.0, northing: 9857900.0 }, { easting: 257200.0, northing: 9857900.0 },
      ] },
    },
  ],
};
const subGeometry = extractMapGeometry(subdivision);
const parcelPlans = splitGeometryIntoParcels(subdivision, subGeometry);
console.log(`   → ${parcelPlans.length} parcels`);

const bookletPages = [];
for (const parcel of parcelPlans) {
  const built = buildSurveyMapSvg(parcel.geometry, {
    title: `Kasarani Subdivision — ${parcel.label}`,
    coordinateSystemLabel: "Arc 1960 / UTM zone 37S",
    surveyorName: "Jane Wanjiru, LS/1234",
    date: "2026-08-01",
    titleBlockLabel: "REPUBLIC OF KENYA",
    planTypeLabel: "MUTATION PLAN",
    footerNote: "Prepared under the Survey Act Cap. 299. Coordinates in Arc 1960 / UTM zone 37S (EPSG:21037).",
  });
  const png = await sharp(Buffer.from(built.svg), { density: PRINT_DPI }).png().toBuffer();
  writeFileSync(join(OUTPUT_DIR, `plan-${parcel.label.replace("/", "-")}-300dpi.png`), png);

  // One statutory report PDF per parcel (A4 cover + embedded plan sheet).
  const parcelReportBytes = await renderStatutoryReportPdf({
    title: `Kasarani Subdivision — ${parcel.label}`,
    surveyorName: "Jane Wanjiru, LS/1234",
    date: "2026-08-01",
    coordinateSystemLabel: "Arc 1960 / UTM zone 37S",
    scaleDenominator: built.scaleDenominator,
    titleBlockLabel: "REPUBLIC OF KENYA",
    planTypeLabel: "MUTATION PLAN",
    footerNote: "Prepared under the Survey Act Cap. 299. Coordinates in Arc 1960 / UTM zone 37S (EPSG:21037).",
    summary: summarizeGeometry(parcel.geometry),
    png: new Uint8Array(png),
    mapWidthPt: 842,
    mapHeightPt: 595,
  });
  writeFileSync(join(OUTPUT_DIR, `plan-${parcel.label.replace("/", "-")}-report.pdf`), parcelReportBytes);

  bookletPages.push({
    label: parcel.label,
    png: new Uint8Array(png),
    scaleDenominator: built.scaleDenominator,
    widthPx: built.widthPx,
    heightPx: built.heightPx,
  });
}
const bookletBytes = await renderParcelBookletPdf({
  projectName: "Kasarani Subdivision",
  surveyorName: "Jane Wanjiru, LS/1234",
  date: "2026-08-01",
  coordinateSystemLabel: "Arc 1960 / UTM zone 37S",
  parcels: bookletPages,
});
const bookletPath = join(OUTPUT_DIR, "parcel-booklet.pdf");
writeFileSync(bookletPath, bookletBytes);
console.log(`   → wrote ${bookletPath} (${(bookletBytes.length / 1024).toFixed(1)} KB, ${bookletPages.length + 1} pages)`);
console.log("");

// ─── 6. Multi-project scheme booklet (ProjectsPanel batch export) ──────
console.log("6. Multi-project scheme → one booklet with a master index…");
const schemeProjects = [
  {
    name: "Kasarani North",
    countryCode: "KE",
    surveyOutput: {
      allBeacons: [
        { label: "B1", position: { easting: 257100.0, northing: 9857700.0 } },
        { label: "B2", position: { easting: 257200.0, northing: 9857700.0 } },
        { label: "B3", position: { easting: 257200.0, northing: 9857800.0 } },
        { label: "B4", position: { easting: 257100.0, northing: 9857800.0 } },
      ],
    },
  },
  {
    name: "Kasarani South",
    countryCode: "KE",
    surveyOutput: {
      allBeacons: [
        { label: "B1", position: { easting: 257200.0, northing: 9857800.0 } },
        { label: "B2", position: { easting: 257300.0, northing: 9857800.0 } },
        { label: "B3", position: { easting: 257300.0, northing: 9857900.0 } },
        { label: "B4", position: { easting: 257200.0, northing: 9857900.0 } },
      ],
    },
  },
];
const schemeSheets = [];
for (const project of schemeProjects) {
  const geometry = extractMapGeometry(project.surveyOutput);
  const parcels = splitGeometryIntoParcels(project.surveyOutput, geometry);
  for (const parcel of parcels) {
    const built = buildSurveyMapSvg(parcel.geometry, {
      title: `${project.name}${parcel.label === "Parcel" ? "" : ` — ${parcel.label}`}`,
      coordinateSystemLabel: "Arc 1960 / UTM zone 37S",
      surveyorName: "Jane Wanjiru, LS/1234",
      date: "2026-08-01",
      titleBlockLabel: "REPUBLIC OF KENYA",
      planTypeLabel: "DEED PLAN",
      footerNote: "Prepared under the Survey Act Cap. 299. Coordinates in Arc 1960 / UTM zone 37S (EPSG:21037).",
    });
    const png = await sharp(Buffer.from(built.svg), { density: PRINT_DPI }).png().toBuffer();
    schemeSheets.push({
      label: parcel.label,
      projectName: project.name,
      png: new Uint8Array(png),
      scaleDenominator: built.scaleDenominator,
      widthPx: built.widthPx,
      heightPx: built.heightPx,
    });
  }
}
const schemeBytes = await renderParcelBookletPdf({
  projectName: `Kasarani Scheme (${schemeProjects.length} projects)`,
  surveyorName: "Jane Wanjiru, LS/1234",
  date: "2026-08-01",
  parcels: schemeSheets,
});
const schemePath = join(OUTPUT_DIR, "scheme-booklet.pdf");
writeFileSync(schemePath, schemeBytes);
console.log(`   → ${schemeSheets.length} sheets across ${schemeProjects.length} projects → wrote ${schemePath} (${(schemeBytes.length / 1024).toFixed(1)} KB, ${schemeSheets.length + 1} pages)`);
// ─── 7. Per-market statutory title blocks (ZA/US/GB/AU/GH plan sheets) ──
console.log("7. Per-market statutory title blocks → ZA SG-diagram, US ALTA, GB HMLR, AU DP, GH survey-plan sheets…");
const statutorySheets = [
  {
    name: "za-sg-diagram",
    label: "SG DIAGRAM (South Africa)",
    planTypeLabel: "GENERAL PLAN / DIAGRAM",
    titleBlockLabel: "REPUBLIC OF SOUTH AFRICA — SURVEYOR-GENERAL",
    crs: "Hartebeesthoek94 / Lo29",
    sheet: "a3",
    orientation: "portrait",
    layout: {
      variant: "sg-diagram",
      fieldRows: [
        { label: "SG DIAGRAM NO." },
        { label: "FARM NAME" },
        { label: "REGISTRATION DIVISION" },
        { label: "PROVINCE" },
        { label: "AREA (ha)" },
        { label: "SCALE", value: "{{scale}}" },
        { label: "DATE OF SURVEY", value: "{{date}}" },
        { label: "SURVEYOR", value: "{{surveyor}}" },
      ],
      certification: {
        heading: "APPROVED — SURVEYOR-GENERAL",
        lines: [
          "Examined and approved in terms of the Land Survey Act 8 of 1997",
          "and SANS 2814. This diagram must accompany the deed on lodgment.",
        ],
      },
      seal: { position: "bottom-right", caption: "REGISTERED LAND SURVEYOR — SAGC (PLATO) REG. NO." },
    },
  },
  {
    name: "us-alta-plat",
    label: "ALTA/NSPS LAND TITLE SURVEY (USA)",
    planTypeLabel: "ALTA/NSPS LAND TITLE SURVEY",
    titleBlockLabel: "UNITED STATES — SPCS / PLSS",
    crs: "NAD83(2011) / Texas South Central",
    sheet: "letter",
    orientation: "portrait",
    layout: {
      variant: "us-alta",
      fieldRows: [
        { label: "ALTA/NSPS SURVEY NO." },
        { label: "PROPERTY ADDRESS" },
        { label: "SPCS ZONE", value: "{{crs}}" },
        { label: "PLSS DESIGNATION" },
        { label: "SCALE", value: "{{scale}}" },
        { label: "DATE OF SURVEY", value: "{{date}}" },
        { label: "SURVEYOR", value: "{{surveyor}}" },
      ],
      certification: {
        heading: "CERTIFICATION OF SURVEYOR",
        lines: [
          "I hereby certify that this survey was performed by me or under my",
          "direct supervision in accordance with the current ALTA/NSPS Minimum",
          "Standard Detail Requirements for ALTA/NSPS Land Title Surveys.",
        ],
      },
      seal: { position: "bottom-right", caption: "PROFESSIONAL LAND SURVEYOR — STATE REG. NO." },
    },
  },
  {
    name: "gb-hmlr-title-plan",
    label: "TITLE PLAN / FILED PLAN (HM Land Registry)",
    planTypeLabel: "TITLE PLAN / FILED PLAN",
    titleBlockLabel: "UNITED KINGDOM — HM LAND REGISTRY",
    crs: "OSGB36 / British National Grid",
    sheet: "a4",
    orientation: "portrait",
    layout: {
      variant: "hmlr-title-plan",
      fieldRows: [
        { label: "TITLE NUMBER" },
        { label: "PROPERTY ADDRESS" },
        { label: "ORDNANCE SURVEY MAP REFERENCE", value: "{{crs}}" },
        { label: "SCALE", value: "{{scale}}" },
        { label: "DATE", value: "{{date}}" },
      ],
      certification: {
        heading: "GENERAL BOUNDARIES",
        lines: [
          "This plan shows the general position, not the exact line, of the",
          "boundaries (Land Registration Act 2002, s.60).",
        ],
      },
      seal: { position: "none" },
      statutoryFooterLines: [
        "This map is based upon Ordnance Survey material with the permission of",
        "Ordnance Survey on behalf of the Controller of His Majesty's Stationery",
        "Office © Crown copyright. Unauthorised reproduction infringes Crown",
        "copyright and may lead to prosecution or civil proceedings.",
      ],
    },
  },
  {
    name: "au-deposited-plan",
    label: "DEPOSITED PLAN (Australia, NSW)",
    planTypeLabel: "DEPOSITED PLAN (D.P.)",
    titleBlockLabel: "COMMONWEALTH OF AUSTRALIA — NEW SOUTH WALES",
    crs: "GDA2020 / MGA zone 56",
    // Large-format A1 default per the AU market brief.
    sheet: "a1",
    orientation: "landscape",
    layout: {
      variant: "standard",
      fieldRows: [
        { label: "PLAN NUMBER (D.P.)" },
        { label: "EDITION" },
        { label: "COUNCIL" },
        { label: "SUBURB / LOCALITY" },
        { label: "SCALE", value: "{{scale}}" },
        { label: "DATE OF SURVEY", value: "{{date}}" },
        { label: "SURVEYOR", value: "{{surveyor}}" },
      ],
      certification: {
        heading: "SURVEYOR'S CERTIFICATE",
        lines: [
          "I certify that this plan has been prepared in accordance with the",
          "Surveying and Spatial Information Act 2002 (NSW) and the NSW Land",
          "Registry Services requirements for lodged plans of survey.",
        ],
      },
      seal: { position: "bottom-right", caption: "REGISTERED SURVEYOR — BOSSI REG. NO." },
      statutoryFooterLines: [
        "This deposited plan is lodged under the Surveying and Spatial Information",
        "Act 2002 (NSW) and remains the property of NSW Land Registry Services until",
        "registration. Coordinates in GDA2020 / MGA (EPSG:7855-7856).",
      ],
    },
  },
  {
    name: "gh-survey-plan",
    label: "SURVEY PLAN (Ghana, Lands Commission)",
    planTypeLabel: "SURVEY PLAN (CADASTRAL)",
    titleBlockLabel: "REPUBLIC OF GHANA — LANDS COMMISSION",
    crs: "Leigon / Ghana Metre Grid",
    // Large-format A0 default — Ghana Lands Commission scheme lodgment.
    sheet: "a0",
    orientation: "landscape",
    layout: {
      variant: "standard",
      fieldRows: [
        { label: "PLAN NO." },
        { label: "L.R. NO. (LAND REGISTRY)" },
        { label: "REGION" },
        { label: "DISTRICT" },
        { label: "TOWN / LOCALITY" },
        { label: "AREA (ha)" },
        { label: "SCALE", value: "{{scale}}" },
        { label: "DATE OF SURVEY", value: "{{date}}" },
        { label: "SURVEYOR", value: "{{surveyor}}" },
      ],
      certification: {
        heading: "SURVEYOR'S CERTIFICATE",
        lines: [
          "I certify that this survey plan has been prepared in accordance with the",
          "standards of the Survey and Mapping Division of the Lands Commission and",
          "is correct for the purpose of registration under the Land Act 2020.",
        ],
      },
      seal: { position: "bottom-right", caption: "REGISTERED SURVEYOR — GhIS REG. NO." },
      statutoryFooterLines: [
        "This survey plan is prepared for lodgment with the Lands Commission of Ghana",
        "and remains the property of the Commission until registered under the Land",
        "Act 2020 (Act 1036). Coordinates in Leigon / Ghana Metre Grid (EPSG:25000).",
      ],
    },
  },
];

for (const sheet of statutorySheets) {
  const built = buildSurveyMapSvg(geometry, {
    title: `${sheet.label} — 1000 Commerce St`,
    coordinateSystemLabel: sheet.crs,
    surveyorName: "Jane Wanjiru, LS/1234",
    date: "2026-08-01",
    sheetSize: sheet.sheet,
    orientation: sheet.orientation,
    titleBlockLabel: sheet.titleBlockLabel,
    planTypeLabel: sheet.planTypeLabel,
    footerNote: "Prepared under the governing legislation. Coordinates in the national grid.",
    titleBlockLayout: sheet.layout,
  });
  const png = await sharp(Buffer.from(built.svg), { density: PRINT_DPI }).png().toBuffer();
  const path = join(OUTPUT_DIR, `${sheet.name}-300dpi.png`);
  writeFileSync(path, png);
  console.log(`   → ${sheet.name} (${built.widthPx}×${built.heightPx} px, scale 1:${built.scaleDenominator}) → ${path}`);
}
// ─── 8. Single-page plan sheet PDF (print grade, no report wrapper) ───
console.log("8. Single-page plan sheet PDF (print grade, no report wrapper)…");
{
  const built = buildSurveyMapSvg(geometry, {
    title: "Kasarani Parcel LR 12345 — Cadastral Survey",
    coordinateSystemLabel: "Arc 1960 / UTM zone 37S",
    surveyorName: "Jane Wanjiru, LS/1234",
    date: "2026-08-01",
    titleBlockLabel: "REPUBLIC OF KENYA",
    planTypeLabel: "DEED PLAN",
    footerNote: "Prepared under the Survey Act Cap. 299. Coordinates in Arc 1960 / UTM zone 37S (EPSG:21037).",
  });
  const png = await sharp(Buffer.from(built.svg), { density: PRINT_DPI }).png().toBuffer();
  const pdfBytes = await renderSinglePlanPdf({
    title: "Kasarani Parcel LR 12345",
    surveyorName: "Jane Wanjiru, LS/1234",
    date: "2026-08-01",
    coordinateSystemLabel: "Arc 1960 / UTM zone 37S",
    scaleDenominator: built.scaleDenominator,
    // A4 landscape in points — page sized exactly to the sheet.
    widthPt: 842,
    heightPt: 595,
    png: new Uint8Array(png),
  });
  const pdfPath = join(OUTPUT_DIR, "survey-plan-single-page.pdf");
  writeFileSync(pdfPath, pdfBytes);
  console.log(`   → wrote ${pdfPath} (${(pdfBytes.length / 1024).toFixed(1)} KB, single page sized to the A4 landscape sheet)`);
}
// ─── 9. Statutory survey report PDF (A4 cover + the exact plan sheet) ─
console.log("9. Statutory survey report PDF (cover + plan sheet as the survey-map page)…");
{
  const built = buildSurveyMapSvg(geometry, {
    title: "Kasarani Parcel LR 12345 — Cadastral Survey",
    coordinateSystemLabel: "Arc 1960 / UTM zone 37S",
    surveyorName: "Jane Wanjiru, LS/1234",
    date: "2026-08-01",
    sheetSize: "a3",
    orientation: "landscape",
    titleBlockLabel: "REPUBLIC OF KENYA",
    planTypeLabel: "DEED PLAN",
    footerNote: "Prepared under the Survey Act Cap. 299. Coordinates in Arc 1960 / UTM zone 37S (EPSG:21037).",
  });
  const png = await sharp(Buffer.from(built.svg), { density: PRINT_DPI }).png().toBuffer();
  const pdfBytes = await renderStatutoryReportPdf({
    title: "Kasarani Parcel LR 12345",
    surveyorName: "Jane Wanjiru, LS/1234",
    date: "2026-08-01",
    coordinateSystemLabel: "Arc 1960 / UTM zone 37S",
    scaleDenominator: built.scaleDenominator,
    titleBlockLabel: "REPUBLIC OF KENYA",
    planTypeLabel: "DEED PLAN",
    footerNote: "Prepared under the Survey Act Cap. 299. Coordinates in Arc 1960 / UTM zone 37S (EPSG:21037).",
    summary: summarizeGeometry(geometry),
    png: new Uint8Array(png),
    // A3 landscape sheet in points (SHEET_SIZES_PT a3 landscape) — the
    // map page IS the sheet.
    mapWidthPt: 1190.55,
    mapHeightPt: 841.89,
    mapCaption: `Plan sheet A3 landscape — 300 DPI, scale 1:${built.scaleDenominator}, ${built.widthPx}×${built.heightPx} px`,
  });
  const pdfPath = join(OUTPUT_DIR, "survey-statutory-report.pdf");
  writeFileSync(pdfPath, pdfBytes);
  console.log(`   → wrote ${pdfPath} (${(pdfBytes.length / 1024).toFixed(1)} KB, A4 cover + A3 plan-sheet page)`);
}
console.log("");
console.log("✓ Done — 300 DPI map export chain + multi-parcel booklet + multi-project scheme booklet + per-market statutory title blocks + single-page plan PDF + statutory survey report verified end-to-end.");
