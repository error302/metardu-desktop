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
SIDECAR_BIN = REPO_ROOT / "packages" / "metardu-sidecar" / "target" / "release" / "metardu-sidecar"

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

        print("\nAll 5 end-to-end tests PASSED")

    finally:
        proc.stdin.close()
        proc.wait(timeout=5)
        stderr = proc.stderr.read().decode("utf-8", errors="replace")
        if stderr:
            print(f"\n--- sidecar stderr (logs) ---\n{stderr}", file=sys.stderr)

if __name__ == "__main__":
    main()
