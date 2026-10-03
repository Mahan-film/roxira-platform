# Project plan: [بریف] میکروسایت ایستا پرسش‌های متداول حقوقی فارسی

Approved stack option: **گزینه توصیه‌شده در هر لایه (پیش‌فرض)**

8 task(s), dependency-resolved build order:

1. **task 0: Scaffold static Next.js app with RTL Tailwind and Vazirmatn** (depends on: none)
   - est. change size: ~180 lines
   - راه‌اندازی پروژه Next.js با خروجی ایستا، Tailwind، فونت وزیرمتن و پشتیبانی راست‌به‌چپ و حالت تیره/روشن.
2. **task 1: Define FAQ content schema and Markdown loader** (depends on: task 0)
   - est. change size: ~150 lines
   - تعریف ساختار داده پرسش‌ها و بارگذار محتوای Markdown در زمان ساخت.
3. **task 2: Author the 10 Persian legal FAQ Markdown entries** (depends on: task 1)
   - est. change size: ~120 lines
   - نوشتن ۱۰ پرسش و پاسخ حقوقی فارسی با ارجاع قانونی و هشدار عدم قطعیت.
4. **task 3: Build FAQ list and detail components with disclaimer** (depends on: task 2)
   - est. change size: ~170 lines
   - ساخت کامپوننت‌های فهرست و جزئیات پرسش‌ها همراه با هشدار عدم قطعیت مشاوره حقوقی.
5. **task 4: Add in-page client-side search filter** (depends on: task 3)
   - est. change size: ~140 lines
   - افزودن جستجوی ساده درون‌صفحه‌ای با نرمال‌سازی متن فارسی.
6. **task 5: Add per-question static routes and metadata** (depends on: task 3)
   - est. change size: ~130 lines
   - ساخت صفحه ایستا برای هر پرسش با متادیتای اختصاصی.
7. **task 6: Add Playwright tests for search and Persian rendering** (depends on: task 4, task 5)
   - est. change size: ~180 lines
   - افزودن تست‌های Playwright برای جستجو و نمایش صحیح فارسی و راست‌به‌چپ.
8. **task 7: Add GitHub Pages static deploy workflow** (depends on: task 6)
   - est. change size: ~120 lines
   - افزودن گردش‌کار استقرار خودکار روی GitHub Pages همراه با اجرای تست‌ها.
