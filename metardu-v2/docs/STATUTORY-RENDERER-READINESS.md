# Statutory Renderer Readiness — Per-Market Report

**Scope:** AU, AE, ZA, GB, DE, US, GH (the subscription-priority markets outside
Kenya, per ADR-0004 Kenya-as-reference). GH was added 2026-08-01.
**Date:** 2026-08-01
**Owner:** Mohammed (error302)

---

## 1. Executive summary

| Market | Config | Renderer(s) | B1 block | Source docs filed | Ready to ship statutory output? |
|--------|--------|-------------|----------|-------------------|--------------------------------|
| KE (reference) | ✅ | Form 3 PDF + DXF | Partial — Form 4/Beacon Cert./Mutation still need Survey Act Cap. 299 | Partial (`kenya/`) | Form 3 only |
| AU (NSW) | ✅ | None | 🔴 All | ❌ none filed | No |
| AE (Dubai) | ✅ | None | 🔴 All | ❌ none filed | No |
| ZA | ✅ | None | 🔴 All | ❌ none filed | No |
| GB | ✅ | None | 🔴 All | ❌ none filed | No |
| DE | ✅ | None | 🔴 All | ❌ none filed | No |
| US | ✅ | None | 🔴 All | ❌ none filed | No |
| GH | ✅ | None | 🔴 All | ❌ none filed | No |

**The blunt reading:** the config layer (tolerances, SRIDs, document *specs*,
seal requirements) is fully built for all 8 countries — but **invariant B1
blocks every renderer for the 7 priority markets**, because not a single source
regulation has been filed under `docs/regulatory-sources/<code>/` for them.
The country-config `statutoryDocuments[].sourcePath` entries point at files
that do not exist on disk yet. (Note: `docs/regulatory-sources/bahrain/`
exists from the beacon-verification work, but Bahrain is not in the 8-country
registry and is out of scope here.)

> **Invariant B1:** *Before any statutory document renderer (deed plan, SG
> diagram, sectional title plan, etc.) is built, the actual current regulatory
> document MUST exist in `docs/regulatory-sources/<country>/<doc-type>/`.
> If the source is missing, STOP and ask for it.*
> (docs/invariants.md §B1; restated in AGENT.md and RECOVERY-AND-PRODUCTION-PLAN.md §4)

**What exists today (renderer inventory):**
- `generateForm3Pdf` + `generateForm3Dxf` — **Kenya Form 3 deed plan** (the only
  implemented statutory renderer; DRAFT watermark removed in
  tier1-kenya-form3-verification; source verification filed at
  `docs/regulatory-sources/kenya/cadastral/SOURCE-VERIFICATION.md`).
- `generateTopoDxf`, `generateEngineeringDxf`, `generateSectionalDxf` — CAD
  companions (DXF), not statutory PDFs.
- Sectional workflow (`workflows/sectional.ts`) — hardcodes `sourceFiled = false`
  → **always emits a DRAFT plan** for every country until sources are filed.
- Digital signature module (`signing/digital-signature.ts`) — generic PDF
  signing; policy lives in `CountrySurveyConfig.statutoryDocuments[].signaturePolicy`.
- `report-pdf` — flight-plan summary report PDF (informational, not statutory).

**Nothing else exists.** No SG diagram renderer, no NSW plan-of-survey renderer,
no ALTA/NSPS renderer, no Grenzfeststellung renderer.

---

## 2. What unblocks a market (the gate, per invariant B1 + B2 + B3)

For each market, in order:

1. **File the source documents** (below, per market) under
   `docs/regulatory-sources/<code>/<doc-type>/`.
2. **Write a spec doc** (`<doc-type>-spec.md`) mapping every layout decision —
   title block fields, margins, scale conventions, certification wording —
   to a page/clause of the filed source (invariant B2).
3. **Implement the renderer** in `packages/engine/src/documents/<doc-type>.ts`
   with per-decision source citations in code comments.
