/**
 * Type declarations for the renderer's `window.metardu` bridge.
 *
 * The preload script exposes this API via contextBridge.exposeInMainWorld.
 * Renderer code imports these types to get compile-time validation that
 * it only calls methods that actually exist on the bridge.
 */

import type { MetarduApi } from "../preload/index.js";

declare global {
  interface Window {
    metardu: MetarduApi;
  }
}

export {};
