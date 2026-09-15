"""
پکیج پردازشی اسناد حقوقی (Document Processing Package) — هستهٔ پایتون SmartJudge.

هدف: تبدیل هر ورودی کاربر (PDF، Word، تصویر دادنامه/چک، TXT/MD/CSV/JSON) به Markdown
ساختاریافته و قابل استناد، با حفظ جدول‌ها و ترتیب اسباب تحریر.

معماری سه‌لایه (Software Tiering) برای تاب‌آوری حداکثری:
  لایهٔ ۱ — Docling (موتور اصلی): چیدمان، جدول، فرمول و OCR چندزبانه.
            فعال‌سازی:  pip install docling
  لایهٔ ۲ — استخراج سبک بومی: PyMuPDF (PDF متنی) + python-docx (Word) + codec (متنی).
  لایهٔ ۳ — OCR بینایی از راه دور: رندر صفحه با PyMuPDF و ارسال به مدل بینایی OpenRouter.

هیچ لایه‌ای «اجباری» نیست؛ نبودِ Docling باعث خطا نمی‌شود و سند با لایهٔ بعدی پردازش می‌گردد.

خروجی هر سند دقیقاً منطبق بر قرارداد فرانت‌اند (`ParsedDocumentMeta`) است:
  filename, format, method, markdown, char_count, ocr_used, warnings
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import re
import threading
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, List, Optional, Sequence

logger = logging.getLogger("smartjudge.documents")

# ── محدودیت‌ها (محافظت از RAM و زمان پاسخ سرور) ────────────────────────────────
MAX_FILE_BYTES: int = int(os.environ.get("DOC_MAX_FILE_BYTES", str(25 * 1024 * 1024)))
MAX_FILES_PER_REQUEST: int = int(os.environ.get("DOC_MAX_FILES", "10"))
MAX_MARKDOWN_CHARS: int = int(os.environ.get("DOC_MAX_MARKDOWN_CHARS", "120000"))
# آستانهٔ تشخیص «سند اسکن‌شده»: زیر این مقدار نویسه در هر صفحه، سند تصویری تلقی می‌شود
SCANNED_TEXT_THRESHOLD: int = 40
OCR_RENDER_DPI: int = 200

# ── فرمت‌های پشتیبانی‌شده ──────────────────────────────────────────────────────
PDF_EXTS = {".pdf"}
WORD_EXTS = {".docx", ".doc"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp", ".gif"}
TEXT_EXTS = {".txt", ".md", ".markdown", ".csv", ".json", ".rtf", ".xml", ".html", ".htm"}
PPTX_EXTS = {".pptx"}
XLSX_EXTS = {".xlsx", ".xlsm"}
SUPPORTED_EXTENSIONS = PDF_EXTS | WORD_EXTS | IMAGE_EXTS | TEXT_EXTS | PPTX_EXTS | XLSX_EXTS

_FORMAT_LABELS = {
    "PDF": "PDF",
    "DOCX": "Word (DOCX)",
    "DOC": "Word (DOC)",
    "IMAGE": "تصویر اسکن‌شده",
    "TEXT": "متن ساده",
    "MARKDOWN": "Markdown",
    "CSV": "CSV",
    "JSON": "JSON",
    "HTML": "HTML",
    "RTF": "RTF",
    "XML": "XML",
    "PPTX": "PowerPoint",
    "XLSX": "Excel",
}

# ── تشخیص خودکار Docling (اختیاری بودن کامل) ──────────────────────────────────
try:  # pragma: no cover - وابسته به محیط نصب
    from docling.document_converter import DocumentConverter, PdfFormatOption  # type: ignore
    from docling.datamodel.base_models import InputFormat  # type: ignore
    from docling.datamodel.document import DocumentStream  # type: ignore
    from docling.datamodel.pipeline_options import PdfPipelineOptions  # type: ignore

    DOCLING_AVAILABLE = True
    DOCLING_IMPORT_ERROR: Optional[str] = None
except Exception as exc:  # noqa: BLE001 - هر خطای واردکردن باید مدیریت شود
    DOCLING_AVAILABLE = False
    DOCLING_IMPORT_ERROR = f"{type(exc).__name__}: {exc}"
    DocumentConverter = None  # type: ignore
    PdfFormatOption = None  # type: ignore
    InputFormat = None  # type: ignore
    DocumentStream = None  # type: ignore
    PdfPipelineOptions = None  # type: ignore


class DocumentProcessingError(Exception):
    """خطای قابل‌نمایش به کاربر در جریان پردازش سند."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass
class ParsedDocument:
    """یک سند پردازش‌شده به‌همراه فرادادهٔ کامل تبدیل."""

    filename: str
    format: str
    method: str
    markdown: str
    ocr_used: bool = False
    warnings: List[str] = field(default_factory=list)

    @property
    def char_count(self) -> int:
        return len(self.markdown)

    def to_meta(self) -> dict:
        """قرارداد دقیق فرانت‌اند (`ParsedDocumentMeta`)."""
        return {
            "filename": self.filename,
            "format": self.format,
            "method": self.method,
            "markdown": self.markdown,
            "char_count": self.char_count,
            "ocr_used": self.ocr_used,
            "warnings": self.warnings,
        }


# ──────────────────────────────────────────────────────────────────────────────
# نرمال‌سازی متن حقوقی فارسی
# ──────────────────────────────────────────────────────────────────────────────
_ARABIC_TO_PERSIAN = str.maketrans({"ي": "ی", "ك": "ک", "ﻻ": "لا", "ۀ": "هٔ", "ة": "ه"})
_PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
_ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
# نسخهٔ ارقام لاتین برای تطبیق داخلی (نمایش سند از ارقام اصلی خود پیروی می‌کند)
_DIGIT_MAP = str.maketrans(_PERSIAN_DIGITS + _ARABIC_DIGITS, "0123456789" * 2)
_MULTI_BLANK_LINES = re.compile(r"\n{3,}")
_TRAILING_SPACES = re.compile(r"[ \t]+$", re.MULTILINE)
_BROKEN_LIGATURES = re.compile(r"\u0640+")


def normalize_persian_text(text: str) -> str:
    """
    یکسان‌سازی متن استخراج‌شده جهت جست‌وجوی گراف دانش و استناد قانونی:
      • یکسان‌سازی ی/ک عربی، نیم‌فاصله (ZWNJ) و کشیده‌ها
      • حذف نویسه‌های کنترلی و جهت‌نماهای نامرئی
      • حذف فاصله‌های انتهایی و فشرده‌سازی خطوط خالی

    نکته: ارقام فارسی عمداً تغییر نمی‌کنند تا متن نمایش‌داده‌شده به کاربر اصیل بماند؛
    تبدیل ارقام برای تطبیق با مواد قانونی در لایهٔ جست‌وجو (`_enforce_ascii_numbers`) انجام می‌شود.
    """
    if not text:
        return ""

    text = unicodedata.normalize("NFC", text)
    text = text.translate(_ARABIC_TO_PERSIAN)
    text = _BROKEN_LIGATURES.sub("", text)
    # نرمال‌سازی نویسه‌های کنترلی و جایگزینی جداکننده‌های نامرئی با نیم‌فاصله
    text = text.replace("\u200e", "").replace("\u200f", "").replace("\ufeff", "")
    text = text.replace("\u00a0", " ")
    text = _TRAILING_SPACES.sub("", text)
    text = _MULTI_BLANK_LINES.sub("\n\n", text)
    return text.strip()


