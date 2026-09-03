"""
ROXIRA ADVANCED DOCLING & MARKITDOWN HYBRID DOCUMENT PARSER
استخراج ساختاریافته اسناد مالی و حقوقی با الگوی IBM Docling و Microsoft MarkItDown
"""
import sys
import json
import pathlib
import datetime
from typing import Dict, List, Any

CURRENT_DIR = pathlib.Path.cwd()
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

class AdvancedDoclingParser:
    @staticmethod
    def parse_document_to_docling_schema(raw_text: str, filename: str = "document.pdf") -> Dict[str, Any]:
        """
        تبدیل سند به ساختار استاندارد DoclingDocument شامل درخت بخش‌ها، جداول و متادیتا
        """
        lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
        sections = []
        tables = []
        current_table = []
        in_table = False

        for line in lines:
            # تشخیص سطرهای جدول
            if "|" in line or "\t" in line or ("," in line and len(line.split(",")) >= 3):
                in_table = True
                cells = [c.strip() for c in (line.split("|") if "|" in line else line.split(",")) if c.strip()]
                if cells:
                    current_table.append(cells)
            else:
                if in_table and current_table:
                    tables.append({
                        "table_id": f"TBL-{len(tables)+1}",
                        "rows_count": len(current_table),
                        "headers": current_table[0],
                        "data_rows": current_table[1:]
                    })
                    current_table = []
                    in_table = False

                if line.startswith("#") or line.startswith("ماده") or line.startswith("فصل"):
                    sections.append({
                        "type": "heading",
                        "text": line.lstrip("#").strip()
                    })
                else:
                    sections.append({
                        "type": "paragraph",
                        "text": line
                    })

        if in_table and current_table:
            tables.append({
                "table_id": f"TBL-{len(tables)+1}",
                "rows_count": len(current_table),
                "headers": current_table[0],
                "data_rows": current_table[1:]
            })

        # تولید خروجی تمیز Markdown
        md_lines = [f"# {filename}\n"]
        for s in sections:
            if s["type"] == "heading":
                md_lines.append(f"\n### {s['text']}")
            else:
                md_lines.append(s["text"])

        return {
            "schema_version": "docling_core_v1",
            "filename": filename,
            "parsed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "metrics": {
                "total_sections": len(sections),
                "extracted_tables_count": len(tables)
            },
            "markdown_repr": "\n".join(md_lines),
            "docling_document": {
                "body_sections": sections,
                "structured_tables": tables
            }
        }

if __name__ == "__main__":
    sample_invoice = """
    صورتحساب فروش خدمات سازمانی
    شماره فاکتور: ۹۰۲۱
    شرح کالا | تعداد | قیمت واحد | جمع کل
    لایسنس ERP سازمانی | ۱ | ۱۵۰۰۰۰۰۰ | ۱۵۰۰۰۰۰۰
    پشتیبانی سالانه | ۱ | ۵۰۰۰۰۰۰ | ۵۰۰۰۰۰۰
    ماده ۲۳۰ قانون مدنی - تعهدات قراردادی معتبر است.
    """
    res = AdvancedDoclingParser.parse_document_to_docling_schema(sample_invoice, "invoice_9021.docx")
    print("=== تست پارسر ساختاریافته Docling ===")
    print(f"فایل: {res['filename']} | تعداد بخش‌ها: {res['metrics']['total_sections']} | جداول: {res['metrics']['extracted_tables_count']}")
    if res["docling_document"]["structured_tables"]:
        print("جدول استخراج‌شده:", res["docling_document"]["structured_tables"][0]["headers"])
