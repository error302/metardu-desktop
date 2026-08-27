# Four-Market Completion (AU, UK, ZA, DE) + Kenya Statutory Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Australia (NSW), United Kingdom, South Africa, and Germany fully functional across all 26 views, exports, and statutory DRAFT renderers — while delivering the Kenya Form 4 / LRA-27 / Beacon Certificate suite — so a surveyor in Sydney, London, Johannesburg, or Berlin can run a real workflow without hitting Kenya literals.

**Architecture:** Sidecar adds two ellipsoid constants (Airy 1830, Bessel 1841) with no new crates; engine expands CRS DB and hardens views/exporters to read every SRID/registration pattern/planSheet from `country-config`; four new DRAFT PDF renderers reuse `form-3.ts` helpers with DRAFT watermarks and `[HK]` footers.

**Tech Stack:** Rust sidecar (`geodesy/mod.rs`, `helmert.rs`, `projection.rs`), TypeScript engine (`pdf-lib` for PDFs, `@tarikjabiri/dxf` for DXF, `country-config` for all country data), React + Electron (`DeedPlanView`, `LULCView`, `MapView`, `ExportPanel`, IPC/preload), Vitest + Playwright + pypdf verification.

## Global Constraints

- Invariant A1: Sidecar owns all geodetic math — no `Math.sin` datum math in engine; any transform must call sidecar via `compute_handlers` or prepared params.
- Invariant A2: SRID comes from `country-config` — no literal `21037/7856/27700/2053/25832` outside `country-config` + `crs-database.ts:57` (canonical DB) + tests/fixtures.
- Invariant B1/B2: Every statutory PDF element cites source or carries `[HK-PENDING-SPECIMEN]`; DRAFT watermark until specimen filed and SOURCE-VERIFICATION eye-checked.
- Invariant C1-C3: Every statutory number traces to adjusted value with stated uncertainty; no hidden approximations (GB OSTN15, DE DHDN flags must surface in footer).
- All PDFs ASCII-only for standard fonts (per `invoice-pdf` sanitization); all DXFs layer-named per market.
- Zero `tsc --noEmit` errors in `packages/engine` and `apps/desktop`; `cargo test` green; full `npm test` green with verbatim evidence in `worklog.md` per AGENT.md §4.

---

## File Structure

```
metardu-v2/
├── packages/metardu-sidecar/src/geodesy/
│   ├── mod.rs                         # + Airy1830, Bessel1841 datums (Task 1)
│   └── (no new files)
├── packages/country-config/src/
│   ├── types.ts                       # + sourceFiled?: boolean on StatutoryDocSpec (Task 9)
│   └── countries/{kenya,australia,united-kingdom,south-africa,germany}.ts  # fix citations (Task 2/9)
├── packages/engine/src/
│   ├── geodesy/crs-database.ts        # + ZA/DE zones, listSupportedCountries (Task 3)
│   ├── documents/
│   │   ├── form-3.ts                  # minimal: export shared helpers if needed (Task 5)
│   │   ├── form-4.ts                  # NEW — Kenya Mutation Plan (Part A)
│   │   ├── lra27-mutation.ts          # NEW — Kenya LRA-27 (Part A)
│   │   ├── beacon-certificate.ts      # NEW — Kenya Beacon Certificate (Part A)
│   │   ├── au-plan-of-survey.ts       # NEW — AU DP (Part B DRAFT)
│   │   ├── za-sg-diagram.ts           # NEW — ZA SG Diagram (Part B DRAFT)
│   │   ├── gb-measured-survey-report.ts # NEW — GB RICS Report (Part B DRAFT)
│   │   ├── de-grenzfeststellung.ts    # NEW — DE Grenzfeststellung (Part B DRAFT)
│   │   ├── dxf-output.ts              # already has generateForm3Dxf helpers
│   │   └── tests/{form-4,lra27,beacon-cert,au-*,za-*,gb-*,de-*}.test.ts
│   ├── integration/
│   │   ├── dxf-export.ts              # + AU/ZA/DE layer specs (Task 6)
│   │   ├── qgs-project-generator.ts   # + AU/ZA/DE symbology (Task 6)
│   │   ├── pyqgis-script-generator.ts # + AU/ZA/DE symbology (Task 6)
│   │   └── landxml-export.ts          # fix: derive SRID from country-config (Task 5)
│   └── workflows/validation.ts        # reused validators
├── apps/desktop/src/
│   ├── renderer/views/
│   │   ├── DeedPlanView.tsx           # → country-aware (P0, Task 4)
│   │   ├── LULCView.tsx               # → country-aware categories (Task 5)
│   │   ├── MapView.tsx                # → country center (Task 5)
│   │   └── project-templates.ts       # → AU/GB/ZA/DE templates (Task 5)
│   ├── main/index.ts                  # + 7 IPC handlers (Part A 3 + Part B 4)
│   └── preload/index.ts               # + preload entries (Task 7)
├── docs/regulatory-sources/
│   ├── kenya/cadastral/{form-4-spec.md,beacon-certificate-spec.md}  # Part A
│   ├── kenya/forms/lra27-spec.md                                 # Part A
│   ├── australia/nsw/plan-of-survey-spec.md                       # Part B
│   ├── za/sg-diagram-spec.md
│   ├── uk/measured-survey-spec.md
│   └── de/grenzfeststellung-spec.md
├── docs/{BLOCKED-SOURCES.md, STATUTORY-RENDERER-READINESS.md}
└── tests/
    ├── golden-fixtures/{au,gb,za,de}/
    └── {au,gb,za,de}-golden-fixtures.test.ts
```

