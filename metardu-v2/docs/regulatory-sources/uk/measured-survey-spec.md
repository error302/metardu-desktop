# UK Measured Survey Report — Specification

**Status:** DRAFT — pending filing of current RICS Measured Surveys of Land, Buildings and Utilities (3rd ed.) specimen and HM Land Registry Practice Guide 40. Every layout element cites source or is flagged `[HK-PENDING-SPECIMEN]` per invariant B2. Renderer draws DRAFT watermark until licensed surveyor eye-checks specimen.

**Citation:** RICS Measured Surveys of Land, Buildings and Utilities, 3rd edition; Land Registration Act 2002 (UK), s. 60 (general boundaries rule) + s. 66 / Land Registration Rules 2003, r. 8 (title plans); OS Net / OSTN15 transformation specification.

**Renderer:** `packages/engine/src/documents/gb-measured-survey-report.ts` — `generateGbMeasuredSurveyReportPdf`

**Country config:** `packages/country-config/src/countries/united-kingdom.ts` — `UNITED_KINGDOM.planSheet` and `MEASURED_SURVEY_REPORT` / `TITLE_PLAN`

---

## What this document is

The UK does NOT operate a fixed-boundaries cadastral system. HM Land Registry works on the **general boundaries rule** (Land Registration Act 2002, s. 60) — registered Title Plans show the *approximate*, not legally definitive, position of boundaries. The Title Plan itself is **HMLR-produced** (registry-issued, no surveyor seal). The surveyor's deliverable is the **RICS Measured Survey Report** — a professional plan/report feeding conveyancing, planning, and construction.

> **HMLR disclaimer (mandatory per readiness §6):** This renderer produces the *surveyor* deliverable. The footer must state: **"Title Plan is HMLR-produced; this report is the surveyor deliverable."** The RICS report does NOT replace the HMLR Title Plan and must not be lodged as one.

Topographic and engineering / construction setting-out workflows translate more directly than a Kenya-style cadastral lodgment.

---

## Source documents

| Document | File | Used for |
|----------|------|----------|
| RICS Measured Surveys of Land, Buildings and Utilities, 3rd ed. | `docs/regulatory-sources/uk/measured-surveys-rics.pdf` [HK — excerpt not yet filed as specimen] | Report structure, classification A/B/C, scale, accuracy, title fields |
| Land Registration Act 2002, s. 60 + s. 66; Land Registration Rules 2003, r. 8 | `uk/title-plan-spec.pdf` [HK] | Title Plan vs measured survey distinction, general boundaries rule |
| HM Land Registry Practice Guide 40 | `hmlr-pg40.pdf` [HK] | File plan colours, general boundaries wording |
| Ordinance Survey — OSGB36 / British National Grid (EPSG:27700) + OS Net + OSTN15 grid | EPSG registry; `united-kingdom.ts:34-45` | CRS, OSTN15 Helmert note |
| Country config + CRS DB | `packages/country-config/src/countries/united-kingdom.ts` (`MEASURED_SURVEY_REPORT`, `UNITED_KINGDOM.planSheet`) | SRID 27700, margins, dxfLayers, titleBlockLayout |

---

## Page layout — derived from `getCountryConfig("GB").planSheet`

| Element | Value (renderer derives live) | Source |
|---------|-------------------------------|--------|
| Page size | `planSheet.defaultSheetSize = "a4"` → A4 (210 × 297 mm) | `united-kingdom.ts:256` |
| Orientation | `planSheet.defaultOrientation = "portrait"` → A4 portrait | `united-kingdom.ts:257` |
| Margins | `MEASURED_SURVEY_REPORT.margins_mm = [25,25,25,25]` | `united-kingdom.ts:155` [HK-PENDING-SPECIMEN] |
| Scale convention | `MEASURED_SURVEY_REPORT.scaleConvention = "variable (project-specific)"` | `united-kingdom.ts:156` — RICS Table 1; renderer uses caller-supplied `scale` and validates against RICS classes |
| CRS | OSGB36 / British National Grid (EPSG:27700) — `primarySRID = 27700`, datum `OSGB36`, ellipsoid `Airy 1830`, TM central meridian −2°, lat origin 49°, false easting 400 000 m, false northing −100 000 m, scale 0.9996012717 | `united-kingdom.ts:34-45` + `united-kingdom.ts:203-207` |
| HMLR disclaimer | Footer line: "Title Plan is HMLR-produced; this report is the surveyor deliverable." | Readiness §6 mandatory note |
| OSTN15 warning | Footer line: "ETRS89 -> OSGB36 Helmert (EPSG:27700) is coarse (approx 7-param); survey-grade requires OSTN15 grid [HK-PENDING-OSTN15]." | `united-kingdom.ts:208-224` — `legacyDatums[0]` comment + EPSG:9704 |
| DRAFT watermark | Diagonal "DRAFT -- NOT FOR LODGEMENT (HK-PENDING-SPECIMEN)" opacity 0.15 | Invariant B1/B2 |
| Verification footer | HK count + RICS/LRA citations + `[HK]` | This spec §Verification footer |

