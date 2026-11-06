import React, { useEffect, useState } from "react";
import { AlertTriangle, Boxes, FileCode2, Play, ShieldAlert } from "lucide-react";
import { useSurveyState } from "../SurveyStateContext.js";
import { buildCommunityProjectOutputInput } from "../community-project-input.js";

type SelectedModule = Extract<
  Awaited<ReturnType<typeof window.metardu.plugins.pickModule>>,
  { canceled: false }
>;
type InstalledPackage = Awaited<ReturnType<typeof window.metardu.plugins.listInstalled>>["packages"][number];
type ProjectInputSource = { projectId: string; projectVersion: number; projectName: string; sourceView: string; surveyType: string; byteLength: number };

const DEFAULT_PLUGIN_INPUT = "{\n  \"message\": \"Hello surveyor\"\n}";

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
  const { activeProject } = useSurveyState();
  const [module, setModule] = useState<SelectedModule | null>(null);
  const [packages, setPackages] = useState<InstalledPackage[]>([]);
  const [packageIssues, setPackageIssues] = useState<Array<{ packageSha256: string | null; message: string }>>([]);
  const [selectedPackageSha256, setSelectedPackageSha256] = useState<string | null>(null);
  const [pluginId, setPluginId] = useState("community.example.tool");
  const [version, setVersion] = useState("0.1.0");
  const [input, setInput] = useState(DEFAULT_PLUGIN_INPUT);
  const [inputSource, setInputSource] = useState<ProjectInputSource | null>(null);
  const [outputText, setOutputText] = useState("");
  const [outputWasTruncated, setOutputWasTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshPackages = async () => {
    const listing = await window.metardu.plugins.listInstalled();
    setPackages(listing.packages);
    setPackageIssues(listing.issues);
    if (selectedPackageSha256 && !listing.packages.some((pkg) => pkg.packageSha256 === selectedPackageSha256)) {
      setSelectedPackageSha256(null);
    }
  };

  useEffect(() => {
    void refreshPackages().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const loadActiveProjectOutput = () => {
    setError(null);
    setNotice(null);
    if (!activeProject) {
      setError("Select a project before loading saved workflow output.");
      return;
    }
    const built = buildCommunityProjectOutputInput(activeProject);
    if (!built.ok) {
      setError(built.message);
      return;
    }
    if (input !== DEFAULT_PLUGIN_INPUT && !window.confirm(
      "Replace the current extension JSON input with a snapshot of this project's saved workflow output? The extension will receive that snapshot only when you explicitly run it.",
    )) return;

    setInput(built.value.json);
    setInputSource({
      projectId: activeProject.id,
      projectVersion: activeProject.version,
      projectName: activeProject.name,
      sourceView: built.value.sourceView,
      surveyType: built.value.surveyType,
      byteLength: built.value.byteLength,
    });
    setOutputText("");
    setOutputWasTruncated(false);
    setError(null);
    setNotice(`Loaded ${built.value.byteLength.toLocaleString()} bytes of saved ${built.value.surveyType} output as an explicit extension input.`);
  };

  const installPackage = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.metardu.plugins.installPackage();
      if (result.canceled) return;
      setSelectedPackageSha256(result.package.packageSha256);
      setNotice(`${result.package.name} imported locally. Import does not run it; review the publisher claim and licence before use.`);
      await refreshPackages();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const runInstalledPackage = async () => {
    if (!selectedPackageSha256) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setOutputText("");
    try {
      const parsedInput: unknown = JSON.parse(input);
      const result = await window.metardu.plugins.runInstalled({ packageSha256: selectedPackageSha256, input: parsedInput });
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
          Community Extensions
        </h2>
        <div style={{ marginTop: 4, color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>
          Import offline .mdplug packages and run ABI v1 tools with explicit JSON input.
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
          <h3 style={{ margin: 0, color: "var(--text-primary)", fontSize: 13 }}>Installed local packages</h3>
          <button onClick={installPackage} disabled={busy} style={{ marginLeft: "auto", border: "1px solid var(--accent-primary)", borderRadius: 4, padding: "7px 10px", color: "var(--accent-primary)", background: "transparent", cursor: busy ? "wait" : "pointer", fontSize: 11 }}>
            Import .mdplug
          </button>
          <button onClick={() => void refreshPackages().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))} disabled={busy} style={{ border: "1px solid var(--border-default)", borderRadius: 4, padding: "7px 10px", color: "var(--text-secondary)", background: "transparent", cursor: busy ? "wait" : "pointer", fontSize: 11 }}>
            Refresh
          </button>
        </div>
        {packages.length === 0 ? (
          <div style={{ color: "var(--text-tertiary)", fontSize: 11 }}>No packages installed. Importing validates and stores a package without executing it.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {packages.map((pkg) => {
              const selected = pkg.packageSha256 === selectedPackageSha256;
              return (
                <button key={pkg.packageSha256} onClick={() => setSelectedPackageSha256(pkg.packageSha256)} style={{ textAlign: "left", padding: 10, background: selected ? "rgba(59, 130, 246, 0.10)" : "var(--bg-primary)", border: `1px solid ${selected ? "var(--accent-primary)" : "var(--border-subtle)"}`, borderRadius: 4, color: "var(--text-primary)", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700 }}>
                    <FileCode2 size={14} color="var(--accent-primary)" /> {pkg.name} <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>v{pkg.version}</span>
                    <span style={{ marginLeft: "auto", color: "#EAB308", fontSize: 10 }}>Community / Draft</span>
                  </div>
                  <div style={{ marginTop: 5, color: "var(--text-secondary)", fontSize: 10 }}>{pkg.description}</div>
                  <div style={{ marginTop: 5, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 9, overflowWrap: "anywhere" }}>{pkg.id} · publisher claim: {pkg.publisherName} · licence claim: {pkg.licenseId}</div>
                  <div style={{ marginTop: 3, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 9, overflowWrap: "anywhere" }}>Package SHA-256 · {pkg.packageSha256}</div>
                </button>
              );
            })}
          </div>
        )}
        {packageIssues.map((issue, index) => (
          <div key={`${issue.packageSha256 ?? "store"}-${index}`} role="alert" style={{ padding: 8, border: "1px solid #EF4444", borderRadius: 4, color: "#FCA5A5", fontSize: 10, overflowWrap: "anywhere" }}>
            Package store issue{issue.packageSha256 ? ` · ${issue.packageSha256}` : ""}: {issue.message}
          </div>
        ))}
      </section>

      <details style={{ padding: 12, background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", borderRadius: 4 }}>
        <summary style={{ color: "var(--text-secondary)", fontSize: 11, cursor: "pointer" }}>Developer preview · select a raw .wasm module</summary>
        <section style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Boxes size={17} color="var(--accent-primary)" />
          <h3 style={{ margin: 0, color: "var(--text-primary)", fontSize: 13 }}>Temporary raw-module preview</h3>
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

      <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(140px, 1fr)", gap: 10, marginTop: 12 }}>
        <label style={{ color: "var(--text-secondary)", fontSize: 11 }}>
          Claimed plugin ID (unverified)
          <input value={pluginId} onChange={(event) => setPluginId(event.target.value)} maxLength={511} style={{ ...fieldStyle, marginTop: 5 }} />
        </label>
        <label style={{ color: "var(--text-secondary)", fontSize: 11 }}>
          Version
          <input value={version} onChange={(event) => setVersion(event.target.value)} maxLength={64} style={{ ...fieldStyle, marginTop: 5 }} />
        </label>
      </section>
      <button onClick={runModule} disabled={!module || busy} style={{ display: "inline-flex", alignItems: "center", gap: 7, alignSelf: "flex-start", marginTop: 10, border: "none", borderRadius: 4, padding: "9px 14px", background: module && !busy ? "var(--accent-primary)" : "var(--bg-primary)", color: module && !busy ? "var(--bg-primary)" : "var(--text-disabled)", cursor: module && !busy ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 12 }}>
        <Play size={14} /> {busy ? "Running…" : "Run raw module as Community / Draft"}
      </button>
      </details>

      <div style={{ color: "var(--text-secondary)", fontSize: 11 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
          <label htmlFor="community-plugin-json-input">JSON input · maximum 4 MiB</label>
          <button
            type="button"
            onClick={loadActiveProjectOutput}
            disabled={busy || !activeProject || activeProject.output === null || activeProject.output === undefined}
            style={{ marginLeft: "auto", border: "1px solid var(--accent-primary)", borderRadius: 4, padding: "6px 9px", color: "var(--accent-primary)", background: "transparent", cursor: busy ? "wait" : "pointer", fontSize: 10 }}
          >
            Load active project output
          </button>
        </div>
        <div style={{ marginBottom: 7, color: "var(--text-tertiary)", fontSize: 10, lineHeight: 1.45 }}>
          {activeProject?.output !== null && activeProject?.output !== undefined
            ? `Current project: ${activeProject.name}. Load its saved workflow result as a point-in-time input; the project remains unchanged.`
            : "No saved workflow output is available in the active project. Run or open a workflow result first."}
        </div>
        {inputSource && (
          <div role="status" style={{ marginBottom: 7, padding: 8, border: "1px solid var(--border-default)", borderRadius: 4, color: "var(--text-secondary)", lineHeight: 1.45 }}>
            Snapshot loaded from <strong>{inputSource.projectName}</strong> · {inputSource.surveyType} / {inputSource.sourceView} · {inputSource.byteLength.toLocaleString()} bytes.{activeProject?.id !== inputSource.projectId || activeProject.version !== inputSource.projectVersion ? " The active project has changed since this snapshot was loaded." : " This is a point-in-time snapshot."} Only saved workflow output and declared coordinate context are included; coordinate context is not verified, and linked files and point-cloud source bytes are not included.
          </div>
        )}
        <textarea
          id="community-plugin-json-input"
          value={input}
          disabled={busy}
          onChange={(event) => {
            setError(null);
            setNotice(null);
            setInput(event.target.value);
            setInputSource(null);
            setOutputText("");
            setOutputWasTruncated(false);
          }}
          rows={8}
          spellCheck={false}
          style={{ ...fieldStyle, display: "block", marginTop: 5, resize: "vertical", lineHeight: 1.5 }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={runInstalledPackage} disabled={!selectedPackageSha256 || busy} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "none", borderRadius: 4, padding: "9px 14px", background: selectedPackageSha256 && !busy ? "var(--accent-primary)" : "var(--bg-tertiary)", color: selectedPackageSha256 && !busy ? "var(--bg-primary)" : "var(--text-disabled)", cursor: selectedPackageSha256 && !busy ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 12 }}>
          <Play size={14} /> {busy ? "Running…" : "Run selected package"}
        </button>
        <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>Extensions receive only this JSON when you explicitly run them. No live project, linked file, network, database, or instrument access is granted.</span>
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
