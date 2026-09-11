# 🛰️ گزارش رادار فناوری ROXIRA

- **موضوع پژوهش:** 2026 edge vector database performance benchmarks
- **حالت اجرا:** `standard`
- **زمان تولید (UTC):** 2026-09-11T17:31:21+00:00
- **مدل سنتز:** `deepseek/deepseek-v4.1-flash`
- **تعداد منابع تحلیل‌شده:** 5
- **وضعیت:** `SUCCESS`

## خلاصه مدیریتی
بر اساس داده‌های بنچمارک Q1 2026 (Salt Technologies AI) روی ۱ میلیون بردار با ۱۵۳۶ بُعد، Qdrant با تأخیر p50 برابر ۴ms و p99 برابر ۲۵ms سریع‌ترین گزینه است و Redis با p50=5ms و p99=20ms بهترین دنباله‌روی را دارد. Pinecone به‌عنوان گزینه managed با p50=8ms و مقیاس‌پذیری serverless برای تیم‌های بدون عملیات مناسب است، در حالی که Milvus با ۸ الگوریتم ایندکس (شامل GPU) و pgvector با پشتیبانی ACID و SQL کامل، تنوع معماری را نشان می‌دهند. منابع تحلیلی هشدار می‌دهند که بنچمارک‌های فروشنده‌محور، تأخیر دنباله (P95/P99)، بار همزمان و هزینه کل مالکیت را نادیده می‌گیرند و روند صنعت به سمت «vector as a feature» در پلتفرم‌های یکپارچه مانند PostgreSQL + pgvector حرکت می‌کند. برای بارهای edge و local-first، LanceDB به‌صراحت به‌عنوان گزینه بدون سرور معرفی شده است، هرچند داده عددی بنچمارک برای آن در منابع موجود نیست.

## یافته‌های کلیدی
- Qdrant با p50=4ms و p99=25ms سریع‌ترین تأخیر پرس‌وجو را در بنچمارک ۱M بردار / ۱۵۳۶ بُعد دارد و هم به‌صورت OSS (Apache 2.0) و هم managed (Qdrant Cloud) عرضه می‌شود.
- Redis با p50=5ms و p99=20ms بهترین تأخیر دنباله (tail latency) را دارد و بالاترین throughput (۱۵٬۰۰۰ تا ۴۰٬۰۰۰) را در جدول ثبت کرده، اما به دلیل RAM-bound بودن به ۱۰ تا ۱۰۰ میلیون بردار محدود است.
- Milvus با ۸ الگوریتم ایندکس (شامل GPU)، p50=6ms و پشتیبانی از میلیاردها بردار، بیشترین تنوع ایندکس را دارد؛ اما نیازمند منابع مهندسی است.
- pgvector به‌عنوان افزونه PostgreSQL رایگان، ACID و تراکنش‌های SQL کامل را با p50=18ms ارائه می‌دهد و برای بارهای زیر ۱۰۰ میلیون بردار (طبق Firecrawl) مناسب است.
- منابع تحلیلی (Actian و Firecrawl) تأکید می‌کنند که بنچمارک‌های فروشنده‌محور شرایط تولید مانند همزمانی، فیلترینگ و ingestion پیوسته را منعکس نمی‌کنند و باید با تست واقعی و مدل‌سازی هزینه بلندمدت جایگزین شوند.

## فناوری‌های نوظهور و روندها
### Qdrant — `mainstream`
- **دسته:** Vector Database (OSS + Managed)
- **توضیح:** پایگاه داده برداری با مجوز Apache 2.0 که هم به‌صورت self-hosted و هم Qdrant Cloud ارائه می‌شود؛ در بنچمارک Q1 2026 سریع‌ترین p50 (۴ms) را ثبت کرده است.
- **اهمیت:** ترکیب کمترین تأخیر p50 و پشتیبانی از sparse (SPLADE, miniCOIL) و ColBERT multi-vector آن را برای RAG و جست‌وجوی ترکیبی در edge جذاب می‌کند.
- **شاهد پذیرش:** حضور در جدول بنچمارک Salt Technologies AI با p50=4ms و p99=25ms و معرفی به‌عنوان گزینه budget-conscious در راهنمای Firecrawl.

