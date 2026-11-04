## 2024-05-16 - Prevent XSS in SVG rendering using DOMPurify
**Vulnerability:** Unsanitized SVG strings passed directly into React's `dangerouslySetInnerHTML`.
**Learning:** Even internal SVG strings can lead to XSS vulnerabilities if they are generated based on dynamic properties or configurations without proper sanitization. The risk is specifically elevated when rendering raw graphical contents.
**Prevention:** Always use `DOMPurify` to sanitize raw HTML or SVG strings prior to rendering them via `dangerouslySetInnerHTML`. For SVGs specifically, pass the `{ USE_PROFILES: { svg: true } }` option so necessary graphical elements are retained.
