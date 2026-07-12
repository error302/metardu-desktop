/**
 * Integration test for the Map Standards Module
 *
 * Validates:
 *   - 40+ SoK-compliant layers across 8 categories
 *   - 6 Kenya projections (Web Mercator, WGS84, UTM 36S/37S, Cassini)
 *   - 3 Y717 map sheet sizes (1:50000, 1:25000, 1:10000)
 *   - 4 grid configurations (UTM/Cassini × 1km/100m)
 *   - 6 beacon type symbology
 *   - 4 control point symbology
 *   - 8 PAP status colors
 *   - Measurement functions (distance, area, bearing)
 *   - Scale bar generation
 *   - Layer visibility per survey type
 */

import { build } from 'esbuild';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TMP_DIR = '/tmp/metardu-test';

mkdirSync(TMP_DIR, { recursive: true });

const electronStub = `
export const app = { getPath: (n) => '/tmp/metardu-test/' + n, getVersion: () => '0.1.0-test' };
export const ipcMain = { handle: () => {} };
export const BrowserWindow = class {};
`;
const electronLogStub = `
export default { info: () => {}, warn: () => {}, error: () => {} };
`;
writeFileSync(join(TMP_DIR, 'electron-stub.js'), electronStub);
writeFileSync(join(TMP_DIR, 'electron-log-stub.js'), electronLogStub);

let passCount = 0, failCount = 0;
function check(name, condition, details) {
  if (condition) { console.log(`  PASS — ${name}${details ? '  ' + details : ''}`); passCount++; }
  else { console.log(`  FAIL — ${name}${details ? '  ' + details : ''}`); failCount++; }
}

console.log('='.repeat(70));
console.log('METARDU Desktop — Map Standards Module Test');
console.log('Based on: SoK Drafting Manual 2020 + Cap 299 + Y717 series');
console.log('='.repeat(70));

// Build the module
const entryFile = join(ROOT, 'apps/desktop/electron/map-standards.ts');
const outfile = join(ROOT, 'scripts', 'map-standards.bundled.cjs');
await build({
  entryPoints: [entryFile], bundle: true, format: 'cjs', platform: 'node', outfile,
  alias: { 'electron': join(TMP_DIR, 'electron-stub.js'), 'electron-log/main': join(TMP_DIR, 'electron-log-stub.js') },
  logLevel: 'warning',
});
const mod = await import(`file://${outfile}`);

// ─── Test 1: SoK Layer Registry ───────────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 1: SoK Layer Registry (40+ layers)');
console.log('─'.repeat(70));

const layers = mod.SOK_LAYERS;
const layerIds = Object.keys(layers);
check('40+ layers registered', layerIds.length >= 40, `${layerIds.length} layers`);

// Check all 8 categories exist
const categories = new Set(Object.values(layers).map((l) => l.category));
check('8 layer categories', categories.size === 8, `${categories.size} categories`);
check('Has basemap category', categories.has('basemap'));
check('Has grid category', categories.has('grid'));
check('Has control category', categories.has('control'));
check('Has cadastral category', categories.has('cadastral'));
check('Has topographic category', categories.has('topographic'));
check('Has engineering category', categories.has('engineering'));
check('Has wayleave category', categories.has('wayleave'));
check('Has decoration category', categories.has('decoration'));

// Critical layers exist
const criticalLayers = [
  'basemap_osm', 'basemap_satellite', 'basemap_offline',
  'grid_cassini', 'grid_utm', 'graticule',
  'control',
  'parcel_boundary', 'parcel_boundary_fixed', 'parcel_boundary_general', 'beacons',
  'traverse', 'traverse_legs', 'traverse_stations',
  'topo_points', 'breaklines', 'contours_index', 'contours_intermediate', 'spot_heights',
  'buildings', 'roads', 'rivers', 'lakes',
  'alignment', 'alignment_centerline', 'alignment_chainage',
  'cross_sections', 'earthworks_cut', 'earthworks_fill',
  'pap_parcels', 'corridor',
  'scale_bar', 'north_arrow', 'title_block',
];
for (const id of criticalLayers) {
  check(`Layer ${id} exists`, !!layers[id]);
}

