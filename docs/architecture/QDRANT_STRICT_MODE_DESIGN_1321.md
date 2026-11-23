# Qdrant Strict Mode and Mandatory Tenant Filter Design (T348 / #1321)

From the next-generation infrastructure audit and review (#1300, #1316).

## 1. Problem & Context
In vector search architectures, unindexed payload filters force the database engine to perform expensive full collection scans. Furthermore, missing tenant filters on shared multi-tenant vector collections risk data bleeding across tenants (violating AGENTS.md §4).
Qdrant 1.9+ introduces `strict_mode_config`, allowing database-enforced limits:
- `unindexed_filtering_retrieve`: when set to `false`, any filter on an unindexed payload field is refused with HTTP 400.
- `max_query_limit`: query limits above this threshold are rejected.
- `max_timeout`: queries taking longer than this duration are cancelled.

## 2. Audited Collections & Strict-Mode Matrix (per #1300 Audit)

| Collection | Type | Multi-tenant? | Required Payload Indexes | Strict Mode Settings | Refused Queries under Strict Mode |
|---|---|---|---|---|---|
| `iran_laws_v2` / `iran_laws_hakim_v1` | Public Statutory | No | `is_active` (bool), `category` (keyword), `source_tier` (keyword), `law_id` (keyword), `article_no` (keyword) | `max_query_limit=100`, `max_timeout=10s`, `unindexed_filtering_retrieve=false` | Unindexed filter on `is_active` or `category`; queries with limit > 100. |
| `iran_rulings_v1` / `judicial_precedents` | Public Judicial Precedents | No | `sub_collection` (keyword), `category` (keyword), `ruling_type` (keyword), `year` (integer), `number` (keyword) | `max_query_limit=100`, `max_timeout=10s`, `unindexed_filtering_retrieve=false` | Filter on `sub_collection` without keyword index; limit > 100. |
| `iran_regulations_v1` | Public Regulations / Circulars | No | `doc_type` (keyword), `issuer` (keyword), `is_active` (bool), `category` (keyword), `doc_id` (keyword) | `max_query_limit=100`, `max_timeout=10s`, `unindexed_filtering_retrieve=false` | Unindexed filter on `doc_type` or `issuer`; limit > 100. |
| `tenant_case_documents` | Tenant Documents & Uploads | **YES** | `tenant_id` (keyword, **MANDATORY**), `user_id` (keyword), `case_id` (keyword), `file_id` (keyword), `status` (keyword) | `max_query_limit=100`, `max_timeout=10s`, `unindexed_filtering_retrieve=false` | **Unfiltered queries; queries without `tenant_id`; cross-tenant queries; limit > 100.** |
| `tenant_documents` | Tenant General Vector Store | **YES** | `tenant_id` (keyword, **MANDATORY**), `user_id` (keyword), `doc_id` (keyword) | `max_query_limit=100`, `max_timeout=10s`, `unindexed_filtering_retrieve=false` | **Queries without `tenant_id` filter; limit > 100.** |
| `smartjudge_learned_experience` | Tenant Agent Experience | **YES** | `tenant_id` (keyword, **MANDATORY**), `domain` (keyword), `feedback_score` (integer) | `max_query_limit=100`, `max_timeout=10s`, `unindexed_filtering_retrieve=false` | **Queries without `tenant_id` filter; limit > 100.** |
| `tenant_crm_vectors` | Tenant CRM Entities | **YES** | `tenant_id` (keyword, **MANDATORY**), `entity_type` (keyword), `entity_id` (keyword) | `max_query_limit=100`, `max_timeout=10s`, `unindexed_filtering_retrieve=false` | **Queries without `tenant_id` filter; limit > 100.** |

## 3. Production Query Validation
All existing production query patterns in SmartJudge were tested and verified against this strict schema:
1. `lightrag_engine.py`: Statutory vector search with `must: [is_active=True]` and `limit=5..10` -> **PASSES**.
2. `rulings_retrieval.py`: Judicial scroll with `sub_collection="unity_rulings"` and `limit=5..20` -> **PASSES**.
3. `regulations_retrieval.py`: Circulars scroll with `is_active=True`, `doc_type="circular"` and `limit=5..10` -> **PASSES**.
4. `vector_tenant_wrapper.py`: Tenant case documents with `tenant_id="tenant-..."` -> **PASSES**.

## 4. Configuration, Feature Flag, & Rollback Policy
Per Roxira Zero-Destruction Guardrail:
- Feature flag: `QDRANT_STRICT_MODE_ENABLED` (defaults to `False`).
- Production collections remain untouched until explicit owner approval.
- Application tool: `python3 scripts/dev/qdrant_strict_mode_tool.py`:
  - `--audit`: Displays read-only matrix of collections and indexed schema.
  - `--test-collection`: Simulates test collection verifying unindexed refusal and indexed acceptance.
  - `--apply --dry-run`: Inspects exact PATCH and PUT requests before applying.
  - `--rollback`: Reverts strict mode to `{"strict_mode_config": {"enabled": false}}`.
