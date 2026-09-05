## 2024-09-05 - Fix XSS in CrossSectionView
**Vulnerability:** Unsanitized SVG string from `renderCrossSectionSvg` passed directly to `dangerouslySetInnerHTML` in `CrossSectionView.tsx`.
**Learning:** Even generated SVG strings can be vectors for XSS if they include unsanitized user input (e.g. feature names from survey data).
**Prevention:** Always use DOMPurify when using `dangerouslySetInnerHTML`, especially with SVG strings. Ensure `{ USE_PROFILES: { svg: true } }` is passed.
