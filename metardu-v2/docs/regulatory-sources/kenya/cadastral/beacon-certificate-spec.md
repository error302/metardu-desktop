# Beacon Certificate Specification

**Status:** DRAFT — pending filing of specimen Beacon Certificate template from
Survey Act Cap. 299 / Survey Regulations 1994. Every layout element cites source
page/clause or is flagged [HK-PENDING-SPECIMEN] per invariant B2. Renderer draws
DRAFT watermark until a licensed surveyor eye-checks the specimen.

**Citation:** Survey Act Cap. 299 (Laws of Kenya), ss.24, 41, 45(1)(c); Kenya
Survey Regulations 1994 (Kenya Gazette No. 26, 27 May 1994), Regulation 12
(beacons), plus Regulation 6–7 coordination. Supplementary: Cadastral Survey
Guidelines.

**Renderer:** `packages/engine/src/documents/beacon-certificate.ts`

**Country config:** `packages/country-config/src/countries/kenya.ts`
BEACON_CERTIFICATE (pageSize A5, sourcePath survey-regulations-1994.pdf)

---

## What a Beacon Certificate is

A Beacon Certificate is issued for each new beacon placed (or re-established)
during a cadastral survey. It records:

- Beacon reference label (e.g. "B1")
- Parcel reference (LR / survey number the beacon belongs to)
- Beacon mark type (concrete pillar, iron pin, stone, etc.)
- Coordinates (E, N) in the project's SRID
- Beacon description (physical mark details, witness marks, depth)
- Owner name (optional)
- SRID / coordinate system label
- Date placed, witnesses (if any)
- Surveyor name, ISK reg. no., date, signature space and seal

It is a text-only certificate (no plan area), typically A5, and is lodged
with the deed plan / mutation plan as supporting evidence that the beacons
were physically placed.

One PDF per beacon. A 4-beacon parcel therefore yields four certificates
(one per beacon) — or a combined sheet when batched.

---

## Source documents

| Document | File | Used for |
|----------|------|----------|
| Survey Act Cap. 299 ss.24 (survey marks), 41 (offences re beacons), 45(1)(c) (regulations power) | `survey-act-cap-299-revised-2012.pdf` | Statutory basis that beacons must be placed and certified [HK-PENDING-SPECIMEN for form layout — cited for lineage only] |
| Kenya Survey Regulations 1994, Reg. 12 + Reg. 6–7 | `kenya-gazette-survey-regulations-1994.pdf` | Beacon certificate content, coordinate format (3 dp, §6.6), beacon symbol/description (§6.4, §6.6), area 4 dp not relevant here |
| Kenya Survey Regulations 1994 §6.2–§6.8 | same | Coordinate system header, scale not applicable (text-only) |
| Cadastral Survey Guidelines | `cadastral-survey-guidelines.pdf` | Methodology for beacon placement (informative) |
| Land Survey Submission Standards SRVY2025-1 | `land-survey-submission-standards-srvy2025-1.pdf` | Submission context |
| Working diagrams | `reference/4-acres-working-diagram.pdf` | Beacon label precedent [HK — illustrative] |
| Country config + CRS DB | `packages/country-config/src/countries/kenya.ts` (BEACON_CERTIFICATE), `packages/engine/src/geodesy/crs-database.ts` | SRID, pageSize A5, margins, titleBlockFields, professionalBody pattern |

Per invariant B1, the Survey Regulations 1994 PDF is now on disk, but the
Beacon Certificate specimen template (the actual single-page certificate form)
has not been isolated and eye-checked. Layout is therefore DRAFT.

---

## Page layout

