## 2023-10-27 - [XSS in SVG Rendering]
**Vulnerability:** Raw SVG string rendered directly via `dangerouslySetInnerHTML` in `CrossSectionView` component.
**Learning:** Even though SVG is generated internally, user input or survey data could inject malicious elements into the SVG.
**Prevention:** Always sanitize HTML/SVG strings with `DOMPurify` before rendering with `dangerouslySetInnerHTML`.
