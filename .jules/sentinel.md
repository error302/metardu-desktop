## 2023-10-27 - [XSS via DangerouslySetInnerHTML in CrossSectionView]
**Vulnerability:** The application was vulnerable to XSS in `CrossSectionView.tsx` due to `dangerouslySetInnerHTML` rendering dynamically generated SVG string constructed from user-supplied feature strings.
**Learning:** `dangerouslySetInnerHTML` allows raw string execution of javascript inline elements and tags when it originates from user data in React apps, bypassing standard JSX escaping.
**Prevention:** Always use a well tested HTML sanitizer such as `DOMPurify` before injecting dynamic content with `dangerouslySetInnerHTML`. Specifically when doing this for SVGs you must enable `{ USE_PROFILES: { svg: true } }`.
