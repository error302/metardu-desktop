# Blocked Sources — Precise Unblock Checklists

**Purpose:** The `sourceFiled` field on `StatutoryDocSpec` (see `packages/country-config/src/types.ts:118-141`)
is the machine-readable B1 gate. When `sourceFiled === true`, the guard test
`tests/statutory-source-paths.test.ts` (and `packages/country-config/src/tests/source-paths.test.ts`)
requires the file at `sourcePath` to exist on disk. When `false` (default), no file is required
and the renderer must carry a DRAFT watermark / `[HK]` footer.

**Repo root for all paths below:** `metardu-v2/` — every `sourcePath` is repo-root-relative
(`docs/regulatory-sources/...`). The guard resolves `path.resolve(repoRoot, sourcePath)` and
also `path.resolve(process.cwd(), sourcePath)`.

> **Rule:** Do not flip `sourceFiled` to `true` without filing the listed PDF at the exact
> `sourcePath` and completing the eye-check noted in the checklist. Flipping without the file
> fails CI.

---

## 1. Kenya (KE) — reference market

### 1.1 Form 3 — Deed Plan

| Field | Value |
|-------|-------|
| `docType` | `Form 3` |
| `sourcePath` | `docs/regulatory-sources/kenya/cadastral/survey-act-cap-299-revised-2012.pdf` |
| `sourceFiled` | `true` ✅ — **file exists on disk** (220 KB, verified 2026-08-24) |
| Used for | Title block fields, certification wording, page size |

**Unblock checklist:** Already unblocked. Remaining to remove DRAFT entirely: licensed-surveyor
eye-check of 8 `[HK]` items in `docs/regulatory-sources/kenya/cadastral/SOURCE-VERIFICATION.md` §2
(page size/margins, field order vs. Act template) and sign-off in that doc.

### 1.2 Beacon Certificate

| Field | Value |
|-------|-------|
| `docType` | `Beacon Certificate` |
| `sourcePath` | `docs/regulatory-sources/kenya/cadastral/kenya-gazette-survey-regulations-1994.pdf` |
| `sourceFiled` | `true` ✅ — **file exists on disk** (5.2 MB, verified 2026-08-24) |
| Used for | Beacon schedule format, Regulation 12 certificate layout, scale conventions §6.3 |

**Unblock checklist:** Already unblocked for existence. Renderer remains DRAFT until the Beacon
Certificate specimen layout inside the gazette (§14 / Regulation 12 template) is eye-checked
and `beacon-certificate-spec.md` maps every field → clause.

### 1.3 Form 4 — Mutation Plan

| Field | Value |
|-------|-------|
| `docType` | `Form 4` |
| `sourcePath` | `docs/regulatory-sources/kenya/cadastral/survey-act-cap-299-revised-2012.pdf` |
| `sourceFiled` | `false` — **DRAFT; specimen pending** |

**Precise file needed to set `sourceFiled: true`:**
- No new file path required — the source is the same `survey-act-cap-299-revised-2012.pdf` already filed
  (Form 4 is a schedule inside Cap. 299, like Form 3).
- What is blocked is the **specimen verification**, not the Act PDF itself.

**Checklist to flip `sourceFiled` → `true` and remove DRAFT watermark:**

1. Open `survey-act-cap-299-revised-2012.pdf` and locate the Form 4 template page (Survey Act Cap. 299, Form No. 4).
2. Confirm `kenya.ts` `FORM_4.titleBlockFields` order, `margins_mm`, `scaleConvention`, certification wording, and parent/new parcel table match the template page; note any delta in `docs/regulatory-sources/kenya/cadastral/form-4-spec.md`.
3. Licensed-surveyor visual sign-off appended to `SOURCE-VERIFICATION.md` (Form 4 appendix).
4. Set `sourceFiled: true` in `packages/country-config/src/countries/kenya.ts` (`FORM_4` const) and remove renderer DRAFT watermark (follow `form-3.ts` pattern).
5. `npx vitest run src/tests/source-paths.test.ts` still passes (file already exists; flag flip is now justified).

> **Why `false` today:** Until steps 1-3 are done, every Form 4 PDF must render the diagonal DRAFT watermark
> and verification footer `DRAFT — pending specimen filing and licensed-surveyor verification ([HK]: N items)`.
> This is honest per invariant B1/B2.

### 1.4 LRA-27 — Mutation Form (administrative, Land Registration Act)

| Field | Value |
|-------|-------|
| `docType` | `(not yet in statutoryDocuments[])` — `LRA-27` |
| Canonical specimen | `docs/regulatory-sources/kenya/forms/form-lra-27-mutation-form.doc` — **file exists on disk** (real template, structure recoverable) |
| Spec doc | `docs/regulatory-sources/kenya/forms/lra27-spec.md` |

**Checklist to add to `kenya.ts` statutoryDocuments with `sourceFiled: true`:**