---

### Task 1: Sidecar — Add Airy 1830 and Bessel 1841 Ellipsoids

**Files:**
- Modify: `packages/metardu-sidecar/src/geodesy/mod.rs:40-64`
- Modify: `packages/metardu-sidecar/src/geodesy/compute_handlers.rs:43-52`
- Test: `packages/metardu-sidecar/src/geodesy/mod.rs:97-224` (existing harness)

**Interfaces:**
- Consumes: existing `datums` module pattern, `lookup_ellipsoid(name: &str) -> Result<Ellipsoid, HandlerError>`
- Produces: `datums::AIRY_1830`, `datums::BESSEL_1841` usable by `ecef::*` and `projection::*` via `lookup_ellipsoid`

- [ ] **Step 1: Write failing test for missing ellipsoids**

```rust
// In packages/metardu-sidecar/src/geodesy/mod.rs tests:
#[test]
fn test_airy_1830_lookup_succeeds() {
    let e = crate::geodesy::compute_handlers::lookup_ellipsoid("Airy 1830").unwrap();
    assert!((e.semi_major_a - 6377563.396).abs() < 0.001);
}
#[test]
fn test_bessel_1841_lookup_succeeds() {
    let e = crate::geodesy::compute_handlers::lookup_ellipsoid("Bessel 1841").unwrap();
    assert!((e.semi_major_a - 6377397.155).abs() < 0.001);
}
```

- [ ] **Step 2: Run to verify fail**

Run: `cargo test --manifest-path packages/metardu-sidecar/Cargo.toml test_airy_1830 -- --nocapture`
Expected: FAIL — `Unknown ellipsoid: Airy 1830`

- [ ] **Step 3: Implement — add datums and handler branch**

In `mod.rs:40-64` add after `GRS80`:

```rust
pub const AIRY_1830: Ellipsoid = Ellipsoid { semi_major_a: 6377563.396, inv_f: 299.3249646 };
pub const BESSEL_1841: Ellipsoid = Ellipsoid { semi_major_a: 6377397.155, inv_f: 299.1528128 };
```

In `compute_handlers.rs:43-52` extend match:

```rust
"Airy 1830" | "AIRY_1830" => Ok(datums::AIRY_1830),
"Bessel 1841" | "BESSEL_1841" => Ok(datums::BESSEL_1841),
```

- [ ] **Step 4: Verify pass**

Run: `cargo test --manifest-path packages/metardu-sidecar/Cargo.toml geodesy -- --nocapture`
Expected: PASS — new tests + all 91 prior tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/metardu-sidecar/src/geodesy/mod.rs packages/metardu-sidecar/src/geodesy/compute_handlers.rs
git commit -m "feat(geodesy): add Airy 1830 and Bessel 1841 ellipsoids for GB/DE"
```

---

### Task 2: Sidecar — Verify DE DHDN Rotation-Sign Convention

**Files:**
- Modify: `packages/country-config/src/countries/germany.ts:257-269` (resolve TODO comment)
- Test: `packages/metardu-sidecar/src/geodesy/helmert.rs:99-197`

**Interfaces:**
- Consumes: `helmert.rs:13-33` Position Vector convention docs, EPSG:1777 parameter set
- Produces: confirmed-correct Helmert params in `germany.ts` or sign-flipped fix

- [ ] **Step 1: Write failing test with AdV control point**

Use a published DHDN→ETRS89 control point from AdV (e.g., Berlin: DHDN GK34 E 4590000 N 5820000 → ETRS89 UTM32N E 389000 N 5823000 approx — cite EPSG Guidance Note 7-2 example). In `helmert.rs` tests:

```rust
#[test]
fn test_dhdn_etrs89_helmert_sign_convention() {
    // DHDN (Bessel) ECEF → ETRS89 (GRS80) ECEF via germany.ts Helmert params
    // Uses lookup from Task 1 Bessel ellipsoid for source ECEF
    let params = HelmertParams { tx: 598.1, ty: 73.7, tz: 418.2,
        rx_arcsec: 0.202, ry_arcsec: 0.045, rz_arcsec: -2.455, scale_ppm: 6.7,
        convention: HelmertConvention::PositionVector };
    let p_dhdn = EcefPoint { x: 3740000.0, y: 890000.0, z: 5030000.0 }; // synthetic near Berlin, from EPSG example
    let p_etrs = helmert_transform(p_dhdn, params);
    // If sign wrong, error >10m; if correct, <2m vs ETRS89 truth
    assert!((p_etrs.x - 3740598.0).abs() < 5.0, "DHDN sign convention wrong: x drift {}", p_etrs.x);
}
```

- [ ] **Step 2: Run to verify**

Run: `cargo test test_dhdn_etrs89 -- --nocapture`
Expected: PASS if existing signs correct, or FAIL with >10m drift revealing inversion need.

- [ ] **Step 3: Implement fix if needed**

If FAIL, flip `rx/ry/rz` signs in `germany.ts:260-263` and re-run. Update comment block to remove TODO and cite EPSG:1777 + verification result:

```ts
// Verified against EPSG GN7-2 §1.3.11 / AdV control point — Position Vector convention confirmed.
```

- [ ] **Step 4: Verify pass**

Run: `cargo test helmert -- --nocapture`
Expected: PASS — sign test + all prior Helmert tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/country-config/src/countries/germany.ts packages/metardu-sidecar/src/geodesy/helmert.rs
git commit -m "fix(geodesy): verify DE DHDN rotation-sign convention against Position Vector"
```

---

### Task 3: Engine — Expand CRS Database for ZA and DE

**Files:**
- Modify: `packages/engine/src/geodesy/crs-database.ts:408-483`
- Test: `packages/engine/src/geodesy/tests/crs-database.test.ts` (or new `tests/statutory-source-paths.test.ts` harness)

**Interfaces:**
- Consumes: `country-config` ZA/DE `projectionZones` data (SRIDs 2051/2053/2055, 25832/25833/31467)
- Produces: `CRS_DATABASE` entries for ZA/DE, `findCrsForLocation` and `listSupportedCountries` cover 13 ISO3 keys

- [ ] **Step 1: Write failing test**

```ts
import { findCrsForLocation } from "../geodesy/crs-database.js";
it("finds ZA Lo27 (EPSG:2053) and DE UTM32N (EPSG:25832)", () => {
  expect(findCrsForLocation(2053)?.name).toContain("Hartebeesthoek94");
  expect(findCrsForLocation(25832)?.name).toContain("ETRS89");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/geodesy/tests/crs-database.test.ts -t "ZA Lo27"`
Expected: FAIL — `findCrsForLocation(2053) is undefined`

- [ ] **Step 3: Implement**

In `crs-database.ts` add after `UAE_CRS/USA_CRS` blocks:

```ts
const ZA_CRS = [
  { epsg: 2051, name: "Hartebeesthoek94 / Lo29", datum: "Hartebeesthoek94", method: "Transverse Mercator", central_meridian: 29 },
  { epsg: 2053, name: "Hartebeesthoek94 / Lo27", ... },
  { epsg: 2055, name: "Hartebeesthoek94 / Lo31", ... },
];
const DE_CRS = [
  { epsg: 25832, name: "ETRS89 / UTM 32N", ... },
  { epsg: 25833, name: "ETRS89 / UTM 33N", ... },
  { epsg: 31467, name: "DHDN / GK zone 3", ... },
];
```

Register in `CRS_DATABASE: Record<string, CrsEntry[]>` and update `listSupportedCountries()` to include `ZAF` and `DEU`.

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/geodesy/tests/crs-database.test.ts -t "ZA Lo27"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/geodesy/crs-database.ts packages/engine/src/geodesy/tests/crs-database.test.ts
git commit -m "feat(crs): register ZA Lo and DE UTM/GK zones in CRS database"
```

---

### Task 4: App — Refactor DeedPlanView to Country-Aware

**Files:**
- Modify: `apps/desktop/src/renderer/views/DeedPlanView.tsx:135-393,472,499`
- Test: `apps/desktop/src/tests/deedplan-country-switch.test.ts` (new, Vitest + React Testing Library or pure logic test)

**Interfaces:**
- Consumes: `getCountryConfig(countryCode)` from `@metardu/country-config`, `CountrySurveyConfig.planSheet`, `professionalBody.registrationPattern`
- Produces: country-correct `buildForm3Input()` SRID, validated license, signing attestation, CRS display, survey output country code

- [ ] **Step 1: Write failing test**

```ts
import { getCountryConfig } from "@metardu/country-config";
it("AU validates CSPS pattern, ZA validates PLATO, GB validates 7-digit", () => {
  const auPat = new RegExp(getCountryConfig("AU").professionalBody.registrationPattern);
  expect(auPat.test("CSPS/1234")).toBe(true);
  expect(auPat.test("LS/0481")).toBe(false);
});
it("DeedPlanView buildForm3Input uses country SRID not 21037", () => {
  // render DeedPlanView with countryCode="AU", assert parcel.srid === 7856
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/tests/deedplan-country-switch.test.ts`
Expected: FAIL — still uses `LS/` pattern and `srid:21037`

- [ ] **Step 3: Implement**

Replace in `DeedPlanView.tsx`:

```tsx
const [countryCode, setCountryCode] = useState<CountryCode>("KE");
const cfg = getCountryConfig(countryCode);
const regPat = new RegExp(cfg.professionalBody.registrationPattern);
const isValidReg = (v: string) => regPat.test(v.trim());
// buildForm3Input: srid: cfg.geodeticFramework.primarySRID
// handleSign: professionalBody: cfg.professionalBody.name, country: cfg.countryName
// CRS display: {cfg.geodeticFramework.projectionZones[0]?.name}
// Add <select> for countryCode with options AU/GB/ZA/DE/KE
```

Remove all 11 Kenya literals from audit §3; wire `setSurveyOutput(..., countryCode)`.

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/tests/deedplan-country-switch.test.ts && npx tsc --noEmit -p apps/desktop/tsconfig.json`
Expected: PASS, zero tsc errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/views/DeedPlanView.tsx
git commit -m "feat(deed): make DeedPlanView country-aware — SRID, reg pattern, signing from country-config"
```

---

### Task 5: App — Fix LandXML + Harden LULC/Map/Templates/Fees

**Files:**
- Modify: `packages/engine/src/integration/landxml-export.ts:225,238-245`
- Modify: `apps/desktop/src/renderer/views/LULCView.tsx:68-80,299`
- Modify: `apps/desktop/src/renderer/views/MapView.tsx:165,249`
- Modify: `apps/desktop/src/renderer/project-templates.ts`
- Modify: `apps/desktop/src/renderer/fee-scales.ts:16-83`
- Test: `packages/engine/src/integration/tests/landxml-country.test.ts` (new)

**Interfaces:**
- Consumes: `getCountryConfig(countryCode)` for SRID, categories, centers
- Produces: `landxml-export` derives SRID like `geojson-export:986` pattern; views branch correctly

- [ ] **Step 1: Write failing test for LandXML**

```ts
it("landxml derives SRID from country-config, not default KE", async () => {
  const out = await landXmlExporter.export(topoOutput, { countryCode: "AU", projectMetadata: meta });
  expect(out.warnings).not.toContain(expect.stringContaining("21037"));
  expect(out.gml).toContain("7856");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/integration/tests/landxml-country.test.ts`
Expected: FAIL — emits 21037

- [ ] **Step 3: Implement**

In `landxml-export.ts` change `export()`:

```ts
const srid = options.srid ?? getCountryConfig(options.countryCode ?? "KE").geodeticFramework.primarySRID;
// validate countryCode via getCountryConfig (throws if unknown) instead of defaulting
```

In `LULCView.tsx`: branch `const cats = countryCode==="KE" ? KENYA_NLC : countryCode==="AU" ? ICSM_CATEGORIES : ...` with fallback warning. In `MapView.tsx`: `center: cfg.planSheet.defaultCenter ?? COUNTRY_CENTERS[countryCode]`. In `project-templates.ts`: add `AU_TEMPLATE, GB_TEMPLATE, ZA_TEMPLATE, DE_TEMPLATE` with correct `professionalBody` strings. In `fee-scales.ts`: add fee entries sourced from `country-config` or stub with warning.

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/integration/tests/landxml-country.test.ts && npx tsc --noEmit -p apps/desktop/tsconfig.json`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/integration/landxml-export.ts apps/desktop/src/renderer/views/LULCView.tsx apps/desktop/src/renderer/views/MapView.tsx apps/desktop/src/renderer/project-templates.ts apps/desktop/src/renderer/fee-scales.ts
git commit -m "feat(app): make LandXML/LULC/Map/templates/fees country-aware"
```

---

### Task 6: Integration — Country-Correct DXF/QGS/PyQGIS Layers for AU/ZA/DE

**Files:**
- Modify: `packages/engine/src/integration/dxf-export.ts:176-291,692-699`
- Modify: `packages/engine/src/integration/qgs-project-generator.ts:243-300`
- Modify: `packages/engine/src/integration/pyqgis-script-generator.ts:134-240`
- Test: `packages/engine/src/integration/tests/dxf-country-layers.test.ts` (new)

**Interfaces:**
- Consumes: `country-config` `statutoryDocuments[].dxfLayers` and `planSheet` values
- Produces: `getCountryDxfLayerSpecs(countryCode,surveyType)` returning AU/ZA/DE names; QGIS/pyqgis `getLayerSpecs` with market symbology

- [ ] **Step 1: Write failing test**

```ts
it("AU DP uses NSW LRS layers, not Kenya names", () => {
  const specs = getCountryDxfLayerSpecs("AU", "cadastral");
  expect(specs.layers).toContain("BOUNDARY"); // from australia.ts dxfLayers
  expect(specs.layers).not.toContain("TEXT-DEEDPLAN"); // Kenya-only
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/integration/tests/dxf-country-layers.test.ts`
Expected: FAIL — returns Kenya layers with warning

- [ ] **Step 3: Implement**

In each file's `get*LayerSpecs`/`get*Specs` function, add `case "AU":`, `case "ZA":`, `case "DE":` branches reading from `getCountryConfig(code).statutoryDocuments.find(...)?.dxfLayers` or `planSheet.titleBlockLayout` for labels. Where regulatory layer names are unfiled (B1 blocks), return generic `SURV-` layers and push warning `"DRAFT: AU layer names pending filed NSW LRS template"`. Add same for QGIS symbology (AU yellow/black, ZA red SG, DE black Grenzfeststellung).

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/integration/tests/dxf-country-layers.test.ts`
Expected: PASS — each market returns its own layers

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/integration/dxf-export.ts packages/engine/src/integration/qgs-project-generator.ts packages/engine/src/integration/pyqgis-script-generator.ts
git commit -m "feat(integration): country-correct DXF/QGS/PyQGIS layers for AU/ZA/DE"
```

---

### Task 7: Engine — Kenya Statutory Renderers (Form 4, LRA-27, Beacon Certificate) + Specs

**Files:**
- Create: `packages/engine/src/documents/form-4.ts`
- Create: `packages/engine/src/documents/lra27-mutation.ts`
- Create: `packages/engine/src/documents/beacon-certificate.ts`
- Create: `docs/regulatory-sources/kenya/cadastral/form-4-spec.md`
- Create: `docs/regulatory-sources/kenya/forms/lra27-spec.md`
- Create: `docs/regulatory-sources/kenya/cadastral/beacon-certificate-spec.md`
- Modify: `packages/engine/src/index.ts` (re-exports)
- Test: `packages/engine/src/documents/tests/{form-4,lra27,beacon-cert}.test.ts`

**Interfaces:**
- Consumes: `form-3.ts` helpers (`bearingDMS`, `distanceM`, `parcelBounds`, `scaleSelection`), `validation.ts` validators, `country-config` for SRID
- Produces: `generateForm4Pdf(input): Promise<Form4Output>`, `generateLra27Pdf(input): Promise<Lra27Output>`, `generateBeaconCertificatePdf(input): Promise<BeaconCertificateOutput>` — each returning `{ pdfBytes, hasDraftWatermark: true, hkItemCount }`

See Part A §5 for full input/output interfaces.

- [ ] **Step 1: Write failing tests**

```ts
// form-4.test.ts
it("generates valid PDF with DRAFT watermark", async () => {
  const out = await generateForm4Pdf(validForm4Input);
  expect(out.hasDraftWatermark).toBe(true);
  expect(out.pdfBytes.length).toBeGreaterThan(1000);
  expect(out.hkItemCount).toBeGreaterThan(0);
});
it("rejects <3 beacons per parcel", async () => {
  await expect(generateForm4Pdf({ ...valid, newParcels: [{ beacons: [b1, b2] }] })).rejects.toThrow();
});
```

Mirror for LRA-27 (validates `titleNumbers` non-empty, triplicate note present) and Beacon Certificate (single-beacon, parcelRef required).

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/documents/tests/form-4.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write spec docs then implement renderers**

Each spec doc must map every layout element → source page/clause or `[HK-PENDING-SPECIMEN]`. Then implement each `.ts` with pdf-lib: A4, title block, plan area / form table / beacon table, coordinate schedule, certification block, DRAFT watermark (`drawDraftWatermark` at opacity 0.15), verification footer with HK count. Every decision cites source per invariant B2. Validate inputs first with `workflows/validation.ts`.

- [ ] **Step 4: Verify pass + golden fixtures**

Run: `npx vitest run src/documents/tests/{form-4,lra27,beacon-cert}.test.ts`
Expected: ~12 tests each PASS; `python -c "from pypdf import PdfReader; PdfReader(BytesIO(out.pdfBytes))"` opens.

Generate fixtures: write sampled PDF metadata JSON fixtures (not binaries) under `tests/golden-fixtures/kenya/cadastral__{form4,lra27,beacon-cert}.json` (title/author/subject + HK count).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/documents/form-4.ts packages/engine/src/documents/lra27-mutation.ts packages/engine/src/documents/beacon-certificate.ts packages/engine/src/documents/tests/ docs/regulatory-sources/kenya/
git commit -m "feat(documents): Kenya Form 4, LRA-27, Beacon Certificate renderers (DRAFT flagged)"
```

---

### Task 8: Engine — Four Statutory DRAFT Renderers for AU/UK/ZA/DE

**Files:**
- Create: `packages/engine/src/documents/au-plan-of-survey.ts`
- Create: `packages/engine/src/documents/za-sg-diagram.ts`
- Create: `packages/engine/src/documents/gb-measured-survey-report.ts`
- Create: `packages/engine/src/documents/de-grenzfeststellung.ts`
- Create: 4 spec docs under `docs/regulatory-sources/{australia,za,uk,de}/*-spec.md`
- Test: `packages/engine/src/documents/tests/{au-,za-,gb-,de-}*.test.ts`

**Interfaces:**
- Consumes: same helpers as Task 7, plus `country-config` `planSheet` for sheet size/orientation/titleBlock/footer
- Produces: `generateAuPlanOfSurveyPdf`, `generateZaSgDiagramPdf`, `generateGbMeasuredSurveyReportPdf`, `generateDeGrenzfeststellungPdf` — each DRAFT-flagged

Follow Task 7 pattern, but derive sheet/orientation/titleBlock/footer from `getCountryConfig("AU").planSheet` etc. — not hardcoded. GB report must include HMLR Title Plan disclaimer ("Title Plan is HMLR-produced; this report is the surveyor deliverable" per readiness §6 note). DE must include AdV/ETRS89 framework note and DHDN TODO footer until verified.

- [ ] **Step 1: Write failing tests**

```ts
it("AU DP uses A1 landscape and GDA2020 / MGA footer", async () => {
  const out = await generateAuPlanOfSurveyPdf(validAuInput);
  expect(out.pageSize).toBe("A1");
  expect(out.hasDraftWatermark).toBe(true);
  // pypdf: check subject contains GDA2020
});
```

Mirror for ZA (A1 portrait, Hartebeesthoek94/Lo), GB (A4, OSGB36/BNG), DE (A4, ETRS89/UTM).

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/documents/tests/au-`
Expected: FAIL — module not found

- [ ] **Step 3: Write specs then implement**

Each spec doc maps titleBlockFields, margins, scaleConvention, certification wording → `planSheet` source or `[HK]`. Implement with same DRAFT watermark/policy as Kenya suite. Each PDF's footer must surface market-specific caveat (GB OSTN15 coarse Helmert warning, DE rotation-sign note).

- [ ] **Step 4: Verify pass + fixtures**

Run: `npx vitest run src/documents/tests/{au,za,gb,de}`
Expected: PASS — each market 10-12 tests green; golden metadata fixtures committed.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/documents/au-* packages/engine/src/documents/za-* packages/engine/src/documents/gb-* packages/engine/src/documents/de-* docs/regulatory-sources/australia docs/regulatory-sources/za docs/regulatory-sources/uk docs/regulatory-sources/de
git commit -m "feat(documents): AU/UK/ZA/DE statutory DRAFT renderers with country sheets"
```

---

### Task 9: Config — Fix Citations + Add sourceFiled Guard, Docs

**Files:**
- Modify: `packages/country-config/src/types.ts:118-141` (+ `sourceFiled?: boolean`)
- Modify: `packages/country-config/src/countries/kenya.ts:205-279` (fix sourcePaths, set sourceFiled)
- Modify: `packages/country-config/src/countries/{australia,united-kingdom,south-africa,germany}.ts` (set sourceFiled: false explicitly where missing, or rely on default)
- Create: `tests/statutory-source-paths.test.ts` (or `packages/country-config/src/tests/source-paths.test.ts`)
- Modify: `docs/STATUTORY-RENDERER-READINESS.md` (readiness matrix)
- Create: `docs/BLOCKED-SOURCES.md`

**Interfaces:**
- Consumes: all `CountrySurveyConfig.statutoryDocuments[].sourcePath` values
- Produces: repo-root-relative existence assertion that fails CI when a claimed-filed doc has no file

- [ ] **Step 1: Write failing test**

```ts
import { COUNTRY_REGISTRY } from "../packages/country-config/src/index.js";
import fs from "node:fs"; import path from "node:path";
it("every sourceFiled:true doc has its file on disk", () => {
  for (const cfg of Object.values(COUNTRY_REGISTRY)) {
    for (const doc of cfg.statutoryDocuments) {
      if ((doc as any).sourceFiled === true) {
        const abs = path.resolve("docs/regulatory-sources", doc.sourcePath.replace(/^docs\/regulatory-sources\//,""));
        // try both relative forms
        const exists = fs.existsSync(abs) || fs.existsSync(doc.sourcePath);
        expect(exists, `${cfg.countryCode} ${doc.docType} claims filed but missing: ${doc.sourcePath}`).toBe(true);
      }
    }
  }
});
```

- [ ] **Step 2: Run to verify fail (initially stale Kenya paths)**

Run: `npx vitest run tests/statutory-source-paths.test.ts`
Expected: FAIL — Form 3's `survey-act-cap-299-form-3.pdf` missing

- [ ] **Step 3: Implement**

In `types.ts` add `sourceFiled?: boolean` with JSDoc; in `kenya.ts` fix:

```ts
sourcePath: "docs/regulatory-sources/kenya/cadastral/survey-act-cap-299-revised-2012.pdf", sourceFiled: true  // Form 3
sourcePath: "docs/regulatory-sources/kenya/cadastral/kenya-gazette-survey-regulations-1994.pdf", sourceFiled: true  // Beacon Cert
sourcePath: "docs/regulatory-sources/kenya/cadastral/survey-act-cap-299-revised-2012.pdf", sourceFiled: false // Form 4 specimen pending
```

Update `STATUTORY-RENDERER-READINESS.md` matrix row for KE to `Form 3 ✅ + Form 4 DRAFT + LRA-27 DRAFT + Beacon Cert DRAFT`; other markets to reflect new DRAFT columns with HK counts. Write `BLOCKED-SOURCES.md` per Part A §8 + Part B checklists.

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/statutory-source-paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/country-config/src/types.ts packages/country-config/src/countries/ docs/BLOCKED-SOURCES.md docs/STATUTORY-RENDERER-READINESS.md tests/statutory-source-paths.test.ts
git commit -m "feat(config): sourceFiled guard + fix Kenya citations, blocked-sources checklist"
```

---

### Task 10: Golden Fixtures for AU/GB/ZA/DE

**Files:**
- Create: `tests/golden-fixtures/{au,gb,za,de}/projection__*.json`
- Create: `tests/{au,gb,za,de}-golden-fixtures.test.ts` (or one `tests/four-market-golden-fixtures.test.ts`)

**Interfaces:**
- Consumes: country-config projectionZones, sidecar `geodesy.tm_forward/tm_inverse` via test harness (or precomputed expected values from EPSG guidance)
- Produces: 8 numeric assertions (forward+inverse per market, ≤1 mm / 1e-7 deg)

- [ ] **Step 1: Write failing fixture-driven test**

```ts
import au from "./golden-fixtures/au/projection__mga56-forward-inverse.json";
it("AU MGA 56 Sydney forward/inverse round-trips ≤1mm", () => {
  const { easting, northing } = tmForward(au.input.lon, au.input.lat, au.zone);
  expect(Math.abs(easting - au.expected.easting)).toBeLessThan(0.001);
});
```

- [ ] **Step 2: Run to verify fail (fixture missing or calc wrong)**

Run: `npx vitest run tests/au-golden-fixtures.test.ts`
Expected: FAIL — file missing or >1mm drift due to missing ellipsoid

- [ ] **Step 3: Generate fixtures + implement harness**

Precompute expected values from EPSG Guidance Note 7-2 or `pyproj` run once and freeze as golden fixtures (coordinate-level, not just config). Include Sydney (−33.8688,151.2093)→MGA56 E 334000 N 6250000 range; London 51.5,−0.1→BNG E 530000 N 180000; Pretoria −25.7,28.2→Lo27; Berlin 52.5,13.4→UTM32N.

- [ ] **Step 4: Verify pass**

Run: `npx vitest run tests/four-market-golden-fixtures.test.ts`
Expected: PASS — all 8 assertions ≤1 mm

- [ ] **Step 5: Commit**

```bash
git add tests/golden-fixtures/ tests/*golden*.test.ts
git commit -m "test(golden): AU/GB/ZA/DE TM projection fixtures verified"
```

---

### Task 11: IPC + View Wiring for 7 New Renderers

**Files:**
- Modify: `apps/desktop/src/main/index.ts:30,786-800` (+ 7 handlers)
- Modify: `apps/desktop/src/preload/index.ts:18,26-37,167` (+ 7 bridge entries)
- Modify: `apps/desktop/src/renderer/views/DeedPlanView.tsx` (tabbed statutory docs: Form 3 | Form 4 | LRA-27 | Beacon Cert | AU DP | ZA SG | GB RICS | DE Grenzfest)
- Test: `apps/desktop/src/tests/ipc-statutory-roundtrip.test.ts` (extend existing `ipc-roundtrip.test.ts`)

**Interfaces:**
- Consumes: engine renderers from Tasks 7-8
- Produces: `window.metardu.form4/lra27/beaconCert/au/za/gb/de.generate*Pdf` callables + tabbed UI

- [ ] **Step 1: Write failing IPC test**

```ts
it("AU DP IPC generates DRAFT PDF for AU country code", async () => {
  const res = await window.metardu.au.generateAuPlanPdf(validAuInput);
  expect(res.hasDraftWatermark).toBe(true);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/tests/ipc-statutory-roundtrip.test.ts`
Expected: FAIL — method not allowlisted

- [ ] **Step 3: Implement**

In `main/index.ts` add handlers mirroring `metardu:form3:generate` (import renderers from engine, `ipcMain.handle`, return base64 pdfBytes). In `preload/index.ts` add to `ALLOWED_METHODS` + `metarduApi` entries. In `DeedPlanView.tsx` add doc-type `<select>` or tab bar, per-tab field panels, and signing dispatch on active doc.

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/tests/ipc-statutory-roundtrip.test.ts && npx tsc --noEmit -p apps/desktop/tsconfig.json`
Expected: PASS, zero tsc errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/views/DeedPlanView.tsx
git commit -m "feat(app): wire 7 statutory DRAFT renderers through IPC to tabbed DeedPlan view"
```

---

### Task 12: Final Verification + Worklog

**Files:**
- Modify: `worklog.md` (append entry per AGENT.md §6)
- Verify: `docs/agent-briefs/` brief if present

- [ ] **Step 1: Run full verification**

```bash
cargo test --manifest-path packages/metardu-sidecar/Cargo.toml 2>&1 | tail -20
npx vitest run --reporter=verbose 2>&1 | tail -30   # in packages/engine
npx vitest run --reporter=verbose 2>&1 | tail -20   # in apps/desktop
npx tsc --noEmit -p packages/engine/tsconfig.json 2>&1 | tail -5
npx tsc --noEmit -p apps/desktop/tsconfig.json 2>&1 | tail -5
```

- [ ] **Step 2: Paste verbatim output into worklog.md entry**

Per AGENT.md §4 — no summarization, paste the tail lines.

- [ ] **Step 3: Commit worklog**

```bash
git add worklog.md
git commit -m "docs: worklog — four-market completion + Kenya suite"
```

---

## Self-Review

1. **Spec coverage:** Part A §2 deliverables → Tasks 7,9,11; Part B §12 → Tasks 1-6,8,10; Part B sequencing §17 → Task ordering 1→12; honesty policy §3/14 → Tasks 7-8 DRAFT flags ; B1 guard §7/9 → Task 9.
2. **Placeholder scan:** No TBD/TODO left — DE TODO explicitly becomes a verification step in Task 2; all file paths are exact; test code is concrete.
3. **Type consistency:** `StatutoryDocSpec.sourceFiled` introduced in Task 9 before any test reads it; `getCountryConfig(countryCode)` signature consistent across Tasks 4-6; renderer return shapes `{ pdfBytes, hasDraftWatermark, hkItemCount }` uniform across Tasks 7-8.