Renderer derives `A4` and `portrait` from `getCountryConfig("GB").planSheet` — no hard-coded literal except via sheet-size registry.

---

## Title block — derived from `MEASURED_SURVEY_REPORT.titleBlockFields` via planSheet fallback

`MEASURED_SURVEY_REPORT.titleBlockFields` (`united-kingdom.ts:157-164`): PROJECT NAME, CLIENT, SURVEYOR (RICS), RICS REG. NO., DATE OF SURVEY, SURVEY CLASSIFICATION (A/B/C).

Because the UK `planSheet.titleBlockLayout` currently mirrors the HMLR Title Plan (registry-issued, `seal.position = "none"`), the measured-survey renderer **overrides** the planSheet fieldRows with the RICS report fields at draw time and documents the divergence as `[HK-PENDING-SPECIMEN — HMLR planSheet vs RICS report field set]`. The HMLR Title Plan planSheet is retained for the title-plan export path; the RICS report is a distinct `docType`.

| # | Field label | Token | Source |
|---|-------------|-------|--------|
| 1 | PROJECT NAME | `{{projectName}}` | RICS 3rd ed. title block [HK-PENDING-SPECIMEN] |
| 2 | CLIENT | `{{client}}` | same [HK] |
| 3 | SURVEYOR (RICS) | `{{surveyorName}}` + RICS Reg. No. | `professionalBody.registrationPattern = ^\d{7}$` (`united-kingdom.ts:239`) |
| 4 | RICS REG. NO. | `{{ricsNumber}}` — 7-digit | RICS membership register [HK] |
| 5 | DATE OF SURVEY | `{{dateOfSurvey}}` | RICS report [HK] |
| 6 | SURVEY CLASSIFICATION (A/B/C) | `{{surveyClass}}` | RICS 3rd ed. Table 1 [HK] |
| 7 | SCALE | `{{scale}}` | caller-supplied, variable |
| 8 | CRS | `{{crs}}` → `OSGB36 / British National Grid (EPSG::27700)` | `UNITED_KINGDOM.geodeticFramework` |

Header: `planSheet.titleBlockLabel = "UNITED KINGDOM — HM LAND REGISTRY"` (`united-kingdom.ts:258`) is drawn as context but the report header is overridden to `"RICS MEASURED SURVEY REPORT"` with the HMLR disclaimer below — [HK-PENDING-SPECIMEN — header choice].

Certification: `planSheet.titleBlockLayout.certification` heading `GENERAL BOUNDARIES` (`united-kingdom.ts:278-283`) cites Land Registration Act 2002 s.60; the RICS report adds a separate RICS compliance line drawn from `MEASURED_SURVEY_REPORT.citation` [HK].

Seal: `planSheet.titleBlockLayout.seal.position = "none"` for HMLR Title Plans; the RICS report **does** carry a surveyor seal (`MEASURED_SURVEY_REPORT.requiresProfessionalSeal = true`) so the renderer draws `[RICS SEAL]` at bottom-right and notes the divergence `[HK — seal policy divergent between HMLR plan (none) and RICS report (required)]`.

Statutory footer lines: `planSheet.titleBlockLayout.statutoryFooterLines` (`united-kingdom.ts:288-293`) — Crown copyright, Ordnance Survey permission statement. Drawn verbatim.

---

## Plan area

Central area between title block and coordinate schedule.

