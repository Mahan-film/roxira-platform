# R31 Gemini Deep Research (second opinion)

Pasted by the owner on 2026-11-21 (via the hub chat) and saved unchanged except that the model's internal "Thoughts" blocks are left out. This is a SECOND OPINION: the agent digest `R31_DIGEST.md` is not replaced. Both stages are kept; Stage 1 is the report, Stage 2 is the model's own review. Claims are UNVERIFIED until compared in the digest's "Second opinion" section.

## Stage 1

Billing, Subscriptions, and VAT Architecture for Selling SaaS (EU, Malaysia, and the Gulf)

For a closed-source SaaS selling subscriptions and AI features across the European Union, Malaysia, and the Gulf Cooperation Council (GCC) as of November 2026, your billing architecture depends primarily on whether you sell Business-to-Business (B2B) under reverse-charge rules or Business-to-Consumer (B2C) globally. If you sell direct through a Payment Service Provider (PSP) such as Stripe EU (1.5% + €0.25 for standard EEA cards; €0.35 flat for SEPA Direct Debit), modeled transaction costs across your first 10 to 50 customers run €9.33–€46.65/month at €19 ARPU and €32.47–€162.33/month at €99 ARPU—provided you restrict sales to EU/GCC B2B reverse charge and stay below the €10,000 annual EU cross-border B2C threshold. However, a single B2C sale into Saudi Arabia, the UAE, or Bahrain triggers a zero-threshold (nil) foreign VAT registration—with Saudi Arabia mandating a local tax representative estimated by cross-border tax guides at SAR 25,000–60,000/year—while Malaysia levies an 8% Service Tax on Digital Services (SToDS) on both B2C and B2B sales above RM500,000 over 12 months. For global self-serve B2C or mixed buyers, Paddle (5% + $0.50 Merchant of Record) is the cheapest compliant starting setup, especially following Lemon Squeezy's November 16, 2026 closure to new sign-ups ahead of its March 31, 2027 shutdown.

For per-seat and AI usage metering, avoid self-hosting AGPL-3.0 engines (Lago or Flexprice) inside or alongside customer-facing components of a closed-source SaaS due to network-copyleft source disclosure obligations. Apache-2.0 engines (OpenMeter for real-time AI token/credit metering and Kill Bill for enterprise seat catalogs) carry zero copyleft risk, though operating Kafka and ClickHouse is overkill for your first 50 customers. Start with native provider metering (Paddle or Stripe Billing) and switch to Apache-2.0 OpenMeter/Kill Bill or direct PSP processing only when margin leaks or pricing complexity cross explicit MRR and compliance triggers.

1. Payment Providers for Subscriptions: EU, Malaysia, and the Gulf

Merchant of Record vs. Direct PSPs

A Merchant of Record (MoR) legally acts as the reseller to your end user: it appears on invoices and card statements, calculates and remits global VAT/GST/SToDS under its own tax registrations, and manages chargeback disputes. A Direct PSP processes payments under your legal entity, giving you lower processing rates and direct customer relationships while leaving every foreign VAT registration, e-invoicing mandate, and dispute liability on your company.

The MoR landscape shifted abruptly on November 16, 2026, when Lemon Squeezy (acquired by Stripe in 2024) closed new store sign-ups and announced a permanent shutdown on March 31, 2027 (migration takes 4–8 weeks; recommended start by mid-January 2027). Its replacement, Stripe Managed Payments, handles payments and tax as MoR across ~35–37 merchant countries but drops Lemon Squeezy's storefront, license-key delivery, affiliate tracking, email marketing, and PayPal subscriptions, while charging a steep 3.5% MoR fee on top of standard card and Billing fees.

Provider	Model	Headline Fee	International, Subscription & FX Surcharges	Payout Schedule & Fees	Refunds & Chargebacks
Paddle	MoR	5% + $0.50 (custom >$50k/mo ~3–4% per StackFYI)	No international card surcharge; competitor/blog estimates cite 2–3% FX conversion + up to 1.5% payout FX spread (unconfirmed by Paddle)	Monthly default (queued 1st, sent by 15th; min $100); weekly by request; local bank free, $15 SWIFT	Fee kept on refunds; dispute up to $20 (20 USD/GBP/EUR, 40 CAD/AUD), kept even if won or on alerts
Stripe Managed Payments	MoR	2.9% + $0.30 (US) + 3.5% MoR fee on tax-inclusive total	+1.5% non-US card; +0.7% Stripe Billing; Adaptive Pricing FX paid by buyer (≥2%); 1.5% promo MoR fee until Dec 1, 2027 for migrating LS stores	Standard Stripe schedule (T+2 to T+7); no PayPal	Fee kept on refunds; $15 US / €20 EEA dispute
Polar	MoR	Starter: 5% + $0.50Pro: $20/mo + 3.8% + $0.40 (Sept 2026 rates)	+1.5% on all non-US cards; 0.25–1% FX; Pro beats Starter from sale #29 on a $50 order (per Dupple)	Stripe pass-through: $2/mo + 0.25% + $0.25 per payout	$15 dispute regardless of outcome; less mature B2B invoicing
Creem	MoR	3.9% + $0.40	No international card surcharge; limited local methods (cards, Apple/Google Pay)	1st & 15th; 1% bank payout ($7 min) or 2% USDC; competitor PayPro Global reports 45-day hold and absence from Mastercard's Oct 2026 RSP list	$25 chargeback
Dodo Payments	MoR	4% + $0.40	+1.5% non-US card; +0.5% subscriptions; +3% PayPal; buyer pays 2–4% FX	Free regular payouts; $5 under $1,000; $25 USD SWIFT to non-US firms	$30 dispute; $1 refund fee
FastSpring / PayPro Global	MoR	Quote-based	Effective rates typically 0.5–1.5% above headline after FX/refunds (per fintechspecs)	Custom contract	Managed dispute handling

Direct Processing in the European Union

EU interchange regulation caps consumer card interchange at 0.2% (debit) and 0.3% (credit), making direct EEA processing substantially cheaper than US rates.

EU PSP	Standard EEA Cards	Commercial & Non-EEA Cards	SEPA Direct Debit (SDD)	Subscription & Tax Tools	Payouts, Holds & Disputes
Stripe EU (DE/IE pricing)	1.5% + €0.25	EEA Premium: 2.8% + €0.25; UK: 2.5% + €0.25; Non-EEA: 3.15% + €0.25; +2% FX	€0.35 flat (Core scheme; €3.50 failed; €15 SDD dispute on IE pricing)	Billing +0.7%; Tax 0.5% Basic or €80+/mo Complete	Daily/weekly/monthly free (T+2 to T+7; 1st payout 7–14 days); instant 1–1.5%; reserves 30–90 days (120-day risk pause); EEA card dispute €20 + €20 manual counter (refunded if won)
Mollie	1.80% + €0.25	EEA Commercial: 2.90% + €0.25; Non-EEA: 3.25% + €0.25	€0.25–€0.30 (iDEAL €0.29)	Recurring API supported; plans, trials, and proration require custom build or 3rd-party tool	Up to 5 payouts/mo free under €500k/yr (€0.25 after); 1% FX payout fee (2.5–3% spread, €0.25 refund, €19–€35 dispute per Finexer)
Adyen	Interchange++ (~0.60% + €0.13 consumer EU est.)	Interchange + scheme + markup	~€0.25 (~€0.13 + bank fees est.)	External billing/tax integration	Monthly minimum invoice + volume commitments; 6–12 week build; best >€5M/yr; disputes €5–€100

On B2B invoices above €50, Stripe SEPA Direct Debit (€0.35 flat across Eurozone Stripe accounts) delivers massive savings over cards: on 400 monthly debits at €250, SEPA processing costs €1,680/year versus €19,200/year on cards. Note, however, that Stripe supports only the SEPA Core scheme (not irrevocable SEPA B2B), exposing business debits to an 8-week unconditional refund window. Also note that Stripe's January 2026 terms allow converting a rolling reserve into a fixed or upfront reserve without notice, triggered primarily by >500% month-over-month volume spikes or elevated disputes.

Direct Processing in Malaysia

Malaysia's online checkout relies on FPX (PayNet online banking), DuitNow (QR and DuitNow Pay), and e-wallets (Touch 'n Go, GrabPay, ShopeePay). Crucially, local Malaysian gateways require domestic business registration: Razorpay Curlec explicitly mandates an SSM Certificate (Borang D or E), a Director's IC, and a Malaysian settlement bank account—unregistered sole traders and foreign SaaS entities without a Malaysian subsidiary cannot onboard directly.

