"""
ROXIRA UNIVERSAL DOCUMENT TO MARKDOWN & JSON PARSER
تبدیل خودکار اسناد Word، متون حقوقی و فاکتورها به فرمت تمیز Markdown برای مدل‌های زبانی
"""
import pathlib
from typing import Dict, Any

class UniversalDocumentParser:
    @staticmethod
    def parse_text_to_markdown(raw_content: str, title: str = "سند حقوقی") -> Dict[str, Any]:
        """تبدیل متن به Markdown ساختاریافته با تفکیک تیترها و بندها"""
        lines = [line.strip() for line in raw_content.splitlines() if line.strip()]
        md_lines = [f"# {title}\n"]
        
        for line in lines:
            if line.startswith("ماده") or line.startswith("رای") or line.startswith("بند"):
                md_lines.append(f"\n### {line}")
            elif line.startswith("خواهان") or line.startswith("خوانده") or line.startswith("موضوع"):
                md_lines.append(f"* **{line}**")
            else:
                md_lines.append(line)
                
        clean_markdown = "\n".join(md_lines)
        return {
            "title": title,
            "line_count": len(lines),
            "markdown_content": clean_markdown,
            "status": "PARSED_SUCCESSFULLY"
        }

if __name__ == "__main__":
    sample = "ماده ۲۳ قانون صدور چک\nدارنده چک با گواهی عدم پرداخت تقاضای اجرائیه مستقیم می‌نماید.\nخواهان: ماهان محمدی"
    res = UniversalDocumentParser.parse_text_to_markdown(sample, "قانون صدور چک")
    print("✅ تست پارسر اسناد به Markdown:")
    print(res["markdown_content"])
