# TASK: Implement Direction and Azimuth observation linearizers in the Rust least-squares engine (Phase 4B)

## Task ID
phase-4b-angular-observations

## Context the agent must read first
- [ ] AGENT.md (especially: "Sidecar owns the adjustment math. Do not implement any least-squares logic in TypeScript.")
- [ ] docs/invariants.md
- [ ] docs/agent-briefs/TEMPLATE.md
- [ ] This brief's "Current state" section (derived from a fresh read of the code)
- [ ] Most recent worklog entries (last 3+)

### Current state (verified by reading the source, 2026-08-14)
- `packages/metardu-sidecar/src/adjustment/types.rs`:
  - `ObservationKind` has `Distance`, `Direction`, `Azimuth`, `HeightDifference`, `GnssBaseline`.
  - `Distance`, `Azimuth`, `Direction`, `HeightDifference` each carry 1 observed component; `GnssBaseline` carries 3. This is already enforced in `adjust_least_squares` (linear.rs:99-104).
- `packages/metardu-sidecar/src/adjustment/linear.rs`:
  - `build_design_and_misclosure` (linear.rs:301) implements Jacobian rows only for `Distance` and `HeightDifference`.
  - `HeightDifference` (linear.rs:347-362) is **already implemented** — do NOT re-implement it.
  - `Azimuth | Direction` (linear.rs:363-367) currently returns `AdjustmentError::Internal("...not yet implemented")`.
  - `GnssBaseline` (linear.rs:368-372) also errors — this is **Phase 4C, out of scope here**.
- The adjustment operates on a single `parameters: &[ParameterPrior]` list (point coordinates only). There is **no orientation-unknown concept** today. Directions require a per-station orientation unknown; this is the central design decision for this task (see Hard constraints).

## Required audit before writing code
Paste verbatim the relevant sections of these files before proposing changes:
- `packages/metardu-sidecar/src/adjustment/linear.rs` — the full body of `build_design_and_misclosure` and the signature/loop of `adjust_least_squares`.
- `packages/metardu-sidecar/src/adjustment/types.rs` — `Observation`, `ObservationKind`, `ParameterPrior`, `AdjustmentResult`.
- `packages/metardu-sidecar/src/adjustment/mod.rs` — the public exports (`adjust_least_squares`, `AdjustmentConfig`); any new parameter list must be exported/threaded here.
- If you intend to add orientation unknowns, also read how `unknown_layout` is built (linear.rs) so the new unknowns slot into the same column-index scheme.

## Hard constraints (restate relevant subset of invariants, every time)
- Sidecar owns the adjustment math. Do not implement any least-squares / Jacobian logic in TypeScript. TypeScript may only call the sidecar and consume `AdjustmentResult`.
- All new geodetic math must live under `packages/metardu-sidecar/`. No duplication into `packages/engine/`.
- Units are explicit: angular observations are expected in **radians internally**. If the public API receives degrees, convert at the boundary. Get this wrong and every angular misclosure is off by π/180.
- `HeightDifference` is already done — do not touch it. `GnssBaseline` is Phase 4C — do not implement it here.
- No fabricated tolerance/regulatory values. This task is country-agnostic (pure geometry), so no `regulatory-sources/<country>` doc is required; note that explicitly in the brief checklist.

## The math the agent must implement

### Azimuth (ObservationKind::Azimuth)
Given `from = point_indices[0]`, `to = point_indices[1]`:
```
de = E_to - E_from
dn = N_to - N_from
L2 = de*de + dn*dn
alpha_approx = atan2(dn, de)          // radians
misc = observed[0] - alpha_approx     // both in radians
```
Jacobian (radians per metre), columns for E_from, N_from, E_to, N_to:
```
dα/dE_from =  dn / L2
dα/dN_from =  de / L2
dα/dE_to   = -dn / L2
dα/dN_to   = -de / L2
```
If `observed[0]` is supplied in degrees, convert the misclosure to radians before forming Δl (or convert the partials by π/180 consistently — pick one and document it).

