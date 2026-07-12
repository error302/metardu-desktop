/**
 * Integration test for the three new statutory forms:
 *   1. Form P — Mutation Form
 *   2. Surveyor's Report (Topographical)
 *   3. Cross-Section Sheets (Engineering)
 *
 * Each form is generated, validated for:
 *   - PDF structure (header, page count, file size)
 *   - Required content sections
 *   - RSA-2048 seal applied
 */

import { build } from 'esbuild';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'exports');
const TMP_DIR = '/tmp/metardu-test';

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });

const electronStub = `
export const app = {
  getPath: (name) => '/tmp/metardu-test/' + name,
  getVersion: () => '0.1.0-test',
};
export const ipcMain = { handle: () => {} };
export const BrowserWindow = class {};
`;
const electronLogStub = `
export default {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
};
`;
writeFileSync(join(TMP_DIR, 'electron-stub.js'), electronStub);
writeFileSync(join(TMP_DIR, 'electron-log-stub.js'), electronLogStub);

// ─── Shared test fixtures ──────────────────────────────────────────────

const surveyor = {
  name: "John M. Kamau",
  license: "LSK/0481",
  firmName: "Kamau & Associates Surveyors Ltd",
  postalAddress: "P.O. Box 12345-00100, Nairobi",
  phoneNumber: "+254 722 123 456",
  email: "jkamau@kamau-surveyors.co.ke",
};

const projectBase = {
  name: "Test Survey Project",
  parcelNumber: "PLOT/247/15",
  lrNumber: "LR Kiambu/Riruta/247/15",
  county: "Kiambu",
  subCounty: "Kabete",
  locality: "Riruta",
  surveyDate: "2026-07-13",
  projection: "Cassini-Soldner (Arc 1960)",
  datum: "Arc 1960",
  zone: "37S",
  directorOfSurveysRef: "DS/KBU/2026/0481",
};

// ─── Test 1: Form P (Mutation) ─────────────────────────────────────────

const formPInput = {
  project: {
    ...projectBase,
    mutationType: "subdivision",
    registry: "Kiambu",
    originalGrant: "GRANT/KBU/1978/234",
    titleNumber: "Title Kiambu/Riruta/247/15",
  },
  surveyor,
  parentParcel: {
    parcelNumber: "PLOT/247/15 (original)",
    lrNumber: "LR Kiambu/Riruta/247/15",
    registry: "Kiambu",
    titleNumber: "Title Kiambu/Riruta/247/15",
    areaSqM: 28750.500,
    perimeter: 645.34,
    ownerName: "Wanjiru Kamau",
    ownerPno: "P/NO 789012",
    pointCount: 9,
    beaconCount: 9,
  },
  newParcels: [
    { parcelNumber: "PLOT/247/15/1", areaSqM: 8500.250, perimeter: 380.12, pointCount: 4, beaconCount: 4, purpose: "Residential", proposedOwner: "Peter Kamau", proposedOwnerPno: "P/NO 789013" },
    { parcelNumber: "PLOT/247/15/2", areaSqM: 9250.750, perimeter: 415.78, pointCount: 4, beaconCount: 4, purpose: "Residential", proposedOwner: "Mary Wanjiru", proposedOwnerPno: "P/NO 789014" },
    { parcelNumber: "PLOT/247/15/3", areaSqM: 7800.500, perimeter: 355.45, pointCount: 4, beaconCount: 4, purpose: "Commercial", proposedOwner: "Kamau Holdings Ltd", proposedOwnerPno: "P/NO 789015" },
  ],
  extinguishedBeacons: [
    { number: "OLD1", reason: "Subsumed into new parcel boundary PLOT/247/15/1" },
    { number: "OLD2", reason: "Replaced by new beacon P5 (concrete)" },
  ],
  newBeacons: [
    { number: "P1", type: "concrete", easting: 256355.528, northing: 9856470.476, description: "NE corner of PLOT/247/15/1" },
    { number: "P2", type: "concrete", easting: 256433.633, northing: 9856463.242, description: "SE corner of PLOT/247/15/2" },
    { number: "P3", type: "iron_pin", easting: 256484.867, northing: 9856421.675, description: "SE corner of PLOT/247/15/3" },
    { number: "P4", type: "iron_pin", easting: 256461.411, northing: 9856342.752, description: "SW corner of PLOT/247/15/3" },
    { number: "P5", type: "stone", easting: 256422.844, northing: 9856315.629, description: "SW corner of PLOT/247/15/2" },
  ],
  balanceArea: { areaSqM: 3199.000, purpose: "Internal access road (6m wide)" },
  outputPath: join(OUT_DIR, 'form-p-mutation-test.pdf'),
  sealWithRSA: true,
};

