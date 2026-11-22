# Roxira Security & Privacy Questionnaire Answer Bank

> **Document Reference**: REF-SEC-008  
> **Effective Date**: 2026-11-22  
> **Scope**: Pre-populated answers for Enterprise Vendor Risk Assessments (VSAQ, SIG Lite, CAIQ, ISO 27001 / SOC 2 mapping)  
> **Master Reference**: Task T289 (#1112)

---

## 1. Company & Infrastructure Overview

### Q1.1: Where are Roxira services hosted?
**Answer**: Production services are hosted in enterprise Tier III/IV European datacentres (Hetzner Online GmbH, Germany/Finland), protected by ISO 27001-certified physical and environmental controls. Global edge routing, DDoS mitigation, and WAF capabilities are provided via Cloudflare.

### Q1.2: What is the high-level architecture?
**Answer**: Roxira employs a multi-tiered architecture:
1. **Frontend / UX Layer**: Next.js App Router standalone containers behind Nginx reverse proxy.
2. **Enterprise App Layer**: NestJS (TypeScript) modular backend providing Controller-Service-DTO-Repository enforcement and transactional integrity.
3. **AI Core Layer**: FastAPI (Python) executing Smart Judge legal inference, semantic search, and Qdrant vector retrieval.
4. **Data Tier**: PostgreSQL with Row-Level Security (RLS) enforcement, Redis for distributed locks and BullMQ job queues, and Qdrant for vector indexing.

---

## 2. Multi-Tenancy & Data Isolation

### Q2.1: How is data separated between different customer tenants?
**Answer**: Data isolation is enforced directly in the database engine using PostgreSQL `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. Every tenant table carries a `tenant_id` column. Application queries execute through the unprivileged role `roxira_app` (`NOSUPERUSER NOBYPASSRLS`), meaning the PostgreSQL kernel strictly filters and validates every `SELECT`, `INSERT`, `UPDATE`, and `DELETE` against the session context `app.tenant_id`. Cross-tenant queries are blocked unconditionally at the database level.

### Q2.2: Is multi-tenancy verified automatically?
**Answer**: Yes. An automated CI coverage gate (`scripts/dev/rls_coverage.sh`) runs on every database build, verifying that 100% of tables with a `tenant_id` column have active RLS and forced policies. Opt-in PostgreSQL integration suites (`pre-tenant-rls.pg.spec.ts`, `tenant-rls-all-tables.pg.spec.ts`) continuously execute cross-tenant read/write tests as a non-superuser to prove isolation.

---

## 3. Cryptography & Key Management

### Q3.1: What encryption standards are used for data in transit?
**Answer**: All traffic over public networks enforces TLS 1.3 (with TLS 1.2 fallback). Legacy or insecure ciphers (SSLv3, TLS 1.0, TLS 1.1, RC4, 3DES) are disabled. HTTP Strict Transport Security (HSTS) is active with `max-age=31536000; includeSubDomains`.

### Q3.2: What encryption standards are used for data at rest?
**Answer**: Database storage volumes, backups, and archived records are encrypted at rest using AES-256. Sensitive customer webhook secrets and third-party API credentials are sealed using authenticated AES-256-GCM symmetric encryption with randomized initialization vectors.

---

## 4. Audit Logging & Monitoring

### Q4.1: What is the audit log retention period?
**Answer**: **12 months of audit log is our retention**. Audit logs cover user logins, MFA verifications, token rotations, financial journal entries, tax authority transmissions, and permission modifications. Logs are stored immutably with tamper-evident checksums.

### Q4.2: How are system errors and security events monitored?
**Answer**: Centralized logging and error tracking (`ops_errors`, Prometheus, Grafana) capture real-time anomalies. Critical anomalies trigger on-call engineering alerts.

---

## 5. Vulnerability Management & Secure Development

### Q5.1: How are vulnerabilities detected during development?
**Answer**: Roxira operates an automated DevSecOps pipeline:
- **Secret Scanning**: Gitleaks executes on pre-commit and CI hooks, preventing accidental secret commits.
- **SAST**: Semgrep and oxlint scan source files for security vulnerabilities and dangerous patterns.
- **SCA**: Trivy scans npm and pip dependencies on every pull request.
- **Anti-Circumvention**: Automated repository guards block modifications that bypass permission matrices or tenant scoping.

### Q5.2: What are the remediation SLAs for discovered vulnerabilities?
**Answer**:
- **Critical (CVSS 9.0–10.0)**: $\le$ 48 hours.
- **High (CVSS 7.0–8.9)**: $\le$ 7 calendar days.
- **Medium (CVSS 4.0–6.9)**: $\le$ 30 calendar days.

---

## 6. Artificial Intelligence & Privacy Governance

### Q6.1: Are customer prompts or data used to train AI models?
**Answer**: No. Commercial zero-data-retention (ZDR) APIs and strict contractual terms ensure customer operational data is never used by foundation model providers (Anthropic, OpenAI, Google) to train or tune future models.

### Q6.2: How is data residency handled for European customers?
**Answer**: European and German customers have dedicated EU-resident routing profiles ensuring processing remains within European jurisdiction without logging.

---

## 7. Incident Response & Breach Notification

### Q7.1: What is the customer notification timeframe for security breaches?
**Answer**: In the event of a confirmed breach involving customer data, Roxira commits to notifying impacted customer organizations within **48 hours**, providing incident details, affected records, containment measures, and remediation guidance.
