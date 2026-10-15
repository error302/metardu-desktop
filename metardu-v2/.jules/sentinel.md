## 2026-08-15 - XSS Vulnerability in Loading Screen
**Vulnerability:** XSS via unsafe `innerHTML` usage in `apps/desktop/src/renderer/main.tsx`.
**Learning:** Hardcoded strings or dynamic URLs assigned to `innerHTML` are unsafe and can introduce XSS. The MetaRDU Desktop renderer has high privileges via preload bridge.
**Prevention:** Use safe DOM manipulation APIs (`document.createElement`, `element.setAttribute`, `element.textContent`, `element.appendChild`) to construct DOM elements safely and treat URL/text data as data instead of HTML markup.
