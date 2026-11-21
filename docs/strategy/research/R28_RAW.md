# R28 RAW: Gulf country packs (stage 1 re-check, stage 2 review, decision pack)

Date 2026-11-21. Method: WebSearch and WebFetch against regulator pages; PDFs saved and read with `pdftotext`.
Labels: VERIFIED = primary document read this session; VERIFIED-2 = two or more independent secondary sources, primary not readable;
CHANGED = earlier digest (`R14_GULF.md`) was wrong or out of date; UNVERIFIED = not confirmed from a primary source.
Blocked or unreadable: pwc.com PDF (HTTP 403), crowe.com (403), KPMG Bahrain PDFs (binary), uaelegislation.gov.ae (Arabic text, not read),
OTA Oman portal (not opened), NBR Bahrain and GTA Qatar (not opened). All items from those stay secondary.

## 1. Claim re-check table (stage 2, step 1)

| # | Claim | Source (date) | Status |
|---|---|---|---|
| 1 | KSA Wave 25: VAT-subject revenue above SAR 187,500 in any of 2022-2025; integrate with Fatoora by 1 Feb 2027; announced 24 Jul 2026 | zatca.gov.sa/en/MediaCenter/News/Pages/Wave25-E-invoicing.aspx (24 Jul 2026) | VERIFIED |
| 2 | Wave 24 threshold SAR 375,000, deadline 30 Jun 2026; ZATCA notifies waves at least 6 months ahead; Governor decision 1448-99-238 | EY tax alert 10 Aug 2026, KPMG Jul 2026 | VERIFIED-2 |
| 3 | Simplified (B2C) invoice any value; simplified for B2B only below SAR 1,000 | ZATCA E-Invoicing Detailed Guideline v2 PDF (file dated Aug 2023), s.2 and clearance section | VERIFIED (R14 said "not found") |
| 4 | Arabic mandatory on the human-readable invoice (other languages in addition); Arabic or Hindi numerals both count as Arabic | same guideline | VERIFIED. R14 cited "guideline v3, May 2026"; the file I read is v2 and the guidelines page shows no versions. v3 UNVERIFIED |
| 5 | Simplified invoices reported within 24 h; 9-tag TLV QR; standard invoices cleared in real time | same guideline | VERIFIED |
| 6 | Max 2 decimals for VAT rate and paid amounts in the validator; rounding rules for advance payments | same guideline | VERIFIED (SAR is 2 decimals) |
| 7 | Phase 1 fines: SAR 5,000 for not issuing e-invoices; SAR 10,000 for deleting or amending after issue; missing QR/buyer VAT no./malfunction notice start with a warning; fines scale with repeats | ZATCA news 16 Nov 2021 | VERIFIED (Phase 1 only) |
| 8 | Phase 2 fines (SAR 5,000 up to 50,000, ladder) | Third-party guides disagree (first fine 1,000 / 5,000 / 10,000; ceiling 40,000 / 50,000) | UNVERIFIED. Treat as config with `verified:false` |
| 9 | Security Features Implementation Standards dated 19 May 2023 is the latest on the ZATCA page; developer pages updated 10 Aug 2026 with no new version listed | zatca.gov.sa Security-Requirements page | VERIFIED (no 2026 revision seen) |
| 10 | CSID lifetimes (compliance 24 h, production about 5 years), OTP 1 h | R14 from ZATCA staff forum | UNVERIFIED this session (page lists none) |
| 11 | UAE timeline: pilot from 1 Jul 2026 (written agreement); voluntary from 1 Jul 2026; revenue >= AED 50m: ASP by 30 Oct 2026, live 1 Jan 2027; below: ASP by 31 Mar 2027, live 1 Jul 2027; government: ASP 31 Mar 2027, live 1 Oct 2027 | FTA consolidated Ministerial Decision 244/2025 as amended by 66/2026 (6 May 2026), tax.gov.ae PDF dated 2 Jul 2026; MoF news 10 May 2026 | VERIFIED. R14 had these as "secondary" |
| 12 | B2C transactions are not subject until the Minister decides; a person doing only B2C is not subject | same consolidated text, Art. 5(2) | VERIFIED (new) |
| 13 | Exclusions: sovereign government acts, airline tickets and ancillary documents, airway bills (24 months), VAT-exempt or zero-rated financial services, transactions inside one Tax Group for 24 months from 1 Jan 2027; voluntary users exempt from penalties | Ministerial Decision 197/2026 amending 243/2025, in force 1 Oct 2026 (mof.gov.ae PDF) | VERIFIED. "Until 31 Dec 2028" in R14 = 24 months from 1 Jan 2027, consistent |
| 14 | Issue and transmit within 14 business days of the transaction date | Decision 197/2026, Art. 6(5) | VERIFIED |
| 15 | UAE in-country storage rule removed; retain for the Tax Procedures Law period and be able to produce to FTA | Decision 197/2026, Art. 11 and repeal of Art. 12 | VERIFIED (R14 "secondary") |
| 16 | UAE penalties: "Cabinet Decision 173/2026: AED 5,000 per month, cap 50,000 per year; AED 100 per invoice cap 5,000 per month" | MoF page found by search describes the older Cabinet Decision 106/2025 (8 Dec 2025: AED 5,000 a month, AED 100 per invoice cap 5,000, AED 1,000 per day for late notices). Decision 173/2026 repeals it. Sovos 30 Oct 2026: AED 5,000 first then 5,000 per month, cap 50,000 per 12 months; AED 100 per invoice or credit note cap 5,000 per month; AED 250 per day notifying the ASP of data changes, cap 5,000 per month. MoF says the system-failure notice penalty was removed | CHANGED in detail, VERIFIED-2 for 173. Primary text (uaelegislation.gov.ae) not read |
| 17 | FTA reminder 25 Oct 2026 that AED 5,000 a month applies for missing the ASP deadline | via search summary of tax.gov.ae news | VERIFIED-2 |
| 18 | ASP accreditation: Ministerial Decision 168/2026 in force 1 Oct 2026 replaces 64/2025; pre-approval stage removed; providers may use third-party Peppol products and outsource, staying responsible; providers with pre-approval had 30 days to finish; 32 providers approved by May 2026 | mof.gov.ae news (Oct 2026), MoF news 10 May 2026 | VERIFIED |
| 19 | "ASP needs UAE licence, ISO 27001 and 22301, insurance, OpenPeppol membership" | R14 secondary; the MoF page lists none of these | UNVERIFIED |
| 20 | PINT AE version: R14 says v1.1; search shows v1.0.1 and v1.0.3 (mandatory 8 Apr 2026 per one source); MoF published Electronic Invoicing Guidelines and mandatory fields v1.0 on 23 Feb 2026 (about 51 mandatory elements, one source) | mof.gov.ae PDFs (not read), Comarch, KPMG | CHANGED or UNVERIFIED: store version as config, confirm against the OpenPeppol/MoF spec before coding |
| 21 | UAE VAT: mandatory registration AED 375,000, voluntary AED 187,500; 5% rate | tax.gov.ae registration pages | VERIFIED |
| 22 | UAE quarterly returns below AED 150m revenue | R14 (u.ae) | not re-checked, UNVERIFIED now |
| 23 | UAE Small Business Relief to tax periods ending on or before 31 Dec 2029; threshold AED 3m unchanged; Ministerial Decision 131/2026; news 7 Aug 2026; election on the return | mof.gov.ae news (7 Aug 2026) | VERIFIED (R14 "extension secondary") |
| 24 | Oman: Ministerial Decision 189/2026 (Gazette 9 Aug 2026) mandates e-invoicing above OMR 5m annual supplies from 1 Apr 2027, others from 1 Oct 2027; pilot taxpayers no penalties until 31 Mar 2027; the OTA FAQ still showed the old four-phase plan on 17 Aug; government phase about 2028; imports in scope per workshops | KPMG Oman (Aug 2026), Oman Observer, Zawya, Gulf News, Comarch, PwC | VERIFIED-2 (OTA site not opened) |
| 25 | Oman VAT 5%, registration OMR 38,500, voluntary 19,250, 10-year retention | R14 (verified there) | not re-checked |
| 26 | Qatar: Cabinet approved a draft e-invoicing law and regulations on 6 May 2026; not yet published; no go-live dates; reported model B2B clearance and B2C reporting; no VAT today | EY 7 May 2026, KPMG May 2026, PwC, vatupdate | VERIFIED-2 for approval; model and phasing UNVERIFIED |
| 27 | Bahrain: no official e-invoicing mandate date; NBR central-platform tender in 2023; VAT 10% since 2022 | secondary guides (Avalara, Cleartax, Flick, Zawya) | UNVERIFIED primary; "no date" is VERIFIED-2 |
| 28 | Kuwait: no VAT, none in the 2026-2030 fiscal plan, no e-invoicing; GCC excise draft decree-law approved 27 Oct 2026 | vatupdate (24 Jul 2026), PwC Q3 2026 roundup (not readable), KPMG Bahrain 8 Nov 2026 (search summary) | VERIFIED-2 |

