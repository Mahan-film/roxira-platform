Next-Generation Automatic Data Migration Architecture for Multi-Tenant Accounting and ERP SaaS

Executive Summary and Architectural Blueprint

Building an autonomous, zero-defect data migration engine for a dual-market accounting and ERP platform—serving both the Iranian regulatory ecosystem (roxira.ir, requiring Persian RTL, Jalali calendars, exact bigint Rial accounting, Moadian e-invoicing, and Social Security Organization .DBF compliance) and international standards (roxira.net, supporting multi-currency IFRS and GAAP workflows)—requires decoupling untrusted file extraction from core transactional processing. The primary operational constraint of the current Roxira deployment is its single Hetzner host with approximately 20 GB of free disk space running Docker Compose across PostgreSQL, PgBouncer, Redis/BullMQ, Qdrant, LightRAG, NestJS, FastAPI, and Next.js. Attempting to restore a single Microsoft SQL Server .bak file or mount an .mdf database directly on this host will immediately exhaust disk capacity, trigger Linux out-of-memory (OOM) kills, and expose the multi-tenant host to severe container-escape and arbitrary code execution vulnerabilities.

The recommended architecture resolves this hardware and security constraint by establishing a four-plane, zero-trust pipeline. The Edge & Storage Plane utilizes Cloudflare R2 presigned multipart uploads to bypass the Hetzner disk entirely. The Ephemeral Extraction Plane dispatches on-demand Daytona sandboxes and memory-safe Rust and Python parsers to convert proprietary binary databases into normalized Apache Parquet files. The AI Schema & Mapping Plane implements the two-stage Small Language Model (SLM) retriever and Large Language Model (LLM) reranker pattern with LightRAG ontology grounding and strict Personally Identifiable Information (PII) masking. Finally, the Deterministic Ledger Verification & Commit Plane executes trial balance tie-outs, sub-ledger reconciliations, and PostgreSQL savepoint dry-runs before atomic tenant activation.

Text-Based Architectural Topology and Data Flow Specification

To provide a deterministic specification of the system topology in text, the table below defines the seven sequential stages of the migration pipeline, detailing the execution boundary, ingress and egress contracts, active processing logic, and failure recovery mechanisms at each stage.

Pipeline Stage	Execution Boundary	Ingress Contract	Active Components & Processing Logic	Egress Contract	Failure & Rollback Mechanism
Stage 1: Direct Edge Ingestion	Client Browser / On-Premise Agent \rightarrow Cloudflare R2	Raw files/folders up to 50 GB (.bak, .mdf, .accdb, .dbf, .sql, .xlsx, .zip)	Next.js client computes SHA-256 chunk hashes; requests presigned multipart URLs from NestJS; streams directly to Cloudflare R2 bucket with 7-day lifecycle TTL.	R2 Object Manifest JSON (tenant_job_id, s3_keys[], sha256, byte_size) queued in Redis BullMQ.	Resumable multipart upload; zero disk footprint on the 20 GB Hetzner server.
Stage 2: Format Triage & Sandbox Dispatch	Hetzner FastAPI Worker \rightarrow Daytona Cloud API	R2 Object Manifest JSON from BullMQ (migration:triage queue)	Inspects file magic bytes (first 16 KB via HTTP Range request from R2). Routes small flat files (<50 MB CSV/XLSX/DBF/SQLite) to local worker; dispatches binary DBs (.bak, .mdf, .dmp, large SQL) to Daytona Sandbox API.	Sandbox Execution Spec (vCPU, RAM, parser_image, r2_presigned_read_url).	BullMQ exponential backoff; automatic fallback from native Rust parser (mtf-rs) to disposable MSSQL Linux container inside Daytona.
Stage 3: Isolated Extraction & Normalization	Daytona Ephemeral Sandbox (External Isolated Compute)	Presigned R2 Read Stream (Range or full download to sandbox NVMe)	Restores .bak/.mdf in network-jailed mcr.microsoft.com/mssql/server:2022-latest (MSSQL_PID=Express) or parses via mtf-rs/mdbtools/dbfread. Decodes Iran System (iran-encoding) and Windows-1256, converts Jalali dates, and writes Zstd-compressed Apache Parquet + schema_profile.json.	Standardized Parquet tables + schema_profile.json written to R2; sandbox destroyed immediately (~90ms teardown).	Hard sandbox timeout (30 min); memory/disk quota enforcement; zero persistence of untrusted binaries after teardown.
Stage 4: Source Fingerprinting & AI Schema Mapping	Hetzner FastAPI AI Core + Qdrant + LightRAG + ZDR LLMs	schema_profile.json (DDL, column names, types, null ratios, masked regex patterns—no raw PII)	Fingerprints known ERPs (e.g., Sepidar ACC.Account, RPA.PaymentCheque) via LightRAG knowledge graph. Runs Magneto pattern: BGE-M3/Jina embeddings in Qdrant retrieve top-k candidate mappings; ZDR LLM (Groq/SambaNova/Paid Gemini Flash) reranks and emits declarative JSON transformation contract.	Versioned MappingContract.json (source-to-target column rules, value lookups, confidence scores).	OmniRoute / LiteLLM auto-fallback across ZDR providers on HTTP 429; strict schema validation via Pydantic.
Stage 5: Deterministic DuckDB Transformation & Audit	Hetzner FastAPI Worker (Streaming over R2 Parquet)	R2 Parquet files + MappingContract.json	Executes vectorized SQL transformations via DuckDB (reading R2 Parquet in-stream with <500 MB disk spill). Casts currency to exact bigint Rial (detecting Toman 10\times discrepancies), links headers to lines, and runs Trial Balance, Sub-Ledger, and Benford's Law (\text{MAD}) checks.	Staged canonical Parquet files + ReconciliationReport.json (Trial Balance delta, orphan FKs, duplicate hashes, anomalies).	Deterministic halt if \sum \text{Debit} \neq \sum \text{Credit} or sub-ledger variance \neq 0; routes exceptions to human workbench.
Stage 6: Collaborative Exception Resolution & Savepoint Dry-Run	Next.js App Router UI \rightarrow NestJS Backend \rightarrow PostgreSQL	ReconciliationReport.json + Staged Canonical Parquet	User reviews unmapped columns, unbalanced vouchers, or opening balance cutoffs in shadcn/ui workbench. NestJS opens a PostgreSQL transaction, executes SAVEPOINT migration_dryrun, bulk-loads via COPY, runs all domain DTO/constraint checks, and executes ROLLBACK TO SAVEPOINT.	Verified DryRunCertificate.json with zero constraint violations and signed user approval token.	ROLLBACK TO SAVEPOINT migration_dryrun guarantees zero dirty writes or sequence pollution in PostgreSQL.
Stage 7: Idempotent Commit & Reversal-Safe Rollback	Hetzner NestJS + PostgreSQL (via direct connection bypassing PgBouncer transaction pool)	Approved DryRunCertificate.json + Staged Canonical Parquet	Streams approved records into tenant tables tagged with migration_batch_id and deterministic source_row_hash (ON CONFLICT DO NOTHING). Locks historical fiscal periods and generates immutable cryptographic Audit Evidence PDF/JSON.	Live, balanced Roxira tenant + signed Audit Evidence Package stored in R2.	Pre-activation: DELETE WHERE migration_batch_id = X. Post-activation (after user transactions): automated contra-voucher reversal batch.

1. Safe Ingestion of Untrusted Database Files

Accepting arbitrary database backups and binary storage files—including Microsoft SQL Server .bak and .mdf/.ldf files, Microsoft Access .accdb/.mdb files, FoxPro/dBase .dbf files, Oracle .dmp exports, and MySQL or PostgreSQL dumps—from untrusted uploads introduces two existential risks to a multi-tenant SaaS running on a single server with 20 GB of free disk: resource exhaustion via decompression bombs or transaction log expansion, and remote code execution (RCE) via database engine recovery features or parser memory corruption.

Binary Format Mechanics and Security Threat Surface

Microsoft SQL Server .bak files utilize the Microsoft Tape Format (MTF) to encapsulate raw 8 KB database pages and transaction log records, whereas .mdf (Master Database File) and .ldf (Log Database File) artifacts represent raw on-disk page structures. When a SQL Server instance restores a .bak or attaches an .mdf, the engine executes recovery phases (Analysis, Redo, and Undo) to bring system catalogs online. Untrusted .bak and .mdf files introduce four distinct attack vectors during this process. First, path traversal via physical file names occurs because a .bak header embeds the original physical file paths from the source machine, such as C:\Sepidar\Data\Sepidar04.mdf. A maliciously crafted backup can specify Linux system paths like /var/opt/mssql/mssql.conf in its embedded file list; restoring the archive without first inspecting headers via RESTORE FILELISTONLY and explicitly remapping every logical file using WITH MOVE 'LogicalName' TO '/var/opt/mssql/data/safe_uuid.mdf' enables arbitrary file overwrite under the mssql user context. Second, attached databases may contain UNSAFE Common Language Runtime (CLR) assemblies, startup stored procedures, DDL triggers, or xp_cmdshell configurations engineered to execute operating system commands upon database access. Third, malformed page headers or corrupted Log Sequence Number (LSN) chains inside .mdf and .ldf files can trigger buffer overflows or memory corruption inside the sqlservr binary during the Redo and Undo recovery phases. Fourth, C-based open-source parsers for legacy formats—most notably mdbtools for Microsoft Access—carry a documented history of stack and heap buffer overflows, such as CVE-2016-6354, when parsing crafted table definitions or memo fields. Similarly, untrusted SQL dumps (.sql) for MySQL or PostgreSQL can embed administrative directives (COPY ... FROM PROGRAM, INTO OUTFILE, \! meta-commands in psql, or DEFINER triggers) that achieve immediate code execution if piped into a privileged client.

Comparative Evaluation of Extraction Architectures

Evaluating the four viable extraction paradigms—Disposable Database Containers, MicroVM Isolation (Firecracker and gVisor), Managed Cloud Sandboxes (Daytona), and Native Format Parsers—demonstrates why heavy binary extraction must be decoupled from the core Hetzner host.

Disposable Database Containers (mcr.microsoft.com/mssql/server, Oracle Free, MySQL, PostgreSQL)

Microsoft officially publishes Ubuntu- and RHEL-based Linux container images for SQL Server 2017, 2019, 2022, and 2025 (mcr.microsoft.com/mssql/server:2022-latest and 2025-latest), whereas the beta program for SQL Server on Windows containers was suspended in 2021 and remains unsupported for production workloads. Deploying the Linux container requires at least 2 GB of RAM and 2 GB of base disk space, alongside configuring --shm-size 1g—because Docker's default 64 MB /dev/shm allocation is insufficient to support Virtual Device Interface (VDI) backup and restore operations—and setting memory.enablecontainersharedmemory = true inside mssql.conf. Beginning with SQL Server 2019, containers automatically start as a non-root mssql user, and images from SQL Server 2019 CU 28 and 2022 CU 14 onward bundle the /opt/mssql-tools18/bin package (sqlcmd and bcp), which enforces mandatory TLS encryption by default unless explicitly overridden via the -No flag.

