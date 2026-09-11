"""
ROXIRA LEGAL DOCUMENT PARSER — موتور جامع تبدیل اسناد حقوقی به Markdown

پشتیبانی از تمام فرمت‌های پرونده:
  • .docx  → python-docx (پاراگراف‌ها، سرتیترها، فهرست‌ها و جداول استاندارد)
  • .pdf   → pymupdf/pdf-inspector برای PDFهای متنی و OCR ابری برای اسناد اسکن‌شده
  • .txt/.md → خواندن مستقیم متن
  • .png/.jpg/.jpeg/.webp → OCR ابری (Mistral OCR / LlamaParse / Vision LLM)

لایه OCR ابری به‌صورت زنجیره‌ای و مقاوم اجرا می‌شود:
  ۱) Mistral OCR   (MISTRAL_API_KEY)
  ۲) LlamaParse    (LLAMA_CLOUD_API_KEY)
  ۳) Vision LLM    (OPENROUTER_API_KEY + VISION_LLM_MODEL)
در نبود کلید/خطای سرویس، به لایه بعدی عقب‌نشینی می‌کند و هرگز سند ساختگی تولید نمی‌کند.

پاک‌سازی و استانداردسازی فارسی: ی/ک عربی، نیم‌فاصله (ZWNJ)، ارقام عربی،
فاصله‌گذاری علائم و مرتب‌سازی استاندارد جداول Markdown.
"""
from __future__ import annotations

import base64
import dataclasses
import io
import logging
import os
import pathlib
import re
import time
from typing import Any, Dict, List, Optional, Tuple, Union

logger = logging.getLogger("roxira.legal.document_parser")

# ─────────────────────────────────────────────────────────────────────────────
# خواندن کلیدهای محیطی (سازگار با کانتینر و میزبان)
# ─────────────────────────────────────────────────────────────────────────────
_ENV_PATHS = (
    pathlib.Path("/opt/roxira_platform/.env"),
    pathlib.Path("/app/.env"),
)


def _read_env_key(name: str) -> str:
    val = os.getenv(name, "").strip()
    if val:
        return val
    for env_p in _ENV_PATHS:
        if not env_p.exists():
            continue
        try:
            for line in env_p.read_text(encoding="utf-8", errors="ignore").splitlines():
                if line.startswith(f"{name}="):
                    return line.split("=", 1)[1].strip().strip("'\"")
        except Exception:
            continue
    return ""


MISTRAL_API_KEY = _read_env_key("MISTRAL_API_KEY")
MISTRAL_OCR_MODEL = _read_env_key("MISTRAL_OCR_MODEL") or "mistral-ocr-latest"
MISTRAL_BASE = (_read_env_key("MISTRAL_BASE_URL") or "https://api.mistral.ai").rstrip("/")

LLAMA_CLOUD_API_KEY = _read_env_key("LLAMA_CLOUD_API_KEY") or _read_env_key("LLAMAPARSE_API_KEY")
LLAMA_PARSE_BASE = (
    _read_env_key("LLAMA_PARSE_BASE_URL") or "https://api.cloud.llamaindex.ai"
).rstrip("/")

OPENROUTER_KEY = _read_env_key("OPENROUTER_API_KEY") or _read_env_key("LLM_API_KEY")
OPENROUTER_BASE = (_read_env_key("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1").rstrip("/")
VISION_LLM_MODEL = _read_env_key("VISION_LLM_MODEL") or "google/gemini-3.8-flash"

# ─────────────────────────────────────────────────────────────────────────────
# ثابت‌ها
# ─────────────────────────────────────────────────────────────────────────────
SUPPORTED_FORMATS = {
    "docx", "doc", "pdf", "txt", "md", "markdown",
    "png", "jpg", "jpeg", "webp", "bmp", "tiff", "tif",
}
IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "bmp", "tiff", "tif"}
TEXT_EXTENSIONS = {"txt", "md", "markdown"}