| Element | Value | Source |
|---------|-------|--------|
| Page size | A5 portrait (148 x 210 mm) — renderer also accepts A4 rendering; spec says A5 per BEACON_CERTIFICATE.pageSize but renderer outputs A4 for print compatibility | Country config BEACON_CERTIFICATE.pageSize "A5" [HK-PENDING-SPECIMEN — A5 vs A4 pending specimen; renderer outputs A4 with A5 content centred and notes the spec variance in footer] |
| Rendered page | A4 portrait (210 x 297 mm) with A5 content centred and bordered | This spec §Implementation notes — invariant: renderer uses A4 for pdf-lib consistency; visual A5 is a print hint [HK] |
| Margins | top 20 mm, right 15 mm, bottom 20 mm, left 15 mm (A4 outer); inner certificate border inset 10 mm | Standard statutory margins [HK-PENDING-SPECIMEN — specimen margins pending] |
| Orientation | Portrait | BEACON_CERTIFICATE pageSize "A5" convention [HK] |
| Header | "REPUBLIC OF KENYA" 10 pt bold + "BEACON CERTIFICATE" 11 pt bold + "Survey Act Cap. 299 — Survey Regulations 1994, Reg. 12" 7 pt | Country config BEACON_CERTIFICATE.titleBlockFields + Survey Regs Reg.12 [HK-PENDING-SPECIMEN — exact header wording pending specimen] |
| Certificate table | Bordered table, 9 rows, 2 columns (Field | Value), row height ~12 mm, header row light gray | Pattern from form-3-spec; exact row order [HK] |
| Coordinate row | "E XXXXXX.XXX   N YYYYYYY.YYY   (EPSG::ZZZZZ — Arc 1960 / UTM zone 37S)" — 3 dp | Survey Regs 1994 §6.6 |
| SRID label | "COORDINATES: {name} (EPSG::XXXXX)" — read from country config via KENYA projectionZones | Invariant A2 |
| DRAFT watermark | Diagonal "DRAFT — NOT FOR LODGEMENT (HK-PENDING-SPECIMEN)" opacity 0.15, 38 pt Helvetica-Bold, rotated 45 deg, centred | Invariant B1/B2 — required until specimen eye-checked (this spec) |
| Verification footer | HK count + "Layout cites: Survey Act Cap.299 ss.24/41/45(1)(c) & Survey Regs 1994 Reg.12/§6.6 — [HK] items pending specimen" | This spec §Verification footer; invariant B2 |
| Seal placeholder | "Seal: [ISK SEAL]" bottom-right, blank space 25 x 25 mm | Survey Act Cap.299 [HK] |

---

## Certificate table — field order

The table lists one beacon. Fields top-to-bottom:

| # | Field | Value format | Source |
|---|-------|--------------|--------|
| 1 | BEACON REFERENCE NO. | e.g. "B1" — upper-case alphanumeric, caller-supplied | Survey Regs 1994 Reg.12; BEACON_CERTIFICATE.titleBlockFields[0] [HK for exact label text] |
| 2 | PARCEL NO. (LR / Survey No.) | e.g. "LR 12345/68" or "S/12345" | Survey Regs 1994 Reg.12 [HK] |
| 3 | OWNER NAME | Free text, optional; blank if omitted (rendered "—") | BEACON_CERTIFICATE.titleBlockFields; Survey Act ss.28–29 [HK] |
| 4 | BEACON TYPE (mark) | e.g. "Concrete pillar", "Iron pin", "Stone", "Pipe" — caller supplies markType | Survey Regs 1994 §6.4 + Reg.12 [HK for allowed vocabulary] |
| 5 | COORDINATES (E, N) | E "XXXXXX.XXX" N "YYYYYYY.YYY" 3 dp, plus SRID line below | Survey Regs 1994 §6.6 |
| 6 | SRID / CRS | "Arc 1960 / UTM zone 37S (EPSG::21037)" or "SRID 21037" fallback | Invariant A2 — country config |
| 7 | BEACON DESCRIPTION | Free text — witness marks, depth, reference ties | Survey Regs 1994 §6.6 Description column [HK for length] |
| 8 | DATE PLACED | YYYY-MM-DD input rendered DD/MM/YYYY — the surveyor's dateOfSurvey defines this; certificate shows it as "Date placed" | Survey Regs 1994 Reg.12 [HK] |
| 9 | WITNESSES | Blank space "_______________________" (caller to fill with witnesses) | Survey Regs 1994 Reg.12 [HK] |

Renderer draws field names in Helvetica-Bold 7 pt (small cap) at left of
row, values in Helvetica 9 pt at right/centre. Borders 0.5 pt black,
header row 0.92 gray.

Additional rows drawn below the table:

- Certification wording block (see below)
- Seal placeholder + signature line

All text sanitised to ASCII (Helvetica standard fonts — per invoice-pdf
pattern). Degree symbols not used here; no bearing/distance.

---

## Coordinate schedule note (single-beacon)

Unlike Form 3/4, the Beacon Certificate has no plan area and no bearing/
distance labels. The single-beacon coordinate is shown as a prominent row
in the certificate table, duplicated in a small "Coordinate schedule" footer
note for datum traceability:

```
Coordinate schedule (single beacon): B1  E 257100.000  N 9857700.000
Datum: Arc 1960 / UTM zone 37S (EPSG::21037) — per KENYA geodeticFramework.
```

Source: Survey Regs 1994 §6.6; invariant A2.

---

## Certification wording (bottom of certificate)

