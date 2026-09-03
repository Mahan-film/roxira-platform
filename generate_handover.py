import json, pathlib, subprocess, urllib.request

mod_dir = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
modules = [f.name for f in mod_dir.glob("*") if f.is_dir()] if mod_dir.exists() else []

# دریافت وضعیت Qdrant
collections_info = {}
try:
    req = urllib.request.Request("http://127.0.0.1:6333/collections")
    with urllib.request.urlopen(req, timeout=3) as resp:
        cols = json.loads(resp.read().decode()).get("result", {}).get("collections", [])
        for c in cols:
            c_name = c["name"]
            c_req = urllib.request.Request(f"http://127.0.0.1:6333/collections/{c_name}")
            with urllib.request.urlopen(c_req, timeout=3) as cr:
                c_data = json.loads(cr.read().decode()).get("result", {})
                collections_info[c_name] = c_data.get("points_count", c_data.get("vectors_count", 0))
except Exception:
    collections_info = {"status": "Unreachable"}

manifest_content = f"""# ROXIRA OS | شناسنامه و سند تحویل پروژه (System Handover Context)

## ۱. هویت و هدف پلتفرم
- **نام سامانه:** پلتفرم یکپارچه سازمانی و قاضی هوشمند روکسیرا (Roxira OS)
- **معماری:** میکروسرویس‌های متمرکز بر داکر با FastAPI + SQLAlchemy 2.0 Async + PostgreSQL + Redis + Qdrant
- **دامنه‌های فعال:** `https://roxira.net` و `https://roxira.ir`

## ۲. وضعیت زیرساخت و کانتینرها
- **کانتینرها:** `roxira_nginx_prod` (Nginx), `roxira_app_prod` (FastAPI), `roxira_postgres_prod` (DB), `roxira_redis_prod` (Cache), `roxira_qdrant_prod` (Vector DB)
- **منابع فعال:** ۸ گیگابایت Swap دائمی + رم بهینه‌سازی‌شده

## ۳. وضعیت ماژول‌های فعال سازمانی ({len(modules)} ماژول)
- **سیستم مالی و حسابداری دوبل (IFRS):** `advancedfinance` (سرفصل‌ها و اسناد تراز)
- **مدیریت فاکتور الکترونیکی:** `smartinvoicing` (اعتبارسنجی ZUGFeRD و شناسه مالیاتی)
- **هاب درگاه‌های پرداخت:** `paymentgatewayhub` (شتاب/شاپرک و استرداد وجه)
- **انبارداری و لجستیک (ERP):** `warehouseinventory` (مدیریت لات نامبر و بارکد)
- **مدیریت ارتباط با مشتری:** `atomiccrm` (پایپ‌لاین فروش و لیدها)
- **سامانه قاضی هوشمند:** `smartjudge` (جستجوی هیبریدی مواد قانونی و آرای قضایی)
- **استخراج وب و داده:** `scraplingwebagent` (ضد ردیابی Camoufox)
- **پردازش اسناد مالیاتی/حقوقی:** `doclingparser` (تبدیل PDF به مارک‌داون)
- **ارکستریتور و ماتریس وضعیت:** `systemorchestrator`

## ۴. دیتابیس برداری Qdrant و گراف دانش
- **کالکشن‌های ثبت‌شده:**
{chr(10).join([f"  - `{k}`: {v:,} رکورد و بردار (بعد ۱۰۲۴)" for k, v in collections_info.items()])}

## ۵. استراتژی مسیریابی مدل‌های هوش مصنوعی (OpenRouter AI Routing)
- **Tier 0 (کاملاً رایگان):** `openrouter/free`, `z-ai/glm-5.2:free`, `cohere/north-mini-code:free`, `nvidia/nemotron-3-ultra:free`
- **Tier 1 (پیشتازان اقتصادی):** `z-ai/glm-5.3-flash` (Agentic 96%), `deepseek/deepseek-v4-flash-0731`, `google/gemini-3.8-flash`
- **Tier 2 (استدلال عمیق):** `deepseek/deepseek-r1`, `anthropic/claude-3.7-sonnet`

## ۶. اقدامات بعدی برای ادامه توسعه
1. اتصال متدهای ذخیره‌سازی ORM ماژول‌ها به جداول واقعی PostgreSQL.
2. تکمیل پایپ‌لاین گراف دانش Dual-Level با LightRAG برای استخراج روابط میان مواد قانون و آرای قضایی.
3. پیاده‌سازی رابط کاربری داشبورد وب (Single Page Application).
"""

out_file = pathlib.Path("/opt/roxira_platform/SYSTEM_STATE_HANDOVER.md")
out_file.write_text(manifest_content, encoding="utf-8")
print(f"✅ فایل شناسنامه سیستم در آدرس {out_file} ایجاد شد.")
