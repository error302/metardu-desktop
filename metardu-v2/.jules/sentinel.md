## 2024-05-18 - [Fix XSS via SVG Rendering]
**Vulnerability:** XSS vulnerability in `CrossSectionView.tsx` due to rendering unsanitized SVG string directly using `dangerouslySetInnerHTML`.
**Learning:** Raw SVGs can contain embedded `<script>` tags that will execute when injected into the DOM via `dangerouslySetInnerHTML`. This is particularly critical in Electron renderer processes if context isolation is weak, but generally a pervasive XSS risk across all React apps.
**Prevention:** Always use `DOMPurify` to sanitize raw HTML or SVG strings before rendering them via `dangerouslySetInnerHTML` in React components. When sanitizing SVG strings, ensure you pass `{ USE_PROFILES: { svg: true } }` so that necessary SVG elements are retained.
