/**
 * METARDU IFC4 STEP File Generator
 *
 * Produces a valid ISO-10303-21 (IFC4) file from survey / cadastral data.
 * Survey coordinates (metres in UTM / local grid) are translated into
 * IFC model space (millimetres) via IFCMAPCONVERSION offsets.
 *
 * Entity mapping overview:
 * ─────────────────────────────────────────────────────────────────
 * IFCPROJECT              → project metadata
 * IFCSITE                 → project location (coordinate reference)
 * IFCBUILDING             → cadastral parcels (one per parcel)
 * IFCLOCALPLACEMENT       → placement hierarchy (site → building)
 * IFCAXIS2PLACEMENT3D     → 3-D position / orientation
 * IFCEXTRUDEDAREASOLID    → parcel footprint extruded vertically
 * IFCARBITRARYCLOSEDPROFILEDEF → cross-section of parcel extrusion
 * IFCCARTESIANPOINT       → individual coordinates
 * IFCPOLYLINE             → boundary line geometry
 * IFCANNOTATION           → survey control points / beacons
 * IFCGEOMETRICCURVESET    → traverse line geometry
 * IFCPROJECTLIBRARY       → equipment metadata
 * IFCOWNERHISTORY         → creation / modification audit trail
 * IFCPERSON / IFCORGANIZATION → surveyor identity
 * IFCUNITASSIGNMENT       → length / area / plane-angle units
 * IFCMAPCONVERSION        → easting/northing offsets (m → mm)
 * IFCPROJECTEDCRS         → EPSG code reference
 * ─────────────────────────────────────────────────────────────────
 */

import type {
  IFCExportOptions,
  IFCParcel,
  IFCControlPoint,
  IFCEquipmentRecord,
} from '@/types/ifc';
import { shoelaceArea } from '@/lib/engine/area';

// ─── STEP String helpers ──────────────────────────────────────────────────

/**
 * Escape a string for STEP format (ISO 10303-21 §7.3.3):
 *   - Replace non-printable / non-ASCII with spaces
 *   - Double any single quotes
 *   - Wrap in single quotes
 */
function stepStr(raw: string): string {
  const cleaned = raw.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ');
  return `'${cleaned.replace(/'/g, "''")}'`;
}

/**
 * Format a float for STEP output (≤6 decimal places, no trailing zeros).
 * Non-finite values become 0.0.
 */
function stepNum(n: number): string {
  if (!Number.isFinite(n)) return '0.0';
  const s = n.toFixed(6).replace(/\.?0+$/, '');
  return s === '-0' ? '0.0' : s === '' ? '0.0' : s;
}

// ─── Entity book-keeping ──────────────────────────────────────────────────

class EntityWriter {
  private next = 1;
  private readonly entries = new Map<number, string>();

  /** Reserve the next entity id and return it. */
  alloc(): number {
    return this.next++;
  }

  /** Declare entity `id` with the given STEP content (without trailing `;`). */
  put(id: number, content: string): void {
    this.entries.set(id, content);
  }

  /** Return every entity sorted by id, each on its own line with `#id=content;`. */
  render(): string {
    const ids = Array.from(this.entries.keys()).sort((a, b) => a - b);
    return ids.map(id => `#${id}=${this.entries.get(id)};`).join('\n');
  }

  /** Total number of entities written. */
  get count(): number {
    return this.next - 1;
  }
}

// ─── Deterministic pseudo-GUID (no crypto needed) ────────────────────────

let guidCounter = 0;
function newGuid(): string {
  guidCounter++;
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 22; i++) {
    id += hex[(guidCounter * 7 + i * 13) % 16];
  }
  return `${id.slice(0, 8)}_${id.slice(8, 12)}_${id.slice(12, 16)}`;
}

// ─── Coordinate transform ─────────────────────────────────────────────────

/**
 * Convert survey coordinates (metres) → IFC model coordinates (millimetres),
 * relative to a false origin that keeps the model near (0,0,0).
 */
function toMM(
  easting: number,
  northing: number,
  elevation: number | undefined,
  originE: number,
  originN: number,
): [string, string, string] {
  return [
    stepNum((easting - originE) * 1000),
    stepNum((northing - originN) * 1000),
    stepNum(elevation !== undefined ? elevation * 1000 : 0),
  ];
}