MIME_BY_EXT = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "doc": "application/msword",
    "pdf": "application/pdf",
    "txt": "text/plain",
    "md": "text/markdown",
    "markdown": "text/markdown",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "bmp": "image/bmp",
    "tiff": "image/tiff",
    "tif": "image/tiff",
}

# حداقل کاراکتر متن استخراج‌شده از PDF برای اینکه «متنی» تلقی شود (نه اسکن‌شده)
_MIN_TEXT_PDF_CHARS = 40
_MAX_VISION_PAGES = 5

# ─────────────────────────────────────────────────────────────────────────────
# نرمال‌سازی و استانداردسازی متن فارسی
# ─────────────────────────────────────────────────────────────────────────────
_PERSIAN_CHAR_MAP = str.maketrans(
    {
        "ي": "ی",
        "ك": "ک",
        "ﻰ": "ی",
        "ﻲ": "ی",
        "ﻚ": "ک",
        "ة": "ه",
        "ۀ": "ه",
        "أ": "ا",
        "إ": "ا",
        "آ": "آ",
        "ٱ": "ا",
        "ؤ": "و",
        "ئ": "ی",
        "٠": "۰",
        "١": "۱",
        "٢": "۲",
        "٣": "۳",
        "٤": "۴",
        "٥": "۵",
        "٦": "۶",
        "٧": "۷",
        "٨": "۸",
        "٩": "۹",
        "،": "،",
        "؛": "؛",
        "\u200f": "",
        "\u200e": "",
        "\ufeff": "",
    }
)

_ZWNJ_VARIANTS = ("\u200c", "\u200d", "\u200b", "\u2060")


def normalize_persian_text(text: str) -> str:
    """استانداردسازی کامل متن فارسی برای موتور حقوقی.

    • یکسان‌سازی ی/ک/ه عربی و ارقام عربی به فارسی
    • نرمال‌سازی نیم‌فاصله (ZWNJ) و حذف فاصله‌های اضافی
    • اصلاح فاصله‌گذاری علائم و حذف نویزهای کنترلی
    """
    if not text:
        return ""
    out = str(text).translate(_PERSIAN_CHAR_MAP)

    # نرمال‌سازی نیم‌فاصله: حذف فاصله اطراف ZWNJ و ادغام نمونه‌های تکراری
    for variant in _ZWNJ_VARIANTS:
        if variant != "\u200c":
            out = out.replace(variant, "\u200c")
    out = re.sub(r"[ \t]*\u200c[ \t]*", "\u200c", out)
    out = re.sub(r"\u200c{2,}", "\u200c", out)

    # حذف فاصله پیش از علائم نگارشی و یکسان‌سازی ویرگول/نقطه‌ویرگول فارسی
    out = re.sub(r"\s+([،؛:.!؟)\]»])", r"\1", out)
    out = re.sub(r"([({\[«])\s+", r"\1", out)

    # یکسان‌سازی فاصله‌های سفید افقی و خطوط
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r" *\n *", "\n", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


# ─────────────────────────────────────────────────────────────────────────────
# نتیجه تحلیل سند
# ─────────────────────────────────────────────────────────────────────────────
@dataclasses.dataclass
class ParsedDocument:
    filename: str
    format: str
    method: str
    markdown: str
    char_count: int = 0
    ocr_used: bool = False
    warnings: List[str] = dataclasses.field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.char_count:
            self.char_count = len(self.markdown or "")

    def as_dict(self) -> Dict[str, Any]:
        return {
            "filename": self.filename,
            "format": self.format,
            "method": self.method,
            "markdown": self.markdown,
            "char_count": self.char_count,
            "ocr_used": self.ocr_used,
            "warnings": list(self.warnings),
        }


# ─────────────────────────────────────────────────────────────────────────────
# استخراج Word (.docx) با python-docx
# ─────────────────────────────────────────────────────────────────────────────
_HEADING_STYLE_RE = re.compile(r"heading\s*(\d+)", re.IGNORECASE)


