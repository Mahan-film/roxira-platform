# ROXIRA OS | شناسنامه و سند تحویل پروژه (System Handover Context)

## ۱. هویت و هدف پلتفرم
- **نام سامانه:** پلتفرم یکپارچه سازمانی و قاضی هوشمند روکسیرا (Roxira OS)
- **معماری:** میکروسرویس‌های متمرکز بر داکر با FastAPI + SQLAlchemy 2.0 Async + PostgreSQL + Redis + Qdrant
- **دامنه‌های فعال:** `https://roxira.net` و `https://roxira.ir`

## ۲. وضعیت زیرساخت و کانتینرها
- **کانتینرها:** `roxira_nginx_prod` (Nginx), `roxira_app_prod` (FastAPI), `roxira_postgres_prod` (DB), `roxira_redis_prod` (Cache), `roxira_qdrant_prod` (Vector DB)
- **منابع فعال:** ۸ گیگابایت Swap دائمی + رم بهینه‌سازی‌شده

## ۳. وضعیت ماژول‌های فعال سازمانی (10 ماژول)
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
  - `iran_laws_bge_m3`: 1,305 رکورد و بردار (بعد ۱۰۲۴)
  - `judicial_precedents`: 0 رکورد و بردار (بعد ۱۰۲۴)
  - `software_factory_code_vectors`: 0 رکورد و بردار (بعد ۱۰۲۴)

## ۵. استراتژی مسیریابی مدل‌های هوش مصنوعی (OpenRouter AI Routing)
- **Tier 0 (کاملاً رایگان):** `openrouter/free`, `z-ai/glm-5.2:free`, `cohere/north-mini-code:free`, `nvidia/nemotron-3-ultra:free`
- **Tier 1 (پیشتازان اقتصادی):** `z-ai/glm-5.3-flash` (Agentic 96%), `deepseek/deepseek-v4-flash-0731`, `google/gemini-3.8-flash`
- **Tier 2 (استدلال عمیق):** `deepseek/deepseek-r1`, `anthropic/claude-3.7-sonnet`

## ۶. اقدامات بعدی برای ادامه توسعه
1. اتصال متدهای ذخیره‌سازی ORM ماژول‌ها به جداول واقعی PostgreSQL.
2. تکمیل پایپ‌لاین گراف دانش Dual-Level با LightRAG برای استخراج روابط میان مواد قانون و آرای قضایی.
3. پیاده‌سازی رابط کاربری داشبورد وب (Single Page Application).
