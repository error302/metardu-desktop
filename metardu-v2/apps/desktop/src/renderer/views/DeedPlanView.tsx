/**
 * Deed Plan (Form No. 3) — Statutory Cadastral Survey Document View.
 *
 * Features:
 *   - Editable beacon table with add/remove/edit
 *   - Auto-computed boundary line tabulation (bearing + distance per segment)
 *   - Shoelace area + perimeter in m² and hectares
 *   - Coordinate schedule (Beacon, E, N, Description)
 *   - Real Form 3 PDF generation via engine (generateForm3Pdf)
 *   - Real DXF export via engine (generateForm3Dxf)
 *   - Real RSA-2048 SHA-256 digital signing (signPdf)
 *   - SurveyCanvas visualization with polygon + beacons + labels
 *   - Submission validation (≥3 beacons, valid ISK format, area > 0)
 */

import React, { useState, useCallback, useMemo } from "react";
import { SurveyCanvas, type SurveyPoint, type SurveyPolygon } from "@metardu/ui-components";
import { useSurveyState } from "../SurveyStateContext.js";
import { AutoExportBanner } from "./AutoExportBanner.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Beacon {
  id: string;
  label: string;
  easting: number;
  northing: number;
  description: string;
}

interface BoundaryLine {
  from: string;
  to: string;
  bearing: string;
  distance: number;
  index: number;
}

interface Form3Input {
  parcel: {
    surveyNumber: string;
    district: string;
    location: string;
    areaHa: number;
    beacons: Array<{ label: string; position: { easting: number; northing: number }; description: string }>;
    srid: number;
  };
  surveyor: {
    name: string;
    iskRegNo: string;
    dateOfSurvey: string;
  };
  deedPlanNumber?: string;
}

interface SignResult {
  surveyor: { name: string; registrationNumber: string; professionalBody: string; country: string; publicKeyBase64: string; keyCreatedAt: string };
  algorithm: string;
  signatureBase64: string;
  contentHashBase64: string;
  signedAt: string;
  signedContent: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Compute bearing from A→B in decimal degrees (clockwise from North). */
function bearingDeg(a: { easting: number; northing: number }, b: { easting: number; northing: number }): number {
  const de = b.easting - a.easting;
  const dn = b.northing - a.northing;
  let deg = (Math.atan2(de, dn) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

/** Format bearing as DDD°MM'SS". */
function bearingDMS(deg: number): string {
  const d = Math.floor(deg);
  const mFull = (deg - d) * 60;
  const m = Math.floor(mFull);
  const s = Math.round((mFull - m) * 60);
  return `${String(d).padStart(3, "0")}°${String(m).padStart(2, "0")}'${String(s).padStart(2, "0")}"`;
}

/** Distance between two points in metres. */
function distanceM(a: { easting: number; northing: number }, b: { easting: number; northing: number }): number {
  const de = b.easting - a.easting;
  const dn = b.northing - a.northing;
  return Math.sqrt(de * de + dn * dn);
}

/** Compute boundary line tabulation from ordered beacons. */
function computeBoundaryLines(beacons: Beacon[]): BoundaryLine[] {
  if (beacons.length < 2) return [];
  const lines: BoundaryLine[] = [];
  for (let i = 0; i < beacons.length; i++) {
    const from = beacons[i]!;
    const to = beacons[(i + 1) % beacons.length]!;
    const brg = bearingDeg(from, to);
    const dist = distanceM(from, to);
    lines.push({
      from: from.label,
      to: to.label,
      bearing: bearingDMS(brg),
      distance: dist,
      index: i + 1,
    });
  }
  return lines;
}

/** Shoelace area in m². */
function shoelaceArea(points: Array<{ easting: number; northing: number }>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    sum += points[i]!.easting * points[j]!.northing;
    sum -= points[j]!.easting * points[i]!.northing;
  }
  return Math.abs(sum / 2);
}

/** Total perimeter in metres. */
function perimeter(points: Array<{ easting: number; northing: number }>): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    total += distanceM(points[i]!, points[j]!);
  }
  return total;
}

