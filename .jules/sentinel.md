## 2024-03-24 - [Fix Cross-Site Scripting (XSS) via dangerouslySetInnerHTML]
**Vulnerability:** The application uses dangerouslySetInnerHTML to render SVG html strings directly in React (apps/desktop/src/renderer/views/CrossSectionView.tsx). Unsanitized input here can lead to Cross-Site Scripting (XSS).
**Learning:** Rendering raw strings, especially SVG and HTML from state or properties, via dangerouslySetInnerHTML without proper sanitization exposes the application to XSS attacks.
**Prevention:** Use DOMPurify to sanitize HTML/SVG strings before passing them to dangerouslySetInnerHTML. Ensure DOMPurify configuration includes options appropriate for SVG elements (e.g., { USE_PROFILES: { svg: true } }).
