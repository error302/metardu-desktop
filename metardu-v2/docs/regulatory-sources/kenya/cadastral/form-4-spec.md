# Form 4 — Mutation / Subdivision Plan Specification

**Status:** DRAFT — pending filing of Specimen Form 4 template from Survey Act Cap. 299
schedule. Every layout element cited to source page/clause or flagged
[HK-PENDING-SPECIMEN] per invariant B2. Renderer draws DRAFT watermark
until a licensed surveyor eye-checks the specimen.

**Citation:** Survey Act Cap. 299 (Laws of Kenya), Form No. 4 — Mutation Survey
Plan. Survey Regulations 1994 (Kenya Gazette No. 26, 27 May 1994).

**Renderer:** `packages/engine/src/documents/form-4.ts`

**Country config:** `packages/country-config/src/countries/kenya.ts` FORM_4

---

## What Form 4 is

A Mutation Plan shows the subdivision of a parent parcel (LR No.) into two or
more new parcels. It is lodged together with the LRA-27 Mutation form at the
Land Registry. It contains:

- Parent parcel boundary (existing beacons) and new subdivision boundaries
- Beacon positions for every new parcel (with coordinates, mark types)
- Area schedule: parent area vs sum of new parcel areas (cross-check)
- County / sub-county, LR numbers, mutation reason
- Surveyor name, ISK reg. no., date, seal
- North arrow and scale bar (per Survey Regs 1994 §6.7)

Form 4 is distinct from Form 3 (single-parcel deed plan) — it shows OLD vs NEW
boundaries on the same sheet, with the new boundaries emphasised.

---

## Source documents

| Document | File | Used for |
|----------|------|----------|
| Survey Act Cap. 299 (rev. 2012) | `survey-act-cap-299-revised-2012.pdf` — Third Schedule, Forms 3 & 4 | Title block fields, certification wording, page size, plan number allocation; ss.24, 27 [HK-PENDING-SPECIMEN — Act on disk but Form 4 template page not isolated] |
| Survey Act Cap. 299 ss.24, 27, 28–29, 30, 32, 41, 45(1)(c) | same as above | Statutory basis for survey authority, beacon placement, subdivision approval chain [HK-PENDING-SPECIMEN for form layout — cited for statutory lineage only] |
| Kenya Survey Regulations 1994 (Gazette) | `kenya-gazette-survey-regulations-1994.pdf` | Coordinate list format (§6.6), scale conventions (§6.3), bearing/distance labelling (§6.5), beacon symbols (§6.4), north arrow & scale bar (§6.7), grid (§6.8), area 4 dp (§6.2) |
| Cadastral Survey Guidelines | `cadastral-survey-guidelines.pdf` | Survey methodology (not form layout) |
| Land Survey Submission Standards SRVY2025-1 | `land-survey-submission-standards-srvy2025-1.pdf` | Submission tolerances (informative for plan) |
| Working diagrams (4-acre / 5-acre) | `reference/4-acres-working-diagram.pdf`, `reference/5-acres-working-model.pdf` | Visual precedent for OLD vs NEW boundary emphasis and area annotation placement [HK-PENDING-SPECIMEN — diagrams are illustrative, not statutory] |
| Country config + CRS DB | `packages/country-config/src/countries/kenya.ts` (FORM_4), `packages/engine/src/geodesy/crs-database.ts` | SRID, margins, scaleConvention, dxfLayers, titleBlockFields |

**Per invariant B1:** The Survey Act Cap. 299 document MUST be filed before
Form 4 is production-ready. The Act is now on disk but the Form 4 specimen
page has not been isolated and eye-checked. All title-block field order and
certification wording decisions below are therefore flagged [HK-PENDING-SPECIMEN].

---

## Page layout

