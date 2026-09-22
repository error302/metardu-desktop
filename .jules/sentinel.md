## 2026-09-22 - Prevent XSS in SVG Rendering using DOMPurify
**Vulnerability:** Rendering unsanitized SVG payloads via `dangerouslySetInnerHTML` allows for Cross-Site Scripting (XSS).
**Learning:** `dangerouslySetInnerHTML` should never be trusted with dynamically generated SVG strings unless appropriately sanitized.
**Prevention:** Use `DOMPurify` to sanitize SVG strings, specifically passing `{ USE_PROFILES: { svg: true } }` to ensure required SVG elements are retained, before invoking `dangerouslySetInnerHTML`.