// ─── Test 2: Topo Surveyor's Report ────────────────────────────────────

const topoReportInput = {
  project: {
    ...projectBase,
    name: "Thika Road Topographical Survey",
    parcelNumber: "LR 209/4478",
    lrNumber: "LR Nairobi/Kasarani/209/4478",
    county: "Nairobi",
    subCounty: "Kasarani",
    locality: "Kasarani",
    clientName: "Nairobi County Government",
    clientPno: "P/NO 456789",
    purposeOfSurvey: "Proposed road expansion and drainage design",
    approximateArea: 45000.0,
    adjacentParcelNumbers: ["LR 209/4477", "LR 209/4479"],
  },
  surveyor,
  methodology: {
    controlEstablishment: "Two control stations established using static GNSS with 2-hour observation sessions, processed against 3 CORS stations. Network accuracy: ±3mm + 0.5ppm.",
    detailSurvey: "Detail points picked up using RTK-GNSS (Trimble R10) with total station (Topcon GPT-7501) backup in built-up areas with poor sky visibility. Breaklines observed along all road edges, building footprints, and drainage channels.",
    equipment: [
      { instrument: "Trimble R10 GNSS Receiver", serialNumber: "R10-5478213", calibrationDate: "2026-04-15" },
      { instrument: "Topcon GPT-7501 Total Station", serialNumber: "GPT7501-89234", calibrationDate: "2026-03-22" },
      { instrument: "Trimble TSC7 Controller", serialNumber: "TSC7-445612", calibrationDate: "2026-04-15" },
    ],
    weatherConditions: "Partly cloudy, 22-26°C, light winds. Conditions suitable for GNSS and total station observations.",
    fieldCrew: [
      { name: "John M. Kamau", role: "Surveyor (Team Leader)" },
      { name: "Peter Mutua", role: "Senior Technician" },
      { name: "Grace Achieng", role: "Technician" },
      { name: "David Omondi", role: "Survey Assistant" },
    ],
  },
  controlNetwork: {
    stations: [
      { number: "TS1", easting: 256320.000, northing: 9856435.000, elevation: 1825.234, order: "1st order", method: "Static GNSS 2hr session" },
      { number: "TS2", easting: 256890.123, northing: 9856890.456, elevation: 1828.567, order: "1st order", method: "Static GNSS 2hr session" },
    ],
    accuracyAchieved: "±5mm + 1ppm horizontal, ±10mm vertical",
  },
  detailPoints: {
    totalPoints: 1847,
    byCategory: [
      { category: "Buildings", count: 312 },
      { category: "Road edges", count: 425 },
      { category: "Spot levels", count: 678 },
      { category: "Drainage", count: 156 },
      { category: "Utilities", count: 198 },
      { category: "Vegetation", count: 78 },
    ],
    breaklines: 89,
  },
  deliverables: [
    { name: "Topographic Plan", format: "A1 PDF + DXF + Shapefile", sheetCount: 4 },
    { name: "Digital Elevation Model", format: "GeoTIFF (0.5m grid)" },
    { name: "Contour Plan", format: "DXF + PDF (0.5m interval)" },
    { name: "Surveyor's Report", format: "PDF (this document)" },
    { name: "Control Schedule", format: "PDF + CSV" },
  ],
  accuracy: {
    horizontalRMSE: 0.012,
    verticalRMSE: 0.018,
    contourInterval: 0.5,
    demResolution: 0.5,
  },
  outputPath: join(OUT_DIR, 'topo-surveyors-report-test.pdf'),
  sealWithRSA: true,
};

// ─── Test 3: Cross-Section Sheets ──────────────────────────────────────

