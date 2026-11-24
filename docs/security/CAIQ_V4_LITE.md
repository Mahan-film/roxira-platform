# Cloud Security Alliance (CSA) CAIQ v4 Lite Self-Assessment

> **Registry**: CSA STAR Level 1 Self-Assessment  
> **Entity**: Roxira Platform (Smart Judge & Enterprise Hub)  
> **Standard**: Cloud Controls Matrix (CCM) v4  
> **Version**: CAIQ v4 Lite  
> **Effective Date**: 2026-11-22  
> **Master Reference**: Task T289 (#1112)

---

## Control Domains & Assessment Answers

### 1. Audit & Assurance (A&A)
- **A&A-01 (Audit Logging)**: Does the organization collect and preserve immutable audit logs of administrative, user, and data access activities?
  - **Response**: **Yes**. Comprehensive structured audit logs are generated for all authentication, data mutation, administrative role assignment, and financial postings (`capture_audit`, `fin_bank_recon_audit`, `ops_errors`). **12 months of audit log is our retention policy target** (automated retention enforcement is not yet implemented).
- **A&A-02 (Independent Review)**: Are independent reviews or automated security assessments conducted?
  - **Response**: **Yes**. Automated SAST, SCA, and dependency vulnerability scans execute on every code change in CI/CD. An annual third-party penetration test is planned but has not yet been performed.

### 2. Application & Interface Security (AIS)
- **AIS-01 (Application Security Architecture)**: Does the application enforce tenant isolation at the data tier?
  - **Response**: **Yes**. Multi-tenancy is enforced natively in PostgreSQL using `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` across 100% of tenant tables. Unprivileged application connections run as `roxira_app` (`NOSUPERUSER NOBYPASSRLS`).
- **AIS-02 (Input Validation & Output Encoding)**: Are all input interfaces strictly validated?
  - **Response**: **Yes**. NestJS endpoints enforce typed class DTOs decorated with `class-validator` and `class-transformer`. SQL queries use parameterized queries or TypeORM entity abstractions, eliminating SQL injection.

### 3. Business Continuity & Disaster Recovery (BCR)
- **BCR-01 (Backup Policy & Restoration)**: Are regular backups executed and tested?
  - **Response**: **Yes**. Continuous WAL archiving and daily base backups provide an RPO $< 15$ minutes and RTO $< 2$ hours. Backups are encrypted with AES-256 and stored off-site with Object Lock immutability. Restore procedures are documented; routine restore testing is a policy goal and is not yet continuously automated.

### 4. Cryptography, Encryption & Key Management (CEK)
- **CEK-01 (Encryption in Transit)**: Is all network traffic encrypted in transit?
  - **Response**: **Yes**. Enforced TLS 1.3/1.2 with modern cipher suites. Plaintext HTTP traffic is rejected with HSTS.
- **CEK-02 (Encryption at Rest)**: Is sensitive customer data encrypted at rest?
  - **Response**: **Yes**. Database block storage, backups, and file assets are encrypted at rest using AES-256. Webhook signing keys and banking credentials are sealed via AES-256-GCM.

### 5. Identity & Access Management (IAM)
- **IAM-01 (Multi-Factor Authentication)**: Is MFA enforced for access to sensitive functions?
  - **Response**: **Yes**. FIDO2/WebAuthn Passkeys and TOTP RFC 6238 are supported and enforced for administrative access.
- **IAM-02 (Role-Based Access Control)**: Is access restricted based on roles?
  - **Response**: **Yes**. RBAC is enforced across controllers via `@RequirePermission()` and verified against a snapshot-tested permission matrix.

### 6. Threat & Vulnerability Management (TVM)
- **TVM-01 (Vulnerability Scanning)**: Are dependencies and container images scanned for vulnerabilities?
  - **Response**: **Yes**. CI pipeline executes automated scans using Trivy (SCA), Semgrep (SAST), and Gitleaks (Secrets) on every pull request, blocking merging of high/critical vulnerabilities.
- **TVM-02 (Patch SLAs)**: Are remediation SLAs established?
  - **Response**: **Yes**. Critical vulnerabilities ($\text{CVSS} \ge 9.0$) are patched within 48 hours; High vulnerabilities within 7 calendar days.

### 7. Data Security & Privacy (DSP)
- **DSP-01 (AI Model Privacy)**: Are customer inputs used to train AI models?
  - **Response**: **No**. Commercial zero-data-retention APIs and strict no-training contractual routing ensure customer data is never used to train third-party foundation models.
- **DSP-02 (Customer Deletion & Portability)**: Can customers export and erase their data upon cancellation?
  - **Response**: **Yes**. Automated full-archive ZIP export (CSV, JSON, metadata checksums) is available during the cancellation grace period. Automated purge cascade transactionally cleanses all customer records upon retention expiry.