| Element | Value | Source |
|---------|-------|--------|
| Page size | A4 portrait (210 x 297 mm) | Survey Act Cap. 299 Form 4 template [HK-PENDING-SPECIMEN — specimen not isolated; follows Form 3 convention] |
| Margins | top 25 mm, right 20 mm, bottom 25 mm, left 20 mm | Standard A4 statutory margins (pending verification) [HK-PENDING-SPECIMEN] |
| Orientation | Portrait | Same as above [HK-PENDING-SPECIMEN] |
| Print area | 160 x 247 mm (page minus margins) | Derived |
| DRAFT watermark | Diagonal "DRAFT — NOT FOR LODGEMENT (HK-PENDING-SPECIMEN)" opacity 0.15, 42 pt Helvetica-Bold, rotated 45 deg, centred | Invariant B1/B2 — required until specimen filed and eye-checked (this spec) |
| Verification footer | HK count + "Layout cites: Survey Act Cap.299 ss.24/27/28-29/30/32/41/45(1)(c) & Survey Regs 1994 §6.x — [HK] items pending specimen" | This spec §Verification footer; invariant B2 |

---

## Title block (top of page)

Bordered table at the top containing parcel/mutation identification. Renderer
uses 2 columns x 6 rows. Source for each field label:

| # | Field | Format | Source |
|---|-------|--------|--------|
| 1 | MUTATION NO. | "(to be assigned)" on surveyor draft; registry assigns | Survey Act Cap.299 Form 4 header [HK-PENDING-SPECIMEN] |
| 2 | COUNTY | Free text, upper-case (e.g. "KIAMBU") | Survey Act Cap.299 s.27 administrative cadastre [HK-PENDING-SPECIMEN] |
| 3 | SUB-COUNTY | Free text (e.g. "KIAMBU") | Same as county [HK-PENDING-SPECIMEN] |
| 4 | PARENT PARCEL NO. (LR No.) | e.g. "LR 12345/67" | Survey Act Cap.299 ss.24,28 [HK-PENDING-SPECIMEN] |
| 5 | NEW PARCEL NOS. | Comma-separated LR numbers for each new parcel | Survey Act Cap.299 s.32 mutation register [HK-PENDING-SPECIMEN] |
| 6 | MUTATION REASON | Free text (e.g. "Subdivision for inheritance") | Survey Act ss.28-29 purpose of survey [HK-PENDING-SPECIMEN] |
| 7 | AREA (ha) — schedule | Parent + each new parcel "X.XXXX ha" 4 dp | Survey Regs 1994 §6.2 |
| 8 | SCALE | "1:500" / "1:1000" / "1:2500" / "1:5000" per largest parcel area | Survey Regs 1994 §6.3 (reuse form-3.ts selectScale) |
| 9 | SURVEYOR'S NAME | Free text | Survey Act Cap.299 Form 4 [HK-PENDING-SPECIMEN] + ISK |
| 10 | SURVEYOR'S REG. NO. (ISK) | "LS/XXXX" — pattern ^LS/\d{3,5}$ | Survey Act Cap.299 + ISK; validated in renderer via KENYA.professionalBody.registrationPattern |
| 11 | DATE OF SURVEY | YYYY-MM-DD (ISO 8601 input; rendered DD/MM/YYYY) | Survey Act Cap.299 Form 4 [HK-PENDING-SPECIMEN] |
| 12 | SEAL | Blank space for physical seal impression | Survey Act Cap.299 Form 4 [HK-PENDING-SPECIMEN] |

All labels drawn with Helvetica-Bold 7 pt (field name) and Helvetica 9 pt (value); borders 0.5–1 pt black per form-3-spec pattern.

---

## Plan area (middle of page)

Occupies central ~52% of page between title block and coordinate schedule.

### Drawing conventions

| Element | Convention | Source |
|---------|-----------|--------|
| Parent boundary (OLD) | Dashed black line, 0.4 mm, labelled "OLD" | Survey Regs 1994 §6.4 [HK-PENDING-SPECIMEN — dash pattern pending specimen; follows working diagrams] |
| New subdivision boundaries (NEW) | Solid black, 0.5 mm, emphasised | Survey Regs 1994 §6.4 (same as Form 3) |
| Beacon symbols | Filled circle, 2 mm diameter | Survey Regs 1994 §6.4 |
| Bearing labels | Along each segment, "DDDdMM'SS\"" or "DDDdegMM'SS\"" 8 pt | Survey Regs 1994 §6.5 (reuse bearingDMS helper); ASCII-only — degree symbol sanitised to 'd' per invariant |
| Distance labels | "XX.XXX m" 8 pt, opposite side of line from bearing | Survey Regs 1994 §6.5 (reuse distanceM) |
| Beacon labels | "B1", "B2", ... 8 pt bold | Survey Regs 1994 §6.6 |
| Area annotations | "AREA X.XXXX ha" at each new parcel centroid, plus parent total at top of plan | Survey Regs 1994 §6.2 + working diagrams |
| North arrow | Top-right of plan area, ~15 mm tall | Survey Regs 1994 §6.7 |
| Scale bar | Bottom-left of plan area, segmented 0–100 m | Survey Regs 1994 §6.7 |
| Optional grid | 50 m / 100 m light gray | Survey Regs 1994 §6.8 [HK-PENDING-SPECIMEN — grid interval pending specimen] |