1. Confirm `.doc` pagination vs. official LRA (r. 43(2)(b), 44(2)(f), 45(2)(e)) and triplicate / Part A / title-number(s) / proprietor instructions / registrar seal blocks match the filed `.doc`.
2. Map every layout row in `lra27-spec.md` → clause of the `.doc` or mark `[HK-PENDING-SPECIMEN]`.
3. Add `LRA_27_MUTATION` const with `sourcePath: docs/regulatory-sources/kenya/forms/form-lra-27-mutation-form.doc` (or a PDF export thereof) and `sourceFiled: true`.
4. Eye-check and sign off in `SOURCE-VERIFICATION.md` appendix; then renderer may drop DRAFT.

---

## 2. Australia — New South Wales (AU)

All docs `sourceFiled: false` — no files exist under `docs/regulatory-sources/australia/` today except `australia/nsw/plan-of-survey-spec.md` (spec, not the template). Guard requires no file until flagged true.

### 2.1 Plan of Survey — NSW LRS Deposited Plan

| Field | Value |
|-------|-------|
| `docType` | `Plan of Survey` |
| `sourcePath` | `docs/regulatory-sources/australia/nsw/plan-of-survey-template.pdf` |
| `sourceFiled` | `false` — blocked |

**To set `sourceFiled: true`:**

1. File the **NSW LRS Plan of Survey template (A3)** — the single most important AU file — at exactly that path. Source: NSW Land Registry Services deposited-plan requirements (current edition).
2. File supporting regs alongside (readiness §3 checklist):
   - `Surveying and Spatial Information Act 2002 (NSW)` → `docs/regulatory-sources/australia/nsw/` (any PDF name, referenced by `sourceDocsRequired`).
   - `Surveying and Spatial Information Regulation 2017 (NSW)` → `docs/regulatory-sources/australia/nsw/`.
   - `ICSM SP1 v2.2` → `docs/regulatory-sources/australia/`.
   - `Strata Schemes Development Act 2015 (NSW)` → `docs/regulatory-sources/australia/nsw/` (for sectional).
3. Write `docs/regulatory-sources/australia/nsw/plan-of-survey-spec.md` mapping every title block field, margin, scale rule → page/clause or `[HK]`.
4. Licensed-surveyor eye-check vs. the filed template; append to `SOURCE-VERIFICATION` equivalent.
5. Set `sourceFiled: true` in `countries/australia.ts` (`PLAN_OF_SURVEY` const).

### 2.2 Section 88B Instrument

| Field | Value |
|-------|-------|
| `docType` | `Section 88B Instrument` |
| `sourcePath` | `docs/regulatory-sources/australia/nsw/section-88b-template.pdf` |
| `sourceFiled` | `false` |

**To set `sourceFiled: true`:** file the Conveyancing Act 1919 (NSW) s. 88B instrument template at that path and complete the same spec/eye-check steps as §2.1.

---

## 3. United Kingdom (GB)

All docs `sourceFiled: false`.

### 3.1 HM Land Registry Title Plan

| Field | Value |
|-------|-------|
| `docType` | `Title Plan` |
| `sourcePath` | `docs/regulatory-sources/uk/title-plan-spec.pdf` |
| `sourceFiled` | `false` |

**To set `sourceFiled: true`:** file the HMLR Title Plan spec — `Land Registration Act 2002 s.66 + Land Registration Rules 2003 r.8` title-plan production spec, or the HMLR Practice Guide 40 filed plan — at that path. Note: title plans are **HMLR-produced, not surveyor-sealed**; the surveyor deliverable is the Measured Survey Report (§3.2). Requires spec doc `uk/title-plan-spec.md` → clause mapping and eye-check.

### 3.2 RICS Measured Survey Report

| Field | Value |
|-------|-------|
| `docType` | `Measured Survey Report` |
| `sourcePath` | `docs/regulatory-sources/uk/measured-surveys-rics.pdf` |
| `sourceFiled` | `false` |

**Flagship for GB.** To set `sourceFiled: true`: file **RICS Measured Surveys of Land, Buildings and Utilities, 3rd ed.** at that path. This is the renderer spec itself (readiness §6 flagship). Also file per readiness §6:

- `Land Registration Act 2002` → `docs/regulatory-sources/uk/`
- `Land Registration Rules 2003` → `docs/regulatory-sources/uk/`
- `RICS Boundary Determination guidance note` → `docs/regulatory-sources/uk/`
- `OSGM15 / OSTN15 transformation specification` → `docs/regulatory-sources/uk/` (GB height/plan accuracy)
- `BS 7334` → `docs/regulatory-sources/uk/`

Then write `uk/measured-survey-spec.md`, eye-check, set flag.

---

## 4. South Africa (ZA)

All docs `sourceFiled: false`.

### 4.1 SG Diagram

| Field | Value |
|-------|-------|
| `docType` | `SG Diagram` |
| `sourcePath` | `docs/regulatory-sources/za/sg-diagram-directive.pdf` |
| `sourceFiled` | `false` |