## 2. Missed risks (stage 2, step 2; 17 listed)

1. **Rule churn.** UAE e-invoicing decisions 244 and 243 were amended in May and Oct 2026, accreditation redone (168/2026), penalties replaced (173/2026) within 6 months. Hard-coded rules will rot. Need effective-dated config and a watch list.
2. **Two modes in KSA.** Every KSA taxpayer must already do Phase 1 (generate and store, QR on simplified invoices) since Dec 2021; only wave customers need Phase 2. A pack that only has Phase 2 cannot serve the many small customers outside a wave.
3. **Certificate lifecycle.** Per-device production CSIDs expire; a missed renewal stops invoicing for that device. The ICV/PIH hash chain cannot be repaired after a gap. Needs monitoring, per-device locks and a runbook (CSID lifetimes UNVERIFIED).
4. **Customer-driven dates.** ZATCA notifies a wave 6 months ahead and the threshold keeps falling (375,000 to 187,500), so demand arrives in bursts from firms with little budget.
5. **UAE ASP dependency and price.** We cannot be an ASP; a provider's price, outage or exit hits every tenant. Need provider-neutral adapter, tenant bring-your-own ASP, and a second provider before large volume. Provider pricing UNVERIFIED.
6. **UAE business-day clock.** The 14-business-day issue limit needs a per-country working-week and holiday calendar (UAE weekend and Islamic holidays move with moon sighting). Core has none.
7. **Hijri and moon-dependent dates.** Hijri is display-only on invoices, but legal and payroll deadlines (end-of-service, holidays) can be Hijri-based; Umm al-Qura versus sighting differs by a day. UNVERIFIED rule, ask an expert.
8. **Data protection and cross-border transfer.** KSA, UAE and Qatar each have a personal-data law with transfer rules; our default hosting is outside the Gulf. UAE removed e-invoice in-country storage (verified), but personal-data law is separate. UNVERIFIED.
9. **HR module gap.** Saudization quotas, wage protection systems, end-of-service gratuity and social insurance differ per country and are usually bought together with accounting. UNVERIFIED; if HR is sold in the Gulf, it is a separate pack.
10. **Smart Judge scope.** Offering AI legal answers for Gulf law may fall under local legal-practice or licensing rules and Sharia-influenced civil law; our legal corpus is not Gulf law. Do not market the legal assistant there before an expert answer. UNVERIFIED.
11. **3-decimal currencies and rounding.** OMR, BHD, KWD use 3 decimals; KSA validator allows 2-decimal amounts; mixed rounding per document versus per line differs per authority. Depends on core T169. UAE and KSA invoices in foreign currency need the SAR/AED equivalent for VAT.
12. **UAE B2C and financial services excluded now, not forever.** The Minister can add B2C later (Art. 5(2)); KSA already reports B2C. Pack must make scope a config field, not a code path.
13. **VAT group versus legal entity.** Intra-Tax-Group exclusion is only 24 months from 1 Jan 2027; registration data must hold both the group and each member's TIN (R14 verified).
14. **Peppol onboarding of tenants.** UAE and Oman need each tenant's Peppol participant identifier and SMP registration through the ASP; offboarding a tenant must deregister. Process cost is per tenant.
15. **Liability and support.** A rejected clearance or a late invoice leads to a penalty paid by the customer; our terms and insurance must cover e-invoicing errors, and support must be Arabic-capable in Gulf hours. UNVERIFIED.
16. **Payment and billing for Gulf customers.** Local cards, mada and bank-transfer norms and SAR/AED price lists; our own VAT on SaaS sold to Gulf businesses (we may need to register or reverse-charge). UNVERIFIED.
17. **Arabic UX and fonts.** RTL, bidi mixing of Latin names and numbers, Arabic-Indic digits in print, shaping in PDF, and the QR byte-length rule (UTF-8 bytes, not characters) break easily; share the Persian RTL renderer but test with Arabic shaping.