def _docx_to_markdown(data: bytes, filename: str) -> ParsedDocument:
    from docx import Document  # python-docx

    document = Document(io.BytesIO(data))
    lines: List[str] = []

    for block in _iter_docx_blocks(document):
        kind, payload = block
        if kind == "paragraph":
            text = normalize_persian_text(payload.text)
            if not text:
                continue
            prefix = _style_to_markdown_prefix(payload)
            lines.append(prefix + text)
        elif kind == "table":
            table_md = _docx_table_to_markdown(payload)
            if table_md:
                lines.append("")
                lines.append(table_md)
                lines.append("")

    markdown = normalize_persian_text("\n".join(lines))
    markdown = _normalize_markdown_tables(markdown)
    return ParsedDocument(
        filename=filename,
        format="docx",
        method="python-docx",
        markdown=markdown,
    )


def _iter_docx_blocks(document: Any) -> List[Tuple[str, Any]]:
    """پیمایش بدنه سند Word با حفظ ترتیب پاراگراف‌ها و جداول."""
    from docx.document import Document as _Document
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    body = document.element.body
    blocks: List[Tuple[str, Any]] = []
    for child in body.iterchildren():
        if child.tag == qn("w:p"):
            blocks.append(("paragraph", Paragraph(child, document)))
        elif child.tag == qn("w:tbl"):
            blocks.append(("table", Table(child, document)))
    return blocks


def _style_to_markdown_prefix(paragraph: Any) -> str:
    style_name = ""
    try:
        style_name = (paragraph.style.name or "") if paragraph.style else ""
    except Exception:
        style_name = ""
    heading = _HEADING_STYLE_RE.search(style_name)
    if heading:
        level = min(max(int(heading.group(1)), 1), 6)
        return "#" * level + " "
    lower = style_name.lower()
    if "list bullet" in lower:
        return "- "
    if "list number" in lower:
        return "1. "
    if "quote" in lower:
        return "> "
    if "title" in lower:
        return "# "
    return ""


def _docx_table_to_markdown(table: Any) -> str:
    rows: List[List[str]] = []
    for row in table.rows:
        cells: List[str] = []
        seen: set = set()
        for cell in row.cells:
            key = id(cell._tc)
            if key in seen:
                continue
            seen.add(key)
            cells.append(_md_cell(_cell_text(cell)))
        rows.append(cells)
    rows = [r for r in rows if any(c for c in r)]
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    header = rows[0]
    body = _sort_table_rows(rows[1:])
    header_line = "| " + " | ".join(header) + " |"
    separator = "| " + " | ".join(["---"] * width) + " |"
    body_lines = ["| " + " | ".join(r) + " |" for r in body]
    return "\n".join([header_line, separator, *body_lines])


def _cell_text(cell: Any) -> str:
    return "\n".join(p.text for p in cell.paragraphs if p.text and p.text.strip())


def _md_cell(value: str) -> str:
    return normalize_persian_text(value).replace("|", "\\|").replace("\n", "<br>").strip()


def _sort_table_rows(rows: List[List[str]]) -> List[List[str]]:
    """مرتب‌سازی استاندارد سطرهای جدول بر پایه ستون اول (عددی سپس واژگانی)."""

    def key(row: List[str]) -> Tuple[int, float, str]:
        first = (row[0] if row else "").strip()
        digits = _persian_digits_to_ascii(first)
        numeric = float(digits.replace(",", "")) if re.fullmatch(r"-?\d+(?:\.\d+)?", digits.replace(",", "")) else None
        if numeric is not None:
            return (0, numeric, "")
        return (1, 0.0, first)

    return sorted(rows, key=key)


def _persian_digits_to_ascii(text: str) -> str:
    return (text or "").translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))


