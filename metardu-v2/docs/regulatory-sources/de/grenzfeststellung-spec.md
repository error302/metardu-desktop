# Grenzfeststellung — Niederschrift über die Grenzfeststellung (DE) Specification

**Status:** DRAFT — pending filing of per-Bundesland Grenzfeststellung Niederschrift specimen and AdV ALKIS/NTv2 documentation. Every layout element cites source or is flagged `[HK-PENDING-SPECIMEN]` / `[HK-PENDING-NTv2]` per invariant B2. Renderer draws DRAFT watermark until licensed ÖbVI eye-checks specimen.

**Citation:** Vermessungs- und Katastergesetze der Länder (state cadastral acts — e.g. VermKatG NRW, SächsVermKatG); AdV Geodateninfrastruktur specifications (ETRS89/UTM adoption, ALKIS data model, NTV2 grid); Wohnungseigentumsgesetz (WEG) for context.

**Renderer:** `packages/engine/src/documents/de-grenzfeststellung.ts` — `generateDeGrenzfeststellungPdf`

**Country config:** `packages/country-config/src/countries/germany.ts` — `GERMANY.planSheet` and `GRENZFESTSTELLUNG`

---

## What this document is

The *Niederschrift über die Grenzfeststellung* (boundary determination record) is the German statutory protocol that documents the on-site determination of parcel boundaries: the surveyor (Öffentlich bestellter Vermessungsingenieur, ÖbVI), participants, boundary points examined, coordinate list in ETRS89 / UTM, and the legal certification. The companion *Abmarkungsprotokoll* records beacon/marker placement. Together with the *Amtliche Liegenschaftskarte* (ALKIS extract), these form the cadastral submission to the Katasteramt.

Germany is federal — each Bundesland runs its own Katasteramt. The geodetic framework is national via AdV (ETRS89 / UTM since 2001), but template lettering varies by state. This spec targets the national AdV framework (ÖbVI profession) and notes per-state divergences as `[HK]`.

---

## Source documents

| Document | File | Used for |
|----------|------|----------|
| State Vermessungsgesetze — Grenzfeststellung provisions | `docs/regulatory-sources/de/grenzfeststellung-niederschrift.pdf` [HK — not yet filed] | Record authority, participant list, certification |
| AdV Geodateninfrastruktur — ETRS89/UTM adoption | `adv-etrs89-utm.pdf` [HK] | National CRS, UTM zones 32N/33N, GK legacy |
| AdV ALKIS specifications + NTV2 grid documentation | `adv-alkis.pdf`, `adv-ntv2-grid.pdf` [HK-PENDING-NTv2 — grid not bundled] | Cadastral data model, DHDN→ETRS89 datum shift |
| EPSG:25832 / EPSG:25833 (ETRS89/UTM) + EPSG:31467 (DHDN/GK3) + EPSG:1777 (DHDN→ETRS89 7-param) | EPSG registry; `germany.ts:38-75` + `germany.ts:252-267` | CRS definitions, Helmert, NTv2 note |
| Country config + CRS DB | `packages/country-config/src/countries/germany.ts` (`GRENZFESTSTELLUNG`, `GERMANY.planSheet`) | SRID 25832, margins, scaleConvention, dxfLayers, titleBlockLayout |

---

## Page layout — derived from `getCountryConfig("DE").planSheet`

| Element | Value (renderer derives live) | Source |
|---------|-------------------------------|--------|
| Page size | `planSheet.defaultSheetSize = "a4"` → A4 (210 × 297 mm) | `germany.ts:299` |
| Orientation | `planSheet.defaultOrientation = "portrait"` → A4 portrait | `germany.ts:300` |
| Margins | `GRENZFESTSTELLUNG.margins_mm = [25,25,25,25]` | `germany.ts:163` [HK-PENDING-SPECIMEN] |
| Scale convention | `GRENZFESTSTELLUNG.scaleConvention = "1:250, 1:500, 1:1000 (boundary sketches)"` | `germany.ts:164` — boundary sketches [HK] |
| CRS | ETRS89 / UTM zone 32N (EPSG:25832) primary — `primarySRID = 25832`, datum `ETRS89`, ellipsoid `GRS80`, TM central meridian 9°, false easting 500 000 m, northing 0, scale 0.9996; alternative zones UTM 33N (EPSG:25833) + DHDN/GK3 (EPSG:31467, Bessel 1841) | `germany.ts:38-49` + `germany.ts:248-251` |
| AdV framework note | Footer line: "Geodetic framework: ETRS89 / UTM (EPSG:25832) per AdV Geodateninfrastruktur (2001). DHDN (Bessel 1841 / GK) is legacy; see NTv2 note." | AdV specification + `germany.ts:304-305` footerNote |
| DHDN / NTv2 TODO footer | Footer line: "DHDN -> ETRS89 via EPSG:1777 7-param (Position Vector) — verified per EPSG GN7-2 §1.3.11. Survey-grade requires AdV NTv2 grid [HK-PENDING-NTv2]." | `germany.ts:252-267` — Helmert verified in Task 2, but NTv2 not bundled |
| DRAFT watermark | Diagonal "DRAFT -- NOT FOR LODGEMENT (HK-PENDING-SPECIMEN)" opacity 0.15 | Invariant B1/B2 |
| Verification footer | HK count + AdV/EPSG citations + `[HK]` | This spec §Verification footer |

