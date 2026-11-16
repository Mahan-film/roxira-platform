# Research R8 — fact-check of R4/R5 (digest)

Source: the owner's deep-research run of R8 stage 2 (self-review + decision pack), received 2026-11-16. This file is the coordinator's digest, what we adopt from it, what we reject, and the rows it adds to WAVE 15b.

**How to read the numbers.** R8 re-checked every claim against a primary source. Each one below is marked:
- **verified**: it matches an official page (URL in the report);
- **changed**: R4/R5 had it wrong or out of date;
- **unverified**: only secondary blogs back it.

Unverified numbers may go into pack config only with `verified: false`, and a pack cannot go to production while it holds one. R8 converted MYR to USD at RM 4.0951 per USD, and that rate comes from no official source, so this file keeps MYR only.

## Corrections to our earlier assumptions
- **R8 assumed Persian is a test pack and guessed the founder's country.** Both are wrong. Iran (roxira.ir) is the first market (owner decision 2026-10-31), and Malaysia is the first foreign market. Every R8 recommendation that says "switch the default to en-MY" therefore applies **per domain**:
  - roxira.ir keeps fa-IR (Jalali, IRR);
  - roxira.net sign-ups default to en-MY (Gregorian, MYR).
- **R4/R5 said there was no evidence on payroll-software approval, HRD Corp, the Sdn Bhd director rule, Labuan or § 201 StGB.** There is. See the table below.

## Facts that matter to us

| Fact | Status | Effect on us |
|---|---|---|
| MyInvois e-invoicing is mandatory for every phase ≤ RM 5M from 1 Jan 2026. Businesses **under RM 3M** are exempt (hasil.gov.my, updated 30 Aug 2026). | verified | Most 2–5 branch shops in our beachhead are exempt. Sell POS + multi-branch inventory + ledger; MyInvois is a switch, not the hook. |
| Firms under RM 3M that fail the exemption criteria (for example, a related company at RM 3M or more) start 1 Jul 2026. A new firm from YA2026 that fails the criteria starts on its first trading day. | changed | Onboarding must ask about related or holding companies. The exemption criteria text itself is unverified. |
| A single sale over RM 10,000 needs an individual e-invoice whatever the buyer asks. No backdating. Records are kept 7 years. | verified | The POS flags sales over RM 10k for an individual e-invoice. |
| A validated e-invoice can be cancelled only within 72 hours. After that, a credit note citing the original UUID is required. | secondary (SDK and guides) | The invoice state machine has a 72-hour lock, then a credit note. |
| SDK: an FX-rate field is required when the currency is not MYR. No scientific notation. State code 17. Stricter amount checks since 24 Oct 2026. | verified | The serialiser and its validator tests. |
| Penalty s.120(1)(d) ITA: RM 200 to RM 20,000 per offence, and/or up to 6 months. | verified | — |
| Consolidated batch limits (7 days, 100 documents, 5 MB, 300 KB), buyer TIN EI00000000010 and the end of the Phase 4 relaxation on 31 Dec 2027. | unverified | Pack config with `verified: false`. Confirm before production. |
| LHDN launched a free MyInvois e-POS for small businesses in 2026. | verified (its scope is not) | A free competitor at the bottom of the market. |
| Foreign digital services pay 8% SToDS above RM 500k over 12 months, on form DST-02. | verified | While Paddle is the merchant of record, Paddle collects it. It applies to us directly only if we sell without a merchant of record. |
| Domestic SaaS service tax: 8% above RM 500k, return every 2 months; F&B 6% (alcohol excluded). | unverified (the F&B threshold conflicts: RM 1.5M or RM 500k) | The MY pack tax codes need the RMCD primary text. |
| PDPA breach: notify the Commissioner within 72 h and send follow-up within 30 days. The guideline itself says both "from occurrence" and "from confirming the compromise". | verified (changed: primary pdp.gov.my documents exist) | Incident runbook: start the clock at **confirmation**, aim for 24 h internal triage. |
| PDPA: notify data subjects within 7 days; DPO thresholds; fines of RM 1M or 3 years. | unverified | Treat as likely. Do not cite to customers. |
| SOCSO wage ceiling RM 6,000 from 1 Oct 2024. | verified | — |
| EPF, EIS, LINDUNG 24 Jam (SKBBK), minimum wage RM 1,700, PCB reliefs. | unverified (sources conflict) | **No Malaysian payroll computation until primary tables are in hand.** |
| LHDN publishes a list of payroll software that matches its MTD 2012–2026 calculation spec (12 Oct 2026). | changed (it exists) | Malaysian payroll means passing LHDN's MTD spec and getting listed. That is a large job, so it is deferred. |
| HRD Corp levy is 1% of monthly wages; optional for 5–9 Malaysian staff. | changed (verified) | Pack config. |
| A foreigner may be the sole shareholder of a Sdn Bhd, but at least one director must ordinarily reside in Malaysia (s.196(4) Companies Act 2016). | changed (verified, SSM FAQ) | A Sdn Bhd needs a resident director: the owner's decision, and a cost. |
| s.39(1)(r) ITA restricts deductions for payments to Labuan companies. | changed (it exists; the 2026 detail is unverified) | Still: no Labuan. |
| EU AI Act Art. 50 (disclose the AI at first interaction) applies from 2 Aug 2026. High-risk Annex III is deferred to 2 Dec 2027. | verified | Chat and voice disclose the AI now (T150 covers voice). Keep HR/credit decisions deterministic. |
| Germany: B2B e-invoice receiving since 1 Jan 2025. § 201 StGB makes secret call recording a crime. | verified / secondary | Germany pack: recording off by default, explicit consent. Phase 2 only. |
| Google Gemini terms: **no "Preview" model in production**. EEA/UK/CH users only on paid services. | verified | `voice_realtime` has a preview fallback; see T151. The review desk's preview reviewer is internal tooling on public code, so it is not affected. |
| Gemini 3.6/3.7/3.8 Flash price doubles on **1 Jan 2027** (USD 0.75/3.75 → 1.50/7.50 per 1M). | verified | `vision`, `invoice_extraction` and the `strong` fallback use `google/gemini-3.8-flash`. Measure a cheaper primary before 1 Jan. |
| OpenRouter: Safety Retention tier (26 Oct 2026); CSAM screening on all traffic including ZDR (27 Oct 2026). | verified | Paid customer data routes with `zdr: true` and Safety Retention excluded; the sub-processor list mentions the screening. |
| Lemon Squeezy is moving into Stripe Managed Payments; its international subscriptions cost about 7% plus fees. | verified fees, secondary migration | Drop Lemon Squeezy. Paddle stays the merchant of record (Paddle fees themselves unverified). |
| Billplz: Standard RM 999 a year; its own table says FPX payout T+2. HitPay: DuitNow QR 1.2%, no monthly fee. | verified | Phase 1.5 domestic collection: Billplz + HitPay. |
| Bukku RM 0–135 a month + 8% SST, no POS and no payroll. Xero MY verified. StoreHub POS links to accounting tools but bundles none. | verified | Our offer: POS + inventory + ledger in one, priced per branch (owner sets prices). |
| LiveKit Inference voice stack: USD 0.023–0.050 a minute before telephony; no Malaysian SIP rates or Malay/Manglish accuracy data. | verified / missing | Voice stays in beta until we measure our own calls. |