4. **Add a fixture plan** reproduced from a real example (invariant B3).

**Renderer priority follows the highest-value market:** see §8.

---

## 3. AU — Australia (NSW first)

**Config:** `packages/country-config/src/countries/australia.ts` ✅
**Geodetic:** GDA2020 / MGA 55-56 (EPSG 7855/7856), AHD71; GDA94→GDA2020 Helmert ✅
**Renderer status:** 🔴 All statutory renderers blocked by invariant B1.

### Statutory documents declared (metadata only — no renderer, no source filed)

| docType | Name | Seal? | sourcePath (target file) |
|---------|------|-------|--------------------------|
| Plan of Survey | NSW LRS Plan of Survey (Deposited Plan) | ✅ | `docs/regulatory-sources/australia/nsw/plan-of-survey-template.pdf` |
| Section 88B Instrument | Easements & restrictions instrument | ✅ | `docs/regulatory-sources/australia/nsw/section-88b-template.pdf` |
| Strata Plan (sectional) | Strata Schemes Dev. Act 2015 | ✅ | (sectional regime — plan renderer) |

### Source-document filing checklist (from `sourceDocsRequired`)

- [ ] **Surveying and Spatial Information Act 2002 (NSW)** → `australia/nsw/`
- [ ] **Surveying and Spatial Information Regulation 2017 (NSW)** → `australia/nsw/`
- [ ] **ICSM SP1 v2.2** (Australian Survey Control Network standard) → `australia/`
- [ ] **NSW LRS Deposited Plan Requirements** → `australia/nsw/`
- [ ] **NSW LRS Plan of Survey template (A3)** — the single most important file; unblocks the flagship renderer → `australia/nsw/plan-of-survey-template.pdf`
- [ ] **Strata Schemes Development Act 2015 (NSW)** → `australia/nsw/`

---

## 4. AE — United Arab Emirates (Dubai first)

**Config:** `packages/country-config/src/countries/united-arab-emirates.ts` ✅
**Geodetic:** WGS84 / UTM 40N (EPSG 32640), no legacy datum ✅
**Renderer status:** 🔴 All statutory renderers blocked by invariant B1.

### Statutory documents declared (metadata only)

| docType | Name | Seal? | sourcePath (target file) |
|---------|------|-------|--------------------------|
| Title Deed | Dubai Title Deed | ❌ (DLD-issued) | `docs/regulatory-sources/ae/dubai/title-deed-spec.pdf` |
| JOP Declaration | Jointly Owned Property Declaration | ✅ | `docs/regulatory-sources/ae/dubai/jop-declaration-template.pdf` |

### Source-document filing checklist (from `sourceDocsRequired`)

- [ ] **Law No. 7 of 2006 (Dubai)** — Real Property Registration Law → `ae/dubai/`
- [ ] **Law No. 6 of 2019 (Dubai)** — Jointly Owned Property Law → `ae/dubai/`
- [ ] **Dubai Municipality Survey Department specifications** (current edition) → `ae/dubai/`
- [ ] **DLD Title Deed & JOP submission requirements** → `ae/dubai/`
- [ ] **Dubai Local Vertical Datum definition** → `ae/`

---

## 5. ZA — South Africa

**Config:** `packages/country-config/src/countries/south-africa.ts` ✅
**Geodetic:** Hartebeesthoek94 / Lo27-29-31 (EPSG 2053/2051/2055), SAVD; Cape→Hbk94 Helmert ✅
**Renderer status:** 🔴 All statutory renderers blocked by invariant B1
(confirmed by RECOVERY-AND-PRODUCTION-PLAN.md: "SG Diagram renderer (SA) — Blocked on source docs").

### Statutory documents declared (metadata only)

