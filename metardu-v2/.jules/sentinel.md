## 2026-08-29 - Sanitize SVG Rendering in React Components

**Vulnerability:** The application was using `dangerouslySetInnerHTML` directly with unsanitized SVG strings (e.g., `svgHtml` in `CrossSectionView.tsx`).

**Learning:** This approach leaves the application vulnerable to Cross-Site Scripting (XSS) if the SVG data originates from untrusted sources or if user input is injected into the SVG generation process. The lack of sanitization exposes the application to executing malicious scripts embedded within the SVG content.

**Prevention:** Always sanitize raw HTML or SVG strings using a trusted library like `DOMPurify` before rendering them with `dangerouslySetInnerHTML`. Ensure that `DOMPurify.sanitize()` is applied consistently across all components that dynamically render HTML or SVG content.