def _guess_format(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in PDF_EXTS:
        return "PDF"
    if ext == ".docx":
        return "DOCX"
    if ext == ".doc":
        return "DOC"
    if ext in IMAGE_EXTS:
        return "IMAGE"
    if ext in {".md", ".markdown"}:
        return "MARKDOWN"
    if ext == ".csv":
        return "CSV"
    if ext == ".json":
        return "JSON"
    if ext in {".html", ".htm"}:
        return "HTML"
    if ext == ".rtf":
        return "RTF"
    if ext == ".xml":
        return "XML"
    if ext in PPTX_EXTS:
        return "PPTX"
    if ext in XLSX_EXTS:
        return "XLSX"
    if ext in TEXT_EXTS:
        return "TEXT"
    return (ext.lstrip(".") or "UNKNOWN").upper()


# ──────────────────────────────────────────────────────────────────────────────
# لایهٔ ۱ — Docling
# ──────────────────────────────────────────────────────────────────────────────
_converter_lock = threading.Lock()
_converter_instance: Any = None
_converter_init_error: Optional[str] = None


def _get_converter() -> Any:
    """
    ساخت تنبل (lazy) و یک‌بارهٔ DocumentConverter.
    مدل‌های Docling سنگین‌اند؛ یک نمونهٔ Singleton در کل فرایند کافی است.
    """
    global _converter_instance, _converter_init_error
    if not DOCLING_AVAILABLE:
        return None
    if _converter_instance is not None:
        return _converter_instance

    with _converter_lock:
        if _converter_instance is not None:
            return _converter_instance
        try:
            pipeline_options = PdfPipelineOptions()
            pipeline_options.do_ocr = True
            pipeline_options.do_table_structure = True
            # limits برای جلوگیری از انفجار حافظه روی اسناد چندصدصفحه‌ای
            try:
                pipeline_options.images_scale = 1.0
                pipeline_options.generate_page_images = False
                pipeline_options.generate_picture_images = False
                pipeline_options.ocr_options.force_full_page_ocr = False
            except Exception:  # noqa: BLE001 - سازگاری با نسخه‌های مختلف Docling
                pass

            _converter_instance = DocumentConverter(
                format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)}
            )
            logger.info("Docling DocumentConverter initialized successfully.")
        except Exception as exc:  # noqa: BLE001
            _converter_init_error = f"{type(exc).__name__}: {exc}"
            logger.warning("Docling converter init failed: %s", _converter_init_error)
            return None
    return _converter_instance


def _convert_with_docling(
    data: bytes, filename: str
) -> tuple[Optional[str], List[str], bool]:
    """
    تلاش برای تبدیل سند با Docling.
    بازگشت: (markdown یا None، هشدارها، ocr_used)
    """
    converter = _get_converter()
    if converter is None:
        return None, [], False

    warnings: List[str] = []
    try:
        source: Any
        try:
            source = DocumentStream(name=filename, stream=io.BytesIO(data))
        except Exception:  # noqa: BLE001 - نسخه‌های قدیمی‌تر DocumentStream ندارند
            tmp_dir = Path(os.environ.get("DOC_TMP_DIR", "/tmp")) / "smartjudge_docs"
            tmp_dir.mkdir(parents=True, exist_ok=True)
            tmp_path = tmp_dir / f"{abs(hash(filename)):x}_{filename}"
            tmp_path.write_bytes(data)
            source = str(tmp_path)

        result = converter.convert(source)
        document = getattr(result, "document", None)
        if document is None:
            return None, ["Docling هیچ سند خروجی برنگرداند."], False

        markdown = document.export_to_markdown() or ""
        status = str(getattr(result, "status", "")).lower()
        if "failure" in status or "error" in status:
            warnings.append(f"وضعیت تبدیل Docling: {status}")
        if not markdown.strip():
            return None, warnings, False

        # سندهای تصویری و PDFهای اسکن‌شده از مسیر OCR عبور می‌کنند
        ext = Path(filename).suffix.lower()
        ocr_used = ext in IMAGE_EXTS
        if not ocr_used and "pdf" in getattr(result, "input", None).__class__.__name__.lower():
            ocr_used = False
        page_count = len(getattr(result, "pages", {}) or {})
        if page_count and len(markdown) / max(page_count, 1) < SCANNED_TEXT_THRESHOLD:
            ocr_used = True
            warnings.append(
                "متن لایه‌ای سند بسیار کم بود؛ احتمال اسکن‌بودن و اتکای خروجی به OCR وجود دارد."
            )
        return markdown, warnings, ocr_used
    except Exception as exc:  # noqa: BLE001 - باید به لایهٔ بعدی تنزل کند
        logger.warning("Docling conversion failed for %s: %s", filename, exc)
        return None, [f"تبدیل Docling ناموفق بود ({type(exc).__name__})؛ لایهٔ جایگزین اجرا شد."], False