const crossSectionInput = {
  project: {
    ...projectBase,
    name: "Thika Superhighway Expansion — Section 3",
    parcelNumber: "ROAD/THIKA/SEC3",
    lrNumber: "LR Road Reserve",
    county: "Kiambu",
    subCounty: "Thika",
    locality: "Thika",
    roadName: "Thika Superhighway",
    roadClass: "Class A",
    chainageStart: 12000,
    chainageEnd: 12500,
    designSpeed: 100,
    totalLength: 500,
  },
  surveyor,
  crossSections: Array.from({ length: 11 }, (_, i) => {
    const chainage = 12000 + i * 50;
    // Generate a realistic cross-section
    const existingGround = [
      { offset: -15, elevation: 1825.5 + i * 0.1 },
      { offset: -10, elevation: 1825.8 + i * 0.1 },
      { offset: -5, elevation: 1825.2 + i * 0.1 },
      { offset: 0, elevation: 1825.0 + i * 0.1 },
      { offset: 5, elevation: 1825.3 + i * 0.1 },
      { offset: 10, elevation: 1825.7 + i * 0.1 },
      { offset: 15, elevation: 1826.1 + i * 0.1 },
    ];
    const designLevel = [
      { offset: -15, elevation: 1824.0 + i * 0.1 },
      { offset: -10, elevation: 1824.5 + i * 0.1 },
      { offset: -5, elevation: 1824.8 + i * 0.1 },
      { offset: 0, elevation: 1825.0 + i * 0.1 },
      { offset: 5, elevation: 1824.8 + i * 0.1 },
      { offset: 10, elevation: 1824.5 + i * 0.1 },
      { offset: 15, elevation: 1824.0 + i * 0.1 },
    ];
    const cutDepth = existingGround[3].elevation - designLevel[3].elevation;
    return {
      chainage,
      existingGround,
      designLevel,
      cutArea: cutDepth > 0 ? Math.abs(cutDepth) * 7.5 : 0,
      fillArea: cutDepth < 0 ? Math.abs(cutDepth) * 7.5 : 0,
      cutDepth,
    };
  }),
  earthworksSummary: {
    totalCutVolume: 1247.5,
    totalFillVolume: 892.3,
    netVolume: 355.2,
    averageCutDepth: 0.245,
    averageFillHeight: 0.178,
    haulDistance: 250,
  },
  outputPath: join(OUT_DIR, 'cross-sections-test.pdf'),
  sealWithRSA: true,
};

// ─── Test runner ───────────────────────────────────────────────────────

async function runTest(name, input, expectedChecks) {
  console.log();
  console.log('─'.repeat(70));
  console.log(`TEST: ${name}`);
  console.log('─'.repeat(70));

  // Clean output
  if (existsSync(input.outputPath)) unlinkSync(input.outputPath);
  if (existsSync(input.outputPath + '.cert.tmp')) unlinkSync(input.outputPath + '.cert.tmp');

  // Build
  const entryFile = join(ROOT, 'apps/desktop/electron/statutory-forms.ts');
  const outfile = join(ROOT, 'scripts', 'statutory-forms.bundled.cjs');

  await build({
    entryPoints: [entryFile],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile,
    alias: {
      'electron': join(TMP_DIR, 'electron-stub.js'),
      'electron-log/main': join(TMP_DIR, 'electron-log-stub.js'),
    },
    logLevel: 'warning',
    external: ['pdfkit', 'pdf-lib', 'fontkit', 'crypto'],
  });

  const mod = await import(`file://${outfile}`);
  let result;
  if (name.includes('Form P')) {
    result = await mod.generateFormP(input);
  } else if (name.includes('Topo')) {
    result = await mod.generateTopoSurveyorsReport(input);
  } else if (name.includes('Cross-Section')) {
    result = await mod.generateCrossSectionSheets(input);
  } else {
    throw new Error('Unknown test: ' + name);
  }

  console.log(`  pdfPath:     ${result.pdfPath}`);
  console.log(`  size:        ${result.pdfSizeBytes} bytes`);
  console.log(`  pageCount:   ${result.pageCount}`);
  console.log(`  sealed:      ${result.sealed}`);
  console.log(`  fingerprint: ${result.signatureFingerprint?.substring(0, 24)}…`);
  console.log(`  warnings:    ${result.warnings.length}`);

  // Verify file size
  if (result.pdfSizeBytes < 5000) {
    throw new Error(`PDF too small: ${result.pdfSizeBytes} bytes`);
  }
  if (result.pdfSizeBytes > 1_000_000) {
    throw new Error(`PDF too large: ${result.pdfSizeBytes} bytes`);
  }
  console.log(`  PASS — file size OK`);

  // Verify PDF header
  const pdfBytes = readFileSync(result.pdfPath);
  const pdfText = pdfBytes.toString('latin1');
  if (!pdfText.startsWith('%PDF-1.')) {
    throw new Error('Not a valid PDF');
  }
  console.log(`  PASS — valid PDF header`);

  // Verify pages using pdf-lib
  const { PDFDocument } = await import('pdf-lib');
  const parsed = await PDFDocument.load(pdfBytes);
  const pageCount = parsed.getPageCount();
  console.log(`  PASS — ${pageCount} pages (expected >= ${expectedChecks.minPages})`);
  if (pageCount < expectedChecks.minPages) {
    throw new Error(`Too few pages: ${pageCount} < ${expectedChecks.minPages}`);
  }

  // Extract text using pdfjs-dist
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const path = await import('node:path');
  const standardFontDataUrl = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/';
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    standardFontDataUrl,
    disableFontFace: true,
  });
  const pdfDoc = await loadingTask.promise;
  let extractedText = '';
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (item.str) extractedText += item.str + ' ';
    }
    extractedText += '\n--- PAGE BREAK ---\n';
  }
  console.log(`  Extracted ${extractedText.length} chars of text`);

  // Verify content
  let passCount = 0;
  let failCount = 0;
  for (const check of expectedChecks.contentPatterns) {
    if (check.pattern.test(extractedText)) {
      console.log(`  PASS — ${check.name}`);
      passCount++;
    } else {
      console.log(`  FAIL — ${check.name}`);
      failCount++;
    }
  }

  // Verify seal
  if (!result.sealed) {
    throw new Error('RSA seal was not applied');
  }
  console.log(`  PASS — RSA-2048 seal applied`);

  return { passCount, failCount, totalChecks: expectedChecks.contentPatterns.length };
}

