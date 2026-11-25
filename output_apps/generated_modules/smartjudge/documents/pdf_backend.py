"""Shared permissive PDF backend using pypdfium2 (BSD-3 / Apache-2.0)."""

from __future__ import annotations

import io
from contextlib import contextmanager
from typing import Iterator

import pypdfium2 as pdfium


@contextmanager
def open_pdf(data: bytes) -> Iterator[pdfium.PdfDocument]:
    """Open PDF bytes with pypdfium2 and close deterministically."""
    doc = pdfium.PdfDocument(data)
    try:
        yield doc
    finally:
        doc.close()


def page_count(doc: pdfium.PdfDocument) -> int:
    """Return number of pages in an open PdfDocument."""
    return len(doc)


def extract_page_text(doc: pdfium.PdfDocument, page_idx: int) -> str:
    """Extract text from a single 0-based page index, closing both page and textpage handles."""
    page = doc[page_idx]
    textpage = None
    try:
        textpage = page.get_textpage()
        return textpage.get_text_range() or ""
    finally:
        if textpage is not None:
            textpage.close()
        page.close()


def extract_all_pages(data: bytes) -> list[str]:
    """Extract text for every page in PDF bytes."""
    with open_pdf(data) as doc:
        return [extract_page_text(doc, i) for i in range(len(doc))]


def render_page_image(doc: pdfium.PdfDocument, page_idx: int, dpi: int = 150):
    """Render a single 0-based page to a PIL Image at the given DPI."""
    scale = dpi / 72.0
    page = doc[page_idx]
    try:
        bitmap = page.render(scale=scale)
        try:
            return bitmap.to_pil()
        finally:
            bitmap.close()
    finally:
        page.close()


def render_page_png(doc: pdfium.PdfDocument, page_idx: int, dpi: int = 150) -> bytes:
    """Render a single 0-based page to PNG bytes."""
    img = render_page_image(doc, page_idx, dpi=dpi)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def render_pages_png(data: bytes, max_pages: int = 20, dpi: int = 150) -> list[bytes]:
    """Render up to max_pages pages from PDF bytes to PNG bytes."""
    with open_pdf(data) as doc:
        limit = min(len(doc), max_pages)
        return [render_page_png(doc, i, dpi=dpi) for i in range(limit)]
