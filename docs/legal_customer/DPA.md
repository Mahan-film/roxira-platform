> **DRAFT — needs local lawyer review**

# Data Processing Agreement (DPA)

**Effective Date:** 2026-11-15  
**Version:** 1.0 (Draft)  
**Applicability:** Processing of Personal and Commercial Data by Roxira on behalf of Customer

---

This Data Processing Agreement ("**DPA**") supplements the B2B Software-as-a-Service Terms of Service ("**Principal Agreement**") entered into by and between the Customer entity ("**Controller**") and Roxira ("**Processor**").

## 1. Scope, Purpose, and Regulatory Alignment

1.1. **Subject Matter.** This DPA governs the processing of Personal Data and sensitive commercial records provided by Customer in connection with the provision of the Roxira Enterprise Hub, AI Assistant, and related cloud services.

1.2. **Compliance Framework.** Both parties agree to comply with applicable data protection legislation, including:
- The Personal Data Protection Act 2010 of Malaysia (PDPA, as amended in 2024);
- The European Union General Data Protection Regulation (Regulation (EU) 2016/679 - "GDPR"), where applicable to cross-border data processing;
- Statutory corporate bookkeeping, tax, and employment records protection laws.

1.3. **Role of the Parties.** Customer acts as the Data Controller in respect of Personal Data entered into the Services. Roxira acts strictly as a Data Processor carrying out processing instructions on behalf of Customer.

---

## 2. Details of Processing Operations

2.1. **Categories of Data Subjects:**
- Customer’s employees, temporary workers, and contractors;
- Customer’s clients, retail consumers, buyers, and account representatives;
- Customer’s suppliers, vendors, and business partners;
- Individuals calling or receiving telephone communications via the AI telephony assistant.

2.2. **Types of Personal Data:**
- **Identity & Contact Details:** Full legal name, national identity number, tax identification number, postal address, business email address, telephone numbers;
- **Financial & Payroll Data:** Bank account numbers, IBANs, salary figures, attendance time stamps, deduction allowances, invoice transaction amounts;
- **Attendance Device Logs:** Clock-in/clock-out device event logs (timestamps, terminal IDs, employee IDs) only; **Roxira never stores biometric templates** (no facial, fingerprint, or voiceprint templates or raw biometric images);
- **Voice & Telephony Data:** Spoken audio call recordings, caller metadata, and speech-to-text transcriptions generated through the telephone customer service agent.

2.3. **Duration of Processing.** Processing continues for the duration of the Subscription Term until all Customer Personal Data is returned or permanently deleted in accordance with Section 8 of this DPA.

---

## 3. Processor Duties and Obligations

3.1. **Documented Instructions.** Processor shall process Personal Data solely upon the documented instructions of Controller (including instructions conveyed through platform settings and user actions), unless required to do so by applicable mandatory law.

3.2. **Personnel Confidentiality.** Processor ensures that all personnel, engineers, and operational staff authorized to access Customer Personal Data are bound by strict statutory or contractual confidentiality obligations and undergo regular security awareness training.

3.3. **Technical and Organizational Measures (TOMs).** Processor shall implement and maintain state-of-the-art administrative, technical, and physical safeguards designed to protect Customer Data against accidental, unlawful, or unauthorized destruction, loss, alteration, disclosure, or access, as detailed in **Schedule A** of this DPA.

3.4. **Architectural Tenant Isolation.** Processor guarantees that Customer Data is housed within database structures enforced by PostgreSQL Row-Level Security (`FORCE RLS`) and mandatory `TenantScope` query execution wrappers. Processor tests and enforces that database queries executed as standard application roles (`roxira_app`) cannot bypass tenant isolation policies.

---

## 4. Security Incident Management and Mandatory 24-Hour Notification

4.1. **Incident Definition.** A "Security Incident" means any confirmed breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorized disclosure of, or access to Customer Personal Data transmitted, stored, or processed on the Services.

4.2. **24-Hour Notification Obligation.**  
> [!IMPORTANT]
> **Processor shall notify Customer in writing without undue delay, and in any event within twenty-four (24) consecutive hours of becoming aware of and confirming a Security Incident affecting Customer Data.**

4.3. **Content of Notification.** The written notification shall contain, at minimum:
- A description of the nature of the Security Incident, including categories and approximate numbers of data subjects and records affected;
- The identity and contact details of the Data Protection Officer or incident lead;
- The likely consequences and potential risks of the incident;
- Remedial measures taken or planned to mitigate the incident’s effects.

