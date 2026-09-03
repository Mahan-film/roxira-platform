from __future__ import annotations

import json
import os
import pathlib
import urllib.request

ENV_FILE = pathlib.Path("/Users/mac/Developer/project-foundry/.env")

def get_key(name: str) -> str:
    if os.environ.get(name):
        return os.environ[name]
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip("'\"")
    return ""

def parse_unstructured_document(doc_text: str, doc_category: str = "FINANCIAL_INVOICE") -> dict:
    """Extracts high-fidelity JSON from any raw text, OCR output, or contract draft."""
    api_key = get_key("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY is not configured.")

    prompt = f"""You are an autonomous Document Structuring and Analysis Engine.
Analyze the following unstructured document text in the category '{doc_category}'.

DOCUMENT CONTENT:
{doc_text}

Task:
Extract key entities, metadata, action items, monetary values, dates, and convert the entire content into valid, clean JSON.
Ensure all Persian/Arabic numbers are normalized into standard integers/floats.
"""

    payload = {
        "model": "deepseek-v4-pro",
        "messages": [
            {"role": "system", "content": "You return strictly valid JSON representation of input documents."},
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
    sample_text = """
    قرارداد فروش نرم‌افزار سازمانی
    تاریخ عقد: ۱۲ آبان ۱۴۰۲
    طرف اول: شرکت فناوری روکسیرا با شناسه ملی ۱۰۱۰۲۳۴۵۶
    طرف دوم: شرکت مهندسی سپهر رایانه
    مبلغ کل پروژه: ۱۲۰,۰۰۰,۰۰۰ ریال معادل ۱۲,۰۰۰,۰۰۰ تومان
    مقرر شد ۵۰ درصد ثمن حین عقد قرارداد و مابقی پس از تحویل نهایی داکرها پرداخت گردد.
    خسارت روزانه تاخیر: ۵,۰۰۰,۰۰۰ ریال.
    """
    res = parse_unstructured_document(sample_text, doc_category="CONTRACT")
    print(json.dumps(res, indent=2, ensure_ascii=False))
