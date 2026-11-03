## 2026-11-03 - [XSS] Unsanitized SVG rendering
**Vulnerability:** dangerouslySetInnerHTML was used with dynamically generated SVGs without sanitization.
**Learning:** When generating complex UI components like SVGs dynamically based on properties or state, we must sanitize before using dangerouslySetInnerHTML.
**Prevention:** Always use DOMPurify with svg profile when rendering SVG strings in dangerouslySetInnerHTML.
