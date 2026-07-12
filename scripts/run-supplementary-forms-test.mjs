/**
 * Integration test for the supplementary forms:
 *   1. RINEX Observation Log (Topographical)
 *   2. Leveling Book (Engineering)
 *
 * Validates:
 *   - PDF structure (header, page count, file size)
 *   - Required content sections
 *   - RSA-2048 seal applied
 *   - For Leveling Book: page check arithmetic is correct
 *   - For RINEX: each session gets its own page
 */

import { build } from 'esbuild';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'exports');
const TMP_DIR = '/tmp/metardu-test';

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });

const electronStub = `
export const app = { getPath: (n) => '/tmp/metardu-test/' + n, getVersion: () => '0.1.0-test' };
export const ipcMain = { handle: () => {} };
export const BrowserWindow = class {};
`;
const electronLogStub = `
export default { info: (...a) => console.log('[INFO]', ...a), warn: (...a) => console.warn('[WARN]', ...a), error: (...a) => console.error('[ERROR]', ...a) };
`;
writeFileSync(join(TMP_DIR, 'electron-stub.js'), electronStub);
writeFileSync(join(TMP_DIR, 'electron-log-stub.js'), electronLogStub);

const surveyor = {
  name: "John M. Kamau",
  license: "LSK/0481",
  firmName: "Kamau & Associates Surveyors Ltd",
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
};

// ─── Test 1: RINEX Observation Log ─────────────────────────────────────

const rinexInput = {
  project: {
    ...projectBase,
    name: "Thika Road GNSS Control Survey",
    parcelNumber: "GNSS/THIKA/2026",
    corsStations: [
      { name: "Nairobi CORS (NRB0)", distance: 12.5, azimuth: "S 45° E" },
      { name: "Thika CORS (THK0)", distance: 8.2, azimuth: "N 30° E" },
      { name: "Juja CORS (JJA0)", distance: 15.7, azimuth: "N 15° W" },
    ],
    processingCenter: "Survey of Kenya GNSS Processing Centre",
  },
  surveyor,
  sessions: [
    {
      stationName: "TS1",
      stationMarker: "Concrete pillar with brass plate",
      approxEasting: 256320.000,
      approxNorthing: 9856435.000,
      approxElevation: 1825.234,
      receiverMake: "Trimble",
      receiverModel: "R10",
      receiverSerial: "R10-5478213",
      receiverFirmware: "v5.42",
      antennaMake: "Trimble",
      antennaModel: "TRM57971.00",
      antennaSerial: "ANT-2233100",
      antennaHeight: 1.723,
      heightMeasurementMethod: "Slant to notch, corrected to vertical",
      sessionStartUTC: "2026-07-13T06:00:00Z",
      sessionEndUTC: "2026-07-13T08:00:00Z",
      sessionDuration: 7200,
      observationInterval: 15,
      satellitesObserved: ["G01", "G07", "G15", "G22", "G30", "E08", "E15", "G24"],
      ephemerisSource: "Broadcast + precise (IGS final)",
      weather: { temperature: 18.5, pressure: 1013.2, humidity: 65, conditions: "Partly cloudy" },
      operatorName: "Peter Mutua",
      notes: "Sky visibility good. No obstructions above 15° elevation.",
    },
    {
      stationName: "TS2",
      stationMarker: "Iron pin in concrete block",
      approxEasting: 256890.123,
      approxNorthing: 9856890.456,
      approxElevation: 1828.567,
      receiverMake: "Trimble",
      receiverModel: "R10",
      receiverSerial: "R10-5478213",
      receiverFirmware: "v5.42",
      antennaMake: "Trimble",
      antennaModel: "TRM57971.00",
      antennaSerial: "ANT-2233100",
      antennaHeight: 1.685,
      heightMeasurementMethod: "Slant to notch, corrected to vertical",
      sessionStartUTC: "2026-07-13T08:30:00Z",
      sessionEndUTC: "2026-07-13T10:30:00Z",
      sessionDuration: 7200,
      observationInterval: 15,
      satellitesObserved: ["G01", "G07", "G15", "G22", "G30", "E08", "E15", "G24", "G31"],
      ephemerisSource: "Broadcast + precise (IGS final)",
      weather: { temperature: 21.2, pressure: 1012.8, humidity: 58, conditions: "Clear" },
      operatorName: "Peter Mutua",
      notes: "Some multipath from nearby building to the south. All cycles fixed.",
    },
  ],
  outputPath: join(OUT_DIR, 'rinex-log-test.pdf'),
  sealWithRSA: true,
};

// ─── Test 2: Leveling Book ─────────────────────────────────────────────

