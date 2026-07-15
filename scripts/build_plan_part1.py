#!/usr/bin/env python3
"""
MetaRDU Desktop v2.0 Upgrade Plan - Body PDF Generator
Generates the body (TOC + 12 chapters) via ReportLab.
Cover is generated separately via html2poster.js and merged via pypdf.
"""

import os
import sys
import hashlib
import subprocess
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, CondPageBreak, Image, Flowable, HRFlowable, ListFlowable, ListItem
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# ──────────────────────────────────────────────────────────────────────
# Font registration
# ──────────────────────────────────────────────────────────────────────
FONT_DIR = '/usr/share/fonts'

pdfmetrics.registerFont(TTFont('NotoSerifSC', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif', f'{FONT_DIR}/truetype/freefont/FreeSerif.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-Bold', f'{FONT_DIR}/truetype/freefont/FreeSerifBold.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-Italic', f'{FONT_DIR}/truetype/freefont/FreeSerifItalic.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-BoldItalic', f'{FONT_DIR}/truetype/freefont/FreeSerifBoldItalic.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSans', f'{FONT_DIR}/truetype/dejavu/DejaVuSansMono.ttf'))

registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSC-Bold')
registerFontFamily('FreeSerif', normal='FreeSerif', bold='FreeSerif-Bold',
                   italic='FreeSerif-Italic', boldItalic='FreeSerif-BoldItalic')

# Install font fallback for mixed CJK/Latin
sys.path.insert(0, '/home/z/my-project/skills/pdf/scripts')
try:
    from pdf import install_font_fallback
    install_font_fallback()
except Exception as e:
    print(f"Warning: install_font_fallback failed: {e}", file=sys.stderr)

# ──────────────────────────────────────────────────────────────────────
# Cascade Palette (auto-generated)
# ──────────────────────────────────────────────────────────────────────
PAGE_BG       = colors.HexColor('#f5f5f3')
SECTION_BG    = colors.HexColor('#eeedeb')
CARD_BG       = colors.HexColor('#edebe8')
TABLE_STRIPE  = colors.HexColor('#eeedec')
HEADER_FILL   = colors.HexColor('#5c5235')
COVER_BLOCK   = colors.HexColor('#605b4b')
BORDER        = colors.HexColor('#d2ccba')
ICON          = colors.HexColor('#a6904d')
ACCENT        = colors.HexColor('#8c7226')
ACCENT_2      = colors.HexColor('#4f759b')
TEXT_PRIMARY  = colors.HexColor('#1f1e1c')
TEXT_MUTED    = colors.HexColor('#807d76')
SEM_SUCCESS   = colors.HexColor('#4d9464')
SEM_WARNING   = colors.HexColor('#8d7546')
SEM_ERROR     = colors.HexColor('#904740')
SEM_INFO      = colors.HexColor('#4f7296')

TABLE_HEADER_COLOR = HEADER_FILL
TABLE_HEADER_TEXT  = colors.white
TABLE_ROW_EVEN     = colors.white
TABLE_ROW_ODD      = TABLE_STRIPE

# ──────────────────────────────────────────────────────────────────────
# Page setup
# ──────────────────────────────────────────────────────────────────────
PAGE_W, PAGE_H = A4
LEFT_MARGIN   = 0.85 * inch
RIGHT_MARGIN  = 0.85 * inch
TOP_MARGIN    = 0.85 * inch
BOTTOM_MARGIN = 0.85 * inch
AVAILABLE_W   = PAGE_W - LEFT_MARGIN - RIGHT_MARGIN
AVAILABLE_H   = PAGE_H - TOP_MARGIN - BOTTOM_MARGIN

# ──────────────────────────────────────────────────────────────────────
# Styles
# ──────────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

H1 = ParagraphStyle(
    name='H1', fontName='FreeSerif-Bold', fontSize=22, leading=28,
    textColor=HEADER_FILL, spaceBefore=18, spaceAfter=14, alignment=TA_LEFT,
)
H2 = ParagraphStyle(
    name='H2', fontName='FreeSerif-Bold', fontSize=14.5, leading=20,
    textColor=TEXT_PRIMARY, spaceBefore=14, spaceAfter=8, alignment=TA_LEFT,
)
H3 = ParagraphStyle(
    name='H3', fontName='FreeSerif-Bold', fontSize=11.5, leading=16,
    textColor=ACCENT, spaceBefore=10, spaceAfter=4, alignment=TA_LEFT,
)
BODY = ParagraphStyle(
    name='Body', fontName='FreeSerif', fontSize=10.5, leading=16.5,
    textColor=TEXT_PRIMARY, spaceBefore=0, spaceAfter=8, alignment=TA_JUSTIFY,
    firstLineIndent=0,
)
BODY_NO_INDENT = ParagraphStyle(
    name='BodyNoIndent', parent=BODY, firstLineIndent=0,
)
BULLET = ParagraphStyle(
    name='Bullet', fontName='FreeSerif', fontSize=10.5, leading=15,
    textColor=TEXT_PRIMARY, leftIndent=18, bulletIndent=6,
    spaceBefore=2, spaceAfter=2, alignment=TA_LEFT,
)
META = ParagraphStyle(
    name='Meta', fontName='FreeSerif-Italic', fontSize=9, leading=12,
    textColor=TEXT_MUTED, alignment=TA_LEFT,
)
TABLE_HEADER_STYLE = ParagraphStyle(
    name='TableHeader', fontName='FreeSerif-Bold', fontSize=9.5, leading=12,
    textColor=colors.white, alignment=TA_CENTER,
)
TABLE_CELL_STYLE = ParagraphStyle(
    name='TableCell', fontName='FreeSerif', fontSize=9, leading=12,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT,
)
TABLE_CELL_CENTER = ParagraphStyle(
    name='TableCellCenter', parent=TABLE_CELL_STYLE, alignment=TA_CENTER,
)
CALLOUT_TITLE = ParagraphStyle(
    name='CalloutTitle', fontName='FreeSerif-Bold', fontSize=11, leading=14,
    textColor=ACCENT, alignment=TA_LEFT, spaceAfter=4,
)
CALLOUT_BODY = ParagraphStyle(
    name='CalloutBody', fontName='FreeSerif', fontSize=10, leading=14,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT,
)
TOC_LEVEL_0 = ParagraphStyle(
    name='TOCLevel0', fontName='FreeSerif-Bold', fontSize=11.5, leading=20,
    textColor=TEXT_PRIMARY, leftIndent=0, spaceBefore=4,
)
TOC_LEVEL_1 = ParagraphStyle(
    name='TOCLevel1', fontName='FreeSerif', fontSize=10, leading=15,
    textColor=TEXT_MUTED, leftIndent=18, spaceBefore=2,
)


# ──────────────────────────────────────────────────────────────────────
# TocDocTemplate (MANDATORY for TOC)
# ──────────────────────────────────────────────────────────────────────
class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, 'bookmark_name'):
            level = getattr(flowable, 'bookmark_level', 0)
            text = getattr(flowable, 'bookmark_text', '')
            key = getattr(flowable, 'bookmark_key', '')
            self.notify('TOCEntry', (level, text, self.page, key))


def add_heading(text, style, level=0):
    """Create a heading with bookmark for TOC."""
    key = 'h_' + hashlib.md5(text.encode()).hexdigest()[:8]
    p = Paragraph(f'<a name="{key}"/>{text}', style)
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p


def add_major_section(text):
    """Add H1 with orphan prevention (no forced page break)."""
    return [
        CondPageBreak(AVAILABLE_H * 0.15),
        add_heading(text, H1, level=0),
    ]


def add_subsection(text):
    return add_heading(text, H2, level=1)


def add_subsubsection(text):
    return Paragraph(f'<b>{text}</b>', H3)


# ──────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────
MAX_KEEP_HEIGHT = A4[1] * 0.4

def safe_keep_together(elements):
    total_h = 0
    for el in elements:
        try:
            w, h = el.wrap(AVAILABLE_W, A4[1])
            total_h += h
        except Exception:
            pass
    if total_h <= MAX_KEEP_HEIGHT:
        return [KeepTogether(elements)]
    elif len(elements) >= 2:
        return [KeepTogether(elements[:2])] + list(elements[2:])
    else:
        return list(elements)


def make_table(data, col_ratios, header_rows=1):
    """Build a styled table with proportional column widths."""
    col_widths = [r * AVAILABLE_W for r in col_ratios]
    # Wrap all cells in Paragraph if they are strings
    wrapped = []
    for r_idx, row in enumerate(data):
        wrapped_row = []
        for cell in row:
            if isinstance(cell, str):
                if r_idx < header_rows:
                    wrapped_row.append(Paragraph(f'<b>{cell}</b>', TABLE_HEADER_STYLE))
                else:
                    wrapped_row.append(Paragraph(cell, TABLE_CELL_STYLE))
            else:
                wrapped_row.append(cell)
        wrapped.append(wrapped_row)

    tbl = Table(wrapped, colWidths=col_widths, hAlign='CENTER', repeatRows=header_rows)
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, header_rows - 1), TABLE_HEADER_COLOR),
        ('TEXTCOLOR', (0, 0), (-1, header_rows - 1), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.4, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]
    # Alternating row colors
    for i in range(header_rows, len(data)):
        if (i - header_rows) % 2 == 1:
            style_cmds.append(('BACKGROUND', (0, i), (-1, i), TABLE_ROW_ODD))
    tbl.setStyle(TableStyle(style_cmds))
    return tbl