Malaysian Gateway	Setup / Annual Fee	Domestic Cards	Foreign Cards	FPX	DuitNow & E-Wallets	Settlement & Recurring Support
Razorpay Curlec Basic	RM0–RM99 / RM0	2.40%	3.30%	1.50% (min RM1)	DuitNow Pay 1.20% (min RM0.30); E-wallets 1.50%	T+2; recurring via cards & FPX Direct Debit; DuitNow Pay does not support recurring
Razorpay Curlec Premium	RM999 / RM0	2.00%	3.10%	1.00% (min RM1)	DuitNow Pay 1.00% (min RM0.30); E-wallets 1.30–1.50%	T+2; RM999 fee pays back after ~RM250,000 in card sales
HitPay	RM0 / RM0	1.2% + RM1	3.0% + RM1 (+2% FX)	1.8% + RM0.40	DuitNow QR 1.2%; TnG 1.9%, GrabPay 2.0%	T+1 (cards & FPX), T+2 others (Oct 2026 pricing)
Billplz	Basic RM0 / Std RM999/yr	Basic 1.80%Std 1.50%	Contact sales	Basic RM1.25 B2CStd RM0.75 B2C	DuitNow QR/Wallet 1.50%	Next business day (FPX); recurring via membership billing
Stripe Malaysia	RM0 / RM0	3.00% + RM1	Intl/FX surcharges apply	3.00% + RM1	Wallets ~2.9–3%	Standard Stripe schedule + 0.7% Billing
NTT DATA (ex-iPay88 / ADAPTIS) & Fiuu	Setup fee / Quote	Quote	Quote	40+ banks (quote)	DuitNow QR, wallets (quote)	Custom settlement; recurring APIs supported

Direct Processing in the Gulf (GCC)

In Saudi Arabia, electronic payments reached 85% of retail volume in 2025 (SAMA data), anchored by mada (SAR 197.42 billion in 2024 e-commerce). Apple mandates routing domestic Saudi debit Apple Pay payments over mada and UAE domestic debit/prepaid payments over Jaywan, while Kuwait relies on KNET and Bahrain on Benefit. Like Malaysia, local GCC gateways enforce strict local licensing: Moyasar requires a valid Saudi Commercial Registration (CR) or freelance license plus a Saudi commercial bank account, and PayTabs Saudi acquiring requires SAMA-aligned KYC and a local bank account. Foreign entities without a local GCC subsidiary generally cannot access local debit rails directly without an MoR or confirmed cross-border eligibility.

GCC Gateway	Regional Licensing & Methods	Published vs. Reported Fees	Recurring, Settlement & Integration Notes
Tap Payments	CBUAE Retail Payment Services licence (Apr 2025) + permits in KSA, Kuwait, Qatar, Bahrain, Oman; supports mada, KNET, Benefit, Apple Pay, Tabby/Tamara	Official Saudi pricing undisclosed; third-party agency blog (Logiolegion) cites ~2.85% + SAR 0.30	Supports recurring payments on mada via Apple Pay; mada & Benefit return a transaction.url redirect
Moyasar	SAMA-licensed; supports mada, Visa/MC, Amex, Apple Pay, Samsung Pay, stc pay	Official FAQ quotes on request; third-party blog (Logiolegion) cites flat 2.5%	Tokenized recurring & usage-based billing; Logiolegion reports T+1 mada and T+7–14 credit card settlement
Telr	UAE & KSA online gateway; cards, mada, Apple Pay, stc pay, Tabby	UAE: AED 249/mo (0% up to AED 9,999); AED 199/mo + 2.45% + AED 1 (AED 10k–24,999); AED 99/mo + 2.35% + AED 0.50 (AED 25k–49,999); AED 0/mo + 2.25% + AED 0.50 (AED 50k+), +0.50% intl cards. KSA: SAR 99–259/mo, cards 3.00%–2.60% + SAR 1, mada 1%, stc pay 0.90% (+15% VAT on fees)	Hosted payment links/invoices and recurring billing
PayTabs	KSA & regional; mada, Visa/MC, Apple Pay, STC Pay	Core gateway quote-based (Saudi agreement lists SAR 999 setup, SAR 199/mo, SAR 1/tx platform fee excl. acquiring & VAT); Paymes testing-phase app: SAR 49/mo, mada 1%, cards 2.25% + SAR 1	Strict SAMA data-localization & PCI DSS onboarding
HyperPay	SAMA-licensed (2025); enterprise & government focus	Quote-based (third-party blog estimates 2.5–3.5%)	Multi-acquirer routing

2. Indirect Tax and Invoicing Duties for the Vendor

Using an MoR removes your foreign VAT/SToDS registration, calculation, and filing duties. If you bill direct, you must comply with every destination regime below.

European Union: OSS, Reverse Charge, and E-Invoicing

An EU-established SaaS selling from one Member State (e.g., Germany) charges domestic VAT (19% in Germany) on cross-border EU B2C digital sales until combined EU-wide cross-border B2C turnover exceeds €10,000/calendar year. Above €10,000, destination Member State VAT applies and is declared quarterly via the Union One Stop Shop (OSS) (due April 30, July 31, October 31, and January 31; transaction records must be kept for 10 years). Non-EU sellers receive no €10,000 threshold and must register for Non-Union OSS from their first EU B2C sale.

For cross-border EU B2B digital services, the place of supply shifts to the buyer's business (§3a(2) UStG in Germany) under the Reverse Charge mechanism. You must issue an invoice without local VAT—explicitly stating "Reverse Charge" (Steuerschuldnerschaft des Leistungsempfängers in Germany) rather than marking it 0%—include both VAT IDs, and report the sale in an EC Sales List (recapitulative statement). Domestic B2B sales remain subject to domestic VAT (19% in Germany).

Invoicing duties are shifting to structured electronic formats:

1. Germany Domestic B2B (§14 UStG): Since January 1, 2025, all German businesses must be able to receive structured EN 16931 e-invoices (XRechnung XML, ZUGFeRD ≥2.0.1/Factur-X hybrid PDF/A-3, or Peppol BIS). Mandatory issuing begins January 1, 2027 if prior-year turnover exceeds €800,000, and January 1, 2028 for everyone else (unstructured PDFs require buyer consent until Dec 31, 2026, or Dec 31, 2027 if ≤€800,000). Crucially, the €250 small-value invoice carve-out (§33 UStDV) does not apply to intra-Community supplies, reverse-charge transactions (§13b UStG), or distance sales.

2. National Mandates & ViDA: Belgium, Poland (KSeF, phased 2026; smallest firms ≤PLN 10k/mo Jan 1, 2027), Greece, Croatia, and France (receiving Sept 1, 2026; SME issuing Sept 1, 2027) enacted domestic B2B mandates in 2026. Under the EU VAT in the Digital Age (ViDA) directive (adopted March 11, 2025), Single VAT Registration and mandatory reverse charge for non-established suppliers expand July 1, 2028, and July 1, 2030 introduces mandatory EN 16931 e-invoicing and digital reporting within 10 days for all cross-border intra-EU B2B sales (replacing EC Sales Lists). Pure B2C OSS sales remain excluded from B2B e-invoicing.

Malaysia: 8% Service Tax on Digital Services (SToDS) and MyInvois

Foreign SaaS providers supplying digital services to Malaysia must register with Royal Malaysian Customs (RMCD) as a Foreign Registered Person (FRP) via the MySToDS portal (Form DST-01) once Malaysian digital-service revenue exceeds RM500,000 over any rolling 12 months (historical or projected), applying by the end of the month following threshold breach. The tax rate has been 8% since March 1, 2024.

Unlike EU or GCC VAT, Malaysia's SToDS has no general B2B exemption. Any Malaysian business or individual meeting at least two of three residency criteria (payment via Malaysian financial institution, Malaysian IP or +60 phone code, or Malaysian residence) is taxed 8% as a "consumer" (only intra-group affiliate services under Regulation 5A and online distance learning are exempt). If you remain below RM500,000 and unregistered, Malaysian business buyers must self-account 8% Imported Taxable Services tax on Form SST-02 (unless qualifying for Group G B2B/intra-group exemptions); once you register as an FRP and charge 8% SToDS, the Malaysian buyer is exempted from self-accounting. Keep SToDS (consumption tax to RMCD) distinct from Malaysia's 10% income-tax withholding on cross-border royalties/technical fees remitted to LHDN.

Once registered, FRPs must issue Section 56G invoices/receipts stating supply date, FRP registration number, service description, amount payable, 8% rate, and tax charged, and file quarterly Form DST-02 returns (mandatory even for nil periods) with MYR telegraphic transfer payment by the end of the following month. Non-compliance carries penalties up to RM50,000 and/or 3 years' imprisonment. Separately, for Malaysian-established entities, LHDN's MyInvois e-invoicing exemption threshold rose on September 1, 2026 (Guideline v4.8) to RM3 million in annual revenue—though an entity loses this exemption if any non-individual shareholder, holding company, or ≥20% related entity exceeds RM3 million.

Gulf Cooperation Council: Zero-Threshold Traps and E-Invoicing

Country	VAT Rate	Non-Resident B2C Threshold	B2B Digital Services Rule	Tax Rep & Invoicing / E-Invoicing Rules (as of Nov 2026)
Saudi Arabia	15%	Nil (register from 1st B2C sale; SAR 375k is resident-only)	Reverse Charge (Art. 47) if buyer is VAT-registered; verify TIN & state reverse charge on invoice	Mandatory Saudi-based tax representative (estimated SAR 25k–60k/yr + SAR 3k–10k/return per taxdo). Resident entities subject to ZATCA Fatoora Phase 2 (UBL 2.1 XML clearance/reporting; Wave 25 >SAR 187,500 deadline Feb 1, 2027)
UAE	5%	Nil (AED 375k resident threshold excludes foreign suppliers per Lookuptax/FTA)	Reverse Charge; from Jan 1, 2026, UAE importers no longer issue self-invoices but must retain supporting docs	Ordinary FTA registration. PINT AE / Peppol e-invoicing: >AED 50M mandatory Jan 2027 (ASP appointed Oct 30, 2026); all others July 2027 (AED 100/invoice, max AED 5k/mo)
Bahrain	10%	Nil (register within 30 days of 1st B2C sale; penalty up to BHD 10,000)	Reverse Charge for VAT-registered Bahraini buyers	Simplified NBR registration exists, though guides conflict on whether a local fiscal representative is optional or required—verify with NBR before registering. E-invoicing tender in progress (Aug 2026)
Oman	5%	Non-resident registration applies per OTA e-commerce guide (resident threshold OMR 38,500)	Reverse Charge (Art. 20; 0% in qualifying Special Zones e.g. Duqm under Art. 107)	Fawtara (PINT-OM / Peppol): mandatory April 1, 2027 (>OMR 5M supplies) and Oct 1, 2027 for all others (issue within 15 days)
Qatar & Kuwait	None	No VAT implemented as of 2026	No VAT	Standard commercial invoicing