### Scale selection

| Parcel area (largest new parcel) | Scale | Source |
|----------------------------------|-------|--------|
| < 0.5 ha | 1:500 | Survey Regs 1994 §6.3 |
| 0.5–5 ha | 1:1000 | Survey Regs 1994 §6.3 |
| 5–50 ha | 1:2500 | Survey Regs 1994 §6.3 |
| > 50 ha | 1:5000 | Survey Regs 1994 §6.3 |

Computed via `selectScale(areaHa)` reused from form-3.ts. If the parcel
bounds at that scale do not fit the plan area, the renderer auto-fits by
up-scaling the effective denominator (same as Form 3 appear larger on page
rather than clip).

### Geometry helpers reused from form-3.ts

- `parcelBounds(beacons)` — bounding box with 10% padding.
- `makePlanTransform(bounds, planAreaX/Y/W/H, scale)` — fit-to-plan-area
  transform preserving aspect ratio, centred.
- `polygonAreaHa(beacons)` — shoelace area in hectares for cross-check.

---

## Coordinate schedule (lower middle of page)

Bordered table below the plan area, above certification. Two sections:
parent beacon list then per-new-parcel sections.

| # | Field | Format | Source |
|---|-------|--------|--------|
| 1 | Beacon | "B1", "B2", ... (per-parcel numbering) | Survey Regs 1994 §6.6 |
| 2 | Easting | "XXXXXX.XXX" (3 dp, metres) | Survey Regs 1994 §6.6 |
| 3 | Northing | "XXXXXX.XXX" (3 dp, metres) | Survey Regs 1994 §6.6 |
| 4 | Description | "Concrete pillar" / "Iron pin" / "Stone" etc. | Survey Regs 1994 §6.6 |

Header row: "COORDINATES: Arc 1960 / UTM zone 37S (EPSG::21037)" or
"SRID {srid}" if srid not in KENYA projectionZones — invariant A2 (SRID
from country-config via KENYA.geodeticFramework.projectionZones).

Column widths: Beacon 15%, Easting 25%, Northing 25%, Description 35%.

SRID header background light gray (RGB 0.9) with 0.5 pt border, matching
Form 3.

---

## Area cross-check (Form 4-specific)

The renderer computes:

- `parentAreaHa` via shoelace on parentParcel beacons (ground metres → ha)
- `newAreasTotalHa` = sum of areaHaByParcel values supplied by caller
- `areasCrossChecked = |parentAreaHa - newAreasTotalHa| <= 0.01 ha`
  (1% or 0.01 ha tolerance — whichever is larger — per Survey Regs 1994 §4.4
  linear misclosure 1:5000 guidance; the precise statutory tolerance for
  mutation area sums is [HK-PENDING-SPECIMEN] — the cross-check is drawn as
  a footer note, not a pass/fail seal)

Footer note drawn in plan area:

- "Area cross-check: parent X.XXXX ha | sum(new) Y.YYYY ha — MATCH/MISMATCH
  (tolerance 0.01 ha) [HK-PENDING-SPECIMEN tolerance pending specimen]"

The boolean `areasCrossChecked` is returned in Form4Output so the workflow
can gate submission. Mismatch does not prevent PDF generation — it is a
warning, not an error.

---

## DXF companion layers

When the mutation is exported as DXF (parallel to PDF), layer names follow
KENYA FORM_4 dxfLayers plus standard survey layers:

