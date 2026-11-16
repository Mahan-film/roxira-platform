> **DRAFT — needs local lawyer review**

# B2B Software-as-a-Service Terms of Service & Service Level Agreement

**Effective Date:** 2026-11-15  
**Version:** 1.0 (Draft)  
**Applicability:** Commercial B2B Subscribers of Roxira Platform

---

## 1. Definitions and Interpretation

1.1. **"Agreement"** means collectively these B2B Terms of Service, the Service Level Agreement (Section 7), the Data Processing Agreement ("DPA"), the Sub-processor List, and any applicable Order Form or electronic subscription schedule.

1.2. **"Customer"** means the business entity, corporation, partnership, or sole proprietorship that enters into this Agreement by registering an account, provisioning an organization, or subscribing to the Services.

1.3. **"Customer Data"** means all electronic data, text, documents, ledger transactions, employee records, invoices, bank statements, voice recordings, images, and other materials submitted, posted, or stored by Customer or Authorized Users in the Services.

1.4. **"Authorized User"** means an individual employee, contractor, or accountant authorized by Customer to access the Services under Customer’s tenant account, designated with specific access roles.

1.5. **"Services"** means the Roxira cloud-based enterprise platform, including the Enterprise Hub (accounting, treasury, inventory, payroll, invoicing, and POS), AI Assistant modules, legal intelligence query services, and associated application programming interfaces (APIs).

1.6. **"Tenant"** means the logically isolated database partition and organizational workspace provisioned specifically for Customer, protected by cryptographic access tokens and database Row-Level Security (RLS).

1.7. **"Entitlements"** means the quantitative plan boundaries provisioned to Customer’s tenant, including authorized branch counts, office user seats, registered payroll employees, AI message allotments, optical character recognition (OCR) page quotas, and voice telephony minutes.

---

## 2. Account Registration, Provisioning, and Tenant Administration

2.1. **Corporate Authority.** The individual executing this Agreement represents and warrants that they possess full legal authority to bind Customer to these terms.

2.2. **Tenant Isolation.** Each Customer is provisioned with a logically segregated Tenant. Database access is strictly governed by automated Row-Level Security (`FORCE RLS`) and `TenantScope` session controls. Roxira enforces strict isolation barriers preventing any unauthorized cross-tenant data visibility.

2.3. **Credential Security.** Customer is solely responsible for maintaining the confidentiality of administrative credentials, API tokens, and WebAuthn authenticators. Customer shall immediately notify Roxira upon discovering any unauthorized access or compromise of tenant credentials.

2.4. **Role-Based Access Control (RBAC).** Customer administers individual user permissions, spending thresholds, and sensitive field visibility (e.g. salary, cost, margin) through the Platform's custom role registry. Roxira disclaims liability for actions taken by Authorized Users acting within permissions granted by Customer’s administrators.

---

## 3. Subscription License, Permitted Use, and Restrictions

3.1. **License Grant.** Subject to timely payment of subscription fees and compliance with this Agreement, Roxira grants Customer a non-exclusive, non-transferable, non-sublicensable, worldwide commercial license during the Subscription Term to access and use the Services for Customer's internal business operations.

3.2. **Permitted Use.** Customer may use the Services to record accounting vouchers, administer payroll, process retail POS sales, issue invoices, reconcile bank statements, execute compliance checks, and query platform intelligence assistants.

3.3. **Restrictions on Use.** Customer shall not, directly or indirectly:
- Reverse engineer, decompile, disassemble, or derive source code, algorithms, or internal schemas of the Services;
- Circumvent, disable, or tamper with any security controls, Row-Level Security policies, rate limiters, or license validation guards;
- Submit to the AI Assistant or platform endpoints any malicious code, harmful payloads, or unlawful content;
- Use outputs of the Services to train, fine-tune, or benchmark competitive commercial artificial intelligence or accounting models;
- Resell, white-label, lease, time-share, or provide service bureau access to the Services to unaffiliated third parties without prior written consent.

---

## 4. Fees, Entitlements, Metering, and Payment

4.1. **Subscription Structure.** Subscription fees are calculated based on:
- Base platform tier (covering core modules, base storage, and company profile);
- Branch and terminal units (multi-branch operations);
- Metered usage consumption (AI message tokens, OCR invoice document pages, and voice telephony minutes).

