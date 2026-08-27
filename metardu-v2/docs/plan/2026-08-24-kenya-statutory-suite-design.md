# Kenya Statutory Suite — Form 4, LRA-27, Beacon Certificate — Design

**Date:** 2026-08-24
**Status:** Approved by Mohammed (approach B — all three documents as [HK]-flagged DRAFTs)
**Track:** Statutory forms end-to-end (user-selected priority)
**Repo:** metardu-desktop (`metardu-v2/` is project root)

---

## 0. Problem statement

Kenya's statutory renderer suite ships exactly one document: Form 3 (Deed Plan),
built end-to-end from filed sources (`documents/form-3.ts`, verified per
`docs/regulatory-sources/kenya/cadastral/SOURCE-VERIFICATION.md`). Three further
declared statutory documents have no renderer:

| Document | country-config `docType` | Literal specimen on disk? |
|---|---|---|
| Mutation Plan | `Form 4` | No — config cites `survey-act-cap-299-form-4.pdf`, which does not exist |
| Mutation administrative form | (not declared) `LRA-27` | **Yes** — `kenya/forms/form-lra-27-mutation-form.doc` (real template, structure recoverable) |
| Beacon Certificate | `Beacon Certificate` | No — config cites `survey-regulations-1994.pdf`, which does not exist under that name |

Additionally, several Kenya statutory `sourcePath` citations in
`packages/country-config/src/countries/kenya.ts` point at files that do not exist
on disk (citation drift). Nothing fails when citations drift — that gap is fixed
here permanently.

Per invariant B1/B7 we do not guess at regulatory formats. The user has explicitly
chosen approach B: build all three documents now from the best available filed
sources, mark every unverifiable layout decision `[HK]` (human-in-the-loop check by
a licensed surveyor), and render a DRAFT watermark on every produced PDF until
literal specimens are filed and eye-checked.

---

## 1. Source basis (verified on disk, text-extracted 2026-08-24)

### Primary (filed)
1. **Survey Act Cap. 299 (Rev. 2012)** — `docs/regulatory-sources/kenya/cadastral/survey-act-cap-299-revised-2012.pdf`
   - s.24: boundary marks must be shown on the plan.
   - s.27: grantee's duty to ascertain survey marks are in place; procedure if marks cannot be found. *(This is the operational gap a Beacon Certificate serves.)*
   - s.28–29: protection of survey marks; penalty for tampering.
   - s.30: all survey plans/records deposited with the Director.
   - s.32: no land deemed surveyed until plan authenticated (Director/Government surveyor signature).
   - s.41: provisions regarding authenticated plans.
   - s.45(1)(c): regulation power over "nature, form and dimensions of survey marks".
2. **Kenya Gazette — Survey Regulations 1994** — `docs/regulatory-sources/kenya/cadastral/kenya-gazette-survey-regulations-1994.pdf` (OCR quality poor; cited where legible).
3. **Form LRA-27 mutation form (.doc)** — `docs/regulatory-sources/kenya/forms/form-lra-27-mutation-form.doc`
   - Recovered header: "Form LRA-27 (r. 43(2(b), 44(2)(f), 45(2)(e))", Republic of Kenya, Land Registration Act, Land Registration (General) Regulations, 2017.
   - "MUTATION FORM (This form is to be completed in triplicate.)"
   - Part A: Title Details and Registered Proprietor(s) instructions to the Surveyor; TITLE NUMBER(S); presentation-book/fees receipt block.
   - Surveyor certification ("prepared in accordance with the Survey Act and Survey Regulations…"), proprietor section(s), Land Registrar signature + seal block.
