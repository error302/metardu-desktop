
---
Task ID: desktop-project-jurisdiction-default
Date: 2026-10-12
Task: Remove the implicit Kenya jurisdiction from project creation

Changed files:
- `metardu-v2/apps/desktop/src/renderer/views/ProjectsPanel.tsx`
- `metardu-v2/apps/desktop/src/tests/project-store-core.test.ts`
- `metardu-v2/apps/desktop/src/tests/projects-panel-jurisdiction.test.ts`
- `metardu-v2/docs/agent-briefs/desktop-project-jurisdiction-default.md`
- `worklog.md`

Work Log:
- Project creation now starts with an empty jurisdiction and labels it optional. The picker uses the canonical configured-country registry; the surveyor may create a neutral project without choosing one.
- A jurisdiction change clears any selected jurisdiction-specific template and its detail panel. The project list shows `Not specified` for neutral projects.
- Confirmed the local project store and SQLite schema preserve the empty country code; no database migration was needed. Added a core regression test for neutral project storage and UI contract tests for the no-default behavior.
- The existing product plan and licensing view already state that active paid METARDU Web accounts include Desktop on the same account, with Web-owned seat assignments. This milestone did not alter subscription authentication. The server verification path remains explicitly unconnected until the Web service exposes a safe desktop-capable entitlement contract.

Verification:
~~~text
$ npx vitest run --config vitest-desktop-project-jurisdiction-20261012.mjs apps/desktop/src/tests
Test Files  18 passed | 1 skipped (19)
Tests  230 passed | 7 skipped (237)
Exit code: 0
~~~

~~~text
$ npx tsc --noEmit -p tsconfig.renderer-check.json
No TypeScript diagnostics; exit code 0.

$ npx tsc --noEmit -p apps/desktop/tsconfig.json
No TypeScript diagnostics; exit code 0.
~~~

Stage Summary:
- Project setup no longer chooses Kenya implicitly; local statutory templates remain limited to configured jurisdictions and are never implied for neutral projects.
- Shared Web/Desktop subscription semantics remain as documented; real server verification, desktop sign-in, and OS-protected credential storage remain release gates.