## Decisions (adopted)
1. **Malaysia wedge = multi-branch POS + inventory (FIFO/BOM) + ledger + read-only assistant.** MyInvois is per-company, effective-dated pack config with four modes: `exempt`, `voluntary`, `relaxation` and `mandatory`. Malaysian statutory payroll (PCB/EPF/SOCSO/EIS/HRDF) is **deferred**. HR ships roster, shifts and attendance with a wage CSV export. This matches R5 decision 1 and only narrows it.
2. **Locale default is per domain** (see corrections). The CI screenshot gate covers both fa-IR RTL and en-MY LTR.
3. **Entity: Paddle as merchant of record first, priced in USD, then a Sdn Bhd.** The trigger and the resident-director question are the owner's (see below). No Labuan, no Lemon Squeezy.
4. **No preview model ids in product roles.** CI enforces this (T151). Builder and desk roles may keep them only on public code.
5. **Gemini Flash price move.** Before 1 Jan 2027, run the invoice OCR eval on a cheaper stable model and switch `vision` / `invoice_extraction` primaries if quality holds. The eval is `docs/eval/INVOICE_CAPTURE_EVAL.md`.
6. **Breach clock.** The incident runbook starts the 72 h at confirmation of compromise, with 24 h internal triage. It includes the JPDP form fields and the 30-day follow-up.
7. **Vector stores.** Postgres RLS does not cover Qdrant. Any collection holding tenant or user data must be queried through a wrapper that requires the tenant filter, with a spec (T153).
8. **Legal RAG freshness.** LHDN's own July 2026 Q&A still showed RM 1M five weeks before the RM 3M change. This confirms R6: as-of dates, source tier, abstention (T149). Regulator PDFs are versioned by fetch date, never overwritten.