From a licensing standpoint, configuring MSSQL_PID=Developer or Evaluation via container environment variables grants no production use rights under Microsoft's End-User License Agreement. However, passing MSSQL_PID=Express launches SQL Server Express edition, which is free for production use up to its 10 GB per-database data file limit (excluding .ldf transaction logs). Despite this licensing viability, running disposable database containers locally on the Hetzner server is operationally perilous. Restoring a compressed 4 GB .bak file routinely expands into a 12 GB .mdf file and a 6 GB .ldf file, while enterprise MSSQL databases frequently reach 40 GB. Furthermore, container virtual block storage and overlay2 layers under heavy write-delete churn can fail to reclaim disk space without manual compaction. Consequently, executing mcr.microsoft.com/mssql/server or Oracle Database Free on the 20 GB Hetzner server will rapidly exhaust host storage and crash the primary PostgreSQL cluster.

MicroVM Isolation (Firecracker and gVisor runsc)

User-space kernels such as gVisor (runsc) intercept application system calls inside a memory-safe Go runtime, providing strong isolation for lightweight C (mdbtools), Java (Jackcess), or Python parsers on the Hetzner host with negligible disk overhead. However, SQL Server on Linux executes inside Microsoft's proprietary Drawbridge Platform Abstraction Layer (sqlpal), which relies on intensive memory-mapping, futex, and asynchronous I/O syscalls that experience severe performance degradation or syscall incompatibilities under gVisor. Hardware-virtualized microVMs via Firecracker boot in roughly 125 ms and support full Linux kernels, yet they require bare-metal KVM access (or suffer nested virtualization penalties on standard cloud instances) and still consume local Hetzner disk capacity for guest root filesystems and unpacked database files.

Daytona Cloud Sandboxes (Recommended Heavy Extraction Plane)

Daytona (github.com/daytonaio/daytona) provides an open-source, container-isolated elastic runtime engineered for untrusted code execution and agent workflows, featuring approximately 90 ms sandbox creation, persistent stateful workspaces, mid-execution snapshots, and a native Python integration (daytona-sdk). Daytona bills per second at $0.0504 per vCPU-hour, $0.0162 per GiB-hour of memory, and $0.000108 per GiB-hour of storage after the first 5 GiB free, with Windows OS environments priced at $0.0858 per vCPU-hour. Because Daytona includes $200 in free compute credits upon sign-up and offers up to $50,000 in free credits for startups, it aligns directly with Roxira's cost-minimization mandate. Restoring and extracting a 10 GB Sepidar or Rahkaran .bak archive inside a 4 vCPU, 8 GiB RAM, 40 GiB disk Daytona sandbox running for 6 minutes (0.1 hours) incurs a total compute and storage cost of:


$$\text{Cost} = 0.1 \times (4 \times \$0.0504 + 8 \times \$0.0162 + 35 \times \$0.000108) = \$0.0335 \text{ per migration}$$


At approximately 3.3 cents per database extraction—allowing the initial $200 credit to cover nearly 6,000 migrations—Daytona completely isolates the Hetzner server from disk exhaustion and binary exploits.

Native Binary Parsers (Zero-Engine Extraction)

Rather than booting a relational database engine, native binary parsers extract records directly from underlying file pages. For Microsoft SQL Server, the open-source Rust crates mtf-rs (github.com/rroohhh/mtf-rs) and mdf-rs provide an MTFPageProvider capable of parsing Microsoft Tape Format (.bak) streams and 8 KB .mdf data pages directly without unpacking the .bak file or starting SQL Server. Similarly, PowerShell's open-source dbatools (Read-DbaBackupHeader) and raw byte-offset inspection scripts can read .bak headers directly from S3 or R2 streams without SQL Server overhead. Because proprietary formats are complex to reverse-engineer completely and mtf-rs/mdf-rs are modular building blocks that may not cover every SQL Server page compression or encryption variant, the optimal strategy runs mtf-rs as a zero-copy fast path inside Daytona, falling back automatically to the mcr.microsoft.com/mssql/server container if compressed or complex recovery pages are encountered. For Microsoft Access (.mdb, .accdb), Jackcess (pure Java, Apache 2.0) provides memory-safe extraction, while mdbtools (C, LGPL/GPL) must be restricted to Daytona or gVisor containers to contain buffer overflow vulnerabilities like CVE-2016-6354. For FoxPro and dBase (.dbf) files—critical for Iranian Social Security (DSKKAR00.DBF, DSKWOR00.DBF) and DOS accounting packages—pure Python dbfread paired with iran[span_116](start_span)[span_116](end_span)-encoding decodes tables safely in memory. For MySQL and PostgreSQL .sql dumps, a streaming token parser extracts INSERT INTO and COPY data blocks directly into Parquet while rejecting \!, INTO OUTFILE, and COPY FROM PROGRAM directives.

Format-by-Format Safe Extraction Matrix

Source Format	Primary Extraction Method	Fallback Extraction Method	Execution Location	Size Limit	Licensing & Legal Status	Mandatory Security Controls
MSSQL .bak / .mdf	Native Rust mtf-rs + mdf-rs streaming parser	mcr.microsoft.com/mssql/server:2022-latest (M[span_143](start_span)[span_143](end_span)SSQL_PID=Express for \le 10\text{ GB})	Daytona Sandbox (4 vCPU, 8 GiB RAM, --shm-size 1g)	10 GB (Express); >10 GB via mtf-rs or partitioned restore	mtf-rs: MIT/Apache; MSSQL Express: Free production use	--network=none during restore; RESTORE FILELISTONLY path remapping; DISABLE TRIGGER ALL; CLR disabled.
Access .mdb / .accd[span_133](start_span)[span_133](end_span)b	Jackcess (Java JVM memory-safe) or mdb-export (mdbtools)	Python pyodbc on Daytona Windows Sandbox ($0.0858/vCPU/h)	Hetzner (runsc gVisor jail) if <50 MB; Daytona if >50 MB	2 GB (Access format hard limit)	Jackcess: Apache 2.0; mdbtools: LGPL/GPL	Run mdbtools strictly in gVisor/Daytona to mitigate C buffer overflows (CVE-2016-6354).
dBase / FoxPro .dbf	Python dbfread + iran-encoding / cp1256 decoder	Rust dbf crate CLI	Hetzner FastAPI worker (streaming from R2)	2 GB per table	MIT License	Enforce decompression/row-count quotas; strip control bytes.
MySQL / Postgres .sql / .dump	Streaming AST/token parser (COPY / INSERT extractor)	Ephemeral postgres:16-alpine or mysql:8.4 container	Daytona Sandbox (or Hetzner runsc jail if parsed without DB engine)	50 GB (via R2 multipart streaming)	PostgreSQL / GPLv2 (Client/Container)	Reject \!, COPY FROM PROGRAM, INTO OUTFILE, LOAD DATA LOCAL; run DB as unprivileged read-only user.
Oracle .dmp (DataPump / exp)	Ephemeral container-registry.oracle.com/database/free (impdp)	Python oracledb live extraction via Customer Sync Agent	Daytona Sandbox (requires 4 GiB+ RAM, 15 GiB disk)	12 GB user data limit on Oracle Database Free	Oracle Free License (allows development & production up to resource caps)	Execute impdp with EXCLUDE=TRIGGER,PROCEDURE,FUNCTION,PACKAGE,DB_LINK to prevent PL/SQL RCE.
Excel / CSV / ZIP (.xlsx, .csv)	Rust calamine (via Python fastexcel / polars)	DuckDB spatial/excel reader	Hetzner FastAPI Worker (<50 MB) or Daytona (>50 MB)	1 GB uncompressed	MIT License	Enforce zip-bomb compression ratio (<100:1), max XML entity expansion (defus[span_42](start_span)[span_42](end_span)edxml), formula injection stripping (=, +, -, @).

2. Automatic Schema Understanding and Mapping Architecture

Classical automated schema matching relied on lexical string similarity, structural graph alignment (COMA++, Cupid, S-Match), or pre-trained language models (BERT, SBERT). Primary benchmarks published between 2024 and 2026 prove that Large Language Models deliver a categorical leap in schema matching accuracy when deployed inside a hybrid retriever-reranker and formal verification pipeline rather than via naive zero-shot prompting.

Empirical Evidence and Recent Benchmarks (2024–2026)

Recent peer-reviewed studies establish concrete design parameters for Roxira's schema engine. On PowerPlantBench (ACM SIGENERGY Energy Informatics Review, September 2026), researchers evaluated classical matchers against LLMs across real-world registries. While BERT achieved a Macro-F1 of 0.514 (Precision 0.698, Recall 0.474) and the strongest classical baseline (SBERT) reached 0.617, frontier LLMs (Claude Sonnet 4 and GPT-5.2-Codex) reached 0.932—a +31.5 percentage point improvement confirmed as statistically significant via Wilcoxon signed-rank tests. Every evaluated LLM scored at least 0.736, proving that even a 4B-parameter Small Language Model outperforms all classical methods. Moreover, as schema disambiguation difficulty increased, classical matcher performance degraded steeply ($r = -0.84, R^2 = 0.70$), whereas LLMs remained resilient ($R^2 = 0.02$). On the hardest registry where the best classical matcher scored $F_1 = 0.56$, five LLMs solved the mapping perfectly ($F_1 = 1.00$) when prompted with representative sample values.

Passing an entire 2,000-column ERP schema into an LLM prompt, however, triggers context dilution, high latency, and hallucinations. To achieve scalability, Magneto (Liu, Pena, Santos, Wu, & Freire, PVLDB Vol. 18, 2025; arXiv:2412.08194) introduces a two-stage architecture that pairs a fine-tuned Small Language Model retriever with a Large Language Model reranker (Magneto-llm). Magneto uses an LLM offline to generate synthetic training variations for contrastive SLM fine-tuning, serializing columns with the Srepeat pattern (repeating the column name alongside data types and frequent values that act as inter-column anchors). Measuring Mean Reciprocal Rank (MRR) and Recall at Ground-Truth Size (Recall@GT), Magneto achieves high accuracy across complex benchmarks at a fraction of pure-LLM cost. Complementing Magneto, ReMatch (arXiv:2403.01567) introduced retrieval-enhanced schema matching without predefined training data, while Matchmaker (Seedat & van der Schaar, ICLR 2025 submission) demonstrated that off-the-shelf baselines like ReMatch and LLM-DP still struggle on complex m:1 mappings unless enhanced by compositional language model programs with zero-shot synthetic self-improvement.

At the workflow and integration layer, SINT-Flow (Schema Integration using Large Language Model Workflows, arXiv:2607.24492, accepted at EDBT 2027) achieves 83% accuracy on end-to-end schema mapping. Its companion benchmark, MaDI-Bench and the PyDI toolkit from the University of Mannheim (github.com/wbsg-uni-mannheim/MaDI-Bench), provide standardized evaluators (SchemaMappingEvaluator) across schema matching, value normalization, entity matching, and data fusion. For massive enterprise schemas like SocialDB (17,844 schema elements), LinkAlign (github.com/Satissss/LinkAlign, October 2025) narrows the performance gap between full and perfect schema contexts by 50%, reaching state-of-the-art execution accuracy of 33.09% on Spider 2.0-Lite using open-source LLMs and 71.83% on the BIRD benchmark. Crucially, replacing single-model self-consistency with cross-consistency across different LLMs raises execution accuracy on Spider to 87.6%, while dynamic knowledge graph schema induction achieves 92% semantic alignment with human-crafted schemas. Finally, because generating formally verifiable code remains difficult for LLMs (VeriEquivBench, October 2025), Pinto et al. (LLM-generated Schema Matching with Formally Verifiable Explanations, May 2026) demonstrate that LLMs must emit formally verifiable declarative mapping explanations and invertibility proofs rather than mutating records directly. Similarly, zero-shot entity matching benchmarks (arXiv:2610.34626, October 2026, evaluating decision models against generative reasoning models like GPT-6 Luna) confirm that while generative LLMs handle unseen entities robustly, invoking an LLM per record pair is prohibitively expensive compared to schema-level rule generation.

