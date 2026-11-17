# Vector Store Tenancy & Qdrant Isolation Audit (T153)

> **Standard Reference**: AGENTS.md §1/§4, `docs/strategy/research/R8_FACT_CHECK.md` (Row T153), Lesson 25 (Fail-Closed).  
> **Target System**: Qdrant Vector Engine (`roxira_qdrant_prod`, port 6333) and Python AI Core Layer (`output_apps/generated_modules/smartjudge/`, `output_apps/ecosystem_core/`).

---

## 1. Executive Summary & Threat Model

PostgreSQL Row-Level Security (RLS) protects relational tables within the transactional database layer (`roxira_app` NOSUPERUSER NOBYPASSRLS). However, **PostgreSQL RLS does NOT apply to external vector databases** like Qdrant.

Without application-layer enforcement:
1. An unconstrained similarity search on an external vector index containing customer documents or user interactions can return vector points belonging to another tenant (Cross-Tenant Vector Bleed).
2. A client-crafted query filter with `should` (OR) clauses could circumvent developer-intended scoping unless the tenant condition is immutably injected into the `must` (AND) array.

**Remediation Rule (T153)**: Any collection holding tenant, customer, or individual user data MUST be queried and written through a hardened tenant wrapper (`TenantVectorStoreWrapper`), which strictly requires a validated `tenant_id` or `user_id`. Queries lacking a valid tenant filter are rejected immediately (**Fail-Closed**), raising `TenantFilterRequiredError` before any network request reaches Qdrant.

---

## 2. Platform Vector Collections Audit

The table below lists every Qdrant collection discovered across the entire Roxira repository, its writers, readers, dimensionality, and whether it stores tenant/user data.

| Collection Name | Writers | Readers | Vector Spec | Holds Tenant / User Data? | Isolation Mechanism |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `smartjudge_learned_experience` | `output_apps/ecosystem_core/src/learning/self_learning_agent.py` (`record_interaction`) | `self_learning_agent.py` (`retrieve_past_experience`) | 1024-dim, Cosine | **YES** (User queries, dialogues, learned lessons) | **Hardened**: Enforced by `TenantVectorStoreWrapper`. Missing tenant context raises `TenantFilterRequiredError`. |
| `tenant_case_documents` (planned / reserved) | Document ingestion services, case files pipeline | SmartJudge document retriever | 1024-dim / 768-dim, Cosine | **YES** (Client case files, contracts, uploaded exhibits) | **Hardened**: Registered in `TENANT_COLLECTIONS`; queries without `tenant_id` are rejected. |
| `tenant_documents` / `tenant_knowledge_base` / `tenant_crm_vectors` | AI Assistant, CRM document sync | Assistant retrieval pipeline | 1024-dim, Cosine | **YES** (Tenant internal knowledge & CRM customer interactions) | **Hardened**: Enforced by `TENANT_COLLECTION_PREFIXES` pattern (`tenant_*`, `customer_*`, `user_*`). |
| `iran_laws_v1` / `iran_laws_v2` / `iran_laws_v3` / `iran_laws_bge_m3` | `scripts/w6_ingest_dotic.py`, `scripts/legal/build_collection.py`, `law_ingester_pipeline.py`, crawler daemons | `lightrag_engine.py`, `laws_public.py`, `smartjudge_module.py`, `sat_rag_retriever.py`, `mcp_server.py` | 1024-dim (`BAAI/bge-m3`), Cosine | **NO** (Public statutory laws, parliamentary acts, official gazette articles) | Public reference corpus. No tenant data; open read access for legal citation. |
| `iran_laws_hakim_v1` / `iran_laws_hakim` | `scripts/legal/reindex_hakim.py` | `lightrag_engine.py` (when Hakim embed switch is active) | 768-dim (`MCINext/Hakim`), Cosine | **NO** (Public statutory articles embedded with Hakim) | Public reference corpus. |
| `iran_laws_mistral_v1` | Historical crawler script | Legacy inspector | 1024-dim (`mistral-embed`), Cosine | **NO** (Public Iranian civil & commercial statutes) | Public reference corpus (legacy). |
| `iran_rulings_v1` / `judicial_precedents` | `scripts/legal/ingest_rulings.py` | `rulings_retrieval.py`, `mcp_server.py` | 1024-dim (`BAAI/bge-m3`), Cosine | **NO** (Supreme Court unity rulings & Court of Administrative Justice decisions) | Public reference corpus (judicial practice from ekhtebar.ir). |
| `iran_regulations_v1` | `scripts/legal/ingest_regulations.py` | `regulations_retrieval.py`, `regulations_public.py` | 1024-dim (`BAAI/bge-m3`), Cosine | **NO** (Executive bylaws, ministerial circulars, decrees) | Public reference corpus. |
| `roxira_legal_memory` | `output_apps/smart_judge/src/graphrag/legal_vector_indexer.py` | `output_apps/smart_judge/src/graphrag/retrievers/vector_retriever.py` | 384-dim (`MiniLM-L12-v2`), Cosine | **NO** (Graph nodes for civil, procedural, commercial legal categories) | Public reference corpus. |
| `software_factory_code_vectors` | `code_vector_engine.py`, `repo_ingestion_engine.py` | `roxira_factory_core.py`, `mcp_server.py` | 1024-dim, Cosine | **NO** (System source code repository snippets) | Internal platform code repository metadata. |
| `research_knowledge_base` | `qdrant_memory_agent.py` (`index_research_artifact`) | `qdrant_memory_agent.py` (`search_related_research`), `architect_ai.py` | 1024-dim, Cosine | **NO** (Internal engineering research & architectural blueprints) | Internal platform engineering knowledge. |