# ──────────────────────────────────────────────────────────────────────────────
# لایهٔ ۲ — استخراج سبک بومی
# ──────────────────────────────────────────────────────────────────────────────
def _extract_pdf_native(data: bytes) -> tuple[str, List[str], bool]:
    """استخراج متن انتخابی PDF با PyMuPDF؛ در صورت نبود لایهٔ متنی، سیگنال اسکن‌بودن."""
    try:
        import fitz  # type: ignore  # PyMuPDF
    except Exception as exc:  # noqa: BLE001
        return "", [f"PyMuPDF در دسترس نیست ({type(exc).__name__})."], False

    warnings: List[str] = []
    parts: List[str] = []
    try:
        with fitz.open(stream=data, filetype="pdf") as doc:
            page_count = doc.page_count
            for index, page in enumerate(doc, start=1):
                try:
                    page_text = page.get_text("text") or ""
                except Exception:  # noqa: BLE001
                    page_text = ""
                if page_text.strip():
                    parts.append(f"## صفحه {index}\n\n{page_text.strip()}")
            joined = "\n\n".join(parts)
            avg = len(joined) / max(page_count, 1)
            if avg < SCANNED_TEXT_THRESHOLD:
                warnings.append(
                    "سند فاقد لایهٔ متنی است (اسکن‌شده)؛ برای استخراج دقیق، نصب Docling توصیه می‌شود."
                )
                return joined, warnings, True
            return joined, warnings, False
    except Exception as exc:  # noqa: BLE001
        return "", [f"خواندن PDF با PyMuPDF ناموفق بود ({type(exc).__name__})."], False


def _extract_docx_native(data: bytes) -> tuple[str, List[str]]:
    """استخراج پاراگراف‌ها و جدول‌ها از Word با python-docx و بازنویسی به Markdown."""
    try:
        import docx  # type: ignore  # python-docx
    except Exception as exc:  # noqa: BLE001
        return "", [f"python-docx در دسترس نیست ({type(exc).__name__})."]

    warnings: List[str] = []
    try:
        document = docx.Document(io.BytesIO(data))
        blocks: List[str] = []
        for paragraph in document.paragraphs:
            text = (paragraph.text or "").strip()
            if not text:
                continue
            style = (getattr(paragraph.style, "name", "") or "").lower()
            if "heading 1" in style:
                blocks.append(f"# {text}")
            elif "heading 2" in style:
                blocks.append(f"## {text}")
            elif "heading" in style:
                blocks.append(f"### {text}")
            else:
                blocks.append(text)

        for table_index, table in enumerate(document.tables, start=1):
            rows: List[List[str]] = []
            for row in table.rows:
                cells = [(cell.text or "").replace("\n", " ").strip() for cell in row.cells]
                rows.append(cells)
            if not rows:
                continue
            header, *body = rows
            width = max(len(r) for r in rows)
            header = header + [""] * (width - len(header))
            lines = [
                f"### جدول {table_index}",
                "| " + " | ".join(header) + " |",
                "| " + " | ".join(["---"] * width) + " |",
            ]
            for row in body:
                cells = row + [""] * (width - len(row))
                lines.append("| " + " | ".join(cells) + " |")
            blocks.append("\n".join(lines))

        return "\n\n".join(blocks), warnings
    except Exception as exc:  # noqa: BLE001
        return "", [f"خواندن DOCX ناموفق بود ({type(exc).__name__})."]


def _extract_text_native(data: bytes) -> tuple[str, List[str]]:
    """استخراج فایل‌های متنی با تشخیص خودکار کدگذاری (UTF-8/UTF-16/Windows-1256)."""
    if not data:
        return "", ["فایل خالی است."]
    for encoding in ("utf-8-sig", "utf-8", "utf-16", "windows-1256", "latin-1"):
        try:
            return data.decode(encoding), []
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode("utf-8", errors="replace"), ["کدگذاری فایل شناسایی نشد؛ با جایگزینی نویسه خوانده شد."]


