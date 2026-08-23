## 2026-08-23 - XSS in SVG Rendering Fixed
**Vulnerability:** XSS vulnerability in `CrossSectionView.tsx` due to `dangerouslySetInnerHTML` rendering an SVG constructed via string interpolation where the `feature` string was directly embedded into the string.
**Learning:** Even generated SVGs that construct strings inline based on component props/states are vulnerable to XSS if they inject user-defined strings (like `feature` labels from `CrossSectionPoint`) directly without sanitization or escaping.
**Prevention:** Always use `DOMPurify.sanitize()` when injecting raw HTML/SVG strings into the DOM via `dangerouslySetInnerHTML`.