# ─────────────────────────────────────────────────────────────────────────────
# استخراج PDF متنی با pymupdf
# ─────────────────────────────────────────────────────────────────────────────
def _import_fitz() -> Any:
    try:
        import pymupdf as fitz  # pymupdf ≥ 1.24
        return fitz
    except Exception:
        try:
            import fitz  # نوع قدیمی‌تر
            return fitz
        except Exception:
            return None


def _pdf_text_to_markdown(data: bytes, filename: str) -> Tuple[Optional[ParsedDocument], List[str]]:
    """استخراج متن PDF با pymupdf. خروجی: (سند یا None, هشدارها)."""
    fitz = _import_fitz()
    if fitz is None:
        return None, ["کتابخانه pymupdf نصب نیست؛ استخراج متن PDF ممکن نشد."]
    warnings: List[str] = []
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        return None, [f"بازکردن PDF ناموفق بود: {str(exc)[:160]}"]
    try:
        pages_md: List[str] = []
        for page in doc:
            text = page.get_text("text") or ""
            text = normalize_persian_text(text)
            if text:
                pages_md.append(f"## صفحه {page.number + 1}\n\n{text}")
        full = normalize_persian_text("\n\n".join(pages_md))
        if len(full) < _MIN_TEXT_PDF_CHARS:
            return None, warnings
        return (
            ParsedDocument(
                filename=filename,
                format="pdf",
                method="pymupdf",
                markdown=full,
            ),
            warnings,
        )
    finally:
        try:
            doc.close()
        except Exception:
            pass


def _pdf_render_pages_png(data: bytes, max_pages: int = _MAX_VISION_PAGES) -> List[bytes]:
    """رندر هر صفحه PDF اسکن‌شده به PNG برای ارسال به Vision LLM."""
    fitz = _import_fitz()
    if fitz is None:
        return []
    images: List[bytes] = []
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        return []
    try:
        for page in doc:
            if len(images) >= max_pages:
                break
            try:
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                images.append(pix.tobytes("png"))
            except Exception:
                continue
    finally:
        try:
            doc.close()
        except Exception:
            pass
    return images


