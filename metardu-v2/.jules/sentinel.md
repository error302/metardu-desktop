## 2025-01-20 - Prevent XSS in CrossSectionView SVG rendering
**Vulnerability:** The application was directly injecting user-controlled data (`section.points[].feature`) into a raw SVG string, which was then rendered via React's `dangerouslySetInnerHTML`. This creates an XSS risk if the user feature text contains malicious scripts or unescaped HTML/SVG tags.
**Learning:** Directly rendering raw HTML/SVG generated from untrusted data using `dangerouslySetInnerHTML` is extremely risky in React applications.
**Prevention:** Always use `DOMPurify` to sanitize raw HTML or SVG strings before passing them to `dangerouslySetInnerHTML`. When sanitizing SVG strings, ensure `USE_PROFILES: { svg: true }` is enabled so SVG elements are retained while stripping out potentially dangerous content.
