# LRA-27 — Application for Official Search / Mutation (Land Registration Act) Specification

**Status:** DRAFT — pending filing of filed LRA-27 specimen from the Ministry of
Lands (Ardhi House). Every layout element cites source page/clause or is flagged
[HK-PENDING-SPECIMEN] per invariant B2. Renderer draws DRAFT watermark until a
licensed surveyor eye-checks the specimen.

**Citation:** Land Registration Act No. 3 of 2012 (Laws of Kenya), Form LRA-27
(Mutation / Application for Subdivision — triplicate). Structure derived from
`docs/regulatory-sources/kenya/forms/form-lra-27-mutation-form.doc` (.doc working
template filed on disk) and the Survey Act Cap. 299 ss.28–29 mutation linkage.

**Renderer:** `packages/engine/src/documents/lra27-mutation.ts`

**Country config note:** LRA-27 is not a geodetic plan (no coordinates); it is a
registry form that references deed plans. SRID/title-block scale conventions do
not apply. The form is drawn A4 portrait per the .doc template.

---

## What LRA-27 is

LRA-27 is the Land Registration Act form used to apply for the mutation
(subdivision) of a registered title. The proprietor(s) instruct the Director of
Surveys / licensed surveyor to subdivide the title(s) listed, the surveyor
certifies the new parcel schedule, and the Land Registrar executes the mutation
on the register. Key fields:

- Title number(s) being mutated (one or many)
- Land registry (e.g. "NAIROBI", "KIAMBU", "MOMBASA")
- Proprietor(s): name, ID number, share (if many)
- Instructions to the surveyor (free text — why/what to subdivide)
- Schedule of new parcels: LR number + area (ha) for each resultant parcel
- Surveyor certification: name, ISK/reg. number, date, signature space
- Serial number (optional — registry-assigned; blank on draft)
- Triplicate note: "This form is executed in triplicate"

It is NOT a survey plan — the plan itself is Form 4 (Mutation Plan). LRA-27
travels with Form 4 to the registry.

---

## Source documents

| Document | File | Used for |
|----------|------|----------|
| Land Registration Act No. 3 of 2012, Form LRA-27 | `kenya/forms/form-lra-27-mutation-form.doc` — .doc working template filed on disk | Form table order, field labels, triplicate note, certification phrasing [HK-PENDING-SPECIMEN — .doc is a working template, not the gazetted form; exact gazetted wording/margins pending filed specimen] |
| Survey Act Cap. 299 ss.28–29, 30, 32, 41, 45(1)(c) | `cadastral/survey-act-cap-299-revised-2012.pdf` | Statutory lineage linking mutation survey to LRA; approval chain [HK-PENDING-SPECIMEN for form layout — cited for lineage only] |
| Survey Regulations 1994 | `cadastral/kenya-gazette-survey-regulations-1994.pdf` | Area format 4 dp (§6.2) for new parcel areas |
| Land Registration (General) Regulations 2017 (LRA) | Not filed — cited for triplicate execution practice [HK-PENDING-SPECIMEN] | Triplicate requirement (header note) |
| Country config | `packages/country-config/src/countries/kenya.ts` (LRA context via planSheet / professionalBody) | Surveyor reg. pattern, footer disclaimer |
| Working diagrams | `reference/4-acres-working-diagram.pdf` | Informative only — not used for form layout |

Per invariant B1, the gazetted LRA-27 PDF must be filed before this renderer
is production-ready. The .doc on disk is a working specimen sufficient for a
DRAFT renderer but not for lodgement.

---

## Page layout

| Element | Value | Source |
|---------|-------|--------|
| Page size | A4 portrait (210 x 297 mm) | .doc working template page setup [HK-PENDING-SPECIMEN — gazetted size pending filed PDF specimen] |
| Margins | top 20 mm, right 15 mm, bottom 20 mm, left 15 mm | .doc template [HK-PENDING-SPECIMEN] |
| Orientation | Portrait | .doc template [HK-PENDING-SPECIMEN] |
| Print area | 180 x 257 mm | Derived |
| Header | "REPUBLIC OF KENYA" centred 10 pt bold + "THE LAND REGISTRATION ACT" 9 pt + "FORM LRA-27" 10 pt bold + serial number right-aligned | .doc template structure [HK-PENDING-SPECIMEN — exact header typography pending specimen] |
| Triplicate note | "This form is executed in triplicate." italic 7 pt, immediately below header, centred | .doc template + Land Registration (General) Regulations 2017 [HK-PENDING-SPECIMEN — gazetted phrasing pending] |
| Field tables | Bordered tables, 10–11 pt row height, Helvetica/Helvetica-Bold per Form 3 pattern | Inherited from form-3-spec pattern; exact line weights [HK-PENDING-SPECIMEN] |
| DRAFT watermark | Diagonal "DRAFT — NOT FOR LODGEMENT (HK-PENDING-SPECIMEN)" opacity 0.15, 42 pt Helvetica-Bold, rotated 45 deg, centred | Invariant B1/B2 — required until specimen eye-checked (this spec) |
| Verification footer | HK count + "Layout cites: LRA-27 .doc structure & Survey Act Cap.299 ss.28-29 — [HK] items pending gazetted specimen" | This spec §Verification footer; invariant B2 |