4.4. **Investigation and Cooperation.** Processor shall immediately investigate the incident, deploy containment measures, maintain an immutable forensic audit log, and provide reasonable cooperation to enable Customer to comply with regulatory notification requirements under the Malaysia PDPA (within 72 hours) and GDPR.

---

## 5. Sub-processors and Third-Party Providers

5.1. **Authorized Sub-processors.** Customer grants general written authorization to Processor to engage the sub-processors listed in the official Sub-processor Registry (`docs/legal_customer/SUBPROCESSORS.md`).

5.2. **Contractual Equivalence.** Processor shall impose contractual data protection obligations upon each sub-processor that are no less protective than those set out in this DPA. Processor remains fully responsible to Customer for the performance of its sub-processors’ data protection obligations.

5.3. **AI Provider Routing & Private Data Option.** Under standard plans, Customer Data may be used to run and improve the Services, including AI models, and AI inference may route through free-tier or standard model endpoints. Where Customer purchases the paid **private data option**, Processor strictly routes Customer’s AI inference to paid model endpoints with `provider.data_collection = deny` and ensures Customer Data is not used beyond Customer’s own service.

5.4. **Notification of Changes.** Processor shall provide Customer with at least fourteen (14) calendar days prior written notice of any intended appointment of a new sub-processor or substitution of an existing sub-processor. Customer may object on reasonable data protection grounds within ten (10) days of notification. If the parties cannot resolve the objection, Customer may terminate the affected Services without penalty.

---

## 6. Assistance to Controller and Data Subject Rights

6.1. **Data Subject Requests.** Taking into account the nature of processing, Processor shall assist Controller by appropriate technical features (including automated data export and record search tools) to respond to requests from data subjects exercising their rights (e.g., access, rectification, erasure, restriction, and portability).

6.2. **Regulatory Audits & DPIAs.** Processor shall reasonably assist Controller in conducting Data Protection Impact Assessments (DPIAs) and prior consultations with competent supervisory authorities regarding automated processing and artificial intelligence tools.

---

## 7. Audit and Inspection Rights

7.1. **Compliance Documentation.** Processor shall make available to Customer upon reasonable request all documentation, third-party security audits, and penetration testing summaries necessary to demonstrate compliance with this DPA.

7.2. **On-Site Inspections.** If Customer reasonably requires an audit beyond documentation, Processor shall allow Customer’s designated independent auditor (bound by confidentiality) to conduct an inspection of operational procedures during normal business hours, once per calendar year, upon thirty (30) days advance notice.

---

## 8. Deletion, Export, and Return of Customer Data

8.1. **Data Export Right.** Upon termination or expiration of the Principal Agreement, Customer’s account transitions to `cancelled_readonly` status for a period of **thirty (30) calendar days**. During this window, Customer may download a complete, machine-readable export of all ledger entries, customer lists, transactions, and documents via automated BullMQ export facilities.

8.2. **Irreversible Destruction.**  
Upon expiration of the 30-day export window (or upon Customer’s earlier written instruction), Processor shall securely and irreversibly delete, purge, and cryptographically wipe all existing copies of Customer Personal Data across production databases, caches, and off-site backup storage in accordance with standard cryptographic data erasure practices (DoD 5220.22-M / NIST SP 800-88 Rev. 1), unless applicable statutory law requires longer retention.

8.3. **Certification.** Processor shall provide written certification of completion of data deletion upon Customer’s request.

---

## Schedule A: Technical and Organizational Measures (TOMs)

1. **Access Control & Multi-Tenancy:**
   - Multi-tenant data segregation enforced through PostgreSQL `FORCE ROW LEVEL SECURITY`;
   - Application service tier binds all database operations through mandatory `TenantScope` wrappers;
   - Role-Based Access Control (RBAC) with field-level masking for sensitive figures (cost, margins, salaries).

2. **Encryption:**
   - **In Transit:** TLS 1.3 enforced on all public and internal service communications;
   - **At Rest:** AES-256 encryption on all relational databases, file systems, and off-site backups;
   - **Secrets Management:** Credentials and API keys managed through isolated environment vaults and encrypted SOPS secrets.

3. **Resilience & Continuity:**
   - Hourly incremental and daily automated database snapshots;
   - Isolated off-site backup replicas with verified restoration drills;
   - Disaster recovery runbooks with verified Recovery Time Objective (RTO < 4 hours) and Recovery Point Objective (RPO < 1 hour).

4. **Vulnerability Management & Code Security:**
   - Continuous automated dependency scanning, AST vulnerability parsing, and gitleaks secret detection integrated into CI/CD pipelines;
   - Strict ban on `--no-verify` or bypassing security guardrails in version control.