4.2. **Metered Consumption & Usage Caps.** Usage-based services are metered continuously. When a Tenant reaches 100% of its monthly entitlement quota for voice minutes or OCR pages, subsequent requests are paused or routed through configurable fallback handling (e.g., standard voicemail or manual receipt entry) unless Customer purchases an add-on capacity pack.

4.3. **Taxes and Currencies.** All fees are stated exclusive of value-added tax (VAT), goods and services tax (GST), sales and service tax (SST), or withholding taxes, which shall be added to invoices as required by applicable law. All financial balances within the accounting core are maintained in integer minor currency units.

4.4. **Invoicing & Payment.** Invoices are issued in advance of the service period (or monthly in arrears for metered overages). Undisputed fees are due within thirty (30) calendar days of invoice date. Overdue balances accrue interest at the lesser of 1.5% per month or the statutory maximum rate.

---

## 5. Proprietary Rights and Customer Data Ownership

5.1. **Customer Ownership.** As between the parties, Customer exclusively retains all right, title, and interest (including all intellectual property rights) in and to Customer Data. Roxira acquires no ownership interest in Customer Data.

5.2. **Service & Improvement License.** Customer grants Roxira a non-exclusive, worldwide license to host, process, transmit, display, and use Customer Data to provide, maintain, support, and improve the Services, including artificial intelligence models, unless Customer has purchased the paid **private data option** (under which Customer Data is not used beyond Customer’s own service).

5.3. **Platform Intellectual Property.** Roxira retains all intellectual property rights in and to the platform software, user interface designs, APIs, documentation, algorithmic models, and system telemetry.

5.4. **Feedback.** Any suggestions or feedback voluntarily provided by Customer regarding platform enhancements may be incorporated by Roxira without obligation or compensation.

---

## 6. Information Security, Data Protection, and Confidentiality

6.1. **Confidentiality.** Each party agrees to protect the other party’s Confidential Information with the same degree of care it uses for its own confidential materials (and never less than reasonable care). Confidential Information includes Customer Data, pricing schedules, security architecture, and non-public technical specifications.

6.2. **Technical Safeguards.** Roxira maintains rigorous technical and organizational measures (TOMs), including TLS 1.3 encryption in transit, AES-256 encryption at rest, automated off-site immutable backups, database write-guards against modifying posted journal entries, and automated vulnerability scanning.

6.3. **AI Data Governance & Private Data Option.** Under standard plans, Customer Data may be used to run and improve the Services, including AI models (and inference may route through free or standard model tiers). Customers requiring strict isolation may purchase the paid **private data option**, under which Customer Data is never used beyond Customer’s own service and AI requests are routed exclusively to paid model endpoints with data collection denied (`data_collection=deny`).

6.4. **Attendance Device Logs Only.** Where Customer uses hardware attendance terminals, the Services store device event logs (such as timestamps, terminal identifiers, and employee identifiers) only, and **never store biometric templates** (no fingerprint, facial, or voiceprint templates or raw biometric images).

---

## 7. Service Level Agreement (SLA)

7.1. **Service Availability Commitment.**  
Roxira will use commercially reasonable efforts to make the Core Platform Services available with a Monthly Uptime Percentage of at least **99.9%** during each calendar month (excluding Scheduled Maintenance).

$$\text{Monthly Uptime \%} = \frac{\text{Total Minutes in Month} - \text{Downtime Minutes}}{\text{Total Minutes in Month}} \times 100$$

7.2. **Scheduled Maintenance.**  
Scheduled maintenance windows will occur during off-peak hours (between 00:00 and 04:00 UTC) with at least forty-eight (48) hours advance electronic notification. Scheduled maintenance shall not exceed eight (8) cumulative hours per calendar month.

7.3. **Incident Priority and Target Response Times:**

| Priority | Definition | Initial Response Time | Resolution / Workaround Target |
|---|---|:---:|:---:|
| **P1 - Critical** | Catastrophic outage; core accounting, POS counter transactions, or API endpoints completely unavailable for all users. | < 1 hour | < 4 hours |
| **P2 - Major** | Significant impairment of critical business feature (e.g., payroll run failure, bank reconciliation sync failure); no immediate workaround. | < 2 hours | < 8 hours |
| **P3 - Standard** | Non-critical feature degradation or localized issue with viable operational workaround. | < 8 hours | < 2 business days |
| **P4 - Minor** | Cosmetic, documentation, or minor functional inquiry not impacting ongoing accounting operations. | < 24 hours | Next scheduled maintenance release |

