## 2024-05-15 - DOMPurify Missing in dangerouslySetInnerHTML
**Vulnerability:** XSS vulnerability through dangerouslySetInnerHTML without sanitization.
**Learning:** Found usage of dangerouslySetInnerHTML to render SVGs without ensuring that the inputs were sanitized properly, opening the possibility for XSS if user inputs enter the SVG creation flow. DOMPurify must be configured correctly for SVGs.
**Prevention:** Always use DOMPurify when rendering raw HTML or SVGs, specifically with `{ USE_PROFILES: { svg: true } }` when dealing with SVG content.