/** Validate ISK registration number format (LS/XXXX). */
function isValidISK(regNo: string): boolean {
  return /^LS\/\d{3,5}$/i.test(regNo.trim());
}

let beaconCounter = 0;
function nextBeaconLabel(): string {
  beaconCounter++;
  return `B${beaconCounter}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const DeedPlanView: React.FC = () => {
  const { setSurveyOutput } = useSurveyState();

  // ── Title block fields ──
  const [lrNumber, setLrNumber] = useState("LR KIAMBU/RIRUTA/247/15");
  const [deedPlanNo, setDeedPlanNo] = useState("");
  const [county, setCounty] = useState("Kiambu");
  const [subCounty, setSubCounty] = useState("Kabete");
  const [surveyorName, setSurveyorName] = useState("John M. Kamau, MISK");
  const [licenseNumber, setLicenseNumber] = useState("LS/0481");
  const [surveyDate, setSurveyDate] = useState(new Date().toISOString().split("T")[0]!);

  // ── Beacon table ──
  const [beacons, setBeacons] = useState<Beacon[]>([
    { id: "b1", label: "B1", easting: 257100.0, northing: 9857700.0, description: "Concrete pillar" },
    { id: "b2", label: "B2", easting: 257250.0, northing: 9857720.0, description: "Iron pin" },
    { id: "b3", label: "B3", easting: 257280.0, northing: 9857580.0, description: "Concrete pillar" },
    { id: "b4", label: "B4", easting: 257120.0, northing: 9857550.0, description: "Iron pin" },
  ]);

  // ── Digital signing ──
  const [sealed, setSealed] = useState(false);
  const [sealResult, setSealResult] = useState<SignResult | null>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  // ── Export state ──
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingDxf, setExportingDxf] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // ── Computed geometry ──
  const areaSqM = useMemo(() => shoelaceArea(beacons), [beacons]);
  const areaHa = useMemo(() => areaSqM / 10000, [areaSqM]);
  const perimeterM = useMemo(() => perimeter(beacons), [beacons]);
  const boundaryLines = useMemo(() => computeBoundaryLines(beacons), [beacons]);

  // ── Validation ──
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (beacons.length < 3) errors.push("At least 3 beacons required for a closed polygon.");
    if (areaSqM <= 0) errors.push("Parcel area must be positive (check beacon ordering).");
    if (!isValidISK(licenseNumber)) errors.push("ISK registration number must match format LS/XXXX.");
    if (!surveyorName.trim()) errors.push("Surveyor name is required.");
    return errors;
  }, [beacons, areaSqM, licenseNumber, surveyorName]);

  const isValid = validationErrors.length === 0;

  // ── SurveyCanvas data ──
  const surveyPoints: SurveyPoint[] = useMemo(
    () => beacons.map((b) => ({ easting: b.easting, northing: b.northing, label: b.label })),
    [beacons],
  );

  const parcelPolygon: SurveyPolygon = useMemo(
    () => ({
      points: surveyPoints,
      strokeColor: "#FF9500",
      strokeWidth: 2,
      fillColor: "rgba(255, 149, 0, 0.08)",
      label: lrNumber,
    }),
    [surveyPoints, lrNumber],
  );

  // ── Build Form3Input for the engine ──
  const buildForm3Input = useCallback((): Form3Input => ({
    parcel: {
      surveyNumber: lrNumber,
      district: county,
      location: subCounty,
      areaHa,
      srid: 21037, // Arc 1960 / UTM zone 37S
      beacons: beacons.map((b) => ({
        label: b.label,
        position: { easting: b.easting, northing: b.northing },
        description: b.description,
      })),
    },
    surveyor: {
      name: surveyorName,
      iskRegNo: licenseNumber,
      dateOfSurvey: surveyDate,
    },
    deedPlanNumber: deedPlanNo || undefined,
  }), [lrNumber, county, subCounty, areaHa, beacons, surveyorName, licenseNumber, surveyDate, deedPlanNo]);

  // ── Beacon CRUD ──
  const addBeacon = useCallback(() => {
    const last = beacons[beacons.length - 1];
    const newBeacon: Beacon = {
      id: `b${Date.now()}`,
      label: nextBeaconLabel(),
      easting: last ? last.easting + 30 : 257100,
      northing: last ? last.northing : 9857700,
      description: "Concrete pillar",
    };
    setBeacons((prev) => [...prev, newBeacon]);
  }, [beacons]);

  const removeBeacon = useCallback((id: string) => {
    setBeacons((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const updateBeacon = useCallback((id: string, field: keyof Beacon, value: string | number) => {
    setBeacons((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  }, []);

  // ── Generate Form 3 PDF via engine ──
  const handleExportPdf = useCallback(async () => {
    if (!isValid) return;
    setExportingPdf(true);
    setExportStatus(null);
    try {
      const apis = (window as any).metardu;
      if (!apis?.form3?.generateForm3Pdf) {
        setExportStatus("PDF generation not available — run in Electron app.");
        return;
      }
      const input = buildForm3Input();
      const result = await apis.form3.generateForm3Pdf(input);
      // Decode base64 and trigger download
      const bytes = Uint8Array.from(atob(result.pdfBytesBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Form3_${lrNumber.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setExportStatus(`PDF exported: ${bytes.length} bytes`);
    } catch (e) {
      setExportStatus(`PDF export failed: ${(e as Error).message}`);
    } finally {
      setExportingPdf(false);
    }
  }, [isValid, buildForm3Input, lrNumber]);

  // ── Generate DXF via engine ──
  const handleExportDxf = useCallback(async () => {
    if (!isValid) return;
    setExportingDxf(true);
    setExportStatus(null);
    try {
      const apis = (window as any).metardu;
      if (!apis?.export?.survey) {
        setExportStatus("DXF export not available — run in Electron app.");
        return;
      }
      const surveyOutput = {
        type: "cadastral",
        titleData: { lrNumber, county, subCounty, areaHa, surveyorName, licenseNumber, surveyDate },
        points: beacons.map((b) => ({ easting: b.easting, northing: b.northing, label: b.label })),
        beacons: beacons.map((b) => ({
          label: b.label,
          position: { easting: b.easting, northing: b.northing },
          description: b.description,
        })),
        boundaryLines: boundaryLines.map((l) => ({
          from: l.from,
          to: l.to,
          bearing: l.bearing,
          distance: l.distance,
        })),
        areaHa,
        srid: 21037,
      };
      const result = await apis.export.survey("dxf", surveyOutput, { countryCode: "KE" });
      setExportStatus(`DXF exported: ${result.filePath} (${result.bytes} bytes)`);
    } catch (e) {
      setExportStatus(`DXF export failed: ${(e as Error).message}`);
    } finally {
      setExportingDxf(false);
    }
  }, [isValid, lrNumber, county, subCounty, areaHa, surveyorName, licenseNumber, surveyDate, beacons, boundaryLines]);

  // ── Digital signing via engine ──
  const handleSign = useCallback(async () => {
    if (!isValid) return;
    setSigning(true);
    setSignError(null);
    setSealResult(null);
    try {
      const apis = (window as any).metardu;
      if (!apis?.signing?.signPdf) {
        setSignError("Signing not available — run in Electron app.");
        return;
      }
      // Generate a key pair in the renderer (private key stays local)
      const keyPair = await crypto.subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true,
        ["sign", "verify"],
      );
      const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
      const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));

      // Generate the PDF to sign
      const form3Input = buildForm3Input();
      const pdfResult = await apis.form3.generateForm3Pdf(form3Input);

      // Sign it
      const sigResult = await apis.signing.signPdf(
        pdfResult.pdfBytesBase64,
        privateKeyBase64,
        {
          name: surveyorName,
          registrationNumber: licenseNumber,
          professionalBody: "ISK",
          country: "Kenya",
        },
      );
      setSealResult(sigResult);
      setSealed(true);

      // Also push to survey output context
      setSurveyOutput(
        {
          type: "cadastral",
          titleData: { lrNumber, county, subCounty, areaHa, surveyorName, licenseNumber, surveyDate },
          points: beacons.map((b) => ({ easting: b.easting, northing: b.northing, label: b.label })),
          sealed: true,
          signature: sigResult.signatureBase64,
        },
        "cadastral",
        "DeedPlanView",
        "KE"
      );
    } catch (e) {
      setSignError((e as Error).message);
    } finally {
      setSigning(false);
    }
  }, [isValid, buildForm3Input, surveyorName, licenseNumber, lrNumber, county, subCounty, areaHa, surveyDate, beacons, setSurveyOutput]);

  // ── Render ──
  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", height: "100%", overflow: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)", margin: 0 }}>
            Form No. 3 — Statutory Deed Plan
          </h2>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: "2px 0 0 0" }}>
            Prepare, validate, and digitally sign statutory deed plans per Survey Act Cap 299.
          </p>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button onClick={handleExportPdf} disabled={!isValid || exportingPdf}
            style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--border-default)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: "12px", cursor: isValid && !exportingPdf ? "pointer" : "not-allowed", opacity: isValid ? 1 : 0.5 }}>
            {exportingPdf ? "Generating…" : "📄 Export PDF"}
          </button>
          <button onClick={handleExportDxf} disabled={!isValid || exportingDxf}
            style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--border-default)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: "12px", cursor: isValid && !exportingDxf ? "pointer" : "not-allowed", opacity: isValid ? 1 : 0.5 }}>
            {exportingDxf ? "Generating…" : "📐 Export DXF"}
          </button>
        </div>
      </div>

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div style={{ padding: "8px 12px", borderRadius: "6px", background: "var(--bg-error, rgba(239,68,68,0.08))", border: "1px solid var(--border-error, #ef4444)", fontSize: "12px", color: "var(--text-error, #ef4444)" }}>
          {validationErrors.map((e, i) => <div key={i}>⚠ {e}</div>)}
        </div>
      )}

      {/* Export status */}
      {exportStatus && (
        <div style={{ padding: "8px 12px", borderRadius: "6px", background: "var(--bg-success, rgba(34,197,94,0.08))", border: "1px solid var(--border-success, #22c55e)", fontSize: "12px", color: "var(--text-success, #22c55e)" }}>
          {exportStatus}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        {/* ── Title Block ── */}
        <div style={{ background: "var(--bg-tertiary)", padding: "12px", border: "1px solid var(--border-default)" }}>
          <h4 style={{ margin: "0 0 8px 0", color: "var(--accent-primary)" }}>Title Block</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>LR / Parcel Number</label>
                <input type="text" value={lrNumber} onChange={(e) => setLrNumber(e.target.value)} style={{ width: "100%", padding: "4px 6px", fontSize: "12px" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Deed Plan No.</label>
                <input type="text" value={deedPlanNo} onChange={(e) => setDeedPlanNo(e.target.value)} placeholder="(assigned at registry)" style={{ width: "100%", padding: "4px 6px", fontSize: "12px" }} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>County</label>
                <input type="text" value={county} onChange={(e) => setCounty(e.target.value)} style={{ width: "100%", padding: "4px 6px", fontSize: "12px" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Sub-County / Reg.</label>
                <input type="text" value={subCounty} onChange={(e) => setSubCounty(e.target.value)} style={{ width: "100%", padding: "4px 6px", fontSize: "12px" }} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Licensed Surveyor</label>
                <input type="text" value={surveyorName} onChange={(e) => setSurveyorName(e.target.value)} style={{ width: "100%", padding: "4px 6px", fontSize: "12px" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>License No. (ISK)</label>
                <input type="text" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} style={{ width: "100%", padding: "4px 6px", fontSize: "12px", fontFamily: "var(--font-mono)" }} />
              </div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Date of Survey</label>
              <input type="date" value={surveyDate} onChange={(e) => setSurveyDate(e.target.value)} style={{ width: "100%", padding: "4px 6px", fontSize: "12px" }} />
            </div>
          </div>
        </div>

        {/* ── Geometry Summary + Signing ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ padding: "12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
            <h4 style={{ margin: "0 0 6px 0", color: "var(--accent-primary)" }}>Parcel Geometry</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              <div>Area: <strong style={{ color: "var(--text-primary)" }}>{areaSqM.toFixed(1)} m²</strong></div>
              <div>Area: <strong style={{ color: "var(--text-primary)" }}>{areaHa.toFixed(4)} ha</strong></div>
              <div>Perimeter: <strong style={{ color: "var(--text-primary)" }}>{perimeterM.toFixed(3)} m</strong></div>
              <div>Beacons: <strong style={{ color: "var(--text-primary)" }}>{beacons.length}</strong></div>
              <div>Scale: <strong>1:{areaHa < 0.5 ? 500 : areaHa < 5 ? 1000 : areaHa < 50 ? 2500 : 5000}</strong></div>
              <div>CRS: <strong>Arc 1960 / UTM 37S</strong></div>
            </div>
          </div>

          {/* Digital signing */}
          <div style={{ padding: "12px", background: sealed ? "rgba(34,197,94,0.08)" : "var(--bg-tertiary)", border: `1px solid ${sealed ? "#22c55e" : "var(--border-default)"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: "bold", fontSize: "var(--text-sm)", color: sealed ? "var(--status-success, #22c55e)" : "var(--text-primary)" }}>
                  {sealed ? "Digitally Signed (RSA-2048)" : "Document Unsigned"}
                </div>
                {sealResult && (
                  <div style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", marginTop: "2px" }}>
                    SHA-256: {sealResult.contentHashBase64.substring(0, 32)}…
                  </div>
                )}
                {signError && (
                  <div style={{ fontSize: "10px", color: "var(--text-error, #ef4444)", marginTop: "2px" }}>{signError}</div>
                )}
              </div>
              <button onClick={handleSign} disabled={!isValid || signing || sealed}
                style={{ padding: "6px 12px", borderRadius: "6px", border: `1px solid ${sealed ? "#22c55e" : "var(--accent-primary)"}`, background: sealed ? "#22c55e" : "var(--accent-primary)", color: "#fff", fontSize: "12px", fontWeight: 500, cursor: isValid && !signing && !sealed ? "pointer" : "not-allowed", opacity: isValid && !sealed ? 1 : 0.7 }}>
                {signing ? "Signing…" : sealed ? "Sealed ✓" : "Sign & Seal"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <AutoExportBanner />

      {/* ── Beacon Table (editable) ── */}
      <div style={{ border: "1px solid var(--border-default)", borderRadius: "6px", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
          <h4 style={{ margin: 0, color: "var(--accent-primary)", fontSize: "var(--text-sm)" }}>Beacon Coordinate Schedule</h4>
          <button onClick={addBeacon} style={{ padding: "4px 10px", borderRadius: "4px", border: "1px solid var(--border-default)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "11px", cursor: "pointer" }}>
            + Add Beacon
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
            <thead>
              <tr style={{ background: "var(--bg-secondary, rgba(255,255,255,0.03))" }}>
                <th style={{ padding: "6px 8px", textAlign: "left", color: "var(--text-tertiary)", fontWeight: 500, borderBottom: "1px solid var(--border-default)" }}>#</th>
                <th style={{ padding: "6px 8px", textAlign: "left", color: "var(--text-tertiary)", fontWeight: 500, borderBottom: "1px solid var(--border-default)" }}>Label</th>
                <th style={{ padding: "6px 8px", textAlign: "right", color: "var(--text-tertiary)", fontWeight: 500, borderBottom: "1px solid var(--border-default)" }}>Easting (m)</th>
                <th style={{ padding: "6px 8px", textAlign: "right", color: "var(--text-tertiary)", fontWeight: 500, borderBottom: "1px solid var(--border-default)" }}>Northing (m)</th>
                <th style={{ padding: "6px 8px", textAlign: "left", color: "var(--text-tertiary)", fontWeight: 500, borderBottom: "1px solid var(--border-default)" }}>Description</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}></th>
              </tr>
            </thead>
            <tbody>
              {beacons.map((b, i) => (
                <tr key={b.id} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                  <td style={{ padding: "4px 8px", color: "var(--text-tertiary)", borderBottom: "1px solid var(--border-default)" }}>{i + 1}</td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border-default)" }}>
                    <input value={b.label} onChange={(e) => updateBeacon(b.id, "label", e.target.value)}
                      style={{ width: "60px", padding: "2px 4px", fontSize: "12px", fontFamily: "var(--font-mono)" }} />
                  </td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border-default)" }}>
                    <input type="number" value={b.easting} step={0.001}
                      onChange={(e) => updateBeacon(b.id, "easting", parseFloat(e.target.value) || 0)}
                      style={{ width: "110px", padding: "2px 4px", fontSize: "12px", fontFamily: "var(--font-mono)", textAlign: "right" }} />
                  </td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border-default)" }}>
                    <input type="number" value={b.northing} step={0.001}
                      onChange={(e) => updateBeacon(b.id, "northing", parseFloat(e.target.value) || 0)}
                      style={{ width: "110px", padding: "2px 4px", fontSize: "12px", fontFamily: "var(--font-mono)", textAlign: "right" }} />
                  </td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border-default)" }}>
                    <input value={b.description} onChange={(e) => updateBeacon(b.id, "description", e.target.value)}
                      style={{ width: "100%", padding: "2px 4px", fontSize: "12px" }} />
                  </td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border-default)" }}>
                    {beacons.length > 3 && (
                      <button onClick={() => removeBeacon(b.id)}
                        style={{ padding: "2px 6px", borderRadius: "3px", border: "1px solid var(--border-error, #ef4444)", background: "transparent", color: "var(--text-error, #ef4444)", fontSize: "10px", cursor: "pointer" }}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Boundary Line Tabulation ── */}
      {boundaryLines.length > 0 && (
        <div style={{ border: "1px solid var(--border-default)", borderRadius: "6px", overflow: "hidden" }}>
          <div style={{ padding: "8px 12px", background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)" }}>
            <h4 style={{ margin: 0, color: "var(--accent-primary)", fontSize: "var(--text-sm)" }}>Boundary Line Tabulation</h4>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr style={{ background: "var(--bg-secondary, rgba(255,255,255,0.03))" }}>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: "var(--text-tertiary)", fontWeight: 500, borderBottom: "1px solid var(--border-default)" }}>Line</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: "var(--text-tertiary)", fontWeight: 500, borderBottom: "1px solid var(--border-default)" }}>From</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: "var(--text-tertiary)", fontWeight: 500, borderBottom: "1px solid var(--border-default)" }}>To</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: "var(--text-tertiary)", fontWeight: 500, borderBottom: "1px solid var(--border-default)" }}>Bearing</th>
                  <th style={{ padding: "6px 8px", textAlign: "right", color: "var(--text-tertiary)", fontWeight: 500, borderBottom: "1px solid var(--border-default)" }}>Distance (m)</th>
                </tr>
              </thead>
              <tbody>
                {boundaryLines.map((l, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                    <td style={{ padding: "4px 8px", color: "var(--text-tertiary)", borderBottom: "1px solid var(--border-default)", fontFamily: "var(--font-mono)" }}>L{l.index}</td>
                    <td style={{ padding: "4px 8px", fontWeight: 500, borderBottom: "1px solid var(--border-default)" }}>{l.from}</td>
                    <td style={{ padding: "4px 8px", fontWeight: 500, borderBottom: "1px solid var(--border-default)" }}>{l.to}</td>
                    <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono)", borderBottom: "1px solid var(--border-default)" }}>{l.bearing}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)", borderBottom: "1px solid var(--border-default)" }}>{l.distance.toFixed(3)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 600, background: "var(--bg-tertiary)" }}>
                  <td colSpan={4} style={{ padding: "4px 8px", borderBottom: "1px solid var(--border-default)" }}>Total Perimeter</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "var(--font-mono)", borderBottom: "1px solid var(--border-default)" }}>{perimeterM.toFixed(3)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SurveyCanvas ── */}
      <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "12px" }}>
        <SurveyCanvas
          height={340}
          title={`Deed Plan — ${lrNumber}`}
          polygons={[parcelPolygon]}
          points={surveyPoints}
          showPointLabels={true}
          showNorthArrow={true}
          showScaleBar={true}
        />
      </div>
    </div>
  );
};
