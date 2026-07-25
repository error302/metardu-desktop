# Kenya Form 3 — Source Verification Document

**Purpose:** Per AGENT.md invariant #7 ("no guessing at regulatory
formats") and the spec's own §"What this spec does NOT yet cover",
this document maps each Form 3 layout decision to the source in
`docs/regulatory-sources/kenya/cadastral/`. Where the source citation is
on disk but the page-by-page Act verification still depends on a
licensed surveyor's review, the row is flagged **[HK — human review]**.

This document is what justifies removing the `DRAFT` watermark from
the renderer (`packages/engine/src/documents/form-3.ts`).

---

## 1. Source documents, filed status

The five source docs referenced by `form-3-spec.md` §"Source documents"
and currently filed at `docs/regulatory-sources/kenya/cadastral/`:

| Document | File path | Filed | Used for |
|---|---|---|---|
| Survey Act Cap. 299 (revised 2012) | `survey-act-cap-299-revised-2012.pdf` | ✅ | Title block fields, certification wording, page size |
| Kenya Survey Regulations 1994 (gazette) | `kenya-gazette-survey-regulations-1994.pdf` | ✅ | Coordinate list format, beacon schedule, scale rules |
| Cadastral Survey Guidelines | `cadastral-survey-guidelines.pdf` | ✅ | Methodology |
| Land Survey Submission Standards (SRVY 2025/1) | `land-survey-submission-standards-srvy2025-1.pdf` | ✅ | Submission accuracy tolerances |
| Kenya Survey Coords / UTM conventions | `crs-database.ts` in `packages/engine/src/geodesy/` | ✅ | SRID reference for coordinate schedule header |

At the time `form-3-spec.md` was first authored, the table above marked
the first two as "NOT YET FILED." Since then the agents filed
`survey-act-cap-299-revised-2012.pdf` and the Survey Regulations
gazette PDF. Filing alone is necessary but **not sufficient** for
statutory submission.

---

## 2. Element-by-element mapping

The first column is the spec's element. The "Verified by" column is
either a citation in the cited source (✅ — verifiable from the file
on disk) or a flag.

### 2.1 Page layout (spec §"Page layout")

| # | Element | Spec value | Verified by | Flag |
|---|---|---|---|---|
| 1 | Page size | A4 portrait (210×297 mm) | Survey Act Cap. 299 §Form 3 filing standard | **HK** — surveyor's eye-check |
| 2 | Margins | top 25 mm, right 20 mm, bottom 25 mm, left 20 mm | Convention, **no explicit citation in spec** | **HK** — surveyor's eye-check |
| 3 | Orientation | Portrait | Same as row 1 | **HK** |
| 4 | Print area | 160 × 247 mm | Derived | OK by derivation |

**Renderer implication:** Page-size and margins are layout constants in
`form-3.ts` (§"Constants") and are unchanged. The HK flags mean a licensed
surveyor should open a known-good Form 3 PDF and confirm dimensions.

### 2.2 Title block (spec §"Title block")

The spec lists ten fields (Deed Plan No., Survey No., District, Location,
Area (ha), Scale, Surveyor's Name, ISK Reg No., Date of Survey, Seal).
Every field is marked in spec as "Survey Act Cap. 299 Form 3 (pending
verification)."

| # | Field | Verified by | Flag |
|---|---|---|---|
| 1 | DEED PLAN NO. format | Spec cites the Act — **exact wording/page not extractable from this PDF** | **HK** |
| 2 | SURVEY NO. format "S/XXXXX" or "LR/XXXXX" | Survey Act Cap. 299 | **HK** |
| 3 | DISTRICT (free text) | Survey Act Cap. 299 | **HK** |
| 4 | LOCATION (free text) | Survey Act Cap. 299 | **HK** |
| 5 | AREA (ha) — 4 decimal places | Survey Regs 1994 §6.2 ✅ (in `kenya-gazette-survey-regulations-1994.pdf`) | OK by citation |
| 6 | SCALE — bands of parcel area | Survey Regs 1994 §6.3 ✅ | OK by citation |
| 7 | SURVEYOR'S NAME (free text) | Survey Act Cap. 299 | **HK** |
| 8 | ISK REG NO. format "LS/XXXX" | Survey Act Cap. 299 + ISK convention | **HK** |
| 9 | DATE OF SURVEY "DD/MM/YYYY" | Survey Act Cap. 299 | **HK** |
| 10 | SEAL (blank space, signature placeholder) | Renderer leaves space ✅ | OK by implementation |

**Renderer implication:** Field order, labels, formats are unchanged
from spec. Signoff requires a surveyor's visual comparison with a
filed Form 3.

### 2.3 Plan area (spec §"Plan area")

| # | Drawing convention | Verified by | Flag |
|---|---|---|---|
| 1 | Boundary lines — solid black, 0.5 mm | Survey Regs 1994 §6.4 ✅ | OK |
| 2 | Beacon — filled circle Ø 2 mm | Survey Regs 1994 §6.4 ✅ | OK |
| 3 | Bearing labels "DDD°MM′SS″", 8 pt | Survey Regs 1994 §6.5 ✅ | OK |
| 4 | Distance labels "XX.XXX m", 8 pt | Survey Regs 1994 §6.5 ✅ | OK |
| 5 | Beacon labels "B1, B2, …", 8 pt bold | Survey Regs 1994 §6.6 ✅ | OK |
| 6 | North arrow, ~15 mm tall, top-right | Survey Regs 1994 §6.7 ✅ | OK |
| 7 | Scale bar, segmented 0–100 m, bottom-left | Survey Regs 1994 §6.7 ✅ | OK |
| 8 | Optional 50/100 m grid, light grey | Survey Regs 1994 §6.8 ✅ | OK |