## 3. Decision pack (stage 2, step 3)

Costs are our estimates (UNVERIFIED), agent-built, excluding legal fees.

### Option table

| Option | Description | One-off | Monthly | Effort | Reversible |
|---|---|---|---|---|---|
| A. KSA self-build first, UAE through a partner ASP second | Own adapter for ZATCA (free SDK, free simulation portal, no listing needed per R14), own PINT AE mapper, send through one ASP | 0 licence; agent build; ASP set-up may be free to low | ASP per-invoice fees passed to tenant; test accounts free | KSA about 6-8 agent-weeks, UAE mapper 3-4 | High: adapters sit behind one interface |
| B. Resell a KSA/UAE e-invoicing API provider for both | Buy a unified API, no own signing | 0 | per-invoice fee, lock-in | 2-3 weeks | Medium (migration cost) |
| C. Become an ASP | UAE accreditation, Peppol membership, ISO 27001 | high (audits, insurance) | high | months | Low |
| D. Wait for the DE pack to finish, do nothing before | Matches owner rule "product first" | 0 | 0 | 0 | n/a |

Recommendation: **A**, started only after the DE pack rows and core T169 are merged (rule from R14 and architecture decisions). C is rejected. B is the fallback for UAE only if the PINT mapper or ASP onboarding stalls.