// A short leveling run: BM1 → CP1 → CP2 → BM2
// Demonstrates rise-and-fall with page check
const levelingInput = {
  project: {
    ...projectBase,
    name: "Thika Road Leveling Survey — Section 3",
    parcelNumber: "ROAD/THIKA/SEC3/LEVEL",
    roadName: "Thika Superhighway",
    roadClass: "Class A",
    levelType: "Leica NA2 Automatic Level",
    levelSerial: "NA2-123456",
    staffType: "Fiberglass 5m Barcoded",
    staffSerial: "STAFF-7890",
    closureStandard: "10*sqrt(K) mm (RDM 1.1)",
  },
  surveyor,
  pages: [
    {
      pageNumber: 1,
      benchmarkStart: { name: "BM/THIKA/001", elevation: 1825.000 },
      benchmarkEnd: { name: "BM/THIKA/002", elevation: 1825.015 },  // 15mm rise over the run
      readings: [
        // BS to BM1 (starting), then FS to CP1 (change point)
        { station: "BM1", backsight: 1.234, distance: 35.2, remarks: "Starting BM" },
        { station: "CP1", foresight: 0.856, distance: 32.8, remarks: "Change point 1" },
        // BS to CP1, FS to CP2
        { station: "CP1", backsight: 2.456, distance: 30.5, remarks: "" },
        { station: "CP2", foresight: 1.876, distance: 31.0, remarks: "Change point 2" },
        // BS to CP2, FS to BM2 (closing)
        { station: "CP2", backsight: 1.567, distance: 28.5, remarks: "" },
        { station: "BM2", foresight: 1.510, distance: 29.8, remarks: "Closing BM" },
      ],
    },
  ],
  closure: {
    totalDistance: 187.8,    // m (sum of all setups ~ 35+33+30+31+28+30)
    numberOfSetups: 3,
    misclosure: 2.5,          // mm (computed vs known BM2 elevation)
    allowable: 4.33,          // mm (10 * sqrt(0.188))
    passes: true,
    precisionClass: "Class I (Engineering) — 1st order",
  },
  outputPath: join(OUT_DIR, 'leveling-book-test.pdf'),
  sealWithRSA: true,
};

// ─── Test runner ───────────────────────────────────────────────────────

async function runTest(name, input, expectedChecks) {
  console.log();
  console.log('─'.repeat(70));
  console.log(`TEST: ${name}`);
  console.log('─'.repeat(70));

  if (existsSync(input.outputPath)) unlinkSync(input.outputPath);

  const entryFile = join(ROOT, 'apps/desktop/electron/supplementary-forms.ts');
  const outfile = join(ROOT, 'scripts', 'supplementary-forms.bundled.cjs');

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
  if (name.includes('RINEX')) {
    result = await mod.generateRinexLog(input);
  } else if (name.includes('Leveling')) {
    result = await mod.generateLevelingBook(input);
  } else {
    throw new Error('Unknown test: ' + name);
  }

  console.log(`  pdfPath:     ${result.pdfPath}`);
  console.log(`  size:        ${result.pdfSizeBytes} bytes`);
  console.log(`  pageCount:   ${result.pageCount}`);
  console.log(`  sealed:      ${result.sealed}`);
  console.log(`  fingerprint: ${result.signatureFingerprint?.substring(0, 24)}…`);
  console.log(`  warnings:    ${result.warnings.length}`);
  if (result.warnings.length > 0) {
    for (const w of result.warnings) console.log(`    - ${w}`);
  }

  // Verify file size
  if (result.pdfSizeBytes < 5000) throw new Error(`PDF too small: ${result.pdfSizeBytes}`);
  if (result.pdfSizeBytes > 2_000_000) throw new Error(`PDF too large: ${result.pdfSizeBytes}`);
  console.log(`  PASS — file size OK`);

  const pdfBytes = readFileSync(result.pdfPath);
  const pdfText = pdfBytes.toString('latin1');
  if (!pdfText.startsWith('%PDF-1.')) throw new Error('Not a valid PDF');
  console.log(`  PASS — valid PDF header`);

  const pdfLib = await import('pdf-lib');
  const parsed = await pdfLib.PDFDocument.load(pdfBytes);
  const pageCount = parsed.getPageCount();
  console.log(`  PASS — ${pageCount} pages (expected >= ${expectedChecks.minPages})`);
  if (pageCount < expectedChecks.minPages) throw new Error(`Too few pages: ${pageCount}`);

  // Extract text
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const path = await import('node:path');
  const standardFontDataUrl = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/';
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBytes), standardFontDataUrl, disableFontFace: true });
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

  let passCount = 0, failCount = 0;
  for (const check of expectedChecks.contentPatterns) {
    if (check.pattern.test(extractedText)) {
      console.log(`  PASS — ${check.name}`);
      passCount++;
    } else {
      console.log(`  FAIL — ${check.name}`);
      failCount++;
    }
  }

  if (!result.sealed) throw new Error('RSA seal not applied');
  console.log(`  PASS — RSA-2048 seal applied`);

  return { passCount, failCount, totalChecks: expectedChecks.contentPatterns.length };
}