**Flagship for ZA.** To set `sourceFiled: true`: file the **Chief Surveyor-General directive on SG Diagram drafting** at that path. Also file per readiness §5:

- `Land Survey Act 8 of 1997` → `docs/regulatory-sources/za/`
- `Land Survey Act Regulations (GN R.1088 of 1997)` → `docs/regulatory-sources/za/`
- `SANS 2814` → `docs/regulatory-sources/za/`
- `Sectional Titles Act 95 of 1986 (as amended)` → `docs/regulatory-sources/za/sectional-titles-act-1986.pdf` (for §4.3)

Spec: `za/sg-diagram-spec.md` required.

### 4.2 General Plan

| Field | Value |
|-------|-------|
| `docType` | `General Plan` |
| `sourcePath` | `docs/regulatory-sources/za/general-plan-directive.pdf` |
| `sourceFiled` | `false` |

To unblock: file the CSG General Plan directive at that path.

### 4.3 Sectional Title Plan

| Field | Value |
|-------|-------|
| `docType` | `Sectional Plan` |
| `sourcePath` | `docs/regulatory-sources/za/sectional-titles-act-1986.pdf` |
| `sourceFiled` | `false` |

To unblock: file `Sectional Titles Act 95 of 1986` (already listed) + `Sectional Titles Schemes Management Act 8 of 2011` at `docs/regulatory-sources/za/`.

---

## 5. Germany (DE)

All docs `sourceFiled: false`.

### 5.1 Grenzfeststellung — Niederschrift über die Grenzfeststellung

| Field | Value |
|-------|-------|
| `docType` | `Grenzfeststellung` |
| `sourcePath` | `docs/regulatory-sources/de/grenzfeststellung-niederschrift.pdf` |
| `sourceFiled` | `false` |

**Flagship for DE.** To set `sourceFiled: true`: file the per-Bundesland **Vermessungsgesetz Grenzfeststellung** record template (choose first state, e.g. NRW) at that path. Also file per readiness §7:

- `AdV Geodateninfrastruktur specifications (ETRS89/UTM)` → `docs/regulatory-sources/de/`
- `State Vermessungsgesetze (per Bundesland)` → `docs/regulatory-sources/de/`
- `Wohnungseigentumsgesetz (WEG)` → `docs/regulatory-sources/de/`
- `DVW professional practice guidelines` → `docs/regulatory-sources/de/`

Spec: `de/grenzfeststellung-spec.md` required. Note DE is federal — first-state template unblocks the flagship renderer.

### 5.2 Abmarkungsprotokoll

| Field | Value |
|-------|-------|
| `docType` | `Abmarkungsprotokoll` |
| `sourcePath` | `docs/regulatory-sources/de/abmarkungsprotokoll.pdf` |
| `sourceFiled` | `false` |

To unblock: file the state Abmarkung (marker placement) protocol template at that path.

### 5.3 ALKIS Extract

| Field | Value |
|-------|-------|
| `docType` | `ALKIS Extract` |
| `sourcePath` | `docs/regulatory-sources/de/alkis-extract-spec.pdf` |
| `sourceFiled` | `false` |

To unblock: file the **AdV ALKIS specifications** extract spec at that path. Note: ALKIS extracts are Katasteramt-issued (`requiresProfessionalSeal: false`).

---

## 6. How to verify

```bash
# From repo root (metardu-v2):
npx vitest run packages/country-config/src/tests/source-paths.test.ts
# or (tests workspace):
npx vitest run tests/statutory-source-paths.test.ts
```

Expected after Task 9: **PASS** — Kenya Form 3 + Beacon Certificate are the only `sourceFiled:true` docs and both PDFs exist.
Any future flag flip without the file fails with:
`KE Form X claims filed but missing: docs/regulatory-sources/...`
or `AU/GB/ZA/DE Plan claims filed but missing: ...`.

---

## 7. Non-priority markets carried as `sourceFiled: false`

- **AE (Dubai):** `ae/dubai/title-deed-spec.pdf` + `ae/dubai/jop-declaration-template.pdf` — blocked on `Law No. 7 of 2006` / `Law No. 6 of 2019` + DLD specs (see `docs/STATUTORY-RENDERER-READINESS.md` §4).
- **US:** `us/alta-nsps-2021.pdf` + `us/certificate-of-survey-model.pdf` + `us/blm-surveying-instructions-2009.pdf` — blocked on `FGCS 1998` / `ALTA/NSPS 2021` / `BLM 2009`.
- **GH:** `ghana/survey-plan-spec.pdf` + `ghana/site-plan-spec.pdf` — blocked on `Land Act 2020 (Act 1036)` / `Ghana SMD cadastral standards`.

These remain `sourceFiled: false` (or default false) until their PDFs are filed under `docs/regulatory-sources/<country>/`.

---

*Last updated: 2026-08-24 — Task 9 (sourceFiled guard + Kenya citation fixes).*
*Owner: Mohammed (error302).*
