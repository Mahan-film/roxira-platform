> **DRAFT — needs local lawyer review**

# Privacy Policy & Biometric / Voice Data Notice

**Effective Date:** 2026-11-15  
**Version:** 1.0 (Draft)  
**Applicability:** Users, Customers, Employees, and Callers Interacting with the Roxira Platform

---

## 1. Introduction and Data Controller Information

Roxira ("**we**", "**our**", or "**us**") is committed to protecting the privacy, confidentiality, and security of all personal data entrusted to us. This Privacy Policy explains how we collect, process, store, protect, and dispose of personal information in connection with the Roxira business suite, including our enterprise accounting, human resources (HR), retail point-of-sale (POS), artificial intelligence assistants, and voice telephony customer services.

When our business customers ("**Customer**") deploy Roxira to manage their operations, the Customer acts as the **Data Controller**, and Roxira acts as the **Data Processor**. Where Roxira collects information directly (e.g. platform registration, administrative credentials, customer service requests), Roxira acts as the Data Controller.

---

## 2. Categories of Personal Data Collected

### 2.1. Administrative and Account Profile Information
- Full name, corporate email address, business telephone number, job title;
- Organizational identifiers, tenant access assignments, role-based authorization keys;
- Authentication credentials, WebAuthn cryptographic keys, session logs, IP addresses.

### 2.2. Enterprise Operational and Financial Information
- Customer and supplier contact profiles, national identification numbers, tax registration numbers;
- Financial ledger entries, bank account details, invoice transactions, purchase receipts;
- Employee payroll figures, contract parameters, statutory tax deduction records, bank transfer orders.

### 2.3. Voice and Telephony Data
- **Audio Recordings & Voice Streams:** Incoming and outgoing telephone calls handled through the Roxira AI telephony customer service agent;
- **Transcriptions:** Automated text transcriptions generated from voice conversations via speech-to-text (STT) models;
- **Telephony Metadata:** Caller ID, call timestamp, duration, call routing outcomes, and consent audit records.

### 2.4. Attendance Device Logs Only (No Biometric Templates)
- **Device Event Logs Only:** When Customer utilizes hardware attendance terminals for shift clock-in, Roxira receives and stores **device logs only** (clock-in/clock-out timestamps, terminal identifiers, and employee identifiers);
- **No Biometric Templates or Raw Biometrics:** **Roxira never stores biometric templates** (no facial templates, fingerprint templates, or voiceprint templates) and never stores raw facial photographs, raw voiceprints, or raw fingerprint image files.

---

## 3. Mandatory AI Disclosure, Voice Consent, and Biometric Safeguards

### 3.1. Upfront AI Disclosure
> [!IMPORTANT]
> In compliance with Article 50 of the EU Artificial Intelligence Act and international consumer transparency regulations, **every automated voice call and interactive assistant conversation initiates with an explicit, upfront disclosure identifying the system as an artificial intelligence assistant.**
> *Example Standard Disclosure:* «You are speaking with the Roxira automated AI business assistant. This call may be recorded for quality and verification purposes.»

### 3.2. Explicit Two-Step Voice Consent
1. **Mandatory Opt-In:** Call recording and automated audio transcription commence **only after the caller provides an affirmative, explicit opt-in** (such as pressing a designated telephone key or providing a clear spoken verbal confirmation).
2. **Audit Record:** The affirmative consent is recorded with an immutable timestamp, caller ID, and session hash.
3. **No-Consent Continuation:** If the caller does not opt in, the call continues seamlessly with automated voice responses without generating or persisting any audio recording or transcription file.

### 3.3. Attendance Hardware Data Minimization
- Biometric matching, if any, occurs strictly on the Customer’s local hardware terminal; Roxira receives and stores **device event logs only** (timestamps, terminal ID, employee ID) and **never stores biometric templates**;
- Attendance logs are encrypted in transit and at rest and are used solely for payroll and HR attendance tracking, never for commercial profiling, behavioral advertising, or third-party tracking.

---

## 4. Legal Bases for Processing