# ──────────────────────────────────────────────────────────────────────────────
# لایهٔ ۳ — OCR بینایی از راه دور (مدل بینایی OpenRouter)
# ──────────────────────────────────────────────────────────────────────────────
VISION_OCR_MODEL = os.environ.get(
    "VISION_OCR_MODEL", os.environ.get("OPENROUTER_VISION_MODEL", "google/gemini-3.8-flash")
)
VISION_OCR_MAX_PAGES = int(os.environ.get("VISION_OCR_MAX_PAGES", "5"))

_VISION_PROMPT = (
    "این تصویر یک سند حقوقی فارسی (دادنامه، قرارداد، چک یا اظهارنامه) است. "
    "کل متن را عیناً و بدون ترجمه، با حفظ ساختار پاراگراف‌ها، شماره‌ها، تاریخ‌ها، مبالغ و "
    "جدول‌ها به Markdown بازنویسی کن. هیچ توضیح یا مقدمه‌ای اضافه نکن؛ فقط متن سند را بده."
)


async def _vision_ocr_image(image_bytes: bytes, mime: str = "image/png") -> str:
    """OCR تک‌تصویر با مدل بینایی OpenRouter (بدون وابستگی محلی سنگین)."""
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        return ""
    base_url = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    encoded = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "model": VISION_OCR_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _VISION_PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}},
                ],
            }
        ],
        "temperature": 0.0,
    }
    try:
        import httpx  # type: ignore

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            if response.status_code >= 400:
                logger.warning("Vision OCR HTTP %s", response.status_code)
                return ""
            body = response.json()
            choices = body.get("choices") or []
            if not choices:
                return ""
            content = (choices[0].get("message") or {}).get("content", "")
            if isinstance(content, list):
                content = "".join(
                    part.get("text", "") for part in content if isinstance(part, dict)
                )
            return str(content or "").strip()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Vision OCR request failed: %s", exc)
        return ""


def _render_pdf_pages(data: bytes, max_pages: int) -> tuple[List[bytes], List[str]]:
    """رندر صفحات PDF به PNG برای ارسال به OCR بینایی."""
    try:
        import fitz  # type: ignore
    except Exception as exc:  # noqa: BLE001
        return [], [f"رندر صفحات برای OCR ناموفق بود ({type(exc).__name__})."]
    images: List[bytes] = []
    try:
        with fitz.open(stream=data, filetype="pdf") as doc:
            for page in list(doc)[:max_pages]:
                pixmap = page.get_pixmap(dpi=OCR_RENDER_DPI)
                images.append(pixmap.tobytes("png"))
    except Exception as exc:  # noqa: BLE001
        return images, [f"رندر صفحات برای OCR ناموفق بود ({type(exc).__name__})."]
    return images, []


async def _vision_ocr_document(data: bytes, fmt: str) -> tuple[str, List[str]]:
    """OCR کل سند (تصویر تک‌صفحه یا PDF اسکن‌شده) با مدل بینایی."""
    warnings: List[str] = []
    if fmt == "IMAGE":
        text = await _vision_ocr_image(data)
        if not text:
            warnings.append("OCR بینایی پاسخی برنگرداند (کلید OpenRouter یا مدل بینایی را بررسی کنید).")
        return text, warnings

    pages, render_warnings = _render_pdf_pages(data, VISION_OCR_MAX_PAGES)
    warnings.extend(render_warnings)
    if not pages:
        return "", warnings

    parts: List[str] = []
    for index, page_png in enumerate(pages, start=1):
        page_text = await _vision_ocr_image(page_png)
        if page_text:
            parts.append(f"## صفحه {index}\n\n{page_text}")
    if len(pages) < VISION_OCR_MAX_PAGES:
        warnings.append(f"OCR بینایی روی حداکثر {len(pages)} صفحهٔ نخست اجرا شد.")
    else:
        warnings.append(f"OCR بینایی روی {VISION_OCR_MAX_PAGES} صفحهٔ نخست اجرا شد.")
    if not parts:
        warnings.append("OCR بینایی هیچ متنی استخراج نکرد.")
    return "\n\n".join(parts), warnings


