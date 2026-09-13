## 2024-10-27 - [XSS via un-sanitized SVG rendered in React]
**Vulnerability:** Raw SVG strings generated in renderCrossSectionSvg were rendered using dangerouslySetInnerHTML without sanitization, leading to a potential XSS vulnerability if data in the survey state (features, offsets, etc.) were malicious.
**Learning:** When sanitizing SVG strings using DOMPurify, it is critical to pass the `{ USE_PROFILES: { svg: true } }` option. Without this, DOMPurify strips out valid SVG elements, breaking the visualization.
**Prevention:** Always sanitize raw HTML/SVG strings with DOMPurify before passing to dangerouslySetInnerHTML in React components, and ensure appropriate profiles (like `svg`) are used when dealing with specific non-HTML namespaces.
