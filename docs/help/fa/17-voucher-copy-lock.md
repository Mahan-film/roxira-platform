<!-- Sources (origin/main): output_apps/enterprise_hub/modules/accounting/controllers/accounting.controller.ts, output_apps/enterprise_hub/modules/accounting/services/voucher-tools.service.ts, output_apps/enterprise_hub/modules/accounting/dto/copy-journal-entry.dto.ts, output_apps/enterprise_hub/modules/accounting/dto/voucher-state.dto.ts, output_apps/enterprise_hub/migrations/1789900000000-AddJournalEntryVersion.ts, output_apps/enterprise_hub/frontend/src/components/accounting/journal-entries-table.tsx, output_apps/enterprise_hub/frontend/src/components/accounting/journal-entry-form.tsx -->
# کپی سند و قفل ویرایش هم‌زمان

این راهنما دو قابلیت دفتر روزنامه را توضیح می‌دهد: **کپی سند** (ساخت یک پیش‌نویس تازه از روی یک سند موجود) و **قفل ویرایش خوش‌بینانه** (جلوگیری از بازنویسی تغییرات کاربر دیگر).

## کپی سند

از منوی هر ردیف در جدول دفتر روزنامه گزینهٔ **«کپی سند»** را انتخاب کنید. این کار یک سند **پیش‌نویس** تازه در همان سازمان با همان سطرها (حساب، بدهکار، بستانکار، شرح سطر، ارز و بُعدها) و همان شرح می‌سازد و شمارهٔ آن را مسیر عادی ثبت سند تولید می‌کند (مثلاً `SRC-1-COPY`).

نکته‌های مهم:

- سند مبدأ **هرگز** تغییر نمی‌کند و کپی **هرگز** به‌صورت خودکار قطعی نمی‌شود؛ خودتان بعداً می‌توانید آن را ویرایش و قطعی کنید.
- کپی از سند **قطعی** یا **برگشتی** هم مجاز است، اما خروجی همیشه پیش‌نویس است.
- تاریخ کپی به‌صورت پیش‌فرض **امروز** است. اگر تاریخ انتخابی داخل یک **دورهٔ قفل‌شده** یا **سال مالی بسته** باشد، کپی با خطای ۴۲۳ رد می‌شود.
- اگر شناسهٔ سند به سازمان دیگری تعلق داشته باشد، پاسخ ۴۰۴ (یافت نشد) است.

### از طریق API

`POST /enterprise-hub/accounting/journal-entries/:id/copy` با نقش `accounting:create` (حسابدار، مدیر یا مالک).

بدنهٔ اختیاری:

```json
{ "date": "2026-09-11" }
```

اگر `date` نیاید، تاریخ امروز استفاده می‌شود. پاسخ، سند پیش‌نویس تازه با فیلد `version` است.

## قفل ویرایش هم‌زمان

هر سند یک **نسخه** (`version`) دارد که با هر ویرایش یا تغییر وضعیت یک واحد بالا می‌رود. فرم ویرایش نسخه‌ای را که خوانده است در فیلد `expectedVersion` برمی‌گرداند؛ اگر کاربر دیگری در این فاصله سند را ذخیره کرده باشد، نسخه دیگر برابر نیست و سرور ویرایش را **۴۰۹** می‌کند:

> «این سند را کاربر دیگری تغییر داده است؛ صفحه را تازه کنید.»

یعنی هیچ‌وقت تغییرات کاربر دیگر بی‌صدا پاک نمی‌شود و «آخرین نوشتن» برنده نیست. کنترل به‌صورت اتمیک در خود دستور `UPDATE` انجام می‌شود:

```sql
UPDATE fin_journal_entries
   SET ..., version = version + 1
 WHERE id = :id AND tenant_id = :tenantId AND version = :expectedVersion
```

اگر ردیفی به‌روزرسانی نشود، پاسخ ۴۰۹ و پیام بالا برگردانده می‌شود.

### از طریق API

- `PUT /enterprise-hub/accounting/journal-entries/:id` — ویرایش پیش‌نویس یا موقت؛ بدنه می‌تواند `expectedVersion` داشته باشد.
- `POST /enterprise-hub/accounting/journal-entries/:id/status` — تغییر وضعیت؛ بدنه می‌تواند `expectedVersion` داشته باشد.

اگر `expectedVersion` فرستاده نشود (مثلاً فراخوان‌های داخلی)، کنترل نسخه انجام نمی‌شود ولی نسخه همچنان افزایش می‌یابد. در رابط کاربری، فرم ویرایش همیشه نسخهٔ خوانده‌شده را می‌فرستد و در صورت تعارض، پیام ۴۰۹ را نشان می‌دهد.