Renderer derives `A4` / `portrait` / `25832` / `ETRS89` from `getCountryConfig("DE").planSheet` + `geodeticFramework` — no hard-coded literals.

---

## Title block — derived from `planSheet.titleBlockLayout.fieldRows`

Field grid mirrors `GRENZFESTSTELLUNG.titleBlockFields` (`germany.ts:165-174`) via `planSheet.titleBlockLayout.fieldRows` (`germany.ts:310-318`), variant `standard` (`germany.ts:309`):

| # | Field label | Token | Source |
|---|------------|-------|--------|
| 1 | GEMARKUNG | `{{gemarkung}}` | ALKIS extract fields — Gemarkung [HK-PENDING-SPECIMEN] |
| 2 | FLUR | `{{flur}}` | same — Flur [HK] |
| 3 | FLURSTÜCK-NR. | `{{flurstueckNr}}` | same [HK] |
| 4 | GEMEINDE | `{{gemeinde}}` | Verwaltung [HK] |
| 5 | LANDKREIS | `{{landkreis}}` | same [HK] |
| 6 | BUNDESLAND | `{{bundesland}}` | Bundesland (e.g. "Nordrhein-Westfalen") [HK] |
| 7 | MASSSTAB | `{{scale}}` → `1:250` / `1:500` / `1:1000` | `GRENZFESTSTELLUNG.scaleConvention` [HK] |
| 8 | DATUM | `{{date}}` | Survey date [HK] |
| 9 | ÖbVI | `{{surveyor}}` — name + ÖbVI Reg. No. | `professionalBody.registrationPattern = ^\d{4,6}$` (`germany.ts:284`) [HK — per-state numbering] |

Header: `planSheet.titleBlockLabel = "BUNDESREPUBLIK DEUTSCHLAND — AMTLICHES VERMESSUNGSWESEN"` (`germany.ts:301`) — sanitised ASCII.

Plan-type: `planSheet.planTypeLabel = "AMTLICHER LAGEPLAN / LIEGENSCHAFTSKARTE"` (`germany.ts:302`) — drawn as sheet title; the Niederschrift heading is `"NIEDERSCHRIFT ÜBER DIE GRENZFESTSTELLUNG"` per `GRENZFESTSTELLUNG.name` [HK-PENDING-SPECIMEN — heading exact wording].

Certification: `planSheet.titleBlockLayout.certification` (`germany.ts:320-326`) — heading `BESCHEINIGUNG`, ALKIS / VermKatG wording [HK-PENDING-SPECIMEN — state law exact phrase].

Seal: `planSheet.titleBlockLayout.seal.position = "bottom-right"`, caption `ÖFFENTLICH BESTELLTER VERMESSUNGSINGENIEUR (ÖBVI)` (`germany.ts:328-331`).

Statutory footer lines: `planSheet.titleBlockLayout.statutoryFooterLines` (`germany.ts:332-337`) — VermKatG offence, AdV, ETRS89 / UTM (EPSG:25832 ff.).

---

## Plan area (boundary sketch)

Central area between title block and coordinate schedule. Shows the parcel boundary and examined Grenzpunkte.

| Element | Convention | Source |
|---------|-----------|--------|
| Boundary | Solid black 0.5 mm, closed | GRENZFESTSTELLUNG sketch [HK-PENDING-SPECIMEN] |
| Grenzpunkte (boundary points) | Filled circle 2 mm + label "GP1" 8pt bold | ALKIS point symbols [HK] |
| Bearing | `DDDdMM'SS"` 7pt (ASCII) | form-3.ts `bearingDMS` |
| Distance | `XX.XXX m` 3 dp | `distanceM` |
| Area | `FLAECHE X.XXXX ha` at centroid | AdV area |
| North arrow | Top-right, 15 mm | form-3 pattern |
| Scale bar | Bottom-left, segmented 0–100 m | same |

Scale: depends on Gemarkung sketch size — `1:250` (urban), `1:500`, `1:1000`. Renderer selects `1:250` (<0.5 ha), `1:500` (0.5–5 ha), `1:1000` (>5 ha) [HK-PENDING-SPECIMEN — scale rule from convention]. Auto-fits via `makePlanTransform`.

---

## Coordinate schedule

