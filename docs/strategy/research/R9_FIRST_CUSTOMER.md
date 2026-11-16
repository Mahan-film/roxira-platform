# Research R9 — first-customer field requirements, Malaysia (digest)

Source: the owner's deep-research run of R9 stage 2 (self-review, decision pack, web/PWA POS limits), received 2026-11-16. Hub web checks on the same day are marked **(hub)**. This file is the coordinator's digest: what we adopt, what we reject, and the rows it adds to WAVE 16.

Same rule as R8: a number that only a secondary source backs goes into pack config with `verified: false`. R8's MYR→USD rate (4.0946) has no official source, so MYR only here.

## Assumptions in the report that we do not use
- That Persian is a side pack and the team sits in another time zone. Iran (roxira.ir) stays the first market. Support hours are set by the pilot plan below, not by a guess about where we are.
- Hosting and infrastructure-location advice. Out of scope for this research.
- "Bill through a foreign merchant of record, then set up a Sdn Bhd later." **The owner already has a Malaysian Sdn Bhd** (food retail). See "Owner answers" below.

## Facts that change our plan

| Fact | Status | Effect |
|---|---|---|
| Businesses under RM 3M that meet the exemption criteria are **fully exempt** from e-invoicing. The RM 10k rule only stops **in-scope** businesses from putting a sale over RM 10k into a consolidated e-invoice. R9 stage 1 and our R8 digest overstated this. | verified (LHDN FAQ 4 Sep 2026) + (hub) several firms | The MY pack applies the RM 10k rule only in `relaxation` and `mandatory` modes. |
| A company that reaches RM 3M in YA2023–25 starts 1 Jul 2026; one that reaches it in YA2026+ starts 1 Jan of the second year after. Related companies of a ≥RM 3M group are in scope. ~~Once in, a company never drops back to exempt.~~ **Corrected 2026-11-16 (R11, hub read of the PDF):** the LHDN FAQ (Q17–Q19) says a company under RM 3M that meets the criteria in §1.6.10 "may discontinue issuing e-Invoices immediately", or continue voluntarily. The FAQ has no "never back to exempt" rule. | verified (LHDN FAQ) | The company setting stores the mode with a start date. Changing it back to `exempt` is allowed, with an audit row and the reason. |
| **MyInvois needs no software certification.** The customer registers our ERP in their MyInvois profile (we get a Client ID and two secrets, 3-year expiry), **or** adds Roxira as an **intermediary** and we call the API on their behalf with our own credentials. OAuth client credentials; a token lasts about 1 h; about 12 logins a minute per client. Sandbox and production credentials differ; sandbox credentials are requested from LHDN by email. | (hub) LHDN SDK pages + SQL/QNE onboarding guides | Use the **intermediary** model through our own Sdn Bhd: one credential set, so customers never paste secrets. |
| SVDP: missed e-invoices can be filed without penalty from 7 Jul 2026 to 31 Dec 2027. | verified (LHDN Q&A, R8) | A "catch-up" import for customers who switch to us messy. |
| LINDUNG 24 Jam (SKBBK): 0.75% from 1 Jun 2026, mandatory for foreign workers, voluntary for locals from 8 Jul 2026, locked in after 31 Aug 2026 ("once in, always in"), **June 2026 mandatory for everyone**. Phase 2 is 1.00% from **1 Jun 2028 to 31 May 2031**. People with two jobs pay through one employer. | verified (PERKESO circular + FAQ 13 Aug 2026) | Payroll pack data (the payroll module is still deferred, R8). |
| Foreign-worker EPF 2% + 2% from Oct 2025 wages; pre-1998 members and 11% opt-ins excepted. | secondary (Crowe, KWSP release 25 Jun 2025) | Payroll pack data, `verified: false`. |
| Budget 2027: minimum wage RM 2,000 from June 2027 (smaller firms exempt), YA2027 tax bands and RM 12,000 relief change PCB from Jan 2027. | announced, **not gazetted** | Payroll pack data when gazetted. |
| PDPA: processors are directly liable (security principle). DPO duty also triggers on "regular and systematic monitoring" with no headcount floor. Biometric data is sensitive data. | verified (gazette dates); law-firm summaries | Attendance stores device logs (employee id + time), **never biometric templates**. |
| Payment rails settle net of fees and SST, T+1/T+2: HitPay, Revenue Monster, marketplaces. | verified (vendor pages) | Clearing accounts per payment rail, never straight to bank. |
| Shopee: new-seller waiver is now 120 days **or 200 orders** (from 1 Aug 2026); fee table updated 14 Aug 2026. TikTok Shop: 0–20.52% SST-inclusive commission from 31 Oct 2026. ShopeeFood 30% + SST. | verified (seller centres) | Marketplace settlement import parses these lines. |
| Competitors: StoreHub RM 122 / 235 / 471 a month; Qashier RM 8 a day; FeedMe RM 0 / 90 / 129; Bukku RM 0–135 (+8% SST; the SST and multi-currency add-ons cost RM 12 each on the low tiers); Eats365 from RM 99. iCHEF, Xilnex and SQL prices are unverified. | mostly verified | Our offer bundles POS + inventory + ledger. The owner sets the price. |
| **A pure web/PWA POS cannot:** print to USB printers on iPad; open raw TCP 9100 to LAN printers; kick the cash drawer silently; use built-in Sunmi/iMin printers; sync several registers offline over LAN. It **can**: run one register offline (IndexedDB), use HID barcode scanners, and render any script as a bitmap. | standard browser limits | Adopt the print bridge (decision 3). |

