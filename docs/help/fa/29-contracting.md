<!-- Sources (origin/main):
  output_apps/enterprise_hub/modules/contracting/controllers/contracts.controller.ts
  output_apps/enterprise_hub/modules/contracting/controllers/projects.controller.ts
  output_apps/enterprise_hub/modules/contracting/controllers/statements.controller.ts
  output_apps/enterprise_hub/modules/contracting/controllers/movements.controller.ts
  output_apps/enterprise_hub/modules/contracting/controllers/profitability.controller.ts
  output_apps/enterprise_hub/modules/contracting/dto/contract.dto.ts
  output_apps/enterprise_hub/modules/contracting/enums/contracting.enum.ts
  output_apps/enterprise_hub/frontend/src/app/app/contracting/page.tsx
  output_apps/enterprise_hub/frontend/src/app/app/contracting/contracts/[id]/page.tsx
  output_apps/enterprise_hub/frontend/src/app/app/contracting/profitability/page.tsx
  output_apps/enterprise_hub/frontend/src/lib/contracting-ui.ts
-->

# پیمانکاری: قراردادها، صورت‌وضعیت‌ها و سپردهٔ حسن انجام کار

ماژول پیمانکاری روکسیرا (`/app/contracting`) امکان مدیریت پروژه‌ها، قراردادهای کارفرمایی و پیمانکاری، ثبت صورت‌وضعیت‌های تجمعی، محاسبهٔ خودکار کسورات قانونی و قراردادی (سپردهٔ حسن انجام کار، سپردهٔ بیمه و استهلاک پیش‌پرداخت) و صدور اسناد حسابداری را فراهم می‌کند.

## ۱. تعریف پروژه و قرارداد (`/app/contracting`)

۱. در بخش **«پروژه‌ها»** می‌توانید پروژهٔ جدید با **کد پروژه**، **نام پروژه**، **کد مرکز هزینه** (اختیاری) و **بودجه** ثبت کنید (`POST /enterprise-hub/contracting/projects`). کد مرکز هزینه باید همان کد یک مرکز هزینهٔ تعریف‌شده در حسابداری باشد؛ تطبیق خودکار بر اساس کد پروژه انجام نمی‌شود.
۲. در بخش **«قراردادها»** برای ثبت قرارداد جدید (`POST /enterprise-hub/contracting/contracts`) فیلدهای زیر را وارد کنید:
   - **کد قرارداد (`code`)** و **عنوان قرارداد (`title`)**: کد قرارداد در سطح سازمان یکتا و بدون فاصله است.
   - **نقش سازمان (`side`)**:
     - `employer`: **«ما کارفرما هستیم (پرداخت به پیمانکار)»**
     - `contractor`: **«ما پیمانکار هستیم (صورت‌حساب به کارفرما)»**
   - **کد طرف حساب (`partyCode`)**: کد تفصیلی پیمانکار یا کارفرما.
   - **پروژه (`projectId`، اختیاری)**، **تاریخ قرارداد (`contractDate`)**، **مبلغ قرارداد (`amount`)** و **پیش‌پرداخت توافقی (`advanceAmount`، اختیاری)**.
   - وضعیت قرارداد (`status`) می‌تواند `draft` (پیش‌نویس)، `active` (فعال) یا `closed` (بسته) باشد. قرارداد تازه در وضعیت پیش‌نویس است و با دکمهٔ **«فعال‌سازی قرارداد»** در صفحهٔ جزئیات فعال می‌شود.
   - پس از ایجاد، فیلدهای `code`، `side` و `partyCode` قابل تغییر نیستند (این محدودیت در DTO ویرایش اعمال شده است).

## ۲. ثبت و تأیید صورت‌وضعیت (`/app/contracting/contracts/[id]`)

با کلیک روی کد هر قرارداد در فهرست، صفحهٔ جزئیات قرارداد باز می‌شود. مبلغ قرارداد و پیش‌پرداخت توافقی در بالای صفحه نمایش داده می‌شوند و بخش **«صورت وضعیت‌ها»** فهرست صورت‌وضعیت‌های قرارداد را نشان می‌دهد.

