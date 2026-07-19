# Agent Task Brief Template

> Copy this file to `docs/agent-briefs/<task-id>.md` and fill it in.
> Every task gets a brief. No exceptions (master plan Section 10).

```markdown
# TASK: <specific, single vertical slice — never "build the cadastral module">

## Task ID
<e.g. phase-5-kenya-cadastral-form3>

## Context the agent must read first
- [ ] AGENT.md
- [ ] docs/invariants.md
- [ ] ADRs relevant to this task:
  - [ ] docs/decisions/00XX-...
- [ ] Regulatory source doc(s) (if statutory output):
  - [ ] docs/regulatory-sources/<country>/<doc-type>/...
  - [ ] OR explicit note: "none required, this task is country-agnostic"
- [ ] Most recent worklog entries (last 3+)

## Required audit before writing code
List the exact files the agent must open and paste verbatim contents of
before proposing a change. If a cited invariant conflicts with this task,
STOP and report the conflict — do not silently resolve it.

- <file path> — what to look for in this file
- <file path> — what to look for in this file

## Hard constraints (restate relevant subset of invariants, every time)
- e.g. "Sidecar owns the adjustment math. Do not implement any least-squares
  logic in TypeScript."
- e.g. "SRID must be read from CountrySurveyConfig. A literal SRID number
  anywhere outside country-config/ is a failing review."
- e.g. "Renderer has no Node access. New privileged operations must go
  through the preload allowlist — adding to the allowlist requires an ADR."

## Acceptance criteria (must be independently verifiable, not agent-asserted)

### Build
- [ ] `cargo build --release` in `packages/metardu-sidecar/` — paste last
  10 lines of output
- [ ] `npx tsc --noEmit` in `packages/engine/` — paste output (must be
  empty)
- [ ] `npx tsc --noEmit` in `apps/desktop/` — paste output (must be empty)

### Tests
- [ ] `cargo test --release` in `packages/metardu-sidecar/` — paste last
  10 lines, including `test result: ok. N passed; 0 failed`
- [ ] `npm test` in `packages/engine/` — paste last 5 lines, including
  `Tests N passed (N)`
- [ ] Golden fixture(s) that must pass, named explicitly:
  - [ ] `tests/golden-fixtures/<name>.ts`

### UI / IPC (if applicable)
- [ ] `scripts/electron-smoke.sh` — paste last 10 lines including
  `=== SMOKE TEST PASSED ===`
- [ ] Screenshot/diff evidence for any visual change (paste path)

## Anti-hallucination clause (verbatim, every brief)

> If you are uncertain whether a regulatory detail, file location, or
> existing behavior is correct, stop and state the uncertainty explicitly.
> Do not fabricate test results, completion percentages, or file contents.
> A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement

On completion, append (do not overwrite) an entry to `worklog.md` in the
existing format (see AGENT.md Section 6), including:
- What was verified and how (verbatim terminal output)
- Artifacts produced (file paths)
- What's next

## Out of scope (explicit)
List things this task does NOT do, so a future agent doesn't mistake
partial work for unfinished work:
- <not doing X>
- <not doing Y>
```