// ─── Main ──────────────────────────────────────────────────────────────

console.log('='.repeat(70));
console.log('METARDU Desktop — Statutory Forms Integration Test');
console.log('='.repeat(70));

const results = [];

// Test 1: Form P
results.push({
  name: 'Form P (Mutation)',
  result: await runTest('Form P (Mutation)', formPInput, {
    minPages: 4,
    contentPatterns: [
      { name: 'Form P title', pattern: /FORM P/ },
      { name: 'Application for subdivision', pattern: /APPLICATION FOR SUBDIVISION/ },
      { name: 'Reg 38 reference', pattern: /Regulation 38|Reg 38/ },
      { name: 'Parent parcel section', pattern: /PARENT PARCEL/i },
      { name: 'Parent parcel number', pattern: /PLOT\/247\/15/ },
      { name: 'Parent area', pattern: /28,750\.500/ },
      { name: 'New parcels schedule', pattern: /SCHEDULE OF NEW PARCELS/i },
      { name: 'New parcel 1', pattern: /PLOT\/247\/15\/1/ },
      { name: 'New parcel 2', pattern: /PLOT\/247\/15\/2/ },
      { name: 'New parcel 3', pattern: /PLOT\/247\/15\/3/ },
      { name: 'Beacons affected section', pattern: /BEACONS AFFECTED/i },
      { name: 'Extinguished beacons', pattern: /Extinguished/i },
      { name: 'New beacons', pattern: /New Beacons Placed/i },
      { name: 'Director of Surveys block', pattern: /DIRECTOR OF SURVEYS/i },
      { name: 'Area reconciliation', pattern: /RECONCILIATION/i },
      { name: 'Certificate heading', pattern: /SURVEYOR.S CERTIFICATE/i },
      { name: 'Cap 299 reference', pattern: /Cap\.?\s*299/ },
      { name: 'RSA-SHA256', pattern: /RSA-SHA256/ },
      { name: 'Key fingerprint', pattern: /[0-9a-f]{64}/i },
      { name: 'Surveyor name', pattern: /John M\. Kamau/ },
      { name: 'License number', pattern: /LSK\/0481/ },
    ],
  }),
});

