## 2025-05-18 - Fix XSS Vulnerability in CrossSectionView
**Vulnerability:** Raw SVG HTML from `renderCrossSectionSvg` was being passed directly to `dangerouslySetInnerHTML` in `CrossSectionView.tsx`, opening the door to XSS.
**Learning:** Using `dangerouslySetInnerHTML` is inherently risky, even if the content originates from an internal rendering function. A malicious payload injected into the `surveyState` could potentially be evaluated.
**Prevention:** Always sanitize data passed to `dangerouslySetInnerHTML` using libraries like DOMPurify. For SVG content, use the `{ USE_PROFILES: { svg: true } }` configuration to avoid stripping essential SVG elements.
