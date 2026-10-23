# Moadian E-Invoice Requirements (2026-10-14)

Date: 2026-10-14
Source: **Gemini app output** (owner Pro account), round-2 report
`docs/gemini_out/round2/GEMINI_ROUND2_REPORT_2026-10-14.md`, section «بخش ب» plus the
bylaw 2/153304 table from the «اجرای کار دوم» section 2.
Status: **unverified**. This is AI-generated legal/technical research, not a substitute for
the official texts. Every «منبع یافت نشد» / «نیازمند بررسی» mark is preserved verbatim.
**Pricing decisions are the owner's** — this document contains no pricing recommendation.

## 1. Governing laws and scope

بررسی قوانین پایه حاکم بر زیست‌بوم مالیاتی کشور—شامل «قانون پایانه‌های فروشگاهی و سامانه
مؤدیان»، «قانون تسهیل تکالیف مؤدیان جهت اجرای قانون پایانه‌های فروشگاهی و سامانه مؤدیان»،
«قانون مالیات بر ارزش افزوده دائمی مصوب ۱۴۰۰» و «آیین‌نامه اجرایی ماده ۹۵ ق.م.م به شماره
۲/۱۵۳۳۰۴ مورخ ۱۴۰۴/۰۸/۲۱»—نشان می‌دهد که ثبت معاملات خرید و فروش در سامانه مؤدیان، به موجب
ماده ۱۳ قانون مالیات بر ارزش افزوده دائمی، «به منزله ثبت در دفاتر قانونی است». با این حال،
برای پوشش کامل رویدادهای مالی و دوره اجرای مرحله‌ای (موضوع بخشنامه ۲۰۰/۵۱۳۳۰)، کلیه اشخاص
حقوقی و صاحبان مشاغل گروه اول (دارای فروش کالا یا فعالیت توأم بیش از ۴۵ میلیارد تومان طبق
مصوبه ۲/۱۵۳۳۰۴) مکلفند اطلاعات رویدادهای مالی خود را به صورت شش‌ماهه و تا پیش از انقضای
مهلت تسلیم اظهارنامه موضوع مواد ۱۰۰ و ۱۱۰ ق.م.م در «سامانه دفاتر تجاری الکترونیکی» بارگذاری
نمایند.

## 2. Invoice types (1 / 2 / 3)

از منظر دسته‌بندی انواع صورتحساب الکترونیکی، مقررات سامانه مؤدیان و آیین‌نامه شماره
۲/۱۵۳۳۰۴ سه نوع صورتحساب را تفکیک کرده‌اند:

- **نوع اول (B2B):** شامل اطلاعات کامل فروشنده، اطلاعات هویتی و اقتصادی خریدار و مشخصات
  کامل کالا و خدمات است. طبق تصریح آیین‌نامه جدید ماده ۹۵ ق.م.م، در تمامی معاملاتی که
  خریدار «مصرف‌کننده نهایی» نباشد (معاملات تجاری B2B برای بهره‌مندی خریدار از اعتبار مالیاتی
  ارزش افزوده و هزینه قابل قبول مالیاتی)، صدور صورتحساب الکترونیکی نوع اول الزامی است
  (جزئیات فنی الگوهای زیرمجموعه نوع اول نظیر الگوی فروش، طلا و جواهر، پیمانکاری، بلیط
  هواپیما، قبوض و صادرات: نیازمند بررسی).
- **نوع دوم (B2C):** ناظر بر فروش کالا و خدمات به مصرف‌کننده نهایی بدون درج اطلاعات هویتی
  خریدار است.
- **نوع سوم (B2C / رسید پرداخت):** به موجب نص صریح آیین‌نامه شماره ۲/۱۵۳۳۰۴، همان «رسید
  پرداخت وجه» صادره از دستگاه کارتخوان بانکی (POS) و یا درگاه الکترونیکی پرداخت است که
  صرفاً برای فروش به مصرف‌کننده نهایی کفایت می‌کند.

همچنین در شرایط بروز حادثه یا تعذر فنی صدور صورتحساب الکترونیکی، طبق فصل چهارم آیین‌نامه
شماره ۲/۱۵۳۳۰۴، مؤدی می‌تواند درخواست افزایش «شماره منحصربه‌فرد مالیاتی در اختیار» را از
طریق کارپوشه یا شرکت معتمد به سازمان ارائه دهد و آن شماره را بر روی صورتحساب کاغذی منطبق با
اقلام الکترونیکی درج کند تا پس از رفع مانع، نسبت به ثبت و ارسال آن‌ها در سامانه اقدام گردد.

