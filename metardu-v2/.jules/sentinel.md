## 2024-09-02 - [XSS in SVG Rendering]
**Vulnerability:** Un-sanitized SVG HTML string passed directly to React's `dangerouslySetInnerHTML` in `CrossSectionView.tsx`.
**Learning:** Even though SVG data is generated dynamically based on numerical or design data, attributes like feature names can contain arbitrary string input. If this input originates from untrusted sources without validation, it can inject malicious scripts into the DOM when the SVG is rendered.
**Prevention:** Always use a sanitization library like `DOMPurify` to sanitize HTML or SVG strings before rendering them via `dangerouslySetInnerHTML`.
