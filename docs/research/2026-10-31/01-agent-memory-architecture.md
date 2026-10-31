Production-Grade Agentic Assistant and Bitemporal Memory Architecture for Multi-Tenant Accounting and ERP Systems

1. Architectural Paradigm for Financial Reasoning and Causal Retrieval

Answering a compound longitudinal query in an enterprise resource planning (ERP) system—such as a user asking in chat or voice, "Two years ago we made this deal with this company on this date; what was the bank turnover and why did it change?"—exposes the fundamental divide between probabilistic language modeling and deterministic double-entry bookkeeping. Resolving this single prompt requires four distinct computational operations: fuzzy entity and temporal resolution across Jalali calendar boundaries, exact aggregation of immutable ledger postings, cross-linking of unstructured commercial artifacts (contracts, amendments, invoices), and causal synthesis explaining variance over time. No single retrieval or generation paradigm satisfies all four requirements without introducing unacceptable financial failure modes.

Comparative Evaluation of Retrieval and Reasoning Architectures

Empirical evaluations from 2025 and 2026 demonstrate a severe performance cliff when moving natural language database querying from academic benchmarks to normalized production financial schemas. While frontier models achieve 86.6% to 91.2% execution accuracy on clean, shallow schemas such as Spider 1.0, performance drops to 74.5%–82.0% on the dirty databases of the BIRD benchmark (compared to 92.96% for human data engineers, with Google's GeminiSQL-2 reaching 76.13% on the single-model track), and collapses to 10.1%–21.3% on complex enterprise workflows in Spider 2.0 baselines and 0%–16.7% on unmodeled enterprise insurance schemas. On live interactive benchmarks launched in 2025 and 2026, such as LiveSQLBench-Base-Lite and BIRD-Interact-Full, top reasoning models achieve only 44.81% and 16.33% success rates, respectively.

A 2026 production financial study introducing the FLINT architecture evaluated seven state-of-the-art text-to-SQL methods against normalized commercial financial databases and found that none exceeded 50% execution accuracy, despite achieving over 99% syntactic SQL execution success. The dominant failure mode—accounting for 76% to 96% of all errors—was not syntactic SQL generation, but value grounding: commercial financial systems encode metrics, period types, and currencies as opaque integer foreign keys across six-table join chains. Consequently, unconstrained text-to-SQL executes valid SQL that silently returns mathematically fabricated figures by joining on guessed keys, summing point-in-time balance snapshots across dates, or confusing calendar dates with fiscal periods.

By contrast, introducing explicit semantic structure consistently yields double-digit accuracy improvements and fundamentally alters the failure mode from silent fabrication to explicit refusal. In dbt Labs' April 2026 benchmark using Claude Sonnet 4.6 and GPT-5.3 Codex, a governed semantic layer achieved 100% accuracy on in-scope metric queries compared to 51.2%–62.5% for raw text-to-SQL (64.5% vs. 72.7% across all 11 questions), and lifted overall accuracy across expanded models from 84.1%–90.0% up to 98.2%–100%. Crucially, when presented with queries requiring entity hops beyond the semantic model's reach, the semantic layer scored 0% by returning an explicit compilation refusal, whereas raw text-to-SQL silently fabricated plausible but incorrect numbers. Similarly, Snowflake reported a lift from 57% to 78% on BIRD-SQL by adding a semantic model, Sequeda et al. demonstrated a jump from 16.7% to 54.2% using a knowledge graph representation, and the 2026 DABStep ablation showed semantic content raising hard-task accuracy from 37.0% to 77.4% on the strongest frontier model. Furthermore, a 2026 paired ablation study (Cube/arXiv) demonstrated that providing a 4 KB semantic context contract lifted accuracy by 17 to 23 percentage points (reaching 67.7%–68.7%) across three frontier model families, rendering the choice of underlying LLM statistically indistinguishable once semantic context was equalized, while eliminating all 166 unauthorized data-modifying statements issued during ungoverned runs.

Architectural Pattern	Financial Accuracy & Grounding	Typical Latency	Token & Infra Cost	Primary Failure Mode on Accounting Data	Best Role in Roxira ERP
Raw Text-to-SQL (DDL in Prompt)	Low (10%–50% on prod schemas). Fails on opaque foreign keys (76%–96% of errors).	8–15s (single pass) to 30s+ (self-correction loops).	High token cost due to large DDL dumps and multi-step retry loops.	Silent Fabrication: Joins wrong tables, sums balance snapshots across time, ignores fiscal/Jalali calendars.	Avoid for user-facing financial reporting; restrict to sandboxed internal exploration.
Semantic Layer + Text-to-Metric	Very High (90%–100% in-scope). Deterministic compilation of certified YAML formulas.	<1s–3s (with pre-aggregations) or 3–8s (compiled SQL).	Low token cost; high upfront data modeling effort (2–4 weeks for 20–30 metrics).	Coverage Refusal: Returns explicit error (0%) when entity hops exceed modeled dimensions.	Primary Analytical Engine for KPIs, turnover, balances, and period-over-period variance.
Tool-Calling Agents (Deterministic APIs)	100% Numeric Precision within parameterized NestJS service boundaries.	1s–4s per tool invocation (depends on LLM routing).	Lowest compute and token footprint; reuses existing NestJS services.	Parameter Hallucination: Agent passes unverified entity IDs or wrong Jalali-converted dates if not grounded first.	Core Operational Backbone for standard ledger lookups, voucher fetches, and draft generation.
Static GraphRAG (e.g., LightRAG)	Moderate for Qualitative; Poor for Math. Cannot aggregate ledger rows accurately.	5s–15s (hybrid vector + graph traversal).	High ingestion token cost (LLM entity/edge extraction per document).	Temporal Blindness & Entity Collision: Merges evolving facts into static edges; cannot answer "as of date X".	Unstructured Document Linking (connecting contracts, clauses, and correspondence to deal IDs).
Temporal Knowledge Graphs (TKG)	High for Evolving State (90.2%–94.7% on LongMemEval / LoCoMo claims).	2s–6s for hybrid semantic, BM25, and graph traversal.	Moderate-to-high ingestion cost; requires bi-temporal edge maintenance.	Extraction Drift: Free-tier LLMs may misclassify edge validity windows (valid_from / valid_to) during ingestion.	Episodic & Causal Memory for tracking why a deal, credit limit, or counterparty status changed.
Event Sourcing / Bitemporal Ledger	100% Audit-Grade Truth. Immutable append-only journal entries (tstzrange).	<100ms via indexed PostgreSQL range queries.	Zero LLM cost; native PostgreSQL storage overhead (~15%–25% for history).	No Narrative Context: Records what changed and when it was posted, but not external qualitative reasons.	System of Record Foundation for all accounting entries, audit logs, and point-in-time reconstruction.

Recommended Hybrid Architecture for Roxira

To satisfy Roxira's exact-money constraints and single-server Hetzner footprint, the optimal architecture is a Four-Pillar Hybrid System that strictly separates entity and context resolution, deterministic numeric calculation, and causal narrative synthesis. At the foundation lies a Bitemporal Event-Sourced Ledger in PostgreSQL serving as the system of record, where all posted journal entries, vouchers, and bank transactions reside in immutable tables equipped with bitemporal range columns (valid_time for business/Jalali effective dates and transaction_time for system posting timestamps). Built atop this ledger is a Value-Grounded Tool and Semantic Metric Layer; rather than exposing raw SQL generation to the language model, Roxira exposes a curated catalog of NestJS deterministic tools backed by a lightweight YAML semantic metric compiler paired with a FLINT-style Value Lookup Agent. This lookup mechanism resolves fuzzy Persian counterparty names, deal references, and Jalali dates into exact UUIDs and integer foreign keys before any metric query executes.

To capture qualitative context and causal explanations, the third pillar integrates a PostgreSQL-Native Temporal Context Graph with the existing LightRAG Document Store. Unstructured documents (PDF contracts, bank statements, and invoices stored in Cloudflare R2) alongside conversational episodes are linked to ledger entities via a PostgreSQL-native bitemporal graph table structure, avoiding external Neo4j dependencies while upgrading existing LightRAG tables with temporal validity windows. Finally, a Citation-Verified Synthesis Engine acts as the fourth pillar: the language model receives immutable numeric payloads from the semantic tool layer alongside qualitative provenance chunks from the temporal graph, synthesizing a Persian explanation in which every figure and causal claim is cryptographically bound to a verified source identifier.

End-to-End Execution Flow for the Target Deal and Turnover Query

When a user asks in Persian voice or chat about a deal made two years ago, its bank turnover, and the causes behind its variance, the system executes a deterministic seven-stage pipeline across the existing stack.

Stage	Executing Component	Operation & Data Transformation	Security & Truth Guardrail
1. Input Normalization & ASR	Next.js / FastAPI Speech & Text Preprocessor	Transcribes voice (if audio) via Persian ASR; normalizes Arabic ي/ك to Persian ی/ک, converts Persian/Arabic numerals (۰-۹/٠-٩) to ASCII integers, and parses relative Jalali expressions ("دو سال پیش" / "تاریخ فلان") into an exact Jalali range and UTC tstzrange.	Rejects ambiguous currency units (Rial vs. Toman) or unparseable dates via an immediate clarification prompt.
2. Tenant Context Binding	NestJS Assistant Module + PgBouncer	Extracts tenant_id, user_id, and role_permissions from the authenticated JWT. Opens a PostgreSQL read-only transaction and executes SET LOCAL app.current_tenant_id = '<uuid>'.	FORCE ROW LEVEL SECURITY on all tables guarantees zero cross-tenant leakage even if downstream SQL omits a WHERE clause.
3. Entity & Value Grounding (FLINT Pattern)	FastAPI Lookup Sub-Step (via Qdrant + Postgres Trigram/BM25)	Searches tenant-scoped counterparties (طرف حساب ها) and contracts (قراردادها) matching the fuzzy company name and target date window. Resolves exact counterparty_id, contract_id, and linked bank_account_ids.	If zero or multiple conflicting deals match the fuzzy criteria, halts execution and asks the user to disambiguate.
4. Deterministic Metric Compilation	Semantic Metric Layer / NestJS Ledger Tool	Invokes certified metric bank_turnover_by_counterparty_period using the resolved counterparty_id and contract_id across monthly/quarterly Jalali buckets from deal inception to present. Computes exact debit/credit sums and identifies the exact period where variance exceeded threshold \Delta.	Zero LLM math: SQL aggregates NUMERIC(20,0) Rial columns directly in PostgreSQL and returns a cryptographic query hash.
5. Bitemporal Graph & Document Retrieval	PostgreSQL Temporal Graph + LightRAG + R2	Queries temporal edges (valid_time && anomaly_window) linked to contract_id and counterparty_id. Retrieves LightRAG document chunks for contract amendments (الحاقیه), returned checks (چک برگشتی), invoices, or episodic user notes recorded during the variance window.	Enforces tenant and document-level ACLs on both vector payloads in Qdrant and graph edges in PostgreSQL.
6. Privacy Scrubbing & Synthesis	PII Masking Proxy + LiteLLM Router	Replaces real company names, IBAN/Sheba numbers, and national IDs with deterministic session tokens (<COMPANY_A>, <IBAN_1>) before sending the structured turnover table and document excerpts to an external LLM via LiteLLM.	Prevents confidential tenant PII and financial identities from leaking to external free-tier API providers.
7. Verification & Citation Rendering	FastAPI Output Validator + Next.js RTL UI	Re-hydrates masked tokens (<COMPANY_A> \rightarrow real name), regex-verifies every numeric string in the generated Persian response against the Stage 4 SQL JSON payload, and attaches clickable UI badges linking to source voucher IDs and R2 PDF bounding boxes.	If the LLM invents a number not present in Stage 4 output or lacks document provenance for a causal claim, the validator strips the claim or abstains.

2. Long-Term Memory Architecture and Framework Comparison

A financial assistant operating over multi-year ERP lifecycles cannot treat memory as a flat vector index of chat logs. Accounting requires four distinct cognitive memory strata, each governed by different mutability, decay, and temporal rules.

The Four Memory Strata in an Agentic ERP

The foundational layer is Episodic Memory, which captures the immutable interaction and event stream across the platform, including timestamped user conversations, voice transcripts, approval decisions, and system alerts (for example, recording that on 1403/08/12, the chief financial officer noted a counterparty's request for a 60-day payment extension due to customs delays). Episodic records serve as append-only ground-truth provenance logs; they never decay or undergo destructive overwrites, forming the primary audit trail from which higher-order knowledge is synthesized.

The second stratum is Semantic Memory, structured as a bitemporal entity and fact graph storing subject-predicate-object triplets (Subject -> Predicate -> Object) extracted from both conversational episodes and structured ERP events, such as Counterparty_X -> HAS_CREDIT_LIMIT -> 5,000,000,000[span_97](start_span)[span_97](end_span) IRR. In financial domains, semantic memory must operate along two orthogonal time axes to achieve bitemporality. The first axis, valid time (valid_from, valid_to), represents when a fact was true in the real business world according to Jalali effective dates. The second axis, transaction time (tx_fro[span_98](start_span)[span_98](end_span)m, tx_to), records when the fact was asserted or superseded within the database. This bitemporal structure enables exact point-in-time historical reconstruction—answering questions such as what the system believed credit exposure to be on 29 Esfand 1402 prior to an audit adjustment posted on 15 Farvardin 1403—by filtering on valid_time @> '2024-03-19'::timestamptz AND tx_time @> '2024-03-19'::timestamptz.

The third stratum is Procedural Memory, which encodes learned tenant-specific workflows, chart-of-accounts (CoA) coding preferences, and tax treatments (such as a rule dictating that recurring invoices from a specific vendor are always coded to Expense Account 610204 under the Tehran-HQ cost center). Procedural memories are maintained as versioned state records where updates insert a new version row rather than mutating historical rows, enabling immediate rollback if an agent acquires a flawed classification rule. Finally, Document Memory manages hierarchical unstructured artifacts by storing parsed optical character recognition (OCR) layouts, table structures, and semantic chunks from contracts, tax circulars (بخشنامه‌های مالیاتی), and bank statements stored in Cloudflare R2, indexed through LightRAG's entity-relationship graph in PostgreSQL and dense/sparse vectors in Qdrant.

Memory Lifecycle: Consolidation, Conflict Resolution, and Decay

Background memory consolidation executes asynchronously via BullMQ off-peak workers to prevent ingestion overhead from degrading conversational latency. When consolidating facts, the system enforces conflict resolution via temporal superseding rather than destructive overwrites. Whenever a newly ingested episode contradicts an existing semantic fact—for instance, a contract amendment raising a volume discount rate from 5% to 8%—the consolidation worker preserves the historical 5% edge by setting its valid_to attribute to the amendment's effective date and its tx_to attribute to NOW(), while inserting a new edge with valid_from set to the effective date and supersedes_id pointing to the prior edge. When two sources assert conflicting values across the exact same validity window, a deterministic authority hierarchy governs resolution: Posted Ledger Entry > Signed Contract PDF > Approved Voucher Draft > User Chat Statement.

Regarding memory decay, financial facts, commercial contracts, and ledger explanations must never decay within statutory tax retention windows (typically ten years under commercial codes). Exponential relevance damping based on last_accessed_at is applied exclusively to transient episodic user-interface preferences (such as preferred table sorting or chart styles), whereas archival financial episodes remain permanently retrievable via date-bounded queries.

Comparative Analysis of Agent Memory Frameworks

Framework	Maturity & Track Record	License (OSS vs. Commercial)	PostgreSQL & Existing Stack Fit	Multi-Tenancy & Isolation Architecture	Critical Limitations & Security Risks for Roxira
Zep / Graphiti	High. Graphiti has 32k+ GitHub stars, 3.3k forks. Vendor claims 94.7% LoCoMo and 90.2% LongMemEval.	Graphiti: Apache-2.0. Zep CE: Deprecated Apr 2025 (no updates/support). Zep Cloud/Konig: Proprietary.	Poor for 1-Server Postgres. Graphiti requires Neo4j 5.26+ (or AWS Neptune/FalkorDB); Kuzu backend is deprecated.	Scopes via group_id / user / session in Zep; Graphiti requires custom graph partitioning or namespace prefixes.	Running Neo4j JVM alongside Postgres, Qdrant, NestJS, and FastAPI on one small Hetzner server causes severe RAM exhaustion.
Letta (formerly MemGPT)	High. Active OSS project (100+ contributors) with stateful white-box agent server and ADE.	Apache-2.0 (github.com/letta-ai). Managed Letta Cloud is commercial.	Good. Docker deployment natively uses PostgreSQL for persistent agent state and archival memory.	Logical tag-based filtering (tenant:{id}, role:{type}) via lettactl pushed to server queries, plus shared blocks across tenants.	Designed as a heavyweight standalone agent runtime (port 8283). Tag-based logical filtering lacks native DB-enforced RLS unless customized.
Mem0	High Popularity on GitHub for conversational personalization.	Apache-2.0 (OSS SDK). Mem0 Cloud is commercial.	Moderate. Supports pgvector and Qdrant, but graph memory features pull in Neo4j in standard self-hosted templates.	Logical scoping via user_id, agent_id, app_[span_183](start_span)[span_183](end_span)id, and run_id passed in nested V3 filters objects.	Weak temporal reasoning (flat ADD/UPDATE/DELETE mutates state without bitemporal audit windows). Missing filter predicates risk cross-tenant vector leakage.
Cognee	Moderate-High. Reached v1.0 in Apr 2026 with 30,000+ GitHub stars.	Apache-2.0 (OSS self-hosted). Cognee Cloud is $1/1M tokens + $5/workspace.	Good with Caveat. Supports Postgres + pgvector + Qdrant; single-Postgres graph backend added in v1.0 carries an experimental/warning label in repo docs.	Dataset-level ACLs (read, write, delete, share) and per-tenant vector/graph partitions.	Heavy ingestion pipeline (20 search types, OTEL collector); lacks native accounting bitemporality (tstzrange valid vs. transaction time) out of the box.
LangGraph (AsyncPostgresStore)	High. De facto standard for Python stateful agent checkpoints and key-value/vector stores.	MIT License (LangGraph OSS). LangSmith/Cloud is commercial.	Native Fit. Runs directly on existing PostgreSQL via PostgresSaver and AsyncPostgresStore.	Tuple-based hierarchical namespaces (e.g., (tenant_id, "memories[span_152](start_span)[span_152](end_span)[span_154](start_span)[span_154](end_span)", user_id)).	Security Alert (CVE-2026-115883 / PGV-26588AT): Prior to langgraph-checkpoint-postgres 3.1.3, dot-joined namespace labels allowed cross-namespace tenant bypass. Lacks native temporal graph edges.
LightRAG on Postgres (Existing)	Moderate. Already deployed in Roxira's stack.	MIT License.	Already Integrated on Roxira's PostgreSQL instance.	Requires manual workspace or tenant_id column injection and RLS enforcement.	Static entity/edge extraction overwrites summaries without tracking temporal validity windows (valid_from / valid_to).

The architectural evidence indicates that Roxira should avoid deploying Neo4j (required by Graphiti and Mem0-Graph) or a separate Letta server container on a single small Hetzner server. Instead, the optimal approach adopts Graphiti's bitemporal data model concepts—mapping immutable Episodes to canonical Entities and Bitemporal Facts/Edges with hybrid semantic, BM25, and graph traversal—implemented natively inside Roxira's existing PostgreSQL, Qdrant, and LightRAG stack, while utilizing patched langgraph-checkpoint-postgres ($\ge$ 3.1.3) for short-term thread state.

Production PostgreSQL Bitemporal Memory Schema (DDL)

The following PostgreSQL schema implements all four memory strata with native tstzrange bitemporal indexing (btree_gist), full-text search, pgvector embeddings (supporting 1024-d BGE-M3 vectors), and mandatory Row-Level Security (F[span_100](start_span)[span_100](end_span)ORCE ROW LEVEL SECURITY) compatible with PgBouncer transaction pooling:

[sql]
-- Required extensions on existing PostgreSQL instance
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- Helper function to read tenant context set via SET LOCAL inside PgBouncer transactions
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 1. EPISODIC MEMORY: Immutable provenance stream (chats, voice transcripts, system events, OCR docs)
CREATE TABLE memory_episodes (
    episode_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    source_type VARCHAR(32) NOT NULL CHECK (source_type IN ('chat', 'voice', 'voucher_audit', 'document_ocr', 'bank_statement')),
    source_ref_id VARCHAR(128), -- Links to NestJS voucher_id, contract_id, or R2 object key
    jalali_date_str VARCHAR(10) NOT NULL, -- e.g., '1403/04/15'
    occurred_at TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw_content TEXT NOT NULL,
    normalized_content TEXT NOT NULL, -- Persian normalized (ye/kaf unified, ASCII digits)
    embedding vector(1024), -- BGE-M3 dense vector (or synced to Qdrant with tenant_id payload)
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_episodes_tenant_occurred ON memory_episodes (tenant_id, occurred_at DESC);
CREATE INDEX idx_episodes_trgm ON memory_episodes USING gin (normalized_content gin_trgm_ops);

ALTER TABLE memory_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_episodes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_episodes ON memory_episodes
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- 2. SEMANTIC MEMORY NODES: Canonical entities (Counterparties, Deals, Accounts, Tax Rules)
CREATE TABLE memory_entities (
    entity_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    entity_type VARCHAR(64) NOT NULL, -- 'counterparty', 'contract', 'bank_account', 'cost_center'
    erp_record_id UUID, -- Nullable foreign key to deterministic ERP table
    canonical_name TEXT NOT NULL, -- Normalized Persian name
    aliases TEXT[] NOT NULL DEFAULT '{}',
    summary TEXT,
    embedding vector(1024),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, entity_type, canonical_name)
);

CREATE INDEX idx_entities_tenant_erp ON memory_entities (tenant_id, erp_record_id);
CREATE INDEX idx_entities_aliases ON memory_entities USING gin (aliases);

ALTER TABLE memory_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_entities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_entities ON memory_entities
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- 3. BITEMPORAL SEMANTIC FACTS (EDGES): Tracks what was true when, and when the system knew it
CREATE TABLE memory_bitemporal_facts (
    fact_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    subject_entity_id UUID NOT NULL REFERENCES memory_entities(entity_id) ON DELETE CASCADE,
    predicate VARCHAR(128) NOT NULL, -- e.g., 'HAS_CREDIT_LIMIT', 'AMENDED_BY', 'CAUSED_TURNOVER_DROP'
    object_entity_id UUID REFERENCES memory_entities(entity_id) ON DELETE CASCADE,
    object_value_numeric NUMERIC(20, 0), -- Exact Rial or basis points if quantitative fact
    object_value_text TEXT NOT NULL,
    source_authority SMALLINT NOT NULL CHECK (source_authority BETWEEN 1 AND 4), 
    -- 1: Chat/Voice, 2: Draft Voucher, 3: Signed OCR Doc, 4: Posted Immutable Ledger
    source_episode_id UUID NOT NULL REFERENCES memory_episodes(episode_id) ON DELETE RESTRICT,
    valid_time TSTZRANGE NOT NULL, -- Real-world business validity window [valid_from, valid_to)
    tx_time TSTZRANGE NOT NULL DEFAULT tstzrange(NOW(), 'infinity', '[)'), -- DB assertion window
    superseded_by_fact_id UUID REFERENCES memory_bitemporal_facts(fact_id),
    fact_embedding vector(1024),
    -- Prevent overlapping active facts for the same singleton predicate at the same business & tx time
    EXCLUDE USING gist (
        tenant_id WITH =,
        subject_entity_id WITH =,
        predicate WITH =,
        valid_time WITH &&,
        tx_time WITH &&
    ) WHERE (predicate IN ('HAS_CREDIT_LIMIT', 'CONTRACT_STATUS', 'DEFAULT_EXPENSE_ACCOUNT'))
);

CREATE INDEX idx_facts_bitemporal ON memory_bitemporal_facts USING gist (tenant_id, subject_entity_id, valid_time, tx_time);
CREATE INDEX idx_facts_episode ON memory_bitemporal_facts (tenant_id, source_episode_id);

ALTER TABLE memory_bitemporal_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_bitemporal_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_facts ON memory_bitemporal_facts
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- 4. PROCEDURAL MEMORY: Versioned accounting rules and tenant playbooks
CREATE TABLE memory_procedural_rules (
    rule_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    rule_Scope VARCHAR(64) NOT NULL, -- 'coa_mapping', 'reconciliation_tolerance', 'tax_exemption'
    trigger_pattern JSONB NOT NULL, -- Conditions (e.g., vendor_id, description regex)
    action_payload JSONB NOT NULL, -- Target account_code, cost_center, required_approver_role
    version INT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    approved_by_user_id UUID NOT NULL,
    valid_time TSTZRANGE NOT NULL DEFAULT tstzrange(NOW(), 'infinity', '[)'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE memory_procedural_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_procedural_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_rules ON memory_procedural_rules
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());


3. Guaranteeing Numeric Truth and Multi-Tenant Database Isolation

In an accounting system, a 99% accurate number is a 100% failed audit. Language models must never perform arithmetic, currency conversion, or ledger aggregation in their token stream. Guaranteeing numeric fidelity requires a six-layer verification and isolation protocol spanning storage types, semantic compilation, connection pooling, and output validation.

Six-Layer Numeric Truth Protocol

At the database storage layer, all Rial amounts must be stored and aggregated as arbitrary-precision integers in PostgreSQL (NUMERIC(20,0) or BIGINT) and manipulated as bigint or Decimal objects in NestJS and Python, completely eliminating IEEE 754 floating-point representation errors. Above the storage layer, core accounting formulas—including Bank Turnover, Net Cash Flow, Accounts Receivable Aging, Trial Balance, and Gross Margin—are codified once in version-controlled YAML semantic metric specifications. These specifications deterministically enforce accounting invariants: every query automatically appends voucher_status = 'POSTED' to exclude drafts or voided entries, and distinguishes between flow metrics (which aggregate SUM(debit - credit) across an interval) and stock/balance metrics (which compute cumulative totals up to period_end_date), thereby preventing the common language model error of summing daily balance snapshots across time.

Because 76% to 96% of production financial SQL errors stem from wrong foreign-key filter values, the third layer enforces a FLINT Value-Grounding Pre-Execution Gate. The assistant is barred from passing raw natural language strings into metric filter predicates; instead, every entity reference must first resolve through a deterministic lookup tool that returns verified database primary keys (account_id, counterparty_id, fiscal_period_id) paired with their canonical Persian names.

The fourth layer addresses a critical multi-tenant vulnerability: connection pooling state bleed under PgBouncer. In PgBouncer's transaction pooling mode, session-level SET commands either break connection multiplexing or persist across requests and leak session state to subsequent tenants. Consequently, every database call initiated by the assistant must execute inside an explicit transaction block that issues BEGIN READ ONLY;, sets a strict timeout via SET LOCAL statement_timeout = '5000ms';, and binds the tenant identity via SET LOCAL app.current_tenant_id = '<verified_jwt_tenant_uuid>';. Because all ledger and memory tables declare both ENABLE ROW LEVEL SECURITY and FORCE ROW LEVEL SECURITY—which prevents even the table-owner database role from bypassing policy checks—PostgreSQL's storage engine structurally blocks cross-tenant reads even if an agent or background consolidation job omits a tenant_id predicate. Similarly, all Qdrant vector queries enforce mandatory payload filters (FieldCondition(key="tenant[span_24](start_span)[span_24](end_span)_id", match=MatchValue(value=tenant_id))) at the collection level.

To protect transactional ERP workloads on a single Hetzner server without incurring the disk I/O and shared-buffer RAM duplication of a physical PostgreSQL read replica, the fifth layer routes all agent queries through a dedicated read-only PostgreSQL role (roxira_agent_reader) managed by a separate PgBouncer pool capped at max_db_connections = [span_125](start_span)[span_125](end_span)[span_127](start_span)[span_127](end_span)[span_129](start_span)[span_129](end_span)10. When Roxira eventually scales to a multi-server topology, this PgBouncer pool can be repointed to a streaming hot-standby replica with zero application code modifications.

Finally, the sixth layer enforces Post-Generation Numeric Verification and Deterministic Abstention. Every deterministic tool or semantic metric execution writes its returned figures, query parameters, and source document identifiers into a turn-scoped VerifiedEvidenceRegistry in Redis. Prior to streaming the Persian response to the Next.js interface, a FastAPI validation middleware extracts all numeral strings from the model's draft output, normalizes them to ASCII integers, and verifies that each financial figure exists within the VerifiedEvidenceRegistry (or matches a pre-computed variance metric). If an unverified number appears, or if retrieval confidence falls below threshold, the validator blocks the output and substitutes a deterministic abstention message specifying exactly which fiscal period, bank statement, or voucher is missing from the evidence set.

4. Agent Autonomy, Permission Tiers, and Adversarial Defense

Because Roxira enforces immutable posted ledger entries and period locks, an AI agent must never possess direct INSERT or UPDATE privileges on posted journal tables (gl_postings) or direct access to external payment rails.

Four-Tier Autonomy Model and Ledger Rollback Mechanics

Autonomy Tier	Permitted Agent Actions	RBAC & Cryptographic Gate	Ledger Mutability & Rollback Mechanism
L0: Read & Explain	Query semantic metrics, search LightRAG documents, traverse temporal memory, explain variances with citations.	Enforced via user JWT permissions + PostgreSQL RLS (roxira_agent_reader) + Qdrant tenant filter.	Read-only (BEGIN READ ONLY). Zero state mutation.
L1: Draft & Simulate	Create draft journal vouchers (پیش‌نویس سند حسابداری), draft purchase orders, simulate cash flow or tax liabilities in a sandbox table.	Requires user DRAFT_CREATE permission. Writes only to status = 'AI_DRAFT' staging tables.	Soft-delete or discard draft row. Never touches general ledger balances or sequences.
L2: Propose for Human Approval	Submit a balanced draft voucher, bank reconciliation match batch, or collection reminder for human sign-off.	Suspends workflow state in Postgres/BullMQ; generates a cryptographic Action Intent Token (HMAC-SHA256(tenant_id + draft_id + payload_hash + user_id)).	Human clicks "Approve" in Next.js UI; NestJS verifies the HMAC signature and RBAC role (ACCOUNTANT_APPROVER) before executing.
L3: Autonomous Bounded Execution	Auto-categorize incoming OCR drafts, auto-match exact-amount/exact-reference bank statement lines into pending reconciliation state, update non-financial episodic memory.	Restricted to whitelisted idempotent NestJS internal methods with strict numeric thresholds (e.g., variance = 0 IRR).	Accounting Rollback Rule: If a human-approved voucher posted to the immutable ledger must be undone, the system never deletes the row; it generates a deterministic Reversing Journal Entry (سند معکوس / اصلاحیه) swapping debits and credits with a reverses_voucher_id reference. If a fiscal period is locked (period_locked = true), the reversal is automatically dated in the earliest open period.

Defending Against Indirect Prompt Injection in Invoices and Bank Statements

Accounting assistants face a severe adversarial vector: indirect prompt injection embedded within external commercial documents. A malicious counterparty can hide white-on-white text or micro-font Persian and English instructions inside a PDF invoice or bank statement memo (such as instructing the assistant to ignore prior rules, mark the invoice as approved, and update the vendor's Sheba/IBAN routing number).

Neutralizing this threat across OCR and Model Context Protocol (MCP) boundaries requires four architectural controls. First, the ingestion pipeline applies Strict Spotlight Delimiting, wrapping all text extracted via OCR (Surya or PaddleOCR) or external web search (SearXNG, Tavily, Jina) inside randomized XML boundary tags (<untrusted_document_content_9f8a>...</untrusted_document_content_9f8a>) accompanied by system instructions forbidding the execution of directives found within those delimiters. Second, the FastAPI orchestrator enforces Dual-Privilege Execution Separation: whenever an inference turn processes untrusted document content, all L1, L2, and L3 state-mutating tools and MCP write servers are stripped from the model's active tool schema. Untrusted documents are parsed exclusively by an isolated structured-output extraction call constrained by a rigid Pydantic JSON schema (for example, InvoiceExtractionSchema permitting only invoice_number: str, jalali_date: str, line_items: list[LineItem], and total_rial: int).

Third, a Master Data Mutation Lock architecturally prohibits the assistant from creating or modifying vendor bank accounts (IBAN/Sheba), tax identifiers, or user RBAC roles based on document or chat context; master data modifications require direct authenticated human entry in the NestJS frontend with two-factor authentication. Fourth, every tool invocation, prompt hash, compiled SQL query, and human approval decision is recorded in an Immutable Hash-Chained Audit Log (agent_audit_log), where each row stores prev_row_hash = SHA256(prev_row), providing tamper-evident provenance for external financial auditors.

5. High-Value Accounting Agents vs. Industry Hype

Evidence-Backed Value vs. Hype Analysis

Empirical evidence from production ERP deployments shows that AI agents deliver high return on investment when performing high-volume cross-referencing, fuzzy entity matching, and structured variance triage, whereas they fail severely when tasked with unsupervised multi-step financial judgment or autonomous statutory filing. Vendor claims touting autonomous "one-click tax filing" or "LLM-generated cash forecasts" represent market hype: language models hallucinate tax circular applicability and underperform simple deterministic statistical models (such as ARIMA, Prophet, or SQL moving averages) on numerical time-series autoregression. Conversely, deploying an agent to match messy Persian bank statement descriptions (شرح گردش حساب) against open accounts receivable invoices reduces manual reconciliation labor substantially while preserving human sign-off over final ledger postings.

Roxira Production Agent Catalogue

Agent Name	Core Accounting Task	Underlying Mechanism (Deterministic vs. LLM)	Max Autonomy Level	Evidence Rating & Justification
1. Longitudinal Deal & Variance Investigator	Answers multi-year questions on counterparty turnover, deal history, and causal drivers.	Hybrid: FLINT entity lookup + Semantic SQL metric aggregation + Bitemporal Graph & LightRAG document synthesis.	L0 (Read & Explain)	Proven High Value. Directly solves the target user query with 100% numeric precision and source citations.
2. Bank & Counterparty Reconciliation Agent (مغایرت‌گیری بانکی)	Matches imported bank statement rows (CSV/OCR) to open ledger vouchers and sub-ledger invoices.	Deterministic Pass 1: Exact Rial amount + Shenaseh/Check ID match. Agentic Pass 2: Fuzzy Persian name/memo matching + split-payment combination search.	L1/L2 (Draft Match Batch \rightarrow Human Approve)	Proven High Value. Eliminates tedious manual matching of inconsistent Persian bank descriptions.
3. Period-End Close & Readiness Copilot (بستن حساب‌ها)	Audits pre-close checklist: unposted drafts, unbalanced sub-ledgers, missing recurring accruals, and negative inventory balances.	Deterministic SQL Checks triggered by BullMQ schedule; LLM summarizes exceptions and drafts recurring accrual vouchers.	L1 (Draft Accruals) / L2 (Propose Lock)	Proven High Value. Turns a multi-day manual audit into an automated exception queue.
4. Invoice & Receipt OCR Voucher Drafter	Extracts header and line items from scanned Persian invoices/receipts and maps them to the tenant's Chart of Accounts.	VLM/OCR (PaddleOCR-VL / Surya) \rightarrow Procedural Memory lookup for vendor CoA history \rightarrow NestJS draft voucher API.	L1 (Create AI_DRAFT Voucher)	Proven Value with Guardrails. High value for printed invoices; requires human review for handwritten Persian receipts.
5. Anomaly & Duplicate Payment Detector	Flags duplicate invoices, Benford's Law deviations, weekend/off-hours postings, and unusual price spikes per vendor.	100% Deterministic SQL / Statistical Rules (z-score, exact/fuzzy invoice number + Rial amount collision); LLM explains context.	L0 (Alert & Explain)	Proven High Value. Classical statistical queries are cheap, fast, and zero-hallucination; LLM adds narrative triage.
6. Accounts Receivable Collections Assistant (پیگیری مطالبات)	Identifies overdue invoices (سررسید گذشته), summarizes counterparty payment history/disputes, and drafts polite Persian follow-up messages.	Semantic SQL (AR Aging metric) + Episodic Memory check (for active dispute notes) + LLM message drafting.	L2 (Human Approve before SMS/Email send)	Moderate-High Value. Prevents embarrassing collection notices when a verbal extension was already logged in chat memory.
7. Cash Flow Forecaster (پیش‌بینی نقدینگی)	Projects 30/60/90-day Rial cash position based on scheduled checks (چک‌های دریافتنی/پرداختنی), AR aging probabilities, and payroll.	Deterministic SQL + Historical Payment Delay Weighting; LLM only allows "what-if" parameter toggling via tool calls.	L0 (Read & Simulate)	Hype if LLM-computed; High Value if SQL-computed. Never let an LLM predict time-series numbers directly.
8. Iranian Tax & Statutory Assistant (مالیات و سامانه مودیان)	Answers questions on Iranian tax circulars (بخشنامه‌های سازمان امور مالیاتی), VAT (ارزش افزوده), and Moadian/Article 169 quarterly report validation.	LightRAG over official tax circulars + Deterministic SQL Validator checking missing national IDs (شناسه ملی/کد اقتصادی) on sales invoices.	L0 (Q&A & Validation Report)	High Value as Validator; Avoid Autonomous Filing. Legal liability requires human sign-off on all statutory submissions.
9. Inventory & COGS Variance Agent	Explains cost-of-goods-sold (بهای تمام شده) fluctuations and slow-moving stock across warehouses.	Semantic SQL (weighted average / FIFO cost tables) + Purchase Order price history comparison.	L0 (Read & Explain)	Moderate Value. Useful for trading/manufacturing tenants once core ledger agents are stable.
10. HR & Payroll Policy Assistant (حقوق و دستمزد)	Answers employee questions on leave balances, overtime rules, and Iranian Labor Law (قانون کار) calculations.	LightRAG on labor law/company handbook + read-only tool call to employee's own payslip records.	L0 (Self-Service Read)	Low Priority (Phase 3). Orthogonal to core general ledger truth; build after core accounting agents.

6. Orchestration Comparison for a Single Hetzner Server

Roxira operates on a single small Hetzner server running Docker Compose with NestJS, Next.js, FastAPI, PostgreSQL + PgBouncer, Redis + BullMQ, and Qdrant. Conserving system memory and avoiding container sprawl are primary architectural constraints.

Orchestrator	License	Infra & RAM Overhead on Hetzner	Fit with NestJS + FastAPI + Redis Stack	Strengths & Failure Modes for Roxira	Recommendation
BullMQ Flows (Existing) + LangGraph (FastAPI)	MIT (Both)	~0 MB extra infra. Uses existing Redis (BullMQ) and existing PostgreSQL (AsyncPostgresStore / PostgresSaver).	100% Native. NestJS dispatches durable jobs via BullMQ; FastAPI executes cyclical agent state graphs via LangGraph.	Combines BullMQ's battle-tested retries, cron schedules, and rate-limiting with LangGraph's step-by-step checkpointing and human-in-the-loop (interrupt()) pause/resume. Must use langgraph-checkpoint-postgres >= 3.1.3 to patch CVE-2026-115883.	ADOPT (Primary Architecture). Zero new containers required.
Temporal	MIT (Server)	Heavy (1.5 GB – 3+ GB RAM). Requires Temporal Server, History/Matching services, and Cassandra/Postgres/ES visibility stores.	High friction. Requires maintaining separate Worker processes in TypeScript/Python alongside existing BullMQ.	Gold standard for distributed microservices saga orchestration, but massive operational overkill for a small team on one server that already runs BullMQ.	AVOID on single-server footprint.
Inngest	Apache-2.0 / FSL (Self-hosted)	Moderate (~300–500 MB RAM). Requires running a separate Inngest Go server container + DB state.	Redundant with BullMQ.	Great developer experience for serverless Next.js apps, but duplicates BullMQ's queue and flow capabilities on a stateful Docker Compose server.	AVOID (Redundant with BullMQ).
OpenAI Agents SDK / Anthropic Agent SDK	MIT	Minimal (Library only).	Poor fit for multi-provider free-tier rotation and durable pause/resume.	Lightweight Python loops, but lack native PostgreSQL-backed durable state checkpointing for multi-day human approval pauses (L2 autonomy) and exhibit provider-specific schema bias.	AVOID as primary orchestrator.
Custom State Machine in NestJS/Python	Proprietary	0 MB.	Native.	Simple for 2-step linear flows, but quickly devolves into brittle, unmaintainable boilerplate when implementing cyclical tool retries, parallel fan-out, and human-in-the-loop state serialization.	USE ONLY for simple deterministic 2-step pipelines (e.g., OCR \rightarrow JSON parse).

7. Continuous Evaluation, Persian Benchmarks, and Free-Model Drift

When rotating across free-tier providers (Groq, Google AI Studio, Mistral, SambaNova, OpenRouter, DeepSeek) via LiteLLM, silent model deprecations, quantization changes, or rate-limit fallbacks cause severe accuracy drift. Continuous evaluation must gate both CI/CD deployments and live runtime routing through a four-tier verification pipeline.

Four-Tier Evaluation Pipeline

The foundation of continuous evaluation is a Golden Persian and Jalali Accounting Dataset comprising 150 curated scenarios modeled on BIRD-Financial and LiveSQLBench. This internal benchmark is stratified into 50 deterministic metric queries testing Jalali leap years (سال کبیسه, such as 30 Esfand 1403), fiscal period boundaries (دوره مالی), and Rial/Toman conversions; 50 fuzzy entity and longitudinal deal queries testing typo-tolerant Persian company names (شرکت توسعه تجارت پارس vs. توسعه تجارت پارس (سهامی خاص)) and multi-year turnover variance; 30 unstructured document and ledger hybrid queries testing causal synthesis across LightRAG contracts and ledger postings; and 20 adversarial and abstention traps testing queries over missing periods, locked periods, cross-tenant identifiers, and prompt-injected invoices.

For the second tier, because standard exact-string SQL matching fails on valid syntactic variations while raw execution accuracy can pass false positives on empty result sets, the evaluation harness implements the 2026 FLINT Three-Tier Semantic Evaluation Pipeline:

$$\text{Pass}(Q_{\text{gen}}, Q_{\text{gold}}) = \text{AST}_{\text{canon}}(Q_{\text{gen}}, Q_{\text{gold}}) \lor \text{ColAlign}(\text{Exec}(Q_{\text{gen}}), \text{Exec}(Q_{\text{gold}})) \lor \text{Judge}_{\text{LLM}}(Q_{\text{gen}}, Q_{\text{gold}})$$

Under this pipeline, generated queries first undergo abstract syntax tree (AST) canonicalization via sqlglot; queries that do not match syntactically are executed against a seeded test database for column-aligned result comparison; and an LLM judge is invoked strictly as a final tie-breaker for formatting equivalence.

The third tier evaluates Retrieval and Bitemporal Memory Fidelity, measuring Rec[span_142](start_span)[span_142](end_span)all@5, MRR@10, and nDCG@10 across Qdrant and LightRAG hybrid queries alongside Temporal Fact Precision, which verifies that retrieved bitemporal edges match the target valid_time window without leaking superseded facts. Finally, to counter Live Free-Model Drift, a BullMQ cron job executes a 15-question canary subset against every active LiteLLM provider route every six hours. Whenever an upstream free provider's JSON schema adherence drops below 98% or tool-selection accuracy falls below 90%, LiteLLM automatically demotes that provider in the routing priority table.

8. Data Privacy, Free-Tier Provider Risks, and Regulatory Compliance

Routing multi-tenant accounting data through "free-first" external LLM APIs creates severe legal, privacy, and competitive exposure. A rigorous separation between verified provider terms and marketing assumptions is mandatory.

Audit of External AI Provider Data Retention and Training Terms

| Provider | Trains on Free / Default Tier? | Trains on Paid / Billed Tier? | Data Retention & Logging Policy | Storage / Processing Jurisdiction | Safe Payload Policy for Roxira |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Google AI Studio (Gemini API) | YES. Prompts and responses on the unpaid quota are used to train models and improve products; human reviewers may read data. (Exception: EEA/UK/CH users get paid terms automatically). | NO. Linking an active Cloud Billing account switches terms to Paid Services (no training, covered by DPA). | 55 days on Google AI Studio (per OpenRouter provider table); limited abuse logging on paid tier (configurable to 7 days). | Global Google Cloud infrastructure (no regional pinning in AI Studio). | NEVER send unmasked tenant data to the unpaid tier. Attach a Cloud Billing account immediately (even with low budget alerts) and mask PII. |
| Groq | NO. Privacy policy states Groq does not train models on customer API inputs/outputs. | NO. | Docs have minor discrepancy: Body states "not retained by default", while reliability/abuse logs are kept up to 30 days (or 7 days in older policy notes). Self-serve Zero Data Retention (ZDR) can be enabled by any customer in Data Controls. | United States (Google Cloud Platform buckets in the US). | Enable Self-Serve ZDR immediately in Groq Console. Only send PII-masked prompts. |
| DeepSeek API | YES (Default). Policy states inputs/files may be used to train and improve models; opt-out requires toggling "Improve the model for everyone" or emailing privacy@deepseek.com; API terms lack an explicit no-training exclusion. | Ambiguous / High Risk. Unseen Security audit (Sept 2026) notes API terms do not add a no-training commitment or GDPR Art. 28 DPA. | Retained "as long as necessary" with no fixed retention period stated. | People's Republic of China (explicitly stated in 2025/2026 policies; Sept 2026 update generalized wording to "outside the country where you live"). | RESTRICT. Never send identifiable tenant financial data, contracts, or PII. Use only for generic SQL/metric syntax generation over public schema templates or self-host open weights. |
| Mistral (La Plateforme) | YES on Free / Labs / Preview. Commercial terms allow training on data from free tiers or Labs/Preview models unless opted out in admin panel. | NO on paid plans; Zero Data Retention (ZDR) available on pay-as-you-go upon request/approval. | 30 days for abuse monitoring unless ZDR is approved in the admin panel. | European Union (France/EU). | Opt out of training in admin panel immediately; avoid Labs/Preview endpoints for tenant payloads. |
| OpenRouter & OmniRoute | Depends on upstream provider. OpenRouter does not train, but routes to upstream hosts with varying policies. | Configurable via Data Policy Filtering. | Varies by sub-provider (e.g., 0 days for Groq/Vertex with ZDR vs. 30–55 days for others). | US proxy routing to global upstream providers. | Enable strict Data Policy Filtering (data_collection: "deny") in OpenRouter settings and request headers to block training/logging providers. |
| AssemblyAI | Does not train (per OpenRouter aggregation). | Does not train. | Prompts/transcripts retained for an unknown/unspecified default period unless deleted via API or BAA/ZDR agreement. | US / EU (configurable). | Issue explicit DELETE /v2/transcript/{id}[span_303](start_span)[span_303](end_span) API call immediately after receiving the transcription response. |

### Legal Limits in Iran vs. International Jurisdictions

Within the Iranian regulatory landscape, directives issued by the Central Bank of Iran (CBI / بانک مرکزی) prohibit storing sensitive banking and payment instrument records on unauthorized external platforms. Furthermore, Iran's centralized AI and cyberspace governance framework—enforced by the Supreme Council of Cyberspace (شورای عالی فضای مجازی), the National Artificial Intelligence Organization (NAIO), the Cyber Police (FATA), and the Electronic Commerce Development Center (ECDC / e-Namad)—mandates strict data sovereignty and the localization of data collection, storage, and processing within national borders. Non-compliance exposes platforms to bandwidth throttling, service blocking by the Ministry of ICT, financial penalties, or revocation of e-Namad payment gateway access. While Iran's comprehensive Personal Data Protection Bill (لایحه حمایت از داده‌های شخصی) has experienced prolonged legislative delays without unified parliamentary enactment, binding civil and criminal liability for unauthorized disclosure of confidential commercial or customer data is actively enforced under the Electronic Commerce Law of Iran (2004 / قانون تجارت الکترونیکی)—which also explicitly recognizes automated transactions executed by pre-programmed software agents—alongside the Computer Crimes Law (2009 / قانون جرایم رایانه‌ای) and Article 648 of the Islamic Penal Code.

These legal realities carry direct architectural consequences for Roxira's hosting topology. Hosting primary Iranian tenant databases on a German Hetzner server while transmitting unmasked Iranian financial records to US or Chinese LLM APIs conflicts with domestic data residency mandates for regulated buyers and exposes synchronous user workflows to cross-border network filtering and sanctions disruptions. Consequently, for the Iranian production deployment, the primary Docker Compose stack (PostgreSQL, Qdrant, NestJS, FastAPI, and S3-compatible object storage) should reside on a domestic Iranian cloud provider (such as ArvanCloud, Asiatech, or ParsPack), while the Hetzner Germany server operates either as the international SaaS node or as an encrypted, zero-PII outbound inference proxy. For international tenants hosted on the European Hetzner server, GDPR Article 28 mandates a formal Data Processing Agreement (DPA) with any third-party AI processor, and Chapter V restricts cross-border transfers to jurisdictions lacking adequacy decisions or Standard Contractual Clauses (SCCs)—which legally disqualifies default DeepSeek endpoints and unpaid Google AI Studio tiers from processing unmasked personal data.

Mandatory PII Masking Proxy and Crypto-Shredding Architecture

To enforce technical privacy independent of vendor promises, FastAPI incorporates a Reversible Tokenization Proxy ahead of LiteLLM. Before any outbound API call is dispatched, a deterministic regex and entity-dictionary scrubber replaces all tenant names, counterparty names, national identifiers (کد ملی / شناسه ملی), tax identifiers (کد اقتصادی), telephone numbers, IBAN/Sheba strings (شبا), card numbers, and street addresses with session-scoped placeholders ([ENTITY_101], [IBAN_202], [TAX_ID_303]) stored in Redis with a 15-minute time-to-live. External language models therefore process only anonymized structural graphs, dates, and bare integers (e.g., [ENTITY_101] recorded turnover of 450000000 in 1403-Q1), which the proxy re-hydrates into Persian text upon response receipt.

For data at rest and tenant lifecycle management, sensitive metadata columns and Cloudflare R2 document blobs are encrypted using AES-256-GCM with a per-tenant Data Encryption Key (DEK) wrapped by an environment Master Key. When a tenant offboards or exercises a right-to-erasure request, the system executes crypto-shredding by destroying the tenant's DEK (DELETE FROM tenant_keys WHERE tenant_id = $1), cascading deletion across PostgreSQL (DELETE FROM memory_episodes WHERE tenant_id = $1), and purging Qdrant vectors via tenant filter (FilterSelector(filter=Filter(must=[FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id))]))), guaranteeing immediate and irreversible erasure across all relational, vector, and object stores.

9. Persian NLP, OCR, Speech, and Jalali/Numeral Engineering

Operating an accounting assistant in Iran requires deterministic handling of Persian orthography, mixed Persian-English accounting jargon ("Finglish"), Jalali calendar arithmetic, and Rial/Toman currency ambiguity.

Measured Model Benchmarks for Persian (2025–2026)

Recent empirical benchmarks provide clear quantitative guidance for selecting Persian embedding, OCR, and speech models. On the FaMTEB (Massive Text Embedding Benchmark in Persian Language) suite, BAAI/BGE-M3 achieves the highest overall score among open multilingual models at 65.29, with a 58.75 retrieval score and a 90% Persian rating ranking #8 out of 286 models on the global MTEB leaderboard. Jina-embeddings-v3 follows closely at 64.53 overall and leads on pure Persian retrieval at 59.93, outperforming multilingual-e5-large (64.40 overall, 59.86 retrieval) and GTE-multilingual-base (63.64 overall, 56.07 retrieval), while domestic models such as MCINext/Hakim-small and Qwen3-Embedding-0.6B also demonstrate strong domain performance. Because Roxira already integrates Jina and Qdrant, pairing Jina-embeddings-v3 (or BGE-M3 for combined 1024-d dense, sparse BM25 lexical, and multi-vector representations) with bge-reranker-v2-m3 allows Qdrant to match exact Persian ledger codes (معین 1102) alongside semantic concepts (حسابهای دریافتنی تجاری).

In the optical character recognition domain, Surya 2 and Surya 2.5 (650M–689M parameters) achieve strong global scores (85.9 on OmniParseBench and 83.7% on olmOCR-bench for Surya 2.5), but Datalab's internal 91-language benchmark reveals that Persian pass rates reach only 63.8% (Surya 2) and 67.9% (Surya 2.5), lagging well behind the 74.9% 91-language mean and 91.1%–94.1% for Portuguese (while Arabic scores 45.4%). Furthermore, a 2026 evaluation of surya-ocr-2 on printed Persian word crops (ParsynthOCR) and real Persian handwriting (PHTD holdout) documented severe multi-word hallucinations and inflated Word Error Rates (74.56%–168.39%). Compounding these accuracy limitations, Surya's weights carry a modified AI Pubs Open RAIL-M license restricting free commercial use to startups under $5M in funding or revenue[span_382](start_span)[span_382](end_span)[span_383](start_span)[span_383](end_span), and Surya 2.5 removed table row/column coordinate bounding boxes in favor of HTML-only output. Conversely, *[span_379](start_span)[span_379](end_span)[span_381](start_span)[span_381](end_span)*PaddleOCR-VL-1.5 (0.9B VLM)** achieves state-of-the-art **94.5% accuracy on OmniDocBench v1.5** and **92.05% on Real5-OmniDocBench** (engineered specifically for skew, warping, phone-camera receipt photos, and lighting distortions), natively supports the Arabic/Persian script family, and includes **Seal/Stamp Recognition (`تشخیص مهر و امضا`)** and table recognition under a permissive Apache-2.0 license[span_384](start_span)[span_384](end_span)[span_385](start_span)[span_385](end_span). Consequently, Roxira [span_279](start_span)[span_279](end_span)should adopt **PaddleOCR-VL-1.5 (0.9B)** or **Gemini 2.5 Flash (on a Billed/Paid API Tier)** for Persian invoice and check (`چک صیادی`) extraction, backed by a mandatory mathematical cross-check ($\sum \text{Line Items} + \text{VAT} - \text{Discount} == \text{Invoice Total}$) before creating draft vouchers.

For Persian automatic speech recognition (ASR), untuned OpenAI Whisper Large v3 exhibits high error rates on Persian speech, recording a 33.14% to 50.2% Word Error Rate (WER) across standard benchmarks—specifically 33.14% on Speechmatics' benchmark, 43.77% in a 2025 academic baseline (versus 20.10% for Google Speech Recognition), 50.2% on Common Voice 17 fa, and 86.5% on colloquial Filimo dialogue. However, Persian-fine-tuned Whisper Large v3 and v3-turbo checkpoints reduce error rates substantially: MohammadGholizadeh/whisper-large-v3-turbo-persian reduces Common Voice 17 WER from 50.2% down to 19.4% (and no-space Character Error Rate from 23.6% to 4.2%); givia/whisper-large-v3-turbo-persian achieves 11.2% WER (2.7% CER) on long-form colloquial Persian using 2-second overlapped chunking and provides a whisper.cpp GGML binary; and QLoRA fine-tuning on the Neyshekar dataset lowers WER from 36.97% to 8.74%. Among commercial APIs, ElevenLabs reports 7.8% WER, Gemini Flash 2 reports 8.0% WER, Speechmatics claims ~10% WER (<1s latency), and Gladia (Solaria-3) and AssemblyAI offer managed Persian endpoints. Roxira can therefore rely on Gemini 2.5 Flash Audio (Billed Tier) or AssemblyAI (with immediate post-transcription deletion) for cloud ASR, or serve givia/whisper-large-v3-turbo-persian with 2-second audio overlap.

http://googleusercontent.com/visual_element_2

Mandatory Persian Orthography, Numeral, and Jalali Normalization Pipeline

Before any text reaches an embedding model, BM25 index, or LLM prompt, a deterministic preprocessing pipeline in Python and TypeScript must standardize five linguistic and numerical dimensions. First, character unification replaces Arabic Yeh variants (ي U+064A and ى U+0649) with standard Persian Yeh (ی U+06CC), converts Arabic Kaf (ك U+0643) to Persian Kaf (ک U+06A9), and strips tatweel/kashida formatting (ـ U+0640) and vowel diacritics. Second, because Persian morphological affixes (می‌شود, فاکتورها, حساب‌های) appear inconsistently with spaces, Zero-Width Non-Joiners (ZWNJ U+200C / نیم‌فاصله), or fully joined forms (میشود), the normalizer canonicalizes all affix boundaries so that surface variants hash to identical tokens in trigram and BM25 indices. Third, all Eastern Arabic-Indic (٠-٩) and Persian (۰-۹) digits are transliterated to standard ASCII numerals (0-9), paired with a deterministic Persian word-to-number parser (converting phrases like "چهارصد و پنجاه میلیون" into 450000000) to handle inconsistent ASR number formatting.

Fourth, the pipeline enforces a strict Rial and Toman (ریا[span_392](start_span)[span_392](end_span)ل / تومان) Disambiguation Guardrail. In Iranian commercial conversation, users routinely state figures in Tomans ($1 \text{ Toman} = 10 \text{ Rials}$) or colloquial shorthand ("پنجاه تومن"), whereas general ledgers record values strictly in Rials. The input parser explicitly checks for currency unit suffixes; if a user references a monetary figure without specifying Rials or Tomans, the assistant is barred from guessing—it either queries both $X$ and $10X$ Rials during read-only entity lookup or prompts the user to confirm the unit before creating any draft entry. Fifth, because language models frequently miscalculate Jalali-to-Gregorian calendar conversions and 31/30/29-day month boundaries (particularly across Esfand leap years), the orchestrator injects the current Jalali date, day of the week, and tenant fiscal year boundaries into every system prompt and delegates all relative date math ("فصل بهار ۱۴۰۳", "اسفند پارسال") to a deterministic Python jalaali / persiantools function.

10. Multi-Agent vs. Single-Agent Topology and Local Model Viability

Why Multi-Agent Swarms Fail on Rate-Limited Free Tiers

Autonomous multi-agent swarms—in which a "Manager Agent" converses with a "SQL Agent," an "Auditor Agent," and a "Memory Agent" via unconstrained message passing—exhibit three severe failure modes within Roxira's operating constraints. First, multi-agent handoffs cause Token and Rate-Limit Amplification: a single user question in a four-agent swarm triggers 8 to 15 LLM inference calls, which rapidly exhausts the tight Requests-Per-Minute (RPM) and Tokens-Per-Minute (TPM) quotas of free-tier APIs (such as Groq, Google AI Studio, and OpenRouter) and triggers cascading HTTP 429 failures under multi-user load. Second, sequential agent-to-agent summarization introduces Compound Error and Context Drift, where intermediate paraphrases subtly corrupt Jalali dates, voucher codes, or Rial amounts. Third, chaining half a dozen remote API round-trips inflates Tail Latency to 25–45 seconds, degrading interactive chat and voice usability.

Consequently, Roxira should reject conversational multi-agent swarms in favor of a Single Deterministic State-Graph Orchestrator (LangGraph) with Scoped Tool-Calling Sub-Steps. Under this topology, a single deterministic state machine routes the user's request through Python and NestJS execution nodes (Entity Lookup $\rightarrow$ Semantic Metric Compilation $\rightarrow$ Bitemporal Graph Retrieval) and invokes the language model at most twice per turn: once for structured intent and parameter extraction, and once for final citation-grounded Persian synthesis. Where query ambiguity warrants multiple perspectives, the system applies GeminiSQL-2 style self-consistency—generating 3 candidate metric queries within a single batched inference call and selecting the majority execution result cluster—rather than sequential multi-agent debate.

Viability of Running a Local Model on a Small Hetzner Server

Running a local generative language model (>1B parameters) on a single small CPU-only Hetzner server is architecturally unviable and should be avoided. Executing even a 4-bit quantized 7B–8B model (such as Qwen2.5-7B or Llama-3.1-8B via Ollama or llama.cpp) consumes 5 to 6 GB of system RAM, saturates all vCPU cores at 4 to 8 tokens per second, starves PostgreSQL, PgBouncer, and Qdrant of memory and CPU cycles, and yields markedly inferior Persian tool-calling and SQL reasoning accuracy compared to remote 70B+ parameter models accessed via Groq or Gemini. Conversely, if the Hetzner server is provisioned with at least 16 GB of RAM, running a lightweight CPU/ONNX utility model ($\le 600\text{M}$ parameters)—specifically a quantized local embedding or reranker model (BGE-M3 requiring ~1.2 GB RAM) alongside deterministic regex/NER PII scrubbing—is highly effective, enabling internal document indexing and privacy masking to operate with zero external API latency or data exposure. All generative reasoning, VLM document OCR, and speech recognition should remain offloaded to remote APIs behind the LiteLLM privacy proxy.

11. Actionable Engineering Blueprint: Build, Adopt, Avoid, and Phased Rollout

Build, Adopt, or Avoid Matrix

Category	Component / Technology	Decision	Technical & Economic Justification
Adopt	PostgreSQL Native Bitemporal Graph + pgvector	ADOPT	Replaces Neo4j/Graphiti infrastructure overhead using native tstzrange, btree_gist, and FORCE ROW LEVEL SECURITY on existing Postgres.
Adopt	BullMQ (NestJS) + LangGraph (>=3.1.3 in FastAPI)	ADOPT	Zero new infrastructure; combines durable background jobs with stateful human-in-the-loop (L2 approval) agent checkpoints.
Adopt	Jina-embeddings-v3 / BGE-M3 + Qdrant	ADOPT	Top-ranked measured Persian retrieval performance on FaMTEB (59.93 / 58.75 retrieval, 65.29 overall) using existing stack.
Adopt	PaddleOCR-VL-1.5 (0.9B) / Gemini 2.5 Flash (Billed)	ADOPT	SOTA 94.5% OmniDocBench accuracy with Persian script and stamp recognition, avoiding Surya's 63.8%–67.9% Persian pass rate and $5M revenue license cap.
Build	YAML Semantic Metric Compiler + FLINT Lookup Node	BUILD	Eliminates the 76%–96% foreign-key grounding error rate and guarantees 100% deterministic Rial math on in-scope metrics.
Build	Persian Normalization & Reversible PII Masking Proxy	BUILD	Unifies ی/ک/ZWNJ/numerals, enforces the Rial/Toman guardrail, and strips confidential identities before prompts hit external APIs.
Build	Post-Generation Numeric & Citation Validator	BUILD	Deterministically cross-checks every generated numeral against SQL output JSON and forces abstention when evidence is missing.
Avoid	Raw Unconstrained Text-to-SQL over Full DDL	AVOID	<50% accuracy on production financial schemas; silently fabricates numbers via bad joins and snapshot summing.
Avoid	Zep CE / Neo4j / Temporal Server / Local 7B+ LLMs	AVOID	Zep CE is deprecated; Neo4j, Temporal, and local 7B LLMs will exhaust RAM/CPU on a single small Hetzner server.
Avoid	Unpaid Google AI Studio & Default DeepSeek for Raw Data	AVOID	Both train on user prompts by default (with human review on Google free tier and PRC storage/undefined retention on DeepSeek).

Phased Implementation Plan for a Single Server

Phase & Timeline	Deliverables	Memory & Compute Budget on One Hetzner Server (8 vCPU / 16–32 GB RAM)
Phase 1: Truth, Privacy & RLS Foundation (Weeks 1–3)	1. Enable FORCE ROW LEVEL SECURITY and PgBouncer SET LOCAL wrapper across all ledger and LightRAG tables.
2. Build Persian orthography/numeral/Jalali normalizer and Rial/Toman disambiguator.
3. Deploy FastAPI Reversible PII Masking Proxy in front of LiteLLM.
4. Configure Groq ZDR, OpenRouter data_collection: deny, and link Google Cloud Billing to switch Gemini to Paid/No-Train terms.	+0 MB new containers. Runs inside existing NestJS, FastAPI, PostgreSQL, and Redis containers (~6–8 GB total baseline RAM).
Phase 2: Semantic Layer & Bitemporal Memory (Weeks 4–7)	1. Author 25 core accounting metrics in YAML (Bank Turnover, AR/AP Aging, Trial Balance, Cash Flow) + FLINT entity lookup tool.
2. Deploy PostgreSQL Bitemporal Memory DDL (memory_episodes, memory_entities, memory_bitemporal_facts, memory_procedural_rules).
3. Build Post-Generation Numeric & Citation Validator. Deliver end-to-end Longitudinal Deal & Turnover Investigator (L0).	+500 MB PostgreSQL disk/index growth. BullMQ background memory consolidation runs asynchronously at max concurrency = 2.
Phase 3: High-ROI Action Agents & OCR/Voice (Weeks 8–12)	1. Upgrade langgraph-checkpoint-postgres to \ge 3.1.3 and implement L1 (Draft) and L2 (HMAC Human Approval) workflows.
2. Launch Bank Reconciliation Agent, Period-End Close Copilot, and Invoice OCR Voucher Drafter (via remote VLM/PaddleOCR-VL API + R2 bounding box citations).
3. Integrate Persian voice input (givia/whisper-large-v3-turbo-persian or Billed Gemini Audio).	~10–12 GB total system RAM. All heavy VLM/ASR inference stays off-server via LiteLLM/API; Daytona sandboxes remain remote.

Acceptance Metrics and CI/CD Regression Gates

Before promoting any prompt template, model route, or semantic metric specification to production, the automated evaluation suite must satisfy seven non-negotiable acceptance gates:

Metric Dimension	Evaluation Method / Benchmark	Mandatory Production Acceptance Threshold
Numeric Precision (Hallucination Rate)	Post-generation regex comparison of all response numbers against SQL tool JSON output on 150-query Golden Set.	100.0% Exact Match (0.0% unverified numeric fabrication allowed).
In-Scope Metric Execution Accuracy	FLINT 3-tier pipeline (AST + Column-Aligned Execution + Judge) on 50 core accounting queries.	\ge 96.0\% Execution Accuracy.
Abstention & Out-of-Scope Safety	20 adversarial/missing-evidence trap queries (unmodeled metrics, missing bank statements, locked periods).	100.0% Explicit Abstention / Refusal (0 silent guesses).
Multi-Tenant Isolation & RLS Gate	Automated penetration test attempting cross-tenant UUID injection in SQL, Qdrant filters, and LangGraph namespaces.	0 Cross-Tenant Records Returned across 1,000 fuzzing runs.
Bitemporal Retrieval Precision	Point-in-time queries testing whether superseded contract facts leak into historical valid_time windows.	\ge 92.0\% Temporal Fact Precision@5 and \ge 0.85 MRR@10.
End-to-End Latency (p95)	Measured client-side across synchronous chat turns (Lookup + Semantic SQL + Graph Fetch + Synthesis).	p50 \le 3.5\text{s}, p95 \le 8.0\text{s} for text; p95 \le 12.0\text{s} for voice/OCR turns.
Blended Cost per Task	Token & API cost tracker across LiteLLM routes (combining ZDR free tiers and billed fallbacks).	\le \$0.008 per L0 query; \le \$0.03 per multi-page OCR voucher draft.

12. Risks, Unknowns, and Unverified Claims

Maintaining audit-grade engineering rigor requires explicitly distinguishing between independently verified facts, vendor-reported claims, and unverified operational assumptions. Regarding vendor-reported benchmarks, Zep's claims of 94.7% accuracy on LoCoMo and 90.2%–90.79% on LongMemEval originate from vendor-affiliated publications and comparative marketing pages; Graphiti's temporal extraction accuracy on Persian accounting episodes has never been independently benchmarked. Similarly, dbt Labs' 100% in-scope semantic layer accuracy figure derives from a vendor-authored 11-question evaluation over a 15-table insurance dataset; while the underlying compilation mechanism is deterministic, production coverage is strictly bounded by the breadth of Roxira's authored YAML metrics. In the speech domain, Speechmatics' claims of "90% accuracy with <1 second latency" and "60% faster than the nearest competitor" for Persian ASR represent unverified vendor marketing assertions, whereas the 8.74% to 19.4% WER figures for fine-tuned Whisper Large v3 and v3-turbo checkpoints are substantiated by reproducible open-source evaluation manifests on Common Voice 17, FLEURS, and Neyshekar.

Finally, three operational unknowns require proactive mitigation during deployment. First, the system specification notes "one small Hetzner server" without stating exact vCPU, RAM, or NVMe capacities; if the host has only 4 GB to 8 GB of RAM, running PostgreSQL, Redis, Qdrant, NestJS, Next.js, and FastAPI concurrently will trigger Linux OOM-killer terminations during LightRAG indexing spikes unless explicit Docker me[span_147](start_span)[span_147](end_span)[span_150](start_span)[span_150](end_span)m_limit bounds and swap allocations are enforced. Second, calling US and European LLM APIs (Groq, Google, Mistral, OpenRouter) from inside Iran—or serving Iranian users directly from a German Hetzner node—is vulnerable to unpredictable BGP routing drops, TLS inspection, and sanctions-related IP blocks, underscoring the necessity of a domestic Iranian hosting node paired with an encrypted tunnel to the international inference proxy. Third, statutory electronic invoicing schemas (سامانه مودیان) and tax circulars issued by the Iranian National Tax Administration (INTA) undergo frequent administrative revisions, requiring a scheduled human verification gate before newly ingested tax circulars in LightRAG are authorized to guide user compliance decisions.




Sources used in the report
  graphiti-core - PyPI

  getzep/graphiti at zep-memory-for-ai.ghost.io - GitHub

  A HydraDB alternative for agent memory - Zep

  getzep repositories - GitHub

  graphiti/examples/quickstart/quickstart_neptune.py at main - GitHub

  Graphiti: memory types, pricing, MCP and self-hosting (2026)

  Announcing a New Direction for Zep's Open Source Strategy

  Multi-Tenancy | lettactl

  letta-nightly - PyPI

  Letta Review: Memory, ADE, Pricing & Alternatives - PromptQuorum

  langgraph.store - LangChain Reference

  Custom MCP server for self-hosted Mem0 API - GitHub

  Mem0 MCP Server

  mem0/LLM.md at main - GitHub

  Best Open-Source Agent Memory Systems (Self-Hosted, 2026)

  Multi-Tenant AI Memory with Data Isolation 2026 - Cognee

  GitHub - subhashdasyam/mem0-server-mcp: Production-ready MCP

  zerodb-mem0/README.md at main - AINative-Studio - GitHub

  openmemory/docs/architecture.md at main - Bilal140202 - GitHub

  Cognee - RepoCloud

  Best Mem0 Alternatives in 2026 - Cognee

  Cognee is the open-source AI memory platform for agents ... - GitHub

  cognee · PyPI

  6 Best Open-Source Cognee Alternatives (2026) — Statewave Blog

  Self-Hosted vs VPC vs Managed AI Memory: Deployment Guide

  PGV-26588AT - LangGraph: Namespace prefix matching crosses

  Agent Memory 2026: LangChain vs AgentCore vs Strands

  Langgraph CVEs and Security Vulnerabilities - OpenCVE

  CVE-2026-115883: Cross-Namespace Access via Dot-Delimited

  Namespace prefix matching crosses segment boundaries ... - GitHub

  Hire LangChain Developers | $35/hr | 48h | Meduzzen

  detasar/bird-text2sql-experiments: Text-to-SQL research ... - GitHub

  Text-to-SQL Accuracy: 91% in Benchmarks, 21% on Real Data

  Bird-SQL

  Google Research's GeminiSQL-2 Tops the Hardest SQL Benchmark

  Arctic-Text2SQL-R1 Tops BIRD and Wins Broadly - Snowflake

  A Text-to-SQL System for Complex Financial Data - arXiv

  PgBouncer at Scale: 10K+ Connections Multi-Tenant Postgres

  Row-Level Security for Multi-Tenant Applications | Connect·IT

  PgBouncer Transaction Mode: What Leaks Between Clients | Seedfast

  Multi-Tenant SaaS Architecture: Postgres RLS Tested 6 Ways

  Postgres RLS for Multi-Tenant Django — steezr blog

  FAQs - Groq's Trust Center

  groq-data-handling - Agent Skill

  Does Groq store your API prompts? Data retention, ZDR and

  Groq Data Handling (Grade A) - Claude Skill - Skills Directory

  Provider Logging - Provider Data Retention Policies - OpenRouter

  per-provider data-retention / training-use posture #7431 - GitHub

  The AI Training Data Opt-Out Lie: Why Your Prompts Are Being

  Google Gemini | Missive Docs

  Google AI Studio Privacy Review for Freelancers (2026)

  Google AI Studio - Free Gemini Guide – GetFreeAI.net

  Is Gemini API Free? (2025) - Spur

  DeepSeek Privacy Policy: What Data It Collects and What Users

  DeepSeek Privacy Policy

  DeepSeek: domains, data terms, retention | AI Service Directory

  DeepSeek Privacy Policy 2026: Data Retention, Storage & AI Training

  DeepSeek trains on your inputs. That's why people go on

  DeepSeek: configuring privacy and deploying a local version

  Inference - Mistral

  Zero Data Retention for LLM APIs, Explained - Nodion

  Does Mistral store your API prompts? Data retention, ZDR and

  Mistral API Pricing vs Self-Hosted LLMs: Cost and Privacy in 2026

  GitHub - datalab-to/surya: OCR, layout analysis, reading order, table

  surya-ocr - PyPI

  Reza2kn/surya-ocr-2-persian-handwriting-369k - Hugging Face

  Surya 2.5: 1.7x faster, best open OCR under 1B | Datalab

  PaddleOCR-VL Introduction - PaddleOCR Documentation

  Announcing Surya OCR 2: small, accurate, multilingual - Datalab

  (PDF) PaddleOCR-VL-1.5: Towards a Multi-Task 0.9B VLM for

  TR-MTEB: A Comprehensive Benchmark and Embedding Model

  bge-m3 · MTEB Leaderboard

  MCINext/Hakim-small - Hugging Face

  QwenLM/Qwen3-Embedding - GitHub

  FaMTEB: Massive Text Embedding Benchmark in Persian Language

  Free Persian Speech to Text Transcription - ElevenLabs

  Persian speech to text transcription API - Speechmatics

  MohammadGholizadeh/whisper-large-v3-turbo-persian

  givia/whisper-large-v3-turbo-persian - Hugging Face

  Fine-tuning Whisper large-v3 for Persian ASR with QLoRA — WER

  ParsVoice: A Large-Scale Multi-Speaker Persian Speech Corpus for

  Speech-to-Text API | Free Batch Transcription - giggy.ai

  Real-time and async Speech-to-Text for Persian (Farsi) - Gladia

  سرور بانکی چیست؟ راهنمای خرید + بررسی تخصصی مدل‌ها، سخت‌افزار

  اسنپ فود هک اطلاعات را تایید کرد/ جای خالی «قانون حفاظت از داده

  Middle East and North Africa - AI Regulation Overview

  Ali Namdar: The Visionary Behind Iran's Digital Revolution

  Data residency requirements for global banking institutions - InCountry

  Iran AI Regulation Overview - Regulations.ai

  Personal Data Protection in the Iranian Legal System

  tensor-db/TensorDB: Bitemporal ledger database with MVCC, SQL

  Semantic Layer vs Text-to-SQL Accuracy for AI Agents | Data Workers

  Cube Semantic Layer: Architecture, Adoption, and Gaps [2026] - Atlan

  Text-to-SQL Accuracy and Semantic Layers: The Evidence | Medium

  Semantic Layer for AI Agents: Better Accuracy in 2026 - RejoiceHub

  Semantic Layer for AI Agents (2026) - Cube.dev

  Range Types and Temporal Constraints - The Art of PostgreSQL

  Bi-temporal database design - Medium

  PostgreSQL Temporal Tables: INSERT, UPDATE & DELETE

  PostgreSQL as a temporal database - Xata.io




Sources read but not used
  graphiti/graphiti_core/llm_client/openai_client.py at main - GitHub

  graphiti/Zep-CLA.md at main · getzep/graphiti · GitHub

  graphiti/graphiti_core/llm_client/config.py at main · getzep ... - GitHub

  letta-agent-forge - yugmi-ai - GitHub

  NORTHTEKDevs/genome: Auditable memory layer for AI ... - GitHub

  Air-Gapped AI Memory for Enterprise Deployment | Cognee 2026

  Cognee Review 2026: GraphRAG & Agent Memory

  RNR-Enhanced-Cognee/docs/PHASE5_TODO.md at main - GitHub

  Building Smart Agents, Reasoning, Memory, and Planning in

  Memory - Docs by LangChain

  bird-text2sql-experiments/docs/EXPERIENCES.md at main · detasar

  An Examination of the BIRD-Bench Benchmark - arXiv

  The Text-to-SQL Performance Cliff (2026): Why “Natural Language

  Text-to-SQL Benchmarks are Broken: An In-Depth Analysis of

  Policies & Notices - GroqDocs - Groq Console

  Privacy Policy | Memo AI - NotePlan

  What API providers offer specific data retention/ privacy policies?

  Zero data retention (AI vendor terms) | Data Dictionary - Data Panda

  Gemini 2.5 API in Privacy Mode? : r/GoogleGeminiAI - Reddit

  Google AI Studio Review (Oct 2026): Free Tier, Models, Cost

  Does one billed API project protect Playground chats from training?

  DeepSeek Harness | Privacy Policy

  DeepSeek API Data Retention Policy 2026 - Does DeepSeek Train

  DeepSeek Privacy Policy

  Is DeepSeek Safe to Use? Privacy, Bans and Censorship (2026)

  GDPR-compliant AI: use AI APIs the European way - EUrouter

  Is Mistral Le Chat Safe? Does It Train on Your Data? - Sanitized Ai

  Surya - AI4Culture

  MORE: A Multilingual Document Parsing Benchmark and Evaluation

  FaMTEB: Massive Text Embedding Benchmark in Persian Language

  FaMTEB: Massive Text Embedding Benchmark in Persian Language

  tivanai2020/whisper-large-v3-turbo-persian-farsi-unified-cleaned

  MohammadReza-Halakoo/persian-whisper-large-v3-10-percent-17

  Download persian from openai/whisper-large-v3 - Hugging Face

  [Bug] Fine-tuned unsloth/whisper-large-v3 Performs Poorly ... - GitHub

  Supported Languages - AssemblyAI

  WhisperTranscribe - Transcribe your audio with Whisper AI

  Glot Labs | Intelligent Speech Orchestration

  بروزرسانی لیست ابربدهکاران بانکی - ایران جیب

  نسبت ذخیره قانونی (SRR) - تعریف و مثال - Familiarize Docs

  بانکداری داده محور مهمترین رکن بانکداری دیجیتال - راه پرداخت

  کتاب الکترونيک مجموعه بخشنامه‌هاي اداره مطالعات و مقررات بانکي

  قانون بانک مرکزی باید برای نظارت بر بانک‌های خصوصی اصلاح شود

  Data residency for financial services companies - InCountry

  Data Residency Laws by Country: Where Data Must Be Stored (2026)

  The Establishment of GRC Integrated Approach in Iranian bank

  Regulation on electronic transactions - World Bank Document

  We tested the same text-to-SQL model with and without business

  Best Text-to-SQL Tools 2026: Scored on Accuracy - Colrows

  Semantic Layer vs. Text-to-SQL: 2026 Benchmark Update

  Semantic Layers for Reliable LLM-Powered Data Analytics - arXiv

  Semantic Layers and Governed Metric Definitions for Text-to-SQL

  Using PostgreSQL tstzrange datatype - TMS Data Modeler

  PostgreSQL Temporal Tables: Querying Historical Data with Time

  Multi-temporal versioning in Postgres – HASH Developer Blog




Thoughts
