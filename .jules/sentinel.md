## 2026-10-10 - Protect Against XSS from SVG Output Rendering
**Vulnerability:** The application was vulnerable to Cross-Site Scripting (XSS) due to rendering unsanitized SVG strings (generated in `CrossSectionView.tsx`) directly via React's `dangerouslySetInnerHTML`.
**Learning:** Even internal SVG strings or HTML content derived from within the application should be treated defensively to prevent malicious injections or malformed structures from executing unintended scripts within the client interface.
**Prevention:** Always sanitize dynamically constructed or retrieved SVG/HTML using tools like `DOMPurify` before injecting them via `dangerouslySetInnerHTML`, ensuring to retain necessary configurations like `{ USE_PROFILES: { svg: true } }` for SVGs.
