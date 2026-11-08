<!-- Sources (origin/main):
  output_apps/enterprise_hub/modules/accounting/controllers/dimension.controller.ts
  output_apps/enterprise_hub/modules/accounting/dto/dimension.dto.ts
  output_apps/enterprise_hub/modules/accounting/services/dimension.service.ts
  output_apps/enterprise_hub/modules/accounting/controllers/reports.controller.ts
  output_apps/enterprise_hub/modules/accounting/services/cost-centre-report.service.ts
  output_apps/enterprise_hub/modules/accounting/dto/report.dto.ts
  output_apps/enterprise_hub/frontend/src/app/app/contracting/page.tsx
  output_apps/enterprise_hub/frontend/src/app/app/contracting/profitability/page.tsx
-->

# مراکز هزینه و پروژه‌ها

در روکسیرا، **مرکز هزینه** (`cost-centers`) و **پروژه** (`projects`) دو بعد تفصیلی شناور مستقل از سرفصل حساب و طرف حساب هستند که امکان ردیابی هزینه‌ها، درآمدها و تراز آزمایشی به تفکیک واحد سازمانی، کارگاه یا پروژه را فراهم می‌کنند.

## ۱. ساختار درختی مراکز هزینه و پروژه‌ها در حسابداری

هر مرکز هزینه و پروژه در ماژول حسابداری دارای مشخصات زیر است (`DimensionController`):

- **کد یکتا (`code`)**: حروف لاتین، اعداد و نویسه‌های `. _ -` (۱ تا ۳۲ نویسه، مانند `CC-100` یا `PRJ-01`). کد پس از ایجاد قابل تغییر نیست.
- **نام (`name`)**: عنوان فارسی مرکز هزینه یا پروژه (تا ۱۶۰ نویسه).
- **کد والد (`parentCode`)**: امکان تعریف ساختار درختی چندسطحی (مثلاً کارخانه ← خط تولید ۱). سیستم هنگام تغییر والد، عدم ایجاد حلقه در درخت را بررسی می‌کند.
- **وضعیت فعال (`isActive`)**: مراکز هزینه و پروژه‌های غیرفعال در فهرست انتخاب اسناد جدید قرار نمی‌گیرند، اما سابقهٔ گردش آن‌ها در گزارش‌ها حفظ می‌شود.
- **فراداده (`metadata`)**: تا ۲۰ کلید/مقدار سفارشی (رشته، عدد، بولین) برای ذخیرهٔ ویژگی‌های تکمیلی.

### مسیرهای API ابعاد شناور
- `GET /enterprise-hub/accounting/cost-centers` و `GET /enterprise-hub/accounting/projects`: دریافت فهرست (با فیلتر `activeOnly=true`).
- `POST /enterprise-hub/accounting/cost-centers` و `POST /enterprise-hub/accounting/projects`: تعریف مرکز هزینه یا پروژهٔ جدید.
- `PATCH /enterprise-hub/accounting/cost-centers/:code` و `PATCH /enterprise-hub/accounting/projects/:code`: ویرایش نام، والد، وضعیت فعال یا فراداده.
- صفحهٔ اختصاصی مدیریت مراکز هزینه و پروژه‌های حسابداری در رابط کاربری: `TODO: not built yet` (هم‌اکنون از طریق API در دسترس است).

## ۲. تخصیص مرکز هزینه و پروژه روی سطرهای سند حسابداری

- هنگام ثبت سند حسابداری، روی هر سطر می‌توان `costCenterCode` و `projectCode` را مشخص کرد.
- اگر روی یک حساب معین در دفتر حساب‌ها، پرچم **«الزام مرکز هزینه»** (`requiresCostCenter`) یا **«الزام پروژه»** (`requiresProject`) فعال شده باشد، ثبت سطر روی آن حساب بدون تعیین مرکز هزینه یا پروژهٔ فعال متناظر رد می‌شود.

## ۳. گزارش تراز آزمایشی به تفکیک مرکز هزینه

مسیر `GET /enterprise-hub/accounting/reports/trial-balance-by-cost-centre` تراز آزمایشی اسناد قطعی‌شده (`POSTED`) را به تفکیک مراکز هزینه برمی‌گرداند:

- **جمع‌زدن درختی (Roll-up)**: بخش مربوط به هر مرکز هزینهٔ والد، گردش خود آن مرکز و تمام مراکز هزینهٔ زیرمجموعه‌اش را تجمیع می‌کند؛ در عین حال در ردیف جمع کل گزارش (`totals`) هر سطر سند فقط یک بار شمرده می‌شود.
- **سطرهای بدون مرکز هزینه**: زمانی که فیلتر `costCenterCode` تعیین نشده باشد، سطرهایی که مرکز هزینه ندارند در بخش جداگانه‌ای با عنوان **«بدون مرکز هزینه»** نمایش داده می‌شوند.
- **پارامترهای فیلتر**: `costCenterCode` (محدود کردن به یک مرکز هزینه و زیرشاخه‌های آن)، `fiscalYearId`، `from`، `to`، `columns` (`2 | 4 | 6 | 8 | 10`، پیش‌فرض `6`)، `level` و `includeClosing`.
- صفحهٔ رابط کاربری تراز آزمایشی به تفکیک مرکز هزینه: `TODO: not built yet` (API گزارش کامل و آماده است).

## ۴. پروژه‌های پیمانکاری و ارتباط با مرکز هزینه

در صفحهٔ **پیمانکاری** (`/app/contracting`) بخش **«پروژه‌ها»** امکان ثبت پروژه‌های اجرایی با فیلدهای **کد پروژه**، **نام پروژه** و **بودجه کل (ریال)** (`POST /enterprise-hub/contracting/projects`) را فراهم می‌کند:

- اگر در حسابداری یک مرکز هزینه با **همان کد پروژه** تعریف شده باشد، در صفحهٔ **سودآوری پروژه‌ها** (`/app/contracting/profitability`) ستون **«هزینه دفتر کل»** به صورت خودکار از گردش اسناد حسابداری آن مرکز هزینه محاسبه و در کنار **«هزینه پیمانکاران»**، **«هزینه واقعی»**، **«باقی‌مانده بودجه»** و **«حاشیه سود»** نمایش داده می‌شود.
- در صورت عدم تعریف مرکز هزینهٔ هم‌کد، در ستون هزینهٔ دفتر کل عبارت «مرکز هزینه تعریف نشده» نمایش داده می‌شود.