Five-Layer Schema Understanding Architecture on Roxira's Stack

Synthesizing these findings onto Roxira's existing stack (FastAPI, Qdrant, LightRAG on PostgreSQL, and LiteLLM) yields a five-layer architecture. In Layer 1 (Deterministic Statistical Profiling & Inter-Column Anchor Extraction), a Python DuckDB/Polars worker scans the extracted Parquet files to compute column data types, null ratios, uniqueness cardinality, numeric distributions, regex format masks (detecting 10-digit Iranian National IDs, 24-digit IR IBANs, and Jalali dates), and Inclusion Dependencies (Jaccard overlap of distinct values across columns to infer undocumented foreign keys in .dbf and legacy Delphi tables).

In Layer 2 (LightRAG Source Fingerprinting & ERP Ontology Graph), LightRAG on PostgreSQL stores Roxira's canonical target schema alongside known ERP templates. When table signatures such as ACC.Account, ACC.AccountTopic, and RPA.PaymentCheque appear, deterministic graph matching identifies Sepidar System and applies pre-verified column mappings for known tables without consuming LLM tokens.

In Layer 3 (Magneto-Style Dense Retrieval in Qdrant), unmapped or customized columns (such as Rahkaran فرمساز tables or ad-hoc Excel files) are serialized using Magneto's Srepeat format combined with Parciak et al.'s (arXiv:2407.11852) Persona and Meta-Language prompt serialization. Embedded via multilingual Jina or BAAI/bge-m3 models in Qdrant, the retriever selects the top-5 candidate Roxira fields per source column.

In Layer 4 (Multi-LLM Cross-Consistency Reranker & Contract Generator), FastAPI routes the top-5 candidates through LiteLLM/OmniRoute to two independent Zero-Data-Retention (ZDR) LLM families (such as Llama-3.3-70B on Groq and DeepSeek-V3/Qwen on SambaNova). Applying the cross-consistency pattern, mappings where both models concur above a 0.90 threshold are auto-approved into a Pydantic-validated MappingContract.json specifying declarative field correspondences, currency multipliers, and date conversions.

In Layer 5 (Active-Learning Human Workbench & Persistent Mapping Memory), ambiguous mappings or trial balance exceptions surface in the Next.js shadcn/ui workbench. Adopting Odoo's base_import.mapping design, every confirmed user mapping is persisted to PostgreSQL and Qdrant to continuously improve future migrations.

3. Competitive Landscape: ERP Importers and Data Tools

Evaluating existing data integration and onboarding tools reveals a sharp architectural divide between continuous ELT pipelines, embedded CSV onboarding widgets, and native ERP importers.

Architectural Dissection of Existing Tools

