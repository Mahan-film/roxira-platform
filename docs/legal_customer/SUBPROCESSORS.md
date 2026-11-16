> **DRAFT — needs local lawyer review**

# Authorized Sub-processor Registry

**Effective Date:** 2026-11-15  
**Version:** 1.0 (Draft)  
**Governing Policy:** Roxira AI Data Policy (`config/ai_data_policy.json`, `docs/ops/AI_DATA_POLICY.md`) and Model Registry (`config/models.yaml`)

---

## 1. Overview and Sub-processor Governance

To deliver the Roxira enterprise cloud accounting, payroll, retail point-of-sale, and artificial intelligence assistant services, Roxira engages third-party sub-processors to perform specialized infrastructure, hosting, communications, and computational inference services.

Roxira exercises stringent due diligence prior to engaging any sub-processor, executing binding Data Processing Agreements that enforce:
- Strict technical and organizational security measures (TOMs);
- Geographic and cross-border transfer restrictions aligned with the Malaysia Personal Data Protection Act (PDPA 2024) and GDPR Standard Contractual Clauses (SCCs);
- **Clear separation between standard plans** (where customer data may be used to run and improve the service, including AI models) **and the paid private data option** (where data is never used beyond the customer’s own service and inference routes strictly to paid endpoints with `data_collection = deny`).

---

## 2. Artificial Intelligence & Machine Learning Sub-processors

Under standard plans, Customer data may be used to run and improve the Services, including AI models, and AI inference routes free-tier first with paid fallback. Customers who purchase the paid **private data option** are routed exclusively to paid model endpoints with data collection denied (`data_collection = deny`) and no use beyond the Customer’s own service.

| Sub-processor Entity | Jurisdiction / Hosting Location | Service / Model Scope | Data Processed | Data Safeguards & Terms |
|---|---|---|---|---|
| **OpenRouter Inc.** | United States / Global Edge | Enterprise AI Gateway routing paid inference to vetted providers (`cheap`, `strong`, `vision`, `drafting`) | Prompts containing ledger data, invoice queries, and OCR text | Paid API terms; transmits `provider.data_collection = deny`; zero-day data retention agreement |
| **Hangzhou DeepSeek Artificial Intelligence Co., Ltd.** | China / Singapore (via OpenRouter enterprise route) | Primary conversational and transactional reasoning engine (`deepseek/deepseek-v4.1-flash`, `deepseek/deepseek-v4-flash-0731`) | Financial transaction contexts, report queries, ledger explanations | Paid enterprise endpoint; reasoning mode configured without training logs; zero customer prompt retention |
| **Google LLC / Google Cloud Platform** | United States / EU / Global | Document OCR, multimodal invoice ingestion, and reasoning (`google/gemini-3.1-flash-lite`, `gemini-3.8-flash`, `gemini-pro`) | Uploaded invoice images, receipt photos, purchase orders | Google Cloud Enterprise / Workspace data protection terms; no training on customer API inputs |
| **Alibaba Cloud / Qwen** | Singapore / Global Edge | Secondary fallback summarization and classification (`qwen/qwen3.8-flash`) | Categorization metadata, natural language invoice text | Paid enterprise tier; prompt logging disabled; strict tenant isolation |
| **Mistral AI SAS** | France / European Union | European sovereign model fallback (`mistral-small-24b-instruct`, `mistral-medium-latest`) | Statutory text analysis, legal query synthesis | EU GDPR native processor; strict EU data residency compliance; no prompt logging |
| **Groq Inc.** | United States | Ultra-low latency LPU hardware inference for speech transcription and streaming responses | Audio streams, conversational voice transcripts | Ephemeral in-memory inference; no audio payload persistence after stream completion |
| **SambaNova Systems, Inc.** | United States | High-throughput hardware inference accelerator | Document synthesis, multi-lingual tokenization | Enterprise API SLA; zero storage of customer token streams |

---

## 3. Core Cloud Infrastructure, Compute & Database Sub-processors

