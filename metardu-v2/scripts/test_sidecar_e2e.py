#!/usr/bin/env python3
"""
End-to-end test of the Rust sidecar binary.
Sends a ping request via stdin, expects a pong response on stdout.

Works on both Linux and Windows (auto-detects .exe extension).
Uses a relative path from the repo root — no hardcoded absolute paths.
"""
import json
import struct
import subprocess
import sys
import os
from pathlib import Path

# Resolve the sidecar binary path relative to this script's location.
# This script lives at: <repo-root>/scripts/test_sidecar_e2e.py
# The sidecar binary lives at: <repo-root>/packages/metardu-sidecar/target/release/metardu-sidecar[.exe]
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
SIDECAR_BIN = Path(os.environ.get(
    "METARDU_SIDECAR_BIN",
    str(REPO_ROOT / "packages" / "metardu-sidecar" / "target" / "release" / "metardu-sidecar"),
))

# On Windows, the binary has a .exe extension.
if sys.platform == "win32":
    SIDECAR_BIN = SIDECAR_BIN.with_suffix(".exe")

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
    if len(payload) != length:
        raise RuntimeError(f"short read on payload: got {len(payload)}, want {length}")
    return json.loads(payload)

def main():
    if not SIDECAR_BIN.exists():
        print(f"ERROR: sidecar binary not found at {SIDECAR_BIN}", file=sys.stderr)
        print("Run: cd packages/metardu-sidecar && cargo build --release", file=sys.stderr)
        sys.exit(1)

    print(f"Using sidecar binary: {SIDECAR_BIN}")

    proc = subprocess.Popen(
        [str(SIDECAR_BIN)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0,
    )

    try:
        # Test 1: ping
        print("Test 1: ping")
        send(proc, {"id": "1", "method": "ping", "params": None})
        resp = recv(proc)
        print(f"  Response: {resp}")
        assert resp["id"] == "1", f"expected id=1, got {resp['id']}"
        assert resp["ok"] == True, f"expected ok=true, got {resp.get('ok')}"
        assert resp["result"]["pong"] == True, f"expected pong=true"
        assert isinstance(resp["result"]["ts"], int), f"expected ts to be int"
        print("  PASS")

        # Test 2: echo
        print("Test 2: echo")
        send(proc, {"id": "2", "method": "echo", "params": {"msg": "hello world"}})
        resp = recv(proc)
        print(f"  Response: {resp}")
        assert resp["id"] == "2"
        assert resp["ok"] == True
        assert resp["result"]["echoed"]["msg"] == "hello world"
        print("  PASS")

        # Test 3: version
        print("Test 3: version")
        send(proc, {"id": "3", "method": "version", "params": None})
        resp = recv(proc)
        print(f"  Response: {resp}")
        assert resp["id"] == "3"
        assert resp["ok"] == True
        assert resp["result"]["name"] == "metardu-sidecar"
        print("  PASS")

        # Test 4: list_methods
        print("Test 4: list_methods")
        send(proc, {"id": "4", "method": "list_methods", "params": None})
        resp = recv(proc)
        print(f"  Response: {resp}")
        methods = resp["result"]["methods"]
        assert "ping" in methods
        assert "echo" in methods
        assert "version" in methods
        assert "list_methods" in methods
        print(f"  Found {len(methods)} methods")
        print("  PASS")

        # Test 5: unknown method
        print("Test 5: unknown method")
        send(proc, {"id": "5", "method": "nonexistent_method", "params": None})
        resp = recv(proc)
        print(f"  Response: {resp}")
        assert resp["id"] == "5"
        assert resp["ok"] == False
        assert resp["error"]["code"] == "METHOD_NOT_FOUND"
        print("  PASS")

        # Test 6: radiation is available through the live sidecar protocol.
        print("Test 6: COGO radiation")
        send(proc, {"id": "6", "method": "cogo.radiation", "params": {
            "origin": {"easting": 100, "northing": 200},
            "bearing_deg": 90,
            "distance_m": 10,
        }})
        resp = recv(proc)
        assert resp["id"] == "6" and resp["ok"] is True
        assert abs(resp["result"]["easting"] - 110) < 1e-9
        assert abs(resp["result"]["northing"] - 200) < 1e-9
        print("  PASS")

        # Test 7: bearing rays intersect ahead of both occupied stations.
        print("Test 7: COGO bearing intersection")
        send(proc, {"id": "7", "method": "cogo.bearing_bearing", "params": {
            "p1": {"easting": 0, "northing": 0}, "bearing1_deg": 0,
            "p2": {"easting": -10, "northing": 10}, "bearing2_deg": 90,
        }})
        resp = recv(proc)
        assert resp["id"] == "7" and resp["ok"] is True
        assert abs(resp["result"]["easting"]) < 1e-9
        assert abs(resp["result"]["northing"] - 10) < 1e-9
        print("  PASS")

        # Test 8: circle intersection uses the documented left-hand solution.
        print("Test 8: COGO distance intersection")
        send(proc, {"id": "8", "method": "cogo.distance_distance", "params": {
            "p1": {"easting": 0, "northing": 0}, "r1_m": 5,
            "p2": {"easting": 6, "northing": 0}, "r2_m": 5,
        }})
        resp = recv(proc)
        assert resp["id"] == "8" and resp["ok"] is True
        assert abs(resp["result"]["easting"] - 3) < 1e-9
        assert abs(resp["result"]["northing"] - 4) < 1e-9
        print("  PASS")

        # Test 9: midpoint offset preserves the start-to-end left convention.
        print("Test 9: COGO midpoint offset")
        send(proc, {"id": "9", "method": "cogo.midpoint_offset", "params": {
            "start": {"easting": 0, "northing": 0},
            "end": {"easting": 10, "northing": 0},
            "offset_m": 2,
            "side": "left",
        }})
        resp = recv(proc)
        assert resp["id"] == "9" and resp["ok"] is True
        assert abs(resp["result"]["easting"] - 5) < 1e-9
        assert abs(resp["result"]["northing"] - 2) < 1e-9
        print("  PASS")

        # Test 10: area RPC returns planar metrics only, with no ground claim.
        print("Test 10: COGO planar polygon metrics")
        send(proc, {"id": "10", "method": "cogo.area", "params": {
            "points": [[0, 0], [10, 0], [10, 10], [0, 10]],
        }})
        resp = recv(proc)
        assert resp["id"] == "10" and resp["ok"] is True
        assert abs(resp["result"]["planar_area_sq_m"] - 100) < 1e-9
        assert abs(resp["result"]["perimeter_m"] - 40) < 1e-9
        assert len(resp["result"]["edges"]) == 4
        assert "ground_area_sq_m" not in resp["result"]
        print("  PASS")

        # Test 11: invalid geometry parameters fail closed.
        print("Test 11: COGO invalid distance rejection")
        send(proc, {"id": "11", "method": "cogo.radiation", "params": {
            "origin": {"easting": 0, "northing": 0},
            "bearing_deg": 90,
            "distance_m": -1,
        }})
        resp = recv(proc)
        assert resp["id"] == "11" and resp["ok"] is False
        print("  PASS")

        # Test 12: the allowlisted topographic RPC returns input-indexed faces.
        print("Test 12: topographic Delaunay TIN")
        send(proc, {"id": "12", "method": "topographic.build_tin", "params": {
            "points": [
                {"easting": 0, "northing": 0, "elevation": 10},
                {"easting": 10, "northing": 0, "elevation": 11},
                {"easting": 10, "northing": 10, "elevation": 12},
                {"easting": 0, "northing": 10, "elevation": 13},
            ],
        }})
        resp = recv(proc)
        assert resp["id"] == "12" and resp["ok"] is True
        triangles = resp["result"]["triangles"]
        assert len(triangles) == 2, f"expected 2 square faces, got {triangles}"
        assert all(len(face) == 3 and all(0 <= vertex < 4 for vertex in face) for face in triangles)
        print("  PASS")

        # Test 13: duplicate horizontal observations fail closed.
        print("Test 13: topographic duplicate position rejection")
        send(proc, {"id": "13", "method": "topographic.build_tin", "params": {
            "points": [
                {"easting": 0, "northing": 0, "elevation": 10},
                {"easting": 10, "northing": 0, "elevation": 11},
                {"easting": 0, "northing": 10, "elevation": 12},
                {"easting": 0, "northing": 0, "elevation": 99},
            ],
        }})
        resp = recv(proc)
        assert resp["id"] == "13" and resp["ok"] is False
        assert resp["error"]["code"] == "INVALID_PARAMS"
        print("  PASS")

        print("\nAll 13 end-to-end tests PASSED")

    finally:
        proc.stdin.close()
        proc.wait(timeout=5)
        stderr = proc.stderr.read().decode("utf-8", errors="replace")
        if stderr:
            print(f"\n--- sidecar stderr (logs) ---\n{stderr}", file=sys.stderr)

if __name__ == "__main__":
    main()