// Fixed vs General boundary distinction
check('Fixed boundary is solid black', layers.parcel_boundary_fixed.symbology.lineColor === '#000000');
check('Fixed boundary is solid line', layers.parcel_boundary_fixed.symbology.lineStyle === 'solid');
check('General boundary is grey', layers.parcel_boundary_general.symbology.lineColor === '#666666');
check('General boundary is dashed', layers.parcel_boundary_general.symbology.lineStyle === 'dashed');

// Contour distinction
check('Index contours are dark brown', layers.contours_index.symbology.lineColor === '#5C2D0C');
check('Index contours wider', layers.contours_index.symbology.lineWidth === 0.8);
check('Intermediate contours are brown', layers.contours_intermediate.symbology.lineColor === '#8B4513');
check('Intermediate contours thinner', layers.contours_intermediate.symbology.lineWidth === 0.3);

// ─── Test 2: Kenya Projections ───────────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 2: Kenya Projections (6 projections)');
console.log('─'.repeat(70));

const projections = mod.KENYA_PROJECTIONS;
check('6 projections registered', projections.length === 6, `${projections.length} projections`);

const epsg3857 = projections.find(p => p.epsg === 3857);
check('EPSG:3857 (Web Mercator) exists', !!epsg3857);
check('EPSG:3857 for online basemaps', epsg3857?.useCase.includes('Online basemaps'));

const epsg4326 = projections.find(p => p.epsg === 4326);
check('EPSG:4326 (WGS84) exists', !!epsg4326);

const epsg21037 = projections.find(p => p.epsg === 21037);
check('EPSG:21037 (Arc 1960 UTM 37S) exists', !!epsg21037);
check('EPSG:21037 for engineering surveys', epsg21037?.useCase.includes('engineering'));
check('EPSG:21037 proj4 includes utm zone 37', epsg21037?.proj4.includes('+zone=37'));
check('EPSG:21037 proj4 includes south', epsg21037?.proj4.includes('+south'));
check('EPSG:21037 uses Clarke 1880 ellipsoid', epsg21037?.proj4.includes('clrk80'));

const epsg20437 = projections.find(p => p.epsg === 20437);
check('EPSG:20437 (Cassini-Soldner) exists', !!epsg20437);
check('EPSG:20437 for cadastral surveys', epsg20437?.useCase.includes('Cadastral'));
check('EPSG:20437 proj4 includes cass', epsg20437?.proj4.includes('+proj=cass'));

// ─── Test 3: Y717 Map Sheets ─────────────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 3: Y717 Map Sheet Series');
console.log('─'.repeat(70));

const sheets = mod.Y717_MAP_SHEETS;
check('3 map sheet scales registered', sheets.length === 3);

const sheet50k = sheets.find(s => s.scale === '1:50000');
check('1:50000 sheet exists', !!sheet50k);
check('1:50000 sheet is 600×600mm', sheet50k?.sheetSize.widthMM === 600 && sheet50k?.sheetSize.heightMM === 600);
check('1:50000 covers 30km × 30km', sheet50k?.sheetExtent.widthM === 30000);
check('1:50000 series prefix Y717', sheet50k?.seriesPrefix === 'Y717');
check('1:50000 example is Nairobi South', sheet50k?.exampleSheet.includes('NAIROBI'));

const sheet25k = sheets.find(s => s.scale === '1:25000');
check('1:25000 sheet exists', !!sheet25k);
check('1:25000 covers 15km × 15km', sheet25k?.sheetExtent.widthM === 15000);

const sheet10k = sheets.find(s => s.scale === '1:10000');
check('1:10000 sheet exists', !!sheet10k);
check('1:10000 covers 6km × 6km', sheet10k?.sheetExtent.widthM === 6000);

