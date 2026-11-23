# گزارش جامع استراتژیک: وضعیت فعلی، امن‌سازی حداکثری (Lockdown) و زیرساخت‌های نسل بعدی Roxira
**تاریخ تهیه:** ۲۲ نوامبر ۲۰۲۶ (۲۰۲۶-۱۱-۲۲)  
**مخاطب:** استراتژیست مرکزی و تیم معماری  

---

## ۱. ممیزی نسخه‌های فعلی سیستم و مقایسه با آخرین وضعیت رسمی

| جزء / زیرساخت | نسخه‌ی فعلی ما | وضعیت رسمی و چرخه‌ی پشتیبانی (تا نوامبر ۲۰۲۶) | تصمیم پیشنهادی |
| :--- | :--- | :--- | :--- |
| **macOS (میزبان توسعه)** | `27.2.1` | به‌روز | حفظ وضعیت فعلی |
| **Node.js** | `v26.10.0` | **Node.js 26 ("Lithium")** در **۵ مه ۲۰۲۶** منتشر شد و از **۲۸ اکتبر ۲۰۲۶** وارد **Active LTS** شده است (EOL: **۳۰ آوریل ۲۰۲۹**). Node 20 در ۳۰ آوریل ۲۰۲۶ به EOL رسید. | ✅ بسیار مطلوب (به‌روزرسانی جزئی به آخرین patch شاخه‌ی `v26.x` در CI) |
| **Python (venv)** | `3.13.6` | **Python 3.13** از **۱ اکتبر ۲۰۲۶** از فاز bugfix خارج شده و فقط **Security Fixes Only (source-only)** می‌گیرد (EOL: اکتبر ۲۰۲۹). **Python 3.14** (انتشار ۷ اکتبر ۲۰۲۵، EOL: اکتبر ۲۰۳۰) و **Python 3.15** (انتشار ۹ اکتبر ۲۰۲۶، EOL: اکتبر ۲۰۳۱) در فاز **Full Bugfix Support** هستند. | ⚠️ برنامه‌ریزی برای مهاجرت `venv` و `Dockerfile.prod` به **Python 3.14** یا **3.15** |
| **Docker Engine** | `29.8.0` | فعال و به‌روز | ✅ فعال‌سازی حالت **Rootless** روی سرور لینوکس |
| **GitHub CLI (`gh`)** | `2.97.0` | نسخه‌ی `2026-07-31` | ✅ مطلوب |
| **PostgreSQL (سرور)** | — | **PostgreSQL 17** (انتشار ۲۶ سپتامبر ۲۰۲۴، EOL: **۸ نوامبر ۲۰۲۹**) و **PostgreSQL 18** (انتشار ۲۵ سپتامبر ۲۰۲۵، EOL: **۱۴ نوامبر ۲۰۳۰**) هر دو در پشتیبانی کامل ۵ساله هستند. | ✅ استانداردسازی روی **PostgreSQL 18** برای استقرارهای جدید |

---

## ۲. نقشه‌ی راه امن‌سازی حداکثری (Lockdown & Zero-Trust Posture)

1. **Docker Rootless + کانتینرهای Read-Only:**
   - اجرای `dockerd` در حالت **Rootless** (`dockerd-rootless-setuptool.sh install`) با `uidmap` و `slirp4netns` تا در صورت فرار از کانتینر، مهاجم فقط دسترسی کاربر غیرریشه داشته باشد و نیاز به گروه `docker` (معادل `root`) حذف شود.
   - فعال‌سازی `read_only: true` در `docker-compose`، تعریف `USER 10001` در `Dockerfile.prod`، حفظ پروفایل‌های `seccomp`/`AppArmor` و ممنوعیت کامل `--privileged` و mount کردن `docker.sock`.
