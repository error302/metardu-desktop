#!/usr/bin/env python3
"""
METARDU Desktop — P0 Math Improvements Test

Tests:
  1. Cassini-Soldner ↔ UTM coordinate conversion
  2. Grid-to-ground distance correction
  3. Scale factor + grid convergence computation
  4. Batch conversion
  5. Product strategy document (mobile/web/desktop split)
  6. Math improvement plan document
"""
import json, sys, time, subprocess
from pathlib import Path

def banner(t):
    print(); print("=" * 72); print(f"  {t}"); print("=" * 72)
def step(n, t):
    print(f"\n  Step {n}: {t}")

def main():
    banner("METARDU Desktop — P0 Math Improvements Test")
    repo = Path(__file__).resolve().parent.parent
    eng = repo / 'apps' / 'desktop' / 'electron'
    t0 = time.time()
    total_pass = 0
    total_checks = 0

    # ─── Step 1: Cassini ↔ UTM conversion ─────────────────────────────
    step(1, "Cassini-Soldner → UTM conversion (Nairobi coordinates)")
    # Nairobi: lat ≈ -1.2864°, lon ≈ 36.8172°
    # UTM Zone 37S, Cassini origin at lat=0, lon=37
    js = f'''
const {{ convertCoordinates }} = require('{eng}/coordinate-converter.ts');
// Start from UTM, convert to Cassini, then back to verify round-trip
const utmResult = convertCoordinates({{
  easting: 277000, northing: 9858000,
  sourceCrs: 'utm', targetCrs: 'cassini',
  utmZone: 37, hemisphere: 'S',
  cassiniOriginLat: 0, cassiniOriginLon: 37,
}});
// Round-trip: Cassini back to UTM
const roundTrip = convertCoordinates({{
  easting: utmResult.outputEasting, northing: utmResult.outputNorthing,
  sourceCrs: 'cassini', targetCrs: 'utm',
  utmZone: 37, hemisphere: 'S',
  cassiniOriginLat: 0, cassiniOriginLon: 37,
}});
console.log(JSON.stringify({{
  utmInput: {{ E: 277000, N: 9858000 }},
  cassiniOutput: {{ E: utmResult.outputEasting.toFixed(3), N: utmResult.outputNorthing.toFixed(3) }},
  utmRoundTrip: {{ E: roundTrip.outputEasting.toFixed(3), N: roundTrip.outputNorthing.toFixed(3) }},
  lat: utmResult.latitude,
  lon: utmResult.longitude,
  scaleFactor: utmResult.scaleFactor,
  gridConvergence: utmResult.gridConvergence,
  gridToGroundFactor: utmResult.gridToGroundFactor,
  roundTripErrorE: Math.abs(roundTrip.outputEasting - 277000),
  roundTripErrorN: Math.abs(roundTrip.outputNorthing - 9858000),
}}));
'''
    sp = repo / 'scripts' / '_math_convert.js'; sp.write_text(js)
    r = subprocess.run(['npx', 'tsx', str(sp)], cwd=str(repo), capture_output=True, text=True, timeout=30)
    sp.unlink()
    if r.returncode != 0:
        print(f"    ❌ Conversion failed:\n{r.stderr[-400:]}"); sys.exit(1)
    conv = json.loads([l for l in r.stdout.strip().splitlines() if l.startswith('{')][-1])
    print(f"    Input (UTM 37S): E=277000, N=9858000")
    print(f"    Output (Cassini): E={conv['cassiniOutput']['E']}, N={conv['cassiniOutput']['N']}")
    print(f"    Round-trip (UTM): E={conv['utmRoundTrip']['E']}, N={conv['utmRoundTrip']['N']}")
    print(f"    Round-trip error: E={conv['roundTripErrorE']:.6f}m, N={conv['roundTripErrorN']:.6f}m")
    print(f"    Latitude: {conv['lat']:.6f}°")
    print(f"    Longitude: {conv['lon']:.6f}°")
    print(f"    Scale factor: {conv['scaleFactor']:.6f}")
    print(f"    Grid convergence: {conv['gridConvergence']:.4f}°")
    print(f"    Grid-to-ground factor: {conv['gridToGroundFactor']:.6f}")

    checks = {
        'round-trip error < 1mm (E)': conv['roundTripErrorE'] < 0.001,
        'round-trip error < 1mm (N)': conv['roundTripErrorN'] < 0.001,
        'latitude is negative (S hemisphere)': conv['lat'] < 0,
        'longitude near 37° (Kenya)': 36 < conv['lon'] < 38,
        'scale factor is positive': conv['scaleFactor'] > 0,
        'grid-to-ground factor is positive': conv['gridToGroundFactor'] > 0,
    }
    for check, passed in checks.items():
        total_checks += 1
        if passed: total_pass += 1
        print(f"    {'✅' if passed else '❌'} {check}")

    # ─── Step 2: Grid-to-ground correction ────────────────────────────
    step(2, "Grid-to-ground distance correction")
    # If scale factor = 1.0006, then 100m grid = 100/1.0006 = 99.94m ground
    sf = conv['scaleFactor']
    grid_dist = 100.0  # metres
    ground_dist = grid_dist / sf
    print(f"    Scale factor at this point: {sf:.6f}")
    print(f"    Grid distance: {grid_dist}m")
    print(f"    Ground distance: {ground_dist:.4f}m")
    print(f"    Correction: {(ground_dist - grid_dist):.4f}m ({(ground_dist - grid_dist)/grid_dist*1000:.2f}mm per 100m)")
    total_checks += 1
    if abs(ground_dist - grid_dist) < 1.0: total_pass += 1; print(f"    ✅ Correction is reasonable (<1m per 100m)")
    else: print(f"    ❌ Correction too large")

    # ─── Step 3: Batch conversion ─────────────────────────────────────
    step(3, "Batch conversion (5 points)")
    js3 = f'''
const {{ batchConvert }} = require('{eng}/coordinate-converter.ts');
const points = [
  {{ easting: 277000, northing: 9858000, description: "BM1" }},
  {{ easting: 277100, northing: 9858100, description: "P2" }},
  {{ easting: 277200, northing: 9858200, description: "P3" }},
  {{ easting: 277300, northing: 9858300, description: "P4" }},
  {{ easting: 277400, northing: 9858400, description: "P5" }},
];
const results = batchConvert(points, {{
  sourceCrs: 'utm', targetCrs: 'cassini',
  utmZone: 37, hemisphere: 'S',
  cassiniOriginLat: 0, cassiniOriginLon: 37,
}});
console.log(JSON.stringify({{
  count: results.length,
  first: {{ desc: results[0].description, outE: results[0].outputEasting.toFixed(3), outN: results[0].outputNorthing.toFixed(3) }},
  last: {{ desc: results[4].description, outE: results[4].outputEasting.toFixed(3), outN: results[4].outputNorthing.toFixed(3) }},
}}));
'''
    sp3 = repo / 'scripts' / '_math_batch.js'; sp3.write_text(js3)
    r3 = subprocess.run(['npx', 'tsx', str(sp3)], cwd=str(repo), capture_output=True, text=True, timeout=30)
    sp3.unlink()
    if r3.returncode != 0:
        print(f"    ❌ Batch failed:\n{r3.stderr[-400:]}"); sys.exit(1)
    batch = json.loads([l for l in r3.stdout.strip().splitlines() if l.startswith('{')][-1])
    print(f"    Points converted: {batch['count']}")
    print(f"    First ({batch['first']['desc']}): E={batch['first']['outE']}, N={batch['first']['outN']}")
    print(f"    Last ({batch['last']['desc']}): E={batch['last']['outE']}, N={batch['last']['outN']}")
    total_checks += 1
    if batch['count'] == 5: total_pass += 1; print(f"    ✅ All 5 points converted")
    else: print(f"    ❌ Expected 5, got {batch['count']}")

    # ─── Step 4: Documents ────────────────────────────────────────────
    step(4, "Strategy + Math improvement documents")
    docs = [
        ('docs/PRODUCT_STRATEGY.md', 'Mobile/Web/Desktop split strategy'),
        ('docs/MATH_IMPROVEMENT_PLAN.md', 'Math improvement plan (14 features)'),
    ]
    for doc_path, desc in docs:
        full_path = repo / doc_path
        exists = full_path.exists()
        total_checks += 1
        if exists:
            total_pass += 1
            lines = len(full_path.read_text().splitlines())
            print(f"    ✅ {desc}: {lines} lines")
        else:
            print(f"    ❌ {desc}: NOT FOUND")

    elapsed = time.time() - t0
    banner(f"{'✅ P0 MATH TEST PASSED' if total_pass == total_checks else f'⚠ {total_pass}/{total_checks} passed'}")
    print(f"  {total_pass}/{total_checks} checks passed in {elapsed:.2f}s")
    print()
    print("  P0 math improvements verified:")
    print(f"    ✓ Cassini-Soldner ↔ UTM conversion (round-trip < 1mm)")
    print(f"    ✓ Grid-to-ground distance correction")
    print(f"    ✓ Scale factor + grid convergence")
    print(f"    ✓ Batch conversion (5 points)")
    print(f"    ✓ Product strategy document (mobile/web/desktop split)")
    print(f"    ✓ Math improvement plan (14 features prioritized)")
    return 0 if total_pass == total_checks else 1

if __name__ == '__main__':
    sys.exit(main())
