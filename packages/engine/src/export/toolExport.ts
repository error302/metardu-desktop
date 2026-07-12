/**
 * Tool Export Helpers — shared CSV + print functions for simple calculators
 *
 * Usage:
 *   import { downloadResultCSV, printResult } from '@/lib/export/toolExport'
 *   downloadResultCSV('distance-result', [['Point 1', '5000,3000'], ['Point 2', '5234,3156']])
 *   printResult('Distance Calculation', 'Inverse from coordinates', resultRows)
 */

import { buildPrintDocument, openPrint } from '@/lib/print/buildPrintDocument'

/**
 * Download a 2D array as CSV.
 */
export function downloadResultCSV(filename: string, rows: (string | number)[][]): void {
  const csv = rows.map(r => r.map(c => {
    const s = String(c)
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Print a formatted result table.
 */
export function printResult(
  title: string,
  subtitle: string,
  rows: Array<{ label: string; value: string; highlight?: boolean }>,
  reference?: string,
): void {
  const bodyHtml = `
<div class="summary-box">
  <h2 style="border:none;margin:0 0 8px">${title}</h2>
  ${rows.map(r => `
    <div class="summary-row">
      <span class="summary-label">${r.label}</span>
      <span class="summary-value ${r.highlight ? 'pass' : ''}" style="${r.highlight ? 'font-weight:bold;font-size:12pt' : ''}">${r.value}</span>
    </div>
  `).join('')}
</div>`

  const doc = buildPrintDocument(bodyHtml, {
    title,
    reference: reference || subtitle,
  })
  openPrint(doc)
}
