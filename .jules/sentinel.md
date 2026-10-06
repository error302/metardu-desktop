## 2024-10-06 - XSS in SVG Rendering
**Vulnerability:** A dynamically generated SVG string was being rendered directly using `dangerouslySetInnerHTML` without sanitization in `CrossSectionView.tsx`.
**Learning:** `dangerouslySetInnerHTML` should never be used without first passing the input through a robust HTML sanitizer like `DOMPurify`, even if the input is primarily derived from application logic (as it could be influenced by untrusted data such as feature names).
**Prevention:** Always sanitize dynamically constructed SVG or HTML strings with `DOMPurify` before injecting them. When dealing with SVG, pass `{ USE_PROFILES: { svg: true } }` to ensure valid SVG elements and attributes are preserved.