| docType | Name | Seal? | sourcePath (target file) |
|---------|------|-------|--------------------------|
| SG Diagram | Surveyor-General Diagram | ✅ | `docs/regulatory-sources/za/sg-diagram-directive.pdf` |
| General Plan | Township layout GP | ✅ | `docs/regulatory-sources/za/general-plan-directive.pdf` |
| Sectional Plan | Sectional Title Plan | ✅ | `docs/regulatory-sources/za/sectional-titles-act-1986.pdf` |

### Source-document filing checklist (from `sourceDocsRequired`)

- [ ] **Land Survey Act 8 of 1997 (South Africa)** → `za/`
- [ ] **Land Survey Act Regulations** (Government Notice R. 1088 of 1997) → `za/`
- [ ] **Chief Surveyor-General directive on SG Diagram drafting** — unblocks the flagship renderer → `za/sg-diagram-directive.pdf`
- [ ] **SANS 2814** (survey accuracy standard) → `za/`
- [ ] **Sectional Titles Act 95 of 1986** (as amended) → `za/sectional-titles-act-1986.pdf`
- [ ] **Sectional Titles Schemes Management Act 8 of 2011** → `za/`

---

## 6. GB — United Kingdom

**Config:** `packages/country-config/src/countries/united-kingdom.ts` ✅
**Geodetic:** OSGB36 / BNG (EPSG 27700), ODN; ETRS89→OSGB36 (OSTN15 grid — Helmert is coarse) ✅
**Renderer status:** 🔴 All statutory renderers blocked by invariant B1.

### Statutory documents declared (metadata only)

| docType | Name | Seal? | sourcePath (target file) |
|---------|------|-------|--------------------------|
| Title Plan | HM Land Registry Title Plan | ❌ (HMLR-produced) | `docs/regulatory-sources/uk/title-plan-spec.pdf` |
| Measured Survey Report | RICS Measured Survey Report | ✅ | `docs/regulatory-sources/uk/measured-surveys-rics.pdf` |
| Commonhold Plan (sectional) | CLRA 2002 | ✅ | (sectional regime) |

### Source-document filing checklist (from `sourceDocsRequired`)

- [ ] **Land Registration Act 2002 (UK)** → `uk/`
- [ ] **Land Registration Rules 2003** → `uk/`
- [ ] **RICS Measured Surveys of Land, Buildings and Utilities, 3rd ed.** — flagship; also the renderer spec → `uk/measured-surveys-rics.pdf`
- [ ] **RICS Boundary Determination guidance note** (current edition) → `uk/`
- [ ] **OSGN15 / OSTN15 transformation specification** (Ordnance Survey) → `uk/`
- [ ] **BS 7334** (surveying accuracy standards) → `uk/`

> Note: UK title plans are produced by HMLR, not sealed by the surveyor — the
> surveyor deliverable is the **Measured Survey Report**. The report renderer
> is the revenue-relevant one.

---

## 7. DE — Germany

**Config:** `packages/country-config/src/countries/germany.ts` ✅
**Geodetic:** ETRS89 / UTM 32N-33N (EPSG 25832/25833), DHDN GK3 legacy (EPSG 31467),
DHHN2016 heights; DHDN→ETRS89 Helmert (rotation-sign TODO pending — flagged) ✅
**Renderer status:** 🔴 All statutory renderers blocked by invariant B1.

### Statutory documents declared (metadata only)

| docType | Name | Seal? | sourcePath (target file) |
|---------|------|-------|--------------------------|
| Grenzfeststellung | Niederschrift über die Grenzfeststellung | ✅ | `docs/regulatory-sources/de/grenzfeststellung-niederschrift.pdf` |
| Abmarkungsprotokoll | Marker placement protocol | ✅ | `docs/regulatory-sources/de/abmarkungsprotokoll.pdf` |
| ALKIS Extract | Amtliche Liegenschaftskarte extract | ❌ (Katasteramt-issued) | `docs/regulatory-sources/de/alkis-extract-spec.pdf` |
| Aufteilungsplan (sectional) | WEG division plan | ✅ | (sectional regime) |

