# Legal Corpus Inventory & Gap Analysis (Smart Judge)

> **Task**: Issue #1383 (L12 doc half)  
> **Source**: Production Qdrant read-only audit (2026-11-23), staged legal files in `data/legal/staged/`, and relay PRs #1345 / #1357.  
> **Context**: Complete inventory by collection, issuing authority, document type, and temporal coverage; prioritized gap matrix for Smart Judge RAG.

---

## 1. Executive Summary & Production Baseline (2026-11-23)

Smart Judge retrieval relies on dense vector collections hosted in Qdrant (1024-dim `BAAI/bge-m3` embeddings) complemented by PostgreSQL relational graph CTEs and keyword BM25 sparse indices.

### Production Collection Snapshot
| Qdrant Collection | Status | Points Count | Vector Model / Dimension | Scope / Content |
|---|---|---:|---|---|
| `iran_laws_v6` | **Active / Served** | 6,304 | `bge-m3` (1024-dim, cosine) | Primary served statutory corpus (Civil Code, Commercial Code, Penal Code, Tax Acts, Labor Law). |
| `iran_laws_v7b` | **Evaluation / Staging** | 7,229 | `bge-m3` (1024-dim, cosine) | Candidate upgraded law collection with expanded statutory provisions and recent amendments. |
| `iran_regulations_v3b` | **Active / Served** | 1,322 | `bge-m3` (1024-dim, cosine) | Executive bylaws, cabinet decrees, and ministerial regulations. |
| `iran_rulings_v1` | **Active / Served** | 1,732 | `bge-m3` (1024-dim, cosine) | Supreme Court Unity Precedents (آرای وحدت رویه دیوان عالی کشور). |
| `judiciary_circulars` | **Active / Secondary** | 250 | `bge-m3` (1024-dim, cosine) | Official directives and circulars issued by the Judiciary Head (بخشنامه‌های رئیس قوه قضائیه). |
| `legal_advisory_opinions` | **Empty** | 0 | `bge-m3` (1024-dim, cosine) | Advisory opinions of the Judiciary Legal Department (نظریات مشورتی اداره کل حقوقی قوه قضائیه). |
| `judicial_precedents` | **Pilot / Inactive** | 6 | `bge-m3` (1024-dim, cosine) | Initial branch appellate rulings pilot. |

- **Total Active Served Points**: 9,608 (6,304 laws + 1,322 regulations + 1,732 unity rulings + 250 circulars).
- **Total Points Indexed**: 16,843 points across all public legal collections.
- **Raw Storage on Production Host**: Approximately **55 MB** of uncompressed JSONL, XML, and text source files located at `/opt/roxira_platform/data/legal/` on `srv1`.

---

## 2. Corpus Breakdown by Collection, Document Type, Issuer & Year

### A. Statutory Laws (`iran_laws_v6` & `iran_laws_v7b`)
- **Document Type**: `STATUTE` / `LAW` (قانون لازم‌الاجرا)
- **Primary Issuers**:
  - Islamic Consultative Assembly (مجلس شورای اسلامی)
  - Expediency Discernment Council (مجمع تشخیص مصلحت نظام)
  - Revolutionary Council (شورای انقلاب جمهوری اسلامی ایران)
  - Historical Parliamentary Assemblies (مجلس شورای ملی و مجلس سنا)
- **Temporal Distribution**: Solar Hijri **1307 to 1403** (1928–2024 CE).
- **Core Subject Areas**:
  - Civil & Contracts: Civil Code (قانون مدنی - 1,334 articles), Pre-emption, Lease (قانون روابط موجر و مستأجر 1356 و 1376).
  - Commercial & Banking: Commercial Code (قانون تجارت 1311), Commercial Code Amendment Bill 1347, Check Issuance Act (قانون صدور چک اصلاحی 1397).
  - Criminal & Procedure: Penal Code (قانون مجازات اسلامی 1392), Criminal Procedure Code (قانون آیین دادرسی کیفری 1392), Civil Procedure Code (قانون آیین دادرسی مدنی 1379).
  - Tax & Corporate: Direct Taxes Act (قانون مالیات‌های مستقیم اصلاحی 1394 و 1400), VAT Act (قانون مالیات بر ارزش افزوده 1400), Tax Terminals and Moadian System Act (قانون پایانه‌های فروشگاهی و سامانه مؤدیان 1398).
  - Labor & Social Security: Labor Law (قانون کار 1369), Social Security Act (قانون تأمین اجتماعی 1354).

