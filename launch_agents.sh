#!/usr/bin/env bash
set -e

# لود کلیدهای محیطی
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "=================================================="
echo "🚀 راه‌اندازی مرکز فرماندهی ایجنت‌های روکسیرا (2026)"
echo "=================================================="
echo "1) اجرای OpenCode TUI (با مدل DeepSeek V4.1 Flash)"
echo "2) اجرای Aider (با مدل فوق‌سریع Gemini 3.8 Flash)"
echo "3) اجرای تست تایپ‌اسکریپت و کامپایل پایتون"
echo "4) ارسال تغییرات به سرور و دیپلوی بدون خاموشی"
echo "=================================================="
read -p "گزینه مورد نظر را انتخاب کنید [1-4]: " choice

case $choice in
  1)
    echo "⚡ اجرای OpenCode..."
    opencode --model openrouter/deepseek/deepseek-v4.1-flash
    ;;
  2)
    echo "⚡ اجرای Aider..."
    aider --model openrouter/google/gemini-3.8-flash \
          --editor-model openrouter/deepseek/deepseek-v4.1-flash \
          --no-auto-commits
    ;;
  3)
    echo "🔍 تست تایپ‌اسکریپت..."
    (cd output_apps/enterprise_hub/frontend && npx tsc --noEmit)
    echo "🔍 تست پایتون..."
    python3 -m py_compile output_apps/generated_modules/smartjudge/smartjudge_module.py
    echo "✅ تمام تایپ‌ها و فایل‌ها بدون ارور کامپایل شدند."
    ;;
  4)
    read -p "پیام کامیت: " msg
    git add -A
    git commit -m "$msg"
    git push origin main
    echo "🚀 اعمال تغییرات روی سرور..."
    ssh "${ROXIRA_HOST:-roxira-prod}" "cd /opt/roxira_platform && git pull origin main && docker compose -f docker-compose.prod.yml restart enterprise_app roxira_enterprise_frontend"
    echo "✅ سامانه با موفقیت همگام شد."
    ;;
  *)
    echo "گزینه نامعتبر است."
    ;;
esac