2. **سخت‌سازی لایه‌ی داده (PostgreSQL + Qdrant):**
   - **PostgreSQL:** اجبار `FORCE ROW LEVEL SECURITY` روی تمام جداول tenant و اتصال سرویس با نقش غیرسوپریوزر `roxira_app` (`NOSUPERUSER NOBYPASSRLS`).
   - **Qdrant Strict Mode:** فعال‌سازی `unindexed_filtering_retrieve: false` و `max_query_limit` تا هر کوئری بدون ایندکس یا بدون فیلتر `tenant_id` با HTTP 400 رد شود.
3. **امنیت زنجیره‌ی تامین (Supply-Chain Lockdown):**
   - پین‌کردن تمام GitHub Actions به commit SHA (در حال حاضر ۸۷ اکشن در ۲۱ workflow پین شده‌اند).
   - اجرای اجباری `gitleaks`، `trivy`، `OSV-Scanner` و `check_agent_guards.py` پیش از merge.

---

## ۳. فناوری‌ها و ریپازیتوری‌های اوپن‌سورس نسل بعدی (هم‌راستا با مجوزهای Permissive)

با توجه به قانون سخت‌گیرانه‌ی **مجوزهای Permissive (فقط MIT / Apache-2.0 / BSD / PostgreSQL؛ ممنوعیت AGPL/SSPL/RSAL/GPL)**، موارد زیر بیشترین ارزش استراتژیک را برای Roxira دارند:

