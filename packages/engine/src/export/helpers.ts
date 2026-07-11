/**
 * METARDU — Shared export utilities for PDF and CSV downloads
 *
 * Provides reusable helpers for generating and triggering downloads
 * of computation results as PDF or CSV files.
 */

import jsPDF from 'jspdf'

// ── CSV helpers ───────────────────────────────────────────────────────────────

/** Join rows (arrays of strings) into a CSV string with proper escaping */
export function toCSV(headers: string[], rows: string[][]): string {
  const escapeCell = (v: string) => {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`
    }
    return v
  }
  const headerLine = headers.map(escapeCell).join(',')
  const dataLines = rows.map(row => row.map(escapeCell).join(','))
  return [headerLine, ...dataLines].join('\n')
}

/** Trigger a CSV file download in the browser */
export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

// ── PDF helpers ───────────────────────────────────────────────────────────────

export interface PdfSection {
  title: string
  rows: Array<{ label: string; value: string }>
}

export interface PdfTableSection {
  title: string
  headers: string[]
  rows: string[][]
}

export interface PdfExportMeta {
  title: string
  projectName?: string
  surveyorName?: string
  date?: string
  reference?: string
}

/**
 * Generate and download a PDF using jsPDF with METARDU branding.
 * Supports sections with key-value rows and tabular data.
 */
export function generatePDF(
  meta: PdfExportMeta,
  sections: PdfSection[],
  tables: PdfTableSection[] = [],
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 15
  const contentWidth = pageWidth - 2 * margin
  let y = margin

  // ── Header ──────────────────────────────────────────────────────────────
  doc.setFillColor(17, 17, 17)
  doc.rect(0, 0, pageWidth, 22, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('METARDU', margin, 10)
  doc.setFontSize(10)
  doc.text(meta.title.toUpperCase(), pageWidth / 2, 10, { align: 'center' })
  doc.setFontSize(8)
  doc.text(`Generated: ${new Date().toLocaleDateString('en-KE')}`, pageWidth - margin, 10, { align: 'right' })

  // Meta line
  doc.setFontSize(7)
  doc.setTextColor(180, 180, 180)
  const metaParts = [
    meta.projectName && `Project: ${meta.projectName}`,
    meta.surveyorName && `Surveyor: ${meta.surveyorName}`,
    meta.date && `Date: ${meta.date}`,
  ].filter(Boolean).join('  |  ')
  if (metaParts) {
    doc.text(metaParts, margin, 17)
  }
  doc.text(meta.reference || 'Survey Regulations 1994 | Survey Act Cap 299', pageWidth - margin, 17, { align: 'right' })

  y = 28

  // ── Sections with key-value rows ────────────────────────────────────────
  for (const section of sections) {
    if (y > 260) { doc.addPage(); y = margin }

    doc.setTextColor(0, 0, 0)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text(section.title, margin, y)
    y += 2
    doc.setDrawColor(0, 0, 0)
    doc.line(margin, y, margin + contentWidth, y)
    y += 4

    for (const row of section.rows) {
      if (y > 275) { doc.addPage(); y = margin }
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(80, 80, 80)
      doc.text(row.label, margin, y)
      doc.setFont('courier', 'bold')
      doc.setTextColor(0, 0, 0)
      doc.text(row.value, margin + 60, y)
      y += 5
    }
    y += 3
  }

  // ── Table sections ──────────────────────────────────────────────────────
  for (const table of tables) {
    if (y > 250) { doc.addPage(); y = margin }

    doc.setTextColor(0, 0, 0)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text(table.title, margin, y)
    y += 2
    doc.line(margin, y, margin + contentWidth, y)
    y += 4

    // Column widths - distribute evenly
    const colCount = table.headers.length
    const colWidth = contentWidth / colCount

    // Header row
    doc.setFillColor(17, 17, 17)
    doc.rect(margin, y - 3, contentWidth, 6, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    table.headers.forEach((h, i) => {
      doc.text(h, margin + i * colWidth + 2, y, { maxWidth: colWidth - 4 })
    })
    y += 5

    // Data rows
    doc.setTextColor(0, 0, 0)
    doc.setFont('courier', 'normal')
    doc.setFontSize(7.5)
    for (let ri = 0; ri < table.rows.length; ri++) {
      if (y > 275) { doc.addPage(); y = margin }

      const row = table.rows[ri]
      // Alternate row background
      if (ri % 2 === 1) {
        doc.setFillColor(245, 245, 245)
        doc.rect(margin, y - 3, contentWidth, 5, 'F')
      }

      row.forEach((cell, ci) => {
        doc.text(cell, margin + ci * colWidth + 2, y, { maxWidth: colWidth - 4 })
      })
      y += 5
    }
    y += 4
  }

  // ── Footer disclaimer ───────────────────────────────────────────────────
  if (y > 260) { doc.addPage(); y = margin }
  y += 4
  doc.setDrawColor(180, 180, 180)
  doc.line(margin, y, margin + contentWidth, y)
  y += 3
  doc.setFontSize(6)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(120, 120, 120)
  doc.text(
    'IMPORTANT: This document was generated by METARDU computation tool. All values must be independently verified',
    margin, y, { maxWidth: contentWidth }
  )
  doc.text(
    'by a licensed surveyor before being relied upon for legal, construction, or registration purposes.',
    margin, y + 3, { maxWidth: contentWidth }
  )

  // ── Save ────────────────────────────────────────────────────────────────
  const filename = `${meta.title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`
  doc.save(filename)
}
