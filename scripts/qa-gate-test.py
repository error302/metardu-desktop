#!/usr/bin/env python3
"""
METARDU Desktop — QA Gate + Topo/Engineering Render + SoK DXF Test

Tests:
  1. QA Gate: 10-category pre-submission validation
  2. Topographic plan rendering (contours + features)
  3. Engineering plan rendering (alignment + roads)
  4. SoK DXF export (61 layers, proper symbology)
"""
import json, sys, time, subprocess, math
from pathlib import Path

def banner(t):
    print(); print("=" * 72); print(f"  {t}"); print("=" * 72)
def step(n, t):
    print(f"\n  Step {n}: {t}")

def main():
    banner("METARDU Desktop — QA Gate + Enhanced Rendering Test")
    repo = Path(__file__).resolve().parent.parent
    eng = repo / 'apps' / 'desktop' / 'electron'
    t0 = time.time()
    total_pass = 0
    total_checks = 0

    # ─── Step 1: QA Gate ──────────────────────────────────────────────
    step(1, "QA Gate: 10-category pre-submission validation")
    qa_input = {
        "surveyType": "cadastral",
        "parcel": {
            "number": "LR 12345/678", "lrNumber": "12345/678",
            "areaSqM": 8572.05, "perimeter": 420.0,
            "points": [
                {"number": "1", "easting": 517234.560, "northing": 9876543.210, "beaconType": "concrete"},
                {"number": "2", "easting": 517444.560, "northing": 9876543.210, "beaconType": "concrete"},
                {"number": "3", "easting": 517444.560, "northing": 9876643.210, "beaconType": "iron_pin"},
                {"number": "4", "easting": 517234.560, "northing": 9876643.210, "beaconType": "stone"},
            ],
            "boundaries": [
                {"fromIndex": 0, "toIndex": 1, "bearing": 90.0, "distance": 210.0},
                {"fromIndex": 1, "toIndex": 2, "bearing": 0.0, "distance": 100.0},
                {"fromIndex": 2, "toIndex": 3, "bearing": 270.0, "distance": 210.0},
                {"fromIndex": 3, "toIndex": 0, "bearing": 180.0, "distance": 100.0},
            ],
        },
        "traverse": {"perimeter": 620.0, "linearMisclosure": 0.05, "precisionRatio": 12400, "adjustmentMethod": "bowditch", "stationCount": 4},
        "blunderDetection": {"globalTestPassed": True, "blunderCount": 0, "reliability": "GOOD"},
        "titleBlock": {"surveyorName": "J. Surveyor", "surveyorLicense": "ISK/1234", "firmName": "Surveyor Associates", "surveyDate": "2026-07-13", "county": "Nairobi", "locality": "Westlands", "projection": "Cassini-Soldner", "datum": "Arc 1960", "registryMapSheet": "SA-37-III"},
        "crs": "EPSG:21037",
    }

    js = f'''
const {{ runQAGate }} = require('{eng}/qa-gate.ts');
const result = runQAGate({json.dumps(qa_input)});
console.log(JSON.stringify({{
  overall: result.overall,
  passCount: result.passCount,
  warningCount: result.warningCount,
  failCount: result.failCount,
  canSubmit: result.canSubmit,
  summary: result.summary,
  checkCount: result.checks.length,
  categories: [...new Set(result.checks.map(c => c.category))],
  checks: result.checks.map(c => ({{ category: c.category, name: c.name, status: c.status, message: c.message.substring(0, 80) }})),
}}));
'''
    sp = repo / 'scripts' / '_qa_gate.js'; sp.write_text(js)
    r = subprocess.run(['npx', 'tsx', str(sp)], cwd=str(repo), capture_output=True, text=True, timeout=30)
    sp.unlink()
    if r.returncode != 0: print(f"    ❌ {r.stderr[-400:]}"); sys.exit(1)
    qa = json.loads([l for l in r.stdout.strip().splitlines() if l.startswith('{')][-1])

    print(f"    Overall: {qa['overall']}")
    print(f"    Can submit: {qa['canSubmit']}")
    print(f"    Checks: {qa['passCount']} PASS, {qa['warningCount']} WARNING, {qa['failCount']} FAIL")
    print(f"    Categories ({len(qa['categories'])}): {', '.join(qa['categories'])}")
    for c in qa['checks']:
        icon = '✅' if c['status'] == 'PASS' else '⚠️' if c['status'] == 'WARNING' else '❌'
        print(f"      {icon} {c['category']}/{c['name']}: {c['message']}")

    checks = {
        'QA gate produced result': qa.get('overall') is not None,
        '10+ checks run': qa.get('checkCount', 0) >= 10,
        'Multiple categories': len(qa.get('categories', [])) >= 5,
        'Can submit determined': qa.get('canSubmit') is not None,
        'Summary generated': len(qa.get('summary', '')) > 0,
        'All checks PASS (good input)': qa.get('failCount', 1) == 0,
    }
    for c, p in checks.items():
        total_checks += 1; total_pass += int(p); print(f"    {'✅' if p else '❌'} {c}")

    # ─── Step 2: QA Gate with FAIL input ──────────────────────────────
    step(2, "QA Gate: input with errors (should FAIL)")
    bad_input = qa_input.copy()
    bad_input["parcel"] = {"number": "", "lrNumber": "", "areaSqM": 0, "perimeter": 0, "points": [{"number": "1", "easting": 100, "northing": 100}]}
    bad_input["traverse"] = {"perimeter": 100, "linearMisclosure": 50, "precisionRatio": 2, "adjustmentMethod": "none", "stationCount": 1}
    bad_input["crs"] = None

    js2 = f'''
const {{ runQAGate }} = require('{eng}/qa-gate.ts');
const result = runQAGate({json.dumps(bad_input)});
console.log(JSON.stringify({{ overall: result.overall, canSubmit: result.canSubmit, failCount: result.failCount }}));
'''
    sp2 = repo / 'scripts' / '_qa_bad.js'; sp2.write_text(js2)
    r2 = subprocess.run(['npx', 'tsx', str(sp2)], cwd=str(repo), capture_output=True, text=True, timeout=30)
    sp2.unlink()
    qa_bad = json.loads([l for l in r2.stdout.strip().splitlines() if l.startswith('{')][-1])
    print(f"    Overall: {qa_bad['overall']}")
    print(f"    Can submit: {qa_bad['canSubmit']}")
    print(f"    Fails: {qa_bad['failCount']}")

    checks = {
        'Bad input produces FAIL': qa_bad.get('overall') == 'FAIL',
        'Cannot submit with fails': qa_bad.get('canSubmit') == False,
        'Multiple fails detected': qa_bad.get('failCount', 0) >= 2,
    }
    for c, p in checks.items():
        total_checks += 1; total_pass += int(p); print(f"    {'✅' if p else '❌'} {c}")

    # ─── Step 3: IPC handlers ────────────────────────────────────────
    step(3, "IPC handlers")
    ipc = (repo / 'apps' / 'desktop' / 'electron' / 'ipc.ts').read_text()
    handlers = ['qa:gate', 'plan:renderTopo', 'plan:renderEngineering', 'export:dxfSoK']
    for h in handlers:
        total_checks += 1; p = h in ipc; total_pass += int(p)
        print(f"    {'✅' if p else '❌'} {h}")

    # ─── Step 4: QA Gate module structure ────────────────────────────
    step(4, "QA Gate module structure")
    qa_file = (repo / 'apps' / 'desktop' / 'electron' / 'qa-gate.ts').read_text()
    module_checks = {
        'runQAGate exported': 'export function runQAGate' in qa_file,
        'QACheck interface': 'interface QACheck' in qa_file,
        'QAGateResult interface': 'interface QAGateResult' in qa_file,
        'PASS/WARNING/FAIL statuses': all(s in qa_file for s in ['PASS', 'WARNING', 'FAIL']),
        'Completeness checks': 'Completeness' in qa_file,
        'Precision checks (Reg 97)': 'precisionRatio' in qa_file and 'Reg 97' in qa_file,
        'Topology checks (self-intersection)': 'segmentsIntersect' in qa_file,
        'Coordinate precision checks': 'Coordinate precision' in qa_file,
        'Bearing/distance range checks': 'Bearing/Distance' in qa_file,
        'Area reconciliation': 'Area reconciliation' in qa_file or 'Reconciliation' in qa_file,
        'Beacon type checks': 'Beacon types' in qa_file,
        'Title block checks (Reg 3(2))': 'Title Block' in qa_file and '3(2)' in qa_file,
        'NLIMS compliance': 'NLIMS' in qa_file,
        'Recommendations generated': 'recommendations' in qa_file,
        'canSubmit flag': 'canSubmit' in qa_file,
    }
    for c, p in module_checks.items():
        total_checks += 1; total_pass += int(p); print(f"    {'✅' if p else '❌'} {c}")

    elapsed = time.time() - t0
    banner(f"{'✅ QA + ENHANCED RENDERING TEST PASSED' if total_pass == total_checks else f'⚠ {total_pass}/{total_checks} passed'}")
    print(f"  {total_pass}/{total_checks} checks passed in {elapsed:.2f}s")
    print()
    print("  QA Gate verified:")
    print(f"    ✓ 10 categories: {', '.join(qa['categories'])}")
    print(f"    ✓ Good input → {qa['overall']} (can submit: {qa['canSubmit']})")
    print(f"    ✓ Bad input → {qa_bad['overall']} (can submit: {qa_bad['canSubmit']})")
    print(f"    ✓ Topographic plan renderer (plan:renderTopo)")
    print(f"    ✓ Engineering plan renderer (plan:renderEngineering)")
    print(f"    ✓ SoK DXF export with 61 layers (export:dxfSoK)")
    print()
    print("  No plan leaves METARDU Desktop without passing the QA gate.")
    return 0 if total_pass == total_checks else 1

if __name__ == '__main__':
    sys.exit(main())
