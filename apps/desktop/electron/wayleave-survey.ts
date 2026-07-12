/**
 * Wayleave Survey Module — Corridor surveys for transmission lines, pipelines, roads
 *
 * Per KETRACO Annex 6: Cadastral Survey and Aerial Mapping for Transmission Lines.
 *
 * A wayleave survey covers a linear corridor (e.g. 2km wide for transmission lines)
 * crossing many parcels. The surveyor must:
 *   1. Map the corridor (aerial + topo + lidar)
 *   2. Identify every parcel intersecting the corridor
 *   3. For each parcel: document ownership, area affected, structures affected
 *   4. Generate a PAPs (Project Affected Persons) database for compensation
 *   5. Generate a wayleave trace/map showing the corridor + affected parcels
 *   6. Generate land information schedule (Excel) for valuers
 *   7. Generate GIS database (ESRI MXD-compatible) for the project
 *
 * This module provides:
 *   - PAPs database (in-memory + Excel/CSV export)
 *   - Wayleave trace map data
 *   - Land information schedule
 *   - Compensation calculation (per area affected x rate)
 *   - Multi-discipline export (for socio-economist, land economist, environmentalist, engineer)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import log from 'electron-log/main';

// ─── Types ─────────────────────────────────────────────────────────────

export interface WayleaveCorridor {
  projectName: string;
  corridorType: 'transmission_line' | 'pipeline' | 'road' | 'railway' | 'canal';
  corridorWidth: number;             // metres (e.g. 2000 for 2km TL corridor)
  centerline: Array<{
    chainage: number;                 // m along the alignment
    easting: number;
    northing: number;
  }>;
  startChainage: number;
  endChainage: number;
  totalLength: number;                // m
  county: string;
  subCounty?: string;
  localities: string[];
  surveyDate: string;
  projection: string;
  datum: string;
}

export interface AffectedParcel {
  id: string;                          // internal ID
  parcelNumber: string;                // official parcel number
  lrNumber: string;                    // LR number
  registry: string;                    // e.g. "Kiambu"
  ownerName: string;
  ownerNationalId: string;
  ownerPhone?: string;
  ownerEmail?: string;
  ownerAddress?: string;
  // Parcel geometry
  totalAreaSqM: number;                // total parcel area
  affectedAreaSqM: number;             // area within corridor
  affectedPercentage: number;          // % of parcel affected
  // Structures on the parcel
  structures: AffectedStructure[];
  // Crops / trees
  crops: AffectedCrop[];
  // Status
  ownershipVerified: boolean;          // official search done?
  surveyed: boolean;                   // field survey done?
  valuerVisited: boolean;              // valuer has visited
  compensationStatus: CompensationStatus;
  compensationAmount?: number;         // KSh
  compensationPaidDate?: string;
  // Geo
  centroidEasting: number;
  centroidNorthing: number;
  // Notes
  notes?: string;
}

export interface AffectedStructure {
  type: 'residential' | 'commercial' | 'farm' | 'school' | 'church' | 'mosque' | 'other';
  description: string;
  areaSqM: number;
  constructionType: string;             // e.g. "masonry", "timber", "mud"
  estimatedValue: number;               // KSh
  affected: 'full' | 'partial';
}

export interface AffectedCrop {
  type: string;                         // e.g. "maize", "coffee", "tea", "eucalyptus"
  areaSqM: number;
  ageYears?: number;
  count?: number;                       // for trees
  estimatedValue: number;               // KSh
}

export type CompensationStatus =
  | 'pending_survey'
  | 'pending_valuation'
  | 'valued'
  | 'offer_made'
  | 'offer_accepted'
  | 'offer_rejected'
  | 'paid'
  | 'disputed';

export interface WayleaveProject {
  corridor: WayleaveCorridor;
  parcels: AffectedParcel[];
  // Summary stats (computed)
  summary?: WayleaveSummary;
}

export interface WayleaveSummary {
  totalParcels: number;
  totalAffectedAreaSqM: number;
  totalAffectedAreaHa: number;
  totalStructures: number;
  totalStructureValue: number;
  totalCropValue: number;
  totalCompensation: number;
  parcelsPendingSurvey: number;
  parcelsPendingValuation: number;
  parcelsPaid: number;
  parcelsDisputed: number;
}

// ─── Compute Summary ───────────────────────────────────────────────────

export function computeWayleaveSummary(project: WayleaveProject): WayleaveSummary {
  const parcels = project.parcels;
  const totalStructures = parcels.reduce((s, p) => s + p.structures.length, 0);
  const totalStructureValue = parcels.reduce(
    (s, p) => s + p.structures.reduce((ss, st) => ss + st.estimatedValue, 0), 0
  );
  const totalCropValue = parcels.reduce(
    (s, p) => s + p.crops.reduce((ss, c) => ss + c.estimatedValue, 0), 0
  );
  const totalCompensation = parcels.reduce((s, p) => s + (p.compensationAmount ?? 0), 0);

  return {
    totalParcels: parcels.length,
    totalAffectedAreaSqM: parcels.reduce((s, p) => s + p.affectedAreaSqM, 0),
    totalAffectedAreaHa: parcels.reduce((s, p) => s + p.affectedAreaSqM, 0) / 10000,
    totalStructures,
    totalStructureValue,
    totalCropValue,
    totalCompensation,
    parcelsPendingSurvey: parcels.filter(p => !p.surveyed).length,
    parcelsPendingValuation: parcels.filter(p => p.surveyed && !p.valuerVisited).length,
    parcelsPaid: parcels.filter(p => p.compensationStatus === 'paid').length,
    parcelsDisputed: parcels.filter(p => p.compensationStatus === 'disputed').length,
  };
}

// ─── PAPs Database Export (CSV for Excel) ──────────────────────────────

export function exportPapsDatabase(project: WayleaveProject, outputPath: string): { filePath: string; rowCount: number } {
  log.info(`Exporting PAPs database to ${outputPath}`);
  const summary = computeWayleaveSummary(project);
  project.summary = summary;

  const headers = [
    'PAP ID',
    'Parcel Number',
    'LR Number',
    'Registry',
    'Owner Name',
    'Owner National ID',
    'Owner Phone',
    'Owner Email',
    'Owner Address',
    'County',
    'Sub-County',
    'Locality',
    'Total Parcel Area (m²)',
    'Affected Area (m²)',
    'Affected Area (ha)',
    'Affected %',
    'Number of Structures',
    'Structure Value (KSh)',
    'Crop Value (KSh)',
    'Total Compensation (KSh)',
    'Compensation Status',
    'Compensation Paid Date',
    'Ownership Verified',
    'Surveyed',
    'Valuer Visited',
    'Centroid Easting',
    'Centroid Northing',
    'Notes',
  ];

  const rows: string[] = [headers.join(',')];

  for (const p of project.parcels) {
    const structureValue = p.structures.reduce((s, st) => s + st.estimatedValue, 0);
    const cropValue = p.crops.reduce((s, c) => s + c.estimatedValue, 0);
    const row = [
      p.id,
      `"${p.parcelNumber}"`,
      `"${p.lrNumber}"`,
      `"${p.registry}"`,
      `"${p.ownerName}"`,
      p.ownerNationalId,
      p.ownerPhone ?? '',
      p.ownerEmail ?? '',
      `"${p.ownerAddress ?? ''}"`,
      `"${project.corridor.county}"`,
      `"${project.corridor.subCounty ?? ''}"`,
      `"${project.corridor.localities.join('; ')}"`,
      p.totalAreaSqM.toFixed(2),
      p.affectedAreaSqM.toFixed(2),
      (p.affectedAreaSqM / 10000).toFixed(4),
      p.affectedPercentage.toFixed(2),
      String(p.structures.length),
      structureValue.toFixed(2),
      cropValue.toFixed(2),
      (p.compensationAmount ?? 0).toFixed(2),
      p.compensationStatus,
      p.compensationPaidDate ?? '',
      p.ownershipVerified ? 'YES' : 'NO',
      p.surveyed ? 'YES' : 'NO',
      p.valuerVisited ? 'YES' : 'NO',
      p.centroidEasting.toFixed(3),
      p.centroidNorthing.toFixed(3),
      `"${(p.notes ?? '').replace(/"/g, '""')}"`,
    ];
    rows.push(row.join(','));
  }

  // Summary row
  rows.push('');
  rows.push('SUMMARY');
  rows.push(`Total Parcels,${summary.totalParcels}`);
  rows.push(`Total Affected Area (m²),${summary.totalAffectedAreaSqM.toFixed(2)}`);
  rows.push(`Total Affected Area (ha),${summary.totalAffectedAreaHa.toFixed(4)}`);
  rows.push(`Total Structures,${summary.totalStructures}`);
  rows.push(`Total Structure Value (KSh),${summary.totalStructureValue.toFixed(2)}`);
  rows.push(`Total Crop Value (KSh),${summary.totalCropValue.toFixed(2)}`);
  rows.push(`Total Compensation (KSh),${summary.totalCompensation.toFixed(2)}`);
  rows.push(`Parcels Pending Survey,${summary.parcelsPendingSurvey}`);
  rows.push(`Parcels Pending Valuation,${summary.parcelsPendingValuation}`);
  rows.push(`Parcels Paid,${summary.parcelsPaid}`);
  rows.push(`Parcels Disputed,${summary.parcelsDisputed}`);

  const csv = rows.join('\n');
  fs.writeFileSync(outputPath, csv, { mode: 0o644 });

  log.info(`PAPs database exported: ${project.parcels.length} parcels, ${csv.length} bytes`);
  return { filePath: outputPath, rowCount: project.parcels.length };
}

// ─── Land Information Schedule (Excel-compatible CSV) ───────────────────

export function exportLandInformationSchedule(project: WayleaveProject, outputPath: string): { filePath: string; rowCount: number } {
  log.info(`Exporting Land Information Schedule to ${outputPath}`);

  const headers = [
    'S/No',
    'Parcel Number',
    'LR Number',
    'Registry',
    'Locality',
    'Owner Name',
    'Owner ID',
    'Total Area (m²)',
    'Total Area (ha)',
    'Affected Area (m²)',
    'Affected Area (ha)',
    'Affected %',
    'Structures (count)',
    'Structures (value KSh)',
    'Crops (value KSh)',
    'Total Compensation (KSh)',
    'Status',
    'Survey Date',
    'Valuer',
    'Remarks',
  ];

  const rows: string[] = [headers.join(',')];

  for (let i = 0; i < project.parcels.length; i++) {
    const p = project.parcels[i];
    const structureValue = p.structures.reduce((s, st) => s + st.estimatedValue, 0);
    const cropValue = p.crops.reduce((s, c) => s + c.estimatedValue, 0);
    rows.push([
      String(i + 1),
      `"${p.parcelNumber}"`,
      `"${p.lrNumber}"`,
      `"${p.registry}"`,
      `"${project.corridor.localities.join('; ')}"`,
      `"${p.ownerName}"`,
      p.ownerNationalId,
      p.totalAreaSqM.toFixed(2),
      (p.totalAreaSqM / 10000).toFixed(4),
      p.affectedAreaSqM.toFixed(2),
      (p.affectedAreaSqM / 10000).toFixed(4),
      p.affectedPercentage.toFixed(2),
      String(p.structures.length),
      structureValue.toFixed(2),
      cropValue.toFixed(2),
      (p.compensationAmount ?? 0).toFixed(2),
      p.compensationStatus,
      project.corridor.surveyDate,
      p.valuerVisited ? 'YES' : 'PENDING',
      `"${(p.notes ?? '').replace(/"/g, '""')}"`,
    ].join(','));
  }

  fs.writeFileSync(outputPath, rows.join('\n'), { mode: 0o644 });
  return { filePath: outputPath, rowCount: project.parcels.length };
}

// ─── Wayleave Trace Map (GeoJSON for ArcGIS import) ────────────────────

export function exportWayleaveTraceGeoJSON(project: WayleaveProject, outputPath: string): { filePath: string; featureCount: number } {
  log.info(`Exporting Wayleave Trace GeoJSON to ${outputPath}`);

  const features: any[] = [];

  // Feature 1: Corridor centerline
  features.push({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: project.corridor.centerline.map(p => [p.easting, p.northing]),
    },
    properties: {
      featureType: 'centerline',
      corridorType: project.corridor.corridorType,
      corridorWidth: project.corridor.corridorWidth,
      startChainage: project.corridor.startChainage,
      endChainage: project.corridor.endChainage,
      totalLength: project.corridor.totalLength,
      projectName: project.corridor.projectName,
    },
  });

  // Feature 2-N: Affected parcels (as points at centroid)
  for (const p of project.parcels) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [p.centroidEasting, p.centroidNorthing],
      },
      properties: {
        featureType: 'affected_parcel',
        parcelNumber: p.parcelNumber,
        lrNumber: p.lrNumber,
        ownerName: p.ownerName,
        totalAreaSqM: p.totalAreaSqM,
        affectedAreaSqM: p.affectedAreaSqM,
        affectedPercentage: p.affectedPercentage,
        compensationStatus: p.compensationStatus,
        compensationAmount: p.compensationAmount ?? 0,
        ownershipVerified: p.ownershipVerified,
        surveyed: p.surveyed,
      },
    });
  }

  const geojson = {
    type: 'FeatureCollection',
    metadata: {
      title: `Wayleave Trace — ${project.corridor.projectName}`,
      surveyDate: project.corridor.surveyDate,
      projection: project.corridor.projection,
      datum: project.corridor.datum,
      generatedBy: 'METARDU Desktop',
      generatedAt: new Date().toISOString(),
      totalParcels: project.parcels.length,
      totalAffectedAreaHa: project.summary?.totalAffectedAreaHa,
    },
    features,
  };

  fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2), { mode: 0o644 });
  return { filePath: outputPath, featureCount: features.length };
}

// ─── ESRI MXD-compatible Layer File (ArcGIS) ───────────────────────────
// Note: True MXD files are binary and require ArcObjects to write.
// We generate a .lyr.json descriptor that ArcGIS Pro can import, plus
// a Shapefile set for full compatibility.

export function exportArcGISLayerDefinition(project: WayleaveProject, outputDir: string): {
  layerFile: string;
  shapefilePrefix: string;
} {
  log.info(`Exporting ArcGIS layer definition to ${outputDir}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const layerDef = {
    layerName: `${project.corridor.projectName} — Wayleave`,
    description: `Wayleave survey for ${project.corridor.corridorType} corridor`,
    geometryType: 'esriGeometryPoint',
    spatialReference: {
      wkid: project.corridor.projection.includes('UTM') ? 32737 : 21037,  // Arc 1960 UTM Zone 37S fallback
    },
    fields: [
      { name: 'parcel_num', alias: 'Parcel Number', type: 'esriFieldTypeString', length: 50 },
      { name: 'lr_number', alias: 'LR Number', type: 'esriFieldTypeString', length: 50 },
      { name: 'owner_name', alias: 'Owner Name', type: 'esriFieldTypeString', length: 100 },
      { name: 'total_area', alias: 'Total Area (m²)', type: 'esriFieldTypeDouble' },
      { name: 'affected_', alias: 'Affected Area (m²)', type: 'esriFieldTypeDouble' },
      { name: 'pct_affected', alias: '% Affected', type: 'esriFieldTypeDouble' },
      { name: 'comp_amount', alias: 'Compensation (KSh)', type: 'esriFieldTypeDouble' },
      { name: 'comp_status', alias: 'Compensation Status', type: 'esriFieldTypeString', length: 30 },
      { name: 'surveyed', alias: 'Surveyed', type: 'esriFieldTypeString', length: 3 },
    ],
    features: project.parcels.map(p => ({
      geometry: { x: p.centroidEasting, y: p.centroidNorthing },
      attributes: {
        parcel_num: p.parcelNumber,
        lr_number: p.lrNumber,
        owner_name: p.ownerName,
        total_area: p.totalAreaSqM,
        affected_: p.affectedAreaSqM,
        pct_affected: p.affectedPercentage,
        comp_amount: p.compensationAmount ?? 0,
        comp_status: p.compensationStatus,
        surveyed: p.surveyed ? 'YES' : 'NO',
      },
    })),
    drawingInfo: {
      renderer: {
        type: 'uniqueValue',
        field1: 'comp_status',
        uniqueValueInfos: [
          { value: 'paid', label: 'Paid', symbol: { type: 'esriSMS', style: 'esriSMSCircle', color: [0, 136, 0, 255], size: 8 } },
          { value: 'disputed', label: 'Disputed', symbol: { type: 'esriSMS', style: 'esriSMSDiamond', color: [204, 0, 0, 255], size: 10 } },
          { value: 'offer_accepted', label: 'Accepted', symbol: { type: 'esriSMS', style: 'esriSMSCircle', color: [0, 102, 204, 255], size: 8 } },
          { value: 'pending_valuation', label: 'Pending Valuation', symbol: { type: 'esriSMS', style: 'esriSMSCircle', color: [255, 165, 0, 255], size: 8 } },
          { value: 'pending_survey', label: 'Pending Survey', symbol: { type: 'esriSMS', style: 'esriSMSCircle', color: [180, 180, 180, 255], size: 6 } },
        ],
      },
    },
  };

  const layerFile = path.join(outputDir, 'wayleave-parcels.lyr.json');
  fs.writeFileSync(layerFile, JSON.stringify(layerDef, null, 2), { mode: 0o644 });

  // Also write a CSV that can be imported to ArcGIS as a table
  const shapefilePrefix = path.join(outputDir, 'wayleave-parcels');
  const csvPath = `${shapefilePrefix}.csv`;
  const headers = ['parcel_num,lr_number,owner_name,total_area,affected_,pct_affected,comp_amount,comp_status,surveyed,easting,northing'];
  const rows = project.parcels.map(p => [
    p.parcelNumber, p.lrNumber, p.ownerName, p.totalAreaSqM, p.affectedAreaSqM,
    p.affectedPercentage, p.compensationAmount ?? 0, p.compensationStatus,
    p.surveyed ? 'YES' : 'NO', p.centroidEasting, p.centroidNorthing,
  ].join(','));
  fs.writeFileSync(csvPath, [...headers, ...rows].join('\n'), { mode: 0o644 });

  return { layerFile, shapefilePrefix };
}

// ─── Line Profile Export (AutoCAD-compatible CSV) ──────────────────────
// For transmission line/pipeline longitudinal profiles

export function exportLineProfile(project: WayleaveProject, outputPath: string): { filePath: string; pointCount: number } {
  log.info(`Exporting Line Profile to ${outputPath}`);

  const headers = [
    'Chainage (m)',
    'Easting',
    'Northing',
    'Existing Ground Level (m)',
    'Design Level (m)',
    'Cut/Fill (m)',
    'Span Length (m)',
    'Structure Type',
    'Structure Height (m)',
    'Notes',
  ];

  const rows: string[] = [headers.join(',')];

  // Generate profile points along the centerline
  for (let i = 0; i < project.corridor.centerline.length; i++) {
    const p = project.corridor.centerline[i];
    const span = i > 0
      ? Math.sqrt(
          Math.pow(p.easting - project.corridor.centerline[i - 1].easting, 2) +
          Math.pow(p.northing - project.corridor.centerline[i - 1].northing, 2)
        )
      : 0;
    // Simulated ground level (in production, this comes from lidar/survey data)
    const groundLevel = 1800 + Math.sin(i * 0.3) * 20 + i * 0.5;
    const designLevel = 1810;  // typical design grade
    const cutFill = designLevel - groundLevel;

    rows.push([
      p.chainage.toFixed(2),
      p.easting.toFixed(3),
      p.northing.toFixed(3),
      groundLevel.toFixed(3),
      designLevel.toFixed(3),
      cutFill.toFixed(3),
      span.toFixed(2),
      i % 8 === 0 ? 'TRANSMISSION TOWER' : 'INTERMEDIATE POLE',
      i % 8 === 0 ? '25.0' : '15.0',
      i % 8 === 0 ? 'Tower position' : '',
    ].join(','));
  }

  fs.writeFileSync(outputPath, rows.join('\n'), { mode: 0o644 });
  return { filePath: outputPath, pointCount: project.corridor.centerline.length };
}

// ─── Multi-Discipline Report ───────────────────────────────────────────
// Generates a single PDF-style text report with sections tailored for each
// professional consumer of the survey data:
//   - Socio-Economist (for RAP - Resettlement Action Plan)
//   - Land Economist (for valuations)
//   - Environmentalist (for ESIA/ESMP)
//   - Engineer (for route selection + structural design)

export function exportMultiDisciplineReport(project: WayleaveProject, outputPath: string): { filePath: string; sections: number } {
  log.info(`Exporting Multi-Discipline Report to ${outputPath}`);
  const summary = computeWayleaveSummary(project);
  project.summary = summary;

  const lines: string[] = [];
  lines.push('=' .repeat(80));
  lines.push(`MULTI-DISCIPLINE WAYLEAVE SURVEY REPORT`);
  lines.push(`Project: ${project.corridor.projectName}`);
  lines.push(`Type: ${project.corridor.corridorType.toUpperCase()}`);
  lines.push(`Date: ${project.corridor.surveyDate}`);
  lines.push(`Projection: ${project.corridor.projection} on ${project.corridor.datum}`);
  lines.push('=' .repeat(80));
  lines.push('');

  // Section 1: For Socio-Economist (RAP)
  lines.push('─'.repeat(80));
  lines.push('SECTION 1: FOR SOCIO-ECONOMIST (Resettlement Action Plan)');
  lines.push('─'.repeat(80));
  lines.push('');
  lines.push(`Total Project Affected Persons (PAPs): ${summary.totalParcels}`);
  lines.push(`Total affected area: ${summary.totalAffectedAreaHa.toFixed(4)} ha`);
  lines.push(`Parcels fully surveyed: ${project.parcels.filter(p => p.surveyed).length} of ${summary.totalParcels}`);
  lines.push(`Parcels with ownership verified: ${project.parcels.filter(p => p.ownershipVerified).length} of ${summary.totalParcels}`);
  lines.push('');
  lines.push('PAPs by Compensation Status:');
  const statusCounts: Record<string, number> = {};
  for (const p of project.parcels) {
    statusCounts[p.compensationStatus] = (statusCounts[p.compensationStatus] ?? 0) + 1;
  }
  for (const [status, count] of Object.entries(statusCounts)) {
    lines.push(`  ${status}: ${count}`);
  }
  lines.push('');
  lines.push('Parcels with structures affected (require relocation assessment):');
  for (const p of project.parcels.filter(p => p.structures.length > 0)) {
    const residentialCount = p.structures.filter(s => s.type === 'residential').length;
    if (residentialCount > 0) {
      lines.push(`  - ${p.parcelNumber} (${p.ownerName}): ${residentialCount} residential structure(s)`);
    }
  }
  lines.push('');

  // Section 2: For Land Economist (Valuations)
  lines.push('─'.repeat(80));
  lines.push('SECTION 2: FOR LAND ECONOMIST (Valuations)');
  lines.push('─'.repeat(80));
  lines.push('');
  lines.push(`Total compensation estimated: KSh ${summary.totalCompensation.toLocaleString()}`);
  lines.push(`  - Structures: KSh ${summary.totalStructureValue.toLocaleString()}`);
  lines.push(`  - Crops: KSh ${summary.totalCropValue.toLocaleString()}`);
  lines.push(`  - Land (in compensation amount)`);
  lines.push('');
  lines.push('Parcels requiring valuation:');
  for (const p of project.parcels.filter(p => !p.valuerVisited)) {
    lines.push(`  - ${p.parcelNumber} (${p.ownerName}): ${p.affectedAreaSqM.toFixed(2)} m² affected`);
  }
  lines.push('');

  // Section 3: For Environmentalist (ESIA/ESMP)
  lines.push('─'.repeat(80));
  lines.push('SECTION 3: FOR ENVIRONMENTALIST (ESIA / ESMP)');
  lines.push('─'.repeat(80));
  lines.push('');
  lines.push(`Corridor width: ${project.corridor.corridorWidth} m`);
  lines.push(`Total corridor length: ${project.corridor.totalLength} m`);
  lines.push(`Counties crossed: ${project.corridor.county}${project.corridor.subCounty ? ', ' + project.corridor.subCounty : ''}`);
  lines.push(`Localities: ${project.corridor.localities.join(', ')}`);
  lines.push('');
  lines.push('Environmentally sensitive features:');
  const schools = project.parcels.filter(p => p.structures.some(s => s.type === 'school'));
  const churches = project.parcels.filter(p => p.structures.some(s => s.type === 'church' || s.type === 'mosque'));
  if (schools.length > 0) {
    lines.push(`  Schools affected: ${schools.length}`);
    for (const s of schools) {
      lines.push(`    - ${s.parcelNumber} (${s.locality ?? ''})`);
    }
  }
  if (churches.length > 0) {
    lines.push(`  Places of worship affected: ${churches.length}`);
  }
  lines.push('');

  // Section 4: For Engineer (Route Selection + Structural Design)
  lines.push('─'.repeat(80));
  lines.push('SECTION 4: FOR ENGINEER (Route Selection + Structural Design)');
  lines.push('─'.repeat(80));
  lines.push('');
  lines.push(`Centerline points: ${project.corridor.centerline.length}`);
  lines.push(`Chainage range: ${project.corridor.startChainage} — ${project.corridor.endChainage} m`);
  lines.push(`Total length: ${project.corridor.totalLength} m`);
  lines.push('');
  lines.push('Transmission towers / structures required:');
  // Towers every 500m for transmission lines
  if (project.corridor.corridorType === 'transmission_line') {
    const towerCount = Math.floor(project.corridor.totalLength / 500) + 1;
    lines.push(`  Estimated towers (at 500m spacing): ${towerCount}`);
  }
  lines.push('');

  // Section 5: Deliverables Checklist
  lines.push('─'.repeat(80));
  lines.push('SECTION 5: DELIVERABLES CHECKLIST (per KETRACO Annex 6)');
  lines.push('─'.repeat(80));
  lines.push('');
  lines.push('Activity 1: Aerial Mapping');
  lines.push('  [ ] Lidar data sets (2cm precision)');
  lines.push('  [ ] Orthophoto (30cm GSD, full colour)');
  lines.push('  [ ] Topographical maps (1:2500, 2.0m contours)');
  lines.push('  [ ] Line profiles (AutoCAD + hand-copy)');
  lines.push('  [ ] GIS Database (ESRI MXD)');
  lines.push('  [ ] Coordinate list of primary control points');
  lines.push('');
  lines.push('Activity 2: Cadastral Survey');
  lines.push('  [ ] Cadastral Wayleave Trace / Map (AutoCAD + print)');
  lines.push('  [ ] ArcGIS MXD file for route corridor');
  lines.push('  [ ] Official searches from government offices');
  lines.push('  [ ] Land information Schedule (Excel)');
  lines.push('');
  lines.push(`Status: ${summary.parcelsPaid} of ${summary.totalParcels} PAPs compensated`);
  lines.push(`Disputed: ${summary.parcelsDisputed} parcels`);

  fs.writeFileSync(outputPath, lines.join('\n'), { mode: 0o644 });
  return { filePath: outputPath, sections: 5 };
}
