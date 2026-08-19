# Golden Fixtures — Hand-Verified Numeric Test Cases

This directory holds hand-verified or cross-tool-verified numeric test
cases for every regulatory computation in the app. CI runs them. If your
change breaks a fixture, the change is wrong (or the fixture was wrong
and you have an ADR explaining why).

## Naming convention

```
<country>/<computation>__<short-description>.json
```

Examples:
- `kenya/levelling__10sqrt-k-mm-tolerance.json` — verifies 10√K mm
  levelling closure tolerance for K=1km, K=4km, K=25km
- `kenya/angular-misclosure__3-arcsec-per-station.json` — verifies
  3.0″ angular misclosure limit
- `kenya/helmert__wgs84-to-arc1960-roundtrip.json` — round-trip
  WGS84 ↔ Arc 1960 for a known control point
- `kenya/cassini-to-utm37s__known-beacon.json` — Cassini → UTM 37S
  re-establishment for a beacon with known historical coordinates
- `kenya/traverse__bowditch-vs-ls-adjustment.json` — closed traverse
  adjusted both ways, compared against hand-computed reference

## Fixture file format

Each fixture is a JSON file with this shape:

```json
{
  "name": "human-readable name",
  "country": "KE",
  "computation": "levelling-tolerance",
  "source": {
    "document": "Kenya Survey Regulations 1994, Regulation 5.1",
    "page": "Table 5.1",
    "file": "docs/regulatory-sources/kenya/survey-regulations-1994.pdf"
  },
  "inputs": {
    "K_km": 1.0,
    "observed_misclosure_mm": 9.5
  },
  "expected": {
    "tolerance_mm": 10.0,
    "passes": true,
    "margin_mm": 0.5
  },
  "notes": "10√K mm with K in km. K=1km → 10mm; K=4km → 20mm; K=25km → 50mm."
}
```

The `source.document` and `source.file` fields are mandatory. If you
can't cite a source, the fixture is invalid — see invariant B1 in
`docs/invariants.md`.

## Current fixtures (Phase 2 baseline)

| Fixture | Status | Source |
|---------|--------|--------|
| `kenya/levelling__10sqrt-k-mm-tolerance.json` | ✅ Verified | Survey Regs 1994 Table 5.1 |
| `kenya/angular-misclosure__3-arcsec-per-station.json` | ✅ Verified | Survey Regs 1994 §4.3 |
| `kenya/helmert__wgs84-to-arc1960-roundtrip.json` | ✅ Verified | Arc 1960 Helmert params (EPSG::1122) |
| `kenya/projection__utm37s-forward-inverse.json` | ✅ Verified | EPSG::21037 |
| `kenya/cogo__traverse-bowditch-small.json` | ✅ Verified | Hand-computed, 4-station closed traverse |
| `kenya/cogo__area-shoelace-vs-ellipsoidal.json` | ✅ Verified | Known parcel, planar vs ellipsoidal |
| `us/projection__lambert-texas-south-central.json` | ✅ Verified | EPSG::6360 (metre CRS; ftUS is 6589) |
| `us/projection__lambert-california-5.json` | ✅ Verified | EPSG::6335 |
| `us/projection__lambert-new-york-long-island.json` | ✅ Verified | EPSG::6539 |
| `us/projection__lcc-edge-cases.json` | ✅ Verified | Synthetic probes — Snyder PP-1395 §14 + EPSG GN7-2 §1.3.2.1 |

US LCC fixtures are verified by `scripts/verify_lcc.py` (independent
Python implementation cross-checked against the EPSG GN7-2 §1.3.2.1
worked example) and enforced in the sidecar's Rust tests
(`geodesy/projection.rs`). The TS harness (`us-golden-fixtures.test.ts`)
asserts well-formedness and that the fixture zone parameters match
`country-config`'s United States registry.

`us/projection__lcc-edge-cases.json` is a **synthetic** fixture — its
zones (southern 2SP, equatorial straddle, single-parallel φ₁=φ₂ in both
hemispheres) do not exist in any country config, so the harness skips
its registry cross-check but still validates every case's zone shape.
It exists to pin the edge paths the real US SPCS zones (all n > 0)
cannot reach: the negative-n inverse quadrant fix
(θ = atan2(sign(n)·(E−FE), sign(n)·(ρ₀−(N−FN))), which previously
returned θ ∓ π ≈ 280° of longitude error for southern zones) and the
degenerate φ₁=φ₂ branch (`n = sin φ₁`).

## Fixtures still to add (Phase 4+)

- Cadastral Form 3 layout fixture (after the Form 3 renderer exists —
  Phase 6)
- Beacon Certificate layout fixture
- Sectional Properties plan fixture (after Sectional workflow exists —
  post-Phase 6)
- For each new country: same set of fixtures, sourced from that
  country's regulatory documents.
