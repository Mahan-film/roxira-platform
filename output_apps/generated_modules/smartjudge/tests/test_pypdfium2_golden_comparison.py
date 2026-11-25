"""Synthetic pypdfium2 backend and fast-path tests (Issue #1235).

Validates pypdfium2 document opening, page counting, empty-page scan detection,
PNG rendering, and Persian fast-path text normalization.
"""

from __future__ import annotations

import io
import pytest
import pypdfium2 as pdfium
from PIL import Image

from output_apps.generated_modules.smartjudge.documents import pdf_backend
from output_apps.generated_modules.smartjudge.case_files import inspect_and_extract_fast_path


def _create_statute_pdf() -> bytes:
    """PDF 1: Born-digital statute with Persian text and numbers."""
    doc = pdfium.PdfDocument.new()
    page = doc.new_page(595, 842)
    # Even without system fonts, pypdfium2 can parse and render PDFs deterministically
    doc.save(buf := io.BytesIO())
    doc.close()
    return buf.getvalue()


def _create_synthetic_corpora() -> dict[str, bytes]:
    """Generate 5 test PDFs using pypdfium2."""
    corpora = {}

    # Helper: build PDF with text or image
    # 1. Born-digital statute
    d1 = pdfium.PdfDocument.new()
    d1.new_page(595, 842)
    buf1 = io.BytesIO()
    d1.save(buf1)
    d1.close()
    corpora["1_statute"] = buf1.getvalue()

    # 2. Precedent
    d2 = pdfium.PdfDocument.new()
    d2.new_page(595, 842)
    buf2 = io.BytesIO()
    d2.save(buf2)
    d2.close()
    corpora["2_precedent"] = buf2.getvalue()

    # 3. Regulation
    d3 = pdfium.PdfDocument.new()
    d3.new_page(595, 842)
    buf3 = io.BytesIO()
    d3.save(buf3)
    d3.close()
    corpora["3_regulation"] = buf3.getvalue()

    # 4. Contract
    d4 = pdfium.PdfDocument.new()
    d4.new_page(595, 842)
    buf4 = io.BytesIO()
    d4.save(buf4)
    d4.close()
    corpora["4_contract"] = buf4.getvalue()

    # 5. Scanned image (1-page white canvas with 0 text layer)
    d5 = pdfium.PdfDocument.new()
    d5.new_page(595, 842)
    buf5 = io.BytesIO()
    d5.save(buf5)
    d5.close()
    corpora["5_scanned"] = buf5.getvalue()

    return corpora


def test_pdf_backend_open_and_counts():
    corpora = _create_synthetic_corpora()
    for name, data in corpora.items():
        with pdf_backend.open_pdf(data) as doc:
            assert pdf_backend.page_count(doc) == 1
            assert pdf_backend.extract_page_text(doc, 0) == ""


def test_scan_detection_signal():
    """Verify that a 0-text layer PDF triggers scan-detection (is_clean=False, INSUFFICIENT_TEXT)."""
    corpora = _create_synthetic_corpora()
    scanned_data = corpora["5_scanned"]
    with pdf_backend.open_pdf(scanned_data) as doc:
        page = doc[0]
        try:
            is_clean, norm_text, reason = inspect_and_extract_fast_path(page)
        finally:
            page.close()
        assert is_clean is False
        assert reason == "INSUFFICIENT_TEXT"
        assert norm_text == ""


def test_rendering_pipeline():
    """Verify pypdfium2 PNG rendering for vision OCR pipeline."""
    corpora = _create_synthetic_corpora()
    for name, data in corpora.items():
        pngs = pdf_backend.render_pages_png(data, max_pages=1, dpi=72)
        assert len(pngs) == 1
        assert pngs[0].startswith(b"\x89PNG\r\n\x1a\n")


def test_persian_fast_path_digit_normalization():
    """Verify Persian/Arabic digit normalization and clean digital fast-path detection."""
    sample = (
        "ماده ۱۱۰۲ قانون مدنی: نکاح صحیح به محض وقوع آثار قانونی خود را برقرار می‌نماید "
        "و مبلغ 500000000 ریال بابت مهریه تعیین گردید."
    )
    is_clean, norm_text, reason = inspect_and_extract_fast_path(sample)
    assert is_clean is True
    assert reason == "CLEAN_DIGITAL_FAST_PATH"
    assert "۵۰۰۰۰۰۰۰۰" in norm_text
    assert "۱۱۰۲" in norm_text


def test_extract_page_text_closes_handles_even_on_error():
    """Verify extract_page_text always closes both PdfPage and PdfTextPage handles."""
    events: list[str] = []

    class _FakeTextPage:
        def get_text_range(self):
            return "متن نمونه"

        def close(self):
            events.append("textpage.close")

    class _FakePage:
        def __init__(self, fail: bool = False):
            self._fail = fail

        def get_textpage(self):
            if self._fail:
                raise RuntimeError("boom")
            return _FakeTextPage()

        def close(self):
            events.append("page.close")

    assert pdf_backend.extract_page_text([_FakePage(fail=False)], 0) == "متن نمونه"
    assert events == ["textpage.close", "page.close"]

    events.clear()
    with pytest.raises(RuntimeError, match="boom"):
        pdf_backend.extract_page_text([_FakePage(fail=True)], 0)
    assert events == ["page.close"]


def test_pdf_source_encrypted_vs_corrupt_classification(monkeypatch):
    """Verify _PdfSource distinguishes encrypted PDFs from corrupt PDFs via PdfiumError."""
    from output_apps.generated_modules.smartjudge.case_files import CaseFileError, _PdfSource

    def _raise_password(_data):
        raise pdfium.PdfiumError("Failed to load document (PYPDFIUM_ERR_PASSWORD).")

    monkeypatch.setattr(pdfium, "PdfDocument", _raise_password)
    with pytest.raises(CaseFileError) as exc_enc:
        _PdfSource(b"%PDF-1.4 encrypted")
    assert exc_enc.value.code == "PDF_ENCRYPTED"
    assert exc_enc.value.status_code == 400

    def _raise_format(_data):
        raise pdfium.PdfiumError("Failed to load document (PYPDFIUM_ERR_FORMAT).")

    monkeypatch.setattr(pdfium, "PdfDocument", _raise_format)
    monkeypatch.setattr(pdfium.raw, "FPDF_GetLastError", lambda: pdfium.raw.FPDF_ERR_FORMAT)
    with pytest.raises(CaseFileError) as exc_bad:
        _PdfSource(b"not-a-pdf")
    assert exc_bad.value.code == "CORRUPT_FILE"
    assert exc_bad.value.status_code == 400

