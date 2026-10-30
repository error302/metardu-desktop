## 2025-02-23 - XSS in SVG generation
**Vulnerability:** Cross-Site Scripting (XSS) via unsanitized user-controlled `feature` field injected into raw SVG string that is rendered with `dangerouslySetInnerHTML`.
**Learning:** Even dynamically constructed SVG strings using math/coordinates can introduce XSS if any text labels/attributes are user-controllable.
**Prevention:** Always use `DOMPurify.sanitize` with `{ USE_PROFILES: { svg: true } }` when rendering dynamically built SVGs via `dangerouslySetInnerHTML`.