Modern ELT platforms—including Airbyte, Meltano, Singer, and Fivetran—are engineered for continuous replication from cloud APIs and databases into analytical data warehouses rather than interactive, human-in-the-loop transactional ERP onboarding. Airbyte provides an open-source framework (architecturally similar to Stitch's Singer tap/target standard) with over 600 connectors and self-hosted control, while Fivetran delivers enterprise reliability across SQL Server Change Tracking, CDC, Binary Log Readers, and its proprietary Teleport Sync (which scans tables and diffs row hashes without database configuration changes). However, ELT platforms move tables 1:1 without enforcing cross-table double-entry accounting invariants, and self-hosting Airbyte's multi-container orchestrator would exhaust Roxira's 20 GB Hetzner server. Conversely, dlt (data load tool) is a lightweight, open-source Python library that embeds directly inside FastAPI workers to handle schema inference, cursor state, and Parquet normalization with minimal memory overhead.

In the customer-facing onboarding category, Flatfile (which rebranded at the corporate level to Obvious in 2025), OneSchema, and Osmos address the "dirty CSV/XLSX" problem. Flatfile offers a collaborative spreadsheet workspace, an AI Transform Agent, natural-language transformations, saved reusable transforms, and audit trails. However, procurement benchmarks (Vendr and Dromo analyses) show Flatfile floor pricing ranges from $6,000 to $50,000+ per year (with a Vendr median around $10,000/year and enterprise contracts exceeding $500,000/year), while its 2025 pivot toward a horizontal AI workspace ("Obvious") has introduced roadmap uncertainty for embedded importer developers. OneSchema includes SOC 2 Type 2 on its base tier and is rated easier to administer than Flatfile, but carries a higher median price, lacks Flatfile's multi-user collaborative workspace, and relies on client-side browser processing and JavaScript hooks that hit scale ceilings on large relational dumps. Neither tool supports binary .bak restores, Jalali calendars, Iran System encodings, or trial balance reconciliation.

Inspecting the source code of open-source ERP importers provides critical architectural lessons. Odoo's base_import module (odoo/addons/base_import/models/base_import.py) implements three essential patterns. First, it stages uploads in a TransientModel (base_import.import) with _transient_max_hours = 12.0 for automatic cleanup. Second, its Import.do() method implements a PostgreSQL Savepoint Dry-Run (dryrun=True): it executes self._cr.execute('SAVEPOINT import'), runs full data conversion (_convert_import_data, _parse_import_data) and ORM validation (model.load()), collects all domain errors, and when dryrun is enabled, executes self._cr.execute('ROLLBACK TO SAVEPOINT import') and clears the ORM cache (self.pool.clear_caches()). Third, upon a successful import, Odoo saves header-to-field correspondences into base_import.mapping to automate future imports.

Conversely, ERPNext / Frappe's data_import module (frappe/core/doctype/data_import/importer.py, v13–v16) illustrates three anti-patterns to avoid. First, import_data() iterates row-by-row through process_doc() and insert_record(), calling new_doc.insert() and firing live lifecycle hooks (run_before_save_methods(), run_post_save_methods(), on_update). During user or customer migrations, this triggers live side effects such as send_welcome_mail_to_user() / frappe.sendmail(), causing the entire import to crash with an unhandled exception if SMTP is unconfigured. Second, row-by-row ORM inserts and synchronous naming-series locks (set_name_by_naming_series) cause severe lock contention and background worker timeouts (rq.timeouts.JobTimeoutException: Task exceeded maximum timeout value (6000 seconds)), followed by cascading frappe.db.rollback() failures. Third, flattening parent-child tables (such as Journal Entry headers and child Accounts rows, or Sales Invoice items) into a single CSV produces frequent user errors whenever child ID or quantity columns are misaligned.

4. Master Comparison Table and Build, Adopt, or Avoid Strategy

Tooling and Component Comparison Matrix

Component / Tool	Category	License	Maturity	Cost Structure	Hosting & Resource Needs	Strategic Role in Roxira
Daytona (daytona.io)	Ephemeral Sandbox Runtime	Open Source (Apache 2.0) / Cloud	Production (~90ms spin-up, Python SDK)	$0.0504/vCPU/h, $0.0162/GiB/h RAM; $200 free credit (up to $50k startup)	Cloud API (Zero Hetzner disk/RAM usage)	ADOPT (Primary sandbox for .bak/.mdf/Oracle extraction)
MSSQL Linux Container (mcr.microsoft.com/mssql/server)	Disposable DB Engine	Proprietary (Free with MSSQL_PID=Express)	Production (Ubuntu 22.04/24.04, 2017–2025)	$0 (Express \le 10\text{ GB} data file)	Min 2 GB RAM, 2 GB Disk, 1 GB /dev/shm	ADOPT IN DAYTONA ONLY (Never run on 20 GB Hetzner host)
mtf-rs + mdf-rs	Native Rust MSSQL .bak/.mdf Parser	Open Source (MIT / Apache 2.0)	Beta / Building Block	$0	<100 MB RAM, streaming zero-unpack	ADOPT WITH FALLBACK (Fast path before MSSQL container)
iran-encoding (PyPI)	Legacy Persian Encoding Converter	Open Source (MIT)	Production (Pure Python, zero deps)	$0	Negligible (<10 MB RAM in FastAPI)	ADOPT (Mandatory for .DBF SSO & legacy DOS data)
python-zarnegar-converter	Zarnegar1 / Zarnegar75 Converter	Open Source (GPL-3.0)	Alpha/Beta (Zarnegar1 full, Zarnegar75 partial)	$0	Isolated CLI subprocess (due to GPL-3.0 license)	ADOPT AS ISOLATED CLI (Avoid linking GPLv3 into proprietary code)
dlt (da[span_43](start_span)[span_43](end_span)ta load tool)	Python Ingestion & Schema Normalization	Open Source (Apache 2.0)	Production	$0	Embedded Python library (<150 MB RAM)	ADOPT (Use inside FastAPI & Daytona extraction workers)
DuckDB	In-Process Analytical & Parquet Engine	Open Source (MIT)	Production	$0	Embedded library; streams R2 Parquet with strict memory cap	ADOPT (Use for staging transforms & Trial Balance math)
PyDI (uni-mannheim)	Schema Matching & Data Fusion Library	Open Source (Apache 2.0 / MIT)	Research / Production Ready (2025–2026)	$0	Embedded Python library in FastAPI AI Core	ADOPT PATTERNS (Evaluators, blocking, and fusion pipelines)
OmniRoute	Self-Hosted AI Gateway & Token Compressor	Open Source (MIT)	Production (v3.8.52+)	$0 (Saves 15%–95% tokens on tool outputs)	Docker container (<150 MB RAM on Hetzner)	ADOPT (Pair with LiteLLM; disable TOS-violating MITM stealth)
Airbyte (Self-Hosted)	ELT Data Replication Platform	Open Source (ELv2)	Production (600+ connectors)	$0 (OSS) / Usage-based Cloud	Heavy (Requires 4+ vCPU, 8–16 GB RAM, Temporal/Java stack)	AVOID (Too heavy for 20 GB Hetzner host; wrong UX for ERP import)
Flatfile (Obvious) / OneSchema	Embedded SaaS CSV Importer	Commercial SaaS	Production (Flatfile pivoted to Obvious in 2025)	$6,000–$50,000+/yr (Median ~$10,000/yr)	Cloud SaaS (Client-side JS bottlenecks on large dumps)	AVOID (Expensive, CSV-only, lacks relational/ledger/Persian support)
Odoo base_import Pattern	Savepoint Dry-Run & Mapping Memory	LGPL-3.0 (Reference Architecture) 	Production (Odoo 13–18)	$0 (Architectural Pattern)	Native PostgreSQL SAVEPOINT + NestJS service 	BUILD / ADAPT (Implement natively in NestJS + PostgreSQL)

Build, Adopt, or Avoid Decisions

The strategic allocation of engineering effort across building, adopting, or avoiding specific technologies is summarized below.

#### Technologies to Adopt
Roxira should immediately adopt Cloudflare R2 presigned multipart streaming to eliminate local disk usage on the 20 GB Hetzner host, pairing it with Daytona Cloud Sandboxes (daytona-sdk) running mtf-rs and mcr.microsoft.com/mssql/server:2022-latest (MSSQL_PI[span_91](start_span)[span_91](end_span)D=Express) to extract untrusted .bak, .mdf, and .dmp files into Zstd-compressed Parquet. Within the Python FastAPI workers, the team should adopt dlt for schema normalization, DuckDB for in-stream analytical SQL verification over R2 Parquet, fastexcel (calamine) for memory-safe Excel parsing, dbfread paired with iran-encoding for legacy Persian FoxPro/SSO files, and PyDI's SchemaMappingEvaluator for benchmarking. For AI routing, the team should adopt OmniRoute alongside LiteLLM to compress verbose tool context (saving 15%–95% of tokens) and auto-failover across Zero-Data-Retention providers while disabling OmniRoute's antigravity-mitm stealth module.

Capabilities to Build

Roxira should build its core competitive differentiators in-house: first, the Iranian & International ERP Playbook Knowledge Graph inside LightRAG, codifying exact table/column mappings for Sepidar (ACC, RPA, SLS, AST, POM, DST, PAY, GNR), Rahkaran, Mahak, SSO (DSKKAR00.DBF, DSKWOR00.DBF), Moadian, QuickBooks, Xero, Odoo, and ERPNext; second, the Magneto Two-Stage Schema Matcher in FastAPI and Qdrant (Srepeat column serialization + multilingual embeddings + multi-LLM cross-consistency reranking); third, the Deterministic Accounting Verification & PostgreSQL Savepoint Engine in NestJS (executing trial balance tie-outs, Rial/Toman $10\times$ scale detection, Odoo-style SAVEPOINT dry-runs, and reversal-only post-activation rollbacks); and fourth, a lightweight Windows On-Premise Sync Agent in Go or Rust implementing SQL Server Change Tracking (CT) and Fivetran-style Teleport Sync over outbound HTTPS.

Architectures and Vendors to Avoid

Roxira must strictly avoid running mcr.microsoft.com/mssql/server, Oracle, or MySQL containers directly on the 20 GB Hetzner host; avoid deploying heavyweight ELT orchestrators like self-hosted Airbyte on the primary server; avoid purchasing $10,000+/year CSV SaaS widgets (Flatfile/Obvious, OneSchema) that cannot handle relational backups or double-entry accounting math; avoid ERPNext's row-by-row insert_record() ORM loop that fires live email hooks and times out on naming locks; and avoid sending raw customer records to unpaid/non-ZDR LLM tiers (such as Free Google AI Studio or DeepSeek Direct).

5. Proving Accounting Migration Correctness

Unlike general database migrations where minor record drops are tolerable, an accounting migration with a 1-Rial discrepancy or an unlinked sub-ledger item invalidates statutory financial statements and tax declarations. Because Roxira enforces exact bigint money, period locks, and reversal-only corrections, migration correctness must be proven mathematically and cryptographically prior to unlocking the tenant.

Multi-Level Trial Balance and Currency Scale Invariants

For every migrated fiscal year ($y$), accounting period ($p$), and journal voucher ($v$), the DuckDB verification engine evaluates two strict accounting invariants over the staged canonical Parquet tables before touching PostgreSQL:


$$\forall v \in \text{Vouchers}: \quad \sum_{i \in \text{Lines}(v)} \text{Debit}_{v,i} - \sum_{i \in \text{[span_21](start_span)[span_21](end_span)Lines}(v)} \text{Credit}_{v,i} = 0 \quad (\text{in exact } \texttt{bigint} \text{ units})$$

$$\forall a \in \text{Accounts}, \forall p \in \text{Periods}: \quad \text{ClosingBalance}^{\text{Source}}_{a,p} = \text{OpeningBalance}^{\text{Roxira}}_{a,p} + \sum_{t \in p} \left(\text{Debit}^{\text{Roxira}}_{a,t} - \text{Credit}^{\text{Roxira}}_{a,t}\right)$$


In Iranian accounting packages such as Sepidar (ACC.AccountTopic and ACC.Account) and Rahkaran, the Chart of Accounts spans four hierarchical levels: Group (گروه), General Ledger / Kol (کل), Subsidiary / Moein (معین), and Detailed / Floating Tafzili (تفصیلی شناور). The reconciliation engine verifies zero variance across all four levels simultaneously. Crucially, the verifier also executes a Rial vs. Toman ($10\times$) Scale Invariant Check: Iranian businesses frequently record sub-ledger sales spreadsheets in Tomans ($1\text{ Toman} = 10\text{ Rials}$) while maintaining the General Ledger and Moadian tax filings in Rials. By comparing sub-ledger invoice totals against GL control postings, the engine automatically detects systematic $10^1$ (Toman) or $10^4$/$10^6$ (reporting unit) scaling ratios and prompts the user to apply a deterministic $\times 10$ bigint conversion rule.

Opening Balance Cutover and Five-Way Sub-Ledger Tie-Outs

When migrating a business with multiple years of history, replaying years of ancient operational documents through current validation rules is error-prone. The recommended cutover architecture imports the audited Closing Operation (سند اختتامیه / GNR.ClosingOperation in Sepidar) of the prior closed fiscal year as the verified Opening Balance Voucher (سند افتتاحیه) of the active fiscal year, while archiving prior years' GL vouchers into period-locked read-only partitions for historical reporting. Operational transactions from the start of the current fiscal year to the cutover date are imported in full, while any unsettled invoices, vendor bills, or uncleared post-dated cheques originating in prior closed years are imported as Open Sub-Ledger Cutover Items tied directly to the Opening Balance GL control accounts without double-posting.

Before commit, the engine enforces a Five-Way Sub-Ledger to GL Tie-Out:

1. Accounts Receivable (AR): The sum of open customer invoice balances (Invoice, CustomerReceiptInfo, Settlement) must equal the ARMoein and Customer Tafzili GL balances.

2. Accounts Payable (AP): The sum of open supplier bills (GNR.Bill, AcquisitionReceipt) must equal the AP Moein and Vendor Tafzili GL balances.

3. Bank & Cash Treasury: Every bank account (RPA.BankAccountBalance) and cash register (RPA.CashBalance) must reconcile to the exact Rial against its GL ledger account.

4. Cheque Lifecycle State Machine: In Iranian treasury operations (RPA.PaymentCheque and receivable cheques), cheques transition across In Safe (نزد صندوق), In Collection (در جریان وصول), Cleared (وصول شده), Endorsed (خرج شده), Bounced (برگشتی), and Returned (عودت شده). The verifier validates that only uncleared/in-safe/in-collection cheques comprise the active open cheque sub-ledger balance.

5. Inventory FIFO Cost Layers: Because legacy Iranian systems like Sepidar often use Weighted Average (میانگین موزون) or manual production costing (رسید انبار از نوع تولید/ بهای تمام شده دستی) whereas Roxira uses strict FIFO, re-calculating historical movements under FIFO would alter historical Cost of Goods Sold (COGS) and break the trial balance. The migration engine therefore imports current on-hand quantities and unit cost layers at the cutover date as opening FIFO layers whose extended bigint value ties out exactly to vwInventoryDelivery and the Inventory GL control account.

Duplicate Detection, Savepoint Dry-Runs, Idempotent Restart, and Audit Evidence

To prevent duplicate imports across retries or overlapping files, every staged record receives a deterministic cryptographic hash $H_{\text{row}} = \text{SHA256}(\texttt{sou[span_64](start_span)[span_64](end_span)rce\_system} \parallel \texttt{source\_table} \parallel \texttt{source\_pk} \parallel \texttt{fiscal\_year} \parallel \texttt{normalized\_date} \paralle[span_65](start_span)[span_65](end_span)l \texttt{bigint\_amount})$ enforced by a UNIQUE (tenant_id, source_row_hash) constraint in PostgreSQL. For master data (Customers, Suppliers, Inventory SKUs) where legacy systems often contain duplicate rows with minor Persian spelling variations, a second tier uses PyDI blocking and Qdrant embedding similarity alongside National ID (کد ملی) and Economic Code (کد اقتصادی) matching to merge duplicates prior to voucher import.

During Stage 6, NestJS opens a dedicated non-pooled PostgreSQL connection (bypassing PgBouncer's transaction pooler) and executes Odoo's SAVEPOINT dry-run pattern (SAVEPOINT migration_dryrun $\rightarrow$ bulk COPY load $\rightarrow$ constraint and DTO validation $\rightarrow$ ROLLBACK TO SAVEPOINT migration_dryrun). During Stage 7 commit, BullMQ loads entities in topological order with chunk-level checkpoints (ON CONFLICT DO NOTHING), enabling idempotent restarts after any worker crash. If a tenant must be rolled back while still in MIGRATION_REVIEW status (before live user transactions or Moadian submissions occur), NestJS executes a clean batch deletion (DELETE WHERE tenant_id = $1 AND migration_batch_id = $2). Once the tenant is activated and period locks engage, rollback strictly adheres to Roxira's immutable ledger design by generating a batch of compensating contra-vouchers (سند معکوس). Finally, the platform emits a cryptographically signed Migration Audit Evidence Package (PDF and JSON stored in R2) recording input file SHA-256 hashes, the MappingContract.json, pre- and post-migration Trial Balances, sub-ledger tie-out proofs, and user sign-off timestamps.

6. Deep Dive: Iranian Legacy Systems, Schemas, and Legalities

Successfully migrating Iranian businesses requires precise handling of the database architectures and export paths of Sepidar, Rahkaran, Hamkaran System (Legacy Delphi), and Mahak, as well as regulatory .DBF and Moadian structures and legacy Persian character encodings.

Sepidar System (سپیدار سیستم آسیا) Database Structure

Sepidar System (a subsidiary of System Group) runs on Microsoft SQL Server (typically under the instance name SQL SERVER SEPIDAR), storing a dedicated pair of .mdf and .ldf files per company in paths such as C:\Sepidar\Data\Sepidar04.mdf. Users generate standard .bak backups via تنظیمات -> عملیات تهیه نسخه پشتیبان (Settings $\rightarrow$ Backup Operation). Primary catalog analysis of Sepidar04 confirms that Sepidar organizes its tables across 11 modular SQL Server schemas plus dbo base tables and reporting views:

Sepidar Schema Prefix	Module Domain	Verified Core Tables & Views in SQL Server (Sepidar04)	Roxira Target Module Mapping
ACC / dbo	General Ledger & Accounting (حسابداری)	ACC.Account (detailed/Tafzili accounts), ACC.AccountTopic (hierarchical COA Kol/Moein), dbo.' ACC # Voucher $' (accounting vouchers)	Core Ledger (accounts, vouchers, voucher_lines)
RPA	Receipt, Payment & Treasury (دریافت و پرداخت)	RPA.AccountType, RPA.Bank, RPA.BankBranch, RPA.BankAccount, RPA.BankAccountBalance, RPA.BankBill, RPA.BankBillItem, RPA.Cash, RPA.CashBalance, RPA.ChequeBook, PaymentCheque, CustomerReceiptInfo, Settlement	Treasury, Bank Reconciliation & Cheques (bank_accounts, cheques, settlements)
SLS	Customers & Sales (مشتریان و فروش)	Invoice, vwInvoice (reporting view), SalesLimit, SLS.AdditionFactor, SLS.AdditionFactorItem (invoice additions/deductions like VAT/discounts), SLS.Commission, SLS.CommissionArea, SLS.CommissionBroker, SLS.CommissionCalculation, SLS.CommissionCalculationInvoice, SLS.CommissionCalculationItem, SLS.CommissionCalculationXMLResult	Invoicing, VAT, Moadian & CRM (invoices, invoice_items, tax_factors)
AST	Fixed Assets (دارایی ثابت)	AST.Asset, AST.AssetClass, AST.AssetGroup, AST.AssetTransaction, AST.AcquisitionReceipt, AST.AcquisitionReceiptItem, AST.AssetRelatedPurchaseInvoice, AST.ChangeDepreciationMethod, AST.ChangeDepreciationMethodItem	Fixed Assets & Ledger Opening Balances
POM & Inventory	Suppliers, Purchasing & Inventory (تامین کنندگان و انبار)	POM.CommercialOrder, POM.CommercialOrderItem, POM.BillOfLoading, POM.BillOfLoadingItem, vwInventoryDelivery (comprehensive inventory delivery view)	Inventory FIFO & Purchasing (inventory_items, stock_movements)
DST & POS	Distribution & Point of Sale (پخش و صندوق)	DST.AreaAndPath, DST.ColdDistribution, DST.ColdDistributionInvoice, DST.Co[span_68](start_span)[span_68](end_span)ldDistributionReturnedInvoice, POS.Cashier	Invoicing & CRM
PAY & CNT	Payroll & Contracting (حقوق و دستمزد / پیمانکاری)	PAY.Branch (SSO branch), PAY.Calculation (payroll runs), CNT.ChangeItem, CNT.Coefficient	Payroll & SSO Lists (payroll_runs, sso_branches)
GNR & FMK	General & System Framework (عمومی و[span_69](start_span)[span_69](end_span) فریم‌ورک)	GNR.Bill, GNR.BillItem, GNR.CalculationElement, GNR.CalculationFormula, GNR.ClosingOperation (year-end close), GNR.Backup, GNR.AutomaticBackupConfig, FMK.ApiLog, FMK.CheckDataParity, FMK.CheckDataParityItem, User	Period Locks, Users & Migration Integrity

A critical architectural finding in Sepidar's FMK schema is the presence of FMK.CheckDataParity and FMK.CheckDataParityItem alongside official warnings that manual SQL scripts or file alterations will corrupt the database and cause the software to halt. Consequently, Roxira's sync agent must never write to or create triggers inside a live Sepidar database; all extraction must use read-only queries or detached .bak files, leveraging Sepidar's built-in reporting views (vwInvoice, vwInventoryDelivery) and API structures (FMK.ApiLog, l[span_71](start_span)[span_71](end_span)aravel-sepidar).

Rahkaran (راهکاران), Hamkaran Legacy (دلفی همکاران سیستم), and Mahak (محک)

System Group (همکاران سیستم) offers both legacy Delphi-based systems (دلفی همکاران سیستم) and its flagship enterprise ERP Rahkaran (deployed On-Premise and as راهکاران ابری Cloud) on Microsoft SQL Server (and Oracle in select large enterprises). Rahkaran spans General Ledger (دفتر کل), Sales (فروش), Procurement (تدارکات), Inventory & Costing (انبار و حسابداری انبار, بهای تمام شده), Treasury (دریافت و پرداخت), Payroll/Compensation (جبران خدمات), Personnel (کارگزینی), Fixed Assets (دارایی ثابت), VAT (مالیات بر ارزش افزوده), Moadian (ارتباط با سامانه مودیان), Distribution (پخش), Retail (خرده فروشی), and Public Sector Budgeting (کنترل بودجه و تامین اعتبار). Because Rahkaran includes a dynamic Form Builder (فرمساز راهکاران) and Rule Builder (قواعدساز راهکاران), enterprise deployments frequently contain custom schema extensions that require Roxira's Magneto LLM matcher alongside static playbooks. When customers on راهکاران ابری or restricted enterprise networks cannot export a raw .bak, Rahkaran provides Rahkaran Explorer (کاوشگر راهکاران) and an enterprise BI Data Warehouse (مخزن داده یکپارچه) capable of exporting unified datasets across both Rahkaran and legacy Delphi Hamkaran System into structured Excel, CSV, or SQL staging tables.

Mahak (نرم افزار حسابداری محک) is built in C# .NET on Microsoft SQL Server (historically bundling SQL Server 2005 and 2008 R2 Express and supporting multi-branch remote access via TSplus). Customers generate .bak or .zip backups either from inside the application (امکانات -> بازگردانی/ت[span_207](start_span)[span_207](end_span)هیه فایل پشتیبان) or via the standalone Tools\Tool_pack.exe utility (Option 3: Database Operations). Similarly, other common domestic packages such as Holoo (هلو / طرفه نگار) store data in SQL Server (Holoo.mdf and Holoo_log.ldf) or legacy Access .mdb/.accdb files; although the Holoo desktop client requires a physical USB hardware dongle (قفل سخت افزاری) to launch, its .bak and .mdf files are standard unencrypted SQL Server databases that extract cleanly inside Roxira's Daytona MSSQL sandbox.

Regulatory Formats (SSO .DBF, Moadian) and Legacy Persian Encodings

Iranian payroll compliance requires generating and reading Social Security Organization (سازمان تامین اجتماعی) monthly filings formatted as FoxPro/dBase DSKKAR00.DBF (workshop header summary) and DSKWOR00.DBF (employee monthly workdays, wages, allowances, and insurance IDs). Tax compliance requires Moadian (سامانه مودیان) e-invoicing fields, including the 22-character unique tax ID, 13-digit product/service IDs, and VAT breakdowns.

Extracting text from .DBF files and older SQL Server varchar columns requires a specialized three-stage Persian encoding normalizer in FastAPI. First, Iran System (ایران سیستم)—the legacy 8-bit DOS encoding used in DSKKAR00.DBF and DSKWOR00.DBF—stores Perso-Arabic letters in visual left-to-right order using distinct byte codes for initial/medial versus final/isolated cursive forms. Standard UTF-8 or cp1256 decoders corrupt Iran System text entirely; FastAPI must integrate the pure-Python iran-encoding package (zero external dependencies on PyPI) to perform symmetrical decoding and visual-to-logical bidirectional reordering. Second, if legacy Zarnegar (زرنگار — Zarnegar1 or Zarnegar75) files are uploaded, FastAPI must invoke python-zarnegar-converter strictly as an isolated CLI subprocess because the package is licensed under GPL-3.0. Third, all decoded Windows-1256 (cp1256) and Unicode strings must pass through a canonical Persian character normalizer that converts Arabic Yeh (ي U+064A, ى U+0649) to Persian Yeh (ی U+06CC), Arabic Kaf (ك U+0643) to Persian Kaf (ک U+06A9), Persian/Arabic numerals (۰-۹, ٠-٩) to ASCII numerals in code/numeric columns, and standardizes Zero-Width Non-Joiners (U+200C).

From a legal standpoint, parsing .bak, .mdf, .dbf, or .xlsx files exported by the customer containing the customer's own accounting records is completely lawful. Conversely, reverse-engineering vendor .exe/.dll binaries, bypassing hardware dongles (قفل شکنی), or injecting unauthorized writes into live third-party databases must be strictly avoided. Customer cooperation is required only to trigger the standard backup export from Sepidar or Mahak menus, export reports from کاوشگر راهکاران if DBA access is restricted, or supply user-configured backup passwords.

7. Continuous On-Premise Windows Sync Under Iranian Network Constraints

When customers operate hybrid setups—such as keeping Sepidar POS or Mahak store terminals on-premise while running financial consolidation and Moadian tax filing in Roxira Cloud—continuous synchronization from Windows servers inside Iran is required.

Overcoming the SQL Server Express CDC Limitation

A foundational technical constraint documented in Microsoft SQL Server specifications is that native Change Data Capture (CDC) requires SQL Server Agent jobs to scan the transaction log and is NOT supported on SQL Server Express or Web editions (CDC is restricted to Enterprise and, since SQL Server 2016 SP1, Standard Edition). Because most Iranian SMBs running Sepidar, Mahak, and Holoo use SQL Server Express, any sync agent relying on Debezium or native CDC will fail in production.

To guarantee compatibility across all SQL Server editions without risking database corruption, the Roxira Windows Sync Agent (a single static Go or Rust Windows Service binary <15 MB) implements a three-tier change detection architecture modeled on Fivetran and Estuary. In Tier 1 (SQL Server Change Tracking CT), when the customer owns administrative rights on a database where metadata flags are permissible, the agent enables SQL Server Change Tracking (CT), which is natively supported on SQL Server Express without SQL Server Agent and tracks primary-key changes synchronously. Because SQL Server's default 3-day retention window causes data loss over multi-day Iranian holidays or internet outages, the agent configures a 14-day retention period and automatically triggers a full table resync if its cursor falls behind the valid window.

In Tier 2 (Fivetran-Style "Teleport Sync" Row-Hash Diffing — Default for Sepidar), because enabling CT or CDC requires altering database properties and requires primary keys on every table—which can trip Sepidar's FMK.CheckDataParity integrity checks—the agent defaults to Teleport Sync. Operating with zero schema or configuration modifications on the source database, the agent executes read-only SELECT ... WITH (NOLOCK) queries in paginated chunks, computes a fast 64-bit xxHash64 digest per row, and compares the hashes against a local SQLite state file on the Windows host. Only inserted, modified, or deleted rows are emitted into the delta stream. In Tier 3 (VSS Shadow Copy Binary Diffing), for locked FoxPro .dbf or Access .mdb files, the agent invokes the Windows Volume Shadow Copy Service (VSS) and uploads Zstd-compressed content-defined chunks.

All network egress uses outbound-only HTTPS/TLS 1.3 over Port 443 to roxira.ir (requiring zero inbound firewall ports or fragile VPN/SSH tunnels that are routinely throttled by Iranian DPI), using Zstandard dictionary compression over Apache Arrow/Parquet deltas and local SQLite store-and-forward chunking to survive intermittent connectivity.

8. Data Privacy and Free-Tier AI Security Governance

Roxira's LLM policy mandates using free tiers first and paid tiers only as fallback across Groq, Mistral, Google AI Studio, SambaNova, OmniRoute, OpenRouter, DeepSeek, AssemblyAI, Tavily, TinyFish, and Jina. However, accounting migrations contain sensitive trade secrets and PII. Routing customer data to free AI endpoints without strict contractual and technical controls exposes Roxira to severe privacy violations.

Provider Data Retention and Model Training Audit (2025–2026 Terms)

The table below synthesizes the verified data retention windows, model training policies across free and paid tiers, and assigned routing safety tiers for every provider in Roxira's key pool based on primary 2025–2026 Terms of Service and OpenRouter/privacy audits.

Provider	Assigned Roxira Safety Tier	Prompt Retention Window	Trains on Free / Unpaid Tier?	Trains on Paid Tier?	Key Contractual & Technical Nuances
SambaNova Cloud API	Tier 1: ZDR Safe	0 Days (Transient RAM only; billing metadata kept 90 days)	No	No	Verified Zero Retention and No Training across all inference endpoints.
Groq Cloud	Tier 1: ZDR Safe (with ZDR toggle)	0 Days (when ZDR enabled in Console Data Controls)	No (with ZDR enabled)	No	Must explicitly enable Zero Data Retention (ZDR) in console.groq.com/docs/your-data.
OmniRoute (Self-Hosted)	Gateway Layer	0 Days Local (AES-256-GCM key storage; telemetry off)	No (MIT Local Router)	No	Compresses tool outputs by 15%–95% (~89% avg); must disable antigravity-mitm header spoofing.
OpenRouter	Gateway Layer	0 Days (when routed with data_collection: "deny")	Upstream Dependent	No (with ZDR filter)	Enforces provider filtering so requests only route to verified ZDR backends like SambaNova/Groq.
Google AI Studio / Gemini API (Paid Billing Linked or EEA)	Tier 2: Paid Safe	24h RAM Cache + brief abuse log (30 days if Search Grounding used)	No (in EEA/UK/CH)	No	Linking a Cloud Billing account ($5 min prepay) or calling from EEA (Hetzner Germany) applies Paid Services terms (no training).
Mistral API	Tier 2: Paid Safe	30 Days	Yes (Free tier unless opted out)	No	Retain for fallback only on paid/opted-out keys.
AssemblyAI	Tier 2: Opt-Out Safe	Configurable TTL (retained unless deleted)	Opt-Out Required	No (when opted out)	Must enable Model Improvement Program opt-out in account settings.
Google AI Studio (Unpaid Outside EEA)	Tier 3: Metadata Only	55 Days	YES (+ Human Review)	N/A	Free tier trains models and allows human reviewers to read prompts; quota cut in Dec 2025 (~1M–1.5M tokens/day).
TinyFish / Tavily / Jina	Tier 3: Public Web Only	Varies by service logs	Service Improvement	Varies	TinySearch/TinyFetch are free within rate limits; use strictly for public tax/FX web lookups, never customer data.
DeepSeek Direct API	Tier 4: Restricted	Indefinite (Stored on servers in China)	YES	YES	April 2025 PIPC investigation confirmed prompt logging in China; run DeepSeek models only via SambaNova/Groq ZDR.

A critical actionable insight emerges from Google's Gemini API Terms of Service (ai.google.dev/gemini-api/terms): while unpaid Google AI Studio usage outside Europe retains prompts for 55 days and trains on user inputs with human review, Google's terms explicitly stipulate two protections. First, if the caller is located in the European Economic Area (EEA), Switzerland, or the United Kingdom—which applies directly to requests originating from Roxira's Hetzner server in Germany—the "Paid Services" data handling terms apply even to unpaid Google AI Studio and Gemini API quota. Second, linking at least one API project to an active Google Cloud Billing account (requiring only a $5 minimum prepay balance) transitions all AI Studio and API usage on that project to Paid Services terms, where Google is contractually prohibited from using prompts or outputs to train its models.

Three-Ring Data Sanitization Protocol

To enforce defense-in-depth, FastAPI applies a deterministic three-ring sanitization filter prior to LiteLLM/OmniRoute dispatch. In Ring 1 (Zero-Data Schema Prompts), requests contain only table names, column names, SQL data types, key topology, and synthetic structural regex masks (e.g., <PERSIAN_ORG_STRING_LEN_24>, <DIGIT_MASK_10_NATIONAL_ID>, <JALALI_DATE_YYYY_MM_DD>), which Parciak et al. (arXiv:2407.11852) prove is sufficient to bootstrap LLM schema matching without data instances. In Ring 2 (Low-Cardinality Enum & Anchor Values), when disambiguating opaque columns requires sample values (as shown on PowerPlantBench), the profiler only permits sending values from columns with fewer than 20 distinct values across 100+ rows (such as cheque status strings "وصول شده" or "برگشتی"), scrubbing all digits, National IDs, and proper names via regex and Persian-NER, and routing exclusively to Tier 1 (SambaNova, Groq ZDR) or Tier 2 (Billing-Linked EEA Gemini Flash) endpoints. In Ring 3 (Vision Document AI for PDFs/Images), where raw invoice images must be processed, LiteLLM hard-blocks all Tier 3 and Tier 4 providers, routing strictly to Billing-Linked EEA Gemini Flash or self-hosted OCR.

9. 2027 Accounting Platform Capabilities Ranked by Value and Proof

To establish market leadership by 2027, next-generation accounting capabilities must be ranked by tangible customer ROI and mathematical or empirical proof rather than vendor marketing claims.

Rank	Capability	Customer Value (Iran & International)	Empirical Proof & Technical Maturity	Implementation Architecture on Roxira Stack
1	Continuous Forensic Audit & Pre-Tax Anomaly Detection (Benford's Law + Isolation Forest + Moadian Validator)	Highest: Prevents tax audit penalties (جرایم مالیاتی ماده ۱۶۹ و سامانه مودیان), catches duplicate/split invoices, fabricated numbers, and migration scaling errors before period lock.	Proven (High Mathematical & Empirical Rigor): Grounded in First/Second/First-Two Digit Benford's Law (P(d_1 = i) = \log_{10}(1 + 1/i)), Mean Absolute Deviation (\text{MAD}), and Isolation Forests.	Python FastAPI worker running chirindaopensource/search_benford_law_compatibility / benfordslaw patterns + scikit-learn Isolation Forest over DuckDB ledger views.
2	Multimodal Document AI + Automated Bank & Moadian Three-Way Reconciliation	Very High: Eliminates 70%–85% of manual bookkeeping data entry by matching photographed Persian/English receipts, bank statements, and Moadian tax invoices directly to open sub-ledger items.	Proven in Production: Vision-Language Models + deterministic constraint solvers reliably extract structured fields when paired with exact math (Subtotal + VAT = Total) and database lookup anchors.	Paid/EEA Gemini Flash VLM extraction \rightarrow Qdrant fuzzy party/SKU matching \rightarrow deterministic bigint subset-sum matcher for bank statement clearing.
3	Agentic Financial Close (بستن حساب‌های ماهانه و سالانه هوشمند)	High: Compresses month-end and year-end close from 6–8 days to under 2 days by continuously monitoring unposted drafts, missing accruals, FX revaluations, and depreciation runs.	Emerging Commercial Proof (Medium-High): Deployed in 2026 by Stacks, FloQast, BlackLine, Digits (June 2026), Pilot, and KPMG Companion (April 2026). Caveat: Vendor claims of "<2 day close" depend heavily on clean COA setup and human approval gates.	BullMQ event-driven close checklist agents + NestJS segregation-of-duties approval workflows + automated reversal-safe draft voucher generation.
4	Governed Natural-Language Financial Reporting (Semantic-Layer Text-to-Analytics)	Medium-High: Enables CEOs and accountants to ask questions in Persian or English ("روند حاشیه سود ناخالص در سه ماهه اخیر به تفکیک مرکز هزینه") and receive instant drill-down charts.	Moderate Proof for Raw Text-to-SQL; High Proof for Semantic Layers: SOTA raw Text-to-SQL on BIRD is only 71.83% and Spider 2.0-Lite is 33.09% (87.6% on Spider 1.0 with multi-LLM cross-consistency). Unconstrained SQL generation is unsafe for financial statements.	Do not let LLMs write raw SQL over the ledger. Map NL queries via LightRAG + LinkAlign schema linking to governed NestJS DTO report templates and pre-verified DuckDB analytical views.

Mathematical Implementation of Rank 1: Forensic Anomaly Detection

During both migration verification and monthly close, Roxira's FastAPI worker executes the forensic statistical pipeline established in chirindaopensource/search_benford_law_compatibility. For any ledger account or transaction stream containing $N \ge 100$ non-zero amounts spanning multiple orders of magnitude, the engine extracts the first significant digit ($d_1 \in \{1..9\}$), second significant digit ($d_2 \in \{0..9\}$), and first-two significant digits ($d_{12} \in \{10..99\}$), comparing observed frequencies against the logarithmic expectation $P(d_1 = i) = \log_{10}(1 + 1/i)$ (where $d_1=1$ occurs ~30.1% of the time and $d_1=2$ occurs ~17.6% of the time). Because the classical Chi-Squared ($\chi^2 = \sum (O_i - E_i)^2 / E_i$) statistic suffers from excess power on large ERP tables, the engine evaluates the sample-size-independent Mean Absolute Deviation ($\text{MAD}$):


$$\text{MAD} = \frac{1}{K} \sum_{i=1}^{K} \left| f_{o,i} - f_{e,i} \right|$$


Paired with an Isolation Forest anomaly detector scoring round-number clustering, weekend/holiday posting timestamps, and split-invoice thresholds just below statutory audit limits, this module catches both mis-mapped migration columns and fraudulent accounting entries locally at zero LLM cost.

10. Phased Implementation Plan: 20 GB Hetzner Server vs. External Sandboxes

To respect the strict 20 GB free disk boundary on the Hetzner server, workloads are partitioned between the core host and external cloud infrastructure across a 12-week, four-phase engineering schedule.

Resource Allocation Boundary: Hetzner Server vs. External Cloud

Workload Component	Execution Environment	Peak Hetzner Disk	Peak Hetzner RAM	Architectural Justification
Raw Upload Storage & Parquet Staging	Cloudflare R2	0 MB	0 MB	Presigned multipart uploads stream directly from browser/agent to R2; 7-day auto-lifecycle deletes temporary artifacts.
MSSQL .bak/.mdf, Oracle .dmp, Large Access/SQL Extraction	Daytona Cloud Sandbox	0 MB	0 MB	MSSQL Linux requires \ge 2\text{ GB} disk + \ge 2\text{ GB} RAM + 1\text{ GB} /dev/shm + up to 40\text{ GB} restore space. Daytona spins up in ~90ms for ~$0.03/job.
Small Flat-File Parsing (<50 MB CSV, XLSX, DBF, SQLite)	Hetzner FastAPI Worker	<250 MB (tmpfs / streaming)	<300 MB	Streamed directly from R2 via fastexcel, dbfread, and iran-encoding without writing uncompressed files to disk.
Schema Profiling, DuckDB Reconciliation & Benford Audit	Hetzner FastAPI Worker	<500 MB (DuckDB temp spill cap)	<512 MB (SET memory_limit='512MB')	DuckDB queries Zstd Parquet files directly over HTTP/S3 from Cloudflare R2, computing Trial Balance and \text{MAD} in-stream.
LightRAG ERP Playbooks, Qdrant Embeddings & OmniRoute	Hetzner Existing Stack	<400 MB (Vector/Graph indices)	<350 MB	Reuses existing PostgreSQL, Qdrant, and LiteLLM services; OmniRoute adds <100 MB RAM in Docker.
Savepoint Dry-Run & Final Tenant Commit	Hetzner NestJS + PostgreSQL	~50–300 MB per active tenant	Existing PG Buffer Pool	Only verified, normalized, compact bigint ledger rows are committed to PostgreSQL; WAL bloat is prevented via staged Parquet validation prior to SAVEPOINT.

Four-Phase Rollout Schedule

During Phase 1 (Weeks 1–3: Zero-Disk Edge Ingestion, Persian Encoding Core & Deterministic Playbooks), the engineering team replaces the 40 MB one-shot upload limit in Next.js and NestJS with Cloudflare R2 presigned multipart streaming supporting archives up to 50 GB. Concurrently, FastAPI integrates iran-encoding, cp1256 Arabic-to-Persian character normalization, Jalali leap-year validation, and dbfread to unlock immediate SSO (DSKKAR00.DBF, DSKWOR00.DBF) and FoxPro imports, while LightRAG is seeded with the deterministic schema playbooks for Sepidar's 11 schemas, Odoo, ERPNext, QuickBooks, and Xero.

During Phase 2 (Weeks 4–6: Daytona Ephemeral Sandbox Integration & Binary DB Extraction), the team integrates daytona-sdk into the FastAPI BullMQ worker and builds the sandbox container image housing mtf-rs/mdf-rs, mcr.microsoft.com/mssql/server:2022-latest (MSSQL_PID=Express), Jackcess, mdbtools, and dlt. This phase delivers automated .bak header verification (RESTORE FILELISTONLY), safe path remapping (WITH MOVE), trigger/CLR disabling, and high-speed extraction to R2 Parquet.

During Phase 3 (Weeks 7–9: Magneto AI Schema Matcher, DuckDB Reconciler & Savepoint Workbench), the team deploys the Magneto two-stage matcher (Srepeat serialization + Qdrant candidate retrieval + Cross-Consistency LLM reranking via LiteLLM and OmniRoute across SambaNova, Groq ZDR, and Billing-Linked EEA Gemini Flash) alongside the Three-Ring PII Scrubber. In parallel, the DuckDB streaming Trial Balance, Sub-Ledger, Rial/Toman scale detector, and Benford's Law ($\text{MAD}$) verifier are wired into the Next.js shadcn/ui Exception Workbench and NestJS PostgreSQL SAVEPOINT dry-run engine.

During Phase 4 (Weeks 10–12: Windows On-Premise Sync Agent & Cryptographic Audit Evidence), the team releases the static Go/Rust Windows Sync Agent supporting SQL Server Change Tracking (CT on Express), Fivetran-style xxHash64 Teleport Sync for read-only Sepidar/Mahak/Rahkaran databases, and VSS shadow copies over outbound HTTPS port 443, concluding with the signed Migration Audit Evidence Package generator and post-activation contra-voucher reversal engine.

11. Test Datasets and Quantitative Acceptance Metrics

To validate the migration engine in CI/CD before production release, seven golden test suites and seven quantitative release gates must be enforced.

Golden Test Corpus Specification

The test suite comprises seven representative datasets. First, the Sepidar Multi-Module SQL Server Corpus (Sepidar04.bak & .mdf/.ldf) covers all 11 Sepidar schemas (ACC.Account, ACC.AccountTopic, dbo.' ACC # Voucher $', RPA.PaymentCheque across all 6 lifecycle states, SLS.AdditionFactor, AST.Asset, and vwInvoice/vwInventoryDelivery) with seeded Toman/Rial discrepancies. Second, the Rahkaran & Legacy Delphi Hamkaran Corpus includes کاوشگر راهکاران Excel/CSV exports and SQL dumps containing custom فرمساز columns and 22-character Moadian tax IDs. Third, the Mahak C# .NET Backup Corpus includes SQL Server 2008 R2 compatibility .bak and .zip archives generated via Tool_pack.exe. Fourth, the Iranian SSO & Legacy Encoding Torture Suite tests authentic DSKKAR00.DBF and DSKWOR00.DBF files encoded in Iran System and cp1256 alongside invalid Jalali leap-year dates (e.g., 1402/12/30). Fifth, the International ERP Corpus tests Odoo 18 Postgres dumps, ERPNext v15/v16 MariaDB dumps (with flattened accounts child tables), QuickBooks QBO/XLSX, and Xero CSV exports. Sixth, the Academic Benchmark Corpus runs subsets of MaDI-Bench and PowerPlantBench to prevent regressions in the Magneto AI matcher. Seventh, the Adversarial Security Corpus injects path-traversal .bak headers, UNSAFE CLR .mdf payloads, malicious \! SQL dumps, CVE-2016-6354 .mdb files, and 1000:1 .zip bombs.

Quantitative Acceptance Metrics (Release Gates)

Metric Category	Specific Measurement	Target Acceptance Threshold	Verification Method
Known ERP Schema Accuracy	Column mapping F1 score on fingerprinted ERPs (Sepidar, Odoo, ERPNext, SSO .DBF)	\ge 99.5\% Macro-F1 (Zero unmapped mandatory GL fields)	Automated CI evaluation against Golden Corpus Playbooks.
Unseen / Custom Schema Accuracy	Mean Reciprocal Rank (MRR), Recall@GT, and Macro-F1 on unseen/renamed tables (MaDI-Bench + Rahkaran فرمساز)	\ge 0.90 MRR@5 and \ge 0.85 Macro-F1 before human review	Automated SchemaMappingEvaluator.evaluate() in FastAPI test suite.
Accounting Mathematical Integrity	Post-migration Trial Balance variance (\sum \text{Debit} - \sum \text{Credit}) and Sub-Ledger to GL variance	Exact 0\text{ Rial} (0n bigint) variance across 100% of committed batches	Hard assertion in NestJS SAVEPOINT dry-run commit gate.
Persian Encoding & Jalali Fidelity	Character round-trip accuracy on Iran System and cp1256 strings; Jalali-to-UTC date conversion accuracy	100% lossless decoding; 100% detection of invalid Jalali leap dates	Unit test assertions using iran-encoding and reference Unicode strings.
Hetzner Host Resource Ceiling	Peak disk growth and peak worker RAM on the 20 GB Hetzner server during a 10 GB .bak migration	< 1.0\text{ GB} temporary Hetzner disk usage; < 1.0\text{ GB} FastAPI/DuckDB RAM	Prometheus / Docker stats telemetry during load test.
End-to-End Migration Throughput	Total wall-clock time from R2 upload completion to dry-run reconciliation report for a 1 GB .bak (1M ledger lines)	< 4\text{ minutes} (including ~90ms Daytona boot, MSSQL restore, Parquet dump, and DuckDB audit)	End-to-end Playwright + BullMQ integration benchmark.
Security & Privacy Isolation	Sandbox escape rate on Adversarial Corpus; PII token leakage rate to external LLM APIs	0 escapes (100% blocked); 0 raw PII tokens in LiteLLM/OmniRoute outbound logs	Automated regex/NER audit on all mocked LiteLLM outbound payloads.

12. Top Risks, Unknowns, and Unverified Claims

To maintain strict engineering transparency, the table below separates verified facts from vendor claims and documents proprietary unknowns that could not be independently verified from public sources.

Risk / Unknown Item	Classification	Detailed Technical Analysis & Impact	Concrete Mitigation Strategy
Undocumented Rahkaran (راهکاران) & Mahak (محک) Internal Table Schemas	Unverified Proprietary Internal	While Sepidar's exact SQL Server schema (ACC, RPA, SLS, AST, DST, POM, PAY, CNT, POS, GNR, FMK) is publicly documented in database analyses, System Group and Mahak Soft do not publish official DDL documentation for Rahkaran or Mahak internal tables.	Build a "Golden Sample Collector" in Phase 1: extract DDL (INFORMATION_SCHEMA.COLUMNS and foreign keys) from the first 3 consenting Rahkaran and Mahak customer .bak uploads inside Daytona to codify their exact playbooks into LightRAG, relying on the Magneto LLM matcher in the interim.
Sepidar FMK.CheckDataParity Exact Hashing Algorithm	Unverified Proprietary Internal	Primary sources confirm that Sepidar contains FMK.CheckDataParity and FMK.CheckDataParityItem tables and warns users that manual SQL changes corrupt the database. However, the exact cryptographic or checksum formula Sepidar uses to compute CheckDataParity is undocumented.	Enforce a 100% Read-Only Policy on live Sepidar databases. For continuous sync, use Fivetran-style SELECT ... WITH (NOLOCK) Teleport Sync (row hashing) rather than adding custom triggers or modifying Sepidar tables.
mtf-rs / mdf-rs Coverage on Compressed / SQL 2022–2025 .bak Files	Technical Risk (Experimental OSS)	mtf-rs and mdf-rs are open-source Rust crates designed as building blocks for parsing .bak and .mdf files directly without unpacking. They are not guaranteed to handle Microsoft's proprietary BACKUP ... WITH COMPRESSION algorithms, TDE encryption, or SQL Server 2025 page formats.	Treat mtf-rs strictly as a fast-path optimization. Wrap it in a fallback handler inside the Daytona sandbox that automatically restores via the official mcr.microsoft.com/mssql/server Linux container whenever mtf-rs returns an unsupported page/compression error.
PgBouncer Transaction Pooling Breaking SAVEPOINT Dry-Runs	Architectural Risk (Proven Fact)	Roxira uses PostgreSQL with PgBouncer. In transa[span_24](start_span)[span_24](end_span)ction pooling mode, PgBouncer reassigns server connections between transactions and does not support session-level state or long-running interactive savepoint inspection.	Configure a second, dedicated DATABASE_MIGRATION_DIRECT_URL in NestJS that connects directly to PostgreSQL (or a session-pooled PgBouncer port with max_connections = 5) exclusively for the BullMQ migration commit worker executing SAVEPOINT dry-runs.
Vendor Claims on "Agentic Close" (<2 Days) & "90% Web Agent Accuracy"	Vendor Claims vs. Proven Fact	Finance AI vendors claim agentic close cuts month-end from 6–8 days to <2 days, and TinyFish claims 90% web agent benchmark accuracy. Independent evaluations note that close speedups depend heavily on clean COA setup and human approval bottlenecks, and web agent benchmarks vary by target site protections.	Do not market "autonomous zero-human accounting." Position Roxira's Agentic Close and Migration Workbench as deterministic verification with AI-assisted exception resolution, keeping a mandatory human sign-off gate before period lock or Moadian submission.
Free-Tier LLM Rate-Limit Volatility & Silent Policy Shifts	Operational Risk (Proven Fact)	Google AI Studio cut free-tier quotas in December 2025 (increasing HTTP 429 errors) and removed free tiers from Gemini 3.1 Pro Preview. Relying on a single free provider will stall large schema migrations.	Prepay the minimum $5 on Google Cloud Billing (to unlock Paid Services privacy terms and Tier 1 rate limits of 100 RPM / 1M TPM) and combine Groq ZDR + SambaNova inside LiteLLM/OmniRoute with aggressive local Qdrant/LightRAG caching so 95%+ of known ERP columns require zero LLM tokens.

13. Conclusion

By combining Cloudflare R2 multipart streaming, Daytona ephemeral sandboxes (~90 ms spin-up at ~$0.03 per .bak extraction), DuckDB vectorized Parquet auditing, the Magneto SLM-retriever and Multi-LLM Cross-Consistency reranker architecture, and Odoo-style PostgreSQL SAVEPOINT dry-runs, Roxira can automatically ingest any legacy Iranian or international accounting database without risking the stability or 20 GB disk ceiling of its primary Hetzner server. Executing Phase 1 immediately—enabling R2 direct uploads, integrating iran-encoding for .DBF and legacy Persian text, codifying Sepidar's 11-schema catalog into LightRAG, and configuring Groq ZDR, SambaNova, and a $5 billing-linked EEA Gemini API key inside LiteLLM and OmniRoute—establishes a verifiable, zero-trust migration engine ready for enterprise scale.




Sources used in the report
  بررسی و تحلیل ساختار پایگاه داده سپیدار

  حل مشکلات فنی و دیتابیسی در سپیدار - حساب تیوب

  پروژه‌های فریلنسری باز و پروژه دورکاری - فریلنسیتو

  Packages for Laravel - Packalyst

  ارتباط SQL Server با نرم‌افزار سپیدار سیستم

  آموزش اتصال کلاینت به سرور در نرم افزار سپیدار

  زیر سیستم‌های سپیدار همکاران سیستم

  Reading SQL Server Backup file headers directly using PowerShell.

  klandermans/unraveling_sql_server_bak: Hacking SQL Server .bak

  rroohhh/mtf-rs: low level rust mtf parser library - GitHub

  How to import a .bak file of SQL Server to SAS? - SAS Communities

  Read-DbaBackupHeader | SQL Server automation with PowerShell

  مروری بر سیستم مدیریت پایگاه داده (DBMS)

  راهکاران همکاران سیستم

  همکاران سیستم – Telegram

  تحلیل آسان و تصمیم گیری دقیق - همکاران سیستم

  دوره آموزش الکترونیکی SQL مقدماتی - آپارات

  دسترسی از راه دور به نرم‌افزار محک - TSplus

  دانلود و نصب نرم‌ افزار محک | ابزارها و فایل‌های موردنیاز

  خرید نرم افزار حسابداری محک سری عمومی - تکنوسان

  ریکاوری بکاپ مالی و بازیابی اطلاعات برنامه حسابداری - مرکز هارد ایران

  ریکاوری بکاپ مالی و حسابداری - خانه هارد ایران

  ایتا - آموزشگاه فنی حرفه ای نوین صدرا

  iran-encoding · PyPI

  Docker: Run Containers for SQL Server on Linux - Microsoft Learn

  Docker Advice for SQL Server in Production

  Configure and customize SQL Server Linux containers

  Mac M2 could not start mcr.microsoft.com/mssql/rhel/server:2022

  Where is containers data stored? - Docker Desktop

  Dockerizing a large MSSQL Server database - Medium

  Windows 11 NVMe sector-size issue - From COBOL to SharePoint

  Deploy and Connect to SQL Server Linux Containers - Microsoft Learn

  microsoft/mssql-server - Docker Image

  Secure Infrastructure for Running AI-Generated Code - Daytona

  Daytona: specs, pricing & alternatives - CompareSandboxes

  Daytona is a Secure and Elastic Infrastructure for Running AI

  Add Daytona as a code execution sandbox backend #459 - GitHub

  CVE-2016-6354 Common Vulnerabilities and Exposures - SUSE

  LLM-generated Schema Matching with Formally Verifiable

  Evaluating Large Language Models for Schema Matching on Real

  Daily Papers - Hugging Face

  The Mannheim Data Integration Benchmark (MaDI-Bench ... - GitHub

  Schema Matching with self-improving compositional LLM programs

  MaDI-Bench: Mannheim Data Integration Benchmark - GitHub Pages

  Combining Small and Large Language Models for Schema Matching

  Entity Matching using Decision Models - arXiv

  Schema Matching with Large Language Models - arXiv

  SINT-Flow: Schema Integration using Large Language Model ... - arXiv

  SINT-Flow: Schema Integration using Large Language Model ... - arXiv

  Combining Small and Large Language Models for Schema Matching

  Paper on LLM-based Schema Integration accepted at EDBT 2027

  ReMatch: Retrieval Enhanced Schema Matching with LLMs - arXiv

  Google AI Studio Review (Oct 2026): Free Tier, Models, Cost

  Google AI Studio Pricing: Free Tier, API Costs & Limits | Deploybase

  Gemini API Additional Terms of Service | Google AI for Developers

  Data Privacy on AI Studio's Paid Plans [IMPORTANT]

  Gemini Zero Data Retention: Paid API vs Free Tier - Meetily

  Google AI Studio Complete Guide (2026) | Free Gemini API Access

  New Google AI Studio Terms Ban Consumer Use: The Developer

  Clarify use of user's code for training within the free quota on paid

  Privacy Policy - Resonant

  FAQs - Groq's Trust Center

  Best Data Mapping Tools 2026: Compare 8 Platforms

  7 Best Flatfile Competitors for Data Import (2026) - Improvado

  10 Best Data Migration Tools for Implementation Teams 2026

  Top 10 Alternatives to Manual CSV Uploads for Data Teams in 2026

  11 Best Data Transformation Tools for CSV Mapping (2026)

  The Top 5 ELT Tools for Data Ingestion (Sep 2025) - Portable.io

  SQL Temporal Tables vs Change Data Capture vs Change Tracking

  Best SQL Server CDC Tools in 2026, Compared - OLake

  SQL Temporal Tables vs Change Data Capture vs Change Tracking

  Implementing Change Data Capture in MS Databases - Medium

  10 Best SQL Server ETL Tools for CDC & Replication (2026) - Airbyte

  SQL Server Express Downgrade Check - Open VSX Registry

  Do I really need SQL Server Enterprise for our Data Warehouse

  DeepSeek Privacy Policy

  DeepSeek: configuring privacy and deploying a local version

  Is DeepSeek Safe? Does It Train on Your Data? | Sanitized Ai

  DeepSeek Harness | Privacy Policy

  models.py - Marcos Mendez Quintero / FoodCoops - GitLab

  Skip Invalid Rows While Importing - Odoo

  addons/base_import/static/src/import_model.js - Coopdevs GitLab

  erpnext/accounts/doctype/bank_statement_import ... - GitLab - Roduq

  Data import fails on `set_only_once` fields · Issue #52290 - GitHub

  ERPNext Data import failed - Frappe Forum

  Import customer - ERPNext - Frappe Forum

  ERPNext v15 data import child table "Accounts table cannot be blank."

  Data import error in user - ERPNext - Frappe Forum

  Error in importing data - Education - Frappe Forum

  Sales invoice import on erpnext cloud returns error - quantity cannot

  اتصال به سامانه مودیان و ارسال صورتحساب الکترونیکی با سی شارپ

  Privacy Policy | Infercom

  Provider Logging - Provider Data Retention Policies - OpenRouter

  Article 28 (3) General Data Protection Regulation (GDPR) - Infercom

  Data Controls - AssemblyAI

  How to Opt Out of Data Sharing for our Model Improvement Program

  Network & Software Engineer, IT Specialist in Tabriz - Ali Bafandeh

  Converter for Zarnegar Encoding and File Format to Unicode Text

  Zarnegar | Persian Computing Community by persian-computing

  Persian Computing - GitHub

  152227 – Add support for Zarnegar format - Bugzilla

  Survey of Language Computing in Asia

  KPMG LLP (US): AI Offerings and Features | Eminence

  BENFORDS LAW ANALYSIS - mail.innovation-line.com

  Python in Forensic Accounting Fraud Detection - Scribd

  GitHub - chirindaopensource/search_benford_law_compatibility

  benfords-law · GitHub Topics

  Analysis on financial fraud cases by Python Yuan Tao - Atlantis Press

  Evaluating the effectiveness of Forensic Analytics in Detecting and

  Best Agentic Close Platforms for Enterprise Finance Teams in 2026

  Best AI tools for month-end close (2026) | The Agent CFO

  AI Financial Close Automation 2026: CFO Evaluation Guide - Finrep.ai

  Best AI Agent Operator for Finance Workflows in 2026 - Hayat Amin

  Best AI Agent Accounting Software in 2026 - Bitwave

  Top 10 AI Tools for Month-End Close Automation 2026 Edition

  TinyFish Privacy Policy - How We Protect Your Data

  Best Web Search API For AI Agents 2026 - TinyFish

  TinyFish vs Browser Use: Features, Pricing and Scalability

  OmniRoute: The Free, Open-Source AI Gateway That Stops You

  Stealth Guide · diegosouzapw/OmniRoute Wiki - GitHub

  OmniRoute/docs/reference/API_REFERENCE.md at release/v3.8.52

  Tavily Platform Terms of Services




Sources read but not used
  Sell Offers Education Province Alborz - جویشگر

  Hello world! - Ramona Siebenhofer

  آموزش آپگرید ویندوز 10 به 11 و يا 11 به نسخه‌های جدیدتر آن در

  استخدام طراح سایت| استخدام برنامه نویس وب - جابینجا

  Archive of SID.ir Archive of SID.ir

  آموزش نصب SQL SERVER 2008 R2 - سپیدار سیستم

  دیتا سنتر چیست و چه ویژگی‌هایی دارد؟ - سپیدار سیستم

  آموزش کاربردی سپیدار

  کتاب آموزشی نرم افزار سپیدار همکاران سیستم

  محتواي آموزش الکترونیک سیستم جامع سپیدار سیستم آسیا

  آموزش نکات مهم نرم افزار مدیریت تردد سپیدار

  Read BAK with Python - RebaseData

  Ubuntu: Python to query .bak database (pyodbc) | by Flores - Medium

  Restore .bak file to MSSQL using Python - Stack Overflow

  پایگاه داده چیست؟ مفاهیم اصلی، اجزا و کاربردها - همکاران سیستم

  مدیریت داده چیست؟ Data Management انواع مدیریت داده - همکاران سیستم

  پایگاه داده یا Database چیست - موسسه پژوهش و آموزش همکاران سیستم

  راهکاران همکاران سیستم چیست و حسابدار چگونه با آن کار می‌کند؟ - فراجاب

  داده ساختار یافته و غیر ساختار یافته؛ بررسی تفاوت‌ها و ویژگی آن‌ها

  kpzrvi - استخدام کارشناس نرم‌افزار (آشنا با ورانگر) در تهران

  سورس نرم افزار انبار دارو به زبان سی شارپ با پایگاه داده sql server

  ایجاد فرم در اکسس - آموزشگاه آریا تهران

  اتصال نرم افزار حسابداری هلو به لاراول - راکت

  Character encoding

  Character encoding - Wikipedia, the free encyclopedia

  PC-BASIC Documentation - GitHub Pages

  ANSI Escape Codes Overview | PDF - Scribd

  chardet/testdata/utf8_bom.html at master - GitHub

  Is it possible to create a volume with 'Microsoft SQL Server' docker

  Best code execution sandboxes for recursive language models

  A Self-Adaptive LLM-Based Framework for Automated Extraction

  Fine-Grained Multi-Table Retrieval via Hierarchical LLM Reasoning

  Towards Scalable Schema Mapping using Large Language Models

  Self-Improving Large Language Model Programs for Schema ... - arXiv

  Towards Scalable Schema Mapping using Large Language Models

  2025-06-02, Papers for large language model, llm · Issue #188

  The Starter Tier for Google AI Studio explained | Google Cloud Blog

  Finally, Google AI Pro/Ultra subscriptions are now supported on AI

  Erfolgreiche Integration von Anaplan - valantic

  What Is B2B Data Onboarding? Steps, Metrics and Automation

  Sessions List by day - Microsoft Fabric Community Conference

  Migrate a SQL Server Database to In-Memory OLTP: Full Guide

  Allgemeine Verbesserungen beim Bereinigungsprozess der

  DeepSeek Privacy Policy

  Quality Worksheet Upload Raise Accounting Error #294322 - GitHub

  How to go back previous version - ERPNext - Frappe Forum

  Bulk Import Strategy for 1000 Employees (Banking Sector)

  yashwantrao chavan arts & science mahavidyalaya, mangrulpir, dist

  Privacy Policy — Context Clarity

  What Are AI Data Centers? | SambaNova

  Terms of Service — DataGlass Labs

  Zero Data Retention: How Blackbox Enforces It By Default

  Data Processing Agreement | SambaNova

  Privacy - Argyll Data Development | Renewable AI Data Infrastructure

  Disclaimer | WAIYS

  Privacy - VoxIntel | Real Time Sales Call Coaching and Qualification

  Data retention and model training - AssemblyAI

  iran-system · GitHub Topics

  Convert an Array of Bytes to Persian string [closed] - Stack Overflow

  PC-BASIC Documentation - GitHub Pages

  benfords-law · GitHub Topics

  Can We Mathematically Spot Possible Manipulation of Results in

  Benford's Law: The Hidden Pattern Behind Numbers - Medium

  Terms of Service - TinyFish

  API Keys - TinyFish — Web Infrastructure for AI Agents

  Web Search API for AI Agents - TinyFish

  TinyFish - api-evangelist - GitHub

  TinyFish Blog - AI Web Agents, Web Automation & Data Insights

  TinyFish plugin for ChatGPT - OpenAI

  OmniRoute - Documentation & FAQ - HOSTKEY




Thoughts
