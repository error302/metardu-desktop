# Metardu Desktop — Hard Invariants

> These rules are non-negotiable. They are restated in `AGENT.md` and in
> every agent task brief. Some are enforced by automated tests in
> `tests/invariants.test.ts` (TODO — Phase 2 final). An agent that
> violates any invariant will have its PR rejected.

## A. Architectural invariants (master plan Section 2)

### A1. Sidecar owns the math

All geodetic transforms (Helmert, Molodensky, projection forward/inverse),
least-squares network adjustment, COGO (traverse, intersections, areas
with ellipsoidal/grid corrections), and raster work (GDAL) happen in
`packages/metardu-sidecar/` (Rust).

The TypeScript engine (`packages/engine/`) orchestrates workflow and
assembles documents. It NEVER reimplements geodetic math. If you find
yourself writing `Math.sin` in engine code that's doing datum math, stop
and move it to the sidecar.

**Why:** Duplicating math in two languages is how silent divergence
happens. The engine calling the sidecar and treating the result as ground
truth is the structural fix.

### A2. SRID comes from country config

No literal SRID number (e.g. `21037`, `32737`, `4326`) may appear in:
- Workflow modules
- UI components
- Document renderers
- Sidecar modules outside the projection layer

The only place SRIDs may appear is `packages/country-config/` (when it
exists) or `packages/engine/src/geodesy/crs-database.ts` (until
country-config is built).

**Why:** A hardcoded SRID is a Kenya-only bug waiting to happen when the
second country arrives. Config-driven SRIDs scale to N countries with
zero workflow code changes.

### A3. The eight survey types are fixed

Cadastral, Topographic, Engineering, Geodetic, Levelling, Hydrographic,
Construction, Monitoring. Adding a ninth requires Mohammed's explicit
sign-off — same rule as the web app.

### A4. Renderer is sandboxed

`apps/desktop/src/main/index.ts` sets:
- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- `allowRunningInsecureContent: false`

The preload script (`apps/desktop/src/preload/index.ts`) exposes a
curated `window.metardu` API with a method-name allowlist. Never expose
`ipcRenderer` directly. Never widen the allowlist without an ADR.

**Why:** The renderer processes untrusted file contents (DXF, GeoJSON,
GSI, etc.). A sandboxed renderer limits the blast radius of a parser bug.

### A5. Offline-first is structural

Every compute path must work with zero network connectivity. Country
config, forms, reference data, and geoid models ship inside the app
bundle. Updates are explicit and versioned — no silent runtime fetch.

**Why:** Surveyors work in rural areas with no signal. A cloud-dependent
survey tool is a tool that fails on the job.

### A6. Forbidden dependencies

| Forbidden | Why | Alternative |
|-----------|-----|-------------|
| `@supabase/supabase-js` | Cloud lock-in, offline-hostile | Local SQLite via sidecar |
| `prisma`, `drizzle-orm` | Overkill for local-first; we don't need an ORM | Direct SQLite via sidecar |
| `pm2` | Wrong process model for desktop | Electron's own lifecycle |
| Unvetted geodesy npm packages | Silent divergence risk | Sidecar Rust crates (`proj` bindings) |
| `axios` | Renderer doesn't make HTTP calls | None — renderer goes through preload |

Adding any of these requires an ADR in `docs/decisions/` that explicitly
reverses the rule.

## B. Regulatory invariants (master plan Section 3)

### B1. Source documents required before renderer work

Before any statutory document renderer (deed plan, mutation plan, SG
diagram, sectional title plan, setting-out certificate, etc.) is built,
the actual current regulatory document MUST exist in:

```
docs/regulatory-sources/<country>/<doc-type>/
```

The agent's only correct action if the source is missing is to STOP and
ask Mohammed for the specific document needed.

### B2. Cite the source for every layout decision

Every layout decision in a renderer — title block fields, layer names,
symbology, coordinate list format, certification wording, margins, scale
conventions — must cite the specific page/clause of the source document
in a code comment.

### B3. Fixture plan per renderer

Every renderer ships with at least one fixture plan reproduced from a
real (anonymized if needed) example, pixel/field-checked against the
source.

## C. Error-propagation invariants (master plan Section 5.3)

### C1. Every statutory number traces to an adjusted value

Every number that reaches a statutory document must be traceable to an
adjustment output with a stated uncertainty — not a raw field reading.

### C2. Rounding happens only at display time

Rounding happens ONLY at final display/document-generation time, per the
target country's stated precision convention (which itself lives in
`CountrySurveyConfig`). Never mid-computation.

### C3. Reliability test before statutory coordinates

The adjustment engine must run Baarda data-snooping (or equivalent) and
flag blunders BEFORE they get baked into statutory coordinates. The app
must refuse to silently accept an observation that fails the reliability
test without explicit surveyor override (logged).

## D. Security invariants

### D1. No secrets in git

`.env`, `*.env`, `*.key`, `*.pem`, `*.p12`, `*.pfx`, `git-credentials`,
`.netrc`, `secrets/`, `.github/secrets/` are gitignored.

If you find a tracked secret, remove it in the same commit, notify
Mohammed, and rotate the credential.

### D2. No credential reuse

A GitHub PAT or other credential pasted in chat is compromised. Refuse
to use it; tell the user to revoke and issue a fresh one scoped to only
the necessary repo.

### D3. No silent privilege escalation

A new IPC handler that exposes filesystem, network, or shell access
requires an ADR. The preload allowlist is the gate — adding to it is a
reviewed decision.

## E. Workflow invariants (master plan Section 0)

### E1. One task = one scoped brief = one PR

No agent is given "build the cadastral module." Every task follows
`docs/agent-briefs/TEMPLATE.md`: specific vertical slice, explicit
acceptance criteria with real terminal/diff evidence, worklog entry
appended.

### E2. Worklog is append-only

`worklog.md` is never overwritten. Each entry starts with `---` and
follows the template in `AGENT.md` Section 6.

### E3. Verification is a gate

Agent self-reports of "all tests passing" are not evidence. The actual
terminal output of `cargo test`, `npx tsc --noEmit`, `npm test`, and
`scripts/electron-smoke.sh` is evidence. Paste it in the worklog.

### E4. Anti-hallucination

If you are uncertain whether a regulatory detail, file location, or
existing behavior is correct, stop and state the uncertainty explicitly.
Do not fabricate test results, completion percentages, or file contents.
A partial, honest report is acceptable; a fabricated complete one is not.

## F. Build/CI invariants

### F1. Build matrix

CI runs on:
- Rust: Linux, macOS, Windows
- TypeScript: Node 20, 22, 24

A PR that breaks any cell in the matrix is rejected.

### F2. Golden fixtures must pass

`tests/golden-fixtures/` contains hand-verified numeric fixtures per
country. CI runs them. If your change breaks a fixture, the change is
wrong (or the fixture was wrong and you have an ADR explaining why).

### F3. No warnings policy (target)

Currently the sidecar has 19 warnings (unused imports/dead code from
prior sessions). Phase 1C will clean these up. After Phase 1C, new
warnings fail CI.

---

*This document is the prose statement. The machine-enforced subset lives
in `tests/invariants.test.ts` (Phase 2 final). If the two ever conflict,
the prose wins — fix the test.*