7.4. **Service Credits.**  
If Roxira fails to meet the Monthly Uptime Commitment, Customer is eligible to receive a Service Credit applied against future subscription fees, upon written claim submitted within thirty (30) days of the month end:

| Monthly Uptime Percentage | Service Credit Percentage (of monthly base fee) |
|---|:---:|
| **99.0% to < 99.9%** | 10% |
| **95.0% to < 99.0%** | 25% |
| **< 95.0%** | 50% |

7.5. **SLA Exclusions.** Downtime caused by the following shall not be counted towards SLA calculations:
- Customer’s internet connectivity, local network, or hardware failure;
- Unauthorized modification of platform configurations by Customer;
- Force majeure events (earthquakes, war, national telecommunications disruption);
- Third-party upstream failures outside Roxira's reasonable control (e.g. national banking clearance gateways, government tax authority portal outages).

---

## 8. Warranties, Disclaimers, and Limitation of Liability

8.1. **Platform Warranty.** Roxira warrants that the Services will perform materially in accordance with the user documentation under normal operating conditions.

8.2. **Regulatory & Legal Assistant Disclaimer.**  
> [!WARNING]
> The Roxira Legal Intelligence Assistant and automated tax calculation previews provide automated research synthesis, statutory citations, and computational aids based on official legal gazettes. **The Services do not constitute certified legal, judicial, tax, or formal statutory auditing advice.** Customer retains ultimate responsibility for verifying tax filings, financial statements, and compliance with certified local legal counsel and licensed auditors.

8.3. **Disclaimer of Implied Warranties.** Except as expressly stated herein, Roxira provides the Services "AS IS" and disclaims all implied warranties of merchantability, fitness for a particular purpose, and non-infringement.

8.4. **Limitation of Consequential Damages.** Neither party shall be liable for any indirect, incidental, punitive, special, or consequential damages, including loss of profits, revenue, or business reputation.

8.5. **Aggregate Liability Cap.** The total cumulative liability of either party arising out of or related to this Agreement shall be limited to the total subscription fees actually paid by Customer to Roxira in the twelve (12) months preceding the incident giving rise to liability.

---

## 9. Term, Cancellation, Data Export, and Termination

9.1. **Subscription Term.** The Agreement commences on the subscription start date and continues for the agreed commitment term (monthly or annual), renewing automatically unless cancelled thirty (30) days prior to renewal.

9.2. **Termination for Cause.** Either party may terminate this Agreement immediately upon written notice if the other party materially breaches this Agreement and fails to cure such breach within thirty (30) days of written notice.

9.3. **Cancellation & Read-Only Transition.** Upon receipt of cancellation notice, Customer’s tenant transitions on the effective termination date to a `cancelled_readonly` state for a mandatory grace period of **thirty (30) calendar days**. During this period:
- Write actions across invoices, ledger, and payroll are disabled;
- Customer administrators retain full read and export access to generate a complete offline archive of all accounting ledgers, journals, customer records, and documents in standard formats (CSV/JSON/PDF);
- BullMQ export jobs provide one-click complete tenant backup downloads.

9.4. **Permanent Purge.** Following expiration of the thirty (30) day export grace period (`delete_after`), Roxira initiates automated, irreversible database purging and cryptographic wiping of Customer Data across all tenant tables and backups, in compliance with the Data Processing Agreement.

---

## 10. General Legal Provisions

10.1. **Governing Law and Jurisdiction.** This Agreement shall be governed by and construed in accordance with the laws of Malaysia (or the corporate domicile of Roxira’s operating entity), without regard to conflict of laws principles. Any dispute arising out of this Agreement shall be submitted to the exclusive jurisdiction of the competent commercial courts of Kuala Lumpur (or the agreed dispute resolution tribunal).

10.2. **Severability.** If any provision of this Agreement is held invalid or unenforceable, the remaining provisions shall remain in full force and effect.

10.3. **Entire Agreement.** This Agreement constitutes the complete and exclusive agreement between the parties regarding its subject matter and supersedes all prior negotiations, proposals, or communications.
