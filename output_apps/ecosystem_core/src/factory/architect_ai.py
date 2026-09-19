#!/usr/bin/env python3
import json, re
from output_apps.ecosystem_core.src.factory.llm_client import ask_deepseek
from output_apps.ecosystem_core.src.factory.multi_search_engine import resilient_deep_search

def clean_json_response(raw_text: str) -> dict:
    match = re.search(r'\{[\s\S]*\}', raw_text)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            pass
    return None

def analyze_and_architect_system(prompt: str, task_id: str) -> dict:
    print(f"  🔍 کاوش زنده از طریق استخر سرچ (Tavily/Exa/Brave/Jina)...")
    web_evidence = resilient_deep_search(f"{prompt} 2026 architecture state of the art benchmarks")

    system_prompt = (
        "شما معمار ارشد سیستم‌ها و محقق ارشد هوش مصنوعی در سال ۲۰۲۶ هستید. "
        "موضوع ورودی را در هر زمینه‌ای که هست (هوش مصنوعی، سخت‌افزار، زیرساخت، فین‌تک، شبکه، یا پژوهش عمومی) بدون تعصب تحلیل کنید. "
        "گزارش باید شامل تحلیل دقیق، ماتریس تصمیم‌گیری، پیش‌نیازهای پیاده‌سازی و ابزارهای تسریع‌کننده باشد. "
        "تمامی متون خروجی باید کاملاً به زبان فارسی روان و فنی نوشته شوند. "
        "پاسخ باید فقط و فقط یک آبجکت معتبر JSON بدون هیچ علامت مارک‌داون (```) باشد."
    )

    user_prompt = f"""
موضوع کاوش / پروژه:
"{prompt}"

شواهد و بنچمارک‌های استخراج‌شده از وب:
{web_evidence}

یک سند رسمی معماری و تحلیل جامع بر پایه استاندارد IEEE 1016 تدوین کن.
ساختار الزامی JSON:
{{
  "domain_detected": "حوزه تخصصی تشخیص‌داده‌شده (مثلاً ارکستراسیون ایجنت‌ها، سخت‌افزار، فین‌تک)",
  "expert_opinion": "تحلیل راهبردی، جامع و پاسخ عمیق به سوال کاربر همراه با دلایل مهندسی به زبان فارسی",
  "implementation_prerequisites": [
    "پیش‌نیازهای زیرساختی و ابزارهایی که سرعت اجرای این پروژه را به حداکثر می‌رسانند"
  ],
  "decision_matrix": [
    {{
      "layer": "عنوان لایه تصمیم‌گیری متناسب با این موضوع خاص",
      "chosen_solution": "راهکار منتخب سال ۲۰۲۶ با ذکر دلیل",
      "rejected_alternatives": "گزینه‌های سنتی یا ضعیف‌تر",
      "technical_justification": "استدلال فنی، بنچمارک مقایسه‌ای و ادله مهندسی"
    }}
  ],
  "domain_entities": [
    {{
      "name": "نام بخش یا مؤلفه کلیدی",
      "table_name": "شناسه سیستمی یا نام جدول",
      "description": "شرح وظیفه این مؤلفه در سیستم",
      "fields": [
        {{"name": "field_name", "type": "نوع داده", "constraints": "محدودیت‌ها"}}
      ]
    }}
  ],
  "api_contracts": [
    {{
      "method": "GET / POST / PUT",
      "endpoint": "/api/v1/...",
      "description": "عملکرد اندپوینت یا کانال ارتباطی"
    }}
  ],
  "recommended_sota_repositories": [
    "نام کامل مخازن مرجع جهانی گیت‌هاب جهت الگوبرداری و پیاده‌سازی مستقیم"
  ]
}}
"""
    raw_res = ask_deepseek(user_prompt, system_prompt)
    parsed = clean_json_response(raw_res)
    if parsed:
        return parsed

    # فالبک غنی در صورت اختلال موقت
    return {
        "domain_detected": "سیستم‌های جامع نرم‌افزاری و ایجنتی",
        "expert_opinion": f"برای پیاده‌سازی '{prompt}'، استفاده از الگوهای ارکستراسیون ایجنتی و پایگاه‌های برداری برترین بازدهی را دارد.",
        "implementation_prerequisites": ["Docker ARM64", "موتورهای وب‌کاوی Tavily و Crawl4AI", "Qdrant Vector DB"],
        "decision_matrix": [
            {
                "layer": "ارکستراسیون سیستم",
                "chosen_solution": "LangGraph StateGraph + MCP",
                "rejected_alternatives": "اسکریپت‌های خطی صلب",
                "technical_justification": "انعطاف در خطایابی و قابلیت سوییچ وضعیت"
            }
        ],
        "domain_entities": [
            {"name": "CoreArtifact", "table_name": "core_artifacts", "description": "داده‌های اصلی", "fields": [{"name": "id", "type": "UUID", "constraints": "PK"}]}
        ],
        "api_contracts": [{"method": "GET", "endpoint": "/api/v1/core/status", "description": "پایش وضعیت"}],
        "recommended_sota_repositories": ["langchain-ai/open_deep_research", "all-hands-ai/openhands"]
    }