# ──────────────────────────────────────────────────────────────────────────────
# هماهنگ‌کنندهٔ اصلی (Orchestrator)
# ──────────────────────────────────────────────────────────────────────────────
def _validate_file(filename: str, data: bytes) -> None:
    if not filename:
        raise DocumentProcessingError("نام فایل نامعتبر است.")
    if not data:
        raise DocumentProcessingError(f"فایل «{filename}» خالی است.")
    if len(data) > MAX_FILE_BYTES:
        raise DocumentProcessingError(
            f"حجم فایل «{filename}» بیش از حد مجاز است "
            f"({len(data) // (1024 * 1024)}MB > {MAX_FILE_BYTES // (1024 * 1024)}MB).",
            status_code=413,
        )
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise DocumentProcessingError(
            f"فرمت «{ext or 'بدون پسوند'}» پشتیبانی نمی‌شود. "
            f"فرمت‌های مجاز: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
            status_code=415,
        )


def _truncate_markdown(markdown: str, filename: str, warnings: List[str]) -> str:
    if len(markdown) > MAX_MARKDOWN_CHARS:
        warnings.append(
            f"متن سند برای کنترل هزینهٔ مدل کوتاه شد "
            f"({len(markdown)} → {MAX_MARKDOWN_CHARS} نویسه)."
        )
        return markdown[:MAX_MARKDOWN_CHARS]
    return markdown


async def process_document(data: bytes, filename: str) -> ParsedDocument:
    """
    پردازش یک سند با تنزل تدریجی لایه‌ها (Docling → بومی → OCR بینایی).

    اجرای مسدودکنندهٔ Docling/PyMuPDF در Thread جداگانه انجام می‌شود تا
    حلقهٔ رویداد FastAPI قفل نشود.
    """
    _validate_file(filename, data)

    ext = Path(filename).suffix.lower()
    fmt = _guess_format(filename)
    warnings: List[str] = []
    markdown = ""
    method = ""
    ocr_used = ext in IMAGE_EXTS

    # ── لایهٔ ۱: Docling ──
    if DOCLING_AVAILABLE:
        docling_md, docling_warnings, docling_ocr = await asyncio.to_thread(
            _convert_with_docling, data, filename
        )
        warnings.extend(docling_warnings)
        if docling_md and docling_md.strip():
            markdown = docling_md
            method = f"docling ({VISION_OCR_MODEL if docling_ocr else 'layout+table'})"
            ocr_used = ocr_used or docling_ocr
    else:
        warnings.append(
            "Docling نصب نشده است؛ پردازش با موتور جایگزین انجام شد. "
            "برای دقت چیدمان/جدول/OCR: pip install docling"
        )

    # ── لایهٔ ۲: استخراج سبک بومی ──
    if not markdown.strip():
        if fmt == "PDF":
            native_md, native_warnings, native_ocr = await asyncio.to_thread(
                _extract_pdf_native, data
            )
            warnings.extend(native_warnings)
            markdown, ocr_used = native_md, native_ocr
            method = "pymupdf (native text layer)" if native_md.strip() else ""
        elif fmt in {"DOCX", "DOC"}:
            native_md, native_warnings = await asyncio.to_thread(_extract_docx_native, data)
            warnings.extend(native_warnings)
            markdown, method = native_md, "python-docx"
        elif ext in TEXT_EXTS:
            native_md, native_warnings = await asyncio.to_thread(_extract_text_native, data)
            warnings.extend(native_warnings)
            markdown = native_md
            method = f"codec ({fmt.lower()})"

    # ── لایهٔ ۳: OCR بینایی از راه دور ──
    if not markdown.strip() and (fmt == "IMAGE" or ext in PDF_EXTS):
        vision_md, vision_warnings = await _vision_ocr_document(data, fmt)
        warnings.extend(vision_warnings)
        if vision_md.strip():
            markdown = vision_md
            ocr_used = True
            method = f"openrouter-vision ({VISION_OCR_MODEL})"

    if not markdown.strip():
        warnings.append("هیچ متنی از این سند استخراج نشد؛ لطفاً کیفیت تصویر یا فرمت فایل را بررسی کنید.")
        method = method or "unprocessed"

    markdown = normalize_persian_text(markdown)
    markdown = _truncate_markdown(markdown, filename, warnings)

    return ParsedDocument(
        filename=filename,
        format=_FORMAT_LABELS.get(fmt, fmt),
        method=method or "unknown",
        markdown=markdown,
        ocr_used=ocr_used,
        warnings=warnings,
    )