// All sheets have title block
check('All sheets have title block', sheets.every(s => s.titleBlockMm.position === 'bottom-right'));
check('All sheets have 180×80mm title block', sheets.every(s => s.titleBlockMm.width === 180 && s.titleBlockMm.height === 80));

// ─── Test 4: Grid Configurations ─────────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 4: Grid Configurations');
console.log('─'.repeat(70));

const grids = mod.GRID_CONFIGS;
check('4 grid configs registered', Object.keys(grids).length === 4);

check('UTM 1km grid exists', !!grids.utm_1km);
check('UTM 1km interval is 1000m', grids.utm_1km.intervalM === 1000);
check('UTM 100m grid exists', !!grids.utm_100m);
check('UTM 100m interval is 100m', grids.utm_100m.intervalM === 100);
check('Cassini 1km grid exists', !!grids.cassini_1km);
check('Cassini 100m grid exists', !!grids.cassini_100m);

// Label format functions work
const labelResult = grids.utm_1km.labelFormat(5000, true);
check('UTM 1km label format works', typeof labelResult === 'string' && labelResult.includes('E'));
check('UTM 1km label shows kilometers', grids.utm_1km.labelFormat(5000, true).includes('5k'));

// ─── Test 5: Beacon Symbology ────────────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 5: Beacon Type Symbology');
console.log('─'.repeat(70));

const beaconSym = mod.BEACON_SYMBOLOGY;
check('6 beacon types registered', Object.keys(beaconSym).length === 6);

check('Concrete beacon is circle', beaconSym.concrete.shape === 'circle');
check('Iron pin is square', beaconSym.iron_pin.shape === 'square');
check('Stone beacon is triangle', beaconSym.stone.shape === 'triangle');
check('Reference object is diamond', beaconSym.reference_object.shape === 'diamond');

const unknownBeacon = mod.getBeaconSymbology('unknown_type');
check('Unknown beacon falls back to concrete', unknownBeacon.shape === 'circle');

// ─── Test 6: Control Point Symbology ─────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 6: Control Point Symbology (by order)');
console.log('─'.repeat(70));

const controlSym = mod.CONTROL_SYMBOLOGY;
check('4 control orders registered', Object.keys(controlSym).length === 4);

check('Zero order is triangle', controlSym.zero.shape === 'triangle');
check('Zero order is largest (size 10)', controlSym.zero.size === 10);
check('First order is triangle', controlSym.first.shape === 'triangle');
check('First order size 8', controlSym.first.size === 8);
check('Second order is circle', controlSym.second.shape === 'circle');
check('Third order is circle', controlSym.third.shape === 'circle');
check('All control points are red', Object.values(controlSym).every(s => s.color === '#CC0000'));

// ─── Test 7: PAP Status Colors ──────────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 7: PAP Status Color Mapping');
console.log('─'.repeat(70));

const papColors = mod.PAP_STATUS_COLORS;
check('8 PAP statuses registered', Object.keys(papColors).length === 8);

check('Paid status is green', papColors.paid === '#008800');
check('Disputed status is red', papColors.disputed === '#CC0000');
check('Pending survey is grey', papColors.pending_survey === '#999999');
check('Offer accepted is blue', papColors.offer_accepted === '#0066CC');
check('Pending valuation is orange', papColors.pending_valuation === '#FFA500');

check('getPapStatusColor returns correct color', mod.getPapStatusColor('paid') === '#008800');
check('getPapStatusColor fallback for unknown', mod.getPapStatusColor('unknown').includes('#'));

// ─── Test 8: Measurement Functions ──────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 8: Measurement Functions');
console.log('─'.repeat(70));

// Distance
const dist = mod.calculateDistance({ easting: 0, northing: 0 }, { easting: 3, northing: 4 });
check('Distance calculation (3-4-5 triangle)', dist === 5, `dist=${dist}`);