// Test 2: Topo Report
results.push({
  name: "Topo Surveyor's Report",
  result: await runTest("Topo Surveyor's Report", topoReportInput, {
    minPages: 5,
    contentPatterns: [
      { name: 'Report title', pattern: /SURVEYOR.S REPORT/i },
      { name: 'Topographical subtitle', pattern: /TOPOGRAPHICAL SURVEY/ },
      { name: 'Project name', pattern: /Thika Road Topographical/ },
      { name: 'Client name', pattern: /Nairobi County Government/ },
      { name: 'Purpose of survey', pattern: /road expansion/i },
      { name: 'Methodology section', pattern: /SURVEY METHODOLOGY/i },
      { name: 'Control establishment', pattern: /Control Establishment/i },
      { name: 'Equipment table', pattern: /EQUIPMENT USED/i },
      { name: 'Trimble R10', pattern: /Trimble R10/ },
      { name: 'Field crew', pattern: /FIELD CREW/i },
      { name: 'Control network section', pattern: /CONTROL NETWORK/i },
      { name: 'Accuracy achieved', pattern: /±5mm/i },
      { name: 'Detail points', pattern: /DETAIL POINTS OBSERVED/i },
      { name: 'Total points 1847', pattern: /1,847/ },
      { name: 'Breaklines', pattern: /Breaklines/i },
      { name: 'Accuracy section', pattern: /ACCURACY ACHIEVED/i },
      { name: 'Horizontal RMSE', pattern: /0\.012/ },
      { name: 'Vertical RMSE', pattern: /0\.018/ },
      { name: 'Contour interval', pattern: /0\.5 m/i },
      { name: 'Deliverables', pattern: /DELIVERABLES/i },
      { name: 'Certificate', pattern: /SURVEYOR.S CERTIFICATE/i },
      { name: 'Cap 299', pattern: /Cap\.?\s*299/ },
      { name: 'RSA-SHA256', pattern: /RSA-SHA256/ },
    ],
  }),
});

// Test 3: Cross-Sections
results.push({
  name: 'Cross-Section Sheets',
  result: await runTest('Cross-Section Sheets', crossSectionInput, {
    minPages: 4,
    contentPatterns: [
      { name: 'Title', pattern: /CROSS-SECTION SHEETS/i },
      { name: 'Road name', pattern: /Thika Superhighway/ },
      { name: 'Road class', pattern: /Class A/ },
      { name: 'RDM 1.1 reference', pattern: /RDM 1\.1/ },
      { name: 'Design speed', pattern: /100 km\/h/ },
      { name: 'Chainage start', pattern: /CH 12000/ },
      { name: 'Chainage end', pattern: /CH 12500/ },
      { name: 'Earthworks summary', pattern: /EARTHWORKS SUMMARY/i },
      { name: 'Total cut volume', pattern: /1,247\.500 m³/ },
      { name: 'Total fill volume', pattern: /892\.300 m³/ },
      { name: 'Net volume', pattern: /355\.200 m³/ },
      { name: 'Cross-section tables', pattern: /CROSS-SECTION TABLES/i },
      { name: 'Chainage 12050', pattern: /CHAINAGE 12050/ },
      { name: 'Existing ground header', pattern: /EXISTING GROUND/i },
      { name: 'Cut/fill status', pattern: /CUT|FILL/ },
      { name: 'Offset values', pattern: /Offset/i },
      { name: 'Design level', pattern: /Design Level/i },
      { name: 'Certificate', pattern: /SURVEYOR.S CERTIFICATE/i },
      { name: 'RSA-SHA256', pattern: /RSA-SHA256/ },
    ],
  }),
});

// ─── Summary ───────────────────────────────────────────────────────────

console.log();
console.log('='.repeat(70));
console.log('SUMMARY');
console.log('='.repeat(70));

let totalPass = 0, totalFail = 0, totalChecks = 0;
for (const r of results) {
  console.log(`  ${r.name.padEnd(30)} — ${r.result.passCount}/${r.result.totalChecks} content checks passed, ${r.result.failCount} failed`);
  totalPass += r.result.passCount;
  totalFail += r.result.failCount;
  totalChecks += r.result.totalChecks;
}
console.log();
console.log(`TOTAL: ${totalPass}/${totalChecks} content checks passed, ${totalFail} failed`);

if (totalFail === 0) {
  console.log();
  console.log('='.repeat(70));
  console.log('ALL TESTS PASSED — Three new statutory forms are production-ready');
  console.log('='.repeat(70));
} else {
  process.exit(1);
}