۱. در فرم **«صورت وضعیت جدید»**، **تاریخ صورت‌وضعیت (`statementDate`)** و **مبلغ تجمعی کارکرد تا این صورت‌وضعیت (`cumulativeAmount`)** را وارد کنید. ثبت صورت‌وضعیت از طریق `POST /enterprise-hub/contracting/contracts/:contractId/statements` انجام می‌شود.
۲. سیستم به صورت خودکار مقادیر زیر را محاسبه می‌کند:
   - **کارکرد دوره (`periodAmount`)**: مابه‌التفاوت کارکرد تجمعی جدید و کارکرد تجمعی صورت‌وضعیت قبلی (`previousAmount`).
   - **سپرده حسن انجام کار (`retentionAmount`)**، **سپرده بیمه (`insuranceAmount`)** و **استهلاک پیش‌پرداخت (`advanceRecoveryAmount`)**.
   - **خالص قابل پرداخت (`netPayable`)**.
۳. در بخش **«مبنای محاسبه کسورات»**، نرخ‌های به‌کاررفته در کسورات (`termsUsed`) به همراه برچسب منشأ آن‌ها («مقدار قانونی تأییدشده»، «مقدار ثبت‌شده سازمان (تأیید قانونی نشده)» یا «مقدار ثانویه، هنوز تأیید نشده») نمایش داده می‌شود.
۴. **چرخهٔ وضعیت صورت‌وضعیت**:
   - در وضعیت **پیش‌نویس (`draft`)**: دکمهٔ **«تأیید»** (`POST .../statements/:statementId/approve`) وضعیت را به `approved` تغییر می‌دهد.
   - در وضعیت **تأییدشده (`approved`)**: دکمهٔ **«ثبت سند»** (`POST .../statements/:statementId/post`) سند حسابداری صورت‌وضعیت و کسورات آن را در دفتر کل ثبت کرده، وضعیت را به **ثبت‌شده (`posted`)** تغییر می‌دهد و شمارهٔ سند (`journalEntryNumber`) را نمایش می‌دهد.

## ۳. ثبت پیش‌پرداخت و آزادسازی سپردهٔ حسن انجام کار

در بخش **«پیش‌پرداخت و آزادسازی سپرده»** صفحهٔ جزئیات هر قرارداد دو فرم عملیاتی قرار دارد:

- **ثبت پیش‌پرداخت** (`POST /enterprise-hub/contracting/contracts/:contractId/advances`): با وارد کردن **تاریخ پیش‌پرداخت** و **مبلغ پیش‌پرداخت** (به ریال) و کلیک روی **«ثبت پیش‌پرداخت»**، سند حسابداری پیش‌پرداخت صادر شده و ماندهٔ پیش‌پرداخت مستهلک‌نشدهٔ قرارداد افزایش می‌یابد.
- **آزادسازی سپرده حسن انجام کار** (`POST /enterprise-hub/contracting/contracts/:contractId/retention-releases`): با وارد کردن **تاریخ آزادسازی** و **مبلغ آزادسازی سپرده** و کلیک روی **«آزادسازی سپرده»**، سند حسابداری تسویهٔ سپرده صادر شده و از ماندهٔ سپردهٔ قرارداد کسر می‌شود. این کار معمولاً پس از تحویل موقت یا قطعی انجام می‌شود.

## ۴. گزارش سودآوری پروژه‌ها (`/app/contracting/profitability`)

با کلیک روی دکمهٔ **«سودآوری پروژه‌ها»** در بالای صفحهٔ پیمانکاری (`GET /enterprise-hub/contracting/reports/profitability`)، جدول مقایسه‌ای هر پروژه شامل **بودجه**، **هزینه پیمانکاران**، **هزینه دفتر کل**، **هزینه واقعی**، **باقی‌مانده بودجه**، **صورت‌حساب‌شده** و **حاشیه سود** نمایش داده می‌شود.

- **هزینه دفتر کل** فقط برای پروژه‌ای محاسبه می‌شود که فیلد **کد مرکز هزینه** آن پر باشد و آن مرکز هزینه در حسابداری تعریف شده باشد. اگر پیوند برقرار نباشد، این ستون عبارت «مرکز هزینه تعریف نشده» را نشان می‌دهد.
