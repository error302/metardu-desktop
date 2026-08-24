# SG Diagram — South Africa Surveyor-General Diagram Specification

**Status:** DRAFT — pending filing of Chief Surveyor-General SG Diagram drafting directive specimen. Every layout element cites source or is flagged `[HK-PENDING-SPECIMEN]` per invariant B2. Renderer draws DRAFT watermark until licensed surveyor eye-checks specimen.

**Citation:** Land Survey Act 8 of 1997 (South Africa), s. 1 (definition of 'diagram') + Regulation 7; SANS 187/2814; Chief Surveyor-General (CSG) directives.

**Renderer:** `packages/engine/src/documents/za-sg-diagram.ts` — `generateZaSgDiagramPdf`

**Country config:** `packages/country-config/src/countries/south-africa.ts` — `SOUTH_AFRICA.planSheet` and `SG_DIAGRAM`

---

## What this document is

The Surveyor-General Diagram (SG Diagram) is the primary cadastral output in South Africa — a single-parcel diagram examined and approved by the Surveyor-General under the Land Survey Act 8 of 1997, bound with the deed on lodgment at the Deeds Registry. It shows the parcel boundary, beacons, Hartebeesthoek94 / Lo coordinates, area (ha), and the SG approval block. Unlike Kenya's A4 Form 3, SG Diagrams are lodged on large-format sheets (General Plans use A1).

---

## Source documents

| Document | File | Used for |
|----------|------|----------|
| Land Survey Act 8 of 1997, s.1 + Reg.7 | `docs/regulatory-sources/za/sg-diagram-directive.pdf` [HK — not yet filed] | Diagram definition, approval requirement, title fields |
| Chief Surveyor-General directive on SG Diagram drafting | same [HK-PENDING-SPECIMEN] | Drafting lettering, field layout, SG approval block |
| SANS 187 / SANS 2814 | `sans-2814.pdf` [HK] | Survey accuracy classes, lineweights, lettering |
| Country config + CRS DB | `packages/country-config/src/countries/south-africa.ts` (`SG_DIAGRAM`, `SOUTH_AFRICA.planSheet`) | SRIDs 2051/2053/2055, margins, scaleConvention, dxfLayers, titleBlockLayout |

---

## Page layout — derived from `getCountryConfig("ZA").planSheet`

| Element | Value (renderer derives live) | Source |
|---------|-------------------------------|--------|
| Page size | `planSheet.defaultSheetSize = "a1"` → A1 (594 × 841 mm) | `south-africa.ts:325` |
| Orientation | `planSheet.defaultOrientation = "portrait"` → A1 portrait (594 × 841 mm) | `south-africa.ts:326` |
| Margins | `SG_DIAGRAM.margins_mm = [25,25,25,25]` — renderer uses `SG_DIAGRAM.margins` but validates against `planSheet` sheet | `south-africa.ts:150` [HK-PENDING-SPECIMEN] |
| Scale convention | `SG_DIAGRAM.scaleConvention = "1:500, 1:1000, 1:2500, 1:5000 (per parcel size)"` | `south-africa.ts:151` |
| CRS | Hartebeesthoek94 / Lo27 (EPSG:2053) primary — `geodeticFramework.primarySRID = 2053`, datum `Hartebeesthoek94`, Lo belts, ellipsoid `WGS84`, scale factor 1.0, false easting/northing 0 | `south-africa.ts:43-53` + `south-africa.ts:263-265` |
| DRAFT watermark | Diagonal "DRAFT -- NOT FOR LODGEMENT (HK-PENDING-SPECIMEN)" opacity 0.15 | Invariant B1/B2 |
| Verification footer | HK count + Act/SANS citations + `[HK]` | This spec §Verification footer; invariant B2 |

Renderer derives `A1` and `portrait` from `getCountryConfig("ZA").planSheet` — no literal `"A1"` page-size string hard-coded except via the sheet-size registry lookup.

---

## Title block — derived from `planSheet.titleBlockLayout.fieldRows`

Field grid mirrors `SG_DIAGRAM.titleBlockFields` (`south-africa.ts:152-164`) via `planSheet.titleBlockLayout.fieldRows` (`south-africa.ts:338-347`), variant `sg-diagram` (`south-africa.ts:332`):

