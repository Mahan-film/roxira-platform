"""
پکیج پردازشی اسناد هستهٔ SmartJudge.

تبدیل PDF / Word / تصویر دادنامه / متنی به Markdown ساختاریافته با
معماری سه‌لایه: Docling → استخراج بومی → OCR بینایی از راه دور.

نصب موتور اصلی (اختیاری ولی توصیه‌شده):
    pip install docling
"""
from .document_processor import (  # noqa: F401
    DOCLING_AVAILABLE,
    MAX_FILES_PER_REQUEST,
    MAX_FILE_BYTES,
    SUPPORTED_EXTENSIONS,
    DocumentProcessingError,
    ParsedDocument,
    combine_markdown,
    convert_documents,
    normalize_persian_text,
    process_document,
    provider_health,
)

__all__ = [
    "DOCLING_AVAILABLE",
    "MAX_FILE_BYTES",
    "MAX_FILES_PER_REQUEST",
    "SUPPORTED_EXTENSIONS",
    "DocumentProcessingError",
    "ParsedDocument",
    "combine_markdown",
    "convert_documents",
    "normalize_persian_text",
    "process_document",
    "provider_health",
]
