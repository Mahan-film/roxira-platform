# R31 DIGEST: billing, subscriptions and VAT for selling Roxira

Date 2026-11-21. Full report: `docs/strategy/research/R31_RAW.md`. VERIFIED = primary page read today; VERIFIED-2 = two or more secondary sources; mechanisms and costs only, prices are the owners' call.

## Verified facts
- Stripe Malaysia: cards and FPX 3% + RM1; international cards +1%; conversion +2%; Billing 0.7%; no monthly fee; dispute RM90; payouts free. VERIFIED stripe.com/en-my/pricing.
- Stripe Tax: 0.5% of tax collected (no-code) or EUR 0.45/txn; Tax Complete from EUR 80/month; Stripe registers non-EU firms for non-Union OSS. VERIFIED (German-locale page).
- Paddle (merchant of record): 5% + 50c, no monthly fee, under USD 10 custom; payout monthly by the 15th, USD 100 minimum, cross-currency wire fee 15; chargeback fee 20 not refunded. Malaysia is not on its unsupported list. VERIFIED.
- Stripe Managed Payments (Stripe as merchant of record) adds 3.5% on top of Stripe fees. VERIFIED.
- HitPay Malaysia: domestic cards 1.2% + RM1 (also recurring), FPX RM2.50, T+1 payouts, no monthly fee. VERIFIED.
- EU non-Union OSS: for suppliers without an EU establishment, B2C services, one Member State, quarterly. The EUR 10,000 threshold is only for EU-established suppliers, so we cannot use it. VERIFIED (Commission OSS page).
- Licences: OpenMeter Apache-2.0, Kill Bill Apache-2.0, Lago AGPLv3 core (excluded), Flexprice AGPL (VERIFIED-2). VERIFIED (GitHub).
- Stripe Smart Retries default: up to 8 retries in 2 weeks; hard declines not retried. VERIFIED.
- MY digital services (foreign providers): RM500k in 12 months, 8%, quarterly; MySST lists a 2026 amendment dated 27 Oct 2026. VERIFIED listing; content VERIFIED-2.
- EU withdrawal button (Directive 2023/2673) applies from 19 Jun 2026, also to non-EU traders selling to consumers. VERIFIED-2.
- Visa VAMP excessive threshold 1.5% from 1 Apr 2026; Mastercard GMAP 1 Apr 2027. VERIFIED-2.

## Decisions proposed (hub view)
1. Build a provider interface (plan, subscription, entitlement, invoice) before any provider code; adapters for Stripe and Paddle.
2. Malaysian customer: own-ledger invoices, FPX/DuitNow/card via HitPay or Stripe MY; no new vendor needed.
3. German SMEs: sell B2B only, gate on a VIES-valid VAT id, Paddle as merchant of record by default (we owe no EU tax registration); Stripe direct is the fallback.
4. Metering: Postgres `usage_events` plus monthly rollup and per-tenant caps. No Lago/Flexprice (AGPL); OpenMeter or Kill Bill only if volume demands.
5. Dunning: Stripe Smart Retries defaults, 14-day grace, then read-only, then suspend; refunds always as credit notes.
6. Gulf: merchant of record only until experts confirm local onboarding.

## Owner decisions needed
- O1: Which provider mix for the first German SME (default: Paddle, accept 5% + 50c).
- O2: Refund and trial policy (default: card required for trial, 14-day refund for B2B annual plans).
- O3: Pay the adviser (USD 100-300, shared with R27 O2) for service tax and related-party questions (default yes).
- O4: B2B-only terms for EU customers (default yes; removes consumer withdrawal duties).

## Conflicts with existing docs
- R5 says "start with Paddle, no tax registration on day one": still true for EU, but Paddle's acceptance of an AI legal product is unchecked, and the Malaysian customer is better served by local rails.
- A blog implies a USD 15 Paddle chargeback fee; the help page says 20 (15 is the wire fee).
- Lemon Squeezy is being folded into Stripe Managed Payments; do not plan on it.

## NOT verified
- Whether our SaaS is taxable under MY domestic service tax, and the exact 2026 amendment text (RMCD, PwC and Deloitte pages blocked).
- B2B reverse-charge and vendor invoice content (VAT Directive Art. 44/196/226 not re-fetched); German e-invoice duty for a non-EU vendor.
- Stripe Managed Payments seller-country list; Stripe Billing meters; Smart Retries cost; Polar licence.
- Gulf: FTA and ZATCA primary pages, gateway fees, foreign onboarding, mada cap, UAE e-invoicing scope.
- Paddle acceptable-use for legal/AI products; Paddle invoicing fee.

## Proposed GitHub rows
| Lane | Title | Done when |
|---|---|---|
| L5 | Billing provider interface plus Stripe test-mode adapter (plans, subscriptions, idempotent webhooks, state machine) | Replay and out-of-order webhook fixtures pass; entitlements derive from stored state; no key in repo |
| L5 | Paddle sandbox adapter spike plus written acceptance check for an AI legal-information product | Same entitlement tests pass on both adapters; provider reply stored in docs |
| L5 | Usage metering: `usage_events`, monthly rollups, per-tenant caps and alerts | Cap blocks the 101st call in a test; rollup matches raw events; no AGPL dependency |
| L5 | Tax-treatment table as effective-dated config (B2B/B2C, country, VAT-id state, reverse charge, MY service tax flag) with VIES cache and fallback | Each row has `source_url`, `as_of`, `verified`; VIES-down and invalid-id cases tested |
| L2 | Vendor invoice and credit-note generator in our own ledger (gapless numbers, reverse-charge mention, SST line, FX rate) | Fixtures for MY B2B, EU B2B, EU B2C refund produce valid documents |
| L5 | Dunning, refund and chargeback runbook plus past_due grace flow | Failed-payment fixture walks retry, grace, read-only, suspend; runbook in `docs/` |
| L5 | Trial-abuse controls (card on file, one trial per tax id/domain, free-token cap) | Second trial with same domain is refused in test |
| L5 | Adviser question pack: MY service tax, related-party customer, EU B2B, Gulf | Owner-ready list with defaults in `docs/owner/` |