### Direction (ObservationKind::Direction)
A measured direction at an occupied station equals the geodetic azimuth to the target **minus the station's unknown orientation** z (a free parameter, one per occupied station):
```
direction_approx = atan2(dn, de) - z_station
misc = observed[0] - direction_approx
```
Jacobian = the azimuth partials above, plus `d(direction)/dz_station = -1` in the column belonging to `z_station`.

**Design decision — orientation unknowns:** the current `adjust_least_squares(parameters, observations, config)` signature has no place for orientation unknowns. The agent must extend the parameter model so station orientations can be adjusted. Recommended approach (pick one, justify in the PR):
1. Add a second parameter list `orientation_parameters: &[ParameterPrior]` (one entry per occupied station, holding the orientation z and a `fixed` flag), and thread it into `unknown_layout` so orientation columns sit after the coordinate columns; **or**
2. Model each occupied station's orientation as an extra synthetic `ParameterPrior` appended to `parameters`, with a documented mapping from station index → parameter index.

Either way, directions whose station orientation is `fixed` (e.g. a known backsight azimuth) must be honoured — fixed orientation contributes no column, only its value in the misclosure.

The `Direction` arm must replace the current `return Err(Internal(...))` (linear.rs:363-367) with the real linearization.

## Acceptance criteria (must be independently verifiable, not agent-asserted)

### Build
- [ ] `cargo build --release` in `packages/metardu-sidecar/` — paste last 10 lines of output.
  - NOTE: this box **cannot be ticked on the Windows dev box** — the sidecar fails to link because `gdal_i.lib` (GDAL native dev lib) is absent there (verified 2026-08-14). The build/test verification below MUST run in the Linux CI environment which has GDAL dev libraries installed. Record the CI run URL/commit in the worklog.
- [ ] `npx tsc --noEmit` in `packages/engine/` — paste output (must be empty).
- [ ] `npx tsc --noEmit` in `apps/desktop/` — paste output (must be empty).

### Tests
- [ ] `cargo test --release` in `packages/metardu-sidecar/` — paste last 10 lines, including `test result: ok. N passed; 0 failed`.
  - Must include NEW unit tests:
    - A network with one Azimuth observation adjusts and the residual equals the analytic misclosure to 1e-9.
    - A traverse of >=3 stations observed with Directions + at least one Distance, with one station orientation fixed (known backsight) and the rest free, converges and yields finite, sensible error ellipses (covariance positive-definite).
    - A Direction whose theoretical misclosure is X produces a residual within 1e-9 of X.
    - Fixed-orientation Direction honoured: fixing the orientation to the true value drives that station's orientation adjusted value to the fixed value.
- [ ] `npm test` in `packages/engine/` — paste last 5 lines, including `Tests N passed (N)` (no regression; keep 738 green).
- [ ] Golden fixture(s) that must pass, named explicitly:
  - [ ] any existing `tests/golden-fixtures/*.ts` that exercise `adjust_least_squares` indirectly must remain green.

### UI / IPC
- [ ] Not applicable to this task (pure engine math). If a follow-up wires Azimuth/Direction through an IPC channel, that is a separate brief.

## Anti-hallucination clause (verbatim, every brief)

> If you are uncertain whether a regulatory detail, file location, or
> existing behavior is correct, stop and state the uncertainty explicitly.
> Do not fabricate test results, completion percentages, or file contents.
> A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement

On completion, append (do not overwrite) an entry to `worklog.md` in the
existing format (see AGENT.md Section 6), including:
- What was verified and how (verbatim terminal output from **Linux CI**)
- Artifacts produced (file paths)
- What's next (Phase 4C GnssBaseline)

## Out of scope (explicit)
- `GnssBaseline` 3D vector observations (Phase 4C).
- Any height-datum / orthometric handling beyond the already-implemented `HeightDifference` linearizer.
- Country-specific tolerance checks (those live in `packages/country-config` and the engine `plan-checker`, built separately).
- Signed installer / Windows code-signing (separate track, also blocked on the Windows box by GDAL link + signing cert).
- Any TypeScript re-implementation of adjustment math.