### Pinecone — `mainstream`
- **دسته:** Managed Vector Database
- **توضیح:** پایگاه داده برداری managed با معماری serverless و pod-based، p50=8ms و p99=45ms، با قابلیت inference داخلی (embeddings + reranking) و hybrid search.
- **اهمیت:** برای تیم‌هایی که zero-ops و مقیاس‌پذیری تا میلیاردها بردار می‌خواهند، گزینه‌ای بدون نیاز به مدیریت زیرساخت است.
- **شاهد پذیرش:** در بنچمارک Q1 2026 با p50=8ms و در راهنمای Firecrawl به‌عنوان zero-ops managed search در هر مقیاس معرفی شده است.

### Milvus / Zilliz Cloud — `mainstream`
- **دسته:** Distributed Vector Database
- **توضیح:** پایگاه داده برداری توزیع‌شده با مجوز Apache 2.0 و نسخه managed Zilliz Cloud؛ دارای ۸ الگوریتم ایندکس شامل GPU، p50=6ms و پشتیبانی از میلیاردها بردار.
- **اهمیت:** برای بارهای بسیار بزرگ با هزینه کمتر نسبت به گزینه‌های managed، اما نیازمند منابع مهندسی است.
- **شاهد پذیرش:** در بنچمارک Q1 2026 با p50=6ms و p99=35ms و در راهنمای Firecrawl به‌عنوان گزینه میلیاردی کم‌هزینه معرفی شده است.

### pgvector + pgvectorscale — `growing`
- **دسته:** PostgreSQL Extension
- **توضیح:** افزونه رایگان PostgreSQL برای ذخیره و جست‌وجوی بردار با پشتیبانی ACID و SQL کامل؛ p50=18ms و p99=90ms و محدودیت ۱۰ تا ۵۰ میلیون بردار در تک‌نود.
- **اهمیت:** روند «vector as a feature» را نمایندگی می‌کند و برای تیم‌هایی که از قبل PostgreSQL دارند، هزینه و پیچیدگی زیرساخت را کاهش می‌دهد.
- **شاهد پذیرش:** در بنچمارک Q1 2026 با p50=18ms و در راهنمای Firecrawl برای کاربران PostgreSQL زیر ۱۰۰ میلیون بردار توصیه شده است.

### Weaviate — `mainstream`
- **دسته:** Vector Database (OSS + Managed)
- **توضیح:** پایگاه داده برداری با مجوز BSD 3-Clause و نسخه Weaviate Cloud؛ p50=12ms و p99=65ms با hybrid search (vector + BM25 + metadata filters) و modular embeddings.
- **اهمیت:** ترکیب جست‌وجوی ترکیبی و مستندات قوی آن را برای تیم‌هایی که به فیلترینگ متادیتا نیاز دارند مناسب می‌کند.
- **شاهد پذیرش:** در بنچمارک Q1 2026 با p50=12ms و در راهنمای Firecrawl به‌عنوان گزینه hybrid search با مستندات قوی معرفی شده است.

### ChromaDB — `growing`
- **دسته:** Embedded / In-process Vector Database
- **توضیح:** پایگاه داده برداری open source با حالت in-process یا client-server؛ p50=12ms و p99=70ms، محدود به کمتر از ۱ میلیون بردار در تک‌نود، با backend object-storage و collection forking.
- **اهمیت:** برای prototyping و MVP و بارهای سبک edge که به راه‌اندازی ساده نیاز دارند مناسب است.
- **شاهد پذیرش:** در بنچمارک Q1 2026 با p50=12ms و در راهنمای Firecrawl برای prototyping و MVP معرفی شده است.

### LanceDB — `emerging`
- **دسته:** Edge / Local-first Vector Database
- **توضیح:** پایگاه داده برداری edge و local-first بدون نیاز به سرور، مناسب برای data science و بارهای روی دستگاه.
- **اهمیت:** برای سناریوهای edge که تأخیر شبکه و وابستگی به سرور مرکزی غیرقابل قبول است، معماری بدون سرور ارائه می‌دهد.
- **شاهد پذیرش:** در راهنمای Firecrawl به‌صراحت به‌عنوان گزینه edge، local-first و data science بدون سرور معرفی شده است.

### Vespa — `growing`
- **دسته:** Hybrid Search Platform
- **توضیح:** پلتفرم جست‌وجوی ترکیبی در مقیاس میلیاردی با عملیات tensor بومی و learned ranking.
- **اهمیت:** برای بارهای پیچیده hybrid search با رتبه‌بندی یادگیری‌شده در مقیاس بزرگ مناسب است.
- **شاهد پذیرش:** در راهنمای Firecrawl به‌عنوان گزینه billion-scale hybrid search با tensor operations بومی معرفی شده است.