| Element | Convention | Source |
|---------|-----------|--------|
| Survey points | Cross symbol (1.5 mm) + ID label 7pt | RICS plan convention [HK-PENDING-SPECIMEN] |
| Levels | `X.XX m ODN` below point ID where supplied | ODN height system (`united-kingdom.ts:206`) [HK] |
| Contours (if any) | Polyline, thin accent | RICS measured surveys §contours [HK] |
| Boundary outline | General boundary (dashed, thin) — not legally definitive | Land Registration Act 2002 s.60 |
| North arrow | Top-right, 15 mm | form-3 pattern |
| Scale bar | Bottom-left, segmented 0–100 m | same |

---

## Coordinate schedule

Bordered table. Columns: ID | Easting (BNG) | Northing (BNG) | Level (ODN) | Description. Header: `OSGB36 / British National Grid (EPSG::27700)` or `SRID {srid}` — invariant A2.

---

## Compliance & disclaimers

**Compliance statement** (drawn below coordinate schedule, 7 pt grey):

> This survey was conducted in accordance with RICS Measured Surveys of Land, Buildings and Utilities (3rd ed.). Surveyor: [NAME] (RICS [NUMBER]). Date: [DATE]. Classification: Class [A|B|C]. [HK — wording pending specimen].

**General boundaries notice** (drawn in certification area per `planSheet.certification`):

> This plan shows the general position, not the exact line, of the boundaries (Land Registration Act 2002, s. 60). The red line denotes the extent of the registered estate and is not to scale.

**HMLR disclaimer** (mandatory footer line):

> Title Plan is HMLR-produced; this report is the surveyor deliverable.

**OSTN15 / Helmert warning** (mandatory footer line):

> ETRS89 -> OSGB36 Helmert (7-param, EPSG:27700) is coarse; for survey-grade use OSTN15 grid (EPSG:9704) via the sidecar. [HK-PENDING-OSTN15 — coarse Helmert only].

---

## Verification footer

Gray 6.5 pt footer:

```
Layout cites: RICS Measured Surveys 3rd ed. & LRA 2002 s.60/s.66 & HMLR PG40
— OSGB36/BNG (EPSG:27700) — OSTN15 coarse [HK] — HK items: 11 pending RICS specimen.
Title Plan is HMLR-produced; this report is the surveyor deliverable. [DRAFT]
DRAFT watermark — NOT FOR LODGEMENT. [HK-PENDING-SPECIMEN]
Source: measured-survey-spec.md — verification required before lodgement.
```

HK count: **11** (page size derived OK, but RICS field vs HMLR planSheet divergence, header override, seal policy divergence, HMLR disclaimer placement, OSTN15 warning, certification wording, classification thresholds, margin 25 vs HMLR 10, Crown copyright footer wrapping, contour interval pending specimen).

Renderer's `hkItemCount` returns 11.

---

## DXF companion

Layers per `MEASURED_SURVEY_REPORT.dxfLayers` (`united-kingdom.ts:165-173`): `TOPOGRAPHY`, `BUILDING-OUTLINE`, `UTILITIES`, `TEXT-LABELS`, `CONTROL`, `TITLE-BLOCK`. Plus standard `NORTH-ARROW`, `SCALE-BAR`.

---

## What this spec does NOT yet cover

1. RICS classification A/B/C accuracy thresholds vs drawn scale — spec is filed as excerpt only.
2. Whether the RICS report uses OSGB36/BNG or ETRS89/ETRF as the GNSS-native datum before OSTN15.
3. Language: English/Welsh bilingual title plan handling.
4. HMLR colour (red edging) reproduction in PDF.
5. Building interior measured survey layer naming vs topographic.

Until the RICS specimen is filed and eye-checked, the renderer is DRAFT. The HMLR Title Plan remains registry-issued and is not generated by this renderer.

---

## Cross-references

- Renderer: `packages/engine/src/documents/gb-measured-survey-report.ts`
- Tests: `packages/engine/src/documents/tests/gb-measured-survey-report.test.ts`
- Country config: `packages/country-config/src/countries/united-kingdom.ts`
- Existing UK plan renderer (separate): `packages/engine/src/documents/uk-measured-survey.ts` — A3 professional deliverable (pre-Task 8); this task creates the statutory DRAFT RICS report with HMLR disclaimer.
- CRS: EPSG:27700 — OSGB36 / British National Grid; EPSG:4258 — ETRS89 (GNSS)
