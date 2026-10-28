## 2024-05-18 - [Fix XSS in CrossSectionView]
**Vulnerability:** XSS via unsanitized SVG string rendered with `dangerouslySetInnerHTML`.
**Learning:** `dangerouslySetInnerHTML` combined with dynamically generated SVG using user input can lead to XSS. Need to sanitize SVG before rendering.
**Prevention:** Always use `DOMPurify` to sanitize SVG/HTML before using `dangerouslySetInnerHTML`.