### Recommended country order and cheapest compliant path
1. **Saudi Arabia.** Biggest SME base, a single regulator, free SDK and validator, no accreditation, no recurring third-party cost. Build Phase 1 first (generation, QR, Arabic), then Phase 2 (onboarding, signing, clearance, 24 h reporting queue).
2. **UAE.** Needs an accredited provider anyway; build the mapper and validator, integrate one ASP sandbox, keep tenant bring-your-own ASP. Pack data: VAT 5%, thresholds, Small Business Relief.
3. **Oman.** Reuse the UAE Peppol mapper (PINT OM); wait for the OTA spec; dates 1 Apr and 1 Oct 2027 (VERIFIED-2).
4. **Bahrain, Qatar, Kuwait.** Data-only packs (3 decimals, VAT or none, bilingual invoice); no e-invoice code until an official date exists. Watch list only.

### Timeline

| When | Do |
|---|---|
| Month 1 | Merge core T169 and calendar/business-day core; effective-dated Gulf pack config; Arabic and Hindi numeral rendering test; ZATCA Phase 1 mode |
| Month 3 | ZATCA Phase 2 onboarding, signing, clearance and reporting queue passing the SDK validator and simulation portal in CI |
| Month 6 | PINT AE mapper and pre-send validator; one ASP sandbox; Oman variant skeleton; first pilot tenant per country |
| Month 12 | Second ASP; Qatar or Bahrain pack only if an official go-live date exists; revisit HR/Gulf data-law items with an expert |

Revisit triggers: a new ZATCA wave notice or threshold change; any amendment to UAE decisions 243/244/173; OTA publishes the Oman spec; Qatar publishes the law in the Gazette; Bahrain NBR publishes a date; no Gulf customer asks by month 6 (then stop at KSA).

## 4. Existing rows T174-T176 (#905-#907) and what to change
(`gh` could not be queried: TLS certificate error in the sandbox; row text is from `ARCHITECTURE_DECISIONS_2026-11-16.md`.)
- **T174 Saudi Fatoora adapter.** Add a Phase 1 generation-only mode first. Add pack config for the SAR 1,000 B2B simplified ceiling and Arabic/Hindi numerals. Add a CSID expiry monitor and a runbook for a broken ICV/PIH chain. Mark CSID lifetimes `verified:false`. Split into three small PRs (onboarding, signing+QR, clearance/reporting queue).
- **T175 PINT mapper and ASP adapter.** Make the PINT version a config value (v1.0.1, v1.0.3 and v1.1 conflict). Add the 14-business-day timer, scope switches (B2C, financial services, intra-Tax-Group until 2028 end), and use the 2026 accreditation text (168/2026). Split mapper from ASP adapter. Oman dates 1 Apr and 1 Oct 2027.
- **T176 Gulf tax data.** Small Business Relief to 2029 is now verified; add UAE VAT thresholds AED 375,000 and 187,500, the 173/2026 penalty table as `verified:false` until the Arabic text is read, and Oman e-invoicing dates. Add a per-country working-week and holiday calendar and a Hijri display option. Keep QA and KW data-only; BH data-only until a date exists.
- **Order stays:** after the DE rows. The Wave 25 date (1 Feb 2027) is a market deadline, not a reason to jump the queue (owner rule).

## 5. Open questions for human experts (stage 2, step 4), with defaults

| Question | Default |
|---|---|
| Does a foreign SaaS vendor need a local entity, commercial registration or a ZATCA registration to supply e-invoicing software in KSA? | No registration needed (R14 verified ZATCA does not list solution providers); do not open an entity yet |
| Phase 2 fine schedule per violation | Show no fine amounts to customers; link to ZATCA |
| Personal-data transfer rules for hosting Gulf tenants outside the region (KSA, UAE, Qatar) | Keep EU hosting, DPA clause, ask counsel before first paying tenant |
| Whether AI legal answers for Gulf law are allowed or need local licence | Do not offer the legal assistant in the Gulf packs |
| Our own VAT position selling SaaS to Gulf businesses | Invoice without local VAT, ask an adviser before first invoice |
| PINT AE exact current version and ASP accreditation conditions | Config value, confirm with the chosen ASP |
| Hijri rule for payroll and legal deadlines | Gregorian primary, Hijri display only |