## 3. CSR / key flow and trusted company vs direct sending

در لایه فنی و حقوقی اتصال نرم‌افزار به سامانه مؤدیان، رعایت تمایز میان «ارسال مستقیم با کلید
اختصاصی مؤدی» و «ارسال از طریق شرکت معتمد» از اهمیت حیاتی برخوردار است.

**جریان فنی (CSR و کلید):** پیش‌نیاز برقراری ارتباط با درگاه تبادل اطلاعات سازمان امور
مالیاتی، تولید گواهی امضای دیجیتال (CSR) و زوج کلید نامتقارن (کلید خصوصی و کلید عمومی)،
بارگذاری کلید عمومی در کارپوشه مؤدی جهت دریافت «شناسه یکتای حافظه مالیاتی» (۶ کاراکتری) و
استفاده از «شناسه کالا و خدمات» (۱۳ رقمی) برای امضا و ارسال بسته‌های صورتحساب و سپس استعلام
وضعیت (Inquiry) است (لینک مستقیم مستندات فنی API، ساختار توکن و جدول کدهای وضعیت در درگاه
رسمی tp.tax.gov.ir: منبع یافت نشد / نیازمند بررسی).

**ارسال مستقیم در برابر شرکت معتمد:** از نظر حقوقی، یک شرکت نرم‌افزاری (Software Vendor)
بدون داشتن مجوز رسمی «شرکت معتمد ارائه‌دهنده خدمات مالیاتی» می‌تواند ماژول فنی ارسال مستقیم
را در درون نرم‌افزار ERP/حسابداری خود تعبیه کند، به شرط آنکه هر مشتری کلید خصوصی اختصاصی و
شناسه حافظه مالیاتی خود را در نرم‌افزار بارگذاری نماید تا صورتحساب‌ها مستقیماً از جانب خود
مؤدی امضا و ارسال شوند؛ در حالی که ارسال صورتحساب به نیابت از مشتریان با کلید امضای شرکت
ثالث، منحصراً در صلاحیت شرکت‌های معتمد دارای پروانه رسمی از مرکز تنظیم مقررات سازمان امور
مالیاتی است (جزئیات آیین‌نامه اجرایی شرکت‌های معتمد: نیازمند بررسی).

## 4. Mandatory invoice fields checklist

چک‌لیست اقلام اطلاعاتی الزامی صورتحساب الکترونیکی بر اساس مستندات موجود:

| دسته اطلاعاتی | عنوان فیلد / قلم اطلاعاتی | وضعیت در صورتحساب نوع اول (B2B) | وضعیت در صورتحساب نوع دوم / سوم (B2C) | وضعیت مستندسازی در منابع |
| --- | --- | --- | --- | --- |
| شناسه‌های کنترلی سامانه | شماره منحصربه‌فرد مالیاتی (شامل شناسه یکتای حافظه مالیاتی، تاریخ و سریال داخلی) | الزامی | الزامی | تاییدشده در آیین‌نامه ۲/۱۵۳۳۰۴؛ ساختار بیت‌به‌بیت: نیازمند بررسی |
| اطلاعات زمانی و الگو | تاریخ و زمان صدور صورتحساب، نوع صورتحساب (۱، ۲ یا ۳) و الگوی صورتحساب | الزامی | الزامی | تاییدشده |
| اطلاعات فروشنده | نام، نشانی، شماره اقتصادی / شناسه ملی فروشنده | الزامی | الزامی | تاییدشده |
| اطلاعات خریدار | نوع خریدار (حقیقی/حقوقی/مدنی/اتباع)، شماره اقتصادی، شناسه ملی / کد ملی و کد پستی خریدار | الزامی (جهت پذیرش اعتبار مالیاتی خریدار) | عدم درج در نوع دوم و سوم (مختص مصرف‌کننده نهایی) | تاییدشده در آیین‌نامه ۲/۱۵۳۳۰۴ |
| اقلام کالا و خدمت | شناسه کالا/خدمت، شرح کالا یا خدمت، واحد اندازه‌گیری، مقدار/تعداد، مبلغ واحد، تخفیف، نرخ و مبلغ مالیات بر ارزش افزوده | الزامی | الزامی در نوع دوم (در نوع سوم صرفاً مبلغ کل رسید پرداخت درج می‌شود) | تاییدشده؛ جدول کامل کدهای واحد اندازه‌گیری: نیازمند بررسی |
| اطلاعات مالی و تسویه | مجموع مبلغ قبل از کسر تخفیف، مجموع تخفیفات، مجموع مالیات و عوارض ارزش افزوده، مجموع کل صورتحساب و روش تسویه (نقدی / نسیه) | الزامی | الزامی | تاییدشده؛ فیلدهای تکمیلی تسویه نسیه: نیازمند بررسی |

