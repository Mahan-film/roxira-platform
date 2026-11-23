"""Unit tests for the shared pypdfium2 PDF backend."""

from __future__ import annotations

import io

import pytest
import pypdfium2 as pdfium

from output_apps.generated_modules.smartjudge.documents.pdf_backend import (
    extract_all_pages,
    extract_page_text,
    open_pdf,
    page_count,
    render_page_image,
    render_page_png,
    render_pages_png,
)


def _make_blank_pdf_bytes(num_pages: int = 2) -> bytes:
    doc = pdfium.PdfDocument.new()
    try:
        for _ in range(num_pages):
            doc.new_page(200, 300)
        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()
    finally:
        doc.close()


def test_open_pdf_and_page_count():
    data = _make_blank_pdf_bytes(3)
    with open_pdf(data) as doc:
        assert page_count(doc) == 3
        assert extract_page_text(doc, 0) == ""


def test_extract_all_pages():
    data = _make_blank_pdf_bytes(2)
    pages = extract_all_pages(data)
    assert len(pages) == 2
    assert pages == ["", ""]


def test_render_page_image_and_png():
    PIL = pytest.importorskip("PIL.Image")
    data = _make_blank_pdf_bytes(2)
    with open_pdf(data) as doc:
        img = render_page_image(doc, 0, dpi=72)
        assert isinstance(img, PIL.Image)
        assert img.size == (200, 300)

        png_bytes = render_page_png(doc, 0, dpi=72)
        assert png_bytes.startswith(b"\x89PNG\r\n\x1a\n")

    rendered = render_pages_png(data, max_pages=1, dpi=72)
    assert len(rendered) == 1
    assert rendered[0].startswith(b"\x89PNG\r\n\x1a\n")