| Layer name | Contents |
|------------|----------|
| BOUNDARY-OLD | Parent boundary (dashed polyline) |
| BOUNDARY-NEW | New subdivision boundaries (solid polylines, closed per new parcel) |
| BEACON-EXISTING | Existing beacons (circles, retained) |
| BEACON-NEW | New beacons (circles) |
| TEXT-MUTATION | Mutation title block text |
| TEXT-COORDS | Coordinate schedule text |
| TEXT-AREA | Area annotations |
| TEXT-BEARINGS | Bearing labels |
| TEXT-DISTANCES | Distance labels |
| TEXT-BEACON-LABELS | B1, B2, ... labels |
| TITLE-BLOCK | Title block border |
| COORD-SCHEDULE | Coordinate schedule border |
| NORTH-ARROW | North arrow graphics |
| SCALE-BAR | Scale bar graphics |

Helper `generateForm4Dxf(input)` builds the DXF using
`@tarikjabiri/dxf` (same library as form-3 DXF). The PDF renderer ensures
every beacon that appears in the PDF also appears in the DXF and vice versa.

---

## Certification wording (bottom-right)

> I, [SURVEYOR'S NAME], licensed land surveyor No. [ISK REG NO.],
> certify that the mutation survey shown on this plan — subdividing
> [PARENT LR] into [N] new parcels ([LR list]) for the reason
> "[MUTATION REASON]" — was executed by me on [DATE OF SURVEY]
> in accordance with the Survey Act Cap. 299 (ss.28–29) and the
> regulations made thereunder.
>
> Signed: _______________________      Seal: [ISK SEAL]

**Source:** Survey Act Cap. 299 Form 4 certification clause [HK-PENDING-
SPECIMEN — exact wording including subdivision phrase pending specimen;
current wording is professional-practice synthesis]. Renderer marks this
block "[HK]" in the PDF footer note.

---

## Verification footer (bottom of page)

Small 7.5 pt gray footer (same position as Form 3 verification footer):

```
Layout cites: Survey Act Cap.299 (rev.2012) ss.24/27/28-29/30/32/41/45(1)(c)
and Gazette Survey Regs 1994 §6.2/§6.3/§6.4/§6.5/§6.6/§6.7/§6.8;
DRAFT watermark — [HK] items pending Form 4 specimen (HK count: N).
```

HK count on this spec: **10** (page size, margins, orientation, title field
order (4 fields), parent/NEW dash vs solid pending, grid interval,
certification wording, area cross-check tolerance).

Renderer's `hkItemCount` returns 10; footer draws "HK items: 10".

---

## What this spec does NOT yet cover

1. Exact field order in the title block — conventional but may not match the
   Act's Form 4 table.
2. Exact certification wording — from professional practice; Act may mandate
   specific phrasing including Swahili/English bilingual.
3. Page size and margins — A4 portrait conventional; Act may specify A3.
4. Beacon symbol style for OLD vs NEW (differentiated vs identical).
5. Whether a locality sketch is required in a corner of the plan area.
6. Whether the District Land Registrar's approval block appears on Form 4
   itself or only on the LRA-27.
7. Area cross-check tolerance — statutory value pending specimen; renderer
   uses 0.01 ha as a warning threshold only.

Until the Form 4 specimen is filed and eye-checked, the renderer is DRAFT
and must not be lodged. The diagonal watermark remains.

---

## Implementation notes for the renderer

- Input validation via `workflows/validation.ts`: ≥3 beacons per polygon,
  positive area, ISK pattern ^LS/\d{3,5}$/i, finite coords, non-empty county/
  subCounty/mutationReason/lrNumber, valid SRID (1024–32767), SRID existence
  warning if not in KENYA zones.
- SRID from country-config — never literal 21037 outside country-config +
  crs-database + tests (invariant A2).
- All text sanitised to ASCII (`sanitizeAscii`) for Helvetica standard fonts
  (per invoice-pdf pattern).
- Every decision cites a source per invariant B2; unverifiable decisions
  carry [HK] marker and contribute to hkItemCount.
- DRAFT watermark: opacity 0.15, diagonal ~45 deg, centred, drawn before
  other content so it sits behind text but remains visible.

---

## Cross-references

- Renderer: `packages/engine/src/documents/form-4.ts`
- Tests: `packages/engine/src/documents/tests/form-4.test.ts`
- County config: `packages/country-config/src/countries/kenya.ts` FORM_4
- Form 3 spec (pattern): `docs/regulatory-sources/kenya/cadastral/form-3-spec.md`
- Source verification: `docs/regulatory-sources/kenya/cadastral/SOURCE-VERIFICATION.md`
