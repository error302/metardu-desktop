# TASK: Verify METARDU Desktop access through the shared Web subscription

## Task ID
desktop-shared-subscription

## Owner decision
METARDU Desktop shares the METARDU Web account and subscription. Every active paid Web plan (Pro, Team, Firm, or Enterprise) includes Desktop access for the same entitled account; existing Web account and seat assignments apply. Desktop must verify that entitlement with the METARDU server; it must not sell a separate Desktop subscription, add-on, or mint local access.

## Context the agent must read first
- [ ] `AGENT.md`
- [ ] `metardu-v2/docs/invariants.md`
- [ ] `metardu-v2/docs/decisions/0001-rust-sidecar-ts-engine-electron-shell.md`
- [ ] `metardu-v2/docs/INTERNATIONAL-DESKTOP-PRODUCT-PLAN.md`
- [ ] The latest three relevant entries in `worklog.md`
- [ ] Companion METARDU Web auth and subscription source in the Web checkout

## Required audit before implementation
- METARDU Web `src/app/api/subscription/route.ts` — authentication and all response paths, especially unauthenticated and error responses.
- METARDU Web `src/lib/subscription/subscriptionEngine.ts`, `catalog.ts`, and `featureGates.ts` — authoritative account plans and server-side features.
- METARDU Web auth configuration and session endpoints — supported providers, token lifetime, revocation, and account identity.
- METARDU Web subscription database schema and migrations — status, periods, seats, suspension, and revocation behavior.
- Desktop `packages/ui-components/src/services/license-service.ts`, `LicensingView.tsx`, `AppShell.tsx`, and tests — current fail-closed placeholder.
- Desktop `packages/engine/src/sync/sync-client.ts`, `apps/desktop/src/renderer/views/SyncPanel.tsx`, and `apps/desktop/src/main/sync.ts` — keep project synchronization separate; do not reuse its arbitrary server URL/password flow as subscription authentication.
- Desktop preload allowlist and main-process credential storage — add only typed, narrowly scoped capabilities under the relevant ADR and security review.

## Hard constraints
- The Web server is authoritative for account identity and subscription eligibility. The same account and subscription must work on Web and Desktop.
- Every active paid Web plan grants Desktop access according to a server-owned entitlement response, subject to the same account and seat assignments as Web. Do not duplicate plan pricing or choose plan-to-feature rules in the renderer.
- Never treat unauthenticated, expired, suspended, malformed, or server-error responses as `free`/`active` or as a paid entitlement. Errors fail closed.
- Do not collect passwords or API tokens in the renderer, accept an arbitrary auth server URL, trust a local tier selector, or fabricate a signed token, device id, seat, or lease.
- Preserve renderer sandboxing and use a typed, allowlisted preload API for privileged work. Keep authentication separate from project synchronization.
- Do not delete, lock, or rewrite locally stored survey projects when access cannot be verified. Paid access must never imply that survey computations or statutory outputs are verified.
- Offline entitlement behavior must match an explicit Web/server policy. Do not invent a grace period or extend an expired lease locally.

## Acceptance criteria
- Web exposes an authenticated desktop-compatible account flow and a versioned subscription/entitlement contract backed by the existing server subscription record.
- Only server-confirmed active paid Web accounts and their Web-authorized seats receive Desktop access. Unpaid accounts and failed verification states are distinct and user-visible.
- Authentication and entitlement failures never fall through to a successful free or paid state.
- Desktop credentials use the approved system-browser/account flow and protected OS storage; the renderer never receives a reusable password or broad bearer credential.
- Online renewal, sign-out, server revocation, account switching, and expired-session handling are covered by tests in both the Web and Desktop repositories.
- If offline leases are supported, their signature, scope, expiry, revocation behavior, and user-visible grace policy are server-defined and independently tested. Otherwise Desktop clearly requires an online entitlement check before granting paid access.
- The app preserves local project data in every authorization state, and the interface does not imply that subscription status certifies any survey result.
- Append exact verification output and remaining deployment or security-review gates to the Desktop worklog and the Web repository's worklog.

## Anti-hallucination clause

> If you are uncertain whether a regulatory detail, file location, or existing behavior is correct, stop and state the uncertainty explicitly. Do not fabricate test results, completion percentages, or file contents. A partial, honest report is acceptable; a fabricated complete one is not.

## Worklog requirement
Append a dated entry to `worklog.md`; do not overwrite existing evidence.

## Out of scope
- Changing Web prices, payment providers, checkout flows, or billing plans.
- Creating a second Desktop subscription or a local license issuer.
- Claiming that a successful account check makes a computation, instrument connection, jurisdiction pack, or deliverable survey-grade.
- Redesigning project synchronization as part of account verification.
