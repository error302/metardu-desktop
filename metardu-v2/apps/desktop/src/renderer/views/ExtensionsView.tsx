import React, { useState } from "react";
import { AlertTriangle, Boxes, FileCode2, Play, ShieldAlert } from "lucide-react";

type SelectedModule = Extract<
  Awaited<ReturnType<typeof window.metardu.plugins.pickModule>>,
  { canceled: false }
>;

const fieldStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--bg-primary)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-default)",
  borderRadius: 4,
  padding: "9px 10px",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
};

export const ExtensionsView: React.FC = () => {
  const [module, setModule] = useState<SelectedModule | null>(null);
  const [pluginId, setPluginId] = useState("community.example.tool");
  const [version, setVersion] = useState("0.1.0");
  const [input, setInput] = useState("{\n  \"message\": \"Hello surveyor\"\n}");
  const [outputText, setOutputText] = useState("");
  const [outputWasTruncated, setOutputWasTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectModule = async () => {
    setError(null);
    setNotice(null);
    setOutputText("");
    try {
      const selected = await window.metardu.plugins.pickModule();
      if (selected.canceled) return;
      setModule(selected);
      if (selected.evictedPreviousSelection) {
        setNotice("The oldest cached module was cleared because Desktop keeps at most five selected modules in memory.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const runModule = async () => {
    if (!module) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setOutputText("");
    try {
      const parsedInput: unknown = JSON.parse(input);
      const result = await window.metardu.plugins.run({
        moduleToken: module.token,
        pluginId,
        version,
        input: parsedInput,
      });
      const formatted = JSON.stringify(result, null, 2);
      const maxPreviewCharacters = 500_000;
      setOutputWasTruncated(formatted.length > maxPreviewCharacters);
      setOutputText(formatted.slice(0, maxPreviewCharacters));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, height: "100%", overflow: "auto" }}>
      <header style={{ borderBottom: "1px solid var(--border-default)", paddingBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: "var(--text-xl)", color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>
          Community Extensions — Preview
        </h2>
        <div style={{ marginTop: 4, color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>
          Run one locally selected WebAssembly tool using an explicit JSON input.
        </div>
      </header>

      <section style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: 12, border: "1px solid #EAB308", borderRadius: 4, background: "rgba(234, 179, 8, 0.08)" }}>
        <ShieldAlert size={17} color="#EAB308" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-primary)" }}>
          <strong>Community / Draft output only.</strong> The module publisher and method are not verified. Review the code and every result before professional use. This preview cannot read your project, access instruments, or write files.
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", borderRadius: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Boxes size={17} color="var(--accent-primary)" />
          <h3 style={{ margin: 0, color: "var(--text-primary)", fontSize: 13 }}>Select a WebAssembly module</h3>
          <button onClick={selectModule} disabled={busy} style={{ marginLeft: "auto", border: "1px solid var(--accent-primary)", borderRadius: 4, padding: "7px 10px", color: "var(--accent-primary)", background: "transparent", cursor: busy ? "wait" : "pointer", fontSize: 11 }}>
            Choose .wasm file
          </button>
        </div>
        {module ? (
          <div style={{ padding: 10, background: "var(--bg-primary)", border: "1px solid var(--border-subtle)", borderRadius: 4, overflowWrap: "anywhere" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--text-primary)", fontSize: 12 }}>
              <FileCode2 size={14} color="var(--accent-primary)" /> {module.filename}
              <span style={{ color: "var(--text-tertiary)", marginLeft: "auto" }}>{(module.sizeBytes / 1024).toFixed(1)} KiB</span>
            </div>
            <div style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)" }}>SHA-256 · {module.sha256}</div>
            <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-secondary)" }}>Cached in memory until {new Date(module.expiresAt).toLocaleTimeString()} or app close.</div>
          </div>
        ) : (
          <div style={{ color: "var(--text-tertiary)", fontSize: 11 }}>No module selected. Desktop never installs it from this preview.</div>
        )}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(140px, 1fr)", gap: 10 }}>
        <label style={{ color: "var(--text-secondary)", fontSize: 11 }}>
          Claimed plugin ID (unverified)
          <input value={pluginId} onChange={(event) => setPluginId(event.target.value)} maxLength={511} style={{ ...fieldStyle, marginTop: 5 }} />
        </label>
        <label style={{ color: "var(--text-secondary)", fontSize: 11 }}>
          Version
          <input value={version} onChange={(event) => setVersion(event.target.value)} maxLength={64} style={{ ...fieldStyle, marginTop: 5 }} />
        </label>
      </section>

      <label style={{ color: "var(--text-secondary)", fontSize: 11 }}>
        JSON input · maximum 4 MiB
        <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={8} spellCheck={false} style={{ ...fieldStyle, display: "block", marginTop: 5, resize: "vertical", lineHeight: 1.5 }} />
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={runModule} disabled={!module || busy} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "none", borderRadius: 4, padding: "9px 14px", background: module && !busy ? "var(--accent-primary)" : "var(--bg-tertiary)", color: module && !busy ? "var(--bg-primary)" : "var(--text-disabled)", cursor: module && !busy ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 12 }}>
          <Play size={14} /> {busy ? "Running…" : "Run as Community / Draft"}
        </button>
        <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>No network, file, database, instrument, or project capability is granted.</span>
      </div>

      {notice && <div role="status" style={{ padding: 10, border: "1px solid var(--border-default)", borderRadius: 4, color: "var(--text-secondary)", fontSize: 11 }}>{notice}</div>}
      {error && <div role="alert" style={{ padding: 10, border: "1px solid #EF4444", borderRadius: 4, color: "#FCA5A5", background: "rgba(239, 68, 68, 0.08)", fontSize: 11, overflowWrap: "anywhere" }}><AlertTriangle size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />{error}</div>}
      {outputText && (
        <section style={{ minHeight: 180, display: "flex", flexDirection: "column", gap: 6 }}>
          <h3 style={{ margin: 0, color: "var(--accent-primary)", fontSize: 12 }}>Host-wrapped result · Community / Draft</h3>
          {outputWasTruncated && <div style={{ color: "#EAB308", fontSize: 10 }}>Preview truncated to 500,000 characters.</div>}
          <pre style={{ margin: 0, padding: 12, maxHeight: 340, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "var(--bg-primary)", border: "1px solid var(--border-default)", borderRadius: 4, color: "var(--text-primary)", fontSize: 10, lineHeight: 1.45 }}>{outputText}</pre>
        </section>
      )}
    </div>
  );
};
