<!-- Sources (origin/main): output_apps/enterprise_hub/modules/accounting/controllers/voucher-attachment.controller.ts, output_apps/enterprise_hub/modules/accounting/services/voucher-attachment.service.ts, output_apps/enterprise_hub/modules/accounting/repositories/voucher-attachment.repository.ts, output_apps/enterprise_hub/migrations/1789900000200-CreateJournalEntryAttachments.ts, output_apps/enterprise_hub/frontend/src/components/accounting/voucher-attachments.tsx, output_apps/enterprise_hub/frontend/src/components/accounting/journal-entry-form.tsx -->
# پیوست‌های سند حسابداری

مدارک پشتیبان هر سند (رسید، فاکتور، تصویر یا فایل Excel) را می‌توانید به خود سند پیوست کنید. پیوست‌ها روی **هر وضعیت سند** — از جمله سند قطعی (POSTED) — قابل افزودن‌اند، چون مدارک معمولاً با تأخیر می‌رسند.

## در رابط کاربری
بعد از ثبت یک سند در فرم «ثبت سند دوطرفه»، بخش **«پیوست‌ها»** زیر پیام موفقیت ظاهر می‌شود:

1. **بارگذاری پیوست** — فایل‌های PDF، تصویر (PNG/JPG/WEBP)، Excel (xlsx) و CSV تا سقف **۵ مگابایت** پذیرفته می‌شوند. خطاهای «حجم پیوست بیش از ۵ مگابایت است.» و «نوع پیوست پشتیبانی نمی‌شود (PDF، تصویر، Excel یا CSV).» به فارسی نمایش داده می‌شوند.
2. **دانلود** — فایل با همان بایت‌های بارگذاری‌شده و با نام اصلی (پاک‌سازی‌شده) دانلود می‌شود؛ دانلود همیشه به‌صورت پیوست (attachment) انجام می‌شود و هرگز در مرورگر رندر نمی‌شود.
3. **حذف** — حذف **نرم** است؛ ردیف پیوست حذف فیزیکی نمی‌شود و فقط از فهرست و دانلود کنار می‌رود. اگر تاریخ سند داخل **دورهٔ قفل‌شده** باشد، حذف رد می‌شود.

## از طریق API
همهٔ نقاط پایانی زیر ماژول **حسابداری** (نقش حسابدار) و با شناسهٔ سازمان از توکن فعال‌اند. بارگذاری و حذف به دسترسی `accounting:create` و فهرست/دانلود به `accounting:read` نیاز دارند:

1. `POST /enterprise-hub/accounting/journal-entries/:id/attachments` — بارگذاری پیوست (multipart با فیلد `file`).
2. `GET /enterprise-hub/accounting/journal-entries/:id/attachments` — فهرست پیوست‌های سند.
3. `GET /enterprise-hub/accounting/journal-entries/:id/attachments/:attachmentId/download` — دانلود محتوای فایل.
4. `DELETE /enterprise-hub/accounting/journal-entries/:id/attachments/:attachmentId` — حذف نرم پیوست (در دورهٔ قفل‌شده با خطای ۴۲۳ رد می‌شود).

پیوست همیشه به سند همان آدرس تعلق دارد؛ ترکیب یک شناسهٔ پیوست با سند دیگر — حتی سند معتبر خودِ سازمان — خطای ۴۰۴ می‌دهد. سازمان دیگر روی هیچ‌یک از این مسیرها چیزی نمی‌بیند و پاسخ ۴۰۴ می‌گیرد.
