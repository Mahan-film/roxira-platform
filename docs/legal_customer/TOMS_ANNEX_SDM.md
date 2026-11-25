> **DRAFT — Annex III to `docs/legal_customer/AVV_EU_GDPR.md` (needs EU/German counsel review)**

# Technical and Organisational Measures (TOMs Annex — 7 SDM Guarantees)

**Effective Date:** 2026-11-24  
**Version:** 1.0 (Draft)  
**Methodology:** Structured strictly around the **7 Data Protection Guarantees of the Standard Data Protection Model (SDM)** of the German Data Protection Conference (*Datenschutzkonferenz — DSK*) in fulfilment of **Art. 32 GDPR**.  
> **Note on SDM Structure:** Per SDM v3.0, there are **seven (7)** protection goals/guarantees. Resilience (Art. 32(1)(b) GDPR) is implemented within **Availability** and **Integrity** rather than as a separate eighth SDM guarantee.

---

## 1. Data Minimisation (*Datenminimierung*)

- **No Biometric Templates:** Attendance hardware integrations ingest clock-in/clock-out timestamps, terminal IDs, and employee IDs only (`docs/legal_customer/PRIVACY_POLICY.md` §2.4). No facial, fingerprint, or voiceprint templates are stored.
- **PII Scrubbing Before External AI Calls:** Outbound prompts are scrubbed of sensitive identifiers before external inference (T239).
- **EU Sovereign AI Profile (`eu_tenant`):** For EU and tax-advisor tenants, `allow_service_improvement_default` is `false` (`config/ai_data_policy.json`); zero prompt logging and no model training are enforced.
- **30-Day Post-Cancellation Purge:** Following the 30-day `cancelled_readonly` export window, tenant records are irreversibly purged (`delete_after`).

---

## 2. Availability (*Verfügbarkeit*) & Resilience (Art. 32(1)(b) GDPR)

- **Automated Backups:** Hourly PostgreSQL dumps (`pg_dump`) and daily full backup sets (`docs/ops/DISASTER_RECOVERY.md`, `docs/ops/OFFSITE_BACKUP.md`), plus encrypted restic repository design and off-site Neon/Codeberg copies.
- **Recovery Targets (Design):** RPO <= 1 hour, RTO < 4 hours (`docs/ops/DISASTER_RECOVERY.md` §1; quarterly restore drills tracked under T287 / `#1110`).
- **Infrastructure Isolation & Rate Limiting:** Nginx reverse-proxy rate limiting (`limit_req` zones for auth, OTP, and API endpoints) and Cloudflare origin IP filtering (`DOCKER-USER -> ROXIRA-CF`).

---

## 3. Integrity (*Integrität*) & Resilience (Art. 32(1)(b) GDPR)

- **Tamper-Evident Audit Log:** Hash-chained `audit_log` with append-only semantics (`roxira_app` has `SELECT` and `INSERT` only; no `UPDATE`/`DELETE`).
- **Immutable Accounting Ledger:** Posted journal entries cannot be mutated; corrections require reversing entries, and period locks prevent back-dated edits.
- **Integer Minor-Unit Money:** All monetary amounts are stored and calculated as `bigint` minor units (`modules/accounting/money.ts`), preventing floating-point rounding drift.
- **CI Supply-Chain & Code Integrity:** SHA-pinned GitHub Actions, gitleaks secret scanning, Semgrep, Trivy, OSV-Scanner, and strict prohibition of `--no-verify`.

---

## 4. Confidentiality (*Vertraulichkeit*)

- **Multi-Tenant Database Isolation:** PostgreSQL `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` on all 139 `tenant_id` tables (verified by `scripts/dev/rls_coverage.sh`), paired with `TenantScope` session variables (`SET LOCAL app.tenant_id`).
- **Restricted DB Role (`roxira_app`):** Non-superuser, `NOBYPASSRLS` application role (`docs/ops/APP_DB_ROLE.md`; production cutover tracked in T200 `#831`).
- **Encryption in Transit & At Rest:** TLS 1.2/1.3 (AEAD ciphers) for all external transport; encrypted backups (restic AES-256 / `age` public-key encryption); no secrets in frontend bundles or git.
- **Authentication & RBAC:** WebAuthn passkeys, TOTP 2FA, role-based access control with field-level masking for sensitive figures (salaries, costs, margins), and § 62a StBerG need-to-know staff restrictions.

---

## 5. Unlinkability (*Nichtverkettbarkeit*)

- **Strict Tenant Segregation:** Every tenant row is partitioned by `tenant_id` with `FORCE RLS`; cross-tenant joins are blocked at the database layer.
- **Purpose-Separated AI Routing:** `eu_tenant` routing isolates EU/tax-advisor customer prompts from global/free-tier pools and blocks cross-tenant model training.
- **Log & Backup Segregation:** Redaction of credentials/tokens in operational logs (`offsite_tools.py redact`) and tenant-scoped export archives.

---

## 6. Transparency (*Transparenz*)

- **Public & Customer Documentation:** Published `B2B_TERMS.md`, `PRIVACY_POLICY.md`, `AVV_EU_GDPR.md`, `ADDENDUM_62A_STBERG.md`, and `SUBPROCESSORS.md` with explicit model/provider routing tables.
- **14-Day Sub-processor Notice:** Advance written notification before onboarding or replacing any sub-processor (`AVV_EU_GDPR.md` Clause 6.7).
- **Auditability:** Immutable `audit_log` recording user actions, role changes, period locks, and exports; 24–48 hour security incident notification SLA.

---

## 7. Intervenability (*Intervenierbarkeit*)

- **Full Tenant Export (GoBD Z3 + CSV/JSON):** Self-service and BullMQ-backed full tenant data export (`tenant-export.service.ts`), including during the 30-day `cancelled_readonly` post-termination window.
- **Data Subject Rights Support:** Search, rectification, restriction, and deletion/crypto-shredding (`erp_party_keys` / `1789900012000-AddPartyCryptoShredding.ts`) workflows enabling Controller to fulfil Art. 15–22 GDPR requests.
- **Objection & Termination Rights:** Controller may object to new sub-processors within 10–14 days or terminate affected services without penalty.
