# Roxira Data Protection & Encryption Policy

> **Policy Reference**: POL-SEC-002  
> **Effective Date**: 2026-11-22  
> **Status**: Active Standard  
> **Master Reference**: Task T289 (#1112)

---

## 1. Purpose & Scope
This policy defines standards for data classification, cryptographic protections, and multi-tenant isolation across data in transit, at rest, and in processing.

## 2. Multi-Tenant Data Isolation
- **Database Row-Level Security (RLS)**:
  - 100% of public database tables carrying a `tenant_id` column enforce PostgreSQL `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
  - Application queries execute through the unprivileged role `roxira_app` (`NOSUPERUSER NOBYPASSRLS`), preventing cross-tenant leakage even under query vulnerabilities.
  - Verified on every build via automated coverage gate `scripts/dev/rls_coverage.sh`.
- **Vector & AI Isolation**:
  - Vector collections in Qdrant enforce tenant filtering (`tenant_id = <UUID>`). Compaction and deletion runs must verify zero surviving ghost records.
- **Tenant Deletion & Erasure**:
  - Cancelled tenants enter a configurable retention window (30 to 90 days). Upon expiration, automated purge executes transactional cascade deletion across all relational tables and vector segments.

## 3. Cryptography Standards
1. **Data in Transit**:
   - All external and inter-service communications enforce TLS 1.3 (with TLS 1.2 minimum fallback).
   - Insecure cipher suites and plain HTTP are rejected; HSTS is enforced with `max-age=31536000; includeSubDomains`.
2. **Data at Rest**:
   - Database volumes, backups, and file storage enforce AES-256 (or XTS-AES-256).
   - Sensitive webhook credentials, private keys, and third-party tokens are sealed with authenticated symmetric encryption (AES-256-GCM) with unique initialization vectors (IVs).
3. **Key Management**:
   - Cryptographic master keys are managed via environment injection or hardware/cloud KMS. Secrets are never checked into version control.

## 4. Retention & Disposal
- 12 months of audit log is our retention policy target (automated retention enforcement is not yet implemented).
- Expired backups and temporary import chunks undergo cryptographic shredding upon expiration.