async def convert_documents(
    files: Sequence[tuple[str, bytes]],
    *,
    max_files: int = MAX_FILES_PER_REQUEST,
) -> List[ParsedDocument]:
    """
    پردازش دسته‌ایِ پیوست‌های multipart.
    ورودی: دنباله‌ای از (filename, raw_bytes).
    خروجی: فهرست اسناد پردازش‌شده به ترتیب ورودی.

    نکتهٔ عملکردی: پردازش‌ها به‌صورت هم‌روند اجرا می‌شوند، اما Docling درون خود
    تک‌نخی است؛ برای اجتناب از اشباع حافظه، حداکثر دو سند هم‌زمان پردازش می‌شوند.
    """
    payloads = [(name, data) for name, data in files if name]
    if not payloads:
        raise DocumentProcessingError("هیچ فایلی برای پردازش ارسال نشده است.")
    if len(payloads) > max_files:
        raise DocumentProcessingError(
            f"تعداد فایل‌ها بیش از حد مجاز است ({len(payloads)} > {max_files}).", status_code=413
        )

    semaphore = asyncio.Semaphore(2)

    async def _guarded(name: str, data: bytes) -> ParsedDocument:
        async with semaphore:
            return await process_document(data, name)

    results = await asyncio.gather(
        *(_guarded(name, data) for name, data in payloads), return_exceptions=True
    )

    documents: List[ParsedDocument] = []
    for (name, _data), result in zip(payloads, results):
        if isinstance(result, DocumentProcessingError):
            documents.append(
                ParsedDocument(
                    filename=name,
                    format=_guess_format(name),
                    method="rejected",
                    markdown="",
                    warnings=[result.message],
                )
            )
        elif isinstance(result, Exception):
            documents.append(
                ParsedDocument(
                    filename=name,
                    format=_guess_format(name),
                    method="failed",
                    markdown="",
                    warnings=[f"پردازش ناموفق: {type(result).__name__}"],
                )
            )
        else:
            documents.append(result)
    return documents


def combine_markdown(documents: Iterable[ParsedDocument]) -> str:
    """ادغام متن چند سند در یک بدنهٔ Markdown برای ورودی مدل استدلالی."""
    blocks: List[str] = []
    for document in documents:
        if not document.markdown.strip():
            continue
        blocks.append(f"### سند پیوست: {document.filename}\n\n{document.markdown}")
    return "\n\n---\n\n".join(blocks)


def provider_health() -> dict:
    """گزارش وضعیت پکیج پردازشی برای اندپوینت سلامت سرور."""
    return {
        "docling_available": DOCLING_AVAILABLE,
        "docling_import_error": DOCLING_IMPORT_ERROR,
        "docling_init_error": _converter_init_error,
        "vision_ocr_model": VISION_OCR_MODEL,
        "vision_ocr_ready": bool(os.environ.get("OPENROUTER_API_KEY", "").strip()),
        "supported_extensions": sorted(SUPPORTED_EXTENSIONS),
        "limits": {
            "max_file_bytes": MAX_FILE_BYTES,
            "max_files_per_request": MAX_FILES_PER_REQUEST,
            "max_markdown_chars": MAX_MARKDOWN_CHARS,
        },
        "install_hint": "pip install docling",
    }


__all__ = [
    "DOCLING_AVAILABLE",
    "DocumentProcessingError",
    "ParsedDocument",
    "SUPPORTED_EXTENSIONS",
    "combine_markdown",
    "convert_documents",
    "normalize_persian_text",
    "process_document",
    "provider_health",
]