> I, [SURVEYOR'S NAME], licensed land surveyor No. [ISK REG NO.],
> certify that the beacon described above — mark type "[MARK TYPE]",
> at coordinates E [EASTING] N [NORTHING] (SRID [SRID]) on parcel
> [PARCEL REF] — was placed / re-established by me on
> [DATE OF SURVEY] in accordance with the Survey Act Cap. 299
> (s.24) and the Survey Regulations 1994 (Reg. 12).
>
> Owner (where stated): [OWNER NAME]
>
> Signed: _______________________      Date: [DATE]
> Seal:   [ISK SEAL]

Source: Survey Act Cap.299 s.24 + Survey Regs 1994 Reg.12 [HK-PENDING-
SPECIMEN — exact certification phrasing including "re-established" and
owner line pending specimen; current wording is professional-practice
synthesis].

Renderer marks this block "[HK]" in the verification footer note.

---

## Verification footer (bottom of page)

Small 7.5 pt gray footer with thin rule above (same style as Form 3/4):

```
Layout cites: Survey Act Cap.299 ss.24/41/45(1)(c) and Survey Regs
1994 Reg.12 / §6.6; DRAFT watermark — [HK] items pending Beacon
Certificate specimen (HK count: N). A4 rendered; A5 content per
BEACON_CERTIFICATE.pageSize [HK].
```

HK count on this spec: **9** (page size A5 vs A4 rendered, margins,
orientation, header wording, field order (5 HK-flagged rows), certification
wording, seal placement).

Renderer's `hkItemCount` returns 9; footer draws "HK items: 9".

---

## DXF companion

Beacon Certificates are text-only — they have no DXF companion geometry
beyond a single point. The workflow may export a "beacon point" DXF with
one BEACON layer circle + TEXT-COORDS label for the single beacon, but the
statutory DXF layers (BOUNDARY etc.) are not applicable. The renderer does
not export a multi-layer DXF; it focuses on the PDF certificate.

If a DXF companion is requested, the surveyor should use Form 3/4 DXF
(which contains all beacons including this one). This certificate's beacon
appears as one BEACON entry in the Form 3/4 DXF.

Therefore: no `generateBeaconCertificateDxf` exported. The test harness
does not assert DXF layers for beacon certificates.

---

## What this spec does NOT yet cover

1. Exact field order — conventional but may not match the gazetted template.
2. Exact header wording — whether "Republic of Kenya" appears, whether the
   coat of arms appears, whether the certificate number field is on the form.
3. Page size — A5 per country config vs A4 rendered; specimen must resolve.
4. Beacon type vocabulary — allowed mark types per ISK (concrete pillar,
   iron pin, stone, pipe, beacon plate, etc.).
5. Whether a sketch inset is required (small plan showing beacon relative to
   parcel boundary).
6. Whether witness signature lines are on the certificate or on a separate
   field note.
7. Certification wording — exact statutory phrasing including Swahili
   bilingual if required.

Until the Beacon Certificate specimen is filed and eye-checked, the renderer
is DRAFT and must not be lodged.

---

## Implementation notes for the renderer

- Input validation via `workflows/validation.ts`: label non-empty, finite
  easting/northing, markType/description/parcelRef non-empty, ownerName
  optional but if supplied non-empty, srid valid 1024–32767, surveyor
  name/iskRegNo/dateOfSurvey validated as for Form 3 (pattern ^LS/\d{3,5}$,
  case-insensitive).
- SRID from country-config — never literal 21037 outside country-config +
  crs-database + tests (invariant A2). Header SRID lookup via KENYA zones.
- All text sanitised to ASCII (`sanitizeAscii`) for Helvetica standard fonts.
- Every decision cites a source per invariant B2; unverifiable decisions carry
  [HK] and contribute to hkItemCount = 9.
- DRAFT watermark: opacity 0.15, diagonal 45 deg, centred, drawn before
  content so it sits behind text.
- Certificate table: bordered rectangle with interior horizontal rules (0.5 pt)
  and light-gray header band for the beacon label row.
- Certification block + seal placeholder drawn below the table, with
  signature line "Signed: _______________________"
- Page size: A4 portrait in pdf-lib (consistent with other renderers); visual
  A5 content is centred with an inner border to signal the intended stock size.
  Footer notes "A4 rendered; A5 per BEACON_CERTIFICATE.pageSize [HK]".

---

## Cross-references

- Renderer: `packages/engine/src/documents/beacon-certificate.ts`
- Tests: `packages/engine/src/documents/tests/beacon-cert.test.ts`
- Country config: `packages/country-config/src/countries/kenya.ts` BEACON_CERTIFICATE
- Form 3 spec (pattern): `docs/regulatory-sources/kenya/cadastral/form-3-spec.md`
- Form 4 spec (sibling): `docs/regulatory-sources/kenya/cadastral/form-4-spec.md`
