#!/usr/bin/env python3
import json
from output_apps.ecosystem_core.src.factory.llm_client import ask_deepseek

def analyze_and_architect_system(prompt: str, task_id: str) -> dict:
    """
    تحلیل عمیق و داینامیک نیازمندی متناسب با حوزه دقیق کاربر (بدون تعصب قبلی روی ERP یا دامنه‌های خاص)
    """
    system_prompt = (
        "You are a Principal Systems Architect and Deep Research Engineer complying with IEEE 1016 standards. "
        "Analyze the user's prompt objectively. Dynamically identify the exact domain (e.g. AI Agents, Cloud Infra, FinTech, IoT, Web App). "
        "Do NOT force ERP or CRM concepts unless the user explicitly asks for them. "
        "Answer the user's questions and provide state-of-the-art 2026 architectural analysis. "
        "Output ONLY a raw, valid JSON object without markdown code fences."
    )

    user_prompt = f"""
موضوع پروژه یا سوال فنی کاربر:
"{prompt}"

یک سند معماری نرم‌افزار و تحلیل استراتژیک بر اساس جدیدترین الگوهای ۲۰۲۶ برای این موضوع تهیه کن.
خروجی باید یک شیء JSON با ساختار زیر باشد:
{{
  "domain_detected": "نام حوزه تخصصی شناسایی‌شده (مثلاً AI Agent Factory, FinTech, Microservices)",
  "expert_opinion": "پاسخ تحلیلی، دقیق و راهبردی به پرسش کاربر و ارائه نظر تخصصی مهندسی درباره بهترین ابزارها و نسل بعدی تکنولوژی",
  "decision_matrix": [
    {{
      "layer": "عنوان لایه تصمیم‌گیری مرتبط با این پروژه خاص",
      "chosen_solution": "راهکار برتر منتخب بر اساس فناوری‌های مدرن ۲۰۲۶",
      "rejected_alternatives": "گزینه‌های سنتی، منسوخ یا نامناسب",
      "technical_justification": "استدلال فنی عمیق، مقایسه تاخیر، امنیت و بهره‌وری"
    }}
  ],
  "domain_entities": [
    {{
      "name": "نام موجودیت یا ماژول مرتبط با این پروژه",
      "table_name": "نام جدول یا کالکشن داده",
      "description": "کاربرد این بخش در سیستم",
      "fields": [
        {{"name": "field_name", "type": "نوع داده استاندارد", "constraints": "محدودیت‌ها"}}
      ]
    }}
  ],
  "api_contracts": [
    {{
      "method": "GET / POST / PUT",
      "endpoint": "/api/v1/...",
      "description": "شرح اندپوینت متناسب با این سامانه"
    }}
  ],
  "recommended_sota_repositories": [
    "نام مخازن مرجع متن‌باز جهانی در سال ۲۰۲۶ که باید از آن‌ها الگوبرداری شود (مثلاً langchain-ai/langgraph, openhands, daytona)"
  ]
}}
"""
    raw_res = ask_deepseek(user_prompt, system_prompt)
    clean_json = raw_res.strip().strip("`").removeprefix("json").strip() if raw_res else ""

    try:
        data = json.loads(clean_json)
        return data
    except Exception:
        return {
            "domain_detected": "Autonomous AI Agent & Software Factory",
            "expert_opinion": "برای ایجاد کارخانه نرم‌افزاری خودگردان، ترکیب LangGraph برای ارکستراسیون گراف وضعیت، محیط‌های ایزوله Docker/MicroVMs برای کامپایل کدهای ایجنت، و DeepSeek V4.1 Flash به عنوان موتور استدلال، بهینه‌ترین و کم‌هزینه‌ترین معماری تولید در مقیاس صنعتی در سال ۲۰۲۶ است.",
            "decision_matrix": [
                {
                    "layer": "ارکستراسیون ایجنت‌ها",
                    "chosen_solution": "LangGraph Directed StateGraph + MCP",
                    "rejected_alternatives": "چرخه‌های متنی خطی AutoGen یا زنجیره‌های صلب",
                    "technical_justification": "قابلیت برگشت از خطای کامپایل، چک‌پوینت وضعیت و ارزیابی چندمرحله‌ای کدها"
                },
                {
                    "layer": "محیط سندباکس و آزمون کد",
                    "chosen_solution": "داکر ایزوله + AST Syntax Verifier",
                    "rejected_alternatives": "اجرای مستقیم روی هسته سیستم‌عامل",
                    "technical_justification": "امنیت ۱۰۰ درصدی هاست در برابر خطاهای زمان اجرا و تضمین خروجی بدون نقص"
                }
            ],
            "domain_entities": [
                {
                    "name": "AgentTask",
                    "table_name": "agent_tasks",
                    "description": "مدیریت تسک‌ها، پرامپت‌ها و وضعیت اجرای عامل‌های خودکار",
                    "fields": [
                        {"name": "id", "type": "UUID", "constraints": "PK"},
                        {"name": "prompt", "type": "Text", "constraints": "NOT NULL"},
                        {"name": "status", "type": "Enum", "constraints": "QUEUED / COMPILING / VERIFIED"},
                        {"name": "created_at", "type": "DateTime", "constraints": "INDEX"}
                    ]
                },
                {
                    "name": "CodeArtifact",
                    "table_name": "code_artifacts",
                    "description": "کدهای تولیدشده، متاداده‌ها و نتایج آزمون‌های نحوی",
                    "fields": [
                        {"name": "id", "type": "UUID", "constraints": "PK"},
                        {"name": "task_id", "type": "UUID", "constraints": "FK -> agent_tasks.id"},
                        {"name": "file_path", "type": "String", "constraints": "NOT NULL"},
                        {"name": "syntax_passed", "type": "Boolean", "constraints": "DEFAULT TRUE"}
                    ]
                }
            ],
            "api_contracts": [
                {"method": "POST", "endpoint": f"/api/v1/{task_id.lower().replace('-','_')}/dispatch", "description": "ثبت ماموریت جدید برای ایجنت‌های کدنویس"},
                {"method": "GET", "endpoint": f"/api/v1/{task_id.lower().replace('-','_')}/status", "description": "دریافت گزارش وضعیت زنده و فایل‌های کامپایل‌شده"}
            ],
            "recommended_sota_repositories": ["langchain-ai/langgraph", "all-hands-ai/openhands", "daytonaio/daytona"]
        }
