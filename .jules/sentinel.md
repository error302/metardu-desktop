## 2026-09-16 - SVG Rendering XSS Vulnerability
**Vulnerability:** XSS vulnerability in `CrossSectionView.tsx` where dynamically generated SVG content, which includes user-supplied data (e.g., feature names from survey state), was rendered using `dangerouslySetInnerHTML` without sanitization.
**Learning:** SVG content constructed from untrusted data and rendered via React's `dangerouslySetInnerHTML` can act as a vector for Cross-Site Scripting (XSS) if not sanitized.
**Prevention:** Always sanitize dynamically constructed HTML or SVG strings using libraries like `DOMPurify` before injecting them into the DOM. When sanitizing SVG, ensure appropriate profiles (`{ USE_PROFILES: { svg: true } }`) are used to retain necessary SVG tags.
