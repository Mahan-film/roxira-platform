from __future__ import annotations

import json
import pathlib
from datetime import datetime

def render_judicial_lawsuit_html(doc_data: dict) -> str:
    """Renders court-ready official Persian lawsuit sheet compliant with Judiciary standards."""
    title = doc_data.get("title", "دادخواست نخستین")
    court = doc_data.get("court_jurisdiction", "دادگاه عمومی حقوقی")
    parties = doc_data.get("parties", {})
    claimant = parties.get("claimant", "خواهان") if isinstance(parties, dict) else "خواهان"
    respondent = parties.get("respondent", "خوانده") if isinstance(parties, dict) else "خوانده"
    relief = doc_data.get("subject_or_relief", "تعیین خواسته")
    evidence = doc_data.get("evidence_list", [])
    formal_text = doc_data.get("formal_text", "")
    legal_basis = doc_data.get("legal_basis", [])

    evidence_html = "".join([f"<li>{ev}</li>" for ev in evidence])
    
    basis_html = ""
    if isinstance(legal_basis, dict):
        basis_html = "".join([f"<li><strong>{k}:</strong> {v}</li>" for k, v in legal_basis.items()])
    elif isinstance(legal_basis, list):
        basis_html = "".join([f"<li>{b}</li>" for b in legal_basis])

    html = f"""<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>{title}</title>
    <style>
        @page {{ size: A4; margin: 20mm; }}
        body {{ font-family: 'B Nazanin', 'Vazirmatn', Tahoma, sans-serif; background: #f8fafc; color: #0f172a; padding: 20px; font-size: 14px; line-height: 1.8; }}
        .paper {{ max-width: 800px; margin: auto; background: white; border: 2px solid #0f172a; padding: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }}
        .header {{ text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 15px; margin-bottom: 20px; }}
        .header h1 {{ font-size: 18px; margin: 0; }}
        .header p {{ font-size: 12px; margin: 5px 0 0 0; color: #475569; }}
        table {{ width: 100%; border-collapse: collapse; margin-bottom: 20px; }}
        th, td {{ border: 1px solid #0f172a; padding: 8px 12px; text-align: right; vertical-align: top; }}
        th {{ background-color: #f1f5f9; width: 25%; font-weight: bold; }}
        .section-title {{ font-weight: bold; background: #e2e8f0; padding: 6px 12px; margin: 15px 0 8px 0; border-right: 4px solid #0284c7; }}
        .body-text {{ text-align: justify; text-justify: inter-word; white-space: pre-line; line-height: 2; }}
        .footer {{ margin-top: 40px; display: flex; justify-content: space-between; padding: 0 40px; }}
    </style>
</head>
<body>
    <div class="paper">
        <div class="header">
            <h1>جمهوری اسلامی ایران - قوه قضائیه</h1>
            <p>برگ دادخواست به دادگاه نخستین (موضوع ماده ۵۱ قانون آیین دادرسی مدنی)</p>
            <p><strong>مرجع صالح رسیدگی:</strong> {court}</p>
        </div>

        <table>
            <tr>
                <th>خواهان (مشخصات و اقامتگاه)</th>
                <td>{claimant}</td>
            </tr>
            <tr>
                <th>خوانده (مشخصات و اقامتگاه)</th>
                <td>{respondent}</td>
            </tr>
            <tr>
                <th>تعیین خواسته و بهای آن</th>
                <td>{relief}</td>
            </tr>
            <tr>
                <th>دلایل و منضمات دادخواست</th>
                <td>
                    <ol style="margin: 0; padding-right: 20px;">
                        {evidence_html}
                    </ol>
                </td>
            </tr>
        </table>

        <div class="section-title">مستندات قانونی و قواعد حاکم بر دعوا</div>
        <ul style="margin: 0; padding-right: 20px;">
            {basis_html}
        </ul>

        <div class="section-title">شرح دادخواست و جهات استحقاق</div>
        <div class="body-text">{formal_text}</div>

        <div class="footer">
            <div><strong>امضاء یا اثر انگشت خواهان / وکیل:</strong></div>
            <div><strong>تاریخ تنظیم:</strong> {datetime.now().strftime('%Y/%m/%d')}</div>
        </div>
    </div>
</body>
</html>"""
    return html

if __name__ == "__main__":
    test_data = {
        "title": "دادخواست الزام به تنظیم سند رسمی انتقال خودرو",
        "court_jurisdiction": "دادگاه عمومی حقوقی تهران",
        "parties": {
            "claimant": "مبین خرمی - شماره ملی: 0012345678",
            "respondent": "احمد رضایی - شماره ملی: 0098765432"
        },
        "subject_or_relief": "الزام به تنظیم سند رسمی انتقال خودرو مقوم به ۵۰۰ میلیون ریال و مطالبه خسارت دادرسی",
        "evidence_list": ["قرارداد بیع عادی مورخ ۱۴۰۲/۱۰/۱۵", "رسید واریز ثمن معامله", "اظهارنامه رسمی ابلاغ‌شده"],
        "legal_basis": ["ماده ۱۰ قانون مدنی", "ماده ۲۱۹ قانون مدنی", "ماده ۵۱ قانون آیین دادرسی مدنی"],
        "formal_text": "ریاست محترم دادگاه عمومی حقوقی\nبا سلام؛ احتراماً به استحضار می‌رساند اینجانب به موجب قرارداد پیوست یک دستگاه خودرو خریداری نموده و کل ثمن را پرداخت نموده‌ام؛ لیکن خوانده از انتقال سند استنکاف می‌ورزد. لذا تقاضای رسیدگی و صدور حکم شایسته مورد استدعاست."
    }
    
    out_file = pathlib.Path("output_apps/smart_judge/sample_lawsuit.html")
    out_file.write_text(render_judicial_lawsuit_html(test_data), encoding="utf-8")
    print(f"COURT_DOCUMENT_RENDERED_SUCCESS: {out_file.resolve()}")
