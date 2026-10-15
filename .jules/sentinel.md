## 2024-10-02 - [XSS via un-sanitized SVG in dangerouslySetInnerHTML]
**Vulnerability:** Found `dangerouslySetInnerHTML` rendering SVG directly from `renderCrossSectionSvg` without sanitization. If the survey output data is manipulated, it could lead to XSS.
**Learning:** Always sanitize dynamically generated HTML/SVG in React before using `dangerouslySetInnerHTML`, even if it comes from local application state.
**Prevention:** Use DOMPurify with `{ USE_PROFILES: { svg: true } }` for SVG rendering.