## 5. Bylaw 2/153304 (آیین‌نامه تحریر دفاتر — اصلاحیه ۱۴۰۴/۰۸/۲۱)

این سند، «اصلاحیه آیین‌نامه مربوط به نوع دفاتر، اسناد و مدارک و روش‌های نگهداری و نمونه
اظهارنامه مالیاتی و نحوه ارائه برای رسیدگی و تشخیص درآمد مشمول مالیات موضوع ماده ۹۵ قانون
مالیات‌های مستقیم (آیین‌نامه تحریر دفاتر)» است که طی نامه شماره ۲/۱۵۳۳۰۴ مورخ ۱۴۰۴/۰۸/۲۱
توسط وزیر امور اقتصادی و دارایی تصویب و طی بخشنامه شماره ۲۱۰/۱۴۸۹۹/ص مورخ ۱۴۰۴/۰۸/۲۱ توسط
سرپرست معاونت تحول هوشمند نظام مالیاتی ابلاغ گردیده است. نسخه جامع و لازم‌الاجرا از ابتدای
سال مالی ۱۴۰۴/۰۱/۰۱، مصوبه مورخ ۱۴۰۴/۰۸/۲۱ است.

| محور قانونی در آیین‌نامه ۲/۱۵۳۳۰۴ | شماره ماده / فصل در آیین‌نامه | حکم دقیق قانونی و ضوابط اجرایی مستخرج | وضعیت اعتبارسنجی (needs_review) |
| --- | --- | --- | --- |
| تعاریف و اشخاص مشمول گروه اول بر اساس نوع فعالیت | فصل اول (ماده ۱ و ماده ۲) | کلیه واردکنندگان و صادرکنندگان، صاحبان کارخانه‌ها و واحدهای تولیدی و بهره‌برداران معادن دارای پروانه بهره‌برداری از وزارتخانه یا مراجع ذی‌ربط، فارغ از حجم درآمد، در زمره مؤدیان ملزم به رعایت تکالیف مربوط قرار می‌گیرند. | معتبر؛ نیازمند متن کامل سایر بندهای ماده ۲ (true) |
| نصاب ریالی گروه‌بندی صاحبان مشاغل (از ابتدای ۱۴۰۴/۰۱/۰۱) | ماده ۲ (اصلاحی ۱۴۰۴/۰۸/۲۱) | بر اساس اصلاحیه شماره ۲/۱۵۳۳۰۴ (لازم‌الاجرا از ۱۴۰۴/۰۱/۰۱)، نصاب قرارگیری صاحبان مشاغل در گروه اول برای فروش کالا یا فعالیت توأم (کالا و خدمت)، مبلغ بیش از ۴۵٬۰۰۰٬۰۰۰٬۰۰۰ تومان (۴۵۰ میلیارد ریال) تعیین گردیده است. | معتبر برای گروه اول؛ نیازمند جدول کامل نصاب گروه دوم و سوم (true) |
| اقلام اطلاعاتی اظهارنامه و حساب‌های بانکی | فصل سوم (بند د و تبصره‌ها) | درج اطلاعات حساب‌های بانکی مربوط به فعالیت شغلی الزامی است. طبق تبصره، چنانچه هر یک از اقلام اطلاعاتی فرم اظهارنامه اشخاص حقوقی و صاحبان مشاغل برای مؤدی فاقد موضوعیت باشد، عدم تکمیل آن خللی به اعتبار اظهارنامه وارد نمی‌کند. همچنین تسلیم اظهارنامه در اجرای ماده ۱۷۸ ق.م.م پذیرفته می‌شود و سازمان در موارد مقتضی می‌تواند اظهارنامه غیرالکترونیکی را نیز بپذیرد. | معتبر (false) |
| روش‌های نگهداری دفاتر دستی (کاغذی) | فصل چهارم (ماده ۵ و بند الف-۱ ماده ۶) | صاحبان مشاغل گروه اول و کلیه اشخاص حقوقی مکلف به نگهداری دفاتر روزنامه و کل (دستی یا الکترونیکی) متکی به اسناد و مدارک هستند. ضوابط دفاتر دستی: عدم ارائه دستورالعمل یا عدم امکان دسترسی به اطلاعات در حکم عدم تسلیم دفاتر است؛ نگهداری دفتر روزنامه واحد یا دفاتر روزنامه متعدد مجاز است؛ اشتباه در شماره‌گذاری صفحات و اشتباهات ثبت در مراجع قانونی در صورت احراز، مخل اعتبار دفاتر نیست؛ نوشتن با وسایل قابل محو مانند مواد گرافیتی ممنوع است؛ تحریر باید به زبان فارسی و واحد پول رایج کشور باشد؛ تأخیر در تحریر دفاتر اشخاص حقوقی جدیدالتأسیس از تاریخ ثبت و سایر اشخاص از تاریخ شروع فعالیت تا ۲ ماه مجاز است؛ و ارائه دفاتر سفید و نانویس یا پلمب‌نشده در حکم عدم ارائه دفاتر است. | معتبر (false) |
| ضوابط و مواعد بارگذاری دفاتر تجاری الکترونیکی | فصل چهارم (بند الف-۲ ماده ۶) | مؤدیان مکلفند اطلاعات رویدادهای مالی خود را مطابق نمونه اعلامی سازمان در سامانه دفاتر تجاری الکترونیکی بارگذاری کنند: برای دوره اول، حداکثر تا پایان آذرماه سال ۱۴۰۴ و یا ۴ ماه پس از انقضای مهلت تسلیم اظهارنامه مالیاتی موضوع مواد ۱۰۰ و ۱۱۰ ق.م.م (هر کدام که مؤخر باشد)؛ و برای سال مالی که شروع آن در سال ۱۴۰۴ باشد، به صورت شش‌ماهه (مطابق دوره‌های مالی شش‌ماهه) و ثبت اطلاعات تا قبل از انقضای مهلت تسلیم اظهارنامه مالیاتی موضوع مواد ۱۰۰ و ۱۱۰ قانون. همچنین عدم بارگذاری و تسلیم به موقع بخشی از اطلاعات دفاتر الکترونیکی در حکم عدم ارائه دفاتر محسوب نمی‌شود. | معتبر (false) |
| انواع صورتحساب الکترونیکی و ارتباط با دفاتر قانونی | ماده ۷ و مقررات مرتبط | ثبت معاملات (خرید و فروش) در سامانه مؤدیان به منزله ثبت در دفاتر قانونی است. صورتحساب الکترونیکی نوع سوم همان «رسید پرداخت وجه» صادره از دستگاه کارتخوان بانکی (POS) یا درگاه پرداخت الکترونیکی است؛ اما در صورتی که خریدار «مصرف‌کننده نهایی» نباشد، صدور صورتحساب الکترونیکی نوع اول الزامی است. در صورت عدم امکان صدور صورتحساب الکترونیکی، مؤدی می‌تواند درخواست افزایش شماره منحصربه‌فرد مالیاتی در اختیار را از طریق کارپوشه یا شرکت معتمد ارائه دهد تا روی صورتحساب کاغذی منطبق با اقلام الکترونیکی درج و سپس در سامانه ثبت شود. | معتبر (false) |
| تغییر گروه مؤدیان توسط سازمان امور مالیاتی | مقررات عمومی آیین‌نامه | سازمان امور مالیاتی می‌تواند تمام یا برخی از مؤدیان موضوع این آیین‌نامه را طبق اعلام کتبی به مؤدی ذی‌ربط حداکثر تا ۶ ماه پس از پایان هر سال مالیاتی جهت اجرا از ابتدای سال مالی بعد ملزم به رعایت تکالیف گروه بالاتر نماید. | معتبر (false) |

