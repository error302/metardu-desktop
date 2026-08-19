import React, { useState, useCallback } from "react";
import type { Form3Input } from "@metardu/engine-flight-planning";
import { PenTool, CheckCircle, XCircle, Shield } from "lucide-react";

interface SignResult {
  surveyor: { name: string; registrationNumber: string; professionalBody: string; country: string; publicKeyBase64: string; keyCreatedAt: string };
  algorithm: string;
  signatureBase64: string;
  contentHashBase64: string;
  signedAt: string;
  signedContent: string;
}

interface VerifyResult {
  valid: boolean;
  surveyor: { name: string; registrationNumber: string; professionalBody: string; country: string; publicKeyBase64: string; keyCreatedAt: string };
  signedAt: string;
  contentHashMatches: boolean;
  signatureValid: boolean;
  error?: string;
}

export const SigningPanel: React.FC = () => {
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"sign" | "verify">("sign");
  const [surveyorName, setSurveyorName] = useState("");
  const [regNo, setRegNo] = useState("");
  const [profBody, setProfBody] = useState("");
  const [country, setCountry] = useState("Kenya");
  const [signResult, setSignResult] = useState<SignResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

   const apis = (window as unknown as {
     metardu?: {
       signing?: {
         signPdf: (pdfBytesBase64: string, privateKeyBase64: string, surveyor: { name: string; registrationNumber: string; professionalBody: string; country: string }) => Promise<SignResult>;
         verifyPdf: (pkcs7Base64: string, pdfBytesBase64: string) => Promise<VerifyResult>;
       };
       form3?: {
         generateForm3Pdf: (input: Form3Input) => Promise<{ pdfBytesBase64: string }>;
       };
     };
   }).metardu;

  const handleSign = useCallback(async () => {
    if (!apis?.signPdf) { setError("Signing not available — run in Electron app."); return; }
    if (!surveyorName || !regNo || !profBody) { setError("Fill in surveyor details first."); return; }
    setBusy(true); setError(null); setSignResult(null);
    try {
      const minPdf = "JVBERi0xLg=="; // tiny minimal PDF placeholder
      const dummyKeyPair = await crypto.subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true, ["sign", "verify"],
      );
      const pkcs8 = await crypto.subtle.exportKey("pkcs8", dummyKeyPair.privateKey);
      const pkcs8b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
      const r = await apis.signPdf(minPdf, pkcs8b64, { name: surveyorName, registrationNumber: regNo, professionalBody: profBody, country });
      setSignResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [apis, surveyorName, regNo, profBody, country]);

  const handleVerify = useCallback(async () => {
    if (!apis?.verifyPdf) { setError("Verification not available — run in Electron app."); return; }
    setBusy(true); setError(null); setVerifyResult(null);
    try {
      setError("Pick a .pdf file and its .p7b signature file (future tier).");
    } finally {
      setBusy(false);
    }
  }, [apis]);

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
          Digital Signature & Seal
        </h2>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Sign statutory plans with your professional registration. RSA-2048 + SHA-256 via Web Crypto.
        </p>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--border-default)", paddingBottom: "8px" }}>
        {(["sign", "verify"] as const).map((t) => (
          <button key={t} onClick={() => { setTab(t); setError(null); setSignResult(null); setVerifyResult(null); }}
            style={{
              padding: "8px 16px", borderRadius: "6px", border: "none",
              background: tab === t ? "var(--accent-primary)" : "transparent",
              color: tab === t ? "#fff" : "var(--text-secondary)",
              fontSize: "13px", fontWeight: 500, cursor: "pointer",
            }}
          >
            {t === "sign" ? "Sign" : "Verify"}
          </button>
        ))}
      </div>

      {tab === "sign" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            {[
              { label: "Surveyor Name", value: surveyorName, set: setSurveyorName },
              { label: "Registration No.", value: regNo, set: setRegNo },
              { label: "Professional Body", value: profBody, set: setProfBody },
              { label: "Country", value: country, set: setCountry },
            ].map((f) => (
              <div key={f.label}>
                <label style={{ display: "block", fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "4px", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>{f.label}</label>
                <input value={f.value} onChange={(e) => f.set(e.target.value)}
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-default)",
                    background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "13px",
                    fontFamily: f.label === "Registration No." ? "var(--font-mono)" : undefined,
                  }}
                />
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button onClick={handleSign} disabled={busy}
              style={{
                display: "inline-flex", alignItems: "center", gap: "6px",
                padding: "10px 18px", borderRadius: "8px", border: "1px solid var(--accent-primary)",
                background: busy ? "var(--bg-hover)" : "var(--accent-primary)",
                color: busy ? "var(--text-tertiary)" : "#fff",
                fontSize: "13px", fontWeight: 500, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1,
              }}
            >
              <PenTool size={16} strokeWidth={2} />
              {busy ? "Signing…" : "Sign Document"}
            </button>
          </div>
        </div>
      )}

      {tab === "verify" && (
        <div>
          <button onClick={handleVerify} disabled={busy}
            style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              padding: "10px 18px", borderRadius: "8px", border: "1px solid var(--accent-primary)",
              background: busy ? "var(--bg-hover)" : "var(--accent-primary)",
              color: busy ? "var(--text-tertiary)" : "#fff",
              fontSize: "13px", fontWeight: 500, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1,
            }}
          >
            <Shield size={16} strokeWidth={2} />
            {busy ? "Verifying…" : "Verify Signature"}
          </button>
        </div>
      )}

      {error && (
        <div style={{ padding: "12px 14px", borderRadius: "8px", background: "var(--bg-error)", border: "1px solid var(--border-error)", fontSize: "12px", color: "var(--text-error)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {signResult && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ padding: "10px 14px", borderRadius: "8px", background: "var(--bg-success)", border: "1px solid var(--border-success)", fontSize: "12px", color: "var(--text-secondary)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <CheckCircle size={16} strokeWidth={2} color="var(--text-success)" />
              <strong style={{ color: "var(--text-primary)" }}>Signed successfully</strong>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: "11px", fontFamily: "var(--font-mono)" }}>
              <span style={{ color: "var(--text-tertiary)" }}>Algorithm</span><span style={{ color: "var(--text-secondary)" }}>{signResult.algorithm}</span>
              <span style={{ color: "var(--text-tertiary)" }}>Signed at</span><span style={{ color: "var(--text-secondary)" }}>{signResult.signedAt}</span>
              <span style={{ color: "var(--text-tertiary)" }}>Content hash</span><span style={{ color: "var(--text-secondary)" }}>{signResult.contentHashBase64.substring(0, 24)}…</span>
              <span style={{ color: "var(--text-tertiary)" }}>Surveyor</span><span style={{ color: "var(--text-secondary)" }}>{signResult.surveyor.name} ({signResult.surveyor.professionalBody} {signResult.surveyor.registrationNumber})</span>
            </div>
          </div>
        </div>
      )}

      {verifyResult && (
        <div style={{ padding: "10px 14px", borderRadius: "8px", background: verifyResult.valid ? "var(--bg-success)" : "var(--bg-error)", border: `1px solid ${verifyResult.valid ? "var(--border-success)" : "var(--border-error)"}`, fontSize: "12px", color: "var(--text-secondary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {verifyResult.valid ? <CheckCircle size={16} strokeWidth={2} color="var(--text-success)" /> : <XCircle size={16} strokeWidth={2} color="var(--text-error)" />}
            <strong style={{ color: verifyResult.valid ? "var(--text-success)" : "var(--text-error)" }}>
              {verifyResult.valid ? "Signature valid" : "Signature invalid"}
            </strong>
          </div>
          {verifyResult.error && <div style={{ marginTop: "8px", fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-error)" }}>{verifyResult.error}</div>}
        </div>
      )}
    </div>
  );
};