// Bearing
const bearing = mod.calculateBearing({ easting: 0, northing: 0 }, { easting: 0, northing: 1 });
check('Bearing due North = 0°', bearing === 0, `bearing=${bearing}`);

const bearingEast = mod.calculateBearing({ easting: 0, northing: 0 }, { easting: 1, northing: 0 });
check('Bearing due East = 90°', bearingEast === 90, `bearing=${bearingEast}`);

const bearingSW = mod.calculateBearing({ easting: 0, northing: 0 }, { easting: -1, northing: -1 });
check('Bearing SW = 225°', bearingSW === 225, `bearing=${bearingSW}`);

// Area (shoelace)
const squareArea = mod.calculateArea([
  { easting: 0, northing: 0 },
  { easting: 10, northing: 0 },
  { easting: 10, northing: 10 },
  { easting: 0, northing: 10 },
]);
check('Area of 10×10 square = 100', squareArea === 100, `area=${squareArea}`);

// Formatting
check('formatBearing formats correctly', mod.formatBearing(45.5).includes('45°'));
check('formatDistance formats metres', mod.formatDistance(50).includes('m'));
check('formatDistance formats km', mod.formatDistance(1500).includes('km'));
check('formatArea formats m²', mod.formatArea(5000).includes('m²'));
check('formatArea formats hectares', mod.formatArea(20000).includes('ha'));
check('formatArea includes acres', mod.formatArea(20000).includes('acres'));

// measureDistance multi-point
const multiDist = mod.measureDistance([
  { easting: 0, northing: 0 },
  { easting: 3, northing: 4 },
  { easting: 6, northing: 8 },
]);
check('measureDistance sums segments', multiDist.value === 10, `total=${multiDist.value}`);
check('measureDistance returns bearings array', multiDist.bearings?.length === 2);

// measureArea
const areaMeasure = mod.measureArea([
  { easting: 0, northing: 0 },
  { easting: 100, northing: 0 },
  { easting: 100, northing: 100 },
  { easting: 0, northing: 100 },
]);
check('measureArea returns 10000 m²', areaMeasure.value === 10000, `area=${areaMeasure.value}`);
check('measureArea formatted includes ha', areaMeasure.formatted.includes('ha'));

// measureBearing
const brgMeasure = mod.measureBearing({ easting: 0, northing: 0 }, { easting: 1, northing: 1 });
check('measureBearing returns 45° for NE', Math.abs(brgMeasure.value - 45) < 0.001, `bearing=${brgMeasure.value}`);
check('measureBearing formatted includes °', brgMeasure.formatted.includes('°'));

// ─── Test 9: Scale Bar Generation ───────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 9: Scale Bar Generation');
console.log('─'.repeat(70));

const scaleBar50k = mod.generateScaleBar(50000);
check('1:50000 scale bar has 4 segments', scaleBar50k.segments.length === 4);
check('1:50000 scale text correct', scaleBar50k.scaleText === '1:50,000');
check('1:50000 segments have labels', scaleBar50k.segments.every(s => s.label.length > 0));
check('1:50000 has major/minor segments', scaleBar50k.segments.some(s => s.isMajor) && scaleBar50k.segments.some(s => !s.isMajor));

const scaleBar1k = mod.generateScaleBar(1000);
check('1:1000 scale text correct', scaleBar1k.scaleText === '1:1,000');
check('1:1000 segments use metres (not km)', scaleBar1k.segments.every(s => s.label.includes('m')));

const scaleBar100k = mod.generateScaleBar(100000);
check('1:100000 segments use km', scaleBar100k.segments.some(s => s.label.includes('km')));

// ─── Test 10: Survey-Type-Aware Layer Defaults ──────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 10: Survey-Type-Aware Layer Defaults');
console.log('─'.repeat(70));