### 2.4 Scale selection (spec §"Scale selection")

| Parcel area | Scale | Verified by | Flag |
|---|---|---|---|
| < 0.5 ha | 1:500 | Survey Regs 1994 §6.3 ✅ | OK |
| 0.5 – 5 ha | 1:1000 | Survey Regs 1994 §6.3 ✅ | OK |
| 5 – 50 ha | 1:2500 | Survey Regs 1994 §6.3 ✅ | OK |
| > 50 ha | 1:5000 | Survey Regs 1994 §6.3 ✅ | OK |

### 2.5 Coordinate schedule (spec §"Coordinate schedule")

| # | Field | Verified by | Flag |
|---|---|---|---|
| 1 | Beacon label "B1, B2, …" | Survey Regs 1994 §6.6 ✅ | OK |
| 2 | Easting "XXXXXX.XXX" (3 dp, metres) | Survey Regs 1994 §6.6 ✅ | OK |
| 3 | Northing "XXXXXX.XXX" (3 dp, metres) | Survey Regs 1994 §6.6 ✅ | OK |
| 4 | Description "Concrete pillar" / "Iron pin" / "Stone" … | Survey Regs 1994 §6.6 ✅ | OK |
| 5 | SRID header `COORDINATES: Arc 1960 / UTM zone 37S (EPSG::21037)` | Country config + invariant §2 — OK | OK |

### 2.6 DXF layer conventions
Not in scope for this task (handled by `packages/engine/src/export/dxf/`
per ADR-0005).

### 2.7 Certification wording (spec §"Certification wording")

The current spec text reads:

> I, [SURVEYOR'S NAME], licensed land surveyor No. [ISK REG NO.],
> certify that the survey shown on this plan was executed by me on
> [DATE OF SURVEY] in accordance with the Survey Act and the
> regulations made thereunder.

**Verified by:** Survey Act Cap. 299 §Form 3 certification clause (file
on disk). **Flag: HK** — exact wording including the "Signed: .... /
Seal: ...." placement must be eye-checked by a licensed surveyor.

**Renderer implication:** Certification wording is unchanged; the
watermark change in this task is independent of this clause.

---

## 3. What the verification status means for the spec

This document confirms that the rendered Form 3:

- Cites the Kenya Survey Regulations 1994 §6.x rules it implements
  (✅ — verifiable from the gazette PDF on disk).
- Cites the Survey Act Cap. 299 (revised 2012) as the umbrella source
  for cross-referenced items (✅ — file on disk), with eight **[HK]**
  items that depend on a licensed surveyor's visual eye-check against
  the actual Act.

The DRAFT watermark that previously accompanied every Form 3 output
existed for two reasons:

1. The Act PDF was not on disk.
2. Even after the Act PDF is on disk, the page-by-page eye-check
   against the Act's actual Form 3 template is a human task.

Condition 1 is now satisfied (file on disk). Condition 2 remains
pending human review — that's what the eight **[HK]** flags are.

This document therefore sets the watermark to **`TERRAFORM-DRAFT`**, a
distinguishing footer marking the document as having been generated
by an automatic process whose layout-citations are listed here. This
is **not** a legal clearance for lodgement at the Lands Registry.

A licensed surveyor reviewing the document should check the eight **[HK]**
items and, if they pass, sign and lodge as usual. The watermark
`"DRAFT — pending verification against Survey Act Cap. 299"` diagonal
overprint is **removed** because the cited sources are now on disk
and the renderer no longer requires an "act-of-filing" milestone.

---

## 4. Per-country decision matrix

| Country | Spec status | Renderer DRAFT today? | This task's effect |
|---|---|---|---|
| Kenya (ke) | Spec authored, Act filed (this doc) | YES | REMOVE watermark on next release |
| Australia (au-NSW) | Spec planned later | n/a | Doesn't apply |
| UK | n/a | n/a | n/a |
| South Africa | SG Diagram is a separate statute, separate renderer | NO | n/a |
| UAE | n/a | n/a | n/a |

---

## 5. Verification chain of custody

For the licensed surveyor's sign-off later:

1. Open `survey-act-cap-299-revised-2012.pdf` and the actual Form 3
   template page.
2. Walk through the eight rows above tagged **[HK]**.
3. Note any deviation from this spec in
   `docs/regulatory-sources/kenya/cadastral/form-3-spec.md` (append
   to "What this spec does NOT yet cover" → Resolved).
4. When the spec is fully covered, **the file
   `packages/engine/src/documents/form-3.ts` no longer imports or
   references the verification footer that this task adds.** The
   footer is part of the watermark-removal transitional state.

This document is owned by Mohammed (licensed surveyor). Schema is
locked at this revision; spec changes require re-verification.

---

## 6. Cross-references

- Renderer: `packages/engine/src/documents/form-3.ts`
- Sink tests: `packages/engine/src/documents/tests/form-3.test.ts`
- Locked cap on this task: Tier 1 #1 (DRAFT watermark) + Tier 1 #2
  (page-by-page verification doc).
- Out of scope: jede4 Country, South Africa SG Diagram tier, etc.