def callout(title, body_text):
    """Build a callout box with accent left border."""
    inner = [
        Paragraph(title, CALLOUT_TITLE),
        Paragraph(body_text, CALLOUT_BODY),
    ]
    inner_tbl = Table([[c] for c in inner], colWidths=[AVAILABLE_W - 24])
    inner_tbl.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    outer = Table([[inner_tbl]], colWidths=[AVAILABLE_W])
    outer.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), CARD_BG),
        ('LINEBEFORE', (0, 0), (0, -1), 3, ACCENT),
        ('LEFTPADDING', (0, 0), (-1, -1), 14),
        ('RIGHTPADDING', (0, 0), (-1, -1), 14),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    return outer


def page_footer(canvas, doc):
    """Footer with page number and document title."""
    canvas.saveState()
    canvas.setFont('FreeSerif-Italic', 8.5)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(LEFT_MARGIN, 0.5 * inch,
                      'MetaRDU Desktop v2.0 Upgrade Plan')
    canvas.drawRightString(PAGE_W - RIGHT_MARGIN, 0.5 * inch,
                           f'Page {doc.page}')
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.4)
    canvas.line(LEFT_MARGIN, 0.65 * inch, PAGE_W - RIGHT_MARGIN, 0.65 * inch)
    canvas.restoreState()


print("Setup complete. Building story...")
