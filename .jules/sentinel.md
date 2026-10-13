## 2026-10-13 - [Prevent XSS via SVG Injection]
**Vulnerability:** Raw HTML injection vulnerability using `dangerouslySetInnerHTML` with `svgHtml` inside `CrossSectionView.tsx` without sanitization.
**Learning:** Even though SVGs might be generated dynamically in the frontend, an attacker with control over the variables embedded inside the generated SVG could achieve Cross-Site Scripting (XSS).
**Prevention:** Always use `DOMPurify` to sanitize HTML content passed to `dangerouslySetInnerHTML`. Ensure `USE_PROFILES: { svg: true }` is set when validating SVGs to avoid stripping necessary vectors.