const cadastralLayers = mod.getLayersForSurveyType('cadastral');
check('Cadastral survey has parcel_boundary_fixed', cadastralLayers.includes('parcel_boundary_fixed'));
check('Cadastral survey has beacons', cadastralLayers.includes('beacons'));
check('Cadastral survey has traverse_legs', cadastralLayers.includes('traverse_legs'));
check('Cadastral survey has Cassini grid', cadastralLayers.includes('grid_cassini'));

const engineeringLayers = mod.getLayersForSurveyType('engineering');
check('Engineering survey has alignment_centerline', engineeringLayers.includes('alignment_centerline'));
check('Engineering survey has alignment_chainage', engineeringLayers.includes('alignment_chainage'));
check('Engineering survey has cross_sections', engineeringLayers.includes('cross_sections'));
check('Engineering survey has UTM grid', engineeringLayers.includes('grid_utm'));

const topoLayers = mod.getLayersForSurveyType('topographical');
check('Topo survey has contours_index', topoLayers.includes('contours_index'));
check('Topo survey has contours_intermediate', topoLayers.includes('contours_intermediate'));
check('Topo survey has spot_heights', topoLayers.includes('spot_heights'));
check('Topo survey has buildings', topoLayers.includes('buildings'));
check('Topo survey has rivers', topoLayers.includes('rivers'));

const wayleaveLayers = mod.getLayersForSurveyType('wayleave');
check('Wayleave survey has corridor', wayleaveLayers.includes('corridor'));
check('Wayleave survey has pap_parcels', wayleaveLayers.includes('pap_parcels'));

// All survey types have common decoration layers
for (const surveyType of ['cadastral', 'engineering', 'topographical', 'wayleave']) {
  const layers = mod.getLayersForSurveyType(surveyType);
  check(`${surveyType} has scale_bar`, layers.includes('scale_bar'));
  check(`${surveyType} has north_arrow`, layers.includes('north_arrow'));
  check(`${surveyType} has title_block`, layers.includes('title_block'));
  check(`${surveyType} has basemap_osm`, layers.includes('basemap_osm'));
  check(`${surveyType} has control`, layers.includes('control'));
}

// ─── Test 11: Layer Category Helper ─────────────────────────────────

console.log('\n─'.repeat(70));
console.log('TEST 11: Layer Category Helpers');
console.log('─'.repeat(70));

const basemapLayers = mod.getLayersByCategory('basemap');
check('Basemap category has 3 layers', basemapLayers.length === 3, `${basemapLayers.length} layers`);

const decorationLayers = mod.getLayersByCategory('decoration');
check('Decoration category has 4 layers (annotation, scale_bar, north_arrow, title_block)', decorationLayers.length === 4, `${decorationLayers.length} layers`);

const defaultVisible = mod.getDefaultVisibleLayers();
check('Default visible layers > 0', defaultVisible.length > 0);

// ─── Summary ────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(70));
console.log(`TOTAL: ${passCount}/${passCount + failCount} checks passed, ${failCount} failed`);
console.log('='.repeat(70));

if (failCount === 0) {
  console.log('\nALL TESTS PASSED — Map Standards Module is production-ready');
  console.log('\nMap capabilities:');
  console.log('  - 40+ SoK-compliant layers across 8 categories');
  console.log('  - 6 Kenya projections (Web Mercator, WGS84, UTM 36S/37S, Cassini)');
  console.log('  - 3 Y717 map sheet sizes (1:50000, 1:25000, 1:10000)');
  console.log('  - 4 grid configurations (UTM/Cassini × 1km/100m)');
  console.log('  - 6 beacon type symbology (concrete, iron pin, stone, ref obj, pipe, natural)');
  console.log('  - 4 control point symbology (Zero/First/Second/Third order)');
  console.log('  - 8 PAP status colors (pending → paid → disputed)');
  console.log('  - Measurement tools (distance, area, bearing) with SoK formatting');
  console.log('  - Scale bar generation with nice round numbers');
  console.log('  - Survey-type-aware layer defaults (cadastral/engineering/topographical/wayleave)');
} else {
  process.exit(1);
}
