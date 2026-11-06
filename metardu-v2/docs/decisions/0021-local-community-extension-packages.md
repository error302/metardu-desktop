# ADR-0021: Offline local community extension packages

**Status:** Accepted for ABI v1 local package preview
**Date:** 3 November 2026
**Supersedes:** None

## Context

ABI v1 currently accepts a user-selected raw WebAssembly module, a manually entered claimed ID/version, and manually entered JSON. The module is held only in a short-lived main-process cache. Developers cannot distribute one inspectable package with its manifest and licence, and surveyors cannot list the packages they have explicitly imported.

## Decision

- Define `.mdplug` v1 as a ZIP archive containing exactly three root entries: `manifest.json`, `module.wasm`, and `LICENSE.txt`.
- Reject all extra, duplicate, nested/path-bearing, encrypted, malformed, unsupported-compression, or oversized entries. Package members are read into bounded memory and never extracted by path.
- The strict manifest declares the claimed plugin ID/version/name/description/publisher, licence identifier, ABI version, and module SHA-256. The host computes a SHA-256 for the exact package bytes.
- Store imported packages immutably under a filename derived only from the host-computed package digest in Desktop's app-data directory. Listing and running re-read the stored package and re-verify its digest and declared module hash.
- Import is not execution. The surveyor must explicitly run an installed package. Execution remains an ABI v1 WebAssembly core module with no imports, WASI, or host capabilities and with the existing Wasmtime resource limits.
- Package publisher and licence metadata are claims, not independently authenticated. No signature is verified. Outputs remain Community / Draft, and a paid Desktop entitlement does not change this.
- Package execution still accepts only user-entered bounded JSON. It cannot read the active project, access a point cloud, persist an output artifact, or classify survey data.

## Consequences

- A surveyor can import and keep several offline tool packages and run a chosen version without reselecting its raw module each session.
- A package SHA binds the local exact bytes; it does not prove publisher identity, licence validity, code safety beyond the current Wasmtime boundary, or method quality.
- Package import does not establish a plugin marketplace or a stable developer SDK. Project-data capabilities, durable derived artifacts, signatures/catalog, package upgrades, and point-cloud processing require separate reviewed tasks.

## Verification gates

- Test package parsing and storage against valid, malformed, duplicate, path-bearing, extra-member, oversized, mismatched-digest, and post-install-tampered packages.
- Test that package import does not invoke the Wasmtime runner and that only a digest-verified module can be submitted for explicit execution.
- Keep source/project data absent from the JSON-only execution request.

## References

- ADR-0001: Rust sidecar, TypeScript engine, Electron shell.
- ADR-0003: ContextBridge with method allowlist.
- ADR-0007: A community extension ecosystem for survey workflows.
- `docs/community-extensions/ABI-v1.md`.
- `docs/invariants.md` sections A1, A4, A5, D3, and E3.
