/**
 * Integration test for Engineering Standards + Topographical Standards modules
 *
 * Validates:
 *   - 5 road authorities (KeNHA, KeRRA, KURA, KWS, Private)
 *   - 6 road classes (A-F) with design speeds and tolerances
 *   - 15 setting out tolerances per structure type (RDM 1.1 + ISO 4463)
 *   - As-built comparison (design vs actual) with conformance classification
 *   - Machine control validation (7 checks)
 *   - Engineering QA checklist per project type
 *   - 9 topo map scales with accuracy specs (1:250 to 1:100000)
 *   - 4 control survey classes (Zero/First/Second/Third order)
 *   - Topo accuracy assessment (NMAS + 1/3 contour interval rule)
 *   - 70 feature codes in 10 categories
 *   - Topo QA checklist
 *   - Map scale recommendation
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

let passCount = 0, failCount = 0;
function check(name, condition, details) {
  if (condition) { console.log(`  PASS — ${name}${details ? '  ' + details : ''}`); passCount++; }
  else { console.log(`  FAIL — ${name}${details ? '  ' + details : ''}`); failCount++; }
}

console.log('='.repeat(70));
console.log('METARDU Desktop — Engineering + Topographical Standards Test');
console.log('Based on: RDM 1.1 (2025) + KeNHA + ISO 4463 + SoK + NMAS + ASPRS');
console.log('='.repeat(70));

// ─── Build both modules ───────────────────────────────────────────────

const engEntry = join(ROOT, 'apps/desktop/electron/engineering-standards.ts');
const engOut = join(ROOT, 'scripts', 'engineering-standards.bundled.cjs');
await build({
  entryPoints: [engEntry], bundle: true, format: 'cjs', platform: 'node', outfile: engOut,
  alias: { 'electron': join(TMP_DIR, 'electron-stub.js'), 'electron-log/main': join(TMP_DIR, 'electron-log-stub.js') },
  logLevel: 'warning',
});
const eng = await import(`file://${engOut}`);

const topoEntry = join(ROOT, 'apps/desktop/electron/topographical-standards.ts');
const topoOut = join(ROOT, 'scripts', 'topographical-standards.bundled.cjs');
await build({
  entryPoints: [topoEntry], bundle: true, format: 'cjs', platform: 'node', outfile: topoOut,
  alias: { 'electron': join(TMP_DIR, 'electron-stub.js'), 'electron-log/main': join(TMP_DIR, 'electron-log-stub.js') },
  logLevel: 'warning',
});
const topo = await import(`file://${topoOut}`);

// ─── Test 1: Road Authorities ─────────────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 1: Road Authorities (Kenya)');
console.log('─'.repeat(70));

const authorities = eng.ROAD_AUTHORITIES;
check('5 road authorities', Object.keys(authorities).length === 5);
check('KeNHA exists', !!authorities.kenha);
check('KeRRA exists', !!authorities.kerra);
check('KURA exists', !!authorities.kura);
check('KWS exists', !!authorities.kws);
check('Private exists', !!authorities.private);
check('KeNHA governs RDM 1.1', authorities.kenha.governingDocument.includes('RDM 1.1'));
check('KeNHA jurisdiction is trunk roads', authorities.kenha.jurisdiction.includes('Trunk'));
check('KeNHA handles Class A roads', authorities.kenha.roadClasses.includes('A'));
check('KeRRA handles Class D roads', authorities.kerra.roadClasses.includes('D'));

// ─── Test 2: Road Classes ─────────────────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 2: Road Classes & Design Standards');
console.log('─'.repeat(70));

const classes = eng.ROAD_CLASSES;
check('6 road classes', Object.keys(classes).length === 6);
check('Class A design speed 120 km/h', classes.A.designSpeedKmH === 120);
check('Class B design speed 100 km/h', classes.B.designSpeedKmH === 100);
check('Class C design speed 80 km/h', classes.C.designSpeedKmH === 80);
check('Class D design speed 60 km/h', classes.D.designSpeedKmH === 60);
check('Class A pavement tolerance ±10mm', classes.A.surveyTolerance.horizontal === 10);
check('Class A vertical tolerance ±5mm', classes.A.surveyTolerance.vertical === 5);
check('Class A min horizontal radius 580m', classes.A.minRadiusHorizontal === 580);
check('Class A max gradient 4%', classes.A.maxGradient === 4);
check('Class A design life 20 years', classes.A.designLifeYears === 20);
check('Class A has example Nairobi-Mombasa', classes.A.examples.some(e => e.includes('Nairobi') && e.includes('Mombasa')));

// ─── Test 3: Setting Out Tolerances ───────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 3: Setting Out Tolerances (15 structure types)');
console.log('─'.repeat(70));

const tolerances = eng.SETTING_OUT_TOLERANCES;
check('15 structure types', Object.keys(tolerances).length === 15);
check('Road pavement tolerance ±10mm H', tolerances.road_pavement.horizontalTolerance === 10);
check('Road pavement tolerance ±5mm V', tolerances.road_pavement.verticalTolerance === 5);
check('Bridge pier tolerance ±5mm H', tolerances.bridge_pier.horizontalTolerance === 5);
check('Bridge pier tolerance ±3mm V', tolerances.bridge_pier.verticalTolerance === 3);
check('Bridge pier uses KeNHA Bridge standard', tolerances.bridge_pier.standard === 'KeNHA_Bridge');
check('Building column tolerance ±5mm H', tolerances.building_column.horizontalTolerance === 5);
check('Building column uses ISO 4463', tolerances.building_column.standard === 'ISO_4463_1');
check('Pile tolerance ±50mm H', tolerances.pile.horizontalTolerance === 50);
check('Tunnel tolerance ±25mm H', tolerances.tunnel.horizontalTolerance === 25);
check('Dam spillway tolerance ±5mm V', tolerances.dam_spillway.verticalTolerance === 5);
check('Dam spillway is most critical', tolerances.dam_spillway.notes.includes('Most critical'));
check('Pipeline tolerance ±50mm H', tolerances.pipeline.horizontalTolerance === 50);
check('All tolerances have measurement method', Object.values(tolerances).every(t => t.measurementMethod.length > 0));
check('All tolerances have verification frequency', Object.values(tolerances).every(t => t.verificationFrequency.length > 0));

// ─── Test 4: As-Built Comparison ──────────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 4: As-Built Comparison (Design vs Actual)');
console.log('─'.repeat(70));

const design = [
  { pointId: 'P1', designEasting: 256320.000, designNorthing: 9856435.000, designElevation: 1825.000, structureType: 'road_pavement' },
  { pointId: 'P2', designEasting: 256340.000, designNorthing: 9856455.000, designElevation: 1825.020, structureType: 'road_pavement' },
  { pointId: 'P3', designEasting: 256360.000, designNorthing: 9856475.000, designElevation: 1825.040, structureType: 'bridge_pier' },
  { pointId: 'P4', designEasting: 256380.000, designNorthing: 9856495.000, designElevation: 1825.060, structureType: 'road_pavement' },
  { pointId: 'P5', designEasting: 256400.000, designNorthing: 9856515.000, designElevation: 1825.080, structureType: 'road_pavement' },
];

const asBuilt = [
  // P1: spot on
  { pointId: 'P1', measuredEasting: 256320.005, measuredNorthing: 9856435.003, measuredElevation: 1825.002, measuredAt: '2026-07-13T10:00:00Z' },
  // P2: within tolerance but close to limit (8.6mm H, 4mm V — both within ±10/±5)
  { pointId: 'P2', measuredEasting: 256340.007, measuredNorthing: 9856455.005, measuredElevation: 1825.024, measuredAt: '2026-07-13T10:01:00Z' },
  // P3: bridge pier — fails (12mm horizontal, limit 5mm)
  { pointId: 'P3', measuredEasting: 256360.012, measuredNorthing: 9856475.000, measuredElevation: 1825.040, measuredAt: '2026-07-13T10:02:00Z' },
  // P4: fail (vertical 15mm, limit 5mm for road pavement)
  { pointId: 'P4', measuredEasting: 256380.000, measuredNorthing: 9856495.000, measuredElevation: 1825.075, measuredAt: '2026-07-13T10:03:00Z' },
  // P5: pass
  { pointId: 'P5', measuredEasting: 256400.001, measuredNorthing: 9856515.002, measuredElevation: 1825.081, measuredAt: '2026-07-13T10:04:00Z' },
];

const report = eng.compareDesignToAsBuilt(design, asBuilt);
check('Report has 5 results', report.results.length === 5);
check('Pass count = 2 (P1, P5)', report.summary.passCount === 2, `passCount=${report.summary.passCount}`);
check('Marginal count = 1 (P2)', report.summary.marginalCount === 1, `marginalCount=${report.summary.marginalCount}`);
check('Fail count = 2 (P3, P4)', report.summary.failCount === 2, `failCount=${report.summary.failCount}`);
check('Pass rate 40%', Math.abs(report.summary.passRate - 40) < 0.1, `${report.summary.passRate.toFixed(1)}%`);
check('P1 conformance = pass', report.results[0].conformance === 'pass');
check('P2 conformance = marginal', report.results[1].conformance === 'marginal');
check('P3 conformance = fail (bridge pier ±5mm exceeded)', report.results[2].conformance === 'fail');
check('P4 conformance = fail (vertical ±5mm exceeded)', report.results[3].conformance === 'fail');
check('P5 conformance = pass', report.results[4].conformance === 'pass');
check('Overall conformance = rejected (40% fail > 5% threshold)', report.conformance === 'rejected', `conformance=${report.conformance}`);
check('Has recommendations', report.recommendations.length > 0);
check('Recommendation mentions 2 failed points', report.recommendations.some(r => r.includes('2 point')));

// ─── Test 5: Machine Control Validation ───────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 5: Machine Control Validation');
console.log('─'.repeat(70));

const validAlignment = {
  points: Array.from({ length: 11 }, (_, i) => ({
    chainage: i * 100,
    easting: 256000 + i * 50,
    northing: 9856000 + i * 30,
    elevation: 1825 + i * 0.1,
    offset: i % 2 === 0 ? 3.5 : -3.5,
    crossfall: 2.0,
  })),
  curves: [{ startChainage: 200, endChainage: 400, radius: 500 }],
  roadReserveWidth: 20,
};

const validResult = eng.validateMachineControlData(validAlignment, 'landxml');
check('Valid alignment passes', validResult.passes);
check('No errors for valid alignment', validResult.errors.length === 0);
check('7 validation checks run', validResult.validationChecks.length === 7);
check('Chainage monotonic check passes', validResult.validationChecks.find(c => c.check.includes('monotonic'))?.passed);
check('No duplicate chainages check passes', validResult.validationChecks.find(c => c.check.includes('duplicate'))?.passed);
check('Curve radius check passes', validResult.validationChecks.find(c => c.check.includes('radius'))?.passed);
check('Crossfall check passes', validResult.validationChecks.find(c => c.check.includes('Crossfall'))?.passed);

// Invalid alignment — duplicate chainages and bad curve
const invalidAlignment = {
  points: [
    { chainage: 0, easting: 256000, northing: 9856000, elevation: 1825, offset: 3.5, crossfall: 2.0 },
    { chainage: 100, easting: 256050, northing: 9856030, elevation: 1825.1, offset: 3.5, crossfall: 2.0 },
    { chainage: 100, easting: 256100, northing: 9856060, elevation: 1825.2, offset: 3.5, crossfall: 2.0 }, // duplicate
    { chainage: 50, easting: 256150, northing: 9856090, elevation: 1825.3, offset: 3.5, crossfall: 8.0 }, // non-monotonic + bad crossfall
  ],
  curves: [{ startChainage: 0, endChainage: 100, radius: -50 }],
  roadReserveWidth: 20,
};

const invalidResult = eng.validateMachineControlData(invalidAlignment, 'trimble');
check('Invalid alignment fails', !invalidResult.passes);
check('Errors logged for invalid alignment', invalidResult.errors.length > 0);
check('Warnings logged for duplicate chainages', invalidResult.warnings.some(w => w.includes('Duplicate')));
check('Warnings logged for crossfall', invalidResult.warnings.some(w => w.includes('crossfall')));
check('Chainage monotonic check fails', !invalidResult.validationChecks.find(c => c.check.includes('monotonic'))?.passed);
check('Duplicate chainages check fails', !invalidResult.validationChecks.find(c => c.check.includes('duplicate'))?.passed);
check('Curve radius check fails', !invalidResult.validationChecks.find(c => c.check.includes('radius'))?.passed);

// ─── Test 6: Engineering QA Checklist ─────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 6: Engineering QA Checklist');
console.log('─'.repeat(70));

for (const projectType of ['road', 'bridge', 'building', 'dam', 'pipeline']) {
  const checklist = eng.getEngineeringQAChecklist(projectType);
  check(`${projectType} checklist has items`, checklist.length > 0, `${checklist.length} items`);
  check(`${projectType} checklist items are required`, checklist.every(item => item.required));
  check(`${projectType} checklist items have standards`, checklist.every(item => item.standard.length > 0));
}

const roadChecklist = eng.getEngineeringQAChecklist('road');
check('Road checklist has alignment design item', roadChecklist.some(c => c.id === 'alignment-design'));
check('Road checklist has staking table item', roadChecklist.some(c => c.id === 'staking-table'));
check('Road checklist has machine control item', roadChecklist.some(c => c.id === 'machine-control'));

const bridgeChecklist = eng.getEngineeringQAChecklist('bridge');
check('Bridge checklist has pier locations item', bridgeChecklist.some(c => c.id === 'pier-locations'));
check('Bridge checklist has abutment bearings item', bridgeChecklist.some(c => c.id === 'abutment-bearings'));
check('Bridge checklist cites KeNHA Bridge Specs §1800', bridgeChecklist.some(c => c.standard.includes('§1800')));

const damChecklist = eng.getEngineeringQAChecklist('dam');
check('Dam checklist has dam-axis item', damChecklist.some(c => c.id === 'dam-axis'));
check('Dam checklist has spillway-crest item', damChecklist.some(c => c.id === 'spillway-crest'));
check('Dam spillway is most critical', damChecklist.find(c => c.id === 'spillway-crest')?.description.includes('most critical'));

// ─── Test 7: Topographical Map Standards ──────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 7: Topographical Map Standards (9 scales)');
console.log('─'.repeat(70));

const mapStandards = topo.TOPO_MAP_STANDARDS;
check('9 map scales registered', mapStandards.length === 9);

const scale250 = mapStandards.find(s => s.scale === '1:250');
check('1:250 contour interval 0.25m', scale250?.contourInterval === 0.25);
check('1:250 positional accuracy 0.125m', scale250?.positionalAccuracyM === 0.125);
check('1:250 uses first-order control', scale250?.controlSurveyOrder === 'first');

const scale1000 = mapStandards.find(s => s.scale === '1:1000');
check('1:1000 contour interval 0.5m', scale1000?.contourInterval === 0.5);
check('1:1000 positional accuracy 0.5m', scale1000?.positionalAccuracyM === 0.5);
check('1:1000 uses first-order control', scale1000?.controlSurveyOrder === 'first');

const scale2500 = mapStandards.find(s => s.scale === '1:2500');
check('1:2500 contour interval 1.0m', scale2500?.contourInterval === 1.0);
check('1:2500 KETRACO use case', scale2500?.typicalUseCase.includes('KETRACO'));

const scale50000 = mapStandards.find(s => s.scale === '1:50000');
check('1:50000 contour interval 20.0m', scale50000?.contourInterval === 20.0);
check('1:50000 uses third-order control', scale50000?.controlSurveyOrder === 'third');
check('1:50000 references Kenya Y717 series', scale50000?.typicalUseCase.includes('Y717'));

// NMAS rule: 0.5mm at scale
check('1:1000 NMAS = 0.5m (0.5mm at scale)', Math.abs(scale1000.positionalAccuracyM - 0.5) < 0.001);
check('1:50000 NMAS = 25m (0.5mm at scale)', Math.abs(scale50000.positionalAccuracyM - 25.0) < 0.001);

// 1/3 contour interval rule (Kenya Topo Guidelines)
check('1:1000 vertical accuracy = 1/3 contour interval', Math.abs(scale1000.verticalAccuracyM - scale1000.contourInterval / 3) < 0.001);

// ─── Test 8: Control Survey Classification ────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 8: Control Survey Classification');
console.log('─'.repeat(70));

const controlClasses = topo.CONTROL_SURVEY_CLASSES;
check('4 control survey orders', Object.keys(controlClasses).length === 4);
check('Zero order exists', !!controlClasses.zero);
check('First order exists', !!controlClasses.first);
check('Second order exists', !!controlClasses.second);
check('Third order exists', !!controlClasses.third);
check('Zero order: 3mm accuracy', controlClasses.zero.horizontalAccuracy === 3);
check('First order: 5mm + 1ppm accuracy', controlClasses.first.horizontalAccuracy === 5);
check('Second order: 10mm + 2ppm accuracy', controlClasses.second.horizontalAccuracy === 10);
check('Third order: 25mm + 5ppm accuracy', controlClasses.third.horizontalAccuracy === 25);
check('First order relative accuracy 1:100,000', controlClasses.first.relativeAccuracy === '1:100,000');
check('First order uses static GNSS 2-6 hour sessions', controlClasses.first.method.includes('2 to 6 hour'));
check('First order for engineering projects', controlClasses.first.applications.includes('Engineering projects (roads, dams, bridges)'));
check('Zero order for CORS network', controlClasses.zero.applications.includes('CORS network'));

// ─── Test 9: Topo Accuracy Assessment ─────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 9: Topo Accuracy Assessment (NMAS + 1/3 rule)');
console.log('─'.repeat(70));

// Good survey — meets all standards
const goodCheckPoints = Array.from({ length: 20 }, (_, i) => {
  const refE = 256320 + i * 5;
  const refN = 9856435 + i * 3;
  const refZ = 1825 + i * 0.1;
  return {
    surveyedEasting: refE + (Math.random() - 0.5) * 0.2,   // ±0.1m noise
    surveyedNorthing: refN + (Math.random() - 0.5) * 0.2,
    surveyedElevation: refZ + (Math.random() - 0.5) * 0.05, // ±0.025m noise
    referenceEasting: refE,
    referenceNorthing: refN,
    referenceElevation: refZ,
  };
});

const goodAssessment = topo.assessTopoAccuracy('1:1000', goodCheckPoints);
check('Good survey: compliant', goodAssessment.overallCompliance === 'compliant', `compliance=${goodAssessment.overallCompliance}`);
check('Good survey: RMS horizontal < 0.5m', goodAssessment.actualRMSHorizontal < 0.5, `${goodAssessment.actualRMSHorizontal.toFixed(3)}m`);
check('Good survey: NMAS compliant', goodAssessment.nmasCompliant);
check('Good survey: 1/3 rule compliant', goodAssessment.oneThirdRuleCompliant);
check('Good survey: recommendations say "compliant"', goodAssessment.recommendations.some(r => r.includes('compliant')));

// Bad survey — fails all standards
const badCheckPoints = Array.from({ length: 20 }, (_, i) => {
  const refE = 256320 + i * 5;
  const refN = 9856435 + i * 3;
  const refZ = 1825 + i * 0.1;
  return {
    surveyedEasting: refE + (Math.random() - 0.5) * 5.0,   // ±2.5m noise — way too much
    surveyedNorthing: refN + (Math.random() - 0.5) * 5.0,
    surveyedElevation: refZ + (Math.random() - 0.5) * 1.5,  // ±0.75m noise
    referenceEasting: refE,
    referenceNorthing: refN,
    referenceElevation: refZ,
  };
});

const badAssessment = topo.assessTopoAccuracy('1:1000', badCheckPoints);
check('Bad survey: non_compliant', badAssessment.overallCompliance === 'non_compliant', `compliance=${badAssessment.overallCompliance}`);
check('Bad survey: NMAS not compliant', !badAssessment.nmasCompliant);
check('Bad survey: 1/3 rule not compliant', !badAssessment.oneThirdRuleCompliant);
check('Bad survey: has recommendations to fix', badAssessment.recommendations.length > 0);

// ─── Test 10: Feature Coding Library ──────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 10: Feature Coding Library (SoK Standard)');
console.log('─'.repeat(70));

const featureCodes = topo.FEATURE_CODES;
check('70 feature codes registered', featureCodes.length === 70, `${featureCodes.length} codes`);

const categories = new Set(featureCodes.map(fc => fc.category));
check('10 feature categories', categories.size === 10, `${categories.size} categories`);

check('Has control category', categories.has('control'));
check('Has buildings category', categories.has('buildings'));
check('Has roads category', categories.has('roads'));
check('Has water category', categories.has('water'));
check('Has vegetation category', categories.has('vegetation'));
check('Has utilities category', categories.has('utilities'));
check('Has boundaries category', categories.has('boundaries'));
check('Has relief category', categories.has('relief'));
check('Has structures category', categories.has('structures'));
check('Has miscellaneous category', categories.has('miscellaneous'));

// Look up specific codes
const ctrlCode = topo.lookupFeatureCode('CTRL');
check('CTRL feature code exists', !!ctrlCode);
check('CTRL is in control category', ctrlCode?.category === 'control');
check('CTRL is a point feature', ctrlCode?.isPoint);
check('CTRL has triangle symbol', ctrlCode?.symbol === 'triangle');

const riverCode = topo.lookupFeatureCode('RIV');
check('RIV feature code exists', !!riverCode);
check('RIV is a line feature', !riverCode?.isPoint);
check('RIV is a breakline', riverCode?.isBreakline);

// Case insensitive lookup
const lowerCode = topo.lookupFeatureCode('riv');
check('Lookup is case insensitive', !!lowerCode);

// Get by category
const waterCodes = topo.getFeatureCodesByCategory('water');
check('Water category has multiple codes', waterCodes.length >= 5, `${waterCodes.length} codes`);
check('Water category includes RIV', waterCodes.some(c => c.code === 'RIV'));
check('Water category includes LAKE', waterCodes.some(c => c.code === 'LAKE'));

// ─── Test 11: Topo QA Checklist ───────────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 11: Topo QA Checklist');
console.log('─'.repeat(70));

const topoChecklist = topo.getTopoQAChecklist('1:1000');
check('Topo checklist has items', topoChecklist.length > 0, `${topoChecklist.length} items`);
check('Topo checklist items are required', topoChecklist.every(item => item.required));
check('Topo checklist has control items', topoChecklist.some(c => c.category === 'Control'));
check('Topo checklist has detail survey items', topoChecklist.some(c => c.category === 'Detail Survey'));
check('Topo checklist has contour items', topoChecklist.some(c => c.category === 'Contours'));
check('Topo checklist has accuracy items', topoChecklist.some(c => c.category === 'Accuracy'));
check('Topo checklist has deliverables items', topoChecklist.some(c => c.category === 'Deliverables'));
check('Topo checklist has metadata items', topoChecklist.some(c => c.category === 'Metadata'));
check('Topo checklist cites NMAS', topoChecklist.some(c => c.standard.includes('National Map Accuracy')));
check('Topo checklist cites 1/3 contour interval rule', topoChecklist.some(c => c.description.includes('1/3')));
check('Topo checklist cites SoK Practice Notes 2020', topoChecklist.some(c => c.standard.includes('SoK Practice Notes')));

// Scale-specific checklist
const scale50kChecklist = topo.getTopoQAChecklist('1:50000');
const contourItem = scale50kChecklist.find(c => c.id === 'contour-interval');
check('1:50000 checklist mentions 20m contour interval', contourItem?.description.includes('20m'));

// ─── Test 12: Map Scale Recommendation ────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 12: Map Scale Recommendation');
console.log('─'.repeat(70));

const detailedEng = topo.recommendMapScale('detailed_engineering');
check('Detailed engineering → 1:500', detailedEng.recommendedScale === '1:500');
check('Detailed engineering reason mentions 0.5m contours', detailedEng.reason.includes('0.5m contours'));

const sitePlanning = topo.recommendMapScale('site_planning');
check('Site planning → 1:1000', sitePlanning.recommendedScale === '1:1000');

const routeSurvey = topo.recommendMapScale('route_survey');
check('Route survey → 1:2500', routeSurvey.recommendedScale === '1:2500');
check('Route survey reason mentions KETRACO', routeSurvey.reason.includes('KETRACO'));

const masterPlanning = topo.recommendMapScale('master_planning');
check('Master planning → 1:5000', masterPlanning.recommendedScale === '1:5000');

const regionalPlanning = topo.recommendMapScale('regional_planning');
check('Regional planning → 1:10000', regionalPlanning.recommendedScale === '1:10000');

const nationalMapping = topo.recommendMapScale('national_mapping');
check('National mapping → 1:50000', nationalMapping.recommendedScale === '1:50000');
check('National mapping mentions Y717 series', nationalMapping.reason.includes('Y717'));

// ─── Summary ──────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(70));
console.log(`TOTAL: ${passCount}/${passCount + failCount} checks passed, ${failCount} failed`);
console.log('='.repeat(70));

if (failCount === 0) {
  console.log('\nALL TESTS PASSED — Engineering + Topographical Standards are production-ready');
  console.log('\nStandards coverage:');
  console.log('  Engineering:');
  console.log('    - 5 road authorities (KeNHA, KeRRA, KURA, KWS, Private)');
  console.log('    - 6 road classes (A-F) with design speeds 30-120 km/h');
  console.log('    - 15 structure types with setting out tolerances');
  console.log('    - As-built comparison with conformance classification');
  console.log('    - Machine control validation (7 checks)');
  console.log('    - QA checklists for road/bridge/building/dam/pipeline');
  console.log('  Topographical:');
  console.log('    - 9 map scales (1:250 to 1:100000)');
  console.log('    - 4 control survey classes (Zero/First/Second/Third order)');
  console.log('    - NMAS + 1/3 contour interval rule compliance');
  console.log('    - 70 feature codes in 10 categories (SoK standard)');
  console.log('    - QA checklist per map scale');
  console.log('    - Scale recommendation per project type');
} else {
  process.exit(1);
}