### Source-document filing checklist (from `sourceDocsRequired`)

- [ ] **AdV Geodateninfrastruktur specifications** (ETRS89/UTM adoption) → `de/`
- [ ] **State Vermessungsgesetze** (per Bundesland) — flag: federal, choose the first state → `de/`
- [ ] **Wohnungseigentumsgesetz (WEG)** → `de/`
- [ ] **DVW professional practice guidelines** → `de/`

---

## 8. US — United States

**Config:** `packages/country-config/src/countries/united-states.ts` ✅
**Geodetic:** NAD83(2011) / SPCS zones (TX-SC, CA-5, FL-E, NY-LI) **+ UTM 16N/17N/18N**
(EPSG 6320/6321/6322) wired into `outputWgs84`; NAVD88. The TX/CA/NY Lambert
zones are now **computable** via the sidecar's `geodesy.lcc_inverse`
(standard parallels in the config; verified against EPSG GN7-2 §1.3.2.1),
FL East via `geodesy.tm_inverse`. ✅
**Renderer status:** 🔴 All statutory renderers blocked by invariant B1.

### Statutory documents declared (metadata only)

| docType | Name | Seal? | sourcePath (target file) |
|---------|------|-------|--------------------------|
| ALTA/NSPS Land Title Survey | Premium title product | ✅ | `docs/regulatory-sources/us/alta-nsps-2021.pdf` |
| Certificate of Survey | State boundary product | ✅ | `docs/regulatory-sources/us/certificate-of-survey-model.pdf` |
| BLM Cadastral Plat | Public lands plat | ✅ | `docs/regulatory-sources/us/blm-surveying-instructions-2009.pdf` |
| Condominium Plat (sectional) | State condominium statutes | ✅ | (sectional regime) |

### Source-document filing checklist (from `sourceDocsRequired`)

- [ ] **FGCS Geospatial Positioning Accuracy Standards (1998)** → `us/`
- [ ] **ALTA/NSPS Land Title Survey requirements (2021)** — flagship; the highest-value commercial product → `us/alta-nsps-2021.pdf`
- [ ] **BLM Manual of Surveying Instructions (2009)** → `us/`
- [ ] **State surveying statutes & licensing board rules** (per-state; pick TX/CA first) → `us/`

---

## 8.5. GH — Ghana (added 2026-08-01)

**Config:** `packages/country-config/src/countries/ghana.ts` ✅
**Geodetic:** GGRN / Leigon Ghana Metre Grid (EPSG 25000, CM 1°W, k 0.99975),
legacy Accra grid (EPSG 2136, War Office); UTM 30N/31N wired into `outputWgs84`.
**Renderer status:** 🔴 All statutory renderers blocked by invariant B1.
**Plan sheet:** defaults to **A0 landscape** — Lands Commission scheme-lodgment
convention (large-format, per market brief).

### Statutory documents declared (metadata only)

| docType | Name | Seal? | sourcePath (target file) |
|---------|------|-------|--------------------------|
| Survey Plan | Cadastral Survey Plan (Lands Commission) | ✅ | `docs/regulatory-sources/ghana/survey-plan-spec.pdf` |
| Site Plan | Site Plan (building permit / transaction) | ✅ | `docs/regulatory-sources/ghana/site-plan-spec.pdf` |

### Source-document filing checklist (from `sourceDocsRequired`)

- [ ] **Land Act 2020 (Act 1036)** → `ghana/`
- [ ] **Lands Commission Act 2008 (Act 767)** → `ghana/`
- [ ] **Ghana SMD cadastral survey technical standards** — unblocks the flagship renderer → `ghana/`
- [ ] **GGRN realization report** (Ghana Geodetic Reference Network) → `ghana/`
- [ ] **GhIS registration rules** (Ghana Institution of Surveyors) → `ghana/`

---

