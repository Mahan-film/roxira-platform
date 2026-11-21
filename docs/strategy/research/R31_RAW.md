# R31 RAW: billing, subscriptions and VAT for selling Roxira itself

Date 2026-11-21. Agent research with WebSearch/WebFetch. Labels: VERIFIED = primary page read today (URL given);
VERIFIED-2 = two or more secondary sources, primary blocked or not read; UNVERIFIED = not confirmed; CHANGED = differs from older docs.
Blocked today: PwC Malaysia tax booklet (403), Wolters Kluwer MY (403), Deloitte taxathand (WAF), KPMG budget PDF (encrypted), Paddle help fee pages (404 on one URL).
Scope: mechanisms and costs only. No price recommendations (owner decision).

## STAGE 1

### 1. Payment providers (fees as published 2026-11-21)
| Provider | Model | Fees | Payouts | Coverage / notes | Status |
|---|---|---|---|---|---|
| Stripe (Malaysia account) | Direct, we are seller | Cards and FPX 3% + RM1.00; international cards +1%; currency conversion +2%; Billing 0.7% of billing volume; no monthly fee | Standard payouts free (rolling/weekly/monthly); instant 1% (min RM2) | Dispute RM90 (refunded if won); Stripe Tax not listed on the MY page | VERIFIED https://stripe.com/en-my/pricing |
| Stripe Tax | Add-on | 0.5% of tax collected (no-code) or EUR 0.45/txn (API); Tax Complete from EUR 80/month; Stripe registers non-EU businesses for non-Union OSS | n/a | Tax Basic has no registration/filing. Prices seen on the German locale page in EUR; MY-locale price not shown | VERIFIED (de-my) https://stripe.com/tax/pricing |
| Stripe Managed Payments | Stripe is merchant of record (via Link) | +3.5% per successful transaction on top of standard fees; no setup/monthly | "up to 4x faster than monthly" | 80+ tax countries, 35 categories, SaaS covered. Is Malaysia an eligible seller country? Not stated | VERIFIED fee; eligibility UNVERIFIED https://stripe.com/en-my/managed-payments |
| Paddle | Merchant of record | 5% + 50 cents per checkout; no monthly fee; products under USD 10 need custom pricing | Monthly, payment sent by the 15th; default minimum USD 100 (settable up to 100,000); cross-currency wire fee 15; FX margin up to 1.5% if payout currency differs | Malaysia not on the unsupported-seller list (sanctions list only). Chargeback fee 20 (USD/GBP/EUR), not refunded when won | VERIFIED https://www.paddle.com/pricing ; payout and chargeback pages found via search (paddle.com/help/manage/get-paid/..., .../risk-prevention/understanding-chargebacks-with-paddle) |
| Polar | Merchant of record, open-source project | 4% + 40 cents; payout cost via Stripe Connect Express (USD 2/month active + 0.25% + 0.25 reported by one source) | Stripe Connect Express | Payout countries listed include Malaysia, Saudi Arabia, UAE, Germany; sales allowed globally except sanctioned countries | VERIFIED coverage https://polar.sh/docs/merchant-of-record/supported-countries ; fee detail VERIFIED-2; licence UNVERIFIED |
| Lemon Squeezy | MoR, owned by Stripe since Jul 2024 | 5% + 50 cents (third-party reports) | unknown | Being folded into Stripe Managed Payments (announced Jan 2026 per a competitor blog). Do not build on it | UNVERIFIED |
| HitPay (Malaysia) | Local gateway, direct | Domestic cards 1.2% + RM1 (also recurring); FPX flat RM2.50; DuitNow 1.2%; international cards 3% + RM1 + 2% FX; no monthly fee | FPX/cards T+1 business day; wallets T+2 | Custom rates above RM50k monthly volume | VERIFIED https://www.hitpayapp.com/my/pricing |
| Tap / Moyasar / PayTabs (Gulf) | Local gateways | Fees not published reliably; mada merchant fee cap disputed between sources | n/a | Tap and Moyasar advertise mada/Apple Pay recurring; foreign-company onboarding not confirmed. Stripe is available in the UAE; Saudi availability not confirmed; Stripe does not route mada | UNVERIFIED |

Cost reading (formulas only): Stripe card path for an international card with conversion is about 3% + 1% + 2% + 0.7% = 6.7% + RM1 before tax work; Paddle is 5% + 0.50 and includes tax. A local MY card or FPX through HitPay is far cheaper (1.2% + RM1 or RM2.50).