# ─────────────────────────────────────────────────────────────────────────────
# لایه OCR ابری — زنجیره‌ای و مقاوم
# ─────────────────────────────────────────────────────────────────────────────
def _data_uri(data: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def _mistral_ocr(data: bytes, filename: str, mime: str, is_pdf: bool) -> Optional[str]:
    if not MISTRAL_API_KEY:
        return None
    import httpx

    doc_obj = (
        {"type": "document_url", "document_url": _data_uri(data, mime)}
        if is_pdf
        else {"type": "image_url", "image_url": _data_uri(data, mime)}
    )
    try:
        with httpx.Client(timeout=90.0) as client:
            r = client.post(
                f"{MISTRAL_BASE}/v1/ocr",
                headers={
                    "Authorization": f"Bearer {MISTRAL_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={"model": MISTRAL_OCR_MODEL, "document": doc_obj},
            )
        if r.status_code != 200:
            logger.warning("[DOCPARSER] Mistral OCR HTTP %s: %s", r.status_code, r.text[:180])
            return None
        pages = (r.json() or {}).get("pages") or []
        chunks = [str(p.get("markdown") or "").strip() for p in pages]
        merged = "\n\n".join(c for c in chunks if c)
        return merged or None
    except Exception as exc:
        logger.warning("[DOCPARSER] Mistral OCR failed: %s", exc)
        return None


def _llamaparse_ocr(data: bytes, filename: str, mime: str) -> Optional[str]:
    if not LLAMA_CLOUD_API_KEY:
        return None
    import httpx

    try:
        with httpx.Client(timeout=120.0) as client:
            upload = client.post(
                f"{LLAMA_PARSE_BASE}/api/parsing/upload",
                headers={"Authorization": f"Bearer {LLAMA_CLOUD_API_KEY}", "Accept": "application/json"},
                files={"file": (filename, data, mime)},
            )
            if upload.status_code not in (200, 201):
                logger.warning("[DOCPARSER] LlamaParse upload HTTP %s", upload.status_code)
                return None
            job_id = str((upload.json() or {}).get("id") or "")
            if not job_id:
                return None
            status = "PENDING"
            deadline = time.time() + 90
            while time.time() < deadline:
                poll = client.get(
                    f"{LLAMA_PARSE_BASE}/api/parsing/job/{job_id}",
                    headers={"Authorization": f"Bearer {LLAMA_CLOUD_API_KEY}"},
                )
                status = str((poll.json() or {}).get("status") or "").upper()
                if status in ("SUCCESS", "COMPLETED"):
                    break
                if status in ("ERROR", "FAILED"):
                    logger.warning("[DOCPARSER] LlamaParse job failed: %s", status)
                    return None
                time.sleep(2.0)
            if status not in ("SUCCESS", "COMPLETED"):
                logger.warning("[DOCPARSER] LlamaParse polling timeout")
                return None
            result = client.get(
                f"{LLAMA_PARSE_BASE}/api/parsing/job/{job_id}/result/markdown",
                headers={"Authorization": f"Bearer {LLAMA_CLOUD_API_KEY}"},
            )
        if result.status_code != 200:
            return None
        md = (result.json() or {}).get("markdown") or ""
        return str(md).strip() or None
    except Exception as exc:
        logger.warning("[DOCPARSER] LlamaParse failed: %s", exc)
        return None


_VISION_PROMPT = (
    "این تصویر یک سند حقوقی/قضایی فارسی است. تمام متن را با دقت و بدون حذف، "
    "به‌صورت Markdown ساختاریافته (سرتیترها، پاراگراف‌ها و جداول) بازنویسی کن. "
    "شماره مواد، آرای وحدت رویه، تاریخ‌ها و مبالغ را عیناً حفظ کن. "
    "هیچ توضیح اضافه یا جمله‌ای از خودت اضافه نکن؛ فقط متن سند را برگردان."
)


def _vision_llm_ocr_image(data: bytes, mime: str) -> Optional[str]:
    if not OPENROUTER_KEY:
        return None
    import httpx

    try:
        with httpx.Client(timeout=120.0) as client:
            r = client.post(
                f"{OPENROUTER_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_KEY}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://ghazihoushmand.ir",
                    "X-Title": "Roxira SmartJudge OCR",
                },
                json={
                    "model": VISION_LLM_MODEL,
                    "temperature": 0.0,
                    "max_tokens": 4000,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": _VISION_PROMPT},
                                {"type": "image_url", "image_url": {"url": _data_uri(data, mime)}},
                            ],
                        }
                    ],
                },
            )
        if r.status_code != 200:
            logger.warning("[DOCPARSER] Vision LLM HTTP %s: %s", r.status_code, r.text[:180])
            return None
        msg = ((r.json().get("choices") or [{}])[0].get("message") or {})
        content = str(msg.get("content") or "").strip()
        return content or None
    except Exception as exc:
        logger.warning("[DOCPARSER] Vision LLM failed: %s", exc)
        return None


def _ocr_image(data: bytes, filename: str, mime: str) -> Tuple[Optional[str], str, List[str]]:
    """OCR تصویر با زنجیره Mistral → LlamaParse → Vision LLM."""
    warnings: List[str] = []
    text = _mistral_ocr(data, filename, mime, is_pdf=False)
    if text:
        return text, "mistral-ocr", warnings
    text = _llamaparse_ocr(data, filename, mime)
    if text:
        return text, "llamaparse", warnings
    text = _vision_llm_ocr_image(data, mime)
    if text:
        return text, "vision-llm", warnings
    warnings.append(
        "هیچ سرویس OCR (Mistral/LlamaParse/Vision LLM) پیکربندی نشده یا پاسخ نداد؛ "
        "محتوای تصویر استخراج نشد."
    )
    return None, "unavailable", warnings


