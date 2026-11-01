## 2023-11-01 - [XSS Fix]
**Vulnerability:** XSS vulnerability in dangerouslySetInnerHTML rendering raw SVG in CrossSectionView
**Learning:** React dangerouslySetInnerHTML requires careful sanitization to prevent XSS when rendering SVGs.
**Prevention:** Always use DOMPurify to sanitize inputs to dangerouslySetInnerHTML, especially with `{ USE_PROFILES: { svg: true } }` for SVGs.
