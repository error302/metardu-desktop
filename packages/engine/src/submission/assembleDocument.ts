import { uploadFile, getSignedUrl } from '@/lib/storage';
import { db } from '@/lib/db';
import { loadPreAdjustedFromDB, type PreAdjustedCoordinate, type PreAdjustedClosure } from '../generators/deedPlanGeometry';

// ── Helper: Fetch surveyor profile data from the project owner ────────────
async function fetchSurveyorProfile(projectId: string): Promise<{
  surveyorName: string;
  iskNumber: string;
  firmName: string;
  referenceNumber: string;
}> {
  try {
    const projRes = await db.query(
      'SELECT user_id, surveyor_name, surveyor_license FROM projects WHERE id = $1',
      [projectId]
    );
    const proj = projRes.rows[0];

    // First try project-level surveyor fields
    if (proj?.surveyor_name) {
      return {
        surveyorName: proj.surveyor_name || '',
        iskNumber: proj.surveyor_license || '',
        firmName: '',
        referenceNumber: '',
      };
    }

    // Fall back to surveyor profile (correct table: surveyor_profiles, not profiles)
    if (proj?.user_id) {
      const userRes = await db.query(
        'SELECT full_name, isk_number, firm_name FROM surveyor_profiles WHERE user_id = $1',
        [proj.user_id]
      );
      const user = userRes.rows[0];
      if (user) {
        return {
          surveyorName: user.full_name || '',
          iskNumber: user.isk_number || '',
          firmName: user.firm_name || '',
          referenceNumber: '',
        };
      }
    }
  } catch (err) {
    console.warn('[assembleDocument] Failed to fetch surveyor profile:', err);
  }
  return { surveyorName: '', iskNumber: '', firmName: '', referenceNumber: '' };
}

