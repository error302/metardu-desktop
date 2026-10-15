## 2025-01-20 - [XSS Fix in CrossSectionView]
**Vulnerability:** A Cross-Site Scripting (XSS) vulnerability was found in `metardu-v2/apps/desktop/src/renderer/views/CrossSectionView.tsx` where an unsanitized SVG string (`svgHtml`) was rendered directly into the DOM using React's `dangerouslySetInnerHTML`.
**Learning:** Raw string construction for UI components, especially for SVGs that could potentially include malicious scripts, shouldn't be blindly trusted, even if internally generated, as logic changes might introduce unsafe inputs.
**Prevention:** Always use `DOMPurify` to sanitize HTML/SVG strings before passing them to `dangerouslySetInnerHTML`. When sanitizing SVGs, ensure `{ USE_PROFILES: { svg: true } }` is passed so that necessary SVG elements are retained.
