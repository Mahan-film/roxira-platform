# Architecture decisions — 2026-11-16 (hub as central architect)

Input: the owner's outside research "Rust migration and next-generation modular stack" (a report written by another AI, November 2026), plus hub checks of the key claims against primary sources and our own repo and CI. This file decides what we adopt, when, and what we refuse. It sits under `MASTER_PLAN_2026-11-16.md`.

**Owner direction (2026-11-16):** finish the product first: CRM, ERP, accounting and tax, globally usable (Germany and the EU, the Gulf states, others; Iran is already live). No company or market decisions until the product is complete. Lowest cost.

## Checked facts (hub, 2026-11-16)

| Claim in the report | Check | Result |
|---|---|---|
| TypeScript 7.0 (Go compiler) is stable, 8–12× faster builds | Microsoft blog, InfoQ, The Register | **True** (GA mid-2026). No stable programmatic API until 7.1, so typescript-eslint and similar tools are blocked. |
| Gemini Decisions API (`gemini-decision-1`, 11 Nov 2026): closed-set yes/no, choice and score over text, PDF, image and audio; 150–250 ms; USD 0.10 per 1M input tokens, no output tokens | Google blog, MarkTechPost, Vercel AI Gateway | **True.** Benchmarks are Google's own. |
| A2UI 1.0 (11 Nov 2026): agents return native UI from the client's own component catalog; sensitive values never reach the model | Google Developers blog, SD Times | **True.** The spec site still lists 1.0 as RC; Compose and Gemini Enterprise lag behind. |
| PostgreSQL 19 GA on 19 Nov 2026 | postgresql.org RC1 news | **Scheduled**, not yet released. |
| "Agent distraction": stale TODOs cost agents ~70% more steps | not checked | Moot for us: the repo has 2 TODO/FIXME in `.ts`/`.py`. |
| Our CI | hub, lane PR #849 run | Backend tsc + jest + pg specs **4 min**; frontend 2 min; **M1 Playwright gate 11 min**; everything else under 1 min. |

## Decisions

### Refused (and why)
1. **No rewrite into Rust, Go, Effect or Bun.** The report itself concludes this, and our case is stronger: our bottleneck is review and merge throughput, not runtime speed. NestJS + Next.js (TypeScript) and the Python AI core stay. Rust only for a **measured** hotspot; none exists today.
2. **No adoption of outside suites** (Twenty, NocoBase, Teable, Plane, Huly, Medusa). They are AGPL or a second platform, and Huly is frozen. We use them as UX references only.
3. **No new runtime platforms now:** Restate, Rivet, Durable Objects, Kata, Hyperlight, NATS, Iggy, MoQ, LiteLLM-Rust (beta). BullMQ + outbox + Postgres cover our load. Each has a revisit trigger below.
4. **No database change on `.0` releases.** PostgreSQL 19 upgrade waits for 19.1, on staging first, then production.

### Adopt (in order)

| # | What | Why for us | Row / when |
|---|---|---|---|
| 1 | **WIP limit in the software factory:** a lane with 3 or more unmerged PRs takes no new row and works only on its own blockers or on review fixes. | The factory's real bottleneck: about 30 unmerged PRs with chains between them. More lanes would make it worse. | WAVE rule, now |
| 2 | **Merge pass in dependency order**, triaged by an agent: green + no blocker → merge; small fixes by the hub's agents; the rest go back to the lane. | Turns built work into product. | now |
| 3 | **`decide` model role on Gemini Decisions API** for closed questions: assistant intent routing, document-type detection in imports and OCR, the legal abstention pre-check, ticket priority. With a fallback to the current path. | 150–250 ms and almost free, versus a full LLM call. Fits "cheapest first". | T166 spike + eval |
| 4 | **A2UI 1.0 for assistant answers:** the assistant returns tables, KPI tiles and confirm forms from our own component catalog instead of prose. Values bind server-side, so tenant data and masked fields never pass through the model. | Implements R1 "ask first, click second" safely; one protocol for web and later mobile. | T167 spike, after T108 and T128 merge |
| 5 | **Faster M1 gate:** run only the Playwright specs whose pages a PR touches, plus a fixed smoke set; the full suite runs on main nightly. | 11 of the ~13 critical-path minutes per PR in the merge queue. | T168 |
| 6 | **TypeScript 7 for CI typecheck** once 7.1 ships its API (eslint unblocked); until then nothing. Saves under a minute today. | Low gain now. | revisit at TS 7.1 |
| 7 | **PostgreSQL 19.1** (staging first): `REPACK CONCURRENTLY`, plan advice, `WAIT` for replica reads. **`pg_duckdb` on a read replica** only when report queries exceed 2 s at p95. | Accounting reports at scale without a separate warehouse. | Q1 2027 |
| 8 | **Valkey** instead of Redis at the next infra window (BSD licence; we already run it in one compose file). | Licence hygiene, drop-in. | next infra window |

### Revisit triggers for refused items
- **Rust module:** a CPU-bound path above 30% of a request's p95 in production traces.
- **Durable execution (Restate or Rivet):** an agent workflow that must survive restarts for more than 1 hour, or more than 3 hand-written saga retries.
- **MicroVM sandbox:** we run customer-supplied or model-generated code on our servers.
- **LiteLLM Rust gateway:** it reaches GA and our gateway p99 overhead exceeds 50 ms.
- **VectorChord instead of Qdrant:** Qdrant ops cost exceeds one more container, or a tenant needs vector data inside its RLS boundary.

## Global product: country-pack order (product, not market)
Iran is live. The core already resolves a country pack per company (T137–T142). Foreign packs are built in this order:
1. **Germany (DE)** first. The strictest regime (GoBD immutability, KassenSichV/TSE for POS, XRechnung/ZUGFeRD, ELSTER VAT returns, DATEV export). A core that passes Germany passes most of the EU.
2. **Gulf:** Saudi Arabia (ZATCA Fatoora phase 2: cryptographic stamp, CSID onboarding, QR) and the UAE (Peppol-based e-invoicing, corporate tax). Arabic RTL and the Hijri calendar reuse the Persian RTL work.
3. **Malaysia:** finish the queued rows (T152, T159) only, since they also test the framework. No new MY rows until the product is complete.

Packs are data plus adapters (R4); nothing country-specific goes in core code. Research prompts R13 (DE/EU) and R14 (Gulf) feed the pack rows.

## Rows added

| Lane | Task | Done when |
|---|---|---|
| L4 | **T166 `decide` role (Gemini Decisions API)** | `config/models.yaml` gains a `decide` role with `gemini-decision-1`, plus a fallback to the current classifier path. A thin client in the Python core and one in Nest call it. It is wired behind a flag into two places: assistant intent routing and import document-type detection. An eval script compares accuracy, latency and cost against the current path on 100 labelled cases from our data. A report in `docs/eval/`. No default change until the eval passes. |
| L2 | **T167 A2UI spike for assistant answers** (*after T108 and T128*) | The assistant can return an A2UI surface built only from a whitelist catalog (table, KPI tile, chart, confirm form) that maps to our existing components. Values bind server-side from tool results, and masked fields stay masked. Behind a flag on the Home hub only. Specs: an unknown component is rejected, and a masked value never appears in the model payload. |
| L1 | **T168 Faster M1 gate** | CI maps changed paths to Playwright specs and runs those plus a fixed smoke set on PRs. The full M1 suite runs nightly on main and on the merge queue's last batch. The PR-time gate drops below 5 minutes, measured on 5 PRs. No spec is deleted. |
