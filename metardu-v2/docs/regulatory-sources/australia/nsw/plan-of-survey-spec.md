# NSW Plan of Survey (Deposited Plan) — Specification

**Status:** DRAFT — pending filing of NSW LRS Plan of Survey template specimen. Every layout element cites source or is flagged `[HK-PENDING-SPECIMEN]` per invariant B2. Renderer draws DRAFT watermark until a licensed surveyor eye-checks the specimen.

**Citation:** Surveying and Spatial Information Act 2002 (NSW), s. 21; Surveying and Spatial Information Regulation 2017 (NSW); ICSM SP1 v2.2; NSW Land Registry Services Deposited Plan Requirements.

**Renderer:** `packages/engine/src/documents/au-plan-of-survey.ts` — `generateAuPlanOfSurveyPdf`

**Country config:** `packages/country-config/src/countries/australia.ts` — `AUSTRALIA.planSheet` and `PLAN_OF_SURVEY`

---

## What this document is

The NSW Plan of Survey (Deposited Plan, D.P.) is the statutory cadastral plan lodged with NSW Land Registry Services (NSW LRS). It shows the parcel boundary, beacons/marks, coordinates in GDA2020 / MGA, area, and surveyor's certificate for registration. Unlike Kenya's Form 3 (A4), NSW DPs are lodged on large-format sheets (A1/A0) for scheme and subdivision plans.

---

## Source documents

| Document | File | Used for |
|----------|------|----------|
| Surveying and Spatial Information Act 2002 (NSW), s. 21 | `docs/regulatory-sources/australia/nsw/plan-of-survey-template.pdf` [HK — not yet filed] | Plan authority, lodgment requirement |
| Surveying and Spatial Information Regulation 2017 (NSW) | same [HK] | Plan form, certification, scale rules |
| ICSM SP1 v2.2 — Standard for the Australian Survey Control Network | `icsm-sp1-v2.2.pdf` [HK] | GDA2020 datum, PU/LU tolerances |
| NSW LRS Plan of Survey template | `plan-of-survey-template.pdf` [HK-PENDING-SPECIMEN — not yet filed; drives all title-block fields] | Title block fields, margins, page size |
| Country config + CRS DB | `packages/country-config/src/countries/australia.ts` (`PLAN_OF_SURVEY`, `AUSTRALIA.planSheet`), `packages/engine/src/geodesy/crs-database.ts` | SRID 7856, margins, scaleConvention, dxfLayers, titleBlockLayout |

**Per invariant B1:** The NSW LRS template PDF MUST be filed before this renderer is production-ready. Until then every title-block field order, margin, and certification word is flagged `[HK]`.

---

## Page layout — derived from `getCountryConfig("AU").planSheet`

| Element | Value (renderer derives live) | Source |
|---------|-------------------------------|--------|
| Page size | `planSheet.defaultSheetSize = "a1"` → A1 (594 × 841 mm) | `australia.ts:294` — `planSheet.defaultSheetSize` |
| Orientation | `planSheet.defaultOrientation = "landscape"` → A1 landscape (841 × 594 mm) | `australia.ts:295` — `planSheet.defaultOrientation` |
| Margins | `PLAN_OF_SURVEY.margins_mm = [20,20,20,20]` | `australia.ts:160` — `PLAN_OF_SURVEY.margins_mm` [HK-PENDING-SPECIMEN — follows NSW LRS template] |
| Scale convention | `PLAN_OF_SURVEY.scaleConvention = "1:500, 1:1000, 1:2000, 1:4000"` | `australia.ts:161` |
| CRS | GDA2020 / MGA zone 56 (EPSG:7856) — `geodeticFramework.primarySRID = 7856`, datum `GDA2020`, ellipsoid `GRS80`, TM central meridian 153° | `australia.ts:38-48` + `australia.ts:230-233` |
| DRAFT watermark | Diagonal "DRAFT -- NOT FOR LODGEMENT (HK-PENDING-SPECIMEN)" opacity 0.15, 42pt Helvetica-Bold, rotated 45° | Invariant B1/B2 — specimen not filed |
| Verification footer | HK count + citations to Act/Regulation/SP1 + `[HK-PENDING-SPECIMEN]` | This spec §Verification footer; invariant B2 |

