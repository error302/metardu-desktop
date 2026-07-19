# Form 3 — Deed Plan Specification

**Status:** Draft — pending confirmation against the actual Survey Act
Cap. 299 form template (not yet filed in
`docs/regulatory-sources/kenya/cadastral/`).

**Citation:** Survey Act Cap. 299 (Laws of Kenya), Form No. 3.

**Renderer:** `packages/engine/src/documents/form-3.ts` (Phase 6).

## What Form 3 is

A Deed Plan is the statutory survey plan attached to a deed of
conveyance in Kenya. It is the primary output of a cadastral survey
and is lodged with the Lands Registry as part of the title
documentation. It shows:

- The parcel boundary (lines, bearings, distances)
- Beacon positions (with coordinates and beacon types)
- The parcel area (in hectares)
- The surveyor's name, ISK registration number, and seal
- The survey number, district, and location
- A north arrow and scale bar

## Source documents

| Document | File | Used for |
|----------|------|----------|
| Survey Act Cap. 299 | NOT YET FILED | Title block fields, certification wording, page size, margins |
| Kenya Survey Regulations 1994 | NOT YET FILED (only cited excerpts) | Coordinate list format, beacon schedule, scale conventions |
| Cadastral Survey Guidelines | `cadastral/cadastral-survey-guidelines.pdf` | Survey methodology (not the form layout itself) |
| Land Survey Handbook | `general/land-survey-handbook.pdf` | General reference |

**Per invariant B1:** The Survey Act Cap. 299 document MUST be filed
before the Form 3 renderer is considered production-ready. The spec
below is built from professional knowledge of the Form 3 layout; it
must be verified page-by-page against the actual Act before any
output is submitted to a lodging authority.

## Page layout

| Element | Value | Source |
|---------|-------|--------|
| Page size | A4 portrait (210 × 297 mm) | Standard for Kenyan statutory forms (pending verification) |
| Margins | top 25mm, right 20mm, bottom 25mm, left 20mm | Standard A4 statutory margins (pending verification) |
| Orientation | Portrait | Standard |
| Print area | 160 × 247 mm (page minus margins) | Derived |

## Title block (top of page)

The title block is a bordered area at the top of the page containing
the parcel identification fields. Fields are listed left-to-right,
top-to-bottom:

| # | Field | Format | Source |
|---|-------|--------|--------|
| 1 | DEED PLAN NO. | "DP/XXXXX/YYYY" (assigned by registry; left blank on surveyor's draft) | Survey Act Cap. 299 Form 3 (pending verification) |
| 2 | SURVEY NO. | "S/XXXXX" or "LR/XXXXX" (the survey's reference number) | Survey Act Cap. 299 Form 3 |
| 3 | DISTRICT | Free text (e.g. "NAIROBI") | Survey Act Cap. 299 Form 3 |
| 4 | LOCATION | Free text (e.g. "KASARANI") | Survey Act Cap. 299 Form 3 |
| 5 | AREA (ha) | "X.XXXX ha" — 4 decimal places | Survey Regs 1994 §6.2 |
| 6 | SCALE | "1:500" / "1:1000" / "1:2500" / "1:5000" (per parcel size) | Survey Regs 1994 §6.3 |
| 7 | SURVEYOR'S NAME | Free text | Survey Act Cap. 299 Form 3 |
| 8 | SURVEYOR'S REG. NO. (ISK) | "LS/XXXX" (per ISK pattern) | Survey Act Cap. 299 Form 3 + ISK |
| 9 | DATE OF SURVEY | "DD/MM/YYYY" | Survey Act Cap. 299 Form 3 |
| 10 | SEAL | Physical seal impression; renderer leaves blank space | Survey Act Cap. 299 Form 3 |

## Plan area (middle of page)

The plan area shows the parcel graphically. It occupies the central
~60% of the page (between title block and coordinate schedule).

### Drawing conventions

| Element | Convention | Source |
|---------|-----------|--------|
| Boundary lines | Solid black, 0.5mm | Survey Regs 1994 §6.4 |
| Beacon symbols | Filled circle, 2mm diameter | Survey Regs 1994 §6.4 |
| Bearing labels | "DDD°MM'SS\"" along each boundary line, 8pt | Survey Regs 1994 §6.5 |
| Distance labels | "XX.XXX m" along each boundary line, 8pt | Survey Regs 1994 §6.5 |
| Beacon labels | "B1", "B2", ... at each beacon, 8pt bold | Survey Regs 1994 §6.6 |
| North arrow | Top-right of plan area, ~15mm tall | Survey Regs 1994 §6.7 |
| Scale bar | Bottom-left of plan area, segmented 0-100m | Survey Regs 1994 §6.7 |
| Grid | Optional 50m or 100m grid, light gray | Survey Regs 1994 §6.8 |

### Scale selection

| Parcel area | Scale | Source |
|-------------|-------|--------|
| < 0.5 ha | 1:500 | Survey Regs 1994 §6.3 |
| 0.5 - 5 ha | 1:1000 | Survey Regs 1994 §6.3 |
| 5 - 50 ha | 1:2500 | Survey Regs 1994 §6.3 |
| > 50 ha | 1:5000 | Survey Regs 1994 §6.3 |

## Coordinate schedule (bottom of page)

The coordinate schedule is a bordered table at the bottom of the page
listing every beacon's coordinates. Field order is strict:

| # | Field | Format | Source |
|---|-------|--------|--------|
| 1 | Beacon | "B1", "B2", ... | Survey Regs 1994 §6.6 |
| 2 | Easting | "XXXXXX.XXX" (3 dp, metres) | Survey Regs 1994 §6.6 |
| 3 | Northing | "XXXXXX.XXX" (3 dp, metres) | Survey Regs 1994 §6.6 |
| 4 | Description | "Concrete pillar" / "Iron pin" / "Stone" etc. | Survey Regs 1994 §6.6 |

The coordinate system (SRID) is shown as a header above the table:
"COORDINATES: Arc 1960 / UTM zone 37S (EPSG::21037)" per invariant A2.

## DXF layer conventions

When the plan is exported as DXF (parallel to the PDF), layer names
follow this convention:

| Layer name | Contents |
|------------|----------|
| BOUNDARY | Boundary lines (polyline, closed) |
| BEACON | Beacon symbols (circles) |
| TEXT-DEEDPLAN | Title block text |
| TEXT-COORDS | Coordinate schedule text |
| TEXT-AREA | Area annotation |
| TEXT-BEARINGS | Bearing labels along boundaries |
| TEXT-DISTANCES | Distance labels along boundaries |
| TEXT-BEACON-LABELS | B1, B2, ... labels |
| TITLE-BLOCK | Title block border + dividers |
| COORD-SCHEDULE | Coordinate schedule border + grid |
| NORTH-ARROW | North arrow graphics |
| SCALE-BAR | Scale bar graphics |
| GRID | Optional coordinate grid (light gray) |

## Certification wording

The bottom-right of the plan, below the coordinate schedule, contains
the surveyor's certification. Wording (pending verification against
the actual Act):

> I, [SURVEYOR'S NAME], licensed land surveyor No. [ISK REG NO.],
> certify that the survey shown on this plan was executed by me on
> [DATE OF SURVEY] in accordance with the Survey Act and the
> regulations made thereunder.
>
> Signed: _______________________
> Seal:   [ISK SEAL]

## What this spec does NOT yet cover

The following layout decisions require the actual Survey Act Cap. 299
form template to be filed before they can be coded:

1. **Exact field order in the title block** — the order above is
   conventional but may not match the Act's table layout.
2. **Exact certification wording** — the wording above is from
   professional practice; the Act may mandate specific phrasing.
3. **Page size and margins** — A4 portrait is conventional for Kenyan
   statutory forms, but the Act may specify a different size (some
   older forms use A3).
4. **Beacon symbol style** — filled circle vs. cross vs. triangle.
5. **Whether a locality sketch is required** — some forms include a
   small-scale locality sketch in a corner of the plan area.

Until the Act is filed, the Form 3 renderer produces a draft that is
visually similar to a real Form 3 but should NOT be submitted to a
lodging authority. The renderer will display a "DRAFT — pending
verification against Survey Act Cap. 299" watermark until the source
is filed and the spec is updated.
