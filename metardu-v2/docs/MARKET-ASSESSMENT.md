# MetaRDU Desktop — Honest Market Assessment

**Date:** 20 Jul 2026
**Author:** Recovery agent

---

## Can MetaRDU compete in the market?

**Not yet. But it's closer than you think.**

Here's the honest truth — what works, what's broken, and what needs to happen
before a real surveyor can use this app to bill a client.

---

## What we have (verified, tested, working)

| Capability | Status | Tests |
|-----------|--------|-------|
| Rust sidecar (32 IPC methods) | ✅ Working | 91 |
| Geodesy: ECEF, Helmert, TM/UTM projection | ✅ Working | 12 |
| COGO: traverse, intersections, areas | ✅ Working | 18 |
| Least-squares adjustment (distances) | ✅ Working | 5 |
| 5 country configs (KE/AU/GB/ZA/AE) | ✅ Working | 100 |
| Form 3 PDF renderer (Kenya deed plan) | ✅ Working (DRAFT) | 14 |
| DXF output (4 generators: Form 3, topo, engineering, sectional) | ✅ Working | 14 |
| 6 workflows (cadastral, topo, engineering, setting-out, sectional, drone) | ✅ Working | 46 |
| SVG SurveyCanvas (TIN/contours/boundaries) | ✅ Working | — |
| OpenLayers MapView (satellite/street/topo) | ✅ Working | — |
| Code-splitting (initial load ~248KB) | ✅ Working | — |
| Property-based tests (fast-check) | ✅ Working | 8 |
| Input validation (NaN/collinear/degenerate) | ✅ Working | 43 |
| Lucide SVG icons (no emojis) | ✅ Working | — |
| Electron app (branded, sandboxed, packaged) | ✅ Working | — |

**Total: 716 tests passing across 7 suites.**

---

## What's holding MetaRDU back (the brutal truth)

### 1. No instrument data import — THE KILLER GAP

**This is the #1 reason no surveyor can use MetaRDU today.**

A surveyor's workflow starts with connecting their instrument (Total Station,
GNSS receiver, level) and downloading field data. MetaRDU Desktop has ZERO
instrument import capability. The sidecar's `import/` module is listed in the
master plan (Section 2) but was never built.

The UK surveyor profile you shared uses:
- **Trimble GPS** — needs RINEX import + Trimble JOB/DC file parsing
- **Total Station** — needs Leica GSI, Sokkia SDR, Trimble JOB parsing
- **Mala GPR** — needs GPR data integration for utility mapping

Without these, the app is a calculator, not a surveying tool.

### 2. No sync with metardu web

The web app has 206 pages, a full database, user auth, billing, and project
management. The desktop app has none of that. A surveyor who starts a project
on the web app can't continue it on the desktop app (or vice versa). The
mobile app (metardu-access) already has sync — the desktop app needs the same.

### 3. No digital signing

Every statutory plan needs a surveyor's seal/signature. metardu web has
`/digital-signature`. The desktop app generates PDFs with a blank
"Signed: _______________________" line. No surveyor can submit a plan like
that.

### 4. The Form 3 is still DRAFT

Every PDF carries a "DRAFT — pending verification against Survey Act Cap. 299"
watermark. The Act is now filed, but the spec hasn't been page-by-page verified
against the actual form templates. A surveyor can't submit a DRAFT plan.

### 5. No production Windows build

The sidecar binary is compiled for Linux. The Windows .exe installer would
ship a Linux binary that Windows can't run. Phase 7 documented this but didn't
fix it — Windows cross-compilation of the Rust sidecar (with GDAL) is
non-trivial.

### 6. No GPR/utility mapping module

The UK surveyor's core skill is Utility Mapping with Mala GPR. MetaRDU has
zero GPR integration. This is a significant market gap — utility mapping is
the highest-paying surveying niche in the UK.

### 7. No real-world testing

No surveyor has ever used this app. The math is verified against published
references (EPSG, Pix4D, pyproj), but no one has taken it into the field and
used it to produce a plan that was submitted to a lodging authority.

---

## What can we do better?

### Immediate (next 2 sessions):

1. **Build instrument import** — Leica GSI, Trimble JOB, Sokkia SDR, RINEX
2. **Build sync with metardu web** — REST API client for project sync
3. **Build digital signature** — PKI-based plan signing
4. **Remove the DRAFT watermark** — verify the Form 3 spec against the filed Act

