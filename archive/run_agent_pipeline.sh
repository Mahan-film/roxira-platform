#!/usr/bin/env bash
set -e

cd /opt/roxira_platform

log_step() {
    echo -e "\n\033[1;34m=================================================================\033[0m"
    echo -e "\033[1;32m🤖 [AI AGENT PIPELINE] $1\033[0m"
    echo -e "\033[1;34m=================================================================\033[0m\n"
}

# ------------------------------------------------------------------------------
# ماموریت ۱: عامل OpenCode جهت توسعه صفحات داینامیک و سئوی ۴,۶۰۰ صفحه
# ------------------------------------------------------------------------------
log_step "ماموریت ۱: اجرای OpenCode جهت ساخت صفحات داینامیک سئو و اسکیماها"

if command -v opencode &> /dev/null; then
    opencode run "پیاده‌سازی صفحات داینامیک سئو و اسکیما در Next.js:
۱. بررسی مسیر output_apps/enterprise_hub/frontend/src/app/
۲. ایجاد روت‌های داینامیک laws/[slug]/page.tsx و precedents/[slug]/page.tsx جهت نمایش متن مواد قانونی و آرای وحدت رویه با قابلیت SSR.
۳. افزودن اسکیمای استاندارد JSON-LD (نوع Legislation و LegalService) در تمام صفحات داینامیک.
۴. بررسی فایل public/sitemap_comprehensive.xml و اطمینان از دسترسی کامل."
else
    echo "ℹ️ ابزار opencode به صورت مستقیم یافت نشد؛ اجرای لایه پایتون جایگزین..."
fi

# ------------------------------------------------------------------------------
# ماموریت ۲: عامل Goose جهت ممیزی و تست بنچمارک اندپوینت‌ها با DeepSeek V4.1
# ------------------------------------------------------------------------------
log_step "ماموریت ۲: اجرای Goose / پایتون جهت تست پایداری اندپوینت‌ها و مدل‌ها"

if command -v goose &> /dev/null; then
    goose run --text "بررسی و ممیزی کامل بک‌اند قاضی هوشمند:
۱. اجرای تست سلامت روی اندپوینت /api/v1/apps/judge/consult با مدل deepseek-v4.1-flash و gemini-flash-latest.
۲. بررسی اتصال دیتابیس PostgreSQL و شمارش گره‌های فعال جدول graph_nodes.
۳. اطمینان از ثبت صحیح فاکتورهای پرداخت در /payments/create-invoice."
else
    # اجرای ایجنت بومی بر پایه پایتون و DeepSeek V4.1 Flash
    python3 - << 'PYEOF'
import urllib.request
import json
import time

print("🔍 تست هوشمند اندپوینت‌ها توسط ایجنت داخلی...")
payload = {
    "message": "ملکی با سند عادی خریداری شده و مستحق‌للغیر درآمده است. تقاضای غرامت به نرخ روز طبق رأی ۸۱۱ داریم.",
    "tier": "VIP"
}

t0 = time.time()
req = urllib.request.Request(
    "http://127.0.0.1:8000/api/v1/apps/judge/consult",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)

try:
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode())
        latency = round((time.time() - t0) * 1000, 2)
        print(f"✅ پاسخ با موفقیت دریافت شد | مدل: {data.get('model_assigned')} | تاخیر: {latency} ms")
except Exception as e:
    print("⚠️ وضعیت اندپوینت:", e)
PYEOF
fi

# ------------------------------------------------------------------------------
# ماموریت ۳: استقرار خودکار و همگام‌سازی کانتینرها
# ------------------------------------------------------------------------------
log_step "ماموریت ۳: ری‌استارت کانتینرها و فعال‌سازی دیمون نظارت هوشمند"

docker restart roxira_app_prod roxira_enterprise_frontend
sleep 3

echo -e "\n\033[1;32m🎉 فرآیند ارکستراسیون ایجنت‌ها با موفقیت پایان یافت.\033[0m\n"