---

## Title block / header

Drawn as a bordered header band at the top (height 22 mm).

| # | Field | Format | Source |
|---|-------|--------|--------|
| 1 | REPUBLIC OF KENYA | Centred, 10 pt bold, upper-case | .doc template [HK] |
| 2 | THE LAND REGISTRATION ACT (No. 3 of 2012) | Centred, 9 pt | .doc template [HK] |
| 3 | FORM LRA-27 — MUTATION / APPLICATION FOR SUBDIVISION | Centred, 10 pt bold | .doc template [HK] |
| 4 | Serial No. | Right-aligned, "Serial No.: _______" or value if supplied (e.g. "LRA27/2026/001") | .doc template [HK] |
| 5 | Triplicate note | "This form is executed in triplicate." italic 7 pt, centred | .doc + LRA General Regs 2017 [HK] |

Renderer draws the header border 1 pt black, with thin dividers between
sub-lines. All text ASCII-only (Helvetica standard fonts).

---

## Form tables (middle of page)

### Table 1 — Title & Registry

| # | Field | Format | Source |
|---|-------|--------|--------|
| 1 | Title number(s) | One or more, e.g. "LR 12345/67" listed vertically | .doc Table 1 [HK-PENDING-SPECIMEN — delimiter/prefix exact form pending] |
| 2 | Land registry | Free text, e.g. "NAIROBI" | .doc Table 1 [HK] |
| 3 | Number of titles | Derived count badge "(N title(s))" | Derived — not in doc, for verification only [HK] |

### Table 2 — Proprietors

Columns: Name | ID Number (optional) | Share (optional, e.g. "1/2", "Joint")

| # | Field | Format | Source |
|---|-------|--------|--------|
| 1 | Proprietor name(s) | One row per proprietor, free text | .doc Table 2 [HK] |
| 2 | ID number | Kenya national ID or passport; optional; blank if omitted | .doc Table 2 [HK] |
| 3 | Share | e.g. "Equal", "1/2", "Joint" | .doc Table 2 [HK] |

If no proprietors array is supplied the renderer throws (validation).

### Table 3 — Instructions to Surveyor

Single bordered text block labelled "INSTRUCTIONS TO THE SURVEYOR / DIRECTOR
OF SURVEYS":

> Free text, e.g. "Subdivide LR 12345/67 into three parcels as shown on the
> attached Mutation Plan (Form 4). New parcel numbers LR 12345/68, /69, /70."

Source: .doc Table 3 [HK-PENDING-SPECIMEN — label wording pending specimen].
Renderer wraps text at 85 characters with 1.3 line height.

### Table 4 — Schedule of New Parcels

Bordered table with columns: LR Number | Area (ha) — 4 dp

| # | Field | Format | Source |
|---|-------|--------|--------|
| 1 | LR Number | e.g. "LR 12345/68" | .doc Table 4 [HK] |
| 2 | Area (ha) | "X.XXXX ha" — 4 decimal places | Survey Regs 1994 §6.2; .doc column heading [HK for heading text] |
| 3 | Footer total | "TOTAL: Y.YYYY ha (N parcel(s))" | Derived — sum of areas for cross-check hint [HK] |

Renderer validates each area > 0 and finite; non-positive throws.

---

## Certification / Surveyor block (lower middle)

Bordered block below the schedule:

| # | Field | Format | Source |
|---|-------|--------|--------|
| 1 | Surveyor name | Free text, e.g. "Jane Wanjiru" | .doc certification block [HK] |
| 2 | Registration number | "LS/XXXX" — validated ^LS/\d{3,5}$ | ISK + .doc block [HK for label text] |
| 3 | Date | YYYY-MM-DD input rendered DD/MM/YYYY | .doc block [HK] |
| 4 | Signature line | "Signed: _______________________" | .doc block [HK] |