Renderer does NOT hardcode `"A1"`, `"landscape"`, `7856`, or `"GDA2020"` — it reads `getCountryConfig("AU").planSheet` and `geodeticFramework` at draw time. Tests assert `out.pageSize === "A1"` and `out.orientation === "landscape"` by reloading the PDF and checking dimensions against `AUSTRALIA.planSheet`.

---

## Title block — derived from `planSheet.titleBlockLayout.fieldRows`

Field grid mirrors `PLAN_OF_SURVEY.titleBlockFields` (10 fields, `australia.ts:162-173`) via `planSheet.titleBlockLayout.fieldRows` (`australia.ts:305-315`):

| # | Field label (rendered) | Token/value | Source |
|---|------------------------|-------------|--------|
| 1 | PLAN NUMBER (D.P.) | `{{planNumber}}` or "(to be assigned — HK)" | Surveying and Spatial Information Act 2002 s.21 [HK-PENDING-SPECIMEN] |
| 2 | EDITION | `{{edition}}` or "1" | NSW LRS template [HK] |
| 3 | COUNCIL | `{{council}}` | NSW LRS template [HK] |
| 4 | SUBURB / LOCALITY | `{{locality}}` | same [HK] |
| 5 | PARISH | `{{parish}}` | same [HK] |
| 6 | COUNTY | `{{county}}` | same [HK] |
| 7 | SCALE | `{{scale}}` → `1:500`/`1:1000`/`1:2000`/`1:4000` | `PLAN_OF_SURVEY.scaleConvention` — Survey Regs 2017 [HK] |
| 8 | DATE OF SURVEY | `{{date}}` | Act Form [HK] |
| 9 | SURVEYOR | `{{surveyor}}` — name + BOSSI Reg. No. | `professionalBody.registrationPattern = ^CSPS/\d{4,5}$` (`australia.ts:274`) + BOSSI register |
| 10 | SEAL | `[BOSSI SEAL]` placeholder | Requires professional seal (`PLAN_OF_SURVEY.requiresProfessionalSeal`) |

Header label: `planSheet.titleBlockLabel = "COMMONWEALTH OF AUSTRALIA — NEW SOUTH WALES"` (`australia.ts:296`) — sanitised to ASCII `"COMMONWEALTH OF AUSTRALIA - NEW SOUTH WALES"`.

Plan-type label: `planSheet.planTypeLabel = "DEPOSITED PLAN (D.P.)"` (`australia.ts:297`).

Certification: `planSheet.titleBlockLayout.certification` (`australia.ts:316-322`) — heading `SURVEYOR'S CERTIFICATE` plus Act 2002 / NSW LRS wording [HK-PENDING-SPECIMEN].

Seal placement: `planSheet.titleBlockLayout.seal.position = "bottom-right"`, caption `REGISTERED SURVEYOR — BOSSI REG. NO.` (`australia.ts:324-327`).

Statutory footer lines: `planSheet.titleBlockLayout.statutoryFooterLines` (`australia.ts:328-333`) — lodgment authority, offence, GDA2020 / MGA (EPSG:7855-7856).

---

## Plan area (middle of sheet)

Occupies central area between title block and coordinate schedule. Drawing conventions reuse `form-3.ts` pattern:

| Element | Convention | Source |
|---------|-----------|--------|
| Boundary | Solid black 0.5 mm, closed polygon | Survey Regs 2017 §boundary [HK-PENDING-SPECIMEN — dash/solid pending specimen] |
| Beacons/Marks | Filled circle 2 mm diameter, labels "PM1", "SSM1", "B1" 8pt bold | NSW LRS template mark symbols [HK] |
| Bearing labels | Along each segment, `DDDdMM'SS"` (ASCII 'd' for degree) 7pt | ICSM + form-3.ts `bearingDMS` helper; sanitised |
| Distance labels | `XX.XXX m` 3 dp, opposite side of line from bearing | same (`distanceM`) |
| Area annotation | `AREA X.XXXX ha` at parcel centroid | Survey Regs 2017 + NSW LRS area 4 dp |
| North arrow | Top-right of plan area, 15 mm tall | form-3.ts pattern |
| Scale bar | Bottom-left, segmented 0–100 m | same |

Scale selection: parcel area → 1:500 (<0.5 ha), 1:1000 (0.5–5 ha), 1:2000 (5–50 ha), 1:4000 (>50 ha) — NSW LRS scale rules per `PLAN_OF_SURVEY.scaleConvention`. Auto-fits if bounds exceed plan area at statutory scale (same logic as `form-3.ts` `makePlanTransform`).

---

## Coordinate schedule (lower middle of sheet)

Bordered table below plan area. Columns: Beacon | Easting (MGA) | Northing (MGA) | Description. Header: `GDA2020 / MGA zone 56 (EPSG::7856)` or `SRID {srid}` if outside zones — invariant A2 (SRID from `country-config` via `AUSTRALIA.geodeticFramework.projectionZones`).

---

## Certification (bottom-right)

`planSheet.titleBlockLayout.certification` wording — Surveyor's certificate per Surveying and Spatial Information Act 2002 (NSW) and NSW LRS requirements [HK-PENDING-SPECIMEN].

---

## Verification footer (bottom of sheet)

Small 6.5 pt gray footer (same position as Kenya form-3 verification footer):

```
Layout cites: Surveying and Spatial Information Act 2002 (NSW) s.21 & Reg.2017
& ICSM SP1 v2.2 — GDA2020/MGA — HK items: 9 pending NSW LRS specimen.
DRAFT watermark — NOT FOR LODGEMENT. BOSSI seal pending [HK].
Source: plan-of-survey-spec.md — verification required before lodgement.
```

HK count: **9** (page size derived OK, but margins, title field order, mark symbol style, certification wording, scale rule 1:2000/1:4000 vs 1:2500, grid interval, seal caption, footer offence wording pending specimen).

Renderer's `hkItemCount` returns 9; footer draws `HK items: 9`.

---

## DXF companion layers

When exported as DXF, layer names follow `PLAN_OF_SURVEY.dxfLayers` (`australia.ts:174-183`): `BOUNDARY`, `MARK`, `TEXT-PLAN`, `TEXT-COORDS`, `TEXT-AREA`, `TITLE-BLOCK`, `NORTH-ARROW`, `SCALE-BAR`.

---

## What this spec does NOT yet cover

1. Exact A-series sheet for a given lot size — A1 is the default large-format; A3 remains valid per NSW LRS. Renderer uses A1 landscape per `planSheet`.
2. BOSSI vs SSSI professional body — config uses SSSI/CSPS; NSW registered surveyors are BOSSI-registered. Alias pending verification [HK].
3. Parish/County field necessity on modern GDA2020 DPs — retained from template but may be historical.
4. Whether Local Government Area (LGA) duplicates Council.
5. Exact mark symbol for Permanent Marks (PM) vs State Survey Marks (SSM).
6. Certification bilingual or statutory phrase exact wording.

Until the NSW LRS specimen is filed and eye-checked, the renderer is DRAFT and must not be lodged.

---

## Cross-references

- Renderer: `packages/engine/src/documents/au-plan-of-survey.ts`
- Tests: `packages/engine/src/documents/tests/au-plan-of-survey.test.ts`
- Country config: `packages/country-config/src/countries/australia.ts`
- Form 3 spec (pattern): `docs/regulatory-sources/kenya/cadastral/form-3-spec.md`
- CRS: EPSG:7856 — GDA2020 / MGA zone 56
