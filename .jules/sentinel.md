## 2024-09-17 - Unsanitized SVG rendering in React
**Vulnerability:** XSS vulnerability via unsanitized SVG string rendering using `dangerouslySetInnerHTML` in React components (e.g., `CrossSectionView.tsx`).
**Learning:** `dangerouslySetInnerHTML` can execute malicious scripts if the input contains `<script>` tags or malicious event handlers within an SVG string.
**Prevention:** Always sanitize raw HTML or SVG strings using a library like `DOMPurify` before rendering them via `dangerouslySetInnerHTML`. When sanitizing SVG, ensure `USE_PROFILES: { svg: true }` is passed to retain necessary SVG elements.
