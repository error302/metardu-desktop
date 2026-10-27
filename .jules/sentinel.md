## 2023-10-27 - [XSS in SVG Rendering]
**Vulnerability:** Raw unsanitized SVG injection via `dangerouslySetInnerHTML` in `CrossSectionView.tsx`.
**Learning:** `dangerouslySetInnerHTML` is used to render dynamically generated SVG elements that include data from user input (e.g. metadata features), creating a vector for cross-site scripting (XSS).
**Prevention:** Use `DOMPurify` configured for SVG elements (`{ USE_PROFILES: { svg: true } }`) whenever injecting SVG string outputs directly into the DOM to prevent XSS payloads within SVG tags.
