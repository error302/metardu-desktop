import type { Plugin } from "vite";

/**
 * External map references are fetched in the main process. Renderer images are
 * supplied through bounded blob URLs, so no cadastral provider origin is
 * allowed by this image policy.
 */
export const PUBLIC_MAP_CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://a.tile.openstreetmap.org " +
  "https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org " +
  "https://server.arcgisonline.com https://a.tile.opentopomap.org https://b.tile.opentopomap.org " +
  "https://c.tile.opentopomap.org; font-src 'self' data:; " +
  "connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'";

export function publicMapReferenceCspPlugin(): Plugin {
  return {
    name: "metardu-public-map-reference-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head><meta http-equiv="Content-Security-Policy" content="${PUBLIC_MAP_CONTENT_SECURITY_POLICY}" />`,
      );
    },
  };
}
