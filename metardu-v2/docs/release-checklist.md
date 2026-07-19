# Release Checklist — MetaRDU Desktop

> Use this checklist for every release. No exceptions. Per master plan
> Section 0 rule 6, every checkbox must be verifiable with terminal
> output or a screenshot.

## Versioning

Follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0): First production-ready release. Breaking changes
  to the file format or IPC protocol after this point require a major
  bump.
- **MINOR** (0.X.0): New survey types, new countries, new document
  renderers. Backward compatible.
- **PATCH** (0.X.Y): Bug fixes, tolerance updates, doc improvements.
- **SUFFIX**: `-alpha`, `-beta`, `-rc.N` for pre-releases.

Current version: `0.2.0` (next release tag: `v0.2.0-alpha`).

## Pre-release checks

Run all of these locally. If any fail, the release is blocked.

### Build gate

```bash
cd metardu-v2
# Sidecar (Rust)
cd packages/metardu-sidecar
cargo build --release
cargo test --release
cd ../..

# TypeScript packages
cd packages/engine && npx tsc --noEmit && npx vitest run
cd ../country-config && npx tsc --noEmit && npx vitest run
cd ../electron-integration && npx tsc --noEmit && npx vitest run
cd ../ipc-schemas && npx tsc --noEmit && npx vitest run
cd ../../tests && npx vitest run
cd ../apps/desktop && npx tsc --noEmit && npx vitest run
```

All must pass with zero errors and zero failing tests.

### End-to-end smoke

```bash
/home/z/my-project/scripts/electron-smoke.sh
```

Must end with `=== SMOKE TEST PASSED ===`.

### Statutory document check

For every statutory document the release claims to support:

1. Source regulatory document is filed in
   `docs/regulatory-sources/<country>/<doc-type>/`.
2. Renderer exists in `packages/engine/src/documents/`.
3. Spec doc exists with page/clause citations for every layout decision.
4. Golden fixture exists in `tests/golden-fixtures/<country>/`.
5. Generated PDF opens in a PDF viewer and visually matches the spec.

For v0.2.0-alpha, only Kenya Form 3 is supported (with DRAFT watermark
pending Survey Act Cap. 299 form template filing).

## Cutting the release

### 1. Bump version

Update `apps/desktop/package.json` version field. Commit:

```bash
cd metardu-v2/apps/desktop
# Edit package.json: bump version
git add package.json
git commit -m "release: bump version to 0.2.0-alpha"
git push origin main
```

### 2. Tag the release

```bash
git tag -a v0.2.0-alpha -m "v0.2.0-alpha — first installable build"
git push origin v0.2.0-alpha
```

The `release.yml` workflow triggers on tag push and builds all 3
platforms. Artifacts are attached to a GitHub Release automatically.

### 3. Monitor the build

Go to https://github.com/error302/metardu-desktop/actions

Wait for all 3 jobs (release-linux, release-windows, release-macos)
to complete. If any fail, fix and re-tag.

### 4. Verify the release artifacts

Go to https://github.com/error302/metardu-desktop/releases

The release should have:
- `MetaRDU-Desktop-Setup-0.2.0-alpha.exe` (Windows installer)
- `MetaRDU-Desktop-0.2.0-alpha.dmg` (macOS, x64 + arm64)
- `MetaRDU-Desktop-0.2.0-alpha.AppImage` (Linux)
- `MetaRDU-Desktop-0.2.0-alpha.deb` (Linux Debian package)

Download each, verify SHA256:

```bash
sha256sum *.exe *.dmg *.AppImage *.deb
```

Compare against the SHA256SUMS.txt file uploaded by the workflow.

### 5. Smoke-test the packaged app

On each platform (or at minimum Linux):

```bash
# Linux
chmod +x MetaRDU-Desktop-0.2.0-alpha.AppImage
./MetaRDU-Desktop-0.2.0-alpha.AppImage
```

Verify:
- App window opens
- Sidebar shows MetaRDU logo
- Status bar shows "sidecar: running"
- Cadastral view is accessible (even if empty)
- No error dialogs

### 6. Write release notes