## Rejected
- Switching the global default to en-MY (see corrections).
- Any assumption about where the founder lives, and the topic of hosting location.
- Launching Malaysian payroll or the phone agent in phase 1.

## Owner questions (default if no answer)
1. **Monthly cash cap for external spend** (LLM, voice tests, legal/tax advice). Default: what is spent today, plus nothing for company formation until there are 5 pilot letters of intent.
2. **Sdn Bhd resident director.** Will someone live in Malaysia, or do we pay a local resident director? Default: neither until Malaysian revenue justifies it; Paddle meanwhile.
3. **Privacy promise for paying customers.** Is "no training, abuse-only retention" (Google paid, OpenRouter Safety Retention) enough, or do we promise strict zero retention? Default: strict ZDR for financial and HR data.
4. **First Malaysian pilots: remote only, or a local helper for printers and opening balances?** Default: remote only, with a short list of tested printers and CSV templates.

## Still unverified (must be checked before the MY pack goes to production)
- The KWSP Third Schedule, PERKESO tables (including SKBBK and EIS) and the LHDN PCB 2026–27 spec.
- The RMCD text on domestic SaaS service tax and the F&B threshold.
- The MyInvois Specific Guideline limits and the Phase 4 relaxation scope.
- The PDPA amendment text (Act A1709) and the DPO/DPIA circulars.
- Paddle and Stripe MY fees.
- Mistral, Groq, DeepSeek and Cohere data terms from the vendors themselves.
- Malaysian SIP rates and Malay/Manglish STT accuracy. We measure this ourselves.

## Rows added (WAVE 15b)

| Lane | Task | Done when |
|---|---|---|
| L1 | **T151 No preview models in product roles** | A test (in the existing models-config test or `scripts/check_models.py`) fails CI when a non-builder role in `config/models.yaml` lists an id containing `preview`. The `voice_realtime` preview fallback is removed or moved behind a note that it is dev-only. No other model changes. |
| L1 | **T154 Breach-notice runbook** | `docs/security/INCIDENT_BREACH_NOTICE.md`: 24 h triage; the 72 h JPDP notice from confirmation; 30-day follow-up; the GDPR 72 h path for EU users; the customer notice within 24 h per the DPA draft; who does what; a form-field checklist. Docs only. |
| L3 | **T152 MyInvois mode in the MY pack** (*after #852 merges*) | The MY pack config holds effective-dated entries with a source URL and a `verified` flag for: the RM 3M exemption, the four modes, the RM 10k individual-invoice rule, the 72 h cancellation window, the consolidation limits and the FX-rate-required rule. A company setting selects the mode. Specs cover each rule. No network calls. |
| L3 | **T153 Vector-store tenant audit** | `docs/security/VECTOR_STORE_TENANCY.md` lists every Qdrant collection and every writer and reader, and whether it holds tenant or user data. For each such collection, queries go through a wrapper that requires a tenant or user filter, with a spec proving that a query without one is rejected. |

## Owner answers (2026-11-16)
1. **Spend:** as little as possible. Use the API keys we already have (key pool, free first); the owner tops up an account only when a free tier runs out.
2. **Entity:** the owner **already has a Malaysian Sdn Bhd** (food retail). Its nature of business will be changed to add software and AI services. SSM: a board resolution, then a notice within 14 days (Practice Directive 2/2017, revised 5 Aug 2026), filed by the company secretary.
   - This replaces decision 3 above. We sell in Malaysia through our own Sdn Bhd with local gateways (Billplz/HitPay) and use it as the MyInvois intermediary (R9).
   - ~~Paddle remains an option for buyers outside Malaysia only.~~ Dropped 2026-11-16: its acceptable-use policy excludes phone services and messaging (R10).
   - The resident-director question is closed.
3. **Privacy:** no special promise. Customer data may be used to run and improve the service, including AI models, as large platforms do. This must be **stated in the terms and privacy policy**: PDPA and GDPR require telling people the purposes, though not asking permission for each one. A customer who wants it gets a **private data option** (no use beyond their own service, paid models with data collection denied) as a paid add-on. This replaces decision "strict ZDR" and question 3.
4. **Authority:** the hub plans and runs the work end to end, and uses the web for missing facts.