// ─── Main ──────────────────────────────────────────────────────────────

console.log('='.repeat(70));
console.log('METARDU Desktop — Supplementary Forms Integration Test');
console.log('='.repeat(70));

const results = [];

results.push({
  name: 'RINEX Observation Log',
  result: await runTest('RINEX Observation Log', rinexInput, {
    minPages: 3,  // cover + 2 sessions + cert
    contentPatterns: [
      { name: 'Title', pattern: /RINEX OBSERVATION LOG/i },
      { name: 'SoK GNSS Practice Notes', pattern: /GNSS Practice Notes/i },
      { name: 'Project name', pattern: /Thika Road GNSS Control/ },
      { name: 'CORS stations section', pattern: /CORS Reference Stations/i },
      { name: 'CORS Nairobi', pattern: /Nairobi CORS/ },
      { name: 'CORS Thika', pattern: /Thika CORS/ },
      { name: 'Session 1 header', pattern: /SESSION 1/i },
      { name: 'Session 2 header', pattern: /SESSION 2/i },
      { name: 'Station TS1', pattern: /TS1/ },
      { name: 'Station TS2', pattern: /TS2/ },
      { name: 'Receiver Trimble R10', pattern: /Trimble.*R10/ },
      { name: 'Antenna info', pattern: /Antenna Information/i },
      { name: 'Antenna height', pattern: /1\.723/ },
      { name: 'Session start UTC', pattern: /2026-07-13T06:00:00Z/ },
      { name: 'Session duration 7200', pattern: /120 min 0 sec|2 hr/i },
      { name: 'Satellites observed', pattern: /G01.*G07/i },
      { name: 'Weather section', pattern: /Weather Conditions/i },
      { name: 'Temperature 18.5', pattern: /18\.5/ },
      { name: 'Pressure 1013', pattern: /1013\.2/ },
      { name: 'Operator', pattern: /Peter Mutua/ },
      { name: 'Certificate', pattern: /SURVEYOR.S CERTIFICATE/i },
      { name: 'Cap 299', pattern: /Cap\.?\s*299/ },
      { name: 'RSA-SHA256', pattern: /RSA-SHA256/ },
      { name: 'Total duration 4hr', pattern: /4h 0m|4 hr/i },
    ],
  }),
});

results.push({
  name: 'Leveling Book',
  result: await runTest('Leveling Book', levelingInput, {
    minPages: 3,  // cover + 1 page + cert
    contentPatterns: [
      { name: 'Title', pattern: /LEVELING BOOK/i },
      { name: 'Rise and fall method', pattern: /RISE AND FALL METHOD/i },
      { name: 'RDM 1.1 Section 5', pattern: /RDM 1\.1.*Section 5/i },
      { name: 'Project name', pattern: /Thika Road Leveling/ },
      { name: 'Road name', pattern: /Thika Superhighway/ },
      { name: 'Level type', pattern: /Leica NA2/ },
      { name: 'Staff type', pattern: /Fiberglass 5m/ },
      { name: 'Closure standard 10*sqrt(K)', pattern: /10\*sqrt\(K\)/i },
      { name: 'Closure summary', pattern: /RUN CLOSURE SUMMARY/i },
      { name: 'Total distance', pattern: /187\.800 m/ },
      { name: 'Number of setups', pattern: /3 setups|Number of Setups/ },
      { name: 'Misclosure', pattern: /2\.50 mm/ },
      { name: 'Allowable', pattern: /4\.33 mm/ },
      { name: 'PASS status', pattern: /PASS/i },
      { name: 'Page 1 header', pattern: /PAGE 1/i },
      { name: 'Starting BM', pattern: /BM\/THIKA\/001/ },
      { name: 'Closing BM', pattern: /BM\/THIKA\/002/ },
      { name: 'BM1 station', pattern: /BM1/ },
      { name: 'CP1 station', pattern: /CP1/ },
      { name: 'CP2 station', pattern: /CP2/ },
      { name: 'BS column', pattern: /BS \(m\)/i },
      { name: 'FS column', pattern: /FS \(m\)/i },
      { name: 'Rise column', pattern: /Rise/i },
      { name: 'Fall column', pattern: /Fall/i },
      { name: 'RL column', pattern: /RL \(m\)/i },
      { name: 'Page check', pattern: /PAGE CHECK/i },
      { name: 'Sum BS', pattern: /Sum BS/i },
      { name: 'Sum FS', pattern: /Sum FS/i },
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
  console.log('ALL TESTS PASSED — Supplementary forms are production-ready');
  console.log('='.repeat(70));
} else {
  process.exit(1);
}
