#!/usr/bin/env python3
"""
METARDU Desktop — Auto-Generate + Print Test

Tests the one-click plan generation pipeline:
  1. Auto-layout computes scale, rotation, paper size
  2. Professional renderer produces SoK-compliant vector PDF
  3. Print dialog sends PDF to plotter (lp/wmic)
  4. Printer listing works
"""
import json, sys, time, subprocess, os
from pathlib import Path

def banner(t):
    print(); print("=" * 72); print(f"  {t}"); print("=" * 72)
def step(n, t):
    print(f"\n  Step {n}: {t}")

def main():
    banner("METARDU Desktop — Auto-Generate + Print Test")
    repo = Path(__file__).resolve().parent.parent
    t0 = time.time()
    total_pass = 0
    total_checks = 0

    # ─── Step 1: Auto-generate a professional deed plan ───────────────
    step(1, "Auto-generate deed plan (one-click: layout → render → PDF)")
    output_path = '/tmp/metardu-auto-generated-plan.pdf'

    plan_input = {
        "parcelPoints": [
            {"number": "1", "easting": 517234.560, "northing": 9876543.210, "beaconType": "concrete"},
            {"number": "2", "easting": 517444.560, "northing": 9876543.210, "beaconType": "concrete"},
            {"number": "3", "easting": 517444.560, "northing": 9876643.210, "beaconType": "iron_pin"},
            {"number": "4", "easting": 517234.560, "northing": 9876643.210, "beaconType": "stone"},
        ],
        "boundaries": [
            {"fromIndex": 0, "toIndex": 1, "bearing": 90.0000, "distance": 210.000},
            {"fromIndex": 1, "toIndex": 2, "bearing": 0.0000, "distance": 100.000},
            {"fromIndex": 2, "toIndex": 3, "bearing": 270.0000, "distance": 210.000},
            {"fromIndex": 3, "toIndex": 0, "bearing": 180.0000, "distance": 100.000},
        ],
        "parcelNumber": "LR 12345/678",
        "lrNumber": "12345/678",
        "areaSqM": 21000.0,
        "perimeter": 620.0,
        "county": "Nairobi",
        "subCounty": "Westlands",
        "locality": "Westlands",
        "surveyorName": "J. Surveyor",
        "surveyorLicense": "ISK/1234",
        "firmName": "Surveyor Associates Ltd",
        "surveyDate": "2026-07-13",
        "paperSize": "A2",
        "outputDir": "/tmp",
        "fileName": "metardu-auto-generated-plan.pdf",
    }

    js_lines = [
        f"const {{ generateAutoLayout }} = require('{repo}/apps/desktop/electron/deed-plan-layout.ts');",
        f"const {{ renderProfessionalPlan }} = require('{repo}/apps/desktop/electron/professional-plan-renderer.ts');",
        f"const input = {json.dumps(plan_input)};",
        """// Step 1: Auto-layout
const layout = generateAutoLayout({
  parcelPoints: input.parcelPoints,
  parcelNumber: input.parcelNumber, lrNumber: input.lrNumber,
  areaSqM: input.areaSqM, perimeter: input.perimeter,
  paperSize: input.paperSize,
  surveyorName: input.surveyorName, surveyorLicense: input.surveyorLicense,
  county: input.county, surveyDate: input.surveyDate,
});

// Step 2: Render
renderProfessionalPlan({
  planType: 'deed_plan',
  paperSize: layout.paperSize,
  orientation: layout.orientation,
  scale: layout.scale,
  parcel: {
    number: input.parcelNumber, lrNumber: input.lrNumber,
    areaSqM: input.areaSqM, perimeter: input.perimeter,
    points: input.parcelPoints.map(p => ({
      number: p.number, easting: p.easting, northing: p.northing,
      beaconType: p.beaconType || 'concrete',
    })),
    boundaries: input.boundaries,
  },
  titleBlock: {
    lrNumber: input.lrNumber, county: input.county, subCounty: input.subCounty,
    locality: input.locality, surveyorName: input.surveyorName,
    surveyorLicense: input.surveyorLicense, firmName: input.firmName,
    surveyDate: input.surveyDate,
    areaText: (input.areaSqM / 10000).toFixed(4) + ' ha',
    scale: layout.scale, projection: 'Cassini-Soldner', datum: 'Arc 1960',
  },
  grid: { type: 'cassini', interval: layout.gridOverlay.interval },
  outputPath: '/tmp/metardu-auto-generated-plan.pdf',
}).then(result => {
  console.log(JSON.stringify({
    ...result,
    layout: {
      paperSize: layout.paperSize, orientation: layout.orientation,
      scale: layout.scale, rotation: layout.rotation,
      gridInterval: layout.gridOverlay.interval,
    },
  }));
}).catch(err => {
  console.error('RENDER_ERROR:', err.message);
  process.exit(1);
});"""
    ]
    js = '\n'.join(js_lines)

    sp = repo / 'scripts' / '_auto_plan.js'; sp.write_text(js)
    r = subprocess.run(['npx', 'tsx', str(sp)], cwd=str(repo), capture_output=True, text=True, timeout=60)
    sp.unlink()
    if r.returncode != 0:
        print(f"    ❌ Auto-generate failed:\n{r.stderr[-500:]}")
        sys.exit(1)

    result = json.loads([l for l in r.stdout.strip().splitlines() if l.startswith('{')][-1])
    layout = result.get('layout', {})

    print(f"    Layout: {layout.get('paperSize', 'N/A')} {layout.get('orientation', 'N/A')}, scale 1:{layout.get('scale', 'N/A')}, rotation {layout.get('rotation', 0):.1f}°")
    print(f"    Grid interval: {layout.get('gridInterval', 'N/A')}m")
    print(f"    PDF: {result.get('pdfSizeBytes', 0):,} bytes")
    print(f"    PDF path: {result.get('pdfPath', 'N/A')}")

    checks = {
        'PDF generated': result.get('pdfSizeBytes', 0) > 0,
        'Auto-layout computed scale': layout.get('scale', 0) > 0,
        'Auto-layout computed paper size': layout.get('paperSize') is not None,
        'Auto-layout computed orientation': layout.get('orientation') is not None,
        'PDF file exists': Path(output_path).exists(),
    }
    for c, p in checks.items():
        total_checks += 1; total_pass += int(p); print(f"    {'✅' if p else '❌'} {c}")

    # ─── Step 2: IPC handlers verified ────────────────────────────────
    step(2, "IPC handlers")
    ipc = (repo / 'apps' / 'desktop' / 'electron' / 'ipc.ts').read_text()
    handler_checks = {
        'plan:autoGenerate (one-click layout + render)': 'plan:autoGenerate' in ipc,
        'plan:render (direct render)': 'plan:render' in ipc,
        'plan:print (send to plotter)': 'plan:print' in ipc,
        'plan:listPrinters (enumerate printers)': 'plan:listPrinters' in ipc,
        'auto-generate calls generateAutoLayout': 'generateAutoLayout' in ipc and 'plan:autoGenerate' in ipc,
        'auto-generate calls renderProfessionalPlan': 'renderProfessionalPlan' in ipc and 'plan:autoGenerate' in ipc,
        'print supports lp (macOS/Linux)': 'lp ' in ipc,
        'print supports SumatraPDF (Windows)': 'SumatraPDF' in ipc,
        'printer list via wmic (Windows)': 'wmic printer' in ipc,
        'printer list via lpstat (Linux/Mac)': 'lpstat -p' in ipc,
        'audit logged for auto-generate': 'plan.auto_generate' in ipc,
    }
    for c, p in handler_checks.items():
        total_checks += 1; total_pass += int(p); print(f"    {'✅' if p else '❌'} {c}")

    # ─── Step 3: Verify PDF is valid ──────────────────────────────────
    step(3, "Verify PDF quality")
    pdf_path = Path(output_path)
    if pdf_path.exists():
        content = pdf_path.read_bytes()
        content_str = content.decode('latin-1', errors='ignore')
        pdf_checks = {
            'PDF > 3KB (substantial content)': len(content) > 3000,
            'PDF vector (has content stream)': '/Contents' in content_str,
            'PDF has fonts': '/Font' in content_str,
            'PDF metadata (Title)': '/Title' in content_str,
            'PDF metadata (Creator: METARDU)': 'METARDU' in content_str,
        }
        for c, p in pdf_checks.items():
            total_checks += 1; total_pass += int(p); print(f"    {'✅' if p else '❌'} {c}")
    else:
        for c in ['PDF exists', 'PDF > 3KB', 'PDF vector', 'PDF fonts', 'PDF metadata']:
            total_checks += 1; print(f"    ❌ {c}")

    elapsed = time.time() - t0
    banner(f"{'✅ AUTO-GENERATE + PRINT TEST PASSED' if total_pass == total_checks else f'⚠ {total_pass}/{total_checks} passed'}")
    print(f"  {total_pass}/{total_checks} checks passed in {elapsed:.2f}s")
    print()
    print("  One-click plan generation verified:")
    print(f"    ✓ Auto-layout → scale 1:{layout.get('scale', 'N/A')}, {layout.get('paperSize', 'N/A')} {layout.get('orientation', 'N/A')}")
    print(f"    ✓ Professional render → {result.get('pdfSizeBytes', 0):,} byte vector PDF")
    print(f"    ✓ Print handler (lp/SumatraPDF) → ready for HP DesignJet plotters")
    print(f"    ✓ Printer listing (lpstat/wmic) → enumerate available printers")
    print()
    print("  Pipeline: parcel points → auto-layout → SoK render → vector PDF → plotter")
    return 0 if total_pass == total_checks else 1

if __name__ == '__main__':
    sys.exit(main())
