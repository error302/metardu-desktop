# TASK: Install and run a local community extension package

## Task ID
desktop-community-extension-package-v1

## Context
- Follow ADR-0001, ADR-0003, ADR-0007, `docs/invariants.md`, and `AGENT.md`.
- ABI v1 currently lets a user choose a raw `.wasm` for a temporary JSON-only preview. It does not install or persist extensions.
- The user wants a community extension path so surveyors can add specialist tools without giving those tools ambient access to Desktop.
- The controlling `upload/METARDU-DESKTOP-MASTER-PLAN.md` is absent. Do not reconstruct or claim to replace it in this task.

## Goal
Allow an offline `.mdplug` package to be imported into a local content-addressed store and explicitly run through the existing no-import WebAssembly ABI v1 runtime. An installed package is still untrusted Community / Draft code; it receives only the JSON input shown in the preview.

## Package v1 contract
- ZIP entries must be exactly `manifest.json`, `module.wasm`, and `LICENSE.txt`, each at the archive root.
- Reject encrypted, malformed, duplicate, unsupported, oversized, path-bearing, or extra entries; cap compressed and actual decompressed sizes before retaining contents.
- The strict manifest declares format/version, claimed reverse-domain ID, version, name, description, publisher name, license identifier/text filename, ABI version, and SHA-256 of the module.
- The installer computes the package SHA-256 from the exact imported bytes and stores the immutable package as `<package-sha256>.mdplug` under Desktop's user-data directory. No archive member is extracted to a path.
- Re-verify package and module digests when listing and immediately before execution. A corrupt or mismatched package cannot run.
- Installation never executes the module. Running remains a separate user action and continues through the Rust Wasmtime sandbox.
- The app records no publisher signature or identity proof; all package metadata is claimed and output remains Community / Draft.

## Acceptance criteria
- Main process owns the local file dialog, package parsing, and content-addressed store. Preload exposes only narrow typed install/list/run calls; renderer receives no filesystem path or module bytes.
- The Extensions view lists installed packages and can run a selected package with explicit bounded JSON input. Manifest identity replaces free-form identity for installed packages.
- The result includes host-computed package and module hashes and remains visibly Community / Draft.
- Corrupt storage is surfaced as an issue and is never passed to Wasmtime.
- Focused package-store tests, IPC schema tests, Desktop tests, and Desktop TypeScript build/typecheck pass. Worklog records command outputs and evidence limits.
- Only task-owned files are committed and pushed to `error302/metardu-desktop`; existing staged and untracked work is preserved.

## Explicit non-goals
- Catalog, signatures, publisher authentication, package update/removal, or automatic execution.
- Project, instrument, network, filesystem, or point-cloud data capabilities.
- Any claim that this package path implements point-cloud classification or validates a surveying method.

## Anti-hallucination clause
> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.
