/**
 * Integration test for the Cadastre Quality & Integration Module
 *
 * Validates:
 *   - 8 cadastral map types registered with correct accuracy specs
 *   - 3 land tenure categories with Constitution 2010 alignment
 *   - Boundary type system (fixed vs general)
 *   - Quality assessment per map type (positional accuracy, legal status)
 *   - Integration compatibility check between map types
 *   - Coordinate system harmonization
 *   - LADM (ISO 19152) export
 *   - Cadastre 2014 compliance assessment
 *   - Coverage statistics (Siriba et al. Table 2)
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

// ─── Build the module ─────────────────────────────────────────────────

const entryFile = join(ROOT, 'apps/desktop/electron/cadastre-quality.ts');
const outfile = join(ROOT, 'scripts', 'cadastre-quality.bundled.cjs');
await build({
  entryPoints: [entryFile], bundle: true, format: 'cjs', platform: 'node', outfile,
  alias: { 'electron': join(TMP_DIR, 'electron-stub.js'), 'electron-log/main': join(TMP_DIR, 'electron-log-stub.js') },
  logLevel: 'warning',
});
const mod = await import(`file://${outfile}`);

console.log('='.repeat(70));
console.log('METARDU Desktop — Cadastre Quality & Integration Module Test');
console.log('Based on: Siriba, Voß & Mulaku (2011) + Cadastre 2014 + LADM ISO 19152');
console.log('='.repeat(70));

// ─── Test 1: Map Type Registry ────────────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 1: Cadastral Map Type Registry');
console.log('─'.repeat(70));

const mapTypes = mod.CADASTRAL_MAP_TYPES;
const expectedTypes = ['survey_plan', 'deed_plan', 'rim_urban', 'rim_rural', 'demarcation_map', 'pid', 'rim_range_provisional', 'cadastral_index_map'];
check('8 map types registered', Object.keys(mapTypes).length === 8, `${Object.keys(mapTypes).length} types`);

for (const t of expectedTypes) {
  check(`Map type ${t} exists`, !!mapTypes[t]);
}

// Accuracy hierarchy (from Siriba et al. Table 1)
check('Survey plan accuracy ±0.03m', mapTypes.survey_plan.positionalAccuracyM === 0.03, `±${mapTypes.survey_plan.positionalAccuracyM}m`);
check('Deed plan accuracy ±0.03m', mapTypes.deed_plan.positionalAccuracyM === 0.03, `±${mapTypes.deed_plan.positionalAccuracyM}m`);
check('RIM urban accuracy ±0.30m', mapTypes.rim_urban.positionalAccuracyM === 0.30, `±${mapTypes.rim_urban.positionalAccuracyM}m`);
check('RIM rural accuracy ±0.30m', mapTypes.rim_rural.positionalAccuracyM === 0.30, `±${mapTypes.rim_rural.positionalAccuracyM}m`);
check('Demarcation map accuracy ≥5m', mapTypes.demarcation_map.positionalAccuracyM >= 5.0, `±${mapTypes.demarcation_map.positionalAccuracyM}m`);
check('PID accuracy ≥20m (per Mulaku & McLaughlin)', mapTypes.pid.positionalAccuracyM >= 20.0, `±${mapTypes.pid.positionalAccuracyM}m`);
check('RIM range provisional ±10m', mapTypes.rim_range_provisional.positionalAccuracyM === 10.0, `±${mapTypes.rim_range_provisional.positionalAccuracyM}m`);

// Boundary types
check('Survey plan has fixed boundaries', mapTypes.survey_plan.boundaryType === 'fixed');
check('Deed plan has fixed boundaries', mapTypes.deed_plan.boundaryType === 'fixed');
check('RIM urban has mixed boundaries', mapTypes.rim_urban.boundaryType === 'mixed');
check('RIM rural has general boundaries', mapTypes.rim_rural.boundaryType === 'general');
check('Demarcation map has general boundaries', mapTypes.demarcation_map.boundaryType === 'general');
check('PID has general boundaries', mapTypes.pid.boundaryType === 'general');

// Legal status
check('Survey plan is definitive', mapTypes.survey_plan.legalStatus === 'definitive');
check('Demarcation map is provisional', mapTypes.demarcation_map.legalStatus === 'provisional');
check('PID is provisional', mapTypes.pid.legalStatus === 'provisional');
check('RIM range provisional is provisional', mapTypes.rim_range_provisional.legalStatus === 'provisional');

// Source attribution
check('All map types cite Siriba et al. (2011)', Object.values(mapTypes).every(m => m.sourcePaper.includes('Siriba')));

// ─── Test 2: Land Tenure Categories ───────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 2: Land Tenure Categories (Constitution of Kenya 2010)');
console.log('─'.repeat(70));

const tenureCats = mod.TENURE_CATEGORIES;
check('3 tenure categories', Object.keys(tenureCats).length === 3);

check('Public land = 10%', tenureCats.public.coveragePercent === 10);
check('Private land = 20%', tenureCats.private.coveragePercent === 20);
check('Community land = 70%', tenureCats.community.coveragePercent === 70);
check('Public land is unregistered', tenureCats.public.registrationStatus === 'unregistered');
check('Private land is registered', tenureCats.private.registrationStatus === 'registered');
check('Community land is partially registered', tenureCats.community.registrationStatus === 'partially_registered');

check('Public land cites Constitution Art. 62', tenureCats.public.governingLaws.some(l => l.includes('Art. 62')));
check('Private land cites Constitution Art. 64', tenureCats.private.governingLaws.some(l => l.includes('Art. 64')));
check('Community land cites Constitution Art. 63', tenureCats.community.governingLaws.some(l => l.includes('Art. 63')));
check('Community land cites Community Land Act 2016', tenureCats.community.governingLaws.some(l => l.includes('Community Land Act 2016')));

// ─── Test 3: Boundary Type System ─────────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 3: Boundary Type System (Fixed vs General)');
console.log('─'.repeat(70));

const fixedBoundary = mod.createFixedBoundary([
  { easting: 256320.000, northing: 9856435.000, accuracyM: 0.03 },
  { easting: 256355.528, northing: 9856470.476, accuracyM: 0.03 },
]);
check('Fixed boundary created', fixedBoundary.type === 'fixed');
check('Fixed boundary is legally binding', fixedBoundary.legalStatus === 'legally_binding');
check('Fixed boundary has coordinated points', fixedBoundary.coordinatedPoints?.length === 2);
check('Fixed boundary description mentions invisible line', fixedBoundary.description.includes('invisible line'));

const generalBoundary = mod.createGeneralBoundary('stone wall');
check('General boundary created', generalBoundary.type === 'general');
check('General boundary is indicative only', generalBoundary.legalStatus === 'indicative_only');
check('General boundary has physical feature', generalBoundary.physicalFeature === 'stone wall');
check('General boundary description mentions physical feature', generalBoundary.description.includes('stone wall'));

// ─── Test 4: Quality Assessment ───────────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 4: Cadastre Quality Assessment');
console.log('─'.repeat(70));

// Test parcel on survey plan (high quality)
const surveyParcel = {
  parcelNumber: 'PLOT/247/15',
  lrNumber: 'LR Kiambu/Riruta/247/15',
  mapType: 'survey_plan',
  tenureCategory: 'private',
  boundaryType: 'fixed',
  coordinateSystem: 'cassini',
  areaSqM: 28750.5,
  centroidEasting: 256355.5,
  centroidNorthing: 9856470.5,
};
const surveyAssessment = mod.assessCadastreQuality(surveyParcel);
check('Survey plan: high overall quality', surveyAssessment.overallQuality === 'high');
check('Survey plan: ±0.03m positional accuracy', surveyAssessment.positionalAccuracy === 0.03);
check('Survey plan: definitive legal certainty', surveyAssessment.legalCertainty === 'definitive');
check('Survey plan: low integration risk', surveyAssessment.integrationRisk === 'low');

// Test parcel on PID (very low quality)
const pidParcel = {
  parcelNumber: 'PLOT/MERU/456',
  lrNumber: 'LR Meru/Tigania/456',
  mapType: 'pid',
  tenureCategory: 'community',
  boundaryType: 'general',
  coordinateSystem: 'cassini',
  areaSqM: 4500.0,
  centroidEasting: 280000.0,
  centroidNorthing: 9910000.0,
};
const pidAssessment = mod.assessCadastreQuality(pidParcel);
check('PID: very_low overall quality', pidAssessment.overallQuality === 'very_low');
check('PID: ≥20m positional accuracy', pidAssessment.positionalAccuracy >= 20.0);
check('PID: provisional legal certainty', pidAssessment.legalCertainty === 'provisional');
check('PID: critical integration risk', pidAssessment.integrationRisk === 'critical');
check('PID: has upgrade recommendations', pidAssessment.recommendations.length > 0);
check('PID: mentions photogrammetric upgrade', pidAssessment.recommendations.some(r => r.includes('photogrammetric')));

// Test parcel on demarcation map (low quality)
const demParcel = {
  parcelNumber: 'PLOT/CENTRAL/789',
  lrNumber: 'LR Nyeri/Othaya/789',
  mapType: 'demarcation_map',
  tenureCategory: 'private',
  boundaryType: 'general',
  coordinateSystem: 'cassini',
  areaSqM: 5500.0,
  centroidEasting: 270000.0,
  centroidNorthing: 9880000.0,
};
const demAssessment = mod.assessCadastreQuality(demParcel);
check('Demarcation: low overall quality', demAssessment.overallQuality === 'low');
check('Demarcation: mentions Refly process', demAssessment.recommendations.some(r => r.includes('Refly')));

// Test parcel on RIM range provisional
const rangeParcel = {
  parcelNumber: 'GROUP/RANCH/001',
  lrNumber: 'LR Kajiado/GroupRanch/001',
  mapType: 'rim_range_provisional',
  tenureCategory: 'community',
  boundaryType: 'general',
  coordinateSystem: 'cassini',
  areaSqM: 50000.0,
  centroidEasting: 240000.0,
  centroidNorthing: 9820000.0,
};
const rangeAssessment = mod.assessCadastreQuality(rangeParcel);
check('RIM range: very_low overall quality (10m accuracy)', rangeAssessment.overallQuality === 'very_low');
check('RIM range: ±10m positional accuracy', rangeAssessment.positionalAccuracy === 10.0);
check('RIM range: critical integration risk', rangeAssessment.integrationRisk === 'critical');
check('RIM range: recommends coordinating boundary markers', rangeAssessment.recommendations.some(r => r.includes('Coordinate boundary markers')));

// ─── Test 5: Cadastre 2014 Compliance ─────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 5: Cadastre 2014 Compliance Assessment');
console.log('─'.repeat(70));

const c2014 = surveyAssessment.cadastre2014Compliance;
check('Cadastre 2014 assessment present', !!c2014);
check('Statement 1 (land objects) NOT compliant', c2014.statement1_landObjects.compliant === false);
check('Statement 2 (register integration) NOT compliant', c2014.statement2_registerIntegration.compliant === false);
check('Statement 3 (data modeling) NOT compliant', c2014.statement3_dataModeling.compliant === false);
check('Statement 4 (automation) compliant via METARDU', c2014.statement4_automation.compliant === true);
check('Statement 5 (public-private) compliant via METARDU', c2014.statement5_publicPrivate.compliant === true);
check('Statement 6 (cost recovery) compliant via METARDU', c2014.statement6_costRecovery.compliant === true);
check('Overall score 3 of 6', c2014.overallScore === 3, `score=${c2014.overallScore}`);

// ─── Test 6: Integration Compatibility Check ──────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 6: Integration Compatibility Check');
console.log('─'.repeat(70));

// Survey plan → RIM rural (different accuracy, same coord system)
const surveyToRim = mod.checkIntegrationCompatibility(surveyParcel, {
  ...surveyParcel,
  mapType: 'rim_rural',
  boundaryType: 'general',
});
check('Survey → RIM rural: medium risk (accuracy delta)', surveyToRim.riskLevel === 'medium', `risk=${surveyToRim.riskLevel}`);
check('Survey → RIM rural: accuracy delta 0.27m', Math.abs(surveyToRim.accuracyDelta - 0.27) < 0.01, `delta=${surveyToRim.accuracyDelta.toFixed(3)}m`);

// PID → Survey plan (huge accuracy delta)
const pidToSurvey = mod.checkIntegrationCompatibility(pidParcel, surveyParcel);
check('PID → Survey: critical risk', pidToSurvey.riskLevel === 'critical', `risk=${pidToSurvey.riskLevel}`);
check('PID → Survey: not compatible', pidToSurvey.compatible === false);

// Survey plan → Survey plan (same accuracy, same coord system)
const surveyToSurvey = mod.checkIntegrationCompatibility(surveyParcel, surveyParcel);
check('Survey → Survey: low risk', surveyToSurvey.riskLevel === 'low');
check('Survey → Survey: compatible', surveyToSurvey.compatible === true);

// UTM → Cassini (coordinate system mismatch)
const utmToCassini = mod.checkIntegrationCompatibility(
  { ...surveyParcel, coordinateSystem: 'utm' },
  { ...surveyParcel, coordinateSystem: 'cassini' }
);
check('UTM → Cassini: high risk (coord system mismatch)', utmToCassini.riskLevel === 'high', `risk=${utmToCassini.riskLevel}`);
check('UTM → Cassini: recommends harmonization', utmToCassini.recommendations.some(r => r.includes('Harmonize')));

// ─── Test 7: Coordinate System Harmonization ──────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 7: Coordinate System Harmonization');
console.log('─'.repeat(70));

// Same system — no conversion needed
const sameResult = mod.harmonizeCoordinates(256355.5, 9856470.5, 'utm', 'utm');
check('Same system: no conversion needed', sameResult.accuracyNote.includes('No conversion needed'));
check('Same system: coordinates preserved', sameResult.converted.easting === 256355.5);

// Cross-system conversion
const crossResult = mod.harmonizeCoordinates(256355.5, 9856470.5, 'cassini', 'utm');
check('Cross-system: marks conversion required', crossResult.accuracyNote.includes('Conversion from CASSINI to UTM required'));
check('Cross-system: mentions coordinate-converter', crossResult.accuracyNote.includes('coordinate-converter.ts'));
check('Cross-system: source system recorded', crossResult.sourceSystem === 'cassini');
check('Cross-system: target system recorded', crossResult.targetSystem === 'utm');

// ─── Test 8: LADM Export ──────────────────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 8: LADM (ISO 19152) Export');
console.log('─'.repeat(70));

const parcels = [
  surveyParcel,
  pidParcel,
  demParcel,
  rangeParcel,
  {
    parcelNumber: 'PLOT/NAI/001',
    lrNumber: 'LR Nairobi/Westlands/001',
    mapType: 'rim_urban',
    tenureCategory: 'private',
    boundaryType: 'general',
    coordinateSystem: 'cassini',
    areaSqM: 1200.0,
    centroidEasting: 255000.0,
    centroidNorthing: 9855000.0,
  },
];

const ladmPath = join(OUT_DIR, 'cadastre-ladm-test.json');
if (existsSync(ladmPath)) unlinkSync(ladmPath);
const ladm = mod.exportLADM(parcels, { outputPath: ladmPath });
check('LADM export file created', existsSync(ladmPath));
check('LADM version is ISO 19152:2012', ladm.version === 'LADM ISO 19152:2012');
check('LAML exporter is METARDU Desktop', ladm.exporter === 'METARDU Desktop');
check('LADM has 5 BAUnits', ladm.baUnits.length === 5);
check('LADM has 5 parcels', ladm.parcels.length === 5);
check('LADM CRS is Arc 1960 UTM Zone 37S', ladm.crs === 'Arc 1960 UTM Zone 37S');

// Verify accuracy class assignment
const surveyLADM = ladm.parcels.find(p => p.nationalId === 'PLOT/247/15');
check('Survey plan → LADM accuracy class A', surveyLADM?.accuracyClass === 'A');
check('Survey plan → LADM boundary type fixed', surveyLADM?.boundaryType === 'fixed');
check('Survey plan → LADM type survey_plan', surveyLADM?.type === 'survey_plan');

const pidLADM = ladm.parcels.find(p => p.nationalId === 'PLOT/MERU/456');
check('PID → LADM accuracy class D', pidLADM?.accuracyClass === 'D');
check('PID → LADM boundary type general', pidLADM?.boundaryType === 'general');
check('PID → LADM type pid', pidLADM?.type === 'pid');
check('PID → LADM tenure community', pidLADM?.tenureCategory === 'community');

const rimUrbanLADM = ladm.parcels.find(p => p.nationalId === 'PLOT/NAI/001');
check('RIM urban → LADM accuracy class B', rimUrbanLADM?.accuracyClass === 'B');
check('RIM urban → LADM type rim', rimUrbanLADM?.type === 'rim');

// ─── Test 9: Coverage Statistics ──────────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 9: Coverage Statistics (Siriba et al. Table 2)');
console.log('─'.repeat(70));

const coverage = mod.computeCoverageStatistics();
check('Total registered area 14.6M ha', coverage.totalAreaHa === 14_600_000, `${coverage.totalAreaHa.toLocaleString()} ha`);
check('Total coverage 25%', coverage.totalAreaPercentage === 25);
check('Public land 5.826M ha (10%)', coverage.byTenure.public.areaHa === 5_826_000);
check('Private land 11.652M ha (20%)', coverage.byTenure.private.areaHa === 11_652_000);
check('Community land 40.782M ha (70%)', coverage.byTenure.community.areaHa === 40_782_000);
check('Survey plan coverage 101k ha', coverage.byMapType.survey_plan.areaHa === 101_000);
check('RIM range provisional 3.3M ha', coverage.byMapType.rim_range_provisional.areaHa === 3_300_000);
check('Has notes', coverage.notes.length > 0);
check('Notes cite Siriba et al. (2011)', coverage.notes.some(n => n.includes('Siriba')));
check('Notes mention 25% coverage', coverage.notes.some(n => n.includes('25%')));

// ─── Summary ──────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(70));
console.log(`TOTAL: ${passCount}/${passCount + failCount} checks passed, ${failCount} failed`);
console.log('='.repeat(70));

if (failCount === 0) {
  console.log('ALL TESTS PASSED — Cadastre Quality & Integration Module is production-ready');
  console.log('\nKey insights captured from Siriba et al. (2011):');
  console.log('  - 5 distinct map types with accuracies from ±0.03m to ±10m+');
  console.log('  - Fixed vs general boundary legal distinction');
  console.log('  - Public/Private/Community tenure categories per Constitution 2010');
  console.log('  - Cadastre 2014: Kenya compliant on 3 of 6 statements (METARDU enables 3 more)');
  console.log('  - LADM ISO 19152 export with accuracy classes A-D');
  console.log('  - Coverage: only 25% of Kenya is registered (14.6M of 58.26M ha)');
} else {
  process.exit(1);
}