## Decisions (adopted)
1. **Pilot #1 is our own Malaysian food-retail company.** It dogfoods the MY pack: POS, inventory, ledger, MyInvois as intermediary, clearing accounts. External pilots come next: 3–5 daytime retail, light trading or counter-service cafés with 2–10 branches. Dine-in restaurants with table service and kitchen screens wait.
2. **Several companies under one owner = a tenant group, not a new layer under the tenant.** Today a tenant is one legal company, and the consolidated report already reads several tenants. We add:
   - `tenant_groups`;
   - user membership in several tenants, with a company switcher;
   - group consolidation and inter-company transfer documents: a sale in one tenant and a purchase in the other.

   RLS stays keyed on `tenant_id`, so nothing in the existing tables changes. Each company keeps its own TIN, SST, EPF and SOCSO numbers through its own company localisation (T137).
3. **POS = the PWA we have + a tiny local print bridge.**
   - The PWA renders every receipt (Persian, Malay, Chinese, logo, MyInvois QR) to a 1-bit bitmap.
   - A small bridge on the counter PC sends it as ESC/POS raster to a USB or LAN printer, with the drawer kick.
   - On iPad, the printer is on the LAN and the bridge runs on any small box.
   - Sunmi/iMin handhelds get a thin Android wrapper only when a pilot needs one.
   - Supported hardware is a short tested list; customers bring their own.
4. **Clearing accounts per payment rail** (card, DuitNow QR, e-wallet, each marketplace, each delivery app). A settlement import moves the net amount to the bank and books commission, fees and SST.
5. **MyInvois through the intermediary model**, inside the MY pack adapter, after T152.
6. **Phone agent in Malaysia waits.** WhatsApp is how Malaysian SMEs work. WhatsApp receipt and order capture is decided with R11 (messaging), then voice.
7. **Malaysian payroll stays deferred** (R8). The verified PERKESO data above goes into pack config now, so nothing is lost.

## Rows added (WAVE 16)

| Lane | Task | Done when |
|---|---|---|
| L2 | **T155 Company groups** | An ADR section in the PR description first. Then: `tenant_groups` and `tenant_memberships` (user, tenant, role), each with FORCE RLS where it holds tenant data, plus a pg spec as roxira_app. The JWT carries the active tenant; switching re-issues it after a membership check. The consolidated report reads the group. An inter-company transfer creates a sale in tenant A and a purchase in tenant B, linked by one reference. Specs: no access to a tenant without membership; a switch is audited. |
| L4 | **T156 Clearing accounts per payment rail** | Posting rules route each payment method to its own clearing account, configured in the pack. A settlement entry moves the net amount to bank and books fee, commission and SST lines. Specs cover a card day, a DuitNow day, a split payment and a refund. |
| L3 | **T157 Marketplace settlement import** (*after T156*) | CSV/XLSX import for the Shopee, TikTok Shop and GrabFood payout reports, building settlement entries through T156. The dry-run report shows gross, commission, fees, SST and net per order. Fixtures are made-up files in the real column layout. |
| L1 | **T158 Local print bridge** | `tools/print-bridge/`: a small Node service on 127.0.0.1 with one token per install. It takes a 1-bit PNG and prints it as ESC/POS raster to USB or LAN (TCP 9100), plus a drawer kick. The PWA has a receipt-to-bitmap renderer and a printer setting. `tools/print-bridge/README.md` lists tested printers. Unit specs cover the raster encoding. No changes to the existing offline queue. |
| L4 | **T159 MyInvois intermediary adapter** (*after T152*) | In the MY pack: OAuth client credentials as intermediary with on-behalf-of, a token cache, a login rate limit, and submit / poll / cancel within 72 h through the outbox. Requests run against recorded sandbox fixtures in specs, never the network in CI. Credentials come from env only. |
| L3 | **T160 Attendance without biometric templates** | A check that T129's import stores only employee id, device id and timestamp. If any field could hold a template or image, it is dropped. One spec, plus a line in the privacy draft. |
