# Agent Brief: phase-0-audit

## Task ID
phase-0-audit

## Context the agent must read first
- upload/METARDU-DESKTOP-MASTER-PLAN.md (the controlling master plan)
- (AGENT.md did not yet exist — this brief retroactively documents phase 0)

## Required audit before writing code
- `git log --oneline` — understand the existing commit history
- `git ls-files` — see what is actually tracked
- `cat .env` — check for secrets
- `cat .gitignore` — check what's excluded
- `cat worklog.md` — read prior claims

## Hard constraints
- No code changes yet — this phase is purely diagnostic
- No claims of "tests passing" without verbatim terminal output

## Acceptance criteria

### Build attempt
- [x] `cargo build --release` — captured 9 compile errors in gdal.rs
- [x] `npx tsc --noEmit` — captured 10 TS errors in engine
- [x] `npm test` in engine — captured 42 failing gnss tests

### Audit doc
- [x] `metardu-v2/docs/audits/phase-0-baseline.md` exists with verbatim
  command output, severity-ranked defect list, and 6-phase fix plan.

## Anti-hallucination clause
> If you are uncertain whether a regulatory detail, file location, or
> existing behavior is correct, stop and state the uncertainty explicitly.
> Do not fabricate test results, completion percentages, or file contents.
> A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog entry
Appended to `worklog.md` as `Task ID: phase-0 + phase-1a`. See commit
82ec7f7.

## Outcome
Phase 0 revealed that prior worklog claims of "145 tests passing" and
"release binary builds cleanly" were false. Phase 1A fixed all engine
re-exports and sidecar gdal API drift. Phase 1B built the real Electron
shell. All work committed and pushed.