### 2. VAT and service tax
EU, supplier outside the EU (our Sdn Bhd):
- Non-Union OSS: for suppliers with no place of business in the EU, B2C services, one registration in one Member State, quarterly returns. VERIFIED https://vat-one-stop-shop.ec.europa.eu/one-stop-shop_en . Optional.
- The EUR 10,000 threshold applies only to suppliers established in a single Member State and only to cross-border B2C telecom/broadcasting/electronic services and intra-EU distance sales. A non-EU supplier cannot use it. VERIFIED same page. (A supplier established outside the EU with an EU fixed establishment also cannot.)
- B2B reverse charge (customer self-accounts, vendor invoice carries the reverse-charge mention and customer VAT id): standard VAT Directive rule; primary text not re-fetched today. UNVERIFIED (known law).
- VIES validates EU VAT ids; Malaysia not covered. VERIFIED (page outline only) https://ec.europa.eu/taxation_customs/vies/ . API terms not read.
- ViDA (Directive 2025/516): 1 Jan 2027 single-registration changes, 1 Jul 2028 platform rules, 1 Jul 2030 cross-border digital reporting. VERIFIED-2 (Commission adoption news + law-firm notes); R13 already records it. Germany domestic e-invoice issuing from 1 Jan 2027/2028 (R26) concerns German-established issuers; whether a Malaysian vendor invoicing a German SME must send XRechnung/ZUGFeRD: UNVERIFIED, expert question.
- Consumer law (B2C only): withdrawal button (Directive 2023/2673, new Art. 11a CRD) applies from 19 Jun 2026 to online contracts with a withdrawal right, including non-EU traders targeting EU consumers. VERIFIED-2 (law-firm notes), national transposition uneven.
Malaysia:
- Foreign digital service providers: register once Malaysian turnover exceeds RM500,000 in 12 months; rate 8%; quarterly returns; MySToDS form DST-01. VERIFIED-2 (EY, Crowe, vendor guides; PwC booklet 2026/27 seen only in search snippet). Official MySST page lists the "Service Tax (Digital Services) (Amendment) Regulations 2026" dated 27-10-2026 (VERIFIED listing https://mysst.customs.gov.my/sst-regulations/); content (P.U.(A) 371/2026, effective 28 Oct 2026, weekend/holiday due dates do not roll over) is VERIFIED-2 from one tax-news site only.
- Our own Sdn Bhd selling domestically: whether the SaaS is a taxable service, at what rate and threshold. RMCD IT-services guide revised 26 Feb 2026 (Bahasa Malaysia); one summary says separately sold software is a taxable service. UNVERIFIED. Rates: 8% general, 6% some categories (VERIFIED-2).
- Stripe no longer charges service tax on processing fees to MY accounts since 1 Sep 2022. VERIFIED https://support.stripe.com/questions/stripe-service-tax-for-accounts-in-malaysia (search snippet).
Gulf (non-resident e-services):
- UAE: 5%, no registration threshold for non-resident e-service providers, normal FTA registration, no simplified regime. VERIFIED-2 (Avalara, vatcalc, advisers); FTA page not read.
- Saudi: 15%, no threshold for non-residents, local agent not required; non-residents reported exempt from Fatoora integration. VERIFIED-2 and the trigger (first supply vs 30 days) conflicts. ZATCA not read.
Vendor invoicing duties (what our invoice must carry): supplier legal name and address, customer name, date, sequential number, description, net, rate, tax, total, customer VAT id for reverse charge plus the mention, currency and FX rate where tax is in another currency. These mirror the EN 16931 core; list is general knowledge, UNVERIFIED against Article 226. Credit notes for refunds.

### 3. Metering and billing engines (licences for a closed SaaS)
| Option | Licence | Fit | Status |
|---|---|---|---|
| Postgres `usage_events` + monthly rollup in our own code | ours | Cheapest, no new service | design |
| Stripe Billing meters | vendor service | Zero build if Stripe is the biller | UNVERIFIED (docs not read) |
| OpenMeter | Apache-2.0 | Event ingestion and limits, invoices; heavier stack (assumed Kafka/ClickHouse, UNVERIFIED) | VERIFIED licence https://github.com/openmeterio/openmeter |
| Kill Bill | Apache-2.0 | Full subscription billing, usage, dunning, tax plugins; Java, large; Aviate is the paid edition | VERIFIED licence https://github.com/killbill/killbill |
| Lago | AGPLv3 core (SDKs and MCP MIT); premium features paid | AGPL fails our permissive-only runtime rule | VERIFIED https://github.com/getlago/lago |
| Flexprice | AGPLv3 (vendor claim) | same exclusion | VERIFIED-2 |

### 4. Dunning, refunds, chargebacks, tax id, trial abuse
- Stripe Smart Retries is on by default for new accounts: up to 8 retries in 2 weeks, configurable; hard declines (lost, stolen, authentication_required...) are not retried until a new payment method arrives; end state choices: cancel, unpaid, past_due, pause. VERIFIED https://docs.stripe.com/billing/revenue-recovery/smart-retries . Cost of Smart Retries not stated on the page: UNVERIFIED.
- Stripe dispute RM90, Paddle 20: both lost if the dispute is lost; Paddle's fee also not returned on a win.
- Visa VAMP: excessive threshold 1.5% in Asia-Pacific/EU/US from 1 Apr 2026 (needs at least 1,500 events a month); Mastercard moves to GMAP on 1 Apr 2027. VERIFIED-2 (Visa fact sheet via snippet, Checkout.com, others). With 50 customers the ratio is noisy, but a processor can still reserve or close an account after a few disputes.
- Tax id: VIES for EU ids (no Malaysia). For Malaysian business customers the MyInvois TIN check exists (R27). Treat a failed or unavailable check as B2C-with-tax until fixed, never as reverse charge.
- Trial abuse: require a payment method for trials, one trial per tax id/domain, disposable-email block, hard cap on free LLM tokens (Gemini API price doubling on 1 Dec 2026 and 1 Jan 2027, R26).

### 5. Cheapest setup for the first 50 customers
Path A (Malaysia first): invoices from our own ledger, FPX/DuitNow/card via HitPay or Stripe MY, SST status settled by an adviser, tax-inclusive or exclusive per adviser. Path B (German SMEs, B2B only): Paddle as merchant of record (no EU registration, no reverse-charge handling by us) OR Stripe direct with VIES check and reverse charge (no EU registration for pure B2B is expected but UNVERIFIED). Path C (Gulf): Stripe UAE if we have a UAE-resident entity, otherwise MoR; Saudi via MoR only until confirmed. Keep a provider interface so A, B and C share one subscription and entitlement model.

## STAGE 2: skeptical review

### 2.1 Claim table
| Claim | Source | Date | Verdict |
|---|---|---|---|
| Stripe MY cards/FPX 3% + RM1, Billing 0.7%, dispute RM90 | stripe.com/en-my/pricing | 2026-11-21 | VERIFIED. Earlier search snippet "Billing +0.5%" (UK) is a different region |
| Paddle 5% + 50c, custom for under USD 10 | paddle.com/pricing | 2026-11-21 | VERIFIED. A search summary said invoicing also needs custom pricing; the fetched page does not list a fee for invoicing: UNVERIFIED either way |
| Paddle chargeback fee | help article | found via search | CHANGED: 20, not the 15 a blog implies; 15 is the wire fee |
| Stripe Managed Payments +3.5% | stripe.com/en-my/managed-payments | 2026-11-21 | VERIFIED; Malaysia eligibility UNVERIFIED |
| Non-Union OSS quarterly, EUR 10,000 only for EU-established | vat-one-stop-shop.ec.europa.eu | 2026-11-21 | VERIFIED |
| MY digital services RM500k and 8% | commentary | 2019-2026 | VERIFIED-2; official guide not read |
| 2026 MY amendment content and effective date | one tax-news site | 2026-10-27 | UNVERIFIED (listing itself VERIFIED) |
| OpenMeter Apache-2.0, Kill Bill Apache-2.0, Lago AGPLv3 | GitHub repos | 2026-11-21 | VERIFIED. Lago premium parts proprietary |
| HitPay fees | hitpayapp.com/my/pricing | 2026-11-21 | VERIFIED |
| Gulf non-resident rules | Avalara/vatcalc | 2024-2026 | VERIFIED-2 only |
| R5 plan "start with Paddle, no tax registration day one" | R5 digest | 2026 | Still plausible; Paddle acceptable-use review of an AI legal assistant not checked: UNVERIFIED risk |

### 2.2 Missed risks (12-24 months)
1. First customer is an owner-run retailer: a related party. Arm's-length invoicing and group rules (R27: the MyInvois exemption is lost if a related company has RM3m+ turnover) can make our own e-invoicing mandatory.
2. Paddle or Stripe may reject or restrict an "AI legal assistant"; MoR acceptable-use lists often exclude regulated advice. A refusal on day one has no fallback unless the provider interface exists.
3. Account holds and reserves for a new SaaS account with little history; payout delays hurt a tiny cash balance.
4. FX: EUR customers paid into MYR cost 2% conversion (Stripe) or up to 1.5% (Paddle payout margin); margin math must include it.
5. Our own purchases: Paddle/Stripe fees may be imported services for our Sdn Bhd; treatment not checked.
6. SST: whether our domestic SaaS is taxable and the registration moment; wrong guess means back-tax.
7. B2C consumers in the EU bring withdrawal rights, the withdrawal button and tax-inclusive pricing; a B2B-only terms-of-service and VAT-id gate removes most of this, but only if enforced.
8. VIES outage or invalid id: a rule is needed (treat as taxable) plus a re-check job; sole traders without VAT id are consumers.
9. Gapless invoice numbering, credit notes after the return period, and invoice retention (R14/R13 retention per pack apply to us as vendor too).
10. EU Data Act: no switching charges from 12 Jan 2027 (R26); annual prepay refunds and full export must be designed in.
11. AI cost abuse: free or flat plans with LLM use; price changes from model vendors (Gemini 1 Dec 2026) break margins; per-tenant caps are a billing feature, not an afterthought.
12. Webhook correctness: duplicates, out-of-order events, replay; entitlements must be derived from stored state, not from the last event.
13. Public repo: provider keys only in environment; Stripe restricted keys and webhook secrets rotated; test-mode fixtures contain no real data.
14. Chargeback ratio with few customers: one dispute can look like several percent; keep a descriptor, clear cancellation and refund policy.
15. Gulf: UAE e-invoicing phase 1 date (1 Jan 2027, R14) and whether a non-resident registrant is in scope: UNVERIFIED.
16. Provider concentration: Lemon Squeezy being folded into Stripe shows MoR products change; contracts and APIs move.

### 2.3 Decision pack
| Option | One-off | Monthly | Effort | Reversibility |
|---|---|---|---|---|
| A. Stripe direct (MY account) + HitPay for MY local rails + own invoices | adviser USD 100-300 (R27 O2) + about 8 agent-days | no fixed fee; per-txn fees above; optional Stripe Tax Complete from EUR 80 | medium, we own tax logic | high: customers and plans re-importable |
| B. Paddle MoR for EU/global, HitPay/Stripe for MY | about 3 agent-days for the second provider adapter | 5% + 0.50 per sale only | low tax effort | medium: Paddle says data can be migrated; invoices stay under their name |
| C. Stripe Managed Payments | unknown | 3.5% + standard fees | low | UNVERIFIED eligibility; skip until Malaysia eligibility is confirmed |
| D. Kill Bill / OpenMeter self-hosted | high (ops, Java or Kafka) | server cost on a 16 GB budget | high | not for 50 customers |
Recommendation: provider interface first; start with A for the Malaysian customer and B for German SMEs; metering in Postgres; no AGPL engine; owners choose prices.
- Month 1: adviser answers, provider interface, Stripe test mode, usage_events table, tax-treatment decision table.
- Month 3: Paddle sandbox, dunning and refund flows, invoice and credit-note generator, first paying MY customer live.
- Month 6: first German SME on Paddle (or Stripe + VIES), withdrawal-button and B2B-gate review, chargeback runbook.
- Month 12: review fee delta vs compliance cost; Gulf entry only after expert answers.
Revisit triggers: 50 paying accounts; first provider refusal or hold; first non-card payment demand (SEPA, mada); first consumer customer; MY digital or domestic threshold approaching 70% of RM500k; Paddle custom-pricing eligible volume; Stripe Managed Payments confirmed for MY.

### 2.4 Open questions for experts (default in brackets)
1. Is our SaaS a taxable service under MY service tax and when do we register? [register only at threshold, charge nothing before, adviser confirms]
2. Does a related-party first customer change our e-invoice exemption? [assume mandatory, R27]
3. Does a Malaysian vendor selling B2B to German SMEs need any EU registration or German e-invoice format? [no registration, send PDF with reverse-charge mention, plus XRechnung if a customer asks]
4. Does Paddle accept an AI legal-information product from a Malaysian company? [ask in writing before building]
5. Is Stripe Managed Payments open to Malaysian sellers? [no until confirmed]
6. Gulf: does a non-resident registrant fall into UAE e-invoicing phase 1, and can a foreign company open Tap/Moyasar? [MoR only]
7. Are exports of SaaS from our Sdn Bhd zero-rated for MY service tax? [assume yes, confirm]
