> **DRAFT — needs German tax-advisor / criminal-law counsel review (§ 62a StBerG, § 203 StGB)**

# Confidentiality & Professional Secrecy Addendum (§ 62a StBerG)

**Effective Date:** 2026-11-24  
**Version:** 1.0 (Draft)  
**Statutory Basis:** § 62a of the German Tax Consultancy Act (*Steuerberatungsgesetz — StBerG*) in conjunction with § 203(3)–(4) of the German Criminal Code (*Strafgesetzbuch — StGB*).  
**Supersedes / Supplements:** `docs/legal_customer/AVV_EU_GDPR.md` and `docs/legal_customer/B2B_TERMS.md` for Customers subject to § 57 StBerG (*Steuerberater*, *Steuerbevollmächtigte*, *Steuerberatungsgesellschaften*).

> [!IMPORTANT]
> **Text Form Requirement (§ 62a Abs. 3 StBerG, § 126b BGB):** This Addendum must be concluded in **text form** (e.g., signed PDF, e-signature, or durable electronic confirmation) before Customer processes mandate-related data protected by professional secrecy on the Platform.

---

## 1. Purpose and Scope

Customer is bound by statutory professional secrecy obligations under § 57 StBerG and § 203 StGB. Where Customer uses the Roxira Platform as an external service provider (*sonstige mitwirkende Person* within the meaning of § 62a StBerG and § 203 Abs. 3 Satz 2 StGB), Roxira acts as a **commissioned service provider** under the strict statutory conditions of § 62a StBerG.

---

## 2. Confidentiality Undertaking & Criminal-Consequence Warning (§ 62a Abs. 3 Nr. 1–2 StBerG)

2.1. **Strict Duty of Secrecy.** Processor undertakes to maintain strict secrecy regarding all facts, mandate records, financial data, tax filings, client identities, and other confidential information (*fremde Geheimnisse*) of which Processor or its personnel gain knowledge in the course of providing the Services.

2.2. **Explicit Warning of Criminal Consequences (§ 62a Abs. 3 Nr. 2 StBerG):**  
> **Criminal Law Notice (§ 203 Abs. 4 StGB):** Processor and all persons deployed by Processor who have access to protected mandate data are hereby explicitly instructed and warned that any **unauthorised disclosure** of a confidential fact protected by professional secrecy (*fremdes Geheimnis*) is a criminal offence under **§ 203 Abs. 4 of the German Criminal Code (StGB)**, punishable by **imprisonment for up to one year or a fine** (and up to two years or a fine where committed for gain or with intent to enrich or harm, § 203 Abs. 6 StGB).

2.3. **Personnel Instruction.** Processor shall bind every employee, contractor, and administrator who may come into contact with Customer data in text form to secrecy and instruct them on the criminal consequences under § 203 Abs. 4 StGB prior to granting access.

---

## 3. Need-to-Know Access Limitation (§ 62a Abs. 3 Nr. 3 StBerG)

3.1. Processor shall restrict access to Customer's protected data strictly to the extent **necessary for the performance of the contractually agreed Services** (maintenance, hosting, support upon documented ticket).

3.2. Technical enforcement:
- Multi-tenant database isolation via PostgreSQL `FORCE ROW LEVEL SECURITY` and `TenantScope` (as `roxira_app` non-superuser role once T200 `#831` is cut over);
- No routine human inspection of tenant ledger/tax content;
- `allow_service_improvement_default: false` (`eu_tenant` profile, `config/ai_data_policy.json`) — mandate data is never used for model training or product improvement.

---

## 4. Sub-processors & Flow-Down Obligation (§ 62a Abs. 3 Nr. 4, Abs. 2 StBerG)

4.1. Processor may engage further sub-processors (*weitere mitwirkende Personen*) only if:
- Customer has consented (general written authorisation via `docs/legal_customer/SUBPROCESSORS.md` §2.1 `eu_tenant` profile, with 14-day advance notice and right to object); **and**
- Processor obliges each sub-processor in **text form** to observe confidentiality, instructs them on the criminal consequences under § 203 Abs. 4 StGB, and restricts their access to what is necessary.

4.2. **Sovereign AI Exclusion:** For § 62a StBerG tenants, non-EU and may-log AI model providers (including China-based vendors and `:free` endpoints) are blocked in code (`eu_tenant` profile); only EU-resident zero-retention inference (**Mistral AI SAS**, France/EU) is permitted.

---

## 5. Foreign Processing (§ 62a Abs. 4 StBerG)

Processor may process protected mandate data outside Germany only to the extent that the data protection and professional secrecy protections at the place of processing are **comparable** to those applicable in Germany. Primary hosting and sovereign AI inference for § 62a StBerG tenants remain within the **European Union / EEA** (Germany/Finland Hetzner infrastructure; France/EU Mistral AI SAS).

---

## 6. Single-Mandate Services (§ 62a Abs. 1 Satz 2 StBerG)

Where services are commissioned specifically for a single identifiable mandate (rather than general IT/SaaS infrastructure), Customer remains responsible for obtaining the client's prior consent where required by § 62a Abs. 1 StBerG.

---

## 7. Liability & BGB §§ 307 / 309 Note (for Counsel Review)

In `docs/legal_customer/B2B_TERMS.md` §8.5, the current standard liability cap is a flat 12-month fee cap. For German-law contracts with tax advisors, counsel must insert standard German BGB §§ 307/309 carve-outs:
- **Unlimited liability** for intent (*Vorsatz*), gross negligence (*grobe Fahrlässigkeit*), injury to life, body, or health (*Verletzung von Leben, Körper oder Gesundheit*), fraudulent concealment of defects, and mandatory liability under the Product Liability Act (*Produkthaftungsgesetz*).
- For **simple negligence** (*leichte Fahrlässigkeit*), liability only for breach of material contractual obligations (*Kardinalpflichten*), limited to the foreseeable, contract-typical damage.
