/**
 * METARDU Map PDF Export
 *
 * Uses the browser's built-in print API (`window.print()`) combined with
 * `@media print` CSS to produce a PDF from the current map view.
 *
 * Workflow:
 * 1. A <style> tag with print-specific CSS is injected.
 * 2. The caller ensures SheetLayout overlays are visible.
 * 3. `window.print()` is invoked.
 * 4. After the print dialog closes, the injected style is removed.
 *
 * This approach requires zero additional runtime dependencies.
 */

let injectedStyleEl: HTMLStyleElement | null = null;

/**
 * Inject print-specific CSS into the document head.
 * Hides everything except the map container and sheet layout overlays.
 */
function injectPrintCSS(mapContainerId: string, paperSize: string, orientation: string): void {
  if (injectedStyleEl) return; // already injected

  const css = `
    @media print {
      /* Hide everything except the map area */
      body > *:not(#${mapContainerId}) {
        display: none !important;
      }

      /* Ensure the map container fills the page */
      #${mapContainerId} {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        z-index: 9999 !important;
      }

      /* Make the map fill the container */
      #${mapContainerId} .ol-viewport {
        width: 100% !important;
        height: 100% !important;
      }

      /* Show sheet layout overlays during print */
      .sheet-layout-overlay {
        display: block !important;
        position: absolute !important;
        inset: 0 !important;
        z-index: 20 !important;
      }

      /* Ensure title block prints properly */
      .sheet-title-block {
        break-inside: avoid;
      }

      /* Ensure certificate prints properly */
      .sheet-certificate {
        break-inside: avoid;
      }

      /* Hide other overlays that might clutter */
      .sheet-layout-overlay ~ * {
        display: none !important;
      }

      /* Page setup */
      @page {
        size: ${paperSize} ${orientation};
        margin: 10mm;
      }
    }
  `;

  injectedStyleEl = document.createElement('style');
  injectedStyleEl.id = 'metardu-print-css';
  injectedStyleEl.textContent = css;
  document.head.appendChild(injectedStyleEl);
}

/**
 * Remove the injected print CSS.
 */
function removePrintCSS(): void {
  if (injectedStyleEl) {
    injectedStyleEl.remove();
    injectedStyleEl = null;
  }
}

/**
 * Export the current map view as a PDF using the browser's print dialog.
 *
 * @param mapContainerId - The `id` attribute of the map container element.
 *   The map and all its sheet layout overlays must be descendants of this element.
 * @param options - Optional settings.
 */
export async function exportMapPDF(
  mapContainerId: string,
  options?: {
    /** Paper size: 'a3' | 'a4' | 'a1'. Default 'a3'. */
    paperSize?: 'a3' | 'a4' | 'a1';
    /** Orientation: 'landscape' | 'portrait'. Default 'landscape'. */
    orientation?: 'landscape' | 'portrait';
  }
): Promise<void> {
  const paperSize = options?.paperSize ?? 'a3';
  const orientation = options?.orientation ?? 'landscape';

  // Inject print CSS
  injectPrintCSS(mapContainerId, paperSize, orientation);

  // Add a short delay to let the browser repaint with the new CSS
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Open the print dialog
  window.print();

  // Listen for afterprint to clean up
  const cleanup = () => {
    removePrintCSS();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  // Also clean up after a timeout in case afterprint doesn't fire
  setTimeout(() => {
    removePrintCSS();
  }, 5000);
}

/**
 * Create a hidden link element that triggers `window.print()`.
 * Returns a callback that can be attached to a button's onClick.
 */
export function createPrintHandler(
  mapContainerId: string,
  options?: {
    paperSize?: 'a3' | 'a4' | 'a1';
    orientation?: 'landscape' | 'portrait';
  }
): () => void {
  return () => {
    exportMapPDF(mapContainerId, options).catch(console.error);
  };
}
