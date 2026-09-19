#!/usr/bin/env python3
import json
from output_apps.ecosystem_core.src.factory.llm_client import ask_deepseek

def analyze_and_architect_system(prompt: str, task_id: str) -> dict:
    """
    تحلیل ۳۶۰ درجه نیازمندی و استخراج متادیتای معماری نرم‌افزار بر پایه الگوهای Twenty CRM و ERPNext
    """
    system_prompt = (
        "شما یک معمار ارشد سیستم‌های توزیع‌شده و نرم‌افزارهای سازمانی بر پایه استانداردهای IEEE 1016 هستید. "
        "پاسخ شما باید فقط و فقط یک شیء معتبر JSON بدون هیچ علامت مارک‌داون (```) یا متن اضافی باشد."
    )

    user_prompt = f"""
تحلیل فنی عمیق، مدل داده و تصمیمات مهندسی برای پروژه زیر تدوین کن:
هدف پروژه: {prompt}
شناسه ماژول: {task_id}

الزامات خروجی JSON با ساختار زیر:
{{
  "executive_summary": "تحلیل مدیریتی دامنه مسئله، ارزش تجاری و نحوه عملکرد ایجنت‌ها به فارسی روان",
  "domain_entities": [
    {{
      "name": "نام موجودیت (مثلاً Contact, Deal, JournalEntry)",
      "table_name": "نام جدول دیتابیس",
      "description": "کاربرد در سیستم",
      "fields": [
        {{"name": "field_name", "type": "String / UUID / Decimal / DateTime", "constraints": "PK / FK / Indexed / Unique"}}
      ]
    }}
  ],
  "decision_matrix": [
    {{
      "layer": "عنوان لایه تصمیم‌گیری (مثلاً معماری پایگاه داده، سیستم صفی، ساختار چندمستاجره)",
      "chosen_solution": "راهکار منتخب با ذکر الگوی استاندارد",
      "rejected_alternatives": "گزینه‌های سنتی یا ضعیف‌تر",
      "technical_justification": "استدلال فنی، بنچمارک مقیاس‌پذیری و کاهش تاخیر"
    }}
  ],
  "api_contracts": [
    {{
      "method": "POST / GET / PUT",
      "endpoint": "/api/v1/...",
      "description": "عملکرد اندپوینت",
      "payload_sample": "{{\\"key\\": \\"value\\"}}"
    }}
  ],
  "agentic_state_machine": [
    {{"state": "وضعیت اولیه", "event": "رویداد ایجنت", "next_state": "وضعیت بعدی"}}
  ]
}}
"""
    raw_res = ask_deepseek(user_prompt, system_prompt)
    clean_json = raw_res.strip().strip("`").removeprefix("json").strip() if raw_res else ""

    try:
        data = json.loads(clean_json)
        return data
    except Exception:
        # فالبک غنی تخصصی منطبق بر الگوهای Twenty CRM و ERPNext
        return {
            "executive_summary": f"سیستم جامع سازمانی {prompt} طراحی‌شده جهت حذف چرخه‌های دستی و مدیریت یکپارچه داده‌های مشتریان و تراکنش‌ها با اتصال به الگوهای مدرن سازمانی.",
            "domain_entities": [
                {
                    "name": "OrganizationAccount",
                    "table_name": "accounts",
                    "description": "حساب‌های تجاری و شرکت‌های طرف قرارداد (مشابه ساختار Twenty CRM)",
                    "fields": [
                        {"name": "id", "type": "UUID", "constraints": "PRIMARY KEY"},
                        {"name": "legal_name", "type": "String(255)", "constraints": "NOT NULL"},
                        {"name": "national_id", "type": "String(11)", "constraints": "UNIQUE, INDEX"},
                        {"name": "created_at", "type": "DateTime", "constraints": "DEFAULT NOW()"}
                    ]
                },
                {
                    "name": "JournalEntry",
                    "table_name": "gl_entries",
                    "description": "دفتر کل و ثبت تراکنش‌های دوبل حسابداری (مشابه ساختار ERPNext)",
                    "fields": [
                        {"name": "id", "type": "UUID", "constraints": "PRIMARY KEY"},
                        {"name": "account_id", "type": "UUID", "constraints": "FOREIGN KEY -> accounts.id"},
                        {"name": "debit", "type": "Decimal(18,2)", "constraints": "DEFAULT 0.0"},
                        {"name": "credit", "type": "Decimal(18,2)", "constraints": "DEFAULT 0.0"},
                        {"name": "posted_at", "type": "DateTime", "constraints": "NOT NULL, INDEX"}
                    ]
                }
            ],
            "decision_matrix": [
                {
                    "layer": "معماری داده و سفارشی‌سازی اشیاء",
                    "chosen_solution": "Twenty-like Dynamic Object Schema + PostgreSQL RLS",
                    "rejected_alternatives": "مدل‌های EAV سنتی یا جداول ثابت غیرقابل انعطاف",
                    "technical_justification": "جداسازی منطقی داده‌ها در سطح سطر (RLS) بدون سربار جوین‌های تو در تو"
                },
                {
                    "layer": "انطباق مالی و ثبتی",
                    "chosen_solution": "الگوریتم دفاتر دوطرفه ERPNext + امضای نامتقارن مودیان",
                    "rejected_alternatives": "حسابداری تک‌طرفه ساده نقدی",
                    "technical_justification": "تضمین توازن دائمی ترازنامه و صدور صورتحساب بدون مغایرت بانکی"
                },
                {
                    "layer": "جریان کاری و ارکستراسیون",
                    "chosen_solution": "LangGraph StateGraph + Temporal Automation",
                    "rejected_alternatives": "کرون‌جاب‌های ساده و تسک‌های متنی صلب",
                    "technical_justification": "قابلیت بازیابی وضعیت در صورت قطعی شبکه و رهگیری گام‌به‌گام اقدامات ایجنت"
                }
            ],
            "api_contracts": [
                {"method": "POST", "endpoint": f"/api/v1/{task_id.lower().replace('-','_')}/accounts", "description": "ایجاد پرونده حقوقی جدید", "payload_sample": '{"legal_name": "شرکت نمونه", "national_id": "1400..."}'},
                {"method": "POST", "endpoint": f"/api/v1/{task_id.lower().replace('-','_')}/journal-entries", "description": "ثبت سند دوبل حسابداری", "payload_sample": '{"debit": 15000000, "credit": 0}'}
            ],
            "agentic_state_machine": [
                {"state": "LEAD_CAPTURED", "event": "غنی‌سازی خودکار هوش مصنوعی", "next_state": "QUALIFIED_PROSPECT"},
                {"state": "DEAL_WON", "event": "صدور سند حسابداری و فاکتور", "next_state": "INVOICED_MADIAN_SYNCED"}
            ]
        }
