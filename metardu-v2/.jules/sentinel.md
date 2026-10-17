## 2026-10-17 - Fix XSS in SVG rendering via dangerouslySetInnerHTML
**Vulnerability:** Untrusted string input concatenated into SVG elements and rendered using React dangerouslySetInnerHTML allowing for XSS if payload escapes rendering context.
**Learning:** SVG tags and properties must be sanitized when created via string concatenation and injected into React application.
**Prevention:** Use DOMPurify and call DOMPurify.sanitize with USE_PROFILES svg true profile when rendering SVG to strip malicious tags.