def _ocr_scanned_pdf(data: bytes, filename: str) -> Tuple[Optional[str], str, List[str]]:
    """OCR PDF اسکن‌شده: Mistral/LlamaParse روی خود PDF، سپس Vision روی صفحات رندرشده."""
    warnings: List[str] = []
    text = _mistral_ocr(data, filename, "application/pdf", is_pdf=True)
    if text:
        return text, "mistral-ocr", warnings
    text = _llamaparse_ocr(data, filename, "application/pdf")
    if text:
        return text, "llamaparse", warnings
    images = _pdf_render_pages_png(data)
    if images:
        pages: List[str] = []
        for idx, img in enumerate(images, 1):
            page_text = _vision_llm_ocr_image(img, "image/png")
            if page_text:
                pages.append(f"## صفحه {idx}\n\n{page_text}")
        if pages:
            return "\n\n".join(pages), "vision-llm", warnings
    warnings.append("سند PDF اسکن‌شده تشخیص داده شد اما هیچ سرویس OCR پاسخی نداد.")
    return None, "unavailable", warnings


# ─────────────────────────────────────────────────────────────────────────────
# متن ساده
# ─────────────────────────────────────────────────────────────────────────────
def _decode_bytes(data: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "cp1256", "latin-1"):
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode("utf-8", errors="ignore")


# ─────────────────────────────────────────────────────────────────────────────
# روش اصلی — تبدیل هر سند به Markdown
# ─────────────────────────────────────────────────────────────────────────────
def _resolve_source(source: Union[bytes, bytearray, str, pathlib.Path]) -> Tuple[bytes, str]:
    if isinstance(source, (bytes, bytearray)):
        return bytes(source), "document"
    if isinstance(source, pathlib.Path):
        return source.read_bytes(), source.name
    # رشته: اگر مسیر موجود باشد از دیسک خوانده می‌شود، وگرنه متن خام تلقی می‌گردد
    candidate = pathlib.Path(source)
    try:
        if candidate.exists() and candidate.is_file():
            return candidate.read_bytes(), candidate.name
    except OSError:
        pass
    return source.encode("utf-8"), "document"


