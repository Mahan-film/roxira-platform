> **DRAFT — needs EU / German lawyer review (Commission Implementing Decision (EU) 2021/915)**

# Data Processing Agreement (EU-Law AVV / Art. 28 GDPR)

**Effective Date:** 2026-11-24  
**Version:** 1.0 (Draft)  
**Legal Basis:** Regulation (EU) 2016/679 (GDPR), Art. 28(3); structured on **Commission Implementing Decision (EU) 2021/915** of 4 June 2021 on standard contractual clauses between controllers and processors.  
**Lawyer Review Status:** Pending external EU/German counsel sign-off (see Review & Open Questions table at the end).

---

## Clause 1 — Purpose and Scope (2021/915 Clause 1)

1.1. The purpose of these Standard Contractual Clauses ("**Clauses**" / "**AVV**") is to ensure compliance with Article 28(3) and (4) of Regulation (EU) 2016/679 (GDPR) where Roxira ("**Processor**") processes Personal Data on behalf of the Customer entity ("**Controller**") in connection with the Roxira Enterprise Hub, accounting, payroll, point-of-sale, and AI assistant services ("**Principal Agreement**").

1.2. **Precedence.** In the event of a contradiction between these Clauses and the provisions of related agreements between the Parties (including `docs/legal_customer/DPA.md` and `docs/legal_customer/B2B_TERMS.md`), these Clauses shall prevail for EU/EEA and UK/Swiss data subjects and EU-established Controllers.

---

## Clause 2 — Invariability of the Clauses (2021/915 Clause 2)

The Parties undertake not to modify the mandatory substance of Commission Implementing Decision (EU) 2021/915 Clauses except for adding business-specific information to the Annexes or updating the Sub-processor Registry in accordance with Clause 7.7.

---

## Clause 3 — Interpretation (2021/915 Clause 3)

Terms defined in Regulation (EU) 2016/679 have the same meaning in these Clauses.

---

## Clause 4 — Hierarchy (2021/915 Clause 4)

These Clauses apply to all processing operations specified in **Annex II**.

---

## Clause 5 — Description of Processing (2021/915 Clause 6)

Details of the processing operations, categories of data subjects, categories of personal data, and duration are set out in **Annex II**.

---

## Clause 6 — Obligations of the Parties (2021/915 Clause 7)

### 6.1. Instructions (2021/915 Clause 7.1)
1. Processor shall process Personal Data **only on documented instructions from Controller**, unless required to do so by Union or Member State law to which Processor is subject.
2. **No Service-Improvement or Model-Training Use:** For EU and tax-advisor tenants (`eu_tenant` profile, `config/ai_data_policy.json`), `allow_service_improvement_default` is `false`. Customer Personal Data and ledger data shall **not** be used to train, fine-tune, or improve AI models or shared services without explicit prior written opt-in from Controller.
3. Processor shall immediately inform Controller if, in Processor's opinion, an instruction infringes the GDPR or other Union or Member State data protection provisions.

### 6.2. Purpose Limitation (2021/915 Clause 7.2)
Processor shall process the Personal Data only for the specific purpose(s) of the processing as set out in Annex II, unless it receives further documented instructions from Controller.

### 6.3. Duration of Processing (2021/915 Clause 7.3)
Processing by Processor shall only take place for the duration specified in Annex II.

### 6.4. Security of Processing (2021/915 Clause 7.4)
1. Processor shall at least implement the technical and organisational measures specified in **Annex III** (`docs/legal_customer/TOMS_ANNEX_SDM.md`) to ensure the security of the Personal Data (Art. 32 GDPR).
2. Processor shall grant access to the Personal Data undergoing processing to members of its personnel only to the extent strictly necessary for implementing, managing, and monitoring the contract. Processor shall ensure that persons authorised to process the Personal Data have committed themselves to confidentiality or are under an appropriate statutory obligation of confidentiality (see also `docs/legal_customer/ADDENDUM_62A_STBERG.md` for § 62a StBerG tenants).

### 6.5. Sensitive Data (2021/915 Clause 7.5)
If the processing involves special categories of personal data (Art. 9 GDPR) or data relating to criminal convictions (Art. 10 GDPR), Processor shall apply specific restrictions and/or additional safeguards. **Note:** Roxira does **not** store biometric templates (no facial, fingerprint, or voiceprint templates; attendance hardware logs timestamps and terminal/employee IDs only).

### 6.6. Documentation and Compliance (2021/915 Clause 7.6)
1. The Parties shall be able to demonstrate compliance with these Clauses (Art. 5(2), Art. 28(3)(h), and Art. 30(2) GDPR).
2. Processor shall deal promptly and adequately with inquiries from Controller about the processing of data in accordance with these Clauses.
3. Processor shall make available to Controller all information necessary to demonstrate compliance with the obligations set out in these Clauses and allow for and contribute to audits, including inspections, conducted by Controller or another auditor mandated by Controller.

