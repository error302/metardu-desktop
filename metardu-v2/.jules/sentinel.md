## 2026-09-04 - SVG XSS Prevention
**Vulnerability:** Unsanitized SVG string concatenation in `dangerouslySetInnerHTML`.
**Learning:** Using `dangerouslySetInnerHTML` to render manually constructed SVG strings without sanitization exposes the UI to Cross-Site Scripting (XSS) attacks.
**Prevention:** Always use `DOMPurify` with `{ USE_PROFILES: { svg: true } }` when rendering dynamically generated SVG strings.
