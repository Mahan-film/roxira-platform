<!-- Sources (origin/main):
  output_apps/enterprise_hub/modules/accounting/controllers/dimension.controller.ts
  output_apps/enterprise_hub/modules/accounting/dto/dimension.dto.ts
  output_apps/enterprise_hub/modules/accounting/services/dimension.service.ts
  output_apps/enterprise_hub/modules/accounting/controllers/reports.controller.ts
  output_apps/enterprise_hub/modules/accounting/services/cost-centre-report.service.ts
  output_apps/enterprise_hub/modules/accounting/dto/report.dto.ts
  output_apps/enterprise_hub/modules/contracting/services/profitability.service.ts
  output_apps/enterprise_hub/frontend/src/app/app/contracting/page.tsx
  output_apps/enterprise_hub/frontend/src/app/app/contracting/profitability/page.tsx
-->

# مراکز هزینه و پروژه‌ها

در روکسیرا، **مرکز هزینه** (`COST_CENTER`) و **پروژه** (`PROJECT`) دو بعد تفصیلی شناور مستقل از سرفصل حساب و طرف حساب هستند که امکان ردیابی هزینه‌ها، درآمدها و تراز آزمایشی به تفکیک واحد سازمانی، کارگاه یا پروژه را فراهم می‌کنند.

## ۱. تعریف مرکز هزینه و پروژه در حسابداری

مرکز هزینه و پروژه هر دو با یک مسیر API تعریف می‌شوند (`DimensionController`، بدون صفحهٔ اختصاصی در رابط کاربری):

- **کد یکتا (`code`)**: حروف لاتین، اعداد و نویسه‌های `. _ -` (۱ تا ۳۲ نویسه، مانند `CC-100` یا `PRJ-01`).
- **نام (`name`)**: عنوان فارسی، حداکثر ۱۲۸ نویسه.
- **کد والد (`parentCode`، اختیاری)**: فقط برای **مرکز هزینه** مجاز است و ساختار درختی چندسطحی می‌سازد (مثلاً کارخانه ← خط تولید ۱). برای پروژه ارسال آن با خطای ۴۰۰ رد می‌شود.
- هیچ مسیر ویرایش یا غیرفعال‌سازی (PATCH) برای ابعاد شناور در API وجود ندارد؛ کد تکراری برای همان نوع با خطای ۴۰۹ رد می‌شود.

### مسیرهای API ابعاد شناور
- `GET /enterprise-hub/accounting/dimensions?kind=COST_CENTER` یا `kind=PROJECT` (و `kind=DETAIL` برای تفصیلی شناور): فهرست ابعاد هر نوع.
- `POST /enterprise-hub/accounting/dimensions` با بدنهٔ `{ "kind": "COST_CENTER" | "PROJECT", "code": "...", "name": "...", "parentCode": "..." }` (دسترسی `accounting:create`).
- `GET /enterprise-hub/accounting/dimensions/:kind/balances?from=YYYY-MM-DD&to=YYYY-MM-DD`: گردش و مانده هر بُعد از روی سطرهای اسناد قطعی (`POSTED`) در بازه.

## ۲. تخصیص مرکز هزینه و پروژه روی سطرهای سند حسابداری

- هنگام ثبت سند حسابداری، روی هر سطر می‌توان فیلدهای `costCenterCode` و `projectCode` را مشخص کرد (در API).
- در حال حاضر هیچ قاعدهٔ «الزام مرکز هزینه» یا «الزام پروژه» روی حساب‌های معین وجود ندارد؛ انتخاب مرکز هزینه یا پروژه برای هر سطر اختیاری است.

## ۳. گزارش تراز آزمایشی به تفکیک مرکز هزینه

مسیر `GET /enterprise-hub/accounting/reports/trial-balance-by-cost-centre` تراز آزمایشی اسناد قطعی‌شده (`POSTED`) را به تفکیک مراکز هزینه برمی‌گرداند (API):

- **جمع‌زدن درختی (Roll-up)**: گردش هر مرکز هزینهٔ والد همراه با گردش مراکز هزینهٔ زیرمجموعه‌اش نمایش داده می‌شود.
- **سطرهای بدون مرکز هزینه**: در گزارش با عنوان **«بدون مرکز هزینه»** جدا می‌شوند.
- **پارامترهای فیلتر**: `costCenterCode`، `fiscalYearId`، `from`، `to`، `columns` (`2 | 4 | 6 | 8 | 10`، پیش‌فرض `6`)، `level` و `includeClosing`.
- صفحهٔ رابط کاربری تراز آزمایشی به تفکیک مرکز هزینه: `TODO: not built yet` (API گزارش آماده است).

## ۴. پروژه‌های پیمانکاری و ارتباط با مرکز هزینه

در صفحهٔ **پیمانکاری** (`/app/contracting`) بخش **«پروژه‌ها»** فرم ثبت پروژه با فیلدهای **کد پروژه**، **نام پروژه**، **کد مرکز هزینه** (اختیاری) و **بودجه** دارد و پروژه را با `POST /enterprise-hub/contracting/projects` ذخیره می‌کند.

- پیوند پروژه با حسابداری **صریح** است: کدی که در فیلد **«کد مرکز هزینه»** وارد می‌شود باید همان کد یک مرکز هزینهٔ تعریف‌شده در حسابداری باشد؛ تطبیق خودکار بر اساس کد پروژه انجام نمی‌شود.
- در صفحهٔ **سودآوری پروژه‌ها** (`/app/contracting/profitability`) اگر پروژه به مرکز هزینه پیوند داشته باشد، ستون **«هزینه دفتر کل»** از گردش اسناد حسابداری آن مرکز هزینه محاسبه می‌شود؛ ستون‌های **«هزینه پیمانکاران»**، **«هزینه واقعی»**، **«باقی‌مانده بودجه»** و **«حاشیه سود»** نیز در همان جدول هستند.
- اگر پروژه به مرکز هزینه‌ای پیوند نداشته باشد، در ستون **«هزینه دفتر کل»** عبارت «مرکز هزینه تعریف نشده» نمایش داده می‌شود.