Use this template:

```markdown
# MetaRDU Desktop v0.2.0-alpha

First installable build. **Not for production use.**

## What's new

- Full Electron desktop app with branded UI (logo, navy/orange palette)
- Rust sidecar with 32 IPC methods (geodesy, COGO, adjustment, GDAL,
  MAVSDK mock, ODM shell-out, ML extraction stubs)
- Kenya country config (Arc 1960 / UTM 37S, ISK registration,
  Sectional Properties Act 2020, Form 3 / Form 4 / Beacon Certificate
  statutory document specs)
- Form 3 PDF renderer (DRAFT — pending Survey Act Cap. 299 verification)
- Cadastral workflow with Gauss-Newton trilateration
- 569 tests passing across 7 suites

## Known limitations

1. **Windows sidecar is Linux-compiled.** The Rust sidecar binary in
   the Windows installer is built for Linux. Windows users need WSL
   or wait for v0.2.0-beta with native Windows sidecar compilation.
2. **Unsigned binaries.** SmartScreen warning on Windows, right-click
   → Open on macOS. SignPath Foundation application pending for free
   Windows code-signing.
3. **Form 3 is DRAFT.** Every PDF carries a "DRAFT — pending
   verification against Survey Act Cap. 299" watermark until the
   source regulation is filed and the spec is verified page-by-page.
4. **Distance observations only.** The cadastral workflow handles
   distance observations; direction/azimuth/GNSS baseline observations
   require Phase 4B adjustment engine.

## What's NOT in this release

- Topographic, Engineering, Construction Setting-Out, Sectional
  Properties workflows (future phases)
- Countries beyond Kenya (Phase 8+)
- DXF companion output (PDF only for now)
- Auto-update (planned for v0.3.0 via electron-updater)

## Verification

- 569 tests passing across 7 suites
- Electron smoke test PASSED
- Form 3 PDF generated and verified with pdfinfo + pypdf

##SHA256

- Windows: ...
- macOS (x64): ...
- macOS (arm64): ...
- Linux AppImage: ...
- Linux deb: ...
```

### 7. Publish the release

On the GitHub release page, click "Publish release". The release is
now public at https://github.com/error302/metardu-desktop/releases.

## Post-release

### Update worklog

Append a worklog entry documenting:
- Release version + date
- Verification commands run + their output
- Any issues encountered during the release
- What's next

### Announce

- Twitter/X: post the release link
- Reddit: r/Surveying, r/GIS
- ISK WhatsApp groups (Mohammed's network)
- GitHub Discussions: open a thread for feedback

### Monitor

- Watch GitHub Issues for the first 48 hours
- Watch Sentry (free Developer tier — 5K errors/month) if integrated
- Respond to user feedback within 24 hours

## Rollback

If a critical bug is found post-release:

1. Mark the release as a "pre-release" on GitHub (hides it from the
   main releases page).
2. Delete the tag: `git tag -d v0.2.0-alpha && git push origin :refs/tags/v0.2.0-alpha`
3. Fix the bug on main.
4. Re-tag as `v0.2.0-alpha.1` (or `v0.2.0-beta` if significant changes).
5. Re-run the release workflow.

Do NOT delete the release artifacts — users who already downloaded
need to verify the SHA256 against the original.

## Code signing (future)

### Windows — SignPath Foundation

1. Apply at https://signpath.org/foundation (free for OSS projects,
   1-2 week approval).
2. Add SignPath integration to the GitHub repo.
3. Add `signpath.yml` config.
4. Update `release.yml` windows job to use SignPath action.
5. Users no longer see SmartScreen warning.

### macOS — Apple Developer ID ($99/year)

1. Enroll at https://developer.apple.com/programs/ ($99/year).
2. Generate a Developer ID Application certificate.
3. Add `CSC_LINK` and `CSC_KEY_PASSWORD` secrets to GitHub.
4. Update `release.yml` mac job to use the cert.
5. Notarize via `xcrun notarytool submit`.
6. Users no longer need to right-click → Open.

Buy this **only after the first paying customer** — per recovery plan §5.