| فناوری / پروژه | مجوز | جایگزین / نقش در معماری ما | چرایی و مزیت استراتژیک (تا نوامبر ۲۰۲۶) |
| :--- | :--- | :--- | :--- |
| **Valkey** (Linux Foundation) | **BSD 3-Clause** | جایگزین drop-in برای **Redis** | Redis از نسخه‌ی ۸.۰ گزینه‌ی AGPLv3 را در کنار RSALv2/SSPLv1 اضافه کرد که برای محیط‌های تجاری/سازمانی ریسک حقوقی دارد. **Valkey** (انشعاب از Redis 7.2.4 تحت بنیاد لینوکس با حمایت AWS و Google) کاملاً BSD باقی مانده، عملکرد یکسان دارد و با ماژول‌های `valkey-json` و `valkey-search` (شاخه‌ی 9.x) توسعه می‌یابد. |
| **Qdrant 1.16+ (Tiered Multitenancy + Strict Mode)** | **Apache-2.0** | هسته‌ی جستجوی برداری Smart Judge | قابلیت **Tiered Multitenancy** (نسخه 1.16+) اجازه می‌دهد tenantهای کوچک در shardهای مشترک با ایندکس `is_tenant: true` بمانند و tenantهای پرحجم به‌صورت خودکار به shard اختصاصی منتقل شوند؛ همچنین **Hybrid Search** (Dense + Sparse/BM25 با RRF/DBSF) به همراه فیلتر `tenant_id` در تمام بلاک‌های `prefetch`. |
| **Langfuse + OpenTelemetry (OTel)** | **MIT** | مشاهده‌پذیری و ارزیابی LLM (جایگزین ابزارهای بسته) | پلتفرم اوپن‌سورس با بک‌اند **ClickHouse** و پشتیبانی بومی از استاندارد **OpenTelemetry GenAI (`gen_ai.*`)** و OTLP. امکان self-host کامل (حفظ حریم خصوصی داده‌های حقوقی)، ردیابی دقیق هزینه/توکن به تفکیک tenant، و ارزیابی خودکار (LLM-as-a-judge). |
| **pypdfium2** | **BSD-3 / Apache-2.0** | جایگزین **PyMuPDF (AGPL)** | حذف کامل ریسک AGPL در پردازش PDFهای فارسی و رندر تصاویر (در حال پیاده‌سازی در #1235). |

---

## ۴. منابع و استنادها (نوشته و بررسی‌شده در ۲۲ نوامبر ۲۰۲۶)

- **Node.js Release Schedule:** [nodejs.org](https://nodejs.org/en/about/previous-releases) — Node.js 26 ("Lithium") Active LTS از ۲۸ اکتبر ۲۰۲۶ تا ۳۰ آوریل ۲۰۲۹.
- **Python Release Lifecycle:** [python.org/downloads](https://www.python.org/downloads/) — Python 3.13 (فقط امنیتی از اکتبر ۲۰۲۶)، Python 3.14 (پشتیبانی کامل تا اکتبر ۲۰۳۰)، Python 3.15 (منتشرشده ۹ اکتبر ۲۰۲۶، پشتیبانی تا اکتبر ۲۰۳۱).
- **PostgreSQL Versioning Policy:** [postgresql.org/support/versioning](https://www.postgresql.org/support/versioning/) — PG 17 (تا ۸ نوامبر ۲۰۲۹) و PG 18 (تا ۱۴ نوامبر ۲۰۳۰).
- **Docker Rootless Security:** [docs.docker.com/engine/security/rootless](https://docs.docker.com/engine/security/rootless/)
- **Qdrant Multitenancy & Strict Mode:** [qdrant.tech/documentation](https://qdrant.tech/documentation/guides/multitenancy/)
- **Langfuse OpenTelemetry & MIT:** [langfuse.com/docs/opentelemetry](https://langfuse.com/docs/opentelemetry)
- **Valkey vs Redis Licensing:** [valkey.io](https://valkey.io/) (BSD 3-Clause, Linux Foundation)

---

## ۵. شتاب‌دهنده‌های توسعه، CI و گردش‌کار ایجنتیک (Rust / Go / TypeScript)

برای اینکه هم سرعت اجرای تیم و ایجنت‌ها (CI، تست، بیلد، lint) چند برابر شود و هم مصرف منابع به حداقل برسد، این زیرساخت‌های نسل بعدی (همگی با مجوزهای **MIT / Apache-2.0**) پیشنهاد می‌شوند:

| ابزار / زیرساخت | زبان هسته | مجوز | نقش و تاثیر مستقیم بر سرعت و دقت |
| :--- | :--- | :--- | :--- |
| **`uv` و `Ruff`** (Astral) | **Rust** | MIT / Apache-2.0 | جایگزین `pip`/`venv`/`flake8`/`black`/`isort`. نصب پکیج‌ها و اجرای lint با سرعت ۱۰ تا ۱۰۰ برابر پایتون؛ کاهش شدید زمان pre-push و CI. (`Ruff` هم‌اکنون در مخزن فعال است؛ استانداردسازی کامل `uv` در `Dockerfile.prod` و worktreeها گام بعدی است.) |
| **`Oxlint` / `Oxc` و `Biome`** | **Rust** | MIT | جایگزین یا مکمل ESLint/Prettier برای TypeScript/Next.js/NestJS با سرعت ۵۰ تا ۱۰۰ برابر؛ اجرای آنی روی هزاران فایل بدون کند کردن ایجنت‌ها. |
| **`tsgo` (TypeScript 7 Native)** | **Go** | Apache-2.0 | کامپایلر بومی جدید TypeScript که هم‌اکنون در CI مخزن (`TypeScript 7 type-check`) فعال است و زمان type-check را تا ~۱۰ برابر کاهش می‌دهد. |
| **Durable Execution (`Temporal` یا `Restate`)** | Go / **Rust** | MIT | برای **ایجنت‌های طولانی‌مدت (Long-running Agentic Workflows)** و پایپ‌لاین‌های حقوقی: تضمین ادامه کار پس از کرش، retry قطعی، و مدیریت state بدون گم‌شدن تسک‌ها. |
| **Sandboxed Execution (`Firecracker` / `gVisor`)** | **Rust** (Firecracker) / Go | Apache-2.0 | ایزوله‌سازی کامل اجرای کد ایجنت‌ها و ابزارهای غیرقابل‌اعتماد در سطح microVM یا user-space kernel (امن‌تر از کانتینر معمولی در حالت Lockdown). |

---

## ۶. تحلیل واقع‌بینانه‌ی زبان‌ها در معماری Roxira (Rust در برابر TypeScript و Python)

* **جایگاه Rust (نقاط قوت و محدودیت‌ها):**
  * **قوت‌ها:** سرعت و مصرف حافظه‌ی بی‌رقیب، ایمنی حافظه بدون Garbage Collector، ایده‌آل برای **زیرساخت، پروکسی‌ها، موتورهای جستجو (مثل Qdrant)، ابزارهای CLI/CI (`uv`, `Ruff`, `Oxlint`)، و پردازنده‌های سنگین متن/PDF**.
  * **معایب و ریسک‌ها:** زمان کامپایل طولانی‌تر، منحنی یادگیری تندتر برای تیم، و سرعت پایین‌تر در تغییر سریع منطق تجاری (Business Logic) نسبت به TypeScript/Python. بنابراین Rust نباید جایگزین لایه‌ی اپلیکیشن NestJS/Next.js شود؛ بلکه باید در **ابزارهای زیرساختی و سرویس‌های هسته‌ایِ پایدار** استفاده شود.
* **جایگاه TypeScript (ستون فقرات محصول):**
  * بهترین انتخاب برای **NestJS (Enterprise Hub)** و **Next.js (Frontend)** به دلیل اشتراک‌گذاری تایپ‌ها، اکوسیستم غنی، و سرعت بالای توسعه؛ و با ابزارهای Rust/Go (`Oxlint`, `tsgo`, `Biome`) ضعف سرعت ابزارهای قدیمی JS/TS آن کاملاً برطرف می‌شود.
* **جایگاه Python (هسته‌ی هوش مصنوعی):**
  * برای **Smart Judge (FastAPI + PyTorch/ONNX + LangGraph)** غیرقابل‌جایگزین است؛ با مهاجرت به **Python 3.14/3.15**، استفاده از **`uv`** و انتقال محاسبات سنگین به کتابخانه‌های C++/Rust (`pypdfium2`, `onnxruntime`, `Qdrant`), گلوگاه‌های سرعت آن خنثی می‌شوند.

---

## ۷. نسل بعدی دیتابیس حقوقی، GraphRAG پیشرفته و چت/صدای Real-Time

برای اینکه هسته‌ی حقوقی (Smart Judge) هم در **پاسخ‌های کوتاه و Real-Time (چت و صوتی)** سریع و دقیق باشد و هم در **پاسخ‌های طولانی، تحلیلی و چندمرحله‌ای** به‌صورت ایجنتیک عمل کند و قابل استفاده در سایر سرویس‌های پلتفرم باشد، معماری **Hybrid Agentic-GraphRAG** پیشنهاد می‌شود:

### الف) تکامل لایه‌ی GraphRAG و دانش حقوقی (فراتر از LightRAG ساده)

| سیستم / الگو | نقاط قوت کلیدی | کاربرد در دیتابیس حقوقی Roxira |
| :--- | :--- | :--- |
| **LightRAG** (فعلی ما) | ایندکس افزایشی (Incremental) کم‌هزینه، بازیابی دو سطحی (موجودیت + موضوع). | پایه‌ی فعلی مناسب برای اسناد ثابت قوانین. |
| **HippoRAG** (الهام‌گرفته از هیپوکامپ + Personalized PageRank) | استدلال چندپرشی (**Multi-hop Associative Retrieval**) بین اسناد پراکنده بدون نیاز به بازسازی سنگین گراف. | کشف ارتباطات پنهان بین قوانین، آرای وحدت رویه و پرونده‌های مرتبط. |
| **Graphiti** (Temporal Knowledge Graphs) | **حافظه‌ی زمان‌مند (As-of / Temporal):** باطل‌کردن یال‌های قدیمی هنگام تغییر واقعیت‌ها یا نسخ قوانین. | ایده‌آل برای قوانین منسوخ‌شده/اصلاح‌شده و تغییر وضعیت پرونده‌های حقوقی در طول زمان. |
| **Cognee** | پایپ‌لاین ماژولار ECL (Extract, Cognify, Load) بین بردار و گراف. | یکپارچه‌سازی داده‌های چندمنبعی (قوانین عمومی + اسناد tenant). |
| **Real-Time Agentic RAG** (LangGraph + Tool-Use) | به‌جای گراف ازپیش‌محاسبه‌شده‌ی خشک، ایجنت در لحظه برنامه‌ریزی، بازیابی، بررسی صحت استناد (Citation Verification)، و پیمایش ارجاعات (مثل «تبصره ۲ ماده ۱۰») را انجام می‌دهد. | **پیشنهاد اصلی:** ترکیب **Qdrant Hybrid Search (Dense + Sparse/BM25)** با **حلقه ایجنتیک LangGraph** برای پاسخ‌های طولانی و دقیق، و مسیر سریع (Fast-path) برای چت زنده. |

### ب) زیرساخت چت زنده و مکالمه‌ی صوتی Real-Time (همگی Permissive)

برای افزودن قابلیت صحبت‌کردن یا چت لایو با تأخیر بسیار پایین (Ultra-low latency) روی همین دیتابیس حقوقی:

1. **LiveKit Agents (`Apache-2.0`):**
   - مدل Room/Participant بر پایه‌ی **WebRTC**؛ مدیریت خودکار اتصال صوتی/تصویری، قطع‌کردن صحبت (Interruption/Turn-detection)، و اتصال مستقیم به SIP/تلفن.
2. **Pipecat (`BSD 2-Clause`):**
   - فریم‌ورک پایپ‌لاین مدولار پایتونی (Frame-based) برای کنترل دقیق تکه‌تکه‌ی جریان صدا (STT → Agentic RAG → LLM → TTS) و اتصال آسان به FastAPI.

**جمع‌بندی معماری پیشنهادی برای آینده:**
- **لایه داده:** `Qdrant 1.16+` (Strict Mode + Hybrid Search + `tenant_id`) + `PostgreSQL 18` (`FORCE RLS` + تاریخچه/زمان‌مندی) + `Valkey` (BSD-3).
- **لایه هوش و استدلال:** مسیر سریع (Fast-path Hybrid Search) برای پاسخ‌های Real-Time + حلقه‌ی **Agentic RAG** (LangGraph + ایده‌های HippoRAG/Graphiti) برای تحلیل‌های حقوقی عمیق و طولانی.
- **لایه صوتی/لایو:** **Pipecat (BSD-2)** یا **LiveKit Agents (Apache-2.0)** متصل به همین API واحد.

---

## ۸. معماری ماژولار (Pluggable) و ریپازیتوری‌های مکمل اوپن‌سورس

### الف) چرا و چگونه ماژولارتر شویم؟ (الگوی Ports & Adapters)
برای اینکه در آینده بتوانید **بدون بازنویسی منطق حقوقی یا تجاری** هر جزء (LLM، دیتابیس برداری، موتور PDF، صف کار، یا موتور صوتی) را به‌راحتی جایگزین کنید، تمام وابستگی‌های بیرونی باید پشت **Interfaceهای کوچک و خالص** قرار بگیرند (مشابه `pdf_backend.py` در #1235 یا `served_collection.py`):
- **AI Gateway Interface:** جداسازی کامل فراخوانی مدل‌ها از کد محصول (تعویض آزادانه‌ی مدل‌ها از `config/models.yaml`).
- **Retriever / Vector Interface:** جداسازی کوئری‌های Qdrant/LightRAG از منطق استدلال Smart Judge.
- **Transport Interface:** جداسازی چت متنی (SSE)، چت صوتی (Pipecat/LiveKit) و API داخلی از هسته‌ی پاسخ‌دهی.

### ب) ریپازیتوری‌های مکمل اوپن‌سورس (همگی Permissive)

| ریپازیتوری / ابزار | مجوز | نقش مکمل در پلتفرم Roxira |
| :--- | :--- | :--- |
| **LiteLLM** یا **Portkey AI Gateway** | **MIT** | دروازه‌ی واحد (Unified Gateway) برای تمام مدل‌ها با fallback خودکار، محدودیت نرخ (Rate-Limit) و کنترل بودجه به تفکیک tenant. |
| **Ragas** و **Promptfoo** | **Apache-2.0** / **MIT** | ارزیابی خودکار کیفیت RAG (Faithfulness، Context Recall، دقت استناد) در CI تا هیچ تغییری در پرامپت یا مدل باعث افت کیفیت ۷۰-سؤال نشود. |
| **OpenFeature** + **`flagd`** | **Apache-2.0** | استاندارد باز Feature Flag برای فعال‌سازی تدریجی قابلیت‌های جدید (مثل `USE_ONNX_INT8` یا Hybrid Search) بدون دیپلوی مجدد. |
| **BullMQ** (روی **Valkey**) یا **NATS** | **MIT** / **Apache-2.0** | صف کار سبک و مطمئن برای پردازش ناهمزمان اسناد حجیم، ایندکسینگ و webhookها. |
| **OpenTelemetry Collector** | **Apache-2.0** | جمع‌آوری یکپارچه‌ی Trace، Metric و Log از FastAPI، NestJS و Next.js و ارسال هم‌زمان به **Langfuse** و داشبوردهای مانیتورینگ. |

---

## ۹. پیش‌نیازها و اختیارات پیشنهادی برای حداکثر سرعت و استقلال ایجنت‌ها

بر اساس موانع واقعی که در همین دور ماراتن (L4) مشاهده شد، فراهم‌کردن موارد زیر باعث می‌شود ایجنت‌ها بدون توقف و با دقت کامل کارها را جلو ببرند:

1. **محیط پایتون یکپارچه با `uv`:**
   - همگام‌سازی کامل `/Users/mac/venvs/roxira` با تمام وابستگی‌های تست و توسعه (`pytest`، `pillow`، `pypdfium2`، `ruff`، `httpx`) از طریق `uv sync` تا هیچ تستی به دلیل نبود پکیج `SKIP` نشود.
2. **استک تست محلی Docker (Postgres 18 + Qdrant + Valkey):**
   - یک `docker-compose.test.yml` سبک که روی پورت‌های آزاد تست (مثلاً `55432`, `63333`, `56379`) بالا باشد و نقش غیرسوپریوزر `roxira_app` از قبل ساخته شده باشد تا تست‌های `*.pg.spec.ts` (RLS) و Qdrant بلافاصله روی مک اجرا شوند.
3. **مرج کردن اصلاحیه‌ی `stat` روی macOS (`antigravity/fix-stat-macos`):**
   - با مرج شدن این اصلاحیه، `pre-push` hook کامل بدون نیاز به `LOCAL_CI_SKIP_PYTEST=1` روی مک سبز می‌شود.
4. **مجموعه‌ی داده‌ی تست عمومی/مصنوعی (Synthetic / Public-Law Fixtures):**
   - قرار دادن ۵ فایل PDF حقوقی عمومی (بدون داده‌ی مشتری) در `tests/fixtures/` برای اجرای مستقیم تست‌های طلایی (مثل مقایسه‌ی `pypdfium2` و `PyMuPDF` در #1235 یا تست ۷۰-سؤال).
5. **چرخش سریع‌تر صف بررسی و تایید مالک (`needs owner sentence`):**
   - وقتی PRهای سبز به‌موقع مرج شوند، سقف `WIP=5` آزاد می‌ماند و ایجنت‌ها بدون توقف سراغ ردیف‌های بعدی می‌روند.
