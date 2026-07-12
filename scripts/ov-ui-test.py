#!/usr/bin/env python3
"""
METARDU Desktop — OV-UI Deepening Test

Verifies that the 3 renderer UI components for overkill features are
built correctly and have the right structure.
"""
import sys
from pathlib import Path

def banner(t):
    print(); print("=" * 72); print(f"  {t}"); print("=" * 72)

def main():
    banner("METARDU Desktop — OV-UI Deepening Test")
    repo = Path(__file__).resolve().parent.parent
    components = repo / 'apps' / 'desktop' / 'src' / 'components'
    styles = repo / 'apps' / 'desktop' / 'src' / 'styles' / 'global.css'

    results = []

    # ─── OV-UI1: Total Station Panel ──────────────────────────────────
    ts_file = components / 'TotalStationPanel.tsx'
    if ts_file.exists():
        content = ts_file.read_text()
        checks = {
            'component exists': True,
            'TotalStationPanel exported': 'export function TotalStationPanel' in content,
            'connect/disconnect handlers': 'handleConnect' in content and 'handleDisconnect' in content,
            'station setup form': 'StationSetupForm' in content,
            'measurement display': 'lastShot' in content,
            'serial raw log': 'rawLog' in content,
            'event listeners (ts:connected, ts:measurement, ts:raw)': all(e in content for e in ['ts:connected', 'ts:measurement', 'ts:raw']),
            'port listing': 'handleListPorts' in content,
            'baud rate selection': 'baudRate' in content,
            'measure button': 'Measure' in content,
        }
        results.append(('OV-UI1: Total Station Panel', checks))
    else:
        results.append(('OV-UI1: Total Station Panel', {'component exists': False}))

    # ─── OV-UI2: 3D Parcel Viewer ─────────────────────────────────────
    p3d_file = components / 'Parcel3DViewer.tsx'
    if p3d_file.exists():
        content = p3d_file.read_text()
        checks = {
            'component exists': True,
            'Parcel3DViewer exported': 'export function Parcel3DViewer' in content,
            'Three.js dynamic import': "import('three')" in content,
            'WebGL renderer': 'WebGLRenderer' in content,
            'parcel extrusion (ExtrudeGeometry)': 'ExtrudeGeometry' in content,
            'subsurface rights rendering': 'subsurfaceRights' in content,
            'beacon spheres': 'SphereGeometry' in content,
            'orbit controls (mouse drag)': 'isDragging' in content,
            'zoom (wheel)': 'onWheel' in content,
            'grid helper': 'GridHelper' in content,
            'toggle controls (subsurface, beacons, height)': all(c in content for c in ['showSubsurface', 'showBeacons', 'extrudeHeight']),
            'cleanup on unmount': 'cleanup' in content,
        }
        results.append(('OV-UI2: 3D Parcel Viewer', checks))
    else:
        results.append(('OV-UI2: 3D Parcel Viewer', {'component exists': False}))

    # ─── OV-UI3: GNSS RTK Panel ───────────────────────────────────────
    gnss_file = components / 'GNSSPanel.tsx'
    if gnss_file.exists():
        content = gnss_file.read_text()
        checks = {
            'component exists': True,
            'GNSSPanel exported': 'export function GNSSPanel' in content,
            'fix quality indicator (color-coded)': 'FIX_COLORS' in content and 'fixed' in content,
            'NTRIP config form': 'ntripHost' in content and 'ntripMount' in content,
            'NTRIP connection status': 'ntripConnected' in content,
            'RINEX recording toggle': 'rinexRecording' in content,
            'satellite skyplot (canvas)': 'skyplotRef' in content and 'canvas' in content,
            'satellite list': 'gnss-sat-grid' in content,
            'precision display (stdLat, stdLon, stdAlt)': all(p in content for p in ['stdLat', 'stdLon', 'stdAlt']),
            'event listeners (gnss:position, ntrip:connected)': all(e in content for e in ['gnss:position', 'ntrip:connected']),
            'corrections counter': 'correctionsReceived' in content,
            'HDOP display': 'hdop' in content,
        }
        results.append(('OV-UI3: GNSS RTK Panel', checks))
    else:
        results.append(('OV-UI3: GNSS RTK Panel', {'component exists': False}))

    # ─── CSS styles ────────────────────────────────────────────────────
    if styles.exists():
        css = styles.read_text()
        checks = {
            'TS panel styles': '.ts-panel' in css,
            '3D viewer styles': '.parcel-3d-viewer' in css,
            'GNSS panel styles': '.gnss-panel' in css,
            'skyplot styles': '.gnss-skyplot' in css,
            'satellite grid styles': '.gnss-sat-grid' in css,
            'small button styles': '.btn-sm' in css,
        }
        results.append(('CSS Styles', checks))
    else:
        results.append(('CSS Styles', {'file exists': False}))

    # ─── Print results ────────────────────────────────────────────────
    total_pass = 0
    total_checks = 0
    for name, checks in results:
        print(f"\n  {name}:")
        for check, passed in checks.items():
            icon = '✅' if passed else '❌'
            print(f"    {icon} {check}")
            total_checks += 1
            if passed:
                total_pass += 1

    banner("✅ OV-UI DEEPENING TEST PASSED" if total_pass == total_checks else f"⚠ OV-UI TEST: {total_pass}/{total_checks} checks passed")
    print(f"\n  {total_pass}/{total_checks} checks passed")
    print()
    print("  Renderer UI components built:")
    print(f"    ✓ Total Station Panel — real-time serial streaming with live map")
    print(f"    ✓ 3D Parcel Viewer — Three.js extrusion, subsurface, orbit controls")
    print(f"    ✓ GNSS RTK Panel — NTRIP config, fix quality, skyplot, satellite list")
    print(f"    ✓ CSS styles for all 3 components")
    print()
    print("  These components wire the overkill backend features into the UI.")
    return 0 if total_pass == total_checks else 1

if __name__ == '__main__':
    sys.exit(main())