3. Usage Metering for AI Features and Per-Seat Billing

Evaluating open-source metering and subscription engines for a closed-source SaaS hinges on AGPL-3.0 vs. Apache-2.0 licensing. Under AGPL-3.0, allowing external users to interact over a network with modified or combined software triggers source-code disclosure for the whole combined work. Even if an unmodified AGPL server sits behind internal REST APIs (such as Lago's MIT-licensed Agent SDKs), exposing customer-facing usage portals, UIs, or embedded white-label components creates copyleft exposure unless you purchase a commercial license. Conversely, Apache-2.0 permits modifying and embedding billing infrastructure inside proprietary SaaS with zero source disclosure.

Engine	License	Architecture & Ops Footprint	AI Token Metering & Prepaid Credits	Per-Seat & Subscription Catalog	Closed-SaaS Verdict & Hidden Catch
OpenMeter (by Kong)	Apache-2.0	Go, Kafka, ClickHouse, PostgreSQL (+ optional Redis/Svix)	High-throughput CloudEvents (tokens, gpu_ms), real-time quotas, prepaid credits, invoice lifecycle, native Stripe Invoicing sync	Flat, per-unit, tiered, package, and dynamic pricing	Best safe OSS meter for AI, but does not parse LLM responses natively, releases are beta with breaking changes, official Helm chart is dev-only, and Kong cloud pricing is unpublished
Kill Bill	Apache-2.0 (core)	Java, SQL; 15-year enterprise track record	Pre-aggregated usage only in OSS core; raw event streaming (Aviate Metering) & Aviate Wallet require quote-only paid Aviate add-on	Most mature OSS engine for per-seat subscriptions, proration, catalog versioning, advance + arrears invoicing	Best safe OSS seat/subscription engine if you aggregate AI token counts in PostgreSQL/Redis and push batch usage sums via API
Limitr	Apache-2.0 (engine)	In-app decision & metering engine	Decides, prices, and enforces token/credit limits before an AI call executes	Works alongside billing engines	Ideal Apache-2.0 companion for pre-call AI quota enforcement
Lago	AGPL-3.0 (core); MIT (Agent SDKs)	Go, Postgres, Redis, Kafka; Docker/K8s	Native input/output/cached/reasoning token metering, idempotent transaction_id ingestion, atomic batches	Full hybrid plans (base + seat + usage + commitments)	Use Lago Cloud or commercial license for closed SaaS; customer portal, credits, entitlements, RBAC, and SSO require quote-only Lago Premium even when self-hosted
Flexprice	AGPL-3.0	Go, Kafka, ClickHouse, PostgreSQL, Temporal	Real-time metering, credit wallets with auto top-up, AI margin cost sheets, entitlements included in OSS	Hybrid plans, contract versioning, parent-child accounts	Managed cloud ($199/mo + 0.5% billed volume) avoids AGPL risk; self-hosting for closed SaaS requires strict network isolation or commercial licensing

Because running Kafka and ClickHouse introduces heavy operational drag for <50 customers, handle per-seat proration and basic AI metering natively inside Paddle Billing or Stripe Billing at launch. When AI pricing complexity or Stripe Billing's 0.7% fee outweighs engineering maintenance, deploy OpenMeter (Apache-2.0) synced to Stripe Invoicing, or Kill Bill (Apache-2.0) paired with lightweight app-side token aggregation.

4. Dunning, Refunds, Chargebacks, Tax-ID Validation, and Trial Abuse

Operational Control	Key Empirical Benchmarks & Mechanics	Required Implementation
Dunning & Revenue Recovery	A 2026 European SaaS SME estimate (Kolonell) puts annual failed payments at 5–9% of ARR. Churnkey's analysis of Stripe data (cited by Swipe Again) finds Stripe Smart Retries (default up to 8 tries in 2 weeks) recover ~51% of failures (~55% with layered precision retries), though independent B2C audits cited by Flycode report 25–35%. Smart Retries never retry hard declines (lost_card, authentication_required) or fail over to backup cards. Paddle Retain runs up to 7 retries + 4 emails over 20–30 days (~2h, ~24h, +3d, +2d, +2d + 3 silent retries). SEPA DD reduces failures <2% (2–4% typical B2B; €3.50 Stripe IE failure fee).	Set Stripe subscription behavior on failure to past_due (never cancel on 1st attempt); suppress emails during soft-decline Smart Retries while firing immediate login-free card-update links on hard declines; shift annual/EU B2B customers to SEPA DD.
Refunds	Stripe, Paddle, Mollie, Dodo, and tiun do not return original processing fees on full refunds (Stripe returns only the fixed fee on partial refunds); Mollie adds €0.25/refund (per Finexer) and Dodo adds $1/refund. On SEPA DD, buyers retain an unconditional 8-week bank reversal right (13 months if unauthorized).	Factor refund_rate × gross_fee into pricing (3% refunds on 5% MoR adds ~0.15% margin drag). Never send a proactive SEPA DD refund without confirming no bank dispute is open, to avoid double-crediting.
Chargebacks	Stripe EU: €20 received + €20 manual counter (€20 counter refunded if won; US $15 + $15; Smart Disputes 30% of won amount). Paddle: up to $20 (20 USD/GBP/EUR, 40 CAD/AUD, kept even if won, including dispute alerts), managed by Paddle. Polar: $15; Creem: $25; Dodo: $30; Mollie: €19–€35 (per Finexer). SEPA DD disputes (€15 IE) are final with zero appeal.	Enable Stripe Radar Early Fraud Warning controls (helping stay under Visa VAMP thresholds), display clear billing descriptors (warn users if LINK.COM appears via Managed Payments), and provide 1-click self-serve cancellation.
Tax-ID & Location Evidence	EU: Validate via VIES API at checkout & archive timestamped proof (VIES cannot verify historical dates); retain 2 non-contradictory location proofs under Reg 282/2011 Art. 24f (billing address, IP, bank BIN/address, SIM MCC, landline) for 10 years. UAE: Enforce 15-digit TRN starting 100 (16 digits always invalid) via FTA/EmaraTax; note FTA Decision 13/2026 (Oct 1, 2026) requiring UAE buyers to verify suppliers ≥AED 10k or >AED 100k/yr. KSA: Verify TIN via ZATCA Taxpayer Lookup.	Auto-charge destination VAT unless real-time VIES/FTA/ZATCA lookup passes. For Malaysia SToDS, log 2 of 3 residency indicators regardless of B2B status.
Trial Abuse	Stripe Radar Free Trial Abuse Control works out of the box with Checkout Sessions (subscription mode using trial_period_days, trial_end, or 100%-off coupons), blocking high-risk/prepaid/reused cards before trial activation (private preview on SetupIntents/PaymentIntents). Radar Plus/Pro ($0.05/screened tx on US pricing; new pricing notice Jan 22, 2027) adds risk scores (65+ elevated, 75+ high) and custom rules.	Require card via Checkout + enable Radar Free Trial Abuse Control; flag/block :is_disposable_email: and :card_funding: = 'prepaid'; enforce hard per-account trial AI token/API caps (pause accounts burning quotas in minutes); apply phone OTP or Stripe Identity only on VPN/datacenter-IP + disposable-email risk spikes.

5. Cheapest Setup for Your First 50 Customers and Switch Triggers

Modeled monthly total cost of ownership (TCO) for an EU-domiciled SaaS—assuming 30% non-EEA cards, 20% FX conversion, 1 USD = €0.92, and 0% SEPA on €19 plans vs. 30% SEPA on €99 plans—demonstrates that tax compliance scope, not card fees, dominates costs below 50 customers:

Customers & ARPU	MRR	Stripe Direct (EU, €0 extra tax cost)	Paddle MoR (5%+$0.50 + FX)	Polar Pro MoR ($20 + 3.8%+$0.40, 85% non-US)	Stripe + Self-Hosted OSS (€40/mo VPS, €0 extra tax)	Stripe Direct + €150/mo Tax Compliance
10 @ €19	€190	€9.33 (4.91%)	€14.86 (7.82%)	€34.27	€47.05	€159.33
25 @ €19	€475	€23.33 (4.91%)	€37.15 (7.82%)	€54.96	€57.63	€173.33
50 @ €19	€950	€46.65 (4.91%)	€74.30 (7.82%)	€89.46	€75.25	€196.65
10 @ €99	€990	€32.47 (3.28%)	€58.06 (5.86%)	€76.87	€60.59	€182.47
25 @ €99	€2,475	€81.16 (3.28%)	€145.15 (5.86%)	€161.46	€91.46	€231.16
50 @ €99	€4,950	€162.33 (3.28%)	€290.30 (5.86%)	€302.46	€142.93 (excl. engineering)	€312.33

Modeled figures from cross-provider fee simulation: Stripe Direct includes 0.7% Billing and 0.5% Stripe Tax Basic; Paddle assumes 2% FX spread on 20% of revenue and free local EUR payouts.

Recommended Starting Configurations (Customers 1–50)

1. Global Self-Serve B2C or Unverified Buyers — Use Paddle ($0/mo, 5% + $0.50): Because Saudi Arabia, the UAE, Bahrain, and the UK impose nil thresholds on foreign B2C digital services, selling direct to even one consumer outside the EU creates registration and filing costs (€150–€600+/month, or SAR 25k–60k/year for a Saudi tax representative) that dwarf payment fees. At €74.30/month (50 × €19) or €290.30/month (50 × €99), Paddle is the cheapest fully compliant stack. Avoid Polar Pro unless most buyers are US-based (avoiding its +1.5% non-US surcharge), and avoid Lemon Squeezy (closed November 16, 2026).

2. Strict B2B Reverse-Charge or Domestic-Only — Use Stripe Direct EU (€9.33–€162.33/month): If you validate VAT/TRN IDs via API at checkout (applying B2B reverse charge in EU/GCC), geo-block unverified B2C buyers in zero-threshold non-EU jurisdictions, and stay below €10,000/year EU B2C and RM500,000/year Malaysia SToDS, Stripe EU Direct (Checkout + Billing + VIES validation) cuts payment fees by roughly 37–44% versus Paddle across your first 50 customers. (If incorporated locally in Malaysia selling domestically, Billplz Basic at RM1.25 FPX / 1.80% cards or Razorpay Curlec Basic at 1.50% FPX / 2.40% cards undercuts Stripe Malaysia's 3.00% + RM1.)

Exact Triggers to Change Your Billing Setup

Migration Path	Quantitative or Regulatory Trigger	Underlying Economics / Mechanism
Paddle MoR → Stripe Direct + Tax Automation (narrow jurisdictions)	€5,154–€7,436 MRR (€150/mo tax cost); €10,308–€14,873 MRR (€300/mo); €20,617–€29,745 MRR (€600/mo)	Modeled card-only variable spread (5.4% + €0.46 Paddle vs. 3.595% + €0.25 Stripe+Billing+Tax) saves €0.55/cust (€19 ARPU), €1.09/cust (€49), and €2.00/cust (€99). Breakeven stretches to $50,000–$119,000 MRR (per StackFYI and tiun.io benchmarks) if selling B2C across dozens of non-EU nil-threshold jurisdictions requiring multi-country retainers.
Paddle MoR → Stripe SEPA DD (EU B2B tier)	50+ EU B2B customers on €99–€250+/month plans	On a €99 (€250) invoice, Paddle costs €5.41 (€12.96) before FX versus Stripe SEPA DD at €0.35 raw—or €1.04 (€2.10) including 0.7% Stripe Billing—saving €4.37–€10.86 per monthly invoice.
Direct PSP → EU OSS / Paddle MoR	€10,000/year cross-border EU B2C; RM500,000 rolling 12-mo Malaysia; 1st non-EU B2C sale in KSA, UAE, or Bahrain	Crossing €10k mandates EU OSS; RM500k mandates MySToDS 8%; the first B2C sale in KSA/UAE/Bahrain triggers immediate registration (and Saudi Arabia's mandatory tax representative) unless routed through an MoR.
Stripe Billing (0.7%) → OpenMeter / Kill Bill (Apache-2.0)	€25,000–€50,000+ MRR (or complex real-time AI credit wallets)	Raw VPS hosting (~€40/mo) beats 0.7% Stripe Billing + 0.5% Stripe Tax around ~€5k–€10k MRR, but engineering maintenance typically delays self-hosting until $25k–$50k+ MRR unless AI metering outgrows Stripe Meters.
Stripe / Mollie → Adyen (IC++)	>€5 million/year card volume (or >€100k/mo Mollie IC++)	Adyen's Interchange++ (0.6–0.9% blended on 60% SEPA / 40% EU card per Kolonell) justifies its 6–12 week integration and minimum invoices at >€5M/year; Mollie quotes custom IC++ above €100k/mo.




Sources used in the report
  Paddle, Lemon Squeezy, Polar, FastSpring, PayPro Global

  9 Merchant of Record (MoR) Providers Compared (2026)

  Merchant of record fees in 2026: what Paddle, Stripe, Polar, Lemon

  Payment processing fees compared: Stripe, Paddle, and more

  Lemon Squeezy vs Paddle Billing 2026 - StackFYI

  Cheapest Merchant of Record 2026: Fees on $10k a Month - Dupple

  FastSpring vs Stripe | Choosing the best platform in 2026 - Paddle

  "Best Paddle Alternatives in 2026: 13 Merchant of Record ... - Rework

  Saying goodbye to Lemon Squeezy

  Lemon Squeezy vs Stripe Managed Payments: What You Lose

  Lemon Squeezy Is Shutting Down: What to Do by 31 March 2027

  Lemon Squeezy Is Closing: What to Do Next (2026) | SoloBuild.io

  Lemon Squeezy Alternative When Stripe Isn't in Your Country

  2026 Update: Lemon Squeezy + Stripe Managed Payments

  E-Invoicing in Europe 2026: EU Mandates, Formats and ViDA

  EU VAT for Online Sellers in 2026: OSS, IOSS and Distance Selling

  Reverse charge in Germany in 2026: when the recipient settles VAT

  E-invoicing in the EU 2026: ViDA and national mandates - faktoora

  ViDA Explained: What It Means for E-Invoicing Across the EU & UK

  Germany e-invoicing explained - ecosio

  Germany B2B E-Invoicing Requirements Explained - Sovos

  Curlec Review Malaysia (2026): Fees, Plans and Alternatives - HitPay

  Curlec Review (2026): Fees, Features & Verdict | Airwallex MY

  Best Payment Gateway for Startups in Malaysia: A Comparison

  Curlec (by Razorpay) vs NTTDataPay (formerly iPay88)

  Payment Gateway Malaysia 2026: FPX, DuitNow & Fees

  DuitNow Pay - Razorpay Curlec

  Pricing & Fees - Stripe

  Free international Stripe fee calculator (2026): 45 countries

  Stripe Fee Calculator (2026): What You Keep per Sale, EU and US

  Subscription Payments & Recurring Billing | Moyasar

  Payment Gateways in Saudi Arabia: 4 Providers Compared - CS-Cart

  Mada and Apple Pay Integration for E-Commerce Apps in Saudi

  Best Payment Gateways in Saudi Arabia (2026): How to Choose

  Frequently Asked Questions | Moyasar

  Tap Payments Saudi - Online Payments for Small Businesses

  Telr Pricing | Payment Gateway - Expand Your Business in the UAE

  Understanding Malaysia's Sales and Service Tax (SST) - Commenda

  Malaysia E-Invoice Exemption Threshold 2026: RM3 Million - Taxilla

  Malaysia Raises E-Invoicing Exemption Threshold to MYR 3 Million

  a) What is service tax on digital services (SToDS) - MySToDS

  SST Malaysia 2026: Registration, Meaning, Exemption List and Rates

  Stripe vs Mollie vs Adyen Fees for SaaS: Dublin 2026 | Kolonell

  Process Payments On Your Website | Fees & Pricing - Mollie

  Mollie vs Stripe vs Adyen (2026): Which PSP Wins for EU SaaS?

  Mollie Pricing 2026: Full Fees Breakdown for Businesses

  Mollie vs Adyen (2026): We tried both - see who wins

  8 Best Mollie Alternatives for European Businesses in 2026

  Subscription Management & Recurring Billing Solutions - Mollie

  The Subscription Management Tools AI and SaaS Teams Are

  getlago/lago: Open Source Metering and Usage Based Billing API

  Usage-Based Billing Platforms in 2026: Own Your Pricing | Limitr

  Best Open Source Billing Tools for Subscription Monetization in 2026

  GitHub - flexprice/flexprice: Usage-based pricing and billing for

  GitHub - openmeterio/openmeter: Metering and Billing for AI, API

  AI Billing: Tokens, Credits and GPU Time - Kill Bill

  What is VIES and why should I use them? | FAQ VIES - VIES API

  Mandate News — E-Invoicing Regulatory Updates - einvoice.global

  GCC Indirect Tax News Roundup - PwC

  What Is ZATCA E-Invoicing Phase 2? Integration Explained 2026

  GCC Countries And VAT | 2026 Rates Rules Complete Guide

  Saudi Arabia VAT Guide 2026 - TaxDo

  E Invoicing Saudi Arabia: ZATCA Phase 2 Deadlines - HyperPay

  Open-source licensing and why Lago chose AGPLv3 - Getlago

  Does the AGPL apply to SaaS? - License compatibility checker

  Open Source Software Licenses 101: The AGPL License - FOSSA

  Middle East Payments Guide: mada, Apple Pay, stc pay & UAE

  Complying with regional regulations | Apple Developer Documentation

  Charges - Tap API Docs 1.0

  Tap Payments granted UAE retail payment licence, completes GCC

  How Tap Payments helps businesses scale across Mena - Gulf News

  Tap Payments MENA | Accept Online Payments | Payment Gateway

  SEPA Direct Debit on Stripe Explained - Acodei

  GoCardless vs Stripe for B2B SEPA direct debit in 2026 - Kolonell

  SEPA Direct Debit payments - Stripe Documentation

  Stripe Payment Fees Explained: Full Breakdown and Hidden Costs

  TRN Verification in UAE: How to Verify VAT Registration ... - ClearTax

  UAE VAT: Your New Duty to Verify Suppliers (FTA Decision 13)

  VAT Registration Verification - هيئة الزكاة والضريبة والجمارك

  Verify the Current VAT Registration Status of Any Business

  Stripe Holding Funds: Why Payouts Stop and How to Get Paid

  When and how do I get paid? - Help Center - Paddle

  Stripe vs Paddle: What to Know About Payout Delays - Chargeblast

  Stripe Rolling Reserve: How Long Until They Release Your Money

  Stripe Smart Retries and Adaptive Acceptance: What They Recover

  Stripe Dunning Recovery Sep 2026 | Slicker

  Stripe Smart Retries and Revenue Recovery, Explained - Swipe Again

  Retain Payment Recovery: How It Works & Retry Cadence - Paddle

  Automate payment retries - Stripe Documentation

  Guide on: Digital Services by Foreign Service Provider (FSP)

  Digital Service Tax Malaysia (SToDS) 8% Explained (2026)

  Malaysia's Service Tax on Digital Services Provided by Non

  Digital Service Tax - Malaysia Guide - ASEAN Briefing

  guide on: digital services - Moore Malaysia

  Guide to Imported Services for Service Tax in Malaysia 2026

  RCM and zero-rated services in GCC - willow.law

  VAT Treatment for SaaS and Digital Services Sold to GCC Customers

  VAT Taxpayer Guide - Electronic Commerce ('E-commerce')

  VAT on digital services supplied by non-residents - Lookuptax

  Polar vs Lago vs Stripe Billing: Open-Source Billing in 2026

  Best Chargebee Open Source Alternatives in 2026 | AnyPoss

  OpenMeter Alternative 2026: Honest Comparison for LLM Cost Control

  Limitr vs Lago: compared (2026)

  Overview | OpenMeter by Kong

  B COUNCIL IMPLEMENTING REGULATION (EU) No 282/2011 of

  Article 24f - Legislation.gov.uk

  Moyasar vs Tap vs HyperPay Fees Saudi Arabia: 2026 Guide

  Payment gateways in Saudi Arabia: fees, activation, how to choose

  Bahrain VAT on foreign digital services - vatcalc.com

  Bahrain VAT - Lovat Compliance

  Bahrain VAT guide | International taxation - Kreston Global

  Oman E-Invoicing 2027: New Rules & Key Deadlines - BDO

  Free Trial Abuse Prevention for SaaS Platforms - Stripe

  Free trial abuse prevention - Stripe Documentation

  Stripe Radar: Fraud Screening and Your Books | Acodei

  Stripe Radar Chargeback Prevention: Plans, Pricing & Rules (2026)

  Stripe's Fraud Detection and Prevention System Is Secretly Its Best

  Stripe fees in Germany (2026): every rate - PlatformDTC

  Stripe Fee Calculator 2026: Stripe Fees & Net Payout - Sellfy




Sources read but not used
  Payment Gateway Pricing Malaysia | Razorpay Curlec Fees

  Top 11 Payment Gateways in Malaysia - DSGPay

  Stripe to shut down Lemon Squeezy two years after buying it

  Blog - Lemon Squeezy Shutting Down - Michael Tsai

  It seems that LemonSqueezy is shutting down : r/SaaS - Reddit

  Mollie vs Stripe: a comparison for EU ecommerce

  Payment Solutions | Saudi Ecosystem Directory

  VAT in the Digital Age (ViDA) - Taxation and Customs Union

  E-invoicing mandate 2026: What companies need to know now - BCS

  Payment Gateway Cost in Malaysia: 2026 Fee Breakdown - Curlec

  Razorpay Curlec Adds DuitNow Pay to Online Checkout

  Curlec API — Docs, Pricing & OpenAPI | APIs.io

  Stripe fees in 2026 – what you need to know - Striptu

  Stripe Fees Explained (2026): The Real Cost per Country - TierWise

  Stripe Fees 2026: Real Costs and IC++ Comparison | RoxPay

  Stripe Fee Calculator — Exact Fees & Net Payout (2026) | Jupid

  Preisgestaltung | Stripe-Dokumentation

  Gravity Forms Moyasar Payments: Step-by-Step Setup

  Moyasar — Payment Gateway for Saudi Arabia & MENA

  Connect Moyasar on your own account - ecommerce.sa

  SST Malaysia: What small businesses need to know about Sales

  SST and e-Invoice in Malaysia: What Business Need to Know in 2026

  Malaysia's E-Invoicing Mandate: Main Updates for 2026 Rollout

  Service tax - PwC

  lhdnm-e-invoice-general-faqs.pdf

  Everything you need to know about SEPA payments - Adyen

  Adyen vs Mollie: a comparison for EU PSPs

  Lago | Cloud Billing for Usage, Subscriptions and Hybrid Pricing

  flexprice repositories - GitHub

  Automatic checking of EU VAT numbers in the VIES system in simply

  VIES – Verification and automation in cross-border e-commerce trade

  How to automatically and bulky verify EU VAT numbers in VIES?

  check - VIES API - VAT Information and Exchange System API

  VIES API - EU VAT Validation - Microsoft Marketplace

  Test Environment VAT Information & Exchange System - VIES API

  Check a VAT number (VIES) - Your Europe - European Union

  vies checker - Mehrwertsteuer-Informations- und Austauschsystem-API

  Überprüfung einer Mehrwertsteuernummer (MIAS) - Your Europe

  Digest September-October | willow.law

  2027 global VAT changes - vatcalc.com

  Payment methods in the GCC 2026: mada, Aani, KNET, Tabby

  Tap Payments - The Middle East's Fintech 50- Forbes Lists

  Tap Payments MENA | Accept Online Payments | Payment Gateway

  SEPA Direct Debit: An in-depth guide - Stripe

  Stripe fee calculator: all countries & payment methods

  SEPA Direct Debit - Stripe

  Stripe Fees Explained: Every Rate, Surcharge, and Hidden Cost

  VAT and GST Verification - Check Your Tax Registration Number

  Free VAT Number Checker and Formats by Country - Global Database

  Reserves : Stripe: Help & Support

  Stripe Holding Your Funds or Account Under Review?

  Reserves : Stripe: Help & Support

  Stripe payout schedule: daily, weekly, monthly or manual - Paycove

  Zahlungswiederholungen automatisieren | Stripe-Dokumentation

  Payments optimization - Stripe Documentation

  Stripe Decline Codes: What They Mean and How to Fix Them | Tagada

  VAT on cross-border B2B digital services - vatcalc.com

  GCC VAT and Customs rules for e-commerce - PwC

  VAT Guidelines for non-resident providers of digital and remote

  VAT in UAE: 5% Rate, Registration Threshold, Exemptions and

  Global VAT & GST on Digital Services: Complete Guide - Fonoa

  Worldwide VAT, GST and Sales Tax Guide | EY

  Lago vs OpenMeter - OpenAlternative

  10 Best Open Source Subscription Management Tools of 2026

  getlago/lago-front: Open Source Metering and Usage Based Billing

  Council Implementing Regulation (EU) No. 282/2011 - Wikipedia

  Consolidated TEXT: 32011R0282 — EN — 01.01.2019 - EUR-Lex

  chapter v - uk - place of taxable transactions

  Regulation (EU) No 282/2011 – Value added tax | LawPlayer

  Supplies of services via online platforms

  Council Implementing Regulation on supplies of goods or services

  Council Implementing Regulation (EU) No 282/2011 of 15 March

  VAT in the Digital Age - Accountancy Europe

  What are the transaction fees for Tap to Pay? - Ziina

  Most popular payment method in Saudi Arabia | NORBr

  Payment Gateways in the Gulf: mada, KNET, Apple Pay and Tabby

  Bahraini VAT rates and VAT compliance - Avalara

  Bahrain VAT guide for digital businesses - Anrok

  Worldwide VAT, GST and Sales Tax Guide | EY

  I use Stripe Radar to catch card testing before it costs me - YouTube

  Activate Stripe Radar for fraud protection in online payments

  Failed trial payments & trial hoppers : r/stripe - Reddit

  Transaction and Credit Card Fraud Prevention - Stripe Radar

  Stripe Radar and Fraud Prevention for Online Giving

  Transaction and Credit Card Fraud Prevention - Stripe Radar

  Stripe alternatives in the EU - jguillaumesio

  Stripe fees by payment method - klink.app

  SEPA Direct Debit - Stripe

  SEPA Direct Debit on Stripe: Bank debits for European customers

  Local payment methods pricing - Stripe

## Stage 2

### 1. Primary-Source Audit

Methodology note: In this audit, VERIFIED means confirmed directly by an official vendor pricing/documentation page, GitHub repository, or statutory text in the available sources; CHANGED means a primary source contradicts or materially alters the report’s figure or scope; UNVERIFIABLE means the report relied on secondary blogs, competitor comparisons, or internal modeling without a primary source in the evidence base.

Claim	Source URL	Source Date	Verdict
Lemon Squeezy closes new sign-ups Nov 16, 2026 & stops processing March 31, 2027; migration takes 4–8 weeks (start mid-Jan 2027)	https://www.lemonsqueezy.com/blog/saying-goodbye-to-lemon-squeezy	Nov 16, 2026	CHANGED / SPLIT: Nov 16, 2026 & March 31, 2027 VERIFIED; 4–8 week timeline & mid-Jan 2027 advice UNVERIFIABLE (secondary blogs only, e.g., Medium/GoodVat).
Stripe Managed Payments: 3.5% fee on tax-inclusive total + standard processing + Billing; Radar Standard included; $15 received dispute fee	https://support.stripe.com/questions/stripe-managed-payments-pricing-and-payment-methods	2026 (undated)	VERIFIED (Radar Standard confirmed in Stripe support doc; Plus/Pro extra). 1.5% promo rate until Dec 1, 2027 for migrating LS stores is UNVERIFIABLE (secondary blog only).
Stripe Managed Payments supports 35–37 merchant countries & 80+ tax-compliance countries	https://docs.stripe.com/payments/managed-payments/changelog ; https://docs.stripe.com/payments/managed-payments/tax-compliance	2026 (undated)	CHANGED: Changelog states 39 merchant countries (not 35–37). Tax docs state >80 countries, but UAE, Bahrain, Oman, and EU-27 member states do not appear in the listed tax-compliance countries.
Paddle: 5% + $0.50, no international surcharge; custom >$50k/mo (~3–4%)	https://www.paddle.com/alternatives/fastspring-vs-stripe ; https://developer.paddle.com/webhooks/adjustments/adjustment-updated	Undated	CHANGED / SPLIT: 5% + $0.50 & no intl surcharge VERIFIED, but fees apply to the tax-inclusive total . The >$50k/mo threshold & 3–4% rate are UNVERIFIABLE (StackFYI blog only).
Paddle: Monthly payouts (1st queued, by 15th, $100 min, $15 SWIFT); weekly by request; 2–3% FX + 1.5% payout spread	https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid ; https://developer.paddle.com/build/reports/payout-reconciliation	Undated	CHANGED / SPLIT: Monthly payout schedule, $100/£100/€100 min & $15 SWIFT VERIFIED. Weekly-by-request is UNVERIFIABLE (contradicted by "monthly payout schedule" in help doc). Exact 2–3% / 1.5% FX spreads are UNVERIFIABLE (competitor blogs; Paddle only confirms fx_fee column exists).
Paddle chargebacks: 20 USD/GBP/EUR (40 CAD/AUD), kept even if won & on alerts; Retain: up to 7 retries, 30d window, 1st retry ~24h	https://www.paddle.com/help/manage/risk-prevention/understanding-chargebacks-with-paddle ; https://www.paddle.com/help/profitwell-metrics/retain/how-it-works/retain-payment-recovery-how-it-works-retry-cadence	Undated	CHANGED / SPLIT: Chargeback fees & alert charges VERIFIED. Retain 7 retries & 30d default VERIFIED, but Paddle’s own doc contradicts itself on 1st retry timing (~24 hours vs ~2 hours).
Polar: Starter 5%+50¢, Pro $20/mo+3.8%+40¢, +1.5% non-US, $15 dispute; Pro beats Starter from sale #29 ($50 AOV); $2/mo+0.25%+$0.25 payout	https://polar.sh/blog/introducing-polar-plans ; https://polar.sh/features/finance	May 20, 2026	CHANGED / SPLIT: Plan rates, +1.5% non-US, and $15 dispute VERIFIED . Polar’s own breakeven vs Starter is $1,379/mo ($2,857/mo vs Early Member). Exact $2/mo+0.25%+$0.25 payout fee is UNVERIFIABLE in Polar primary docs (described only as Stripe pass-through).
Creem: 3.9%+40¢, no intl fee, 1st/15th payouts, $50 min, 1% ($7 min) bank / 2% USDC; 45-day hold, $25 dispute, not on Mastercard Oct 2026 RSP list	https://www.creem.io/blog/honest-payment-fee-breakdown-creem-vs-stripe-paddle-ls ; https://www.creem.io/comparisons/whop	2026 (undated)	CHANGED / UNVERIFIABLE: 3.9%+40¢, 1st/15th, $50 min & 2% USDC VERIFIED ; Creem’s Whop page lists EU bank payouts free, states 7–12 day payment holds , and claims "We eat the dispute" —contradicting competitor PayPro Global’s 45-day hold, $25 fee & Mastercard RSP claims (UNVERIFIABLE).
Dodo Payments, FastSpring & PayPro Global rates/fees	None (secondary blogs only)	2026	UNVERIFIABLE: No primary dodopayments.com, fastspring.com, or payproglobal.com pricing pages in evidence.
Stripe DE/EU: 1.5%+€0.25 std EEA, 2.8%+€0.25 prem EEA, 2.5%+€0.25 UK, 3.15%+€0.25 intl, +2% FX, €0.35 SEPA DD; 0.7% Billing; 0.5%/€80 Tax; €20+€20 dispute; €3.50 fail / €15 SDD dispute	https://stripe.com/de/pricing ; https://docs.stripe.com/payments/sepa-debit ; https://docs.stripe.com/billing/revenue-recovery/smart-retries	2026 (undated)	CHANGED / SPLIT: Card rates, +2% FX & €0.35 SDD VERIFIED; SDD 8-wk/13-mo dispute & no-appeal rule VERIFIED; Smart Retries 8 tries/2 wks VERIFIED. CHANGED: stripe.com/de/pricing lists Visa arbitration/CE3.0 at €20 and Mastercard arbitration at €40 (not €20+€20). 0.7% Billing, 0.5%/€80 Tax, €3.50 SDD fail & €15 SDD dispute are UNVERIFIABLE on stripe.com/de/pricing (secondary calculators/IE refs only; de/billing routes usage billing to Metronome).
Mollie: 1.80%+€0.25 EEA cons., 2.90% comm., 3.25% non-EEA; 5 free payouts/mo (<€500k/yr), €0.25 after, 1% FX payout; €0.25–0.30 SDD; 2.5–3% FX spread; €0.25 refund; €19–35 dispute	https://www.mollie.com/pricing	2026 (undated)	VERIFIED for card rates, <€500k/yr payout thresholds, and 1% non-primary-currency payout fee. UNVERIFIABLE for SDD €0.25–0.30, 2.5–3% FX spread, €0.25 refund, €19–35 dispute & all Adyen rates (third-party blogs only).
Malaysia gateways: Curlec DuitNow Pay no recurring, RM1–RM50k limit, 5–7d refunds; Curlec/HitPay/Billplz/Stripe MY MDRs & SSM rule	https://curlec.com/docs/payments/payment-methods/duitnow/pay	Undated	VERIFIED for DuitNow Pay non-recurring, RM1–50k limits & 5–7 working day refunds. UNVERIFIABLE for Curlec/HitPay/Billplz/Stripe MY MDRs & SSM rules (third-party blogs only; HitPay says Curlec Basic setup is RM99 while Airwallex says RM0).
GCC gateways: Telr UAE/KSA tiers; Moyasar CR+bank req; Tap mada Apple Pay recurring & redirect; Apple mada/Jaywan rules; Tap/Moyasar/HyperPay/PayTabs % rates	https://telr.com/pricing ; https://moyasar.com/en/resources/faqs/ ; https://www.tap.company/en-sa/products/small-businesses ; https://developers.tap.company/reference/charges ; https://developer.apple.com/documentation/passkit/complying-with-regional-regulations	2026 (undated)	VERIFIED for Telr UAE/KSA rates, Moyasar CR/bank requirement, Tap mada Apple Pay recurring & redirect, and Apple mada/Jaywan mandate. UNVERIFIABLE for Tap 2.85%+SAR 0.30, Moyasar 2.5%, HyperPay 2.5–3.5%, and PayTabs SAR 999/199/1 (secondary blogs; official pages quote on request).
EU VAT: ViDA July 1, 2028 & July 1, 2030; Reg 282/2011 Art. 24f 6 evidence items; €10k OSS threshold, 10-yr retention; DE §14 UStG (€800k, 2025/2027/2028) & §33 UStDV €250 carve-out	https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202500516 ; https://www.legislation.gov.uk/eur/2011/282/article/24f/2020-12-31/data.html	Mar 2025 / Dec 2020	VERIFIED for ViDA dates (July 1, 2028 / July 1, 2030) and Art. 24f location evidence list. UNVERIFIABLE against primary statutory texts in evidence for €10,000 OSS limit, 10-yr retention, DE §14 UStG (€800k/dates), and §33 UStDV €250 rule (secondary tax guides only).
Malaysia SToDS: RM500k threshold, quarterly DST-02, s.56G invoice, no B2B exemption, 8% rate; MyInvois RM3M Sept 1, 2026	https://mystods.customs.gov.my/about-mystods ; https://mystods.customs.gov.my/storage/app/media/pdf/guide/Guide%20on%20Digital%20Service_V2.1_01022021.pdf	Feb 1, 2021 (guide)	CHANGED / SPLIT: RM500k threshold, quarterly DST-02, 2-of-3 consumer test, s.56G invoice & item 3 exemption VERIFIED. CHANGED: RMCD V2.1 PDF still states 6%; the 8% rate (Mar 2024) & RM3M MyInvois threshold (Sept 2026) are UNVERIFIABLE against primary RMCD/LHDN texts in evidence (secondary tax blogs only) .
GCC VAT & e-invoicing: Oman 5%, OMR 38.5k resident, RCM; KSA 15% / nil B2C / SAR 25k–60k rep / Wave 25; UAE 5% / nil B2C / Decision 13 / PINT AE; Bahrain 10% / nil	https://tms.taxoman.gov.om/portal/documents/20126/1414820/VAT+Taxpayer+Guide+%28Electronic+Commerce%29.pdf/70d52b04-4177-2fe8-2d1c-836d6d831466?t=1733169614944	Dec 2024	VERIFIED for Oman 5% rate, OMR 38.5k resident threshold & RCM. UNVERIFIABLE against direct authority texts in evidence for KSA Wave 25 / SAR 25k–60k rep, UAE Decision 13 / PINT AE, Oman Fawtara 2027, and Bahrain fiscal-rep status (secondary advisory blogs; Bahrain rep requirement directly conflicts between sources).
OSS Billing & Radar: OpenMeter Apache-2.0; Kill Bill Apache-2.0 (+ paid Aviate); Lago AGPL-3.0 (+ MIT SDKs); Flexprice AGPL-3.0; Stripe Radar Free Trial Abuse; 51% Smart Retry recovery	https://github.com/openmeterio/openmeter ; https://github.com/getlago/lago ; https://github.com/flexprice/flexprice ; https://killbill.io/use-cases/ai-billing ; https://docs.stripe.com/radar/free-trial-abuse	2026 (undated)	VERIFIED for all OSS licenses, OpenMeter beta/dev-Helm caveats, Kill Bill Aviate split, and Radar Checkout auto-detection. UNVERIFIABLE against primary Stripe/Paddle sources for 51% / 25–35% recovery stats, 5–9% ARR failure rate, and $0.05 Radar price (third-party blogs only).
Section 5 TCO simulation (€9.33–€162.33 Stripe vs €14.86–€290.30 Paddle; €5.1k–€29.7k breakevens)	Internal simulation (Stage 1)	Nov 2026	CHANGED: Calculation is internally valid for its assumptions, but omits VAT gross-up (Paddle charges 5% on tax-inclusive totals , raising net drag on 19% VAT sales from 5.46% to 6.41%), omits German bookkeeping/ZM filing costs, and underprices Kafka+ClickHouse production hosting at €40/mo.

---

2. What the Report Missed (12–24 Month Failure Modes)

1. MoR & PSP Percentage Fees Apply to Tax-Inclusive Gross Totals
Why it matters: Paddle and Stripe Managed Payments assess percentage fees on the gross amount including VAT. Selling a €99 net SaaS to a German or Hungarian B2C user (19–27% VAT) means paying 5% on €117.81–€125.73, lifting effective take-rate from ~5.5% to 6.0–6.4% of net revenue and compressing gross margins on low-margin AI tiers.

2. Stripe Managed Payments Excludes Key Jurisdictions from Tax Compliance
Why it matters: Stripe’s official tax-compliance list for Managed Payments omits UAE, Bahrain, Oman, and EU-27 member states, and Stripe explicitly leaves compliance in unsupported countries on the merchant. Migrating from Lemon Squeezy to Managed Payments assuming global tax immunity creates silent audit exposure in Dubai, Bahrain, and potentially EU states unless covered by separate VAT registrations.

3. Token & Subscription Lock-In When Leaving an MoR
Why it matters: Under Paddle or Polar, the MoR owns the customer payment relationship and stored card/SEPA tokens. At $50k MRR, switching to Stripe Direct requires either a complex card-network PAN migration or forcing subscribers to re-enter cards—typically triggering 10–30% involuntary churn, echoing the 4–8 week migration scramble Lemon Squeezy sellers now face.

4. Germany’s Mandatory Outbound B2B E-Invoicing (Jan 1, 2027 / Jan 1, 2028) & No €250 Carve-Out
Why it matters: Neither Stripe Billing nor bare OSS meters natively generate compliant XRechnung XML / ZUGFeRD ≥2.0.1 invoices, and the €250 small-invoice exemption does not apply to §13b reverse-charge or intra-EU supplies . Non-compliant invoices jeopardize German B2B buyers’ input VAT deduction , causing procurement rejections on enterprise accounts.

5. 2027 GCC E-Invoicing Deadlines for Local Entities or Shared ERP Billing
Why it matters: Any future GCC subsidiary (or foreign ERP issuing Saudi VAT invoices) faces ZATCA Wave 25 (SAR 187.5k+ revenue) on Feb 1, 2027 , UAE PINT AE in Jan/July 2027 (AED 100/invoice penalty, up to AED 5,000/mo), and Oman Fawtara in April/Oct 2027. Retrofitting cryptographic XML clearance later costs SAR 9.5k–45k+ per system.

6. Malaysia 10% Withholding Tax (WHT) & UAE FTA Decision 13/2026 Supplier Vetting
Why it matters: Malaysia’s 8% SToDS is separate from LHDN’s 10% income-tax WHT on cross-border royalties/technical fees , which Malaysian B2B buyers may deduct from your payout if invoices blur software vs. services. Meanwhile, since Oct 1, 2026, UAE FTA Decision 13/2026 forces UAE B2B buyers (≥AED 10k supply or >AED 100k/yr) to collect your incorporation certificate, rep ID, and business-location proof before paying/deducting VAT .

7. Tax Calculation Tools Do Not File Returns (Hidden €300–€1,500/mo Accounting Gap)
Why it matters: Stripe Tax (0.5% / €80+/mo) only calculates rates; it does not file German UStVA, EC Sales Lists (ZM), EU OSS, or foreign VAT returns. Underestimating external filing software and Steuerberater retainers makes direct-PSP breakeven occur far above the raw payment-fee crossover.

8. Unbilled AI COGS Exposure on Arrears Usage & Prepaid Credit VAT Timing
Why it matters: Billing AI tokens in arrears lets an abusive or churning account burn real upstream LLM/GPU dollars before a hard-declined renewal fails . Conversely, switching to prepaid credit wallets raises VAT point-of-supply questions (tax at credit purchase vs. consumption) that bare metering engines do not solve.

9. Payment Rail Friction for Subscriptions (DuitNow Pay, SEPA Core Reversals, mada Redirects)
Why it matters: Curlec DuitNow Pay does not support recurring payments; mada/Benefit force browser redirects; and Stripe’s SEPA Core grants even B2B customers an unconditional 8-week bank reversal right (13 months unauthorized) with zero appeal and a €10,000 per-transaction limit —creating high chargeback/reversal exposure on annual B2B plans.

10. Single-Processor Freeze & Rolling Reserve Shock
Why it matters: Stripe’s Jan 2026 terms permit converting rolling reserves to fixed/upfront reserves without notice, and risk pauses lock funds for 120 days on sudden volume spikes (>500% MoM) . Relying on one PSP or MoR without a decoupled billing ledger leaves 100% of cash flow exposed to a single compliance review.

11. FX Treasury Mismatch Between EUR/MYR/SAR Revenue and USD AI COGS
Why it matters: Upstream LLM/cloud inference is typically billed in USD, while EU/GCC/Malaysian customers pay in EUR, AED, SAR, or MYR. Forced auto-conversion on payouts (2% on Stripe EU, 1–3% on Mollie, unconfirmed spreads on Paddle ) plus converting back to USD to pay OpenAI/Anthropic creates a silent 3–5% double-FX tax.

12. Under-Scoped Self-Hosted OSS Ops Cost & OpenMeter Beta Instability
Why it matters: Staging Kafka, ClickHouse, PostgreSQL, and Temporal for OpenMeter/Flexprice on a toy €40/mo VPS risks data loss and billing drift; furthermore, OpenMeter explicitly warns that releases are beta with breaking changes and its Helm chart is dev-only.

3. Decision Pack

Facts vs. Recommendation Summary

⚬ Factual anchor: Cross-border B2C into UAE, Bahrain, and Saudi Arabia creates zero-threshold VAT registration obligations (and a Saudi tax representative requirement), whereas verified EU/GCC B2B reverse-charge sales and sub-€10,000 EU B2C sales stay inside home-country VAT rules.

⚬ Recommendation: Adopt Option B (Stripe EU Direct + B2B-Gated Checkout + Home-Country / EU B2B Only) if >80% of early revenue is B2B or EU-focused; adopt Option A (Paddle MoR) if you run an ungated global self-serve PLG funnel with non-EU B2C buyers. Keep AI metering inside Stripe Billing/Meters or Paddle until Month 6–12—never deploy Kafka/ClickHouse for <50 customers.

Options Comparison

Dimension	Option A: Paddle MoR (Global Self-Serve B2C/PLG)	Option B: Stripe EU Direct (B2B Reverse-Charge + EU-Only B2C <€10k)	Option C: Stripe PaymentIntents + Self-Hosted OpenMeter (Apache-2.0)
One-off setup cost	€0 platform setup; ~€500–€1,500 dev time (webhook/seat sync)	€0 platform setup; ~€1,500–€3,000 dev time (VIES check, Checkout, Radar)	€0 license; ~€8,000–€15,000 dev time (Kafka/ClickHouse, plan/dunning UI)
Monthly cost (50 cust @ €19 / €99)	~€74–€85 (€19) / ~€290–€335 (€99) incl. VAT-gross-up drag	€47–€162 Stripe + €0 foreign VAT filing (add €100–€250/mo DE Steuerberater/ZM & e-invoice tool)	€40–€143 Stripe processing + €150–€400 prod infra (managed Postgres/ClickHouse/Kafka) + tax filings
Engineering & tax effort	Low: ~3–5 days integration; zero foreign VAT filings	Medium: ~1–2 weeks integration; German UStVA, EC Sales List & e-invoicing stay in-house	Very High: 3–6 weeks build + ongoing DevOps for beta metering stack & tax compliance
Reversibility	Low–Medium: Paddle owns card/SEPA tokens; leaving requires re-collecting cards or supervised migration	High: You own Stripe customer/card objects and invoice history; adding OpenMeter/Lago later is modular	High: Fully portable Apache-2.0 meter + Stripe Invoicing sync

Execution Roadmap

⚬ This Month (Weeks 1–4):

	⚬ Choose rail cleanly: If allowing global self-serve B2C sign-ups, onboard Paddle (skip Lemon Squeezy due to its Nov 16, 2026 closure). If targeting B2B SaaS, launch Stripe EU with Checkout Sessions + Radar Free Trial Abuse Control enabled.

	⚬ Enforce tax gates at checkout: On Stripe Direct, require a valid VIES VAT ID (EU B2B) or 15-digit UAE TRN (100...) / ZATCA TIN for non-EU B2B reverse charge, log 2 non-contradictory Art. 24f location proofs, and geo-block unverified B2C buyers in KSA, UAE, Bahrain, Oman, and UK (or route B2C checkout to Paddle).

	⚬ Protect AI margins from day 1: Enforce hard per-account trial token caps (pause accounts burning quotas rapidly), block :is_disposable_email: and :card_funding: = 'prepaid' in Radar, and sell AI overages via prepaid credit packs rather than uncapped arrears.

	⚬ Configure dunning: Leave failed Stripe subscriptions past_due (never cancel on attempt 1) with Smart Retries active, suppress emails on soft declines, and send login-free card update links immediately on hard declines.

⚬ Month 3:

	⚬ Audit payment failure rate, trial-to-paid conversion, and geographic revenue split (verify EU cross-border B2C stays well below €10,000 and Malaysia below RM500,000).

	⚬ Enable SEPA Direct Debit (€0.35 flat) on annual or ≥€99 EU B2B invoices (with explicit mandate acceptance and fraud checks against the 8-week Core reversal window).

	⚬ Prepare a standard UAE Decision 13/2026 vendor verification pack (certificate of incorporation, rep ID, address proof) for Gulf B2B buyers .

⚬ Month 6:

	⚬ Implement ZUGFeRD ≥2.0.1 / XRechnung e-invoice generation (via Stripe invoicing partners or a dedicated e-invoicing API) ahead of Germany’s Jan 1, 2027 (>€800k) / Jan 1, 2028 (all businesses) outbound B2B mandates .

	⚬ If running on Stripe Direct and expanding to global self-serve B2C, spin up Paddle solely for the B2C/non-EU self-serve SKU (keeping Stripe for EU/enterprise B2B) to preserve token portability on high-ACV accounts.

⚬ Month 12:

	⚬ Evaluate whether Stripe Billing (0.7%) + Tax (0.5%) + AI pricing rigidity justifies decoupling metering into OpenMeter (Apache-2.0) or Kill Bill (Apache-2.0) + app-side Redis/Postgres token aggregation.

	⚬ Add a secondary PSP / payout treasury (EUR + USD multi-currency accounts) to eliminate double-FX drag on USD AI COGS and mitigate single-provider reserve holds .

Explicit Revisit Triggers

Trigger	Action
EU cross-border B2C hits €7,500 YTD (75% of €10k cap)	Register for Union OSS via BZSt (takes effect next quarter) or route EU B2C to Paddle before crossing €10,000.
First unverified B2C sale in KSA / UAE / Bahrain / UK	Immediately block B2C checkout in nil-threshold countries on Direct PSP or switch that geo to Paddle MoR.
Malaysia rolling 12-mo revenue hits RM375,000 (75% of RM500k)	Prepare Form DST-01 MySToDS FRP registration (or shift Malaysian traffic to MoR) before breaching RM500,000.
Paddle MoR MRR >€15,000–€25,000/mo with >70% EU/US B2B	Migrate new B2B sign-ups to Stripe Direct + SEPA DD (grandfathered Paddle cohort runs down naturally to avoid forced-migration churn).
MRR >€30,000–€50,000/mo OR Stripe Billing >€500/mo with complex AI credits	Deploy OpenMeter (Apache-2.0) or Kill Bill (Apache-2.0) synced to Stripe Invoicing.
Single-PSP card volume >€400k/mo (>€5M/yr)	Negotiate Stripe/Mollie IC++ or onboard Adyen IC++ + dual-PSP failover.

4. Open Questions for Human Experts (with Immediate Defaults)

1. German Steuerberater / Indirect Tax Counsel:

	⚬ Question: Under our exact GmbH/UG setup, do prepaid AI credit top-ups constitute single-purpose or multi-purpose vouchers for German VAT/OSS timing, and does our billing tool satisfy GoBD + §14 UStG ZUGFeRD/XRechnung archiving? Also verify whether EU-27 and UAE/Bahrain/Oman exclusions in Stripe Managed Payments’ documentation reflect live product limits or partial documentation.

	⚬ Default to use now: Treat prepaid AI credits as taxable at time of top-up/purchase in the customer’s VAT jurisdiction (unless single-use statutory rules dictate otherwise), archive all PDFs/XMLs for 10 years, and do not rely on Stripe Managed Payments for UAE/Bahrain/Oman or EU VAT immunity.

2. EU / German IP & Open-Source Legal Counsel:

	⚬ Question: If we later self-host Lago or Flexprice (AGPL-3.0) strictly behind an internal microservice while building our own proprietary customer billing UI (never exposing Lago’s UI or modifying Lago), does our legal team accept zero-copyleft exposure for our closed SaaS?

	⚬ Default to use now: Prohibit AGPL-3.0 self-hosting in our architecture; standardize exclusively on Stripe/Paddle native billing now and Apache-2.0 (OpenMeter or Kill Bill) when decoupling.

3. Malaysian & GCC Local Tax / Corporate Counsel:

	⚬ Question: (a) For Malaysia B2B SaaS, how should contracts and invoices be worded so customers do not misclassify automated SaaS subscriptions as technical services subject to 10% WHT ? (b) For Bahrain non-resident B2C registration, does NBR currently mandate a local fiscal representative (conflicting secondary sources)? (c) When will UAE FTA require PINT AE e-invoicing for foreign vs. resident suppliers below AED 50M?

	⚬ Default to use now: On direct contracts, label the product strictly as standardized, automated off-the-shelf SaaS with no bespoke customization, block all non-VAT-registered B2C sales in Bahrain, KSA, UAE, and Oman on direct rails, and route any non-EU B2C demand through Paddle.




Sources used in the report
  Understanding Chargebacks with Paddle - Help Center

  Payout reconciliation reports | Paddle Developer Docs

  adjustment.updated | Paddle Developer Docs

  Managed Payments - Stripe Documentation

  Tax compliance - Use Managed Payments - Stripe Documentation

  Managed Payments eligibility - Stripe Documentation

  How Managed Payments works - Stripe Documentation

  Managed Payments changelog - Stripe Documentation

  Finance & Payouts - Polar

  Council Directive (EU) 2025/516 of 11 March 2025 amending

  Managed Payments pricing - Stripe Support

  Stripe Managed Payments Pricing and Payment Methods

  Pricing & Fees - Stripe

  Block payments from tax-unsupported countries using Radar : Stripe

  Pricing - Polar

  Fees - Polar

  Introducing Polar Plans

  Honest payment fee breakdown: Creem vs Stripe, Paddle, LS

  7 Best Stripe Competitors & Alternatives for Selling Software - Creem

  Creem vs Whop 2026: Payment Infrastructure, Not a Marketplace

  Payouts - Creem




Sources read but not used
  Getting to Know the Disputes Report - Help Center - Paddle

  Get a transaction to update payment method - Paddle Developer

  How to reduce your chargeback rate - Paddle

  List adjustments | Paddle Developer Docs

  Adjustment reports | Paddle Developer Docs

  Adjustment line item reports | Paddle Developer Docs

  Preise und Gebühren - Stripe

  Klarna payments - Stripe Documentation

  Supported currencies - Stripe Documentation

  Adaptive Pricing | Stripe Documentation

  Billie payments | Stripe Documentation

  Managed Payments : Stripe: Help & Support

  Your Merchant of Record Provider | Stripe Managed Payments

  Treasury: Pricing and fees - Stripe Support

  Which invoices will I receive for Managed Payments transactions?

  Understanding Tax inclusive and Tax Exclusive pricing with

  Payment method configurations for Managed Payments : Stripe

  Migrate from Lemon Squeezy - Polar

  Why Polar is the best way to monetize your software

  Polar — A billing platform for the intelligence era | Polar

  Polar vs Lemon Squeezy

  Polar vs Stripe

  Payment Gateway Fee Calculator | Compare Stripe, Paddle ... - Creem

  Paddle Pricing: The Real Cost After Fees - Creem

  Payhip vs Gumroad: Fees, Tax and Payouts Compared | Creem

  Stripe vs Paddle Fee Comparison 2026 | Payment Gateway Calculator

  Whop Fees Explained: What Sellers Actually Pay in 2026 | Creem
