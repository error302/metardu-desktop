## 2026-10-16 - SVG Sanitization Missing before dangerouslySetInnerHTML
**Vulnerability:** XSS via un-sanitized SVG strings passed to dangerouslySetInnerHTML in React components.
**Learning:** The codebase renders raw SVG strings directly using `dangerouslySetInnerHTML`. SVGs can contain executable code (e.g., `<script>`, `onload` handlers), which creates an XSS vulnerability if the source data is ever user-controlled or compromised.
**Prevention:** Always use `dompurify` with `{ USE_PROFILES: { svg: true } }` when rendering SVG strings via `dangerouslySetInnerHTML`.
