# TASK: Kenya Form 3 — Spec verification (close out the DRAFT watermark)

## Task ID
tier1-kenya-form3-verification

## Context the agent must read first
- [x] AGENT.md
- [x] docs/invariants.md (confirmed by reading AGENT.md §7 no-guessing
      clause and §4 verification protocol)
- [ ] ADRs relevant to this task:
  - [x] docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md (architecture)
  - [x] docs/decisions/0004-kenya-as-reference-country.md (KE as reference)
- [x] Regulatory source doc(s) — this task IS the verification:
  - [x] docs/regulatory-sources/kenya/cadastral/survey-act-cap-299-revised-2012.pdf (FILED)
  - [x] docs/regulatory-sources/kenya/cadastral/kenya-gazette-survey-regulations-1994.pdf (FILED)
  - [x] docs/regulatory-sources/kenya/cadastral/cadastral-survey-guidelines.pdf (FILED)
  - [x] docs/regulatory-sources/kenya/cadastral/form-3-spec.md (cited spec)
- [x] Most recent worklog entries (last entry: Task ID 17 packaging —
  pulled as 684d735)

## Required audit before writing code

- `AGENT.md` §7 — "No guessing at regulatory formats." The watermark only
  comes off when (a) cited sources are on disk (they are) and (b) the
  Verification Document has a clause-by-clause mapping or explicit
  unverified flags.
- `docs/regulatory-sources/kenya/cadastral/form-3-spec.md` — current
  cited layout. Spec's own §"What this spec does NOT yet cover" lists
  five items that need page-by-page Act verification.
- `packages/engine/src/documents/form-3.ts` — current renderer. Has
  `drawDraftWatermark` function (line 732) and `hasDraftWatermark`
  field on `Form3Output` (line 113). Both are removed in this task.
- `packages/engine/src/documents/tests/form-3.test.ts` — current golden
  test for a 0.25 ha parcel in Kasarani. Two new assertions are added.

## Hard constraints
- Invariant #1 (sidecar owns the math) — not relevant to this task
  (PDF layout, not math).
- Invariant #2 (SRID from country config) — preserved; renderer reads
  `KENYA`/`KENYA.srid` via `country-config` (do not regress).
- Invariant #4 (renderer sandboxed) — not relevant (no IPC change).
- Invariant #7 (no guessing at regulatory formats) — the entire task.
- AGENT.md §7 forbidden list — none apply.

## Acceptance criteria (independently verifiable)

### Build
- [ ] `npx tsc --noEmit` in `metardu-v2/packages/engine/` — empty output
      (paste output; AGENT.md §4 forbids "tests obviously pass" claims)
- [ ] `cd packages/engine && npx tsc` — bundle produces `.js` files

### Tests
- [ ] `npm test --workspaces --silent` from `metardu-v2/` — last lines
      include suite counts + green status. (If whole-workspace fails for
      reasons not introduced here, paste the error and isolate to this
      task's footprint.)

### Renderer / spec
- [ ] The string `DRAFT — pending verification` no longer appears anywhere
      in `src/` (grep committed tree).
- [ ] `Form3Output` no longer carries `hasDraftWatermark`.
- [ ] A `VerificationDocument` reference is added to the egress of the
      renderer (a small, non-legal footer pointing at the verification
      doc path).

### Worklog + audit
- [ ] `docs/regulatory-sources/kenya/cadastral/SOURCE-VERIFICATION.md`
      exists with an element-by-element mapping table.
- [ ] `worklog.md` has the entry appended (not overwritten).

## Anti-hallucination clause (verbatim)

> If you are uncertain whether a regulatory detail, file location, or
> existing behavior is correct, stop and state the uncertainty explicitly.
> Do not fabricate test results, completion percentages, or file contents.
> A partial, honest report is acceptable; a fabricated complete one is not.

Specifically for this task: because the environment has no PDF text
extractor, I CANNOT read the inside of
`survey-act-cap-299-revised-2012.pdf`. The "page-by-page" Act check
that the spec's §"NOT YET cover" items demand REQUIRES a surveyor with
the filed PDF open. That gap is **explicitly logged in the verification
doc and in the worklog**, and signoff remains with Mohammed.

## Worklog requirement

Append (append-only, per AGENT.md §6) an entry titled
`Task ID: tier1-kenya-form3-verification` summarising what was done,
how verified (verbatim tsc / npm-test output), artifacts produced,
and explicit "not done" items.

## Out of scope (explicit)
- Not issuing legal clearance for lodgement with the Kenyan Lands
  Registry. Page-by-page Act verification is human-in-the-loop.
- Not touching the DXF or GeoJSON exporters in `packages/engine/src/export/`
  (they're separate statutory outputs).
- Not modifying the sidecar, country-config, or Electron app.
