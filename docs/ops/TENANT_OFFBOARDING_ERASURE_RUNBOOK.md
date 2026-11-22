# Tenant Offboarding & Complete Erasure Runbook

Operational standard for tenant data destruction across PostgreSQL, Qdrant vectors, Valkey/Redis caches, Object Storage, and Disaster Recovery restore replay. Implements R25 ( रियल-टाइम Multilingual Legal RAG & Citation Graph) item 5 and Stage 2 compliance requirements (T269 / Issue #1066).

---

## خلاصهٔ فارسی (Persian Summary)

- این رانبوک فرایند **حذف کامل، غیرقابل‌بازگشت و ضدّنشت (Zero-Leak Erasure)** داده‌های یک مستاجر (Tenant) را پس از فسخ قرارداد، لغو اشتراک یا اعمال حق فراموشی (GDPR Art. 17 / Right to Erasure) مشخص می‌کند.
- **اصل کلیدی رأی ۲۸/۲۰۲۴ هیئت حفاظت داده اروپا (EDPB Opinion 28/2024)**: بردارها (Embeddings) خودشان دادهٔ شخصی محسوب می‌شوند؛ بنابراین صرف نابودسازی کلید رمزنگاری متن (Crypto-shredding) کافی نیست و تمامی بردارهای مستاجر در Qdrant، لاگ‌های تغییرات (WAL)، اسنپ‌شات‌ها و توم‌استون‌ها (Tombstones) باید با فشرده‌سازی اجباری (Compaction / Vacuum) یا حذف شارد/کالکشن پاک شوند.
- **دفترکل خارجی مستاجران حذف‌شده (Erased-Tenants Ledger)**: در زمان بازیابی فاجعه (Disaster Recovery)، بازگرداندن یک بکاپ قدیمی دیتابیس ممکن است داده‌های مستاجر حذف‌شده را مجدداً زنده کند (Ghost Resurrection). برای جلوگیری از این رخداد، فایل دفترکل تغییرناپذیر `/var/lib/roxira/erased_tenants.jsonl` نگهداری شده و بلافاصله پس از هر `restore.sh`، اسکریپت `scripts/ops/replay_erased_tenants.py` اجرا می‌شود تا هرگونه رکورد بازیابی‌شده مجدداً منهدم گردد.
- **تفکیک پرونده‌ای درون‌سازمانی (Matter-Level ACL)**: برای موسسات حقوقی (BRAO § 43e / StGB § 203)، دسترسی وکلای درون سازمان نیز با فیلد `matter_id` ایزوله می‌شود تا دیوار اطلاعاتی (Chinese Wall) حفظ گردد.

---

## 1. Compliance & Legal Foundations

1. **EDPB Opinion 28/2024 (AI & Embeddings as Personal Data)**:
   - High-dimensional vector embeddings derived from customer documents encode personal, financial, and confidential data.
   - Crypto-shredding or deleting PostgreSQL raw text while leaving vector points in Qdrant leaves personal data in high-dimensional representations susceptible to inversion or membership inference attacks.
   - *Requirement*: Vector points MUST be permanently removed from indexes, WAL segments, memory caches, and persistent disk segments via explicit delete filters and forced compaction (`optimizations`).
2. **Professional Secrecy (German BRAO § 43e, StGB § 203, Iranian Bar Confidentiality)**:
   - Law firms and corporate legal departments require strict segregation between matters (`matter_id`) and total destruction of case files, draft rulings, and client communications upon offboarding.
3. **Fail-Closed Tenancy**:
   - Any query, vector search, or cache lookup for an offboarded or cancelled tenant MUST fail closed with `TenantCancelledError` or `TenantFilterRequiredError`.

---

## 2. Architecture of Tenant Storage & Destruction Targets

| Storage Layer | Data Scope | Destruction Mechanism | Verification Check |
| :--- | :--- | :--- | :--- |
| **PostgreSQL** | Relational text, legal entities, users, accounting ledger, vouchers | Transactional cascading delete inside `TenantScope`; FORCE RLS verification | Zero rows returned for `tenant_id` under `roxira_app` role |
| **Qdrant Vector DB** | Document embeddings, chunk vectors, learned case experience | `delete_tenant_vectors(collection, tenant_id, force_compaction=True)`; forced vacuum | Canary Test 6 (`ghost_check_tenant` == 0) |
| **Valkey / Redis** | RAG semantic cache, exact query cache, auth sessions, rate limit tokens | Keyspace pattern eviction: `tenant:<tenant_id>:*` and `auth:*:<tenant_id>` | `redis-cli --scan --pattern "tenant:<tenant_id>:*"` returns 0 |
| **Object Storage (S3 / MinIO)** | Raw contract scans, PDF/Word files, OCR outputs, matter attachments | Bucket prefix wipe (`s3://roxira-docs/tenants/<tenant_id>/`) + KMS DEK crypto-shredding | S3 HeadObject returns 404 |
| **External Ledger** | Audit tombstone records across backups | Append-only `/var/lib/roxira/erased_tenants.jsonl` replayed on backup restore | Ledger entry signed with timestamp & authorization |

---

## 3. Step-by-Step Erasure Lifecycle

### Phase 1: Pre-Flight Audit & Ingress Disablement

1. **Verify Authorization**: Confirm signed offboarding request or DPO erasure ticket.
2. **Retrieve Exact Tenant UUID**:
   ```bash
   export TENANT_ID="018f4a12-xxxx-7000-xxxx-xxxxxxxxxxxx"
   # Verify tenant exists
   psql -d roxira_prod -c "SELECT id, name, created_at FROM tenants WHERE id = '$TENANT_ID';"
   ```
3. **Immediate Ingress Disablement**:
   - Invalidate all active JWT tokens, refresh tokens, and API credentials:
     ```bash
     psql -d roxira_prod -c "UPDATE auth_refresh_tokens SET revoked = true WHERE user_id IN (SELECT id FROM users WHERE tenant_id = '$TENANT_ID');"
     psql -d roxira_prod -c "UPDATE users SET is_active = false WHERE tenant_id = '$TENANT_ID';"
     ```
   - Register the cancellation in the application registry to immediately block hot-path RAG queries (durable across restarts):
     ```python
     from output_apps.generated_modules.smartjudge.security.vector_tenant_wrapper import TenantCancellationRegistry
     # Persists to durable cancellation storage and fails closed on all subsequent accesses
     TenantCancellationRegistry.cancel_tenant(tenant_id=TENANT_ID, reason="Contract termination", authorized_by="ops-admin")
     ```

### Phase 2: Cache & Temporary State Purge

1. **Evict Valkey / Redis Keys**:
   ```bash
   # Scan and delete all tenant-scoped semantic and retrieval cache keys
   redis-cli --scan --pattern "tenant:$TENANT_ID:*" | xargs -r redis-cli del
   redis-cli --scan --pattern "auth:*:$TENANT_ID" | xargs -r redis-cli del
   ```

### Phase 3: Object Storage & Crypto-Shredding

1. **S3 / MinIO Blob Deletion**:
   ```bash
   # Remove all uploaded files, matter attachments, and OCR markdowns
   aws s3 rm "s3://roxira-docs/tenants/$TENANT_ID/" --recursive
   ```
2. **KMS / Per-Tenant DEK Destruction**:
   - If tenant used customer-managed or envelope encryption keys, permanently destroy or disable the tenant Data Encryption Key (DEK).

### Phase 4: Vector Store Purge & Forced Compaction (EDPB 28/2024)

1. **Execute Tenant Point Deletion**:
   Delete points across all tenant-scoped Qdrant collections:
   - `tenant_documents`
   - `tenant_case_documents`
   - `smartjudge_learned_experience`
   - `tenant_knowledge_base`
   - `tenant_crm_vectors`

   ```bash
   for COLL in tenant_documents tenant_case_documents smartjudge_learned_experience tenant_knowledge_base tenant_crm_vectors; do
     curl -s -X POST "http://127.0.0.1:6333/collections/$COLL/points/delete?wait=true" \
       -H "Content-Type: application/json" \
       -d "{\"filter\": {\"must\": [{\"key\": \"tenant_id\", \"match\": {\"value\": \"$TENANT_ID\"}}]}}"
   done
   ```

2. **Trigger Forced Vacuum & Compaction**:
   Qdrant point deletions write tombstones. Under EDPB 28/2024, vector data in WAL and uncompacted segments must be purged immediately:
   ```bash
   for COLL in tenant_documents tenant_case_documents smartjudge_learned_experience tenant_knowledge_base tenant_crm_vectors; do
     curl -s -X POST "http://127.0.0.1:6333/collections/$COLL/optimizations" \
       -H "Content-Type: application/json" \
       -d "{}"
   done
   ```

3. **Verify Ghost Vectors Count == 0**:
   ```bash
   for COLL in tenant_documents tenant_case_documents smartjudge_learned_experience; do
     SURVIVING=$(curl -s -X POST "http://127.0.0.1:6333/collections/$COLL/points/scroll" \
       -H "Content-Type: application/json" \
       -d "{\"filter\": {\"must\": [{\"key\": \"tenant_id\", \"match\": {\"value\": \"$TENANT_ID\"}}]}, \"limit\": 1}" \
       | jq '.result.points | length')
     if [ "$SURVIVING" -ne 0 ]; then
       echo "ERROR: Ghost vectors still exist in $COLL for tenant $TENANT_ID" >&2
       exit 1
     fi
   done
   ```

### Phase 5: PostgreSQL Database Hard Purge

1. **Execute Transactional Deletion inside TenantScope**:
   All tenant tables operate under FORCE RLS (`app.tenant_id = '<uuid>'`). Run cleanup as the administrative user within a strict transactional block:
   ```sql
   BEGIN;
   SET LOCAL app.tenant_id = '<TENANT_ID>';
   
   -- Clean dependent tenant tables
   DELETE FROM audit_logs WHERE tenant_id = '<TENANT_ID>';
   DELETE FROM erp_journal_entry_attachments WHERE tenant_id = '<TENANT_ID>';
   DELETE FROM erp_journal_entries WHERE tenant_id = '<TENANT_ID>';
   DELETE FROM erp_vouchers WHERE tenant_id = '<TENANT_ID>';
   DELETE FROM crm_leads WHERE tenant_id = '<TENANT_ID>';
   DELETE FROM contact_messages WHERE tenant_id = '<TENANT_ID>';
   DELETE FROM user_login_schedules WHERE tenant_id = '<TENANT_ID>';
   DELETE FROM memberships WHERE tenant_id = '<TENANT_ID>';
   DELETE FROM legal_entities WHERE tenant_id = '<TENANT_ID>';
   DELETE FROM ops_error_events WHERE tenant_id = '<TENANT_ID>';
   DELETE FROM users WHERE tenant_id = '<TENANT_ID>';
   
   -- Remove tenant root registration
   DELETE FROM tenants WHERE id = '<TENANT_ID>';
   
   COMMIT;
   ```

2. **Verify Database Zero-State under App Role**:
   Run verification as `roxira_app` (NOSUPERUSER NOBYPASSRLS) to verify that queries return 0 rows.

---

## 4. Disaster Recovery & Erased-Tenants Restore Replay

### The Ghost Resurrection Problem
If server disaster recovery restores a database backup taken yesterday, any tenant deleted this morning would have their records restored. To guarantee compliance:

1. **Append to the Erased-Tenants Ledger**:
   ```bash
   python3 -c "
   from scripts.ops.replay_erased_tenants import record_erased_tenant
   record_erased_tenant(
       ledger_path='/var/lib/roxira/erased_tenants.jsonl',
       tenant_id='$TENANT_ID',
       reason='Customer cancellation - GDPR Art 17',
       authorized_by='security-desk@roxira.ir'
   )
   "
   ```

2. **Automated Post-Restore Hook**:
   Whenever `scripts/ops/backup/restore.sh` or a WAL-G restore is executed, step 7 automatically invokes:
   ```bash
   python3 scripts/ops/replay_erased_tenants.py --ledger /var/lib/roxira/erased_tenants.jsonl
   ```
   This replays the erasure against Postgres, Qdrant, and Valkey, guaranteeing that resurrected data is immediately destroyed. If replay fails or vector compaction cannot complete, `restore.sh` fails closed with exit code 5. In emergency maintenance, set `SKIP_ERASED_REPLAY=1` to bypass replay with an explicit logged warning.

   Durable cancellation state is persisted to `data/tenant_cancellations.json` (or `TENANT_CANCELLATION_FILE`), ensuring survival across worker process and container restarts.

---

## 5. Matter-Level ACL Isolation (Within Tenant)

For multi-matter legal tenants (e.g. Tehran corporate law firms):
- In addition to `tenant_id`, point payloads and query filters support `matter_id`.
- Intra-tenant queries specify `matter_id: Optional[str]` or `allowed_matters: Optional[Sequence[str]]`.
- If a query specifies `matter_id="matter-alpha"`, queries cannot return chunks from `matter-beta` within the same law firm.
- Enforced automatically by `output_apps/generated_modules/smartjudge/security/vector_tenant_wrapper.py`.

---

## 6. Verification Checklist & Acceptance Sign-Off

- [ ] Ingress blocked: Users deactivated and refresh tokens revoked.
- [ ] Redis cache cleared: Keys matching `tenant:<id>:*` evicted.
- [ ] Object storage wiped: S3 prefix `tenants/<id>/` empty, DEK destroyed.
- [ ] Vector store clean: Points deleted from all tenant collections, compaction requested.
- [ ] Canary Test 6 Ghost Check passed: 0 surviving vector points.
- [ ] PostgreSQL purged: All tenant tables report 0 rows.
- [ ] External Ledger recorded: `/var/lib/roxira/erased_tenants.jsonl` updated and synced to offsite backup.
- [ ] CI Canary Suite green: `pytest src/test_cross_tenant_leak.py` passes all 6 canary checks.