## 6. 21-day rule and e-ledger upload deadlines

- **۲۱ روز:** بر اساس اطلاعیه‌های شماره ۲۲ و ۲۶ مرکز تنظیم مقررات، نظام پایانه‌های فروشگاهی
  و سامانه مؤدیان (به شماره‌های ۲۶۸/۸۵۵۳۴/د و ۲۶۸/۹۰۰۷۸/د مورخ ۱۴۰۲/۱۲/۲۶)، مهلت مجاز میان
  تاریخ صدور صورتحساب الکترونیکی تا ثبت آن در سامانه مؤدیان **۲۱ روز** تعیین شده است؛ حکمی
  که شکایت ابطال آن نیز طی دادنامه شماره ۱۴۰۴۳۱۳۹۰۰۰۰۷۰۸۱۲۳ مورخ ۱۴۰۴/۰۳/۲۰ هیئت تخصصی
  مالیاتی، بانکی دیوان عدالت اداری رد شده و اعتبار قانونی آن تثبیت گردیده است (آخرین
  بخشنامه‌های تمدید مواعد و بخشودگی جرائم ماده ۲۲ قانون پایانه‌های فروشگاهی و مواد ۳۶ و ۳۷
  قانون ارزش افزوده در سال ۱۴۰۵: نیازمند بررسی).