Wording (pending gazetted specimen — current is professional-practice synthesis,
marked [HK]):

> I, [SURVEYOR NAME], licensed surveyor No. [REG NUMBER], certify that the
> schedule of new parcels above accords with the mutation survey executed
> by me on [DATE] in accordance with the Survey Act and Land Registration Act.
>
> Signed: _______________________

Source: Survey Act Cap.299 + LRA lineage [HK-PENDING-SPECIMEN — exact
certification phrasing pending gazetted form; .doc wording is the best
available].

---

## Verification footer (bottom of page)

Same position/style as Form 3/Form 4 verification footer — 7.5 pt gray,
with a thin rule above:

```
Layout cites: LRA-27 .doc (filed) & Survey Act Cap.299 ss.28-29 & Survey
Regs 1994 §6.2; DRAFT — [HK] items pending gazetted LRA-27 specimen
(HK count: N). Triplicate execution per LRA General Regs 2017 [HK].
```

HK count on this spec: **12** (page size, margins, orientation, header
typography (3), Table 1 delimiter [HK], Table 2 share column [HK],
Table 3 label [HK], Table 4 heading [HK], certification wording,
triplicate phrasing, footer disclaimer exact text).

Renderer's `hkItemCount` returns 12; footer draws "HK items: 12" and lists
the B2 citation chain.

---

## DXF companion

LRA-27 is a registry form, not a geodetic plan — it has no DXF companion
layers. The mutation geometry lives on the companion Form 4 (Mutation Plan).
The renderer therefore does not export a DXF. The workflow validates that
every LR number in Lra27Input.newParcelsSchedule appears as a Form4 new-parcel
LR when both forms are generated together (cross-document check is the
caller's responsibility; single-document generation does not enforce it).

---

## Certification note and seal

LRA-27 requires the surveyor's signature; the seal impression is on the
companion Form 4, not on LRA-27 itself [HK-PENDING-SPECIMEN — seal placement
pending specimen; some registries stamp both]. Renderer leaves a blank
signature line and does not draw a seal placeholder on LRA-27 (distinguishing
it from Form 3/4).

---

## What this spec does NOT yet cover

1. Exact gazetted field order — .doc order is conventional; gazetted form may
   reorder Title / Registry / Proprietor blocks.
2. Exact header typography — font, size, whether the coat of arms appears.
3. Exact triplicate note phrasing — .doc says "in triplicate"; gazetted may
   say "in triplicate — original to registry, duplicate to surveyor, triplicate
   to proprietor."
4. Whether the District Land Registrar's counter-signature block appears on
   LRA-27.
5. Proprietor ID validation — no checksum; renderer only checks non-empty.
6. Share fraction format — renderer accepts free text; no "1/N" enforcement.
7. Paper stock / security features (watermark, hologram) — out of scope for PDF.

Until the gazetted LRA-27 PDF is filed and eye-checked, the renderer is DRAFT
and must not be lodged.

---

## Implementation notes for the renderer

- Input validation via `workflows/validation.ts`: non-empty titleNumbers,
  registry, proprietor names, instructions, schedule LR numbers; positive
  finite areas; ISK pattern ^LS/\d{3,5}$ (case-insensitive); valid ISO date;
  finite coords not needed (no geometry).
- All text sanitised to ASCII (`sanitizeAscii`) for Helvetica standard fonts.
- Every decision cites a source per invariant B2; unverifiable decisions carry
  [HK] and contribute to hkItemCount.
- DRAFT watermark: opacity 0.15 diagonal centred (same helper as Form 4).
- Each table is a bordered rectangle with interior horizontal rules (0.5 pt) and
  a light-gray header row (RGB 0.92) matching Form 3 style for visual
  consistency across the suite.
- Page is single-page A4; if tables overflow (many titles/proprietors), the
  renderer clips with a warning note and returns `pageCount` 1 (spec keeps
  single-page invariant — multi-page LRA-27 is [HK] pending specimen).

---

## Cross-references

- Renderer: `packages/engine/src/documents/lra27-mutation.ts`
- Tests: `packages/engine/src/documents/tests/lra27.test.ts`
- Companion plan: `docs/regulatory-sources/kenya/cadastral/form-4-spec.md` (Form 4)
- .doc working template: `docs/regulatory-sources/kenya/forms/form-lra-27-mutation-form.doc`
- Form 3 spec (pattern): `docs/regulatory-sources/kenya/cadastral/form-3-spec.md`
