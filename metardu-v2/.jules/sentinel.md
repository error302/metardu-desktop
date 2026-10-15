## 2024-05-24 - SVG XSS via dangerouslySetInnerHTML
**Vulnerability:** Cross-Site Scripting (XSS) risk when rendering raw SVG strings using dangerouslySetInnerHTML without sanitization in React components (e.g. CrossSectionView.tsx).
**Learning:** Even internal or seemingly safe dynamically generated SVG strings can be manipulated if any portion relies on unsanitized user inputs or external data. The standard DOMPurify configuration strips SVG elements, breaking the intended functionality.
**Prevention:** Always use DOMPurify to sanitize raw HTML or SVG strings before rendering them via dangerouslySetInnerHTML. When sanitizing SVG strings, ensure you pass `{ USE_PROFILES: { svg: true } }` so that necessary SVG elements are retained.