### 6.7. Use of Sub-processors (2021/915 Clause 7.7 — Option 2: General Written Authorisation)
1. Processor has Controller's general authorisation for the engagement of sub-processors from the agreed list in **Annex IV** (`docs/legal_customer/SUBPROCESSORS.md` §2.1 `eu_tenant` profile for EU/tax-advisor tenants).
2. **Sovereign AI Exclusion:** For EU and tax-advisor tenants, non-EU and may-log AI providers (including China-based model vendors, US-edge free tiers, and `:free` endpoints) are blocked in code; only EU-resident sovereign inference (**Mistral AI SAS**, France/EU, zero prompt logging, no training) is permitted.
3. Processor shall inform Controller in writing of any intended changes of that list through the addition or replacement of sub-processors at least **fourteen (14) calendar days** in advance, giving Controller sufficient time to object prior to the engagement.
4. Where Processor engages a sub-processor, it shall do so by way of a written contract imposing the same data protection obligations as those imposed on Processor under these Clauses (Art. 28(4) GDPR).

### 6.8. International Transfers (2021/915 Clause 7.8)
1. Any transfer of Personal Data to a third country or an international organisation by Processor shall be done only on the basis of documented instructions from Controller or in order to fulfil a specific requirement under Union or Member State law, and shall take place in compliance with Chapter V of the GDPR (adequacy decision under Art. 45 GDPR, including the EU-US Data Privacy Framework where valid, with **Standard Contractual Clauses (Decision 2021/914)** as mandatory fallback).
2. For EU/tax-advisor tenants subject to § 62a StBerG, foreign processing is permitted only if the foreign law provides data protection and confidentiality comparable to domestic law.

---

## Clause 7 — Assistance to the Controller (2021/915 Clause 8)

Processor shall promptly notify Controller of any request it has received from a data subject and shall assist Controller in fulfilling its obligations to respond to data subject requests (Art. 15–22 GDPR), Data Protection Impact Assessments (Art. 35 GDPR), and prior consultations with supervisory authorities (Art. 36 GDPR).

---

## Clause 8 — Notification of Personal Data Breaches (2021/915 Clause 9)

In the event of a Personal Data Breach concerning Personal Data processed by Processor under these Clauses, Processor shall notify Controller **without undue delay** (Art. 33(2) GDPR), and in any event within **twenty-four (24) to forty-eight (48) hours** of becoming aware of and confirming the breach, providing at minimum the information required under Art. 33(3) GDPR so Controller can meet its 72-hour notification obligation under Art. 33(1) GDPR.

---

## Clause 9 — Non-compliance and Termination (2021/915 Clause 10)

1. Without prejudice to any provisions of the GDPR, in the event that Processor is in breach of its obligations under these Clauses, Controller may instruct Processor to suspend the processing of Personal Data until the latter complies with these Clauses or the contract is terminated.
2. Upon termination of the Principal Agreement, Processor shall, at the choice of Controller, delete all Personal Data processed on behalf of Controller (after the 30-day `cancelled_readonly` export window, using GoBD Z3 / CSV / JSON export) and certify to Controller that it has done so, or return all Personal Data to Controller and delete existing copies unless Union or Member State law requires storage of the Personal Data.

---

## Annex I — List of Parties

- **Controller(s):** The Customer entity identified in the Principal Agreement / Order Form.
- **Processor(s):** Roxira (operating entity details, registered address, and DPO / privacy contact to be inserted prior to execution).

---

## Annex II — Description of Processing

- **Categories of data subjects:** Customer's employees, contractors, clients/buyers, suppliers/vendors, and callers/contacts interacting via telephony or support channels.
- **Categories of personal data:** Identity and contact data, tax/registration identifiers, financial and accounting ledger records, payroll and attendance device event logs (no biometric templates), and voice/transcription records where telephony is enabled.
- **Nature and purpose of processing:** Cloud accounting, invoicing, inventory, payroll, tax compliance preparation, and AI-assisted legal/accounting workflow support on Controller's documented instructions.
- **Duration:** Duration of the Principal Agreement plus the 30-day post-termination export window (`cancelled_readonly`), followed by irreversible purge (`delete_after`), subject to statutory retention obligations.

---

## Annex III — Technical and Organisational Measures (TOMs)

See `docs/legal_customer/TOMS_ANNEX_SDM.md` (structured around the 7 SDM guarantees).

---

## Annex IV — List of Sub-processors

See `docs/legal_customer/SUBPROCESSORS.md` (§2.1 `eu_tenant` profile for EU/tax-advisor tenants; §3 infrastructure sub-processors).

---

## Lawyer Review & Open Questions (T286)

| Item | Status | Notes |
|---|---|---|
| Commission 2021/915 Clauses 1–10 + Annexes I–IV alignment | Drafted | Pending EU/German counsel review |
| Liability cap in `docs/legal_customer/B2B_TERMS.md` §8.5 vs §§ 307, 309 BGB | **Needs counsel edit** | Flat 12-month fee cap lacks mandatory carve-outs for intent (*Vorsatz*), gross negligence (*grobe Fahrlässigkeit*), injury to life/body/health, and Product Liability Act (*ProdHaftG*); simple-negligence breach of cardinal duties (*Kardinalpflichten*) should be capped at foreseeable typical damage. |
| GoBD process documentation (*Verfahrensdokumentation*) | **Ask tax-advisor counsel** | Confirm whether German tax-advisor buyers expect a standard template *Verfahrensdokumentation* alongside append-only ledger & GoBD Z3 export. |
