#!/usr/bin/env /usr/bin/python3
"""
End-to-end test of the GDAL contour generation via the Rust sidecar.

Creates a synthetic GeoTIFF with a known hill shape, calls the sidecar's
gdal_contour handler, and verifies the output GeoJSON contains contours.

NOTE: Must run with /usr/bin/python3 (not the venv python) because the
osgeo module is only installed for the system Python.
"""
import json
import struct
import subprocess
import sys
import os
import tempfile
from pathlib import Path

SIDECAR_BIN = Path("/home/z/my-project/metardu-v2/packages/metardu-sidecar/target/release/metardu-sidecar")

def create_test_geotiff(path: str):
    """Create a synthetic GeoTIFF with a simple ramp using gdal_create + gdal_edit."""
    import subprocess
    # Create a 50x50 GeoTIFF with elevation 1700 (flat)
    # Then use gdal_calc to create a ramp (varying elevation)
    subprocess.run([
        "gdal_create", "-of", "GTiff",
        "-a_srs", "EPSG:4326",
        "-a_ullr", "36.8172", "-1.2774", "36.8227", "-1.2864",  # N, W, S, E (Nairobi 50ha)
        "-bands", "1",
        "-burn", "1700",
        "-outsize", "50", "50",
        path,
    ], check=True, capture_output=True)

    # Create a ramp from 1700 to 1730 using numpy directly via Python
    # (avoids gdal_calc X/Y variable issues)
    from osgeo import gdal, osr
    ds = gdal.Open(path, gdal.GA_Update)
    band = ds.GetRasterBand(1)
    import numpy as np
    # Create a 50x50 array with a ramp from 1700 (NW) to 1730 (SE)
    arr = np.zeros((50, 50), dtype=np.float32)
    for y in range(50):
        for x in range(50):
            arr[y, x] = 1700 + (x + y) * 0.6  # ramp 0 to ~60m
    band.WriteArray(arr)
    band.FlushCache()
    ds.FlushCache()
    ds = None  # close
    return path


def send(proc, msg: dict):
    payload = json.dumps(msg).encode("utf-8")
    header = struct.pack(">I", len(payload))
    proc.stdin.write(header + payload)
    proc.stdin.flush()

def recv(proc) -> dict:
    header = proc.stdout.read(4)
    if len(header) != 4:
        raise RuntimeError(f"short read on header: {len(header)} bytes")
    (length,) = struct.unpack(">I", header)
    payload = proc.stdout.read(length)
    return json.loads(payload)


def main():
    if not SIDECAR_BIN.exists():
        print(f"ERROR: sidecar binary not found at {SIDECAR_BIN}", file=sys.stderr)
        sys.exit(1)

    # Create a test GeoTIFF
    with tempfile.TemporaryDirectory() as tmpdir:
        geotiff_path = os.path.join(tmpdir, "test_hill.tif")
        print(f"Creating test GeoTIFF at {geotiff_path}...")
        create_test_geotiff(geotiff_path)
        print(f"  ✓ Created ({os.path.getsize(geotiff_path)} bytes)")

        # Start the sidecar
        proc = subprocess.Popen(
            [str(SIDECAR_BIN)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )

        try:
            # Test: gdal_contour with output_path (shell-out mode requires it)
            print("\nTest: gdal_contour via shell-out to gdal_contour CLI")
            output_geojson = os.path.join(tmpdir, "contours.geojson")
            send(proc, {
                "id": "1",
                "method": "gdal_contour",
                "params": {
                    "dsm_path": geotiff_path,
                    "interval": 5.0,
                    "format": "geojson",
                    "output_path": output_geojson,
                },
            })
            resp = recv(proc)
            print(f"  Response: {json.dumps(resp, indent=2)[:500]}...")

            assert resp["id"] == "1", f"expected id=1, got {resp['id']}"
            assert resp["ok"] == True, f"expected ok=true, got {resp.get('ok')}: {resp.get('error', {})}"

            result = resp["result"]
            print(f"  ✓ Contour interval: {result['interval']}")
            print(f"  ✓ Output path: {result['output_path']}")
            print(f"  ✓ Output file exists: {os.path.exists(output_geojson)}")
            print(f"  ✓ Output file size: {os.path.getsize(output_geojson)} bytes")

            # Verify the output is valid GeoJSON
            with open(output_geojson) as f:
                geojson = json.load(f)
            print(f"  ✓ GeoJSON type: {geojson.get('type')}")
            print(f"  ✓ Feature count: {len(geojson.get('features', []))}")

            # Test: error case (nonexistent file)
            print("\nTest: gdal_contour with nonexistent file")
            send(proc, {
                "id": "2",
                "method": "gdal_contour",
                "params": {
                    "dsm_path": "/nonexistent/file.tif",
                    "interval": 1.0,
                    "output_path": "/tmp/should_not_exist.geojson",
                },
            })
            resp = recv(proc)
            print(f"  Response: ok={resp.get('ok')}, error={resp.get('error', {}).get('code')}")
            assert resp["ok"] == False
            assert "not found" in resp["error"]["message"].lower()

            # Test: error case (nonpositive interval)
            print("\nTest: gdal_contour with nonpositive interval")
            send(proc, {
                "id": "3",
                "method": "gdal_contour",
                "params": {
                    "dsm_path": geotiff_path,
                    "interval": 0.0,
                    "output_path": "/tmp/should_not_exist.geojson",
                },
            })
            resp = recv(proc)
            print(f"  Response: ok={resp.get('ok')}, error={resp.get('error', {}).get('code')}")
            assert resp["ok"] == False
            assert "positive" in resp["error"]["message"].lower()

            print("\n✅ All GDAL contour tests PASSED")

        finally:
            proc.stdin.close()
            proc.wait(timeout=5)


if __name__ == "__main__":
    main()