### B. Regulations & Executive Bylaws (`iran_regulations_v3b`)
- **Document Type**: `REGULATION` / `BYLAW` / `DECREE` (آیین‌نامه اجرایی، تصویب‌نامه، دستورالعمل)
- **Primary Issuers**:
  - Council of Ministers (هیئت وزیران / هیات دولت): ~710 points
  - Ministry of Economic Affairs & Finance (وزارت امور اقتصادی و دارایی): ~230 points
  - Central Bank of Iran (بانک مرکزی جمهوری اسلامی ایران): ~140 points
  - Deregulation Board (هیئت مقررات‌زدایی و بهبود محیط کسب‌وکار): ~85 points
  - Ministry of Cooperatives, Labour, and Social Welfare (وزارت تعاون، کار و رفاه اجتماعی): ~95 points
  - Customs Administration (گمرک جمهوری اسلامی ایران): ~62 points
- **Temporal Distribution**: Solar Hijri **1360 to 1403** (predominantly 1385–1403).

### C. Supreme Court Unity Precedents (`iran_rulings_v1`)
- **Document Type**: `UNITY_RULING` (رأی وحدت رویه هیئت عمومی دیوان عالی کشور)
- **Issuer**: General Board of the Supreme Court of Iran (دیوان عالی کشور).
- **Temporal Distribution**: Ruling No. 1 (1323 SH) through Ruling No. 845+ (1403 SH).
- **Binding Effect**: Equivalent to statute under Article 471 of the Criminal Procedure Code.

### D. Judiciary Circulars (`judiciary_circulars`)
- **Document Type**: `CIRCULAR` / `DIRECTIVE` (بخشنامه، دستورالعمل، دستور اداری)
- **Issuer**: Head of the Judiciary (رئیس قوه قضائیه).
- **Temporal Distribution**: Solar Hijri **1380 to 1403**.
- **Key Themes**: Execution of judgments, bail tariffs, court fees, electronic judicial services, arbitration directives.

---

## 3. High-Priority Issuing Authorities: Coverage & Gaps

Audit of issuing authorities explicitly prioritized for enterprise commercial and legal users:

| Issuing Authority | Iranian Name | Current Points | Target Coverage | Current Status & Critical Gaps |
|---|---|---:|---:|---|
| **Judiciary Head** | رئیس قوه قضائیه | 250 | 500+ | **Partial**: Historical circulars present; gaps exist in 1402–1403 guidelines on conciliation courts (دادگاه‌های صلح) and electronic service fees. |
| **Judiciary Legal Dept** | اداره کل حقوقی قوه قضائیه | 0 | 2,500+ | **CRITICAL GAP (0 points)**: Zero advisory opinions (نظریات مشورتی) in vector store. High user query frequency for procedural ambiguities. |
| **Council of Ministers** | هیئت وزیران | ~710 | 2,000+ | **Incomplete**: Annual tax and import tariff decrees present; missing dozens of executive bylaws under the 6th/7th Development Plans. |
| **Deregulation Board** | هیئت مقررات‌زدایی | ~85 | 300+ | **Partial**: Business licensing criteria partially indexed; missing recent decisions on national license portal (درگاه ملی مجوزها). |
| **Central Bank of Iran (CBI)** | بانک مرکزی | ~140 | 800+ | **Moderate Gap**: FX directives and basic lending rules present; missing credit facility settlement circulars and anti-money laundering bylaws. |
| **State Tax Administration (INTA)** | سازمان امور مالیاتی | ~210 | 1,000+ | **High Gap**: Moadian invoicing technical circulars present; missing extensive audit directives (دستورالعمل‌های رسیدگی) and High Council rulings (آرای شورای عالی مالیاتی). |
| **Social Security Org (SSO)** | سازمان تأمین اجتماعی | ~95 | 600+ | **High Gap**: Premium collection instructions partially indexed; missing Article 38 contract settlement circulars and book audit exemptions. |
| **State Registration Org** | سازمان ثبت اسناد و املاک | ~40 | 400+ | **High Gap**: Circulars regarding the 1403 Mandatory Real Estate Registration Act (قانون الزام به ثبت رسمی) are urgently needed. |
| **Administrative Court (General Board)** | دیوان عدالت اداری | ~280 | 1,500+ | **High Gap**: Annulment rulings of government bylaws (ابطال مصوبات) and unity precedents partially present; missing thousands of published rulings. |
| **Disciplinary Tribunals** | دادسرا و دادگاه انتظامی قضات / وکلا / کارشناسان | 0 | 500+ | **CRITICAL GAP (0 points)**: Disciplinary precedents for lawyers, judicial experts, and judges completely missing. |

---

## 4. Pending Relay Batches (#1345 & #1357)

