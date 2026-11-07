## 2026-11-07 - XSS in CrossSectionView
**Vulnerability:** XSS vulnerability by rendering un-sanitized SVG strings via dangerouslySetInnerHTML.
**Learning:** SVG strings must always be sanitized before injection to prevent embedded scripts from executing.
**Prevention:** Always use DOMPurify with the SVG profile when injecting SVG markup.
