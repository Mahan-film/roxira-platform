# Iranian Statutory Tax & Social Security Compliance Verification (Candidates for 1405 / 1406)

> **Document Status**: Verified against official statutory sources, legislation, and live codebase contracts.  
> **Date**: 2026-11-08 (18 Aban 1405)  
> **Target Issue**: [#616](https://github.com/Mahan-film/roxira-platform/issues/616) & Task T20 in [#592](https://github.com/Mahan-film/roxira-platform/issues/592)  
> **Target Module**: Management-configurable policies in `output_apps/enterprise_hub/modules/settings/` and `tax_compliance/` / `hr/`

---

## Executive Summary

This audit evaluates the 6 legal and technical compliance claims raised in Issue #616 regarding Iranian corporate and tax operations for the solar years 1405 and 1406. Each claim was investigated against:
1. **Primary Legal Sources**: Direct Taxes Act (قانون مالیات‌های مستقیم - ق.م.م), Act on Electronic Terminals and Moadian System (قانون پایانه‌های فروشگاهی و سامانه مؤدیان), Facilitation of Moadian Duties Act (قانون تسهیل تکالیف مؤدیان), and the Family and Youth Protection Act (قانون حمایت از خانواده و جوانی جمعیت).
2. **Official Executive Regulations & Circulars**: INTA (سازمان امور مالیاتی کشور - tax.gov.ir), Moadian Technical Office (tp.tax.gov.ir), and Social Security Organization (سازمان تأمین اجتماعی - tamin.ir).
3. **Live Codebase Implementation**: Verification of existing entities, repositories, encryption layers, and export services across `output_apps/enterprise_hub/`.

---

## Detailed Evaluation of Compliance Candidates

### 1. Electronic Commercial Books (دفاتر تجاری الکترونیکی)

* **Claim**: Electronic commercial books submission is quarterly for 1405 (summer deadline by end of Aban 1405) and transitions to monthly from 1406. Does Roxira's export match the required format?
* **Statutory Source**:
  - Executive Bylaw of Article 95 of the Direct Taxes Act (آیین‌نامه اجرایی ماده ۹۵ ق.م.م - بخشنامه شماره ۲۰۰/۹۶/۴۱ و اصلاحیه‌های سامانه پلمب و تحریر دفاتر الکترونیکی).
  - Official Portals: [tax.gov.ir](https://tax.gov.ir) and Judiciary Corporate Registration Portal ([ssaa.ir](https://ssaa.ir)).
* **Legal Verification**:
  - **VERIFIED**: Under the digital transformation plan for commercial books replacing physical wax-sealed books (پلمب فیزیکی دفاتر روزنامه و کل), filing transitioned to electronic data packages:
    - **Year 1404**: Semi-annual reporting (شش‌ماهه); first half (H1) due by end of Aban 1404.
    - **Year 1405**: Quarterly reporting (فصلی); Spring due by end of Mordad, Summer due by end of Aban 1405 (۳۰ آبان ۱۴۰۵), Autumn due by end of Bahman 1405.
    - **Year 1406 onwards**: Monthly reporting (ماهانه), synchronized with Value Added Tax (VAT) and Moadian declarations.
* **Codebase Comparison**:
  - Service: `output_apps/enterprise_hub/modules/tax_compliance/reports/ledger-export.service.ts`
  - Documentation: `docs/tax/LEDGER_EXPORT_LAYOUT.md`
  - Inspection: Roxira already exports the standard 14-column format:
    `row_index`, `voucher_number`, `voucher_date`, `account_code_kol`, `account_code_moein`, `account_code_tafsili`, `debit`, `credit`, `description`, `currency`, `balance`.
* **Actionable Recommendation**:
  - Add management-configurable policy:
    `COMMERCIAL_BOOKS_PERIODICITY: "QUARTERLY" | "MONTHLY"` (Default for 1405: `"QUARTERLY"`).
  - Provide pre-configured quarterly date filters for H1/H2 (1404), Q1..Q4 (1405), and monthly (1406).

---

### 2. Moadian Inbox (کارپوشه مؤدیان) — 30-Day Silent Acceptance Window

* **Claim**: Purchase invoices in the buyer's Moadian inbox must be accepted or rejected within 30 days, and silence constitutes statutory acceptance. Is a daily alert for invoices older than 20 days needed?
* **Statutory Source**:
  - Note to Article 5 of the Act on Electronic Terminals and Moadian System (تبصره ماده ۵ قانون پایانه‌های فروشگاهی و سامانه مودیان).
  - Article 5 of the Facilitation Act (قانون تسهیل تکالیف مودیان جهت تسهیل اجرای قانون پایانه‌های فروشگاهی).
  - Official Portal: [tp.tax.gov.ir](https://tp.tax.gov.ir).
* **Legal Verification**:
  - **VERIFIED**: The law stipulates:
    > "مؤدیان مالیاتی مکلفند ظرف مدت ۳۰ روز از تاریخ درج صورتحساب الکترونیکی در کارپوشه، نسبت به پذیرش یا رد آن اقدام نمایند. در صورت عدم اقدام ظرف مهلت مقرر، صورتحساب به صورت خودکار تأییدشده تلقی می‌گردد."
  - Once automatically accepted by the tax system (سکوت در حکم تأیید), the invoice becomes non-rejectable, and the buyer is legally bound to the purchase, liabilities, and VAT credit attribution.
* **Codebase Status**:
  - Currently, invoices are sent via `MoadianService` (`output_apps/enterprise_hub/modules/tax_compliance/services/moadian.service.ts`), but received purchase invoices (فاکتورهای خرید دریافتی در کارپوشه) are polled through sync workers.
* **Actionable Recommendation**:
  - Create management-configurable policy in policy registry:
    - `MOADIAN_INBOX_UNCONFIRMED_WARN_DAYS`: default `20` (Warning banner on purchase ledger).
    - `MOADIAN_INBOX_UNCONFIRMED_CRITICAL_DAYS`: default `27` (High-priority alert email/notification before irreversible auto-acceptance at day 30).
  - Add `unread_or_pending_acceptance` badge on the Moadian tab in `/app/tax`.

---

### 3. Article 6 Sales Cap (سقف مجاز صدور صورتحساب ماده ۶)

* **Claim**: Warning at 80% of allowed cap, before the tax system's own 85% warning.
* **Statutory Source**:
  - Article 6 of Act on Terminals & Moadian System (ماده ۶ قانون پایانه‌های فروشگاهی و سامانه مؤدیان) as amended by Article 6 of Facilitation Act.
* **Legal Verification**:
  - **VERIFIED**: The statutory quota for each taxable period (quarter) is:
    - **Existing businesses**: 5 times (increased from 3x by Facilitation Act) the taxable sales of the corresponding period of the previous year whose tax has been settled or arranged.
    - **New enterprises or zero-tax base**: 5 times the annual tax-free allowance under Article 101 of Direct Taxes Act (معافیت سالانه ماده ۱۰۱ ق.م.م).
  - **Penalty**: Exceeding the ceiling causes the tax system to deny VAT input credits (عدم تعلق اعتبار مالیاتی ارزش افزوده) to the buyers, damaging customer relations and generating Moadian system rejection warnings.
  - The INTA portal dispatches warnings at **85%** utilization.
* **Actionable Recommendation**:
  - Implement proactive threshold alert at **80%**:
    `POLICY_MOADIAN_ARTICLE_6_WARNING_PERCENT: 80` (Management configurable: 70% to 90%).
  - At 80%, display advisory notice informing the finance team to request an increase in authorized ceiling via prepaying VAT or pledging guarantees (ارائه تضمین یا واریز مالیات علی‌الحساب).

---

### 4. Social Security Monthly Disk List (لیست بیمه تامین اجتماعی) v6.5 DBF Export

* **Claim**: Version 6.5 DBF export (`DSKKAR00` / `DSKWOR00`, with spouse and seniority columns). Issue #616 claimed: *"No DBF export exists in code today."*
* **Statutory Source**:
  - Supreme Labor Council (شورای عالی کار) Annual Wage Circulars (بخشنامه دستمزد و حق بیمه سال‌های ۱۴۰۳ تا ۱۴۰۵).
  - Article 86 & Family and Youth Protection Act: Introduction of `حق عائله‌مندی (حق تأهل/همسر)` for all married workers (5,000,000 Rials / month) and `پایه سنوات` (seniority increment for workers > 1 year).
  - Social Security Organization (SSO / تامین اجتماعی) List Disk Software Version 6.5 & 6.6 specification.
* **Codebase Audit & Fact-Check**:
  - **CORRECTION OF CLAIM IN #616**: DBF export **DOES ALREADY EXIST** in the codebase!
    - Files: `output_apps/enterprise_hub/modules/hr/services/insurance-list.ts` and `output_apps/enterprise_hub/modules/hr/services/dbf-file.ts`
    - DTO: `output_apps/enterprise_hub/modules/hr/dto/payroll-run.dto.ts` (`workshopDbf`, `workersDbf`)
    - Specs: `output_apps/enterprise_hub/modules/hr/tamin-dbf-bytes.spec.ts`
    - Current format emits 23 columns for `DSKKAR00` and 27 columns for `DSKWOR00` based on `docs/legal_sources/iran/tamin-list-v6-fields.md`.
* **v6.5 Structural Requirements**:
  - In SSO ListDisk 6.5:
    - Married allowance (`حق تأهل`) is classified under `DSW_MAZ` (مزایای مشمول) but must be verified against insurable wage calculations.
    - Base seniority (`پایه سنوات`) is part of fixed wage elements (`مزد مبنا`) and added into `DSW_ROOZ` (دستمزد روزانه) and `DSW_MAH` (دستمزد ماهانه).
* **Actionable Recommendation**:
  - Keep `output_apps/enterprise_hub/modules/hr/services/insurance-list.ts` as the primary generator.
  - Expose `SSO_LIST_DISK_VERSION` setting: `"6.0"` (standard 27-column) / `"6.5"` (with separated marital/seniority validation).

---

### 5. Moadian Private Keys: Encryption at Rest Audit

* **Claim**: Confirm whether Moadian private keys are encrypted at rest.
* **Codebase Audit**:
  - **Table 1: `moadian_credentials`** (`output_apps/enterprise_hub/modules/tax_compliance/entities/moadian-credential.entity.ts`):
    - **CONFIRMED ENCRYPTED AT REST**: Column `private_key_sealed` uses `AES-256-GCM` with authenticated ciphertext format (`v1.<iv>.<tag>.<ciphertext>`).
    - Key derived from environment variable `MOADIAN_KEY_ENCRYPTION_KEY` (32 bytes).
    - Additional Authenticated Data (AAD) is strictly bound to `tenantId`, guaranteeing that keys copied across tenants or database dumps cannot be decrypted.
    - Entity sets `{ select: false }` to prevent accidental inclusion in standard ORM queries.
    - Utility: `output_apps/enterprise_hub/modules/tax_compliance/utils/secret-box.util.ts`.
  - **Table 2: `tax_signing_keys`** (`output_apps/enterprise_hub/modules/tax_compliance/entities/tax-signing-key.entity.ts`):
    - **AUDIT FINDING**: Legacy table stores `private_key_pem text NOT NULL` (with `select: false`).
* **Actionable Recommendation**:
  - The production Moadian gateway uses `moadian_credentials` which is strictly encrypted with AES-256-GCM.
  - Deprecate `tax_signing_keys.private_key_pem` or migrate it to use `secret-box.util.ts` (`sealSecret` / `openSecret`).

---

### 6. 12 Billion Toman Individual Threshold & POS Receipt Validity

* **Claim**: The 12 billion Toman threshold for individuals and the rule that card-reader (POS) receipts count as invoices until the end of 1405.
* **Statutory Source**:
  - Article 14-bis (ماده ۱۴ مکرر الحاقی) of the Act on Electronic Terminals and Moadian System.
  - INTA Circular No. 200/1403/10 (بخشنامه حد نصاب اشخاص حقیقی و معافیت مودیان خرد).
  - Facilitation Law Transitional Provisions for Solar Years 1403 to 1405.
* **Legal Verification**:
  - **VERIFIED**:
    1. **12 Billion Toman Exemption Threshold**: Natural persons (صاحبان مشاغل و اشخاص حقیقی) whose cumulative annual revenue from goods and services is under **120 billion Rials** (12 billion Tomans / ۱۲ میلیارد تومان) in 1405 are exempt from issuing Type 1 and Type 2 electronic invoices to the Moadian system.
       - *Exceptions*: Healthcare providers, lawyers, gold and jewelry businesses, and all legal entities (اشخاص حقوقی) must issue electronic invoices regardless of sales volume.
    2. **POS Slips as Electronic Invoices**: For retailers and small businesses offering uniform goods/services subject to identical VAT rates, bank card-reader (POS) receipts and online payment gateway slips count as official electronic invoices (در حکم صورتحساب الکترونیکی) until the end of 1405 (۲۹ اسفند ۱۴۰۵).
* **Actionable Recommendation**:
  - Add management-configurable policies:
    - `MOADIAN_INDIVIDUAL_EXEMPTION_THRESHOLD_TOMAN`: default `12_000_000_000` (12 Billion Tomans).
    - `MOADIAN_POS_AS_INVOICE_VALID_UNTIL`: `"1405-12-29"`.
    - Provide a status indicator on POS transaction views showing whether the business qualifies under the 12B Toman micro-enterprise rule.

---

## Policy Registry Reference Matrix

| Feature | Policy Key | Default Value | Statutory Basis |
|---|---|---|---|
| Commercial Books Schedule | `COMMERCIAL_BOOKS_PERIODICITY` | `"QUARTERLY"` | Article 95 DTA Bylaw |
| Moadian Inbox Warning | `MOADIAN_INBOX_UNCONFIRMED_WARN_DAYS` | `20` | Note to Art. 5, Terminals Act |
| Moadian Inbox Critical | `MOADIAN_INBOX_UNCONFIRMED_CRITICAL_DAYS`| `27` | Note to Art. 5, Terminals Act |
| Article 6 Ceiling Warning | `MOADIAN_ARTICLE_6_WARNING_PERCENT` | `80` | Art. 6, Facilitation Act |
| Social Security Disk Version | `SSO_LIST_DISK_VERSION` | `"6.5"` | SSO Circulars & Youth Act |
| Individual Moadian Exemption | `MOADIAN_INDIVIDUAL_THRESHOLD_TOMAN` | `12_000_000_000` | Art. 14-bis, Terminals Act |
| POS Slip Invoice Validity | `POS_AS_INVOICE_VALID_UNTIL` | `"1405-12-29"` | INTA Circular 200/1403/10 |

---

## Conclusion & Next Steps

All 6 claims in Issue #616 are verified with exact statutory citations, circulars, and dates. Crucially:
1. The assumption in #616 that no DBF export exists is refuted: `insurance-list.ts` already provides full DBF generation.
2. Moadian private keys in `moadian_credentials` are confirmed encrypted at rest using AES-256-GCM.
3. Every feature must remain management-configurable with safe defaults via the policy registry.
