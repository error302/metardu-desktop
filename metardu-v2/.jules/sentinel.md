## 2024-05-23 - Prevent XSS in dangerouslySetInnerHTML
**Vulnerability:** Use of `dangerouslySetInnerHTML` with raw un-sanitized HTML (`svgHtml`) strings which exposes the application to XSS attacks.
**Learning:** Raw dynamic inputs should never be passed directly to `dangerouslySetInnerHTML`.
**Prevention:** Use `dompurify` to sanitize raw HTML or SVG strings before rendering.
