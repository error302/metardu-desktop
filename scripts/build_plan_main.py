#!/usr/bin/env python3
"""
Main builder for the MetaRDU Desktop v2.0 Upgrade Plan PDF.
Assembles TOC + 12 chapters via ReportLab, then merges with cover via pypdf.
"""

import os
import sys
import subprocess

# Add scripts dir to path
sys.path.insert(0, '/home/z/my-project/scripts')

# Import setup (fonts, palette, styles, TocDocTemplate, helpers)
from build_plan_part1 import (
    TocDocTemplate, add_heading, add_major_section, add_subsection,
    H1, H2, H3, BODY, BODY_NO_INDENT, BULLET, META,
    TOC_LEVEL_0, TOC_LEVEL_1,
    PAGE_W, PAGE_H, LEFT_MARGIN, RIGHT_MARGIN, TOP_MARGIN, BOTTOM_MARGIN,
    ACCENT, HEADER_FILL, TEXT_PRIMARY, TEXT_MUTED, BORDER,
    page_footer, callout,
)

# Import chapter builders
from build_plan_part2 import (
    build_chapter_1, build_chapter_2, build_chapter_3,
    build_chapter_4, build_chapter_5, build_chapter_6,
)
from build_plan_part3 import (
    build_chapter_7, build_chapter_8, build_chapter_9,
    build_chapter_10, build_chapter_11, build_chapter_12,
)

from reportlab.platypus import (
    Paragraph, Spacer, PageBreak, Table, TableStyle, KeepTogether
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER

# ──────────────────────────────────────────────────────────────────────
# Output paths
# ──────────────────────────────────────────────────────────────────────
WORK_DIR = '/home/z/my-project/work'
DOWNLOAD_DIR = '/home/z/my-project/download'
BODY_PDF = os.path.join(WORK_DIR, 'body.pdf')
COVER_PDF = os.path.join(WORK_DIR, 'cover.pdf')
FINAL_PDF = os.path.join(DOWNLOAD_DIR, 'MetaRDU_Desktop_v2_Upgrade_Plan.pdf')

os.makedirs(WORK_DIR, exist_ok=True)
os.makedirs(DOWNLOAD_DIR, exist_ok=True)


# ──────────────────────────────────────────────────────────────────────
# Build the story
# ──────────────────────────────────────────────────────────────────────
print("Building story...")
story = []

# ── Table of Contents ──
toc_title_style = ParagraphStyle(
    name='TOCTitle', fontName='FreeSerif-Bold', fontSize=22, leading=28,
    textColor=HEADER_FILL, alignment=TA_LEFT, spaceAfter=18,
)
story.append(Paragraph('Table of Contents', toc_title_style))
story.append(Spacer(1, 8))

# Thin horizontal rule under TOC title
from reportlab.platypus import HRFlowable
story.append(HRFlowable(width='100%', thickness=1.2, color=ACCENT, spaceBefore=0, spaceAfter=18))

toc = TableOfContents()
toc.levelStyles = [TOC_LEVEL_0, TOC_LEVEL_1]
story.append(toc)
story.append(PageBreak())

# ── Chapters ──
print("  Chapter 1: Executive Summary")
story.extend(build_chapter_1())

print("  Chapter 2: Current State Assessment")
story.extend(build_chapter_2())

print("  Chapter 3: Vision, Goals, and Success Metrics")
story.extend(build_chapter_3())

print("  Chapter 4: Architecture Decisions (ADRs 006-012)")
story.extend(build_chapter_4())

print("  Chapter 5: Phased Roadmap")
story.extend(build_chapter_5())

print("  Chapter 6: Drone Survey Module Deep Dive")
story.extend(build_chapter_6())

print("  Chapter 7: Math Standards & Compliance")
story.extend(build_chapter_7())

print("  Chapter 8: Engineering Practices (Agency-Agents Workflow)")
story.extend(build_chapter_8())

print("  Chapter 9: Production Readiness & Release Plan")
story.extend(build_chapter_9())

print("  Chapter 10: Risk Matrix & Mitigation")
story.extend(build_chapter_10())

print("  Chapter 11: Budget, Timeline & KPIs")
story.extend(build_chapter_11())

print("  Chapter 12: Conclusion & Next Actions")
story.extend(build_chapter_12())


# ──────────────────────────────────────────────────────────────────────
# Build the body PDF
# ──────────────────────────────────────────────────────────────────────
print(f"\nBuilding body PDF: {BODY_PDF}")
doc = TocDocTemplate(
    BODY_PDF,
    pagesize=A4,
    leftMargin=LEFT_MARGIN,
    rightMargin=RIGHT_MARGIN,
    topMargin=TOP_MARGIN,
    bottomMargin=BOTTOM_MARGIN,
    title='MetaRDU Desktop v2.0 Upgrade Plan',
    author='Z.ai',
    creator='Z.ai',
    subject='Comprehensive upgrade plan for MetaRDU Desktop - drone survey production readiness',
)
doc.multiBuild(story, onFirstPage=page_footer, onLaterPages=page_footer)
print(f"  Body PDF size: {os.path.getsize(BODY_PDF):,} bytes")


# ──────────────────────────────────────────────────────────────────────
# Merge cover + body
# ──────────────────────────────────────────────────────────────────────
print(f"\nMerging cover + body into: {FINAL_PDF}")

from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89  # A4 in points

def normalize_page_to_a4(page):
    box = page.mediabox
    w, h = float(box.width), float(box.height)
    if abs(w - A4_W) > 0.5 or abs(h - A4_H) > 0.5:
        page.scale_to(A4_W, A4_H)
    return page

writer = PdfWriter()

# Cover as page 1
cover_reader = PdfReader(COVER_PDF)
cover_page = cover_reader.pages[0]
writer.add_page(normalize_page_to_a4(cover_page))

# Body pages follow
body_reader = PdfReader(BODY_PDF)
for page in body_reader.pages:
    writer.add_page(normalize_page_to_a4(page))

# Add metadata
writer.add_metadata({
    '/Title': 'MetaRDU Desktop v2.0 Upgrade Plan',
    '/Author': 'Z.ai',
    '/Creator': 'Z.ai',
    '/Subject': 'Comprehensive upgrade plan for MetaRDU Desktop - drone survey production readiness',
    '/Keywords': 'MetaRDU, drone survey, Tauri, MAVLink, photogrammetry, ASPRS, Kenya, upgrade plan',
})

with open(FINAL_PDF, 'wb') as f:
    writer.write(f)

final_size = os.path.getsize(FINAL_PDF)
print(f"  Final PDF size: {final_size:,} bytes ({final_size/1024/1024:.2f} MB)")
print(f"  Total pages: {len(writer.pages)}")
print(f"\n✓ Done: {FINAL_PDF}")