### Medium-term (next month):

5. **Windows sidecar cross-compilation** — the #1 platform for paying customers
6. **GPR/utility mapping module** — for the UK utility surveying market
7. **Field data collection mode** — connect to Total Station/GNSS live
8. **Team collaboration** — multi-user project sharing

### Long-term (3-6 months):

9. **Ardhisasa integration** (Kenya) — electronic cadastre submission
10. **RICS compliance** (UK) — measured survey specification compliance
11. **AI plan checker** — automated compliance checking
12. **Mobile companion app** — sync with metardu-access

---

## Is this a reliable app for a surveyor?

**For math and computation: YES.** The geodesy, COGO, and adjustment modules
are verified against published references and have property-based tests. The
least-squares engine carries full variance-covariance propagation with Baarda
blunder detection. This is survey-grade math.

**For statutory output: NO, not yet.** The Form 3 PDF carries a DRAFT
watermark. The DXF output is correct but not yet verified against a real CAD
submission. No plan has been submitted to a lodging authority.

**For field use: NO.** No instrument connection, no live GNSS, no field data
collection. The app is an office tool, not a field tool (yet).

**For reliability: YES.** 716 tests, 94 source files, every module type-
checked, every phase committed and pushed. The architecture is sound (Rust
sidecar + TS engine + Electron shell). The code is clean and documented.

---

## The UK surveyor profile — what MetaRDU can do for them

The surveyor you found:
- **Location:** NE UK
- **Skills:** Utility Mapping, Land Surveying, Trimble GPS, Total Station, Mala GPR
- **Qualification:** Proqual RQF Level 3
- **Role sought:** Lead Surveyor / Project Management
- **Salary:** £35-40k

### What MetaRDU could automate for this surveyor:

1. **Total Station data processing** — import GSI/JOB/SDR files, compute
   traverses, adjust coordinates, generate measured survey plans
2. **GNSS RTK post-processing** — import RINEX, compute baselines, adjust
   network, generate coordinate schedules
3. **Measured survey plan generation** — RICS-compliant PDF + DXF output
   (UK country config already built with RICS tolerances)
4. **Utility mapping integration** — import GPR data, overlay on orthophoto,
   generate utility survey plan (FUTURE — needs GPR module)
5. **Cross-section extraction** — for road/pipeline surveys
6. **Volume computation** — for earthworks projects
7. **Digital plan signing** — RICS-recognized digital signature on plans
8. **Project management** — sync with metardu web for team coordination

### What MetaRDU CANNOT do for this surveyor today:

1. Connect to a Trimble total station or GNSS receiver (no instrument driver)
2. Process GPR data (no GPR module)
3. Generate a UK-compliant measured survey plan (UK country config exists but
   no renderer — the Form 3 renderer is Kenya-specific)
4. Submit plans to HM Land Registry (no NLIS/electronic cadastre integration)
5. Work in the field (no mobile/field mode)

### The path to serving this surveyor:

```
Today: MetaRDU can compute coordinates, adjust traverses, and generate
       DXF files that this surveyor could import into AutoCAD.

Next:  Add Trimble JOB import + UK measured survey plan renderer →
       the surveyor can go from field data to submitted plan without
       leaving MetaRDU.

Future: Add GPR module + live GNSS → full utility mapping workflow.
```

---

## Recommendation

**Focus on the UK market.** Here's why:

1. The UK has the most mature surveying standards (RICS) — if MetaRDU meets
   RICS compliance, it meets the bar for every other country.
2. UK surveyors are paid well (£35-40k+) and would pay for software that saves
   them time.
3. The UK country config is already built (ETRS89, OSGB36, RICS tolerances).
4. The competition (Trimble Business Center, Carlson) is expensive and
   complex — MetaRDU's offline-first, regulation-aware approach is a genuine
   differentiator.

**Build order for the UK market:**
1. Trimble JOB/DC import (most common UK instrument format)
2. UK measured survey plan renderer (RICS-compliant)
3. Digital signature (RICS-recognized)
4. Sync with metardu web
5. GPR utility mapping module

---

*This assessment is honest. The app has strong foundations (716 tests, solid
architecture, 5 countries configured) but cannot be used by a real surveyor
today because it can't import instrument data. Fix that first.*
