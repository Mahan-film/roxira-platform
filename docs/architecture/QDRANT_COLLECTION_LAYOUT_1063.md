# Qdrant Collection Layout Audit (T266 / #1063)

Read-only audit of the current Qdrant collection layout in `output_apps/generated_modules/smartjudge/` before splitting into `public-law` and `tenant-docs` collections.

## Current Collections Observed in Code
1. **Primary served collection** (`served_collection.py:14`, `legal_graph/lightrag_engine.py:125`):
   - Controlled by `LIGHTRAG_QDRANT_COLLECTION` (defaults to `iran_laws_hakim_v1` if Hakim enabled, else `iran_laws_v2`).
   - Also read by `laws_public.py:50`.
2. **Citation guard collection** (`served_collection.py:15`, `smartjudge_module.py:5513`):
   - Controlled by `ROXIRA_CITATION_QDRANT_COLLECTION`, falling back to `LIGHTRAG_QDRANT_COLLECTION`.

## Gaps Identified for Split
- No separate `tenant-docs` collection or `tenant_id` payload index enforcement in `served_collection.py` / `lightrag_engine.py`.
- Follow-up PRs will:
  1. Define separate `public-law` and `tenant-docs` collection names/configs.
  2. Create payload indexes (including `tenant_id` keyword index) before ingest.
  3. Enforce strict mode (refuse unindexed filtering) and add a tenant isolation test.