Bordered table. Columns: Punkt-Nr. (GP) | Rechtswert (E, UTM) | Hochwert (N, UTM) | Art / Bemerkung. Header: `ETRS89 / UTM zone 32N (EPSG::25832)` or `SRID {srid}` — invariant A2 (SRID from `GERMANY.geodeticFramework.projectionZones`).

The renderer also prints the AdV framework note below the header:

> Koordinaten in ETRS89 / UTM (EPSG:25832), AdV Geodateninfrastruktur (2001). DHDN (Bessel 1841) legacy per GK — transformation EPSG:1777 noted below.

---

## Certification (bottom of sheet)

`planSheet.certification` BESCHEINIGUNG wording plus the Grenzfeststellung-specific clause:

> Hiermit wird bescheinigt, dass die Grenzfeststellung ... nach den Vorschriften der Vermessungs- und Katastergesetze und des ALKIS-Datenmodells (AdV) durchgeführt wurde. Teilnehmer: [HK-PENDING-SPECIMEN — participant wording].

Participant / witness lines drawn as `[HK]` placeholders where specimen not filed.

---

## Special footers — AdV / NTv2 / DHDN

Two mandatory footer lines beyond the standard verification footer:

1. **AdV / ETRS89 framework note:** `"Geodetic framework: ETRS89 / UTM (EPSG:25832) per AdV Geodateninfrastruktur (2001). DHDN (Bessel 1841 / GK zone 3, EPSG:31467) is legacy."` — cites `germany.ts:248-251` + AdV.

2. **DHDN TODO / NTv2 grid pending:** `"DHDN -> ETRS89 via EPSG:1777 (tx 598.1 ty 73.7 tz 418.2 rx 0.202 ry 0.045 rz -2.455 s 6.7 ppm, Position Vector) — Verified against EPSG GN7-2 §1.3.11 / AdV control point. Survey-grade requires AdV NTv2 (BeTA2007) grid [HK-PENDING-NTv2]."` — cites `germany.ts:252-267` + Task 2 verification result.

Both are drawn in 7 pt grey above the verification footer. They are NOT marked DONE — the NTv2 grid is not yet bundled (sidecar still uses coarse Helmert only). Until the grid is verified and bundled, the DHDN transformation is coarse.

---

## Verification footer

Gray 6.5 pt footer (same position as other renderers):

```
Layout cites: VermKatG (state) & AdV ETRS89/UTM & ALKIS & EPSG:25832/1777/31467
— ETRS89/UTM primary, DHDN legacy — DHDN->ETRS89 Helmert verified [HK-NTv2 pending].
HK items: 10 pending per-Bundesland specimen.
DRAFT watermark — NOT FOR LODGEMENT. [HK-PENDING-SPECIMEN]
Source: grenzfeststellung-spec.md — verification required before lodgement.
```

HK count: **10** (page size derived OK, but field Gemarkung/Flur labels, heading exact phrase, participant clause, per-state template variance, DHDN wording, NTv2 grid, margin 25 vs Katasteramt print, certification exact phrase, scale 1:250 rule, ALKIS terminology pending per-Bundesland specimen).

Renderer's `hkItemCount` returns 10; footer draws `HK items: 10` plus the two AdV/NTv2 special lines.

---

## DXF companion

Layers per `GRENZFESTSTELLUNG.dxfLayers` (`germany.ts:175-183`): `BOUNDARY`, `BEACON`, `TEXT-COORDS`, `TEXT-AREA`, `TITLE-BLOCK`, `NORTH-ARROW`, `SCALE-BAR`.

---

## What this spec does NOT yet cover

1. Per-Bundesland certification wording differences (NRW vs Bayern vs Sachsen).
2. Whether the Niederschrift includes a separate participant signature page.
3. Language: standard German vs state administrative phrasing.
4. Parcel identifier syntax: Gemarkung (numeric) vs name.
5. Whether Flurstück numbers include the 0000/000 style with leading zeros.

Until the per-Bundesland specimen is filed and eye-checked, the renderer is DRAFT. The DHDN transformation remains coarse Helmert — the AdV NTv2 grid (BeTA2007) is `[HK-PENDING-NTv2]` and must be bundled for survey-grade legacy work.

---

## Cross-references

- Renderer: `packages/engine/src/documents/de-grenzfeststellung.ts`
- Tests: `packages/engine/src/documents/tests/de-grenzfeststellung.test.ts`
- Country config: `packages/country-config/src/countries/germany.ts`
- Helmert verification: `packages/metardu-sidecar/src/geodesy/helmert.rs` (Task 2)
- Existing German config: `packages/country-config/src/countries/germany.ts` — `GERMANY.geodeticFramework.legacyDatums[0].helmert`
- CRS: EPSG:25832 — ETRS89 / UTM zone 32N; EPSG:31467 — DHDN / GK3