4. **Working diagrams** — `docs/regulatory-sources/kenya/reference/4-acres-working-diagram.pdf`, `5-acres-working-model.pdf` (real Kenyan plan layout conventions; same basis used for Form 3's plan-area conventions).

### Secondary (cited with caveat)
5. **Cadastral Survey Guidelines V6.0 (2023)** — §14 marking requirements. CAUTION:
   §14 contains borrowed NSW drafting (MGA2020, ICSM SP1 references). Cite only as
   secondary descriptive support, never as Kenyan statutory authority.

### Not available (drives [HK] flags + DRAFT watermarks)
- Literal Form 4 specimen/template.
- Literal Beacon Certificate specimen.
- Sectional Properties Act 2020 (out of scope this task; listed in BLOCKED-SOURCES.md).

---

## 2. Deliverables

1. `packages/engine/src/documents/form-4.ts` — Mutation Plan renderer (PDF + DXF companion).
2. `packages/engine/src/documents/lra27-mutation.ts` — LRA-27 Mutation Form renderer (PDF).
3. `packages/engine/src/documents/beacon-certificate.ts` — Beacon Certificate renderer (PDF).
4. Spec docs (invariant B2):
   - `docs/regulatory-sources/kenya/cadastral/form-4-spec.md`
   - `docs/regulatory-sources/kenya/forms/lra27-spec.md`
   - `docs/regulatory-sources/kenya/cadastral/beacon-certificate-spec.md`
5. Appendices to `SOURCE-VERIFICATION.md` mapping every rendered element → source → `[HK]` flag state.
6. Country-config citation fixes + permanent B1 guard test.
7. IPC + preload wiring; DeedPlanView extended into a tabbed Statutory Documents view.
8. `docs/BLOCKED-SOURCES.md` — exact files Mohammed must file to lift each DRAFT.
9. Tests + golden fixtures; verbatim verification output appended to `worklog.md`.

---

## 3. Honesty policy (watermarks + [HK])

- Every layout decision carries a code comment citing its source (invariant B2 pattern from `form-3.ts`).
- Decisions with no filed basis are marked `[HK-PENDING-SPECIMEN]` and enumerated in the relevant spec doc.
- Every generated PDF renders:
  - A diagonal **DRAFT** watermark (opacity ~0.15, matching Form 3's historical level).
  - A verification footer: "DRAFT — pending specimen filing and licensed-surveyor verification ([HK]: N items). See <spec-doc-path>."
- Watermark removal conditions (future task, not this one): literal specimen filed at the cited sourcePath + SOURCE-VERIFICATION appendix completed + licensed-surveyor sign-off recorded.
- Guidelines §14 is never cited alone for a Kenyan requirement.

---

## 4. Architecture

Follows the locked architecture (ADR-0001): renderers live in the TypeScript engine;
no sidecar changes; no new dependencies beyond what `form-3.ts` already uses (pdf-lib,
@tarikjabiri/dxf).

```
packages/engine/src/documents/
├── form-4.ts                  # Form4Input → { pdfBytes, ... } (+ DXF via dxf-output helpers)
├── lra27-mutation.ts          # Lra27Input → { pdfBytes, ... }
├── beacon-certificate.ts      # BeaconCertificateInput → { pdfBytes, ... }
└── tests/{form-4,lra27-mutation,beacon-certificate}.test.ts
```

- Shared geometry/text helpers are reused from `form-3.ts` exports where they are
  trivially identical (bearingDMS, distanceM, parcelBounds, scale selection per
  Survey Regs 1994 §6.3). No refactor of `form-3.ts` internals — risk stays zero
  for the one verified renderer.
- Form 4's DXF reuses `generateForm3Dxf` machinery (`dxf-output.ts`) with
  mutation-specific layers (parent boundary dashed, new parcels solid).
- SRIDs come from country-config (invariant A2). This task also removes the
  hardcoded `21037` in `DeedPlanView.tsx` (renderer reads from config).

---

## 5. Data models

```ts
// form-4.ts
interface Form4ParentParcel {
  lrNumber: string;            // parent title, e.g. "LR KIAMBU/RIRUTA/247/15"
  beacons: Form3Beacon[];      // reused shape from form-3.ts
}
interface Form4NewParcel {
  lrNumber: string;            // new number assigned by registry (may be blank pre-lodgement)
  beacons: Array<{ label; position: { easting; northing }; description }>;
}
interface Form4Input {
  county: string;
  subCounty: string;
  parentParcel: Form4ParentParcel;
  newParcels: Form4NewParcel[];        // ≥1; subdivision/mutation scheme
  mutationReason: string;              // e.g. "Subdivision", "Boundary rectification"
  areaHaByParcel: Record<string, number>; // computed upstream (Shoelace) — engine recomputes and cross-checks
  srid: number;                        // from country-config
  surveyor: Form3Surveyor;             // reused shape
}
interface Form4Output {
  pdfBytes: Uint8Array;
  hasDraftWatermark: true;             // literal type while specimens unfiled
  hkItemCount: number;
  areasCrossChecked: boolean;          // input vs recomputed Shoelace agreement flag
}

// lra27-mutation.ts
interface Lra27Input {
  titleNumbers: string[];              // "TITLE NUMBER(S)" field (plural per .doc)
  registry: string;                    // land registry
  proprietors: Array<{ name: string; idNumber?: string; share?: string }>;
  instructionsToSurveyor: string;      // Part A proprietor instructions
  newParcelsSchedule: Array<{ lrNumber: string; areaHa: number }>;
  surveyor: { name: string; regNumber: string; date: string };
  serialNo?: string;                   // "Mutation Form Serial No."
}
interface Lra27Output { pdfBytes: Uint8Array; hasDraftWatermark: true; hkItemCount: number; }

// beacon-certificate.ts
interface BeaconCertificateInput {
  beacon: {
    label: string;
    position: { easting: number; northing };
    markType: string;                  // e.g. "Concrete pillar", "Iron pin" (Regs-derived vocabulary)
    description: string;
  };
  parcelRef: string;                   // LR number / title
  ownerName?: string;
  srid: number;
  surveyor: Form3Surveyor;
}
interface BeaconCertificateOutput { pdfBytes: Uint8Array; hasDraftWatermark: true; hkItemCount: number; }
```

Validation (fail fast, reuse `workflows/validation.ts` validators): ≥3 beacons per
polygon, positive area, ISK format `/^LS\/\d{3,5}$/i`, finite coordinates, non-empty
strings, valid SRID.

---

## 6. UI & IPC

- `DeedPlanView.tsx` gains a document-type selector: **Form 3 | Form 4 | LRA-27 | Beacon Certificate**.
  - Shared across tabs: beacon coordinate table, SurveyCanvas, signing panel, export status.
  - Per-tab field panels: Form 4 (parent/new parcels, mutation reason), LRA-27 (titles, registry,
    proprietors, instructions), Beacon Certificate (single-beacon picker from the table + mark type).
  - View header/title updates per active document type.
- New IPC channels in `apps/desktop/src/main/index.ts`, mirroring `metardu:form3:generate`:
  `metardu:form4:generate`, `metardu:lra27:generate`, `metardu:beaconcert:generate`.
- Preload bridge additions in `apps/desktop/src/preload/index.ts` (typed, allowlisted):
  `form4.generateForm4Pdf`, `lra27.generateLra27Pdf`, `beaconCert.generateBeaconCertificatePdf`.
- Signing button signs whichever document is active (existing RSA-2048 path unchanged).

---

## 7. Country-config fixes + B1 guard

- Fix stale paths in `countries/kenya.ts`:
  - Form 3 `sourcePath` → `docs/regulatory-sources/kenya/cadastral/survey-act-cap-299-revised-2012.pdf`
  - Beacon Certificate → `docs/regulatory-sources/kenya/cadastral/kenya-gazette-survey-regulations-1994.pdf`
  - Form 4 → `docs/regulatory-sources/kenya/cadastral/survey-act-cap-299-revised-2012.pdf` (specimen still pending; tracked in BLOCKED-SOURCES.md)
- New test `tests/statutory-source-paths.test.ts` (workspace `tests/` package):
  iterates every country config's `statutoryDocuments[]` and enforces:
  **if a document claims its source is filed, the file must exist on disk.**
- To make filing state machine-readable, add an optional field to
  `StatutoryDocSpec` (`packages/country-config/src/types.ts`):
  `sourceFiled?: boolean` (default `false`). The guard asserts
  `resolveRepoRoot(sourcePath)` exists whenever `sourceFiled === true`.
  Kenya's Form 3 becomes the first `sourceFiled: true` entry (Act filed,
  SOURCE-VERIFICATION.md completed); all other declared documents remain
  `false` until Mohammed files specimens — at which point flipping the flag
  without the file fails CI. This also gives future renderers a config-driven
  DRAFT-watermark trigger instead of hardcoded booleans.

---

## 8. Testing strategy

Per renderer (~12 tests each):
- Input validation (happy path, <3 beacons, bad ISK, non-finite coords, empty strings).
- PDF generation returns bytes; pypdf-verifiable metadata (Title/Author/Subject) mirrors `form-3.test.ts` patterns.
- DRAFT watermark present (`hasDraftWatermark === true`) + `[HK]` count > 0.
- ASCII-only output for standard fonts (per invoice-pdf sanitization precedent).
- Form 4: area cross-check logic (input vs recomputed Shoelace mismatch → flagged, not fatal).
- Form 4 DXF: layer presence (PARENT-BOUNDARY, NEW-PARCEL, BEACON, TEXT-COORDS), round-trip parse.
- Golden fixtures committed: `form4-sample.pdf`, `lra27-sample.pdf`, `beacon-cert-sample.pdf` metadata snapshots (JSON, not binaries, consistent with existing fixture style).

Regression gates (AGENT.md §4): full engine suite green, `tsc --noEmit` clean in
engine + apps/desktop, cargo untouched (no sidecar changes). Verbatim output pasted
into `worklog.md`.

---

## 9. Out of scope (Part A)

- Sectional Properties Act 2020 (unfiled — listed in BLOCKED-SOURCES.md).
- Non-Kenya statutory renderers — **moved to Part B below** (see §11–18).
- Removing any DRAFT watermark (requires specimens + human sign-off).
- Refactoring `form-3.ts` internals beyond minimal shared helpers.

---

## 10. Acceptance criteria (Part A)

1. Three Kenya renderers generate valid PDFs (pypdf opens them; expected metadata present).
2. Every rendered element traces to a cited source or carries `[HK-PENDING-SPECIMEN]`.
3. All three PDFs show the DRAFT watermark + verification footer.
4. DeedPlanView produces all four Kenya document types through the Electron IPC chain.
5. `StatutoryDocSpec.sourceFiled` exists; the sourcePath existence test passes
   (Kenya Form 3 claims filing and its file exists; all unfiled docs declare `false`).
6. Full test suites pass with verbatim evidence in `worklog.md`; zero tsc errors.
7. BLOCKED-SOURCES.md lists precisely which user-supplied files lift each remaining block.

---

# PART B — Four-Market Completion: AU, UK, ZA, DE

**Added:** 2026-08-25 per user request "fix to completion" for Australia (NSW), United Kingdom, South Africa, Germany.
**Principle:** Same honesty policy as Part A — DRAFT flags where sources are unfiled; nothing ships as lodgement-ready without a filed specimen and licensed-surveyor sign-off.

## 11. Problem statement (Part B)

The app declares AU/UK/ZA/DE in `country-config` and integration exporters, but every user-visible workflow is still Kenya-locked:

- `DeedPlanView.tsx:239,332` hardcodes `srid: 21037`; `:135-137` `isValidISK` regex `/^LS\/\d{3,5}$/i`; `:375-376` signing attests `ISK/Kenya`; `:393` saves as `"KE"` — entire statutory flow unusable outside Kenya (P0 blocker).
- Sidecar `geodesy/mod.rs` + `compute_handlers.rs:45-49` knows only `WGS84/CLARKE_1866/GRS80` — GB `Airy 1830` and DE `Bessel 1841` calls fail with `InvalidParams`.
- `crs-database.ts:408-420` maps 11 ISO3 keys but has no `ZA`/`DE` zones; ZA Lo belts `19/21/23/25/33` and DE `GK 2/4/5 + UTM 31N` incomplete.
- DXF/QGS/PyQGIS fall back to Kenya names/symbology for AU/ZA/DE with a warning — not country-correct.
- `LULCView.tsx` hardcoded `UTM 37S (Arc 1960)` + Kenya NLC categories; `fee-scales.ts` Kenya KES only; `project-templates.ts` 6 templates hardcode `ISK`; `MapView.tsx:165` Nairobi center.
- No golden fixtures for AU/GB/ZA/DE; DHDN rotation-sign TODO (`germany.ts:265-268`) unverified; OSTN15/NTv2 grids not vendored.

"Completion" means: every P0/P1 gap fixed so a surveyor in Sydney, London, Johannesburg, or Berlin can run a real workflow without hitting a Kenya string, a wrong SRID, or a failed ellipsoid — and sees exactly where statutory output remains DRAFT.

## 12. Deliverables (Part B)

1. **Sidecar geodetic completion (P0):**
   - Add `Airy 1830` (`a 6377563.396, rf 299.3249646`) and `Bessel 1841` (`a 6377397.155, rf 299.1528128`) to `geodesy/mod.rs:40-64` `datums` and wire into `compute_handlers.rs:43-52` `lookup_ellipsoid`.
   - Verify `germany.ts:265-268` DHDN→ETRS89 rotation-sign convention against `helmert.rs:13-33` (EPSG 9606 Position Vector vs 9607 Coordinate Frame); fix if inverted; add control-point test.
2. **Config + CRS DB:**
   - Optionally add missing Lo belts / GK zones if trivial (data-only; no logic), or document as intentional scope limit in spec.
   - Expand `engine/src/geodesy/crs-database.ts:408-420` to register ZA (`2051-2055`) + DE (`25832/25833/31467`) zones so `findCrsForLocation()` resolves them; add to `listSupportedCountries()`.
3. **View country-awareness (P0/P1):**
   - Refactor `DeedPlanView.tsx` to accept `countryCode` (default from project/context), read `primarySRID`, `registrationPattern`, `professionalBody`, `planSheet` from country-config; derive ISR reg validation from `CountrySurveyConfig.professionalBody.registrationPattern`; drive signing attestation + CRS display + `setSurveyOutput` country code from config. Remove all 11 Kenya literals inventoried in audit §3.
   - Make `LULCView.tsx`, `MapView.tsx`, `project-templates.ts`, `fee-scales.ts` country-aware (category sets, map center, templates, fee scales branch on `countryCode` — Kenya categories remain default with AU/GB/ZA/DE stubs where filed sources allow, otherwise honest "Kenya categories shown — AU/GB/ZA/DE pending filed NLC equivalents" note).
   - Fix `landxml-export.ts` to derive SRID from `country-config` like every other exporter (remove default `"KE"`).
4. **Exporters — country-correct CAD/QGIS (P2 with P0 correctness):**
   - `dxf-export.ts`: add AU (`NSW LRS` layer names from `australia.ts:174-183` `dxfLayers`), ZA (`SAGC` SG Diagram layers), DE (`AdV` Grenzfeststellung layers) specs to `getCountryDxfLayerSpecs` — if a market's regulatory layer names are unfiled, emit generic `SURV-` names with a warning (same DRAFT honesty as Part A), not a Kenya lie.
   - `qgs/pyqgis`: add per-market symbology stubs (AU yellow/black NSW LRS, ZA red SG Diagram, DE black Grenzfeststellung) with fallback warning until filed specs arrive.
5. **Statutory DRAFT renderers (P1, honest):**
   - One DRAFT PDF per flagship doc, each flagged `[HK-PENDING-SPECIMEN]` where unfiled:
     - AU — Plan of Survey (NSW LRS Deposited Plan, A1 landscape, GDA2020/MGA, `planSheet` from `australia.ts:290-334`).
     - ZA — SG Diagram (A1 portrait, Hartebeesthoek94/Lo, `south-africa.ts` sheet).
     - GB — Measured Survey Report wrapper (RICS Measured Surveys 3rd ed. — report cover + plan area; HMLR Title Plan remains HMLR-produced per readiness §6 note, so report is the surveyor deliverable).
     - DE — Grenzfeststellung record (A4, ETRS89/UTM, AdV framework note).
   - Each follows the Part-A honesty policy: DRAFT watermark, verification footer, spec doc, SOURCE-VERIFICATION appendix.
6. **Golden fixtures (P1 correctness):**
   - `tests/golden-fixtures/{au,gb,za,de}/` — one TM forward/inverse round-trip per market (Sydney MGA 56, London BNG, Pretoria Lo27, Berlin UTM 32N) verified against EPSG guidance / published control.
   - `tests/{au,gb,za,de}-golden-fixtures.test.ts` harness mirroring `kenya-golden-fixtures.test.ts`.
7. **Spec + docs:**
   - `docs/regulatory-sources/{australia,uk,za,de}/*-spec.md` (four specs, invariant B2; each page cites filed or explicitly `[HK]`-flagged content).
   - Update `docs/STATUTORY-RENDERER-READINESS.md` readiness matrix to reflect new state.
   - `docs/BLOCKED-SOURCES.md` extended with precise per-market unblock checklists (same source as readiness §3-7 checklists).

## 13. Architecture (Part B)

No architecture change — same locked split (ADR-0001). Sidecar additions are data-only (two ellipsoid constants + Helmert sign check); no new crates. Engine renderers reuse `form-3.ts` helpers (bearingDMS, distanceM, parcelBounds, scale selection) — AU/ZA/GB/DE specs supply their own scale/margin/title-block values from country-config `planSheet`.

```
packages/metardu-sidecar/src/geodesy/
├── mod.rs            + Airy1830, Bessel1841 datums
└── (no new files)

packages/engine/src/documents/
├── au-plan-of-survey.ts        # AU DP renderer (DRAFT)
├── za-sg-diagram.ts            # ZA SG Diagram renderer (DRAFT)
├── gb-measured-survey-report.ts
├── de-grenzfeststellung.ts
└── tests/{au-*,za-*,gb-*,de-*}.test.ts
```

Country-awareness plumbing reuses existing `TopographicView` pattern (`COUNTRY_OPTIONS` + `getCountryOption(countryCode).config`) — no new state primitive.

## 14. Honesty policy (Part B)

Identical to Part A §3, with explicit per-market caveats surfaced in both spec docs and PDF footers:

- GB `ETRS89→OSGB36` coarse Helmert vs OSTN15 grid — footer notes "Coordinates use Helmert approximation; survey-grade requires OSTN15 grid (EPSG:9704) — pending sidecar proj bindings (Phase 4B)" until grid vendored.
- DE `DHDN→ETRS89` rotation-sign TODO — footer notes pending verification; block removal tracked in spec.
- All four statutory PDFs carry DRAFT until literal templates filed under their `sourcePath` and licensed-surveyor eye-checked.

## 15. Testing strategy (Part B)

- Sidecar: 2 new Rust tests for Airy/Bessel ECEF round-trip + 1 for DHDN sign convention (control point).
- Engine: ~10 tests per statutory DRAFT renderer (validation, PDF metadata, DRAFT flag, ASCII-only, SRID from config not literal); B1 guard test extended via `sourceFiled` flag (§7) now covers AU/GB/ZA/DE as `false`.
- Golden fixtures: 4 new TM fixtures + harness tests (total 4 fixtures × forward+inverse = 8 numeric assertions).
- View tests: DeedPlanView country-switch test (select AU → SRID 7856 + CSPS pattern; select ZA → SRID 2053 + PLATO pattern; etc.).
- Regression gates: same as Part A §8 (full engine suite, tsc clean, cargo clean — no regressions for Kenya).

## 16. Out of scope (Part B)

- Sectional plans for any market (still gated on filed sectional acts; `workflows/sectional.ts:sourceFiled` remains false).
- Vendoring OSTN15 / BETA2007 / CSG NTv2 grids (Phase 4B; tracked as TODO — honesty footer suffices for DRAFT).
- Full VIC/QLD/WA or DE Bundesland fragmentation (NSW + 32N remain the scoped firsts).
- Removing any DRAFT watermark.

## 17. Sequencing (recommended build order)

1. Sidecar ellipsoids + DHDN sign check + CRS DB expansion (unblocks all numeric work).
2. DeedPlanView + landxml + LULC/MapView/template/fee country-awareness (unblocks user-visible workflows).
3. DXF/QGS/PyQGIS country-correct layers (unblocks deliverables).
4. Four statutory DRAFT renderers + specs + golden fixtures (unblocks "statutory" claim).
5. Docs/BLOCKED-SOURCES/general polish; final verification.

Each step ships independently — no step depends on a later one's source filings.

## 18. Acceptance criteria (Part B)

1. `DeedPlanView` with `countryCode="AU"` shows `EPSG:7856`, validates `CSPS/1234`, signs as `SSSI/Australia`; `"GB"` shows `EPSG:27700`, validates 7-digit RICS, signs as `RICS/UK`; `"ZA"` shows `EPSG:2053`, validates `PLATO/...`; `"DE"` shows `EPSG:25832`, validates ÖbVI. No Kenya literal appears when those codes selected.
2. Sidecar `lookup_ellipsoid("Airy 1830")` and `("Bessel 1841")` succeed; Helmert/ECEF/TM round-trip tests pass for all four markets against golden fixtures (≤1 mm).
3. `findCrsForLocation()` resolves ZA/DE zones; exporters called with those country codes emit correct `urn:ogc:def:crs:EPSG::*` without literals.
4. DXF/QGS/PyQGIS exports for AU/GB/ZA/DE emit country-named layers/symbology (or honest generic warning if regulatory names unfiled) — no Kenya names leak.
5. Four statutory DRAFT PDFs generate, each with correct sheet size/orientation/title-block from country-config `planSheet`, DRAFT watermark, `[HK]` footer, and spec doc.
6. Germany DHDN rotation-sign TODO resolved or explicitly preserved with honest footer.
7. `tests/statutory-source-paths.test.ts` passes with `sourceFiled` gating across all 8 markets.
8. Full suites green, zero tsc errors, verbatim evidence in `worklog.md`.
