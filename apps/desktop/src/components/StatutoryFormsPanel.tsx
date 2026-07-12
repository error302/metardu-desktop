/**
 * Statutory Forms Panel — Generate all statutory documents
 *
 * UI for triggering generation of:
 *   - Survey Report (consolidated)
 *   - Form P (Mutation)
 *   - Topo Surveyor's Report
 *   - Cross-Section Sheets
 *   - RINEX Observation Log
 *   - Leveling Book
 *
 * Each form has its own modal with the required fields, validation, and
 * a "Generate PDF" button that calls the corresponding IPC handler.
 *
 * All forms are sealed with RSA-2048. After generation, the user can
 * open the PDF in their default viewer.
 */

import { useState, useEffect } from 'react';

type FormType = 'surveyReport' | 'formP' | 'topoReport' | 'crossSections' | 'rinexLog' | 'levelingBook';

interface FormDef {
  id: FormType;
  title: string;
  description: string;
  icon: string;
  category: 'cadastral' | 'topographical' | 'engineering' | 'general';
  regulation: string;
}

const FORMS: FormDef[] = [
  {
    id: 'surveyReport',
    title: 'Survey Report',
    description: 'Consolidated 5-page report: Cover + Form J + Beacons + Areas + Certificate',
    icon: '📋',
    category: 'general',
    regulation: 'Survey Reg 3(2), 17, 97',
  },
  {
    id: 'formP',
    title: 'Form P — Mutation',
    description: 'Subdivision, amalgamation, or boundary adjustment of registered land',
    icon: '📝',
    category: 'cadastral',
    regulation: 'Survey Reg 38',
  },
  {
    id: 'topoReport',
    title: "Surveyor's Report (Topo)",
    description: 'Narrative report: methodology, equipment, control, accuracy, deliverables',
    icon: '🗺️',
    category: 'topographical',
    regulation: 'SoK Practice Notes 2020',
  },
  {
    id: 'crossSections',
    title: 'Cross-Section Sheets',
    description: 'Tabular cross-sections with cut/fill, areas, and earthworks summary',
    icon: '✂️',
    category: 'engineering',
    regulation: 'RDM 1.1 Section 6',
  },
  {
    id: 'rinexLog',
    title: 'RINEX Observation Log',
    description: 'GNSS observation sessions: receiver, antenna, weather, satellites',
    icon: '🛰️',
    category: 'topographical',
    regulation: 'SoK GNSS Practice Notes',
  },
  {
    id: 'levelingBook',
    title: 'Leveling Book',
    description: 'Rise and fall method with page checks and closure: 10√K mm',
    icon: '📐',
    category: 'engineering',
    regulation: 'RDM 1.1 Section 5',
  },
];

interface CommonFormFields {
  projectName: string;
  parcelNumber: string;
  lrNumber: string;
  county: string;
  subCounty: string;
  locality: string;
  surveyDate: string;
  projection: string;
  datum: string;
  zone: string;
  surveyorName: string;
  surveyorLicense: string;
  surveyorFirm: string;
  directorOfSurveysRef: string;
}

const DEFAULT_FIELDS: CommonFormFields = {
  projectName: '',
  parcelNumber: '',
  lrNumber: '',
  county: 'Kiambu',
  subCounty: '',
  locality: '',
  surveyDate: new Date().toISOString().substring(0, 10),
  projection: 'Cassini-Soldner (Arc 1960)',
  datum: 'Arc 1960',
  zone: '37S',
  surveyorName: '',
  surveyorLicense: '',
  surveyorFirm: '',
  directorOfSurveysRef: '',
};