---

## 3. Enforcement Architecture: `TenantVectorStoreWrapper`

Located in: [`output_apps/generated_modules/smartjudge/security/vector_tenant_wrapper.py`](../../output_apps/generated_modules/smartjudge/security/vector_tenant_wrapper.py)

### 3.1. Core Invariants
1. **Explicit Identification**: A query against any tenant collection MUST provide a non-empty `tenant_id` (or `user_id`). Placeholders such as `null`, `undefined`, `none`, `0`, or empty strings are strictly disallowed.
2. **Immutable `must` Injection**: The tenant filter condition:
   ```json
   {
     "key": "tenant_id",
     "match": { "value": "<validated_tenant_id>" }
   }
   ```
   is injected directly into the Qdrant filter's `must` array. This guarantees that even if a caller supplies custom search criteria, the tenant condition acts as an un-bypassable conjunct (`AND`).
3. **Conflict Detection**: If a caller submits an existing filter containing a conflicting `tenant_id`, the wrapper rejects the query immediately with `InvalidTenantFilterError`.
4. **Point Upsert Hardening**: Before any point is sent to Qdrant via `upsert`, the wrapper validates that every point payload contains the matching `tenant_id` tag. Points lacking the tag are automatically tagged with the validated context; points specifying a conflicting tenant are rejected.

---

## 4. Wiring: `self_learning_agent` Integration

In `output_apps/ecosystem_core/src/learning/self_learning_agent.py`:
- `retrieve_past_experience(query, tenant_id=None, user_id=None)`:
  - Prior to making network calls or verifying collection existence, checks `tenant_id` or `user_id`.
  - Unscoped queries raise `TenantFilterRequiredError` immediately.
  - Scoped queries route through `TenantVectorStoreWrapper.search()`, ensuring only lessons from that tenant are retrieved.
- `record_interaction(user_text, legal_context, assistant_reply, tenant_id=None, user_id=None)`:
  - Sanitizes and tags point payloads using `validate_points_for_upsert()`.

---

## 5. Automated Verification & Test Coverage

The enforcement mechanism is verified by unit tests in [`output_apps/generated_modules/smartjudge/tests/test_vector_store_tenancy.py`](../../output_apps/generated_modules/smartjudge/tests/test_vector_store_tenancy.py):

1. `test_is_tenant_collection_detection`: Proves accurate classification between tenant-scoped collections and public legal corpora.
2. `test_validate_identifier`: Proves rejection of `None`, empty strings, whitespace, injection characters, and `"null"` / `"0"`.
3. `test_enforce_tenant_filter_rejects_missing_tenant_on_tenant_collection`: Proves that queries on `smartjudge_learned_experience` without tenant filters fail closed.
4. `test_enforce_tenant_filter_injects_into_empty_filter`: Proves injection of `{"key": "tenant_id", "match": {"value": ...}}` into `must`.
5. `test_enforce_tenant_filter_preserves_existing_must_clauses`: Proves caller query conditions remain intact alongside the tenant filter.
6. `test_enforce_tenant_filter_rejects_conflicting_tenant_id`: Proves prevention of cross-tenant query spoofing.
7. `test_enforce_tenant_filter_passes_public_collections_unmodified`: Proves public legal corpora remain unrestricted.
8. `test_validate_points_for_upsert`: Proves that untagged upserts are rejected and valid tags are verified on point payloads.
9. `test_wrapper_search_payload_construction` & `test_wrapper_scroll_payload_construction`: Proves that high-level search and scroll builders strictly enforce tenancy.
10. `test_self_learning_agent_retrieve_past_experience_rejects_missing_tenant`: Proves that `self_learning_agent` rejects unscoped queries.
11. `test_self_learning_agent_retrieve_past_experience_scoped_query`: Proves that `self_learning_agent` successfully retrieves data when scoped.

**Execution Command**:
```bash
pytest output_apps/generated_modules/smartjudge/tests/test_vector_store_tenancy.py
```
*Result: 15 passed in 0.19s.*

---

## 6. Developer Guidelines for New Vector Collections

When creating any new Qdrant collection:
1. **Name Convention**: If the collection stores any tenant, client, or user data, name it with the prefix `tenant_` (e.g. `tenant_invoice_embeddings`) or register it explicitly in `TENANT_COLLECTIONS` inside `vector_tenant_wrapper.py`.
2. **Access Wrapper**: Never call Qdrant REST endpoints directly (`/collections/<name>/points/search`). Always use `TenantVectorStoreWrapper.search()` or `enforce_tenant_filter()`.
3. **Fail-Closed**: Always retrieve the active tenant ID from the authenticated request context (`TenantScope` in NestJS or `request.state.tenant_id` in FastAPI). Never fallback to querying without a tenant filter.