We process personal data only when authorized by applicable law under the following legal bases:
- **Contractual Necessity:** To provide the core software services, process accounting vouchers, calculate payroll, and execute billing;
- **Compliance with Legal Obligations:** To satisfy statutory corporate tax reporting, national e-invoice filing, statutory accounting retention, and audit mandates;
- **Explicit Consent:** For the collection of voice call recordings;
- **Legitimate Business Interests:** To protect platform security, prevent fraudulent multi-tenant access, maintain infrastructure health, and defend against cyber threats.

---

## 5. Artificial Intelligence Processing and Private Data Option

5.1. **Service Operation and Improvement (Standard Plans).**  
Customer data may be used to run and improve the Services, including artificial intelligence models, in accordance with applicable data protection laws (including Malaysia PDPA and GDPR transparency obligations). Under standard plans, AI inference may route through free-tier or standard model endpoints.

5.2. **Paid Private Data Option.**  
Customers who require that their data not be used beyond their own service may purchase the paid **private data option** (available on request). For tenants with the private data option enabled, customer data is never used to improve or train models, and all AI inference is routed exclusively to paid model endpoints with data collection denied (`provider.data_collection = deny`).

5.3. **Data Classification Matrix:**

| Plan Tier | Data Examples | Allowed AI Providers |
|---|---|---|
| **Standard Plans** | Invoices, vouchers, ledgers, inventory, assistant prompts | Free-tier first, paid fallback; data may be used to run and improve the service, including AI models |
| **Private Data Option (Paid Add-on)** | All Tenant-Business & Personal data for opted-in tenants | Paid model endpoints with `provider.data_collection = deny` only; no use beyond Customer’s own service |

---

## 6. Data Retention, Archival, and Erasure Schedule

| Category of Data | Retention Period | Destruction / Purge Mechanism |
|---|---|---|
| **Statutory Financial Ledgers & Invoices** | 5 to 10 years (as mandated by applicable tax and accounting statutes) | Read-only archival in tenant storage; permanent purge upon statutory expiry |
| **Voice Call Recordings & Transcripts** | 30 to 90 calendar days (configurable by Customer tenant setting) | Automated scheduled purge job deleting audio files and database transcript lines |
| **Attendance Device Logs (No Biometric Templates)** | Duration of employee tenure with Customer | Automated deletion upon employee offboarding or tenant termination |
| **Security & Access Audit Logs** | 12 months rolling | Immutable database trigger prevents modification; automated rotation and wipe after 12 months |
| **Cancelled Tenant Data (`delete_after`)** | 30-day post-cancellation grace period | One-click full export archive available; automated cryptographic wipe after day 30 |

---

## 7. Multi-Tenant Architectural Security Safeguards

7.1. **Row-Level Security (`FORCE RLS`).** Every database query on multi-tenant tables executes under strict database-enforced Row-Level Security, preventing any customer tenant from querying or accessing another tenant’s records.

7.2. **Encryption Standards:**
- **In Transit:** All HTTP, WebSocket, and SIP telephony traffic is encrypted using TLS 1.3 / SRTP.
- **At Rest:** Database tables, backups, and media files are encrypted using AES-256.

7.3. **Zero Secrets in Browser Code.** No API keys, database credentials, or administrative tokens are ever transmitted to frontend client code.

---

## 8. Data Subject Rights and Contact Details

Data subjects whose personal information is processed within Roxira possess statutory rights under the Malaysia PDPA and GDPR, including:
- **Right of Access:** Requesting confirmation of whether personal data is processed and obtaining a copy of such data;
- **Right to Rectification:** Correcting inaccurate, incomplete, or out-of-date personal data;
- **Right to Erasure ("Right to be Forgotten"):** Requesting permanent deletion of personal data where legal retention obligations no longer apply;
- **Right to Withdraw Consent:** Revoking consent for call recording or biometric attendance verification at any time without penalty;
- **Right to Data Portability:** Obtaining a structured, machine-readable export (CSV/JSON) of personal information.

### Exercising Rights & DPO Contact
Data subjects should primary direct requests to the respective Customer (the Data Controller). For inquiries regarding Roxira’s direct processing or platform security, contact our Data Protection Officer:

- **Data Protection Officer (DPO):** `privacy@roxira.com`
- **Security Incident Response Team:** `security@roxira.com`
- **Postal Notice:** Roxira Enterprise Platform, Legal & Compliance Desk