| Sub-processor Entity | Jurisdiction / Hosting Location | Service Scope | Data Processed | Data Safeguards & Terms |
|---|---|---|---|---|
| **Hetzner Online GmbH** | Germany & Finland (European Union) | Dedicated bare-metal and cloud virtual server hosting (Enterprise Hub NestJS app, Python AI core, BullMQ background queues) | All Customer Data, database tables, and application logs | ISO/IEC 27001 certified data centres; German Federal Data Protection Act (BDSG) & GDPR compliance; hardware encryption |
| **PostgreSQL & PgBouncer Engine** | Hosted within Roxira European Data Centre (Hetzner) | Primary multi-tenant relational persistence tier | Complete financial ledgers, vouchers, customer master records, chart of accounts | Enforced Row-Level Security (`FORCE RLS`) on all tables; AES-256 encrypted storage volumes; `TenantScope` isolation |
| **Qdrant Vector Database** | Hosted within Roxira European Data Centre (Hetzner) | High-performance legal knowledge graph and vector retrieval embeddings | Embedded legal statutory articles, tax code embeddings, anonymized semantic search vectors | Vectorized embeddings only; no raw personal identifying information (PII) stored in vector collections |
| **Redis In-Memory Data Store** | Hosted within Roxira European Data Centre (Hetzner) | High-speed cache, rate limiting, and BullMQ worker job queue orchestration | Ephemeral session tokens, export worker job payloads, queue identifiers | Encrypted in-memory buffers; automated TTL expiration; isolated within private container network |
| **Off-Site Object Storage (S3-Compatible)** | European Union / Encrypted Replica | Immutable daily and hourly cryptographic backup archives | Encrypted database dumps, tenant export zip archives | End-to-end client-side GPG/AES-256 encryption applied before transmission; write-once-read-many (WORM) retention |

---

## 4. Telephony, Communications & Notification Sub-processors

| Sub-processor Entity | Jurisdiction / Hosting Location | Service Scope | Data Processed | Data Safeguards & Terms |
|---|---|---|---|---|
| **Twilio Inc.** | United States / Global Edge | Voice SIP telephony integration, real-time audio streaming, global SMS verification | Telephone numbers, incoming/outgoing voice packets, verification codes | SOC 2 Type II, ISO 27001 certified; GDPR Binding Corporate Rules (BCRs); explicit call opt-in required before recording |
| **Sendinblue SAS (Brevo)** | France / European Union | Transactional email delivery, system alerts, password reset delivery | Recipient email addresses, user names, account notification templates | EU-based data processing; GDPR compliant; automated bounce suppression; no email content mining |
| **Local Telecom Gateway (Kavenegar / National Carrier Relays)** | Regional Local Domicile (Malaysia / Domestic) | Domestic statutory SMS notification, two-factor OTP delivery, payment reminders | Recipient mobile numbers, OTP verification codes, transaction summary alerts | Domestic statutory compliance; messages restricted to approved transactional and security templates |

---

## 5. Security, Monitoring & Observability Sub-processors

| Sub-processor Entity | Jurisdiction / Hosting Location | Service Scope | Data Processed | Data Safeguards & Terms |
|---|---|---|---|---|
| **Cloudflare, Inc.** | Global Edge Network | Web Application Firewall (WAF), DDoS protection, TLS termination, CDN caching | Public IP addresses, HTTP request headers, encrypted SSL/TLS session packets | SOC 2 Type II, ISO 27001; edge inspection only; payloads decrypted in memory for threat detection and never logged |
| **Synthetic Health Monitor** | Self-hosted on dedicated monitoring instance (Hetzner, EU) | Synthetic platform pinging, uptime verification, latency monitoring | Synthetic test tenant ping results; zero customer operational data | Completely isolated from production customer databases; monitors endpoint reachability and TLS validity |

---

## 6. Sub-processor Update and Customer Objection Mechanism

6.1. **Notification of Modifications.** Roxira maintains this registry up to date. Roxira shall provide Customer with at least fourteen (14) calendar days advance written notice (via administrative email and platform notification) of the engagement of any new sub-processor.

6.2. **Objection Procedure.** Customer may object in writing to the appointment of a new sub-processor on reasonable data protection or security grounds within ten (10) days of receiving notice. Upon receiving an objection:
- Roxira will discuss with Customer in good faith to identify reasonable operational mitigations;
- If no mutually acceptable alternative can be found, Customer may terminate the subscription for the affected Services without liability, receiving a pro-rata refund of any unearned prepaid fees.
