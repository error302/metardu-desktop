## 2024-05-20 - Prevent XSS in Raw SVG Rendering
**Vulnerability:** XSS vulnerability when rendering raw SVG strings using dangerouslySetInnerHTML in React components.
**Learning:** Always use DOMPurify when sanitizing SVG strings, and pass `{ USE_PROFILES: { svg: true } }` so necessary SVG elements are retained.
**Prevention:** Always sanitize user-provided or externally-generated HTML/SVG strings before rendering them via dangerouslySetInnerHTML.
