## 2025-02-27 - [XSS vulnerability in SVG rendering]
**Vulnerability:** XSS vulnerability through dangerouslySetInnerHTML when rendering dynamically generated SVG containing user input.
**Learning:** Using dangerouslySetInnerHTML directly with raw string construction can lead to XSS if inputs (like features) contain malicious scripts.
**Prevention:** Always sanitize HTML/SVG using DOMPurify before using dangerouslySetInnerHTML, even in desktop applications, and use { USE_PROFILES: { svg: true } } for SVG retention.
