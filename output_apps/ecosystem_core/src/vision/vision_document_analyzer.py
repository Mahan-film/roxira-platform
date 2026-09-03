from __future__ import annotations

import json
import os
import pathlib
import urllib.request
from typing import Dict, Any

ENV_FILE = pathlib.Path("/Users/mac/Developer/project-foundry/.env")

def get_key(name: str) -> str:
    if os.environ.get(name):
        return os.environ[name]
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip("'\"")
    return ""

def analyze_document_image_or_text(document_content: str, doc_hint: str = "AUTO") -> Dict[str, Any]:
    """Analyzes raw OCR streams, Sana notifications, or invoices and extracts structured entities."""
    api_key = get_key("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY not configured.")

    prompt = f"""شما تحلیل‌گر ارشد اسناد رسمی و قضایی هستید.
متن ورودی زیر که از تصویر/اسکن یا متن پرونده استخراج شده را با دقت بالا تحلیل کنید:

محتوا:
{document_content}

راهنمای سند: {doc_hint}

خروجی دقیق و معتبر JSON با کلیدهای زیر صادر کنید:
1. document_type (ثنا، چک، فاکتور، قرارداد، شکواییه)
2. parties (شامل خواهان/شاکی/فروشنده و خوانده/مشتکی‌عنه/خریدار)
3. reference_numbers (شماره پرونده، کلاسه، شناسه صیاد، شماره فاکتور)
4. amounts_and_dates (مبالغ، تاریخ سررسید یا ابلاغ، ارز)
5. critical_deadlines (مهلت‌های تجدیدنظر، واخواهی یا پرداخت)
6. actionable_summary (خلاصه حقوقی یا مالی جهت اقدام فوری)"""

    payload = {
        "model": "deepseek-v4-pro",
        "messages": [
            {"role": "system", "content": "You return strictly valid JSON for multi-modal document understanding."},
            {"role": "user", "content": prompt}
        ],
        "thinking": {"type": "disabled"},
        "response_format": {"type": "json_object"},
        "max_tokens": 8000
    }

    req = urllib.request.Request(
        "https://api.deepseek.com/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST"
    )

    with urllib.request.urlopen(req, timeout=120) as resp:
        res = json.loads(resp.read().decode("utf-8"))
    
    return json.loads(res["choices"][0]["message"]["content"])

if __name__ == "__main__":
    sample_sana_notice = """
    سامانه ابلاغ الکترونیک قضایی (ثنا)
    شماره ابلاغیه: ۱۴۰۳۹۸۲۷۱۰۰۰۲۳۴
    شماره پرونده: ۱۴۰۲۲۳۹۲۰۰۰۱۸۷۲۶
    مخاطب: آقای مبین خرمی
    شعبه: شعبه ۱۰۵ دادگاه عمومی حقوقی مجتمع قضایی شهید بهشتی تهران
    موضوع: ابلاغ دادنامه شماره ۱۴۰۳۸۷۱
    متن: مهلت اعتراض و تجدیدنظرخواهی ۲۰ روز از تاریخ رویت در سامانه می‌باشد. محکومیت به پرداخت مبلغ ۲,۴۰۰,۰۰۰,۰۰۰ ریال اصل خواسته به انضمام خسارت تاخیر تادیه.
    """
    result = analyze_document_image_or_text(sample_sana_notice, doc_hint="SANA_JUDICIAL_NOTICE")
    print("\n--- MULTIMODAL SANA NOTICE ANALYSIS ---")
    print(json.dumps(result, indent=2, ensure_ascii=False))
