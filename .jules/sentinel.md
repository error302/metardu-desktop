## 2026-11-11 - Prevent XSS in CrossSectionView SVG rendering
**Vulnerability:** XSS vulnerability where raw SVG string was rendered directly using dangerouslySetInnerHTML.
**Learning:** SVG components can contain executable scripts. React's dangerouslySetInnerHTML provides no built-in sanitization.
**Prevention:** Always sanitize raw HTML or SVG strings using DOMPurify (with { USE_PROFILES: { svg: true } } for SVG) before passing to dangerouslySetInnerHTML.