- **دفاتر تجاری الکترونیکی:** برای دوره اول، حداکثر تا پایان آذرماه ۱۴۰۴ یا ۴ ماه پس از
  انقضای مهلت تسلیم اظهارنامه موضوع مواد ۱۰۰ و ۱۱۰ ق.م.م (هر کدام مؤخر باشد)؛ برای سال
  مالی آغازشده در ۱۴۰۴، بارگذاری شش‌ماهه و ثبت اطلاعات تا قبل از انقضای مهلت تسلیم
  اظهارنامه موضوع مواد ۱۰۰ و ۱۱۰ قانون (بند الف-۲ ماده ۶ آیین‌نامه ۲/۱۵۳۳۰۴).

## 7. Gap vs our code

Read-only review of `output_apps/enterprise_hub/modules/tax_compliance/` (and the
`invoicing/` entities it consumes). The module implements the **direct-send cryptographic
core** (RSA keypair, CSR, JWS signature, 22-digit local TaxID) but **not** the official
Moadian wire format or any live integration. No code was changed.

### 7.1 What we already have

| Requirement / flow | Status | Evidence |
| --- | --- | --- |
| RSA signing keypair (2048-bit default) | Implemented | `services/tax-compliance.service.ts:143-167`, `:192-199`; `constants/tax-compliance.constants.ts:25` |
| CSR generation (PKCS#10, RSA-SHA256) | Implemented | `services/tax-compliance.service.ts:208-249`; `utils/csr.util.ts:173-204`; `dto/generate-csr.dto.ts:10-28` |
| Certificate subject fields (CN, O, OU, C, state, locality, serial, email) | Implemented | `dto/certificate-subject.dto.ts:8-62`; `utils/csr.util.ts:13-22` |
| Invoice data hash (SHA-256) | Implemented | `services/tax-compliance.service.ts:286-289` |
| JWS RS256 signature + verification | Implemented | `services/tax-compliance.service.ts:365-369`, `:522-542`; `utils/jws.util.ts:45-70` |
| 22-digit TaxID (locally derived) | Implemented (format differs, see 7.2) | `services/tax-compliance.service.ts:295-307`; `constants/tax-compliance.constants.ts:10` |
| Seller name / nationalId / economicCode | Implemented | `invoicing/entities/invoice.entity.ts:16-24`; canonical packet `services/tax-compliance.service.ts:259-263` |
| Buyer name / nationalId / economicCode | Implemented | `invoicing/entities/invoice.entity.ts:16-24`; canonical packet `services/tax-compliance.service.ts:264-268` |
| Item description, quantity, unitPrice, discount, tax amount, total | Implemented | `invoicing/entities/invoice.entity.ts:30-37`; canonical packet `services/tax-compliance.service.ts:269-276` |
| Totals: totalAmount, totalDiscount, totalTax, finalPayable | Implemented | `invoicing/entities/invoice.entity.ts:74-84`; canonical packet `services/tax-compliance.service.ts:277-282` |
| Issue timestamp | Implemented | `services/tax-compliance.service.ts:348`, `:374` |
| Submission status lifecycle (SIGNED/PREPARED/SENT/ACCEPTED/REJECTED) | Implemented (enum only) | `enums/tax-compliance.enum.ts:21-27` |
| Local reference number for a prepared packet | Implemented | `services/tax-compliance.service.ts:444-457` |
| Direct send with taxpayer's own private key (per-request PEM) | Implemented | `services/tax-compliance.service.ts:329-344`; `dto/sign-invoice.dto.ts:35-44` |
| QR verification payload | Implemented (local URL) | `services/tax-compliance.service.ts:349`, `:544-553` |

### 7.2 What is missing

| Requirement / flow | Status | Note / where it should live |
| --- | --- | --- |
| Official TaxID structure (شناسه یکتای حافظه مالیاتی ۶ کاراکتری + تاریخ + سریال داخلی) | Missing | Our TaxID is a SHA-256-derived 22-digit number (`services/tax-compliance.service.ts:295-307`), not the official composite. No field stores the 6-char memory ID. |
| Invoice type (۱ / ۲ / ۳) and invoice pattern (الگو) | Missing | No enum/field anywhere in `tax_compliance/` or `invoicing/entities/invoice.entity.ts`. |
| شناسه کالا/خدمت (۱۳ رقمی) per item | Missing | Not present in `InvoiceItem` (`invoicing/entities/invoice.entity.ts:30-37`). |
| واحد اندازه‌گیری (unit of measure) per item | Missing | Same entity, no unit field. |
| Separate tax **rate** (نرخ) vs tax amount | Missing | Only `tax` amount exists (`invoicing/entities/invoice.entity.ts:35`). |
| Buyer type (حقیقی/حقوقی/مدنی/اتباع) | Missing | `InvoicePartyInfo` has no party-type field (`invoicing/entities/invoice.entity.ts:16-24`). |
| Buyer postal code (کد پستی) | Missing | Only free-text `address` exists (`invoicing/entities/invoice.entity.ts:22`). |
| Payment method (نقدی / نسیه) | Missing | No settlement-method field in entity or canonical packet. |
| Seller address in signed packet | Partial | Address is stored (`invoicing/entities/invoice.entity.ts:22`) but omitted from the canonical/signed packet (`services/tax-compliance.service.ts:259-263`). |
| Upload public key to کارپوشه / obtain 6-char memory TaxID | Missing | No flow or endpoint. |
| Live Moadian API send + status Inquiry (tp.tax.gov.ir) | Missing | `submitSignature` is local-only and never sets ACCEPTED (`services/tax-compliance.service.ts:413-442`; `controllers/tax-compliance.controller.ts:142-158`). |
| Trusted-company (شرکت معتمد) proxy sending | Missing | Only direct-send with the taxpayer's own key is supported. |
| 21-day issuance-to-registration deadline tracking | Missing | No deadline/aging logic in the module. |
| E-ledger (دفاتر تجاری الکترونیکی) six-month upload | Missing | No module or flow exists for e-ledger export/upload. |
| Predefined Moadian status codes / response mapping | Missing | Only a 5-value internal enum (`enums/tax-compliance.enum.ts:21-27`); no official code table. |

## 8. Wire format (API v2) and implementation — 2026-10-22

Implemented behind `MOADIAN_ENABLED=false` in
`output_apps/enterprise_hub/modules/tax_compliance/` (Moadian* files). This section records
the wire format the code follows, where it comes from, and what is still unverified.

### 8.1 Sources and confidence

The official INTAMEDIA documents («دستورالعمل فنی نحوه اتصال به سامانه مودیان» and the
error-code PDF) are only hosted on Iranian hosts (tax.gov.ir, intamedia.ir, rahrokh.com,
bodjex.ir, finto.ir, karlancer.com), which were **not reachable** from the build environment.
The format below was therefore taken from **three independent public SDKs that agree with
each other**, read as source code:

| Source | What it gave |
| --- | --- |
| npm `@paybuy/moadian-sdk` 0.3.14 (`dist/moadian.sdk.js`, `utils/*.js`, `interface/*.d.ts`, `enum/*.d.ts`) — https://www.npmjs.com/package/@paybuy/moadian-sdk | v2 endpoints, JWS/JWE headers, packet field names, enum codes, inquiry response shape |
| npm `taxapi` 1.1.0 (`dist/v1/utils/taxid.js`, `verhoeff.js`) — https://www.npmjs.com/package/taxapi | tax ID layout, Verhoeff control string; sandbox/production base URLs |
| PyPI `moadian` 1.0.4 (`src/moadian/utils.py`, `verhoeff.py`) — https://pypi.org/project/moadian/ | tax ID layout (independent Python implementation; used to compute our test vectors) |
| GitHub PR describing the same layout — https://github.com/masein/accounting-assistant-web/pull/131 | confirms memory id (6) + hex days (5) + hex serial (10) + Verhoeff |
| Verhoeff algorithm — https://en.wikipedia.org/wiki/Verhoeff_algorithm | tables; textbook vectors `236→3`, `12345→1` |
| RFC 7515 (JWS), RFC 7516 (JWE) | compact serialisation, JWE AAD = ASCII(BASE64URL(protected header)) |

Items marked **UNVERIFIED** below should be checked against the official PDF before
`MOADIAN_ENABLED=true` in production.

### 8.2 Base URLs and endpoints

- Sandbox: `https://sandboxrc.tax.gov.ir/requestsmanager/api/v2` (our default, `MOADIAN_BASE_URL`).
- Production: `https://tp.tax.gov.ir/requestsmanager/api/v2`.
- The older v1 API (`/req/api/self-tsp/sync/GET_TOKEN`, packet with `uid/packetType/retry/data/encryptionKeyId/symmetricKey/iv`) is **not** used.

| Call | Method / path | Auth |
| --- | --- | --- |
| Nonce | `GET /nonce?timeToLive=20` → `{nonce, expDate}` | none |
| Server info (tax org encryption key) | `GET /server-information` → `{serverTime, publicKeys:[{id, key, algorithm:'RSA', purpose:1}]}` | Bearer |
| Send | `POST /invoice` body `[{payload: <JWE>, header: {requestTraceId: <uid>, fiscalId: <memoryId>}}]` → `{timestamp, result:[{uid, referenceNumber, …}]}` | Bearer |
| Inquiry | `GET /inquiry-by-reference-id?referenceIds=…` or `GET /inquiry-by-uid?uidList=…&fiscalId=…` → `[{referenceNumber, uid, status, data:{error[], warning[], success}}]` | Bearer |
| Other (not used yet) | `/inquiry`, `/fiscal-information?memoryId=`, `/taxpayer?economicCode=` | Bearer |

Errors on non-2xx: `{timestamp, requestTraceId, errors:[{errorCode, detail}]}`. Our client treats
5xx/429/network as retryable (BullMQ backoff) and 4xx as a final `FAILED`.

### 8.3 Token

`Authorization: Bearer <JWS>` where the JWS payload is `{nonce, clientId: <memoryId>}`
(direct sending; a trusted company would use its own client id — **not implemented**).
A fresh nonce is fetched for every authenticated call.

### 8.4 JWS (signature) and JWE (encryption)

- JWS compact, protected header
  `{"alg":"RS256","typ":"jose","x5c":[<cert base64 DER>],"sigT":"YYYY-MM-DDTHH:mm:ssZ","crit":["sigT"],"cty":"text/plain"}`,
  payload = `JSON.stringify(packet)`. Same header for the token and the invoice.
  **UNVERIFIED:** whether `typ` must be `jose` (lower case) — all SDKs use it.
- JWE compact over the JWS string: `{"alg":"RSA-OAEP-256","enc":"A256GCM","kid":<publicKeys[0].id>}`,
  key = `publicKeys[0].key` (base64 SPKI). Implemented with Node `crypto` only
  (`utils/moadian-jose.util.ts`), no new dependency.
- The taxpayer key needs a **CA-issued certificate** (x5c), not just a key pair: the CSR from
  `POST /tax-compliance/keys` goes to the CA, and the issued certificate + private key are then
  stored with `PUT /tax-compliance/moadian/credentials`.

### 8.5 Invoice packet

`{header, body[], payments[]}` with the official short keys. Mapping in
`utils/moadian-packet.mapper.ts`:

| Field | Our value |
| --- | --- |
| `taxid` | §8.6 |
| `indatim`, `indati2m` | `issuedAt` (epoch ms) |
| `inty` | 1 if buyer has national id / economic code, else 2 |
| `inno` | internal serial, 10 hex chars (**UNVERIFIED:** SDKs differ — some send the decimal serial) |
| `inp` / `ins` | 1 (sale) / 1 (main). Corrective/cancel/return (`irtaxid`) not implemented |
| `tins` | seller economic code (credential, else `sellerInfo.economicCode`) |
| `tob`, `bid`, `tinb` | buyer type from national-id length (10 → 1 natural, 11 → 2 legal), national id, economic code; null for type 2 |
| `bpc` (buyer postal code) | null — not stored yet (§7.2) |
| body `sstid` | tenant default 13-digit id (`defaultSstid`) — per-item id not stored yet (§7.2) |
| body `sstt, am, mu, fee` | description, quantity, tenant default unit, unit price in rials |
| body `prdis, dis, adis` | `am×fee`, discount, `prdis−dis` |
| body `vra, vam` | `vatRate×100` and stored line `tax` (VAT per line, #795/#823) |
| body `tsstam` | `adis + vam` |
| `tprdis, tdis, tadis, tvam, todam, tbill` | sums; `todam=0`, `tbill = tadis + tvam` |
| `setm`, `cap`, `insp` | tenant settlement method (1 cash → `cap=tbill`, 2 credit → `insp=tbill`) |
| `payments` | `[]` |

Amounts are integer rials: `round(amount × fxRate)` (IRR → 1, IRT → 10). Only `IR`
jurisdiction invoices in `ISSUED`/`PAID` are accepted. Gold/contract/export-only fields are null.
**UNVERIFIED:** whether the server rejects `null` for `consfee/spro/bros/tcpbs` on pattern 1.

### 8.6 Tax ID (شماره منحصربه‌فرد مالیاتی), 22 characters

```
taxid   = memoryId(6) + hex(days, 5) + hex(serial, 10) + verhoeff(control)   (upper case)
days    = floor(indatim / 86 400 000)            # UTC days since 1970-01-01
control = digits(memoryId) + pad(days, 6) + pad(serial, 12)
digits(memoryId): each letter replaced by its decimal ASCII code (A → 65), digits kept
```

Vectors (pinned in `moadian.spec.ts`, computed with the PyPI reference implementation):
`A1B2C3 / 2026-10-22T08:30Z / 1 → A1B2C30510C00000000019`,
`A11216 / 2023-05-01 / 123456 → A1121604C16000001E2401`,
`ZZZ999 / 2026-01-01T23:59:59Z / 0xFFFFFFFFFF → ZZZ99904FE6FFFFFFFFFF3`.
**UNVERIFIED:** whether the day count uses UTC or Tehran local midnight (the JS SDKs use UTC;
the Python SDK uses the naive local date). Invoices issued 00:00–03:30 Tehran time may differ.

### 8.7 Storage, queue and status

- `moadian_credentials` (one row per tenant): memory id, economic code, certificate, private key
  sealed with AES-256-GCM (`MOADIAN_KEY_ENCRYPTION_KEY`, AAD = tenant id), defaults, serial counter.
- `moadian_submissions` (one row per invoice per tenant): uid, taxid, serial, reference number,
  status `QUEUED → SENT → SUCCESS | FAILED` (or `ERROR` after transport retries), errors/warnings.
- BullMQ queue `moadian`: `moadian.send` then `moadian.poll` every `MOADIAN_POLL_DELAY_MS`
  up to `MOADIAN_MAX_POLLS`. Job payloads hold only tenant id + submission id.
- Endpoints (tenant admin only): `PUT|GET /enterprise-hub/tax-compliance/moadian/credentials`,
  `POST …/moadian/invoices/:invoiceId/submit`, `GET …/moadian/invoices/:invoiceId/status`.

### 8.8 Still open after this change

Per-item `sstid` and unit, buyer postal code, corrective/cancel invoices (`ins` 2/3, `irtaxid`),
trusted-company sending, 21-day deadline tracking, e-ledger, official error-code table, and a
first real sandbox run with a test memory id + CA certificate (needs the owner's کارپوشه).