def parse_document_to_markdown(
    source: Union[bytes, bytearray, str, pathlib.Path],
    filename: Optional[str] = None,
    mime_type: Optional[str] = None,
) -> ParsedDocument:
    """تبدیل سند (Word/PDF/متن/تصویر) به Markdown استاندارد فارسی.

    Args:
        source: بایت‌های فایل یا مسیر فایل.
        filename: نام فایل برای تشخیص پسوند.
        mime_type: نوع MIME اختیاری.

    Returns:
        ``ParsedDocument`` شامل ``markdown`` و فراداده روش استخراج/OCR.
    """
    if isinstance(source, (bytes, bytearray)):
        data = bytes(source)
        name = filename or "document"
    else:
        raw, inferred_name = _resolve_source(source)
        data = raw
        name = filename or inferred_name

    if not data:
        return ParsedDocument(
            filename=name,
            format="unknown",
            method="empty",
            markdown="",
            warnings=["فایل خالی است."],
        )

    ext = pathlib.Path(name).suffix.lower().lstrip(".")
    if not ext and mime_type:
        for candidate, mime in MIME_BY_EXT.items():
            if mime == mime_type:
                ext = candidate
                break
    if not ext:
        ext = "txt"
    mime = mime_type or MIME_BY_EXT.get(ext, "application/octet-stream")

    # ── Word ──
    if ext in ("docx", "doc"):
        try:
            return _docx_to_markdown(data, name)
        except Exception as exc:
            return ParsedDocument(
                filename=name,
                format=ext,
                method="python-docx-failed",
                markdown="",
                warnings=[f"استخراج Word ناموفق بود: {str(exc)[:160]}"],
            )

    # ── PDF ──
    if ext == "pdf":
        doc, warnings = _pdf_text_to_markdown(data, name)
        if doc is not None:
            return doc
        ocr_text, method, ocr_warnings = _ocr_scanned_pdf(data, name)
        warnings = warnings + ocr_warnings
        if ocr_text:
            markdown = normalize_persian_text(ocr_text)
            markdown = _normalize_markdown_tables(markdown)
            return ParsedDocument(
                filename=name,
                format="pdf",
                method=method,
                markdown=markdown,
                ocr_used=True,
                warnings=warnings,
            )
        return ParsedDocument(
            filename=name,
            format="pdf",
            method="ocr-unavailable",
            markdown="",
            ocr_used=True,
            warnings=warnings or ["محتوای PDF استخراج نشد."],
        )

    # ── متن ساده ──
    if ext in TEXT_EXTENSIONS or (mime or "").startswith("text/"):
        text = normalize_persian_text(_decode_bytes(data))
        return ParsedDocument(
            filename=name,
            format=ext,
            method="plain-text",
            markdown=text,
        )

    # ── تصاویر ──
    if ext in IMAGE_EXTENSIONS or (mime or "").startswith("image/"):
        ocr_text, method, warnings = _ocr_image(data, name, mime)
        if ocr_text:
            markdown = normalize_persian_text(ocr_text)
            return ParsedDocument(
                filename=name,
                format=ext,
                method=method,
                markdown=markdown,
                ocr_used=True,
                warnings=warnings,
            )
        return ParsedDocument(
            filename=name,
            format=ext,
            method="ocr-unavailable",
            markdown="",
            ocr_used=True,
            warnings=warnings,
        )

    # ── ناشناخته: تلاش برای خواندن به‌عنوان متن ──
    text = normalize_persian_text(_decode_bytes(data))
    if len(text.strip()) >= _MIN_TEXT_PDF_CHARS:
        return ParsedDocument(
            filename=name,
            format=ext,
            method="best-effort-text",
            markdown=text,
            warnings=[f"فرمت «{ext}» پشتیبانی نمی‌شود؛ به‌صورت متن خام خوانده شد."],
        )
    return ParsedDocument(
        filename=name,
        format=ext,
        method="unsupported",
        markdown="",
        warnings=[f"فرمت «{ext}» پشتیبانی نمی‌شود."],
    )


# ─────────────────────────────────────────────────────────────────────────────
# مرتب‌سازی و استانداردسازی جداول Markdown
# ─────────────────────────────────────────────────────────────────────────────
def _is_md_separator(line: str) -> bool:
    cell = line.strip().strip("|").strip()
    return bool(cell) and all(set(part.strip()) <= {"-", ":"} and part.strip() for part in cell.split("|"))


def _parse_md_row(line: str) -> List[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _normalize_markdown_tables(markdown: str) -> str:
    """استانداردسازی جداول Markdown: پاک‌سازی سلول‌ها، حذف سطر/ستون خالی و مرتب‌سازی سطرها."""
    lines = markdown.split("\n")
    out: List[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if "|" in line and i + 1 < len(lines) and _is_md_separator(lines[i + 1]):
            header = _parse_md_row(line)
            width = len(header)
            body: List[List[str]] = []
            j = i + 2
            while j < len(lines) and "|" in lines[j]:
                row = _parse_md_row(lines[j])
                if any(row):
                    body.append((row + [""] * width)[:width])
                j += 1
            body = _sort_table_rows(body)
            header_line = "| " + " | ".join(header) + " |"
            sep_line = "| " + " | ".join(["---"] * width) + " |"
            body_lines = ["| " + " | ".join(r) + " |" for r in body]
            out.extend([header_line, sep_line, *body_lines])
            i = j
            continue
        out.append(line)
        i += 1
    return "\n".join(out)


__all__ = [
    "ParsedDocument",
    "SUPPORTED_FORMATS",
    "normalize_persian_text",
    "parse_document_to_markdown",
]
