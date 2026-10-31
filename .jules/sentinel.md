## 2023-11-01 - Prevent XSS in CrossSectionView
**Vulnerability:** XSS vulnerability through unsanitized SVG content rendered via `dangerouslySetInnerHTML` in React `CrossSectionView`.
**Learning:** Even generated SVG content needs to be sanitized before rendering to prevent malicious scripts from being executed within the application context.
**Prevention:** Always use `DOMPurify` with `{ USE_PROFILES: { svg: true } }` when rendering SVG content dynamically in React components using `dangerouslySetInnerHTML`.