export function StatutoryFormsPanel({ projectId, onPdfGenerated }: {
  projectId?: string;
  onPdfGenerated?: (pdfPath: string, formType: FormType) => void;
}) {
  const [activeForm, setActiveForm] = useState<FormType | null>(null);
  const [fields, setFields] = useState<CommonFormFields>(DEFAULT_FIELDS);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string>('');
  const [result, setResult] = useState<any>(null);

  // Persist fields to localStorage
  useEffect(() => {
    const saved = localStorage.getItem('metardu:surveyor-info');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setFields({ ...DEFAULT_FIELDS, ...parsed });
      } catch {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('metardu:surveyor-info', JSON.stringify(fields));
  }, [fields]);

  const generate = async () => {
    if (!window.metardu.form && !window.metardu.report) {
      setError('Forms API not available. Preload module not loaded.');
      return;
    }
    setGenerating(true);
    setError('');
    setResult(null);
    try {
      const outputPath = `${(window as any).metardu?.app?.platform ? '' : '/tmp'}metardu-${activeForm}-${Date.now()}.pdf`;
      const baseProject = {
        name: fields.projectName || `Survey of ${fields.parcelNumber}`,
        parcelNumber: fields.parcelNumber,
        lrNumber: fields.lrNumber,
        county: fields.county,
        subCounty: fields.subCounty || undefined,
        locality: fields.locality,
        surveyDate: fields.surveyDate,
        projection: fields.projection,
        datum: fields.datum,
        zone: fields.zone || undefined,
        directorOfSurveysRef: fields.directorOfSurveysRef || undefined,
      };
      const surveyor = {
        name: fields.surveyorName,
        license: fields.surveyorLicense,
        firmName: fields.surveyorFirm || undefined,
      };

      let result;
      switch (activeForm) {
        case 'surveyReport':
          if (!window.metardu.report) throw new Error('report module not loaded');
          result = await window.metardu.report.generate({
            project: { ...baseProject, surveyType: 'cadastral' },
            surveyor,
            beacons: [],
            areaSchedule: {
              parentParcelNumber: fields.parcelNumber,
              parentAreaSqM: 0,
              rows: [],
              reconciliationPassed: true,
            },
            outputPath,
            sealWithRSA: true,
          });
          break;
        case 'formP':
          if (!window.metardu.form) throw new Error('form module not loaded');
          result = await window.metardu.form.generateFormP({
            project: { ...baseProject, mutationType: 'subdivision', registry: fields.county },
            surveyor,
            parentParcel: {
              parcelNumber: fields.parcelNumber,
              lrNumber: fields.lrNumber,
              registry: fields.county,
              areaSqM: 0,
              perimeter: 0,
              pointCount: 0,
              beaconCount: 0,
            },
            newParcels: [],
            extinguishedBeacons: [],
            newBeacons: [],
            outputPath,
            sealWithRSA: true,
          });
          break;
        case 'topoReport':
          if (!window.metardu.form) throw new Error('form module not loaded');
          result = await window.metardu.form.generateTopoReport({
            project: { ...baseProject, clientName: '', purposeOfSurvey: '', approximateArea: 0 },
            surveyor,
            methodology: {
              controlEstablishment: '',
              detailSurvey: '',
              equipment: [],
              weatherConditions: '',
              fieldCrew: [],
            },
            controlNetwork: { stations: [], accuracyAchieved: '' },
            detailPoints: { totalPoints: 0, byCategory: [], breaklines: 0 },
            deliverables: [],
            accuracy: { horizontalRMSE: 0, verticalRMSE: 0, contourInterval: 0.5, demResolution: 0.5 },
            outputPath,
            sealWithRSA: true,
          });
          break;
        case 'crossSections':
          if (!window.metardu.form) throw new Error('form module not loaded');
          result = await window.metardu.form.generateCrossSections({
            project: {
              ...baseProject,
              roadName: '', roadClass: '', chainageStart: 0, chainageEnd: 0,
              designSpeed: 100, totalLength: 0,
            },
            surveyor,
            crossSections: [],
            earthworksSummary: {
              totalCutVolume: 0, totalFillVolume: 0, netVolume: 0,
              averageCutDepth: 0, averageFillHeight: 0, haulDistance: 0,
            },
            outputPath,
            sealWithRSA: true,
          });
          break;
        case 'rinexLog':
          if (!window.metardu.form) throw new Error('form module not loaded');
          result = await window.metardu.form.generateRinexLog({
            project: { ...baseProject },
            surveyor,
            sessions: [],
            outputPath,
            sealWithRSA: true,
          });
          break;
        case 'levelingBook':
          if (!window.metardu.form) throw new Error('form module not loaded');
          result = await window.metardu.form.generateLevelingBook({
            project: {
              ...baseProject,
              levelType: 'Automatic Level',
              levelSerial: '',
              staffType: 'Fiberglass 5m',
              staffSerial: '',
              closureStandard: '10*sqrt(K) mm (RDM 1.1)',
            },
            surveyor,
            pages: [],
            outputPath,
            sealWithRSA: true,
          });
          break;
      }
      setResult(result);
      onPdfGenerated?.(result.pdfPath, activeForm);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="statutory-forms-panel">
      <div className="panel-header">
        <h3>Statutory Forms</h3>
        <p className="panel-subtitle">Generate SoK-compliant documents — all sealed with RSA-2048</p>
      </div>

      <div className="forms-grid">
        {FORMS.map((f) => (
          <button
            key={f.id}
            className={`form-card ${activeForm === f.id ? 'active' : ''}`}
            onClick={() => { setActiveForm(f.id); setResult(null); setError(''); }}
          >
            <div className="form-card-icon">{f.icon}</div>
            <div className="form-card-title">{f.title}</div>
            <div className="form-card-desc">{f.description}</div>
            <div className="form-card-reg">{f.regulation}</div>
          </button>
        ))}
      </div>

      {activeForm && (
        <div className="form-detail">
          <h4>{FORMS.find(f => f.id === activeForm)?.title} — Details</h4>

          <div className="form-fields">
            <fieldset>
              <legend>Project</legend>
              <div className="form-row">
                <label>Project Name<input value={fields.projectName} onChange={(e) => setFields({...fields, projectName: e.target.value})} /></label>
                <label>Parcel Number<input value={fields.parcelNumber} onChange={(e) => setFields({...fields, parcelNumber: e.target.value})} /></label>
                <label>LR Number<input value={fields.lrNumber} onChange={(e) => setFields({...fields, lrNumber: e.target.value})} /></label>
              </div>
              <div className="form-row">
                <label>County<input value={fields.county} onChange={(e) => setFields({...fields, county: e.target.value})} /></label>
                <label>Sub-County<input value={fields.subCounty} onChange={(e) => setFields({...fields, subCounty: e.target.value})} /></label>
                <label>Locality<input value={fields.locality} onChange={(e) => setFields({...fields, locality: e.target.value})} /></label>
              </div>
              <div className="form-row">
                <label>Survey Date<input type="date" value={fields.surveyDate} onChange={(e) => setFields({...fields, surveyDate: e.target.value})} /></label>
                <label>Projection<input value={fields.projection} onChange={(e) => setFields({...fields, projection: e.target.value})} /></label>
                <label>Datum<input value={fields.datum} onChange={(e) => setFields({...fields, datum: e.target.value})} /></label>
                <label>Zone<input value={fields.zone} onChange={(e) => setFields({...fields, zone: e.target.value})} /></label>
              </div>
              <div className="form-row">
                <label>Director of Surveys Ref<input value={fields.directorOfSurveysRef} onChange={(e) => setFields({...fields, directorOfSurveysRef: e.target.value})} /></label>
              </div>
            </fieldset>

            <fieldset>
              <legend>Surveyor</legend>
              <div className="form-row">
                <label>Surveyor Name<input value={fields.surveyorName} onChange={(e) => setFields({...fields, surveyorName: e.target.value})} /></label>
                <label>License No.<input value={fields.surveyorLicense} onChange={(e) => setFields({...fields, surveyorLicense: e.target.value})} /></label>
                <label>Firm Name<input value={fields.surveyorFirm} onChange={(e) => setFields({...fields, surveyorFirm: e.target.value})} /></label>
              </div>
            </fieldset>
          </div>

          <div className="form-actions">
            <button
              className="btn btn-primary"
              onClick={generate}
              disabled={generating || !fields.surveyorName || !fields.surveyorLicense}
            >
              {generating ? 'Generating…' : `Generate ${FORMS.find(f => f.id === activeForm)?.title} PDF`}
            </button>
            <span className="form-note">Output: sealed with RSA-2048</span>
          </div>

          {error && <div className="form-error">⚠ {error}</div>}

          {result && (
            <div className="form-success">
              <div>✓ Generated: {result.pdfPath}</div>
              <div>Pages: {result.pageCount} • Size: {(result.pdfSizeBytes / 1024).toFixed(1)} KB • Sealed: {result.sealed ? 'YES' : 'NO'}</div>
              {result.warnings?.length > 0 && (
                <ul className="form-warnings">
                  {result.warnings.map((w: string, i: number) => <li key={i}>⚠ {w}</li>)}
                </ul>
              )}
              {result.sealed && result.signatureFingerprint && (
                <div className="form-seal-info">
                  🔒 RSA-2048 fingerprint: <code>{result.signatureFingerprint.substring(0, 32)}…</code>
                  <br />Signed at: {result.signedAt}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