// ── Helper: Parse a DMS bearing string like "045°30'15\"" to decimal degrees ──
function parseDMSBearing(dms: string): number {
  if (!dms || typeof dms !== 'string') return 0;
  const match = dms.match(/(\d+)[°\s]*(\d+)?['\s]*(\d+\.?\d*)?["\s]*/);
  if (match) {
    const d = parseFloat(match[1]) || 0;
    const m = parseFloat(match[2]) || 0;
    const s = parseFloat(match[3]) || 0;
    return d + m / 60 + s / 3600;
  }
  const num = parseFloat(dms);
  return isNaN(num) ? 0 : num;
}

// ── Helper: Compute departure/latitude/correction from traverse data ──────
function computeTraverseAdjustment(
  stations: Array<{ station: string; easting: number; northing: number }>,
  bearingSchedule: Array<{ from: string; to: string; bearing: string; distance: string }>,
  misclosureMm: number,
  perimeterM: number,
): Array<{
  label: string;
  observedBearing: number;
  observedDistance: number;
  easting: number;
  northing: number;
  adjustedEasting: number;
  adjustedNorthing: number;
  departureRaw: number;
  latitudeRaw: number;
  departureCorrection: number;
  latitudeCorrection: number;
}> {
  // Compute misclosure in E and N from the adjusted vs. raw coordinates
  const n = stations.length;
  if (n < 2) return [];

  // Total misclosure (assumes Bowditch adjustment distributes proportionally)
  const closureE = (misclosureMm / 1000); // This is the linear misclosure magnitude
  // For Bowditch, correction is proportional to leg distance / perimeter
  const ratio = perimeterM > 0 ? closureE / perimeterM : 0;

  let cumDist = 0;
  return stations.map((st, i) => {
    const leg = bearingSchedule[i];
    if (!leg) {
      return {
        label: st.station,
        observedBearing: 0,
        observedDistance: 0,
        easting: st.easting,
        northing: st.northing,
        adjustedEasting: st.easting,
        adjustedNorthing: st.northing,
        departureRaw: 0,
        latitudeRaw: 0,
        departureCorrection: 0,
        latitudeCorrection: 0,
      };
    }

    const dist = parseFloat(leg.distance) || 0;
    const bearing = parseDMSBearing(leg.bearing);
    const bearingRad = (bearing * Math.PI) / 180;
    const departureRaw = dist * Math.sin(bearingRad);
    const latitudeRaw = dist * Math.cos(bearingRad);

    // Bowditch correction proportional to cumulative distance
    cumDist += dist;
    const correctionFraction = perimeterM > 0 ? cumDist / perimeterM : 0;
    const departureCorrection = -(closureE * correctionFraction * (departureRaw / (Math.abs(departureRaw) + Math.abs(latitudeRaw) + 1e-10)));
    const latitudeCorrection = -(closureE * correctionFraction * (latitudeRaw / (Math.abs(departureRaw) + Math.abs(latitudeRaw) + 1e-10)));

    return {
      label: st.station,
      observedBearing: bearing,
      observedDistance: dist,
      easting: st.easting,
      northing: st.northing,
      adjustedEasting: st.easting,
      adjustedNorthing: st.northing,
      departureRaw,
      latitudeRaw,
      departureCorrection,
      latitudeCorrection,
    };
  });
}

/**
 * Load pre-adjusted traverse coordinates from the database.
 * Delegates to the shared loadPreAdjustedFromDB() from deedPlanGeometry.ts
 * which now includes field book beacon enrichment.
 */

interface GenerateDocumentInput {
  projectId: string;
  documentId: string;
  surveyType: string;
  /** userId from session — for tamper-evident audit chain attribution */
  userId?: string;
}

interface GenerateDocumentResult {
  fileUrl: string;
}

export async function generateDocument(
  input: GenerateDocumentInput
): Promise<GenerateDocumentResult> {
  const { projectId, documentId, surveyType, userId } = input;

  let buffer: Buffer;
  let fileName: string;
  let mimeType: string;

  switch (documentId) {
    case 'traverse-report': {
      const { generateTraverseReport } = await import('../generators/traverseReport');
      buffer = await generateTraverseReport(projectId);
      fileName = `traverse-report-${projectId}.pdf`;
      mimeType = 'application/pdf';
      break;
    }
    case 'levelling-report': {
      const { generateLevellingReport } = await import('../generators/levellingReport');
      buffer = await generateLevellingReport(projectId);
      fileName = `levelling-report-${projectId}.pdf`;
      mimeType = 'application/pdf';
      break;
    }
    case 'field-book': {
      const { generateFieldBookExcel } = await import('../generators/fieldBookExcel');
      buffer = await generateFieldBookExcel(projectId);
      fileName = `field-book-${projectId}.xlsx`;
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      break;
    }
    case 'control-schedule': {
      const { generateCoordinateSchedule } = await import('../generators/coordinateSchedule');
      buffer = await generateCoordinateSchedule(projectId);
      fileName = `coordinate-schedule-${projectId}.xlsx`;
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      break;
    }
    case 'full-package': {
      const { generateFullPackage } = await import('../generators/fullPackage');
      buffer = await generateFullPackage(projectId);
      fileName = `submission-package-${projectId}.zip`;
      mimeType = 'application/zip';
      break;
    }
    case 'deed-plan': {
      if (surveyType !== 'cadastral') {
        throw new Error('Deed Plan is only available for cadastral surveys.');
      }

      // Statutory Validation Gate — refuse to produce a deed plan that
      // ArdhiSasa will reject. See src/lib/validation/statutoryGate.ts.
      const { loadGateInputForProject, mergeGateInput } = await import('../validation/statutoryGateLoader');
      const { runStatutoryGate, formatGateResult } = await import('../validation/statutoryGate');
      const profile = await fetchSurveyorProfile(projectId);
      const loadedInput = await loadGateInputForProject(projectId);
      if (loadedInput) {
        const gateInput = mergeGateInput(loadedInput, {
          surveyor: {
            name: profile.surveyorName || loadedInput.surveyor.name,
            licenseNumber: profile.iskNumber || loadedInput.surveyor.licenseNumber,
          },
          submissionType: 'mutation',
        });
        const gateResult = runStatutoryGate(gateInput);
        if (!gateResult.passed) {
          const blockCount = gateResult.summary.block;
          const detail = formatGateResult(gateResult);
          throw new Error(
            `Statutory validation failed — ${blockCount} blocking violation(s) prevent deed plan generation.\n\n${detail}`
          );
        }
      }

      const { generateDeedPlan } = await import('../generators/deedPlan');
      buffer = await generateDeedPlan(projectId);
      fileName = `deed-plan-${projectId}.pdf`;
      mimeType = 'application/pdf';

      // Audit chain — record that a deed plan was generated.
      // This is the tamper-evident log entry that proves the plan
      // left the system in a known state. See src/lib/audit/auditLog.ts.
      try {
        const { appendAuditEntry } = await import('../audit/auditLog');
        await appendAuditEntry({
          projectId,
          userId: userId ?? null,
          userName: profile.surveyorName || undefined,
          entityType: 'document',
          entityId: `deed-plan/${projectId}`,
          action: 'generate',
          payload: {
            new: { fileName, mimeType, sizeBytes: buffer.length },
            reason: 'Deed plan generated after statutory gate passed',
            metadata: { gateRuleVersion: '1.1.0' },
          },
        });
      } catch (auditErr) {
        // Audit failure should NOT block the document generation —
        // the surveyor needs their plan. Log and continue.
        console.warn('[assembleDocument] Audit chain append failed:', auditErr);
      }
      break;
    }
    case 'working-diagram': {
      const { generateWorkingDiagramPdf } = await import('../generators/workingDiagram');
      buffer = await generateWorkingDiagramPdf(projectId);
      fileName = `working-diagram-${projectId}.pdf`;
      mimeType = 'application/pdf';
      break;
    }
    case 'boundary-shapefile': {
      const { generateBoundaryShapefile } = await import('../generators/boundaryShapefile');
      buffer = await generateBoundaryShapefile(projectId);
      fileName = `boundary-shapefile-${projectId}.zip`;
      mimeType = 'application/zip';
      break;
    }
    case 'setting-out-dxf': {
      const { generateSettingOutDxf } = await import('../generators/settingOutDxf');
      buffer = await generateSettingOutDxf(projectId);
      fileName = `setting-out-${projectId}.dxf`;
      mimeType = 'application/dxf';
      break;
    }
    case 'longitudinal-section': {
      const { generateLongitudinalSection } = await import('../generators/longitudinalSection');
      buffer = await generateLongitudinalSection(projectId);
      fileName = `longitudinal-section-${projectId}.pdf`;
      mimeType = 'application/pdf';
      break;
    }
    case 'volumetric-report': {
      const { generateVolumetricReport } = await import('../generators/volumetricReport');
      buffer = await generateVolumetricReport(projectId);
      fileName = `volumetric-report-${projectId}.pdf`;
      mimeType = 'application/pdf';
      break;
    }
    case 'gcp-report': {
      const { generateGcpReport } = await import('../generators/gcpReport');
      buffer = await generateGcpReport(projectId);
      fileName = `gcp-report-${projectId}.pdf`;
      mimeType = 'application/pdf';
      break;
    }
    case 'orthophoto-plan': {
      const { generateOrthophotoPlan } = await import('../generators/orthophotoPlan');
      buffer = await generateOrthophotoPlan(projectId);
      fileName = `orthophoto-plan-${projectId}.pdf`;
      mimeType = 'application/pdf';
      break;
    }
    case 'deformation-report': {
      const { generateDeformationReport } = await import('../generators/deformationReport');
      buffer = await generateDeformationReport(projectId);
      fileName = `deformation-report-${projectId}.pdf`;
      mimeType = 'application/pdf';
      break;
    }
    case 'form-c22': {
      const { generateFormC22Pdf } = await import('../generators/formC22');
      const { computeDeedPlanGeometry } = await import('../generators/deedPlanGeometry');
      const [projectRes, surveyorProfile, preAdjusted] = await Promise.all([
        db.query(
          'SELECT name, lr_number, parcel_number, county, division, district, locality, survey_type, survey_subtype FROM projects WHERE id = $1',
          [projectId]
        ),
        fetchSurveyorProfile(projectId),
        loadPreAdjustedFromDB(projectId),
      ]);
      const proj = projectRes.rows[0];
      const geom = await computeDeedPlanGeometry(projectId, {
        preAdjustedCoordinates: preAdjusted?.stations,
        preAdjustedClosure: preAdjusted?.closure,
      });
      const perimeterM = geom.bearingSchedule.reduce((s: number, l: any) => s + parseFloat(l.distance), 0);
      const adjustedStations = computeTraverseAdjustment(
        geom.stations, geom.bearingSchedule, geom.misclosureMm, perimeterM
      );
      buffer = generateFormC22Pdf({
        projectName: proj?.name || '',
        lrNumber: proj?.lr_number || '',
        parcelNumber: proj?.parcel_number || '',
        county: proj?.county || '',
        division: proj?.division || '',
        district: proj?.district || '',
        locality: proj?.locality || '',
        surveyType: proj?.survey_type || 'cadastral',
        surveyorName: surveyorProfile.surveyorName,
        iskNumber: surveyorProfile.iskNumber,
        firmName: surveyorProfile.firmName,
        referenceNumber: surveyorProfile.referenceNumber,
        revision: 'R00',
        stations: adjustedStations,
        angularMisclosureSec: 0,
        angularToleranceSec: 60,
        linearMisclosureM: geom.misclosureMm / 1000,
        perimeterM,
        precisionRatio: parseInt(geom.precisionRatio.replace(/[^\d]/g, '')) || 5000,
        areaM2: geom.areaM2 || 0,
        areaHa: (geom.areaM2 || 0) / 10000,
      });
      fileName = `form-c22-${projectId}.pdf`;
      mimeType = 'application/pdf';
      break;
    }
    case 'area-computation': {
      const { generateAreaComputationSheet } = await import('../generators/areaComputationSheet');
      const { computeDeedPlanGeometry } = await import('../generators/deedPlanGeometry');
      const [projectRes, surveyorProfile, preAdjusted] = await Promise.all([
        db.query(
          'SELECT name, lr_number FROM projects WHERE id = $1',
          [projectId]
        ),
        fetchSurveyorProfile(projectId),
        loadPreAdjustedFromDB(projectId),
      ]);
      const proj = projectRes.rows[0];
      const geom = await computeDeedPlanGeometry(projectId, {
        preAdjustedCoordinates: preAdjusted?.stations,
        preAdjustedClosure: preAdjusted?.closure,
      });
      buffer = generateAreaComputationSheet({
        projectName: proj?.name || '',
        lrNumber: proj?.lr_number || '',
        surveyorName: surveyorProfile.surveyorName,
        iskNumber: surveyorProfile.iskNumber,
        firmName: surveyorProfile.firmName,
        referenceNumber: surveyorProfile.referenceNumber,
        stations: geom.stations.map((st: any) => ({
          label: st.station,
          easting: st.easting,
          northing: st.northing,
        })),
        precisionRatio: geom.precisionRatio,
        perimeterM: geom.bearingSchedule.reduce((s: number, l: any) => s + parseFloat(l.distance), 0),
        adjustmentMethod: 'Bowditch (Compass Rule)',
      });
      fileName = `area-computation-${projectId}.pdf`;
      mimeType = 'application/pdf';
      break;
    }
    case 'traverse-computation-sheet': {
      const { generateTraverseComputationSheet } = await import('../generators/traverseComputationSheet');
      const { computeDeedPlanGeometry } = await import('../generators/deedPlanGeometry');
      const [projectRes, surveyorProfile, preAdjusted] = await Promise.all([
        db.query(
          'SELECT name, lr_number, parcel_number, county, division, district, locality, survey_type FROM projects WHERE id = $1',
          [projectId]
        ),
        fetchSurveyorProfile(projectId),
        loadPreAdjustedFromDB(projectId),
      ]);
      const proj = projectRes.rows[0];
      const geom = await computeDeedPlanGeometry(projectId, {
        preAdjustedCoordinates: preAdjusted?.stations,
        preAdjustedClosure: preAdjusted?.closure,
      });
      const perimeterM = geom.bearingSchedule.reduce((s: number, l: any) => s + parseFloat(l.distance), 0);
      const adjustedStations = computeTraverseAdjustment(
        geom.stations, geom.bearingSchedule, geom.misclosureMm, perimeterM
      );
      const precisionRatioNum = parseInt(geom.precisionRatio.replace(/[^\d]/g, '')) || 5000;

      // Compute observations and legs from adjusted stations
      const observations = adjustedStations.map((st, i) => {
        const next = adjustedStations[(i + 1) % adjustedStations.length];
        const dE = next.adjustedEasting - st.adjustedEasting;
        const dN = next.adjustedNorthing - st.adjustedNorthing;
        const wcb = ((Math.atan2(dE, dN) * 180) / Math.PI + 360) % 360;
        const hd = Math.sqrt(dE * dE + dN * dN);
        return {
          station: st.label,
          hclDeg: wcb,
          hcrDeg: (wcb + 180) % 360,
          meanAngleDeg: wcb,
          slopeDistance: hd,
          verticalAngle: 0,
          horizontalDistance: hd,
          deltaH: 0,
        };
      });

      const legs = adjustedStations.map((st, i) => {
        const next = adjustedStations[(i + 1) % adjustedStations.length];
        return {
          from: st.label,
          to: next.label,
          includedAngleDeg: 180,
          wcbDeg: st.observedBearing,
          hd: st.observedDistance,
          departure: st.departureRaw,
          latitude: st.latitudeRaw,
          depCorrection: st.departureCorrection,
          latCorrection: st.latitudeCorrection,
          adjDep: st.departureRaw + st.departureCorrection,
          adjLat: st.latitudeRaw + st.latitudeCorrection,
        };
      });

      buffer = generateTraverseComputationSheet({
        projectName: proj?.name || '',
        lrNumber: proj?.lr_number || '',
        parcelNumber: proj?.parcel_number || '',
        county: proj?.county || '',
        division: proj?.division || '',
        district: proj?.district || '',
        locality: proj?.locality || '',
        surveyType: proj?.survey_type || 'cadastral',
        surveyorName: surveyorProfile.surveyorName,
        iskNumber: surveyorProfile.iskNumber,
        firmName: surveyorProfile.firmName,
        referenceNumber: surveyorProfile.referenceNumber,
        revision: 'R00',
        observations,
        legs,
        coordinates: geom.stations.map((st: any) => ({
          station: st.station,
          easting: st.easting,
          northing: st.northing,
        })),
        isClosed: true,
        totalPerimeter: perimeterM,
        sumDepartures: adjustedStations.reduce((s, st) => s + st.departureRaw, 0),
        sumLatitudes: adjustedStations.reduce((s, st) => s + st.latitudeRaw, 0),
        linearErrorM: geom.misclosureMm / 1000,
        precisionRatio: precisionRatioNum,
        accuracyOrder: precisionRatioNum >= 20000 ? '1st Order' : precisionRatioNum >= 10000 ? '2nd Order' : precisionRatioNum >= 5000 ? '3rd Order' : precisionRatioNum >= 2000 ? '4th Order' : 'Below Standard',
        allowableMisclosureM: 0.025 * Math.sqrt(perimeterM / 1000),
      });
      fileName = `traverse-computation-sheet-${projectId}.pdf`;
      mimeType = 'application/pdf';
      break;
    }
    case 'mutation-form': {
      const { generateMutationForm } = await import('./generators/mutationForm');
      const [projectRes, surveyorProfile] = await Promise.all([
        db.query(
          'SELECT name, lr_number, county, division, district, locality, boundary_data FROM projects WHERE id = $1',
          [projectId]
        ),
        fetchSurveyorProfile(projectId),
      ]);
      const proj = projectRes.rows[0];
      const bd = proj?.boundary_data || {};

      // Get resulting parcels from scheme data if available
      const { rows: parcels } = await db.query(
        'SELECT parcel_number, lr_number_proposed, area_ha FROM parcels p JOIN blocks b ON b.id = p.block_id WHERE b.project_id = $1 ORDER BY parcel_number',
        [projectId]
      );

      buffer = Buffer.from(generateMutationForm({
        parentLRNumber: proj?.lr_number || '',
        parentParcelNumber: bd.parcelNumber || '',
        parentAreaHa: bd.areaHa || 0,
        resultingParcels: parcels.map((p: any) => ({
          parcelNumber: p.parcel_number,
          areaHa: p.area_ha || 0,
        })),
        county: proj?.county || '',
        division: proj?.division || '',
        district: proj?.district || '',
        locality: proj?.locality || '',
        registryMapSheet: bd.registryMapSheet || '',
        mutationType: 'subdivision',
        reasonForMutation: 'Subdivision of parent parcel',
        affectedBeacons: (bd.adjustedStations || []).map((s: any) => ({
          beaconId: s.pointName || s.station || '',
          action: 'adopted' as const,
          easting: s.adjustedEasting || s.easting || 0,
          northing: s.adjustedNorthing || s.northing || 0,
        })),
        surveyorName: surveyorProfile.surveyorName,
        iskNumber: surveyorProfile.iskNumber,
        firmName: surveyorProfile.firmName,
        surveyDate: new Date().toISOString().slice(0, 10),
        referenceNumber: surveyorProfile.referenceNumber,
      }));
      fileName = `mutation-form-${projectId}.pdf`;
      mimeType = 'application/pdf';
      break;
    }
    default:
      throw new Error(`Generator not yet implemented for: ${documentId}. This document type is coming in a future phase.`);
  }

  const storagePath = `submissions/${projectId}/${fileName}`;
  const publicUrl = await uploadFile(buffer, fileName, mimeType, storagePath);

  const signedUrl = await getSignedUrl(storagePath, 60 * 60 * 24 * 7);

  return { fileUrl: signedUrl };
}