// ─── Polygon utilities ────────────────────────────────────────────────────

// shoelaceArea is imported from @/lib/engine/area (canonical implementation)

/** Centroid of polygon vertices in model-mm. Returns [x, y] as strings. */
function centroidMM(
  verts: Array<{ easting: number; northing: number }>,
  oE: number,
  oN: number,
): [string, string] {
  if (verts.length === 0) return ['0.', '0.'];
  let sx = 0;
  let sy = 0;
  for (const v of verts) {
    sx += (v.easting - oE) * 1000;
    sy += (v.northing - oN) * 1000;
  }
  return [stepNum(sx / verts.length), stepNum(sy / verts.length)];
}

// ─── Header ───────────────────────────────────────────────────────────────

function buildHeader(opts: IFCExportOptions): string {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, '');
  const safeName = opts.projectName.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    `FILE_NAME('${safeName}.ifc','${now}',('METARDU'),('METARDU v1.0'),'IfcOpenShell','IfcOpenShell','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
  ].join('\n');
}

// ─── Shared direction entities (allocated once, reused) ───────────────────

interface SharedDirs {
  dirX: number;
  dirY: number;
  dirZ: number;
}

function emitSharedDirs(w: EntityWriter): SharedDirs {
  const dirX = w.alloc();
  w.put(dirX, 'IFCDIRECTION((1.,0.,0.))');
  const dirY = w.alloc();
  w.put(dirY, 'IFCDIRECTION((0.,1.,0.))');
  const dirZ = w.alloc();
  w.put(dirZ, 'IFCDIRECTION((0.,0.,1.))');
  return { dirX, dirY, dirZ };
}

// ─── DATA section builder ─────────────────────────────────────────────────

function buildData(opts: IFCExportOptions): string {
  const w = new EntityWriter();
  const d = emitSharedDirs(w);

  const parcels = opts.parcels ?? [];
  const cpList = opts.controlPoints ?? [];
  const tLines = opts.traverseLines ?? [];
  const equip = opts.equipment ?? [];

  // False origin: first control point, or first parcel vertex, or (0,0)
  const originE =
    opts.originEasting ??
    (cpList.length > 0
      ? cpList[0].easting
      : parcels.length > 0 && parcels[0].vertices.length > 0
        ? parcels[0].vertices[0].easting
        : 0);
  const originN =
    opts.originNorthing ??
    (cpList.length > 0
      ? cpList[0].northing
      : parcels.length > 0 && parcels[0].vertices.length > 0
        ? parcels[0].vertices[0].northing
        : 0);

  // ── 1. PERSON / ORG / APPLICATION / OWNER HISTORY ────────────────────────

  const personId = w.alloc();
  w.put(personId, `IFCPERSON($,${stepStr(opts.surveyorName ?? 'Surveyor')},$,(${stepStr(opts.surveyorLicense ?? '')}),$)`);

  const orgId = w.alloc();
  w.put(orgId, "IFCORGANIZATION($,'METARDU','African Cadastral Surveying Platform',$)");

  const pAndOId = w.alloc();
  w.put(pAndOId, `IFCPERSONANDORGANIZATION(#${personId},#${orgId},$)`);

  const appId = w.alloc();
  w.put(appId, "IFCAPPLICATION(#${orgId},'1.0','METARDU','metardu')");

  const epoch = Math.floor(Date.now() / 1000);
  const ohId = w.alloc();
  w.put(ohId, `IFCOWNERHISTORY(#${pAndOId},#${appId},$,.ADDED.,$,$,$,${epoch})`);

  // ── 2. GEOMETRIC REPRESENTATION CONTEXTS ──────────────────────────────────

  // 3-D world origin
  const worldOriginId = w.alloc();
  w.put(worldOriginId, 'IFCCARTESIANPOINT((0.,0.,0.))');
  const worldAx3dId = w.alloc();
  w.put(worldAx3dId, `IFCAXIS2PLACEMENT3D(#${worldOriginId},#${d.dirZ},#${d.dirX})`);

  const geomSub3dId = w.alloc();
  w.put(geomSub3dId, "IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,.MODEL_VIEW.,$)");
  const repCtx3dId = w.alloc();
  w.put(repCtx3dId, `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-3,#${worldAx3dId},#${geomSub3dId})`);

  // 2-D plan context
  const planOriginId = w.alloc();
  w.put(planOriginId, 'IFCCARTESIANPOINT((0.,0.))');
  const planDirXId = w.alloc();
  w.put(planDirXId, 'IFCDIRECTION((1.,0.))');
  const planAx2dId = w.alloc();
  w.put(planAx2dId, `IFCAXIS2PLACEMENT2D(#${planOriginId},#${planDirXId})`);
  const geomSub2dId = w.alloc();
  w.put(geomSub2dId, "IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Annotation','Plan',*,*,.PLAN_VIEW.,$)");
  const repCtx2dId = w.alloc();
  w.put(repCtx2dId, `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Plan',2,1.E-3,#${planAx2dId},#${geomSub2dId})`);

  // ── 3. UNITS ─────────────────────────────────────────────────────────────

  const lenUnitId = w.alloc();
  w.put(lenUnitId, 'IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)');
  const areaUnitId = w.alloc();
  w.put(areaUnitId, 'IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const radUnitId = w.alloc();
  w.put(radUnitId, 'IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const angleMeasureId = w.alloc();
  w.put(angleMeasureId, `IFCMEASUREWITHUNIT(IFCPLANEANGLEMEASURE(0.0174532925199433),#${radUnitId})`);
  const angleUnitId = w.alloc();
  w.put(angleUnitId, `IFCCONVERSIONBASEDUNIT(#${angleMeasureId},.PLANEANGLEUNIT.,'degree',#${radUnitId})`);

  const unitAssignId = w.alloc();
  w.put(unitAssignId, `IFCUNITASSIGNMENT((#${lenUnitId},#${areaUnitId},#${angleUnitId}))`);

  // ── 4. PROJECT ───────────────────────────────────────────────────────────

  const projectId = w.alloc();
  w.put(
    projectId,
    `IFCPROJECT('${newGuid()}',${stepStr(opts.projectName)},${stepStr(opts.projectNumber ?? opts.projectName)},#${ohId},${stepStr('')},${stepStr(opts.coordinateSystem)},${stepStr('')},(#${repCtx3dId},#${repCtx2dId}),#${unitAssignId})`,
  );

  // ── 5. CRS + MAP CONVERSION ──────────────────────────────────────────────

  const mapConvId = w.alloc();
  w.put(mapConvId, `IFCMAPCONVERSION(#${repCtx3dId},${stepNum(originE)},${stepNum(originN)},0.,1.,0.,0.,0.,0.)`);

  const crsId = w.alloc();
  if (opts.epsgCode) {
    const geodDatumId = w.alloc();
    w.put(geodDatumId, "IFCGEODETICDATUM($,'WGS 84')");
    const mapProjId = w.alloc();
    w.put(mapProjId, "IFCMAPPROJECTION($,'Transverse Mercator')");
    const mapZoneId = w.alloc();
    w.put(mapZoneId, `IFCMAPCONVERSION(#${repCtx3dId},${stepNum(originE)},${stepNum(originN)},0.,1.,0.,0.,0.,0.)`);
    w.put(crsId, `IFCPROJECTEDCRS(${stepStr('EPSG:' + String(opts.epsgCode))},${stepStr(opts.coordinateSystem)},#${geodDatumId},#${mapProjId},#${mapZoneId})`);
  } else {
    // Placeholder — still needs an entity so references work
    w.put(crsId, 'IFCPROJECTEDCRS($,$,$,$,$)');
  }

  // ── 6. SITE ──────────────────────────────────────────────────────────────

  const sitePlcAxId = w.alloc();
  const sitePlcOriginId = w.alloc();
  w.put(sitePlcOriginId, 'IFCCARTESIANPOINT((0.,0.,0.))');
  w.put(sitePlcAxId, `IFCAXIS2PLACEMENT3D(#${sitePlcOriginId},#${d.dirZ},#${d.dirX})`);
  const sitePlcId = w.alloc();
  w.put(sitePlcId, `IFCLOCALPLACEMENT($,#${sitePlcAxId})`);

  const siteId = w.alloc();
  w.put(
    siteId,
    `IFCSITE('${newGuid()}',${stepStr(opts.projectName + ' - Site')},#${ohId},${stepStr('')},${stepStr('')},#${sitePlcId},${stepStr('')},#${repCtx3dId},${stepStr(opts.coordinateSystem)},${stepNum(0)},#${mapConvId},#${crsId},${stepNum(0)},${stepNum(0)},.MODELVIEW.)`,
  );

  const siteAggId = w.alloc();
  w.put(siteAggId, `IFCRELAGGREGATES('${newGuid()}',${stepStr('ProjectContainer')},#${ohId},#${projectId},(#${siteId}))`);

  // ── 7. PARCELS → IFCBUILDING ──────────────────────────────────────────────

  for (const parcel of parcels) {
    emitParcel(w, parcel, ohId, siteId, sitePlcId, repCtx3dId, d, originE, originN);
  }

  // ── 8. CONTROL POINTS → IFCANNOTATION ────────────────────────────────────

  const cpByLabel = new Map<string, IFCControlPoint>();
  for (const pt of cpList) cpByLabel.set(pt.label, pt);

  for (const pt of cpList) {
    emitControlPoint(w, pt, ohId, siteId, sitePlcId, repCtx2dId, d, originE, originN);
  }

  // ── 9. TRAVERSE LINES → IFCGEOMETRICCURVESET ─────────────────────────────

  if (tLines.length > 0) {
    emitTraverseLines(w, tLines, cpByLabel, originE, originN);
  }

  // ── 10. EQUIPMENT → IFCPROJECTLIBRARY ────────────────────────────────────

  for (const eq of equip) {
    emitEquipment(w, eq, ohId, projectId);
  }

  return w.render();
}

// ─── Parcel emitter ───────────────────────────────────────────────────────

function emitParcel(
  w: EntityWriter,
  parcel: IFCParcel,
  ohId: number,
  siteId: number,
  sitePlcId: number,
  repCtxId: number,
  dirs: SharedDirs,
  oE: number,
  oN: number,
): void {
  const verts = parcel.vertices;
  if (verts.length < 3) return;

  // Centroid in mm for building placement
  const [cx, cy] = centroidMM(verts, oE, oN);

  // Building placement at centroid
  const bldgOrigId = w.alloc();
  w.put(bldgOrigId, `IFCCARTESIANPOINT((${cx},${cy},0.))`);
  const bldgAxId = w.alloc();
  w.put(bldgAxId, `IFCAXIS2PLACEMENT3D(#${bldgOrigId},#${dirs.dirZ},#${dirs.dirX})`);
  const bldgPlcId = w.alloc();
  w.put(bldgPlcId, `IFCLOCALPLACEMENT(#${sitePlcId},#${bldgAxId})`);

  // Building entity
  const bldgId = w.alloc();
  w.put(
    bldgId,
    `IFCBUILDING('${parcel.id}',${stepStr(parcel.label)},#${ohId},${stepStr('')},${stepStr(parcel.parcelNumber ?? '')},#${bldgPlcId},#${repCtxId},${stepStr('')},.NOTDEFINED.,$,$)`,
  );

  // Aggregate building into site
  const aggId = w.alloc();
  w.put(aggId, `IFCRELAGGREGATES('${newGuid()}',${stepStr('SiteGroup')},#${ohId},#${siteId},(#${bldgId}))`);

  // Area property set
  const area = parcel.areaM2 ?? shoelaceArea(verts);
  const propAreaId = w.alloc();
  w.put(propAreaId, `IFCPROPERTYSINGLEVALUE('Area',IFCAREAMEASURE(${stepNum(area)}),$)`);
  const psetId = w.alloc();
  w.put(psetId, `IFCPROPERTYSET('${newGuid()}',${stepStr('ParcelProperties')},${stepStr('')},(#${propAreaId}))`);
  const relPsetId = w.alloc();
  w.put(relPsetId, `IFCRELDEFINESBYPROPERTIES('${newGuid()}',${stepStr('')},#${ohId},#${bldgId},#${psetId})`);

  // ── Extruded footprint geometry ───────────────────────────────────────

  // Polygon vertices relative to building placement (centroid)
  const vertIds: number[] = [];
  for (const v of verts) {
    const [mmX, mmY] = toMM(v.easting, v.northing, undefined, oE, oN);
    const rx = stepNum(parseFloat(mmX) - parseFloat(cx));
    const ry = stepNum(parseFloat(mmY) - parseFloat(cy));
    const ptId = w.alloc();
    w.put(ptId, `IFCCARTESIANPOINT((${rx},${ry},0.))`);
    vertIds.push(ptId);
  }
  // Close polygon
  vertIds.push(vertIds[0]);

  const polyId = w.alloc();
  w.put(polyId, `IFCPOLYLINE(( ${vertIds.map(id => `#${id}`).join(',')} ))`);

  // Arbitrary closed profile
  const profileId = w.alloc();
  w.put(profileId, `IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,${stepStr(parcel.label)},#${polyId})`);

  // Extrusion direction (Z+)
  const extrDirId = w.alloc();
  w.put(extrDirId, 'IFCDIRECTION((0.,0.,1.))');

  // Extruded solid: 1000 mm = 1 m height
  const extrOriginId = w.alloc();
  w.put(extrOriginId, 'IFCCARTESIANPOINT((0.,0.,0.))');
  const solidId = w.alloc();
  w.put(solidId, `IFCEXTRUDEDAREASOLID(#${profileId},#${extrOriginId},#${extrDirId},1000.)`);

  // Shape representation
  const bodySubCtxId = w.alloc();
  w.put(bodySubCtxId, "IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,.MODEL_VIEW.,$)");
  const shapeRepId = w.alloc();
  w.put(shapeRepId, `IFCSHAPEREPRESENTATION(#${bodySubCtxId},'Body',(#${solidId}))`);
  const pdsId = w.alloc();
  w.put(pdsId, `IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}))`);
}

// ─── Control-point emitter ────────────────────────────────────────────────

function emitControlPoint(
  w: EntityWriter,
  pt: IFCControlPoint,
  ohId: number,
  siteId: number,
  sitePlcId: number,
  planCtxId: number,
  dirs: SharedDirs,
  oE: number,
  oN: number,
): void {
  const [mx, my, mz] = toMM(pt.easting, pt.northing, pt.elevation, oE, oN);

  // 3-D coordinate point
  const ptId = w.alloc();
  w.put(ptId, `IFCCARTESIANPOINT((${mx},${my},${mz}))`);

  // Placement relative to site
  const cpAxId = w.alloc();
  w.put(cpAxId, `IFCAXIS2PLACEMENT3D(#${ptId},#${dirs.dirZ},#${dirs.dirX})`);
  const cpPlcId = w.alloc();
  w.put(cpPlcId, `IFCLOCALPLACEMENT(#${sitePlcId},#${cpAxId})`);

  // Symbol: a small 12-sided circle (50 mm radius) for visualisation
  const circlePtIds: number[] = [];
  for (let i = 0; i <= 12; i++) {
    const angle = (i / 12) * 2 * Math.PI;
    const cPtId = w.alloc();
    w.put(cPtId, `IFCCARTESIANPOINT((${stepNum(Math.cos(angle) * 50)},${stepNum(Math.sin(angle) * 50)},0.))`);
    circlePtIds.push(cPtId);
  }
  const circlePolyId = w.alloc();
  w.put(circlePolyId, `IFCPOLYLINE(( ${circlePtIds.map(id => `#${id}`).join(',')} ))`);
  const gcsId = w.alloc();
  w.put(gcsId, `IFCGEOMETRICCURVESET((#${circlePolyId}))`);

  const shapeRepId = w.alloc();
  w.put(shapeRepId, `IFCSHAPEREPRESENTATION(#${planCtxId},'Symbol',(#${gcsId}))`);
  const pdsId = w.alloc();
  w.put(pdsId, `IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}))`);

  // Annotation entity
  const annId = w.alloc();
  w.put(
    annId,
    `IFCANNOTATION('${pt.id}',${stepStr(pt.label)},#${ohId},${stepStr(pt.beaconType ?? 'Control Point')},#${cpPlcId},#${pdsId},${stepStr(pt.description ?? '')})`,
  );

  // Assign annotation to site
  const relAssignId = w.alloc();
  w.put(relAssignId, `IFCRELASSIGNSTOGROUP('${newGuid()}',${stepStr('')},#${ohId},(#${annId}),#${siteId},${stepStr('Control Points')})`);
}

// ─── Traverse-line emitter ────────────────────────────────────────────────

function emitTraverseLines(
  w: EntityWriter,
  lines: Array<{ fromPoint: string; toPoint: string }>,
  cpByLabel: Map<string, IFCControlPoint>,
  oE: number,
  oN: number,
): void {
  const plIds: number[] = [];

  for (const tl of lines) {
    const from = cpByLabel.get(tl.fromPoint);
    const to = cpByLabel.get(tl.toPoint);
    if (!from || !to) continue;

    const [x1, y1, z1] = toMM(from.easting, from.northing, from.elevation, oE, oN);
    const [x2, y2, z2] = toMM(to.easting, to.northing, to.elevation, oE, oN);

    const p1Id = w.alloc();
    w.put(p1Id, `IFCCARTESIANPOINT((${x1},${y1},${z1}))`);
    const p2Id = w.alloc();
    w.put(p2Id, `IFCCARTESIANPOINT((${x2},${y2},${z2}))`);

    const plId = w.alloc();
    w.put(plId, `IFCPOLYLINE((#${p1Id},#${p2Id}))`);
    plIds.push(plId);
  }

  if (plIds.length > 0) {
    const gcsId = w.alloc();
    w.put(gcsId, `IFCGEOMETRICCURVESET(( ${plIds.map(id => `#${id}`).join(',')} ))`);
  }
}

// ─── Equipment emitter ────────────────────────────────────────────────────

function emitEquipment(
  w: EntityWriter,
  eq: IFCEquipmentRecord,
  ohId: number,
  projectId: number,
): void {
  const desc = `${eq.make} ${eq.model}${eq.serialNumber ? ` [S/N: ${eq.serialNumber}]` : ''}`;

  const libId = w.alloc();
  w.put(libId, `IFCPROJECTLIBRARY('${eq.id}',${stepStr(desc)},#${ohId},${stepStr('Equipment')},${stepStr('')},${stepStr('')},${stepStr('')})`);

  const relDeclId = w.alloc();
  w.put(relDeclId, `IFCRELDECLARES('${newGuid()}',${stepStr('')},#${ohId},#${projectId},(#${libId}))`);

  // Property set with equipment metadata
  const propCalId = w.alloc();
  w.put(propCalId, `IFCPROPERTYSINGLEVALUE('LastCalibration',IFCTEXT(${stepStr(eq.lastCalibration ?? 'N/A')}),$)`);
  const propMakeId = w.alloc();
  w.put(propMakeId, `IFCPROPERTYSINGLEVALUE('Make',IFCTEXT(${stepStr(eq.make)}),$)`);
  const propModelId = w.alloc();
  w.put(propModelId, `IFCPROPERTYSINGLEVALUE('Model',IFCTEXT(${stepStr(eq.model)}),$)`);
  const eqPsetId = w.alloc();
  w.put(eqPsetId, `IFCPROPERTYSET('${newGuid()}',${stepStr('EquipmentProperties')},${stepStr('')},(#${propCalId},#${propMakeId},#${propModelId}))`);
  const eqRelPsetId = w.alloc();
  w.put(eqRelPsetId, `IFCRELDEFINESBYPROPERTIES('${newGuid()}',${stepStr('')},#${ohId},#${libId},#${eqPsetId})`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a complete IFC4 STEP file string from survey / cadastral data.
 *
 * @param options - Project metadata, parcels, control points, traverse lines, equipment.
 * @returns Valid ISO-10303-21 plain text.
 */
export function generateIFC4(options: IFCExportOptions): string {
  const header = buildHeader(options);
  const data = buildData(options);
  return [header, 'DATA;', data, 'ENDSEC;', 'END-ISO-10303-21;'].join('\n');
}

/**
 * Trigger a browser-side download of the generated IFC4 file.
 * Safe to call from client components; no-op on the server.
 */
export function exportIFC(options: IFCExportOptions, filename?: string): void {
  if (typeof window === 'undefined') return;

  const content = generateIFC4(options);
  const blob = new Blob([content], { type: 'application/x-step' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `${options.projectName.replace(/\s+/g, '_')}_export.ifc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