## ریپازیتوری‌های برتر گیت‌هاب

| مخزن | ستاره | زبان | چرا مهم است |
| --- | --- | --- | --- |
| [qdrant/qdrant](https://github.com/qdrant/qdrant) | بیش از ۲۰٬۰۰۰ (تقریبی) | Rust | مرجع اصلی برای بازتولید بنچمارک edge و پیاده‌سازی جست‌وجوی برداری کم‌تأخیر. |
| [milvus-io/milvus](https://github.com/milvus-io/milvus) | بیش از ۳۰٬۰۰۰ (تقریبی) | Go / C++ | برای بنچمارک مقیاس‌پذیری و مقایسه الگوریتم‌های ایندکس در بارهای بزرگ. |
| [pgvector/pgvector](https://github.com/pgvector/pgvector) | بیش از ۱۰٬۰۰۰ (تقریبی) | C | گزینه edge-friendly برای تیم‌هایی که می‌خواهند بردار را به پایگاه داده رابطه‌ای موجود اضافه کنند. |
| [weaviate/weaviate](https://github.com/weaviate/weaviate) | بیش از ۱۰٬۰۰۰ (تقریبی) | Go | برای بنچمارک جست‌وجوی ترکیبی و فیلترینگ متادیتا در سناریوهای RAG. |
| [chroma-core/chroma](https://github.com/chroma-core/chroma) | بیش از ۱۵٬۰۰۰ (تقریبی) | Python / Rust | برای بنچمارک سریع و سبک روی دستگاه‌های edge و محیط‌های توسعه. |
| [lancedb/lancedb](https://github.com/lancedb/lancedb) | بیش از ۵٬۰۰۰ (تقریبی) | Rust / Python | مرجع اصلی برای بنچمارک بارهای edge و local-first که در منابع به‌صراحت معرفی شده است. |

## مزایا، معایب و موارد کاربرد
### Qdrant
**مزایا:**
- سریع‌ترین p50 (۴ms) و p99 (۲۵ms) در بنچمارک Q1 2026
- مجوز Apache 2.0 و گزینه managed (Qdrant Cloud)
- پشتیبانی از sparse (SPLADE, miniCOIL) و ColBERT multi-vector

**معایب:**
- برای بارهای بسیار بزرگ نیازمند تخصص عملیاتی است
- داده بنچمارک فقط روی ۱M بردار / ۱۵۳۶ بُعد است و مقیاس‌های بالاتر را پوشش نمی‌دهد

**مناسب برای:** تیم‌های budget-conscious و بارهای edge با نیاز به کمترین تأخیر

### Pinecone
**مزایا:**
- zero-ops و serverless scaling
- inference داخلی (embeddings + reranking) و hybrid search
- پشتیبانی از میلیاردها بردار

**معایب:**
- managed-only و بدون گزینه self-hosted
- p50=8ms که از Qdrant و Redis کندتر است

**مناسب برای:** تیم‌هایی که می‌خواهند بدون مدیریت زیرساخت در هر مقیاسی کار کنند

### Milvus / Zilliz Cloud
**مزایا:**
- ۸ الگوریتم ایندکس شامل GPU
- پشتیبانی از میلیاردها بردار با هزینه کمتر
- مجوز Apache 2.0 و گزینه managed

**معایب:**
- نیازمند منابع مهندسی قابل توجه
- p50=6ms که از Qdrant و Redis کندتر است

**مناسب برای:** بارهای بسیار بزرگ با تیم مهندسی اختصاصی

### pgvector
**مزایا:**
- رایگان و افزونه PostgreSQL
- پشتیبانی ACID و SQL کامل
- بدون نیاز به زیرساخت جدید برای کاربران PostgreSQL

**معایب:**
- p50=18ms و p99=90ms که کندتر از گزینه‌های اختصاصی است
- محدودیت ۱۰ تا ۵۰ میلیون بردار در تک‌نود

**مناسب برای:** کاربران PostgreSQL با کمتر از ۱۰۰ میلیون بردار

### Redis
**مزایا:**
- بهترین p99 (۲۰ms) و p50=5ms
- بالاترین throughput (۱۵٬۰۰۰ تا ۴۰٬۰۰۰)
- گزینه managed (Redis Cloud) و self-hosted (Redis Stack)

**معایب:**
- RAM-bound و محدود به ۱۰ تا ۱۰۰ میلیون بردار
- مجوز RSAL/SSPL که برای برخی تیم‌ها محدودیت ایجاد می‌کند

**مناسب برای:** بارهای با نیاز به throughput بالا و تأخیر دنباله پایین

## دستورات اجرایی پیشنهادی
**راه‌اندازی Qdrant به‌صورت محلی با Docker برای بنچمارک edge**
```bash
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant
```

**نصب pgvector روی PostgreSQL برای تست جست‌وجوی برداری**
```bash
git clone https://github.com/pgvector/pgvector.git && cd pgvector && make && make install
```

**نصب LanceDB برای بارهای edge و local-first**
```bash
pip install lancedb
```

**نصب ChromaDB برای prototyping سریع**
```bash
pip install chromadb
```

**اجرای Milvus به‌صورت standalone با Docker Compose**
```bash
wget https://github.com/milvus-io/milvus/releases/download/v2.4.0/milvus-standalone-docker-compose.yml -O docker-compose.yml && docker compose up -d
```

**اجرای VectorDBBench برای بازتولید بنچمارک‌های مستقل**
```bash
pip install vectordb-bench && vectordb-bench
```

## ریسک‌ها و هشدارها
- بنچمارک‌های فروشنده‌محور شرایط تولید مانند همزمانی، فیلترینگ و ingestion پیوسته را منعکس نمی‌کنند (Actian).
- تأخیر دنباله (P95/P99) و افت عملکرد در طول زمان و افزایش هزینه کل مالکیت در مقیاس، ریسک‌های اصلی تولید هستند (Actian).
- داده‌های عددی بنچمارک Q1 2026 فقط روی ۱ میلیون بردار با ۱۵۳۶ بُعد اندازه‌گیری شده و به مقیاس‌های edge یا میلیاردی تعمیم‌پذیر نیست.
- برای LanceDB و Vespa در منابع انتخابی داده عددی بنچمارک ارائه نشده و ارزیابی عملکردی آن‌ها نیازمند تست مستقل است.
- محدودیت‌های مجوز (مانند RSAL/SSPL برای Redis و SSPL برای Elasticsearch) می‌تواند برای استقرار edge یا تجاری محدودیت ایجاد کند.

## توصیه‌های راهبردی
- برای بارهای edge با کمترین تأخیر، Qdrant را با استقرار self-hosted (Apache 2.0) ارزیابی کنید و p99 را در بار همزمان واقعی بسنجید.
- برای تیم‌های بدون عملیات، Pinecone را به‌عنوان گزینه managed با zero-ops در نظر بگیرید، اما هزینه بلندمدت را مدل‌سازی کنید.
- اگر از قبل PostgreSQL دارید و بار زیر ۱۰۰ میلیون بردار است، pgvector را به‌عنوان گزینه «vector as a feature» با کمترین پیچیدگی زیرساخت انتخاب کنید.
- برای بارهای local-first و بدون سرور روی دستگاه‌های edge، LanceDB را با تست مستقل عملکرد ارزیابی کنید، زیرا داده بنچمارک عددی برای آن در منابع موجود نیست.
- بنچمارک‌های فروشنده‌محور را با تست واقعی شامل همزمانی، فیلترینگ و ingestion پیوسته جایگزین کنید و معیارهای P95/P99 و هزینه کل مالکیت را در تصمیم لحاظ کنید.

## منابع
- [Vector Database Benchmark 2026 | Top 10 Compared](https://www.salttechno.ai/datasets/vector-database-performance-benchmark-2026) (relevance=0.92192179, engine=firecrawl)
- [Best Vector Databases in 2026: A Complete Comparison Guide](https://www.firecrawl.dev/blog/best-vector-databases) (relevance=0.715424, engine=firecrawl)
- [Vector Database Benchmarks are Misleading: What Matters](https://www.actian.com/blog/databases/how-to-evaluate-vector-databases-in-2026) (relevance=0.64063591, engine=firecrawl)
- [Fastest Vector Database 2026: 6 Benchmarks Compared](https://ranksquire.com/2026/02/24/fastest-vector-database-2026) (relevance=0.63973606, engine=firecrawl)
- [Top 10 Vector Databases in 2026: Ultimate Comparison, Benchmarks & Use Cases | by Karthikeyan Rathinam | Medium](https://karthikeyanrathinam.medium.com/top-10-vector-databases-in-2026-ultimate-comparison-benchmarks-use-cases-6b0e878256b5) (relevance=0.5917232, engine=firecrawl)

---
*این گزارش به‌صورت خودکار توسط TechRadarAgent (ROXIRA Autonomous Engineering Platform) تولید شده است.*