Two staged pull requests currently await review and inclusion into the collection build pipeline:

- **PR #1345**: `data(legal): relay batch 2026-11-23 (1 files)`
- **PR #1357**: `data(legal): relay batch 2026-11-23 (1 files)` (duplicate/updated relay run)
- **Target File**: `data/legal/staged/law_watch_2026-11-22.jsonl`
- **Record Count**: **37 structured records**
- **Record Schema**: `record_type="law_change"`, `schema_version=1`, `status="proposed"`, `source="ekhtebar.ir"`.
- **Content Breakdown**:
  1. Civil Service & Public Employment: Maximum/minimum salary bylaws, State Employment Act amendments (قانون استخدام کشوری).
  2. Labor & Social Security: Public sector workforce adjustment rules (قانون نحوه تعدیل نیروی انسانی), survivor pension entitlement updates (حقوق وظیفه و مستمری وراث).
  3. Legislative Updates: Amendments to 1358 Revolutionary Council decrees and early parliamentary statutes.
- **Ingestion Condition**: All records require maintainer review and must be processed by the legal normalization pipeline before inclusion in collection rebuilds (`iran_laws_v7b` or `iran_regulations_v3b`).

---

## 5. Prioritized Gap Analysis Matrix (Ordered by User Impact)

All identified gaps are prioritized based on direct end-user query volume and potential legal liability:

| Priority | Legal Domain / Authority | User Impact | Estimated Target | Source Availability | Action Plan |
|:---:|---|:---:|---:|---|---|
| **1** | **Judiciary Legal Dept Advisory Opinions** (نظریات مشورتی اداره کل حقوقی) | **CRITICAL** | 2,500 points | **Already in raw files** (~28 MB in `data/legal` raw staging) | Ingest, parse into Q&A structure, embed with `bge-m3`, and create dedicated collection `legal_advisory_opinions`. |
| **2** | **Tax Circulars & Audit Directives** (بخشنامه‌ها و دستورالعمل‌های سازمان امور مالیاتی) | **CRITICAL** | 800 points | **Partial in raw files / Needs crawl** | Merge Moadian staging files (`moadian-technical-connection-14010422.txt`); crawl INTA official portal for 1402–1403 directives. |
| **3** | **Social Security Article 38 & Audit Circulars** (بخشنامه‌های درآمد و بازرسی دفاتر تأمین اجتماعی) | **HIGH** | 500 points | **Needs crawl** | Ingest raw circulars from Tamin database; extract contract withholding percentage schedules. |
| **4** | **Administrative Court Annulments** (آرای هیأت عمومی دیوان عدالت اداری) | **HIGH** | 1,200 points | **Already in raw files** (`admin_court_board_rulings_2026-10-12.jsonl` in staging) | Validate JSONL rows, clean HTML tags, and upsert into `iran_rulings_v1` or dedicated sub-collection. |
| **5** | **Mandatory Real Estate Title Directives** (مقررات و بخشنامه‌های قانون الزام به ثبت رسمی معاملات اموال غیرمنقول) | **HIGH** | 250 points | **Needs owner by hand** | Source official gazette instructions from State Registration Organization for 1403 transactions. |
| **6** | **CBI FX & Banking Directives** (مقررات ارزی و تسهیلاتی بانک مرکزی) | **MEDIUM** | 600 points | **Already in raw files** (`cbi_circulars_2026-10-14.jsonl`, `ekhtebar_api_tag_cbi_2026-10-22.jsonl`) | De-duplicate staging rows, verify date indexing, and merge into `iran_regulations_v3b`. |
| **7** | **Deregulation Board Resolutions** (مصوبات هیئت مقررات‌زدایی) | **MEDIUM** | 200 points | **Already in raw files** (`deregulation_board_2026-10-13.jsonl`) | Process staging JSONL into standard regulation format. |
| **8** | **Judiciary Disciplinary Precedents** (آرای دادگاه‌های انتظامی قضات و وکلا) | **MEDIUM** | 400 points | **Needs crawl** | Structured collection from legal education repositories. |

---

## 6. Data Hygiene & Security Compliance

- **Zero PII**: Strictly zero inclusion of individual litigant names, private national IDs, banking account numbers, or personal phone numbers.
- **Public Legal Documents Only**: All documents are official published normative acts (laws, bylaws, general circulars, published precedent abstracts).
- **Retrieval Engine Isolation**: This inventory represents factual data categorization. Engine routing changes remain strictly encapsulated within Smart Judge retrieval services (`regulations_retrieval.py`, `rulings_retrieval.py`, `catalog_intent.py`).