## 9. Priority recommendation (subscription revenue lens)

The six markets split into two tiers by revenue reachability:

| Tier | Market | Flagship renderer | What to file FIRST |
|------|--------|-------------------|--------------------|
| 1 | **US** | ALTA/NSPS Land Title Survey | `alta-nsps-2021.pdf` + FGCS 1998 |
| 1 | **DE** | Grenzfeststellung / Aufteilungsplan | WEG + one state's Vermessungsgesetz |
| 1 | **GB** | RICS Measured Survey Report | RICS Measured Surveys 3rd ed. |
| 2 | **ZA** | SG Diagram | CSG SG-diagram directive + Land Survey Act 8 of 1997 |
| 2 | **AU** | NSW Plan of Survey | NSW LRS Plan of Survey template (A3) |
| 2 | **AE** | JOP Declaration | Law No. 6 of 2019 + DLD submission requirements |

**Ordering logic:** US/DE/GB have the highest willingness-to-pay and the most
codified (English-language) templates — shortest path from filed PDF to a
shippable renderer. AU is NSW-only and AE is Dubai-only (fragmented
state/emirate regimes); ZA is tier 2 because the CSG directive is real but
less commercial than ALTA/NSPS; DE requires non-English drafting rules.

**Recommendation: file ALTA/NSPS 2021 + FGCS 1998 first.** The US renderer is
the single biggest subscription lever, and ALTA/NSPS Table A is a national,
well-documented standard — one PDF unblocks the whole market.

> GH (Ghana) is **not yet tiered** — added 2026-08-01, sources unfiled. Its
> Survey Plan renderer will be scheduled once the SMD cadastral standards PDF
> lands under `docs/regulatory-sources/ghana/`.

---

## 10. Structural notes

1. **Sectional plans are DRAFT-only everywhere.** `workflows/sectional.ts`
   hardcodes `sourceFiled = false`, so even Kenya's sectional output carries a
   DRAFT watermark until the Sectional Properties Act 2020 is filed. Same gate
   applies to AU Strata / GB Commonhold / DE Aufteilungsplan / US Condo Plat /
   AE JOP / ZA Sectional Title.
2. **Source-path conventions are inconsistent.** `country-config` uses
   `australia/nsw/…`, `uk/…`, `za/…`, `ae/dubai/…`, `de/…`, `us/…` while the
   `getCountryConfig` error message derives the folder from
   `code.toLowerCase()` (→ `au/`, `gb/`). When the first market's sources are
   filed, standardize on one convention (suggest: full country name, matching
   the existing `kenya/` + `australia/` precedent) and update `sourcePath` +
   the error message together.
3. **Sectional-plan seal flags are inferred.** `sectionalPropertyRegime` has no
   `requiresProfessionalSeal` field, so the ✅ on AU Strata / GB Commonhold /
   AE JOP / DE Aufteilungsplan / ZA Sectional Title / US Condo Plat is an
   inference — confirm against the filed regulation before treating it as fact
   (GB commonhold plans are HMLR-registered, so ✅ is especially doubtful).
4. **Renderer specs must precede renderer code.** The Kenya Form 3 pattern
   (`cadastral/form-3-spec.md` → `SOURCE-VERIFICATION.md` → `documents/form-3.ts`)
   is the template every new market renderer should follow (invariant B2/B3).
5. **Uncertainty is flagged, not hidden:** Germany's DHDN→ETRS89 rotation signs
   carry a TODO pending verification; UK's ETRS89→OSGB36 uses a coarse Helmert
   (OSTN15 grid required for survey grade). US SPCS Lambert zones ARE now
   computable (sidecar `geodesy.lcc_forward/lcc_inverse`, EPSG GN7-2 §1.3.2.1,
   golden-fixture verified) — but the DHDN Helmert and OSTN15 items must still
   be resolved before the *numbers* on a statutory document are trusted
   (invariant C1–C3).
