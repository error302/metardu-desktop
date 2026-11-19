# TASK: Fail closed on Web subscription lookup errors

## Task ID
subscription-api-fail-closed

## Owner decision
Every active paid METARDU Web plan includes Desktop through the same account. The Web server owns subscription eligibility. Unauthenticated or unavailable subscription state must never look like a valid free or paid account.

## Scope
- Web `src/app/api/subscription/route.ts` GET authentication and service-error responses.
- Regression tests for signed-out, authenticated free, and subscription-service failure paths.
- No Desktop credential flow or entitlement gate is implemented in this vertical slice.

## Acceptance criteria
- Signed-out requests return HTTP 401 with a stable authentication error and no `plan` or `status` fields.
- Subscription lookup failures return HTTP 503 with a stable unavailable error and no `plan` or `status` fields.
- Error responses are marked `Cache-Control: no-store`.
- An authenticated account with no subscription row still receives the legitimate free state.
- Route regression suite passes; append exact results to both repository worklogs.

## Verification and state
- Web route tests: 3 passed.
- Web `npm run typecheck` remains blocked by the unrelated existing error in `src/lib/pdf/generatePdf.ts:41` (`networkidle0` is not accepted by the installed Puppeteer types).
- The Web change is committed locally as `6b6dc6a` on `codex/desktop-shared-entitlement`, based on `origin/main` at `a8b94a46`.
- The push was rejected by automatic review because ownership/trust for the separate Web GitHub destination could not be verified. The branch remains local until the owner approves that specific push.
- The original Web checkout and its unpublished local changes were left untouched. The published Web endpoint has not been updated or deployment-verified.

## Remaining shared-entitlement work
- Add the authenticated Desktop account authorization and versioned entitlement exchange.
- Use protected OS credential storage, define server-side revocation and seat behavior, and select an offline entitlement policy.
- Keep Desktop access fail-closed until those pieces are implemented and verified.

## Anti-hallucination clause
Do not claim that this API error fix enables Desktop sign-in or grants Desktop access. A server-side account flow, secure credential handling, and a deployed entitlement contract are still required.
