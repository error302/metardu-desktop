# TASK: Make project jurisdiction optional and remove the Kenya creation default

## Task ID
desktop-project-jurisdiction-default

## Product rule
Project creation must not assign Kenya or another jurisdiction without the surveyor choosing it. A neutral project can be created without a jurisdiction; statutory templates remain available only for configured jurisdictions. An empty jurisdiction does not imply a CRS, units, legal standard, or survey output validity.

## Acceptance criteria
- [x] New project creation starts with no jurisdiction selected.
- [x] The selector is optional, offers an explicit neutral-project choice, and uses the canonical configured-country registry.
- [x] Changing jurisdiction clears a previously selected local template and its details.
- [x] Project storage accepts and preserves an empty country code; the project list displays it as "Not specified".
- [x] Regression coverage protects the UI default and neutral-project storage behavior.
- [x] Desktop tests, renderer type-check, and `git diff --check` are recorded in `worklog.md`.

## Constraints
- Do not add unsupported country packs or imply statutory support for jurisdictions that have not been configured and reviewed.
- Do not infer CRS, units, coordinate epoch, legal accuracy, or regulatory acceptance from an empty jurisdiction.
- Do not change the shared METARDU Web/Desktop subscription contract as part of this task.