| # | Field label | Token | Source |
|---|------------|-------|--------|
| 1 | SG DIAGRAM NO. | `{{sgDiagramNo}}` or "(to be assigned — HK)" | Land Survey Act Reg.7 [HK] |
| 2 | FARM NAME | `{{farmName}}` | CSG directive [HK] |
| 3 | REGISTRATION DIVISION | `{{registrationDivision}}` | Act + CSG [HK] |
| 4 | PROVINCE | `{{province}}` | same [HK] |
| 5 | AREA (ha) | `{{areaHa}}` → `X.XXXX ha` | SANS + Act Reg.7 |
| 6 | SCALE | `{{scale}}` | `SG_DIAGRAM.scaleConvention` [HK] |
| 7 | DATE OF SURVEY | `{{date}}` | CSG [HK] |
| 8 | SURVEYOR | `{{surveyor}}` — name + SAGC (PLATO) Reg. No. | `professionalBody.registrationPattern = ^PLATO/\d{4,5}$` (`south-africa.ts:308`) [HK — SAGC naming] |

Header: `planSheet.titleBlockLabel = "REPUBLIC OF SOUTH AFRICA — SURVEYOR-GENERAL"` (`south-africa.ts:327`) — sanitised.

Plan-type: `planSheet.planTypeLabel = "GENERAL PLAN / DIAGRAM"` (`south-africa.ts:328`).

Certification: `planSheet.titleBlockLayout.certification` (`south-africa.ts:348-353`) — heading `APPROVED — SURVEYOR-GENERAL`, Act 8 of 1997 + SANS 2814 wording [HK].

Seal: `planSheet.titleBlockLayout.seal.position = "bottom-right"`, caption `REGISTERED LAND SURVEYOR — SAGC (PLATO) REG. NO.` (`south-africa.ts:355-358`).

Statutory footer lines: `planSheet.titleBlockLayout.statutoryFooterLines` (`south-africa.ts:359-364`) — Act offence, Deeds Registry lodgment, Hartebeesthoek94 / Lo belts (EPSG:2051-2058).

---

## Plan area

Central area between title block and coordinate schedule.

| Element | Convention | Source |
|---------|-----------|--------|
| Boundary | Solid black 0.5 mm | CSG directive §plan [HK-PENDING-SPECIMEN] |
| Beacons | Filled circle 2 mm + label "B1" 8pt bold | SANS 187 mark symbols [HK] |
| Bearing | `DDDdMM'SS"` 7pt (ASCII) | form-3.ts `bearingDMS` reuse |
| Distance | `XX.XXX m` 3 dp | `distanceM` |
| Area | `AREA X.XXXX ha` at centroid | CSG area annotation |
| North arrow | Top-right, 15 mm | form-3.ts pattern |
| Scale bar | Bottom-left, segmented 0–100 m | same |

Scale: parcel area → 1:500 (<0.5 ha), 1:1000 (0.5–5 ha), 1:2500 (5–50 ha), 1:5000 (>50 ha) — per `SG_DIAGRAM.scaleConvention`. Auto-fits (same `makePlanTransform` logic).

---

## Coordinate schedule

Bordered table. Columns: Beacon | Y (Easting, Lo) | X (Northing, Lo) | Description — note South Africa historically labels E as Y, N as X; renderer uses Easting/Northing per modern convention and cites [HK] for column header style. Header: `Hartebeesthoek94 / Lo27 (EPSG::2053)` or `SRID {srid}` — invariant A2.

---

## Verification footer

Gray 6.5 pt footer:

```
Layout cites: Land Survey Act 8 of 1997 s.1/Reg.7 & SANS 187 — Hartebeesthoek94/Lo — HK items: 10 pending CSG specimen.
DRAFT watermark — NOT FOR LODGEMENT. SG approval block pending [HK].
Source: sg-diagram-spec.md — verification required before lodgement.
```

HK count: **10** (page size derived OK, but field order, Y/X header, mark symbol, certification wording, scale 1:5000 vs 1:8000, LSA offence wording, SAGC vs PLATO caption, grid interval, edition handling pending specimen).

---

## DXF companion

Layers per `SG_DIAGRAM.dxfLayers` (`south-africa.ts:165-174`): `BOUNDARY`, `BEACON`, `TEXT-SG`, `TEXT-COORDS`, `TEXT-AREA`, `TITLE-BLOCK`, `NORTH-ARROW`, `SCALE-BAR`.

---

## What this spec does NOT yet cover

1. Exact SG approval signature block layout (hand-signed vs digital).
2. Whether farm name includes portion/remaining extent syntax.
3. Language (Afrikaans/English bilingual) on historic diagrams.
4. A0 vs A1 selection rule for large farms.
5. Beacon type vocabulary (12 mm iron peg vs concrete monument).

Until specimen filed and eye-checked, renderer is DRAFT.

---

## Cross-references

- Renderer: `packages/engine/src/documents/za-sg-diagram.ts`
- Tests: `packages/engine/src/documents/tests/za-sg-diagram.test.ts`
- Country config: `packages/country-config/src/countries/south-africa.ts`
- CRS: EPSG:2053 — Hartebeesthoek94 / Lo27
