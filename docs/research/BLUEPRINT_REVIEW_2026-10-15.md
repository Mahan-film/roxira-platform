# Review of the "2026–2028 Master Blueprint" (pasted by the owner, 2026-10-15)

Source: a long AI-generated strategy text (7 "missing links", a 9-layer stack, a 6-pod factory).
Verdicts below are for **our** situation: Iranian market first, one 8 GB ARM server (srv1), test
customers, Iranian payment rails (no Stripe), free-first model policy, a small team.

## خلاصه برای مالک

بیشتر این متن «فهرست ابزارهای داغ» است، نه برنامه‌ای که به وضع ما بخورد. چند عدد و نسخه‌اش هم قابل تأیید نیست، مثل «۱۱ میکروثانیه» یا «v2.46»؛ آن‌ها را ادعای تأییدنشده حساب می‌کنیم.

**از آن سه چیز واقعاً به درد ما می‌خورد و برنامه‌ریزی شده‌اند:**
1. سنجش هزینه و کیفیت هر پاسخ (Langfuse یا لاگ همین درگاه).
2. «تست جهش» برای اطمینان از اینکه تست‌هایی که ایجنت‌ها می‌نویسند واقعاً باگ را می‌گیرند.
3. دیتابیس جدا برای هر ایجنت هنگام تست. این را به روش ارزان خودمان انجام می‌دهیم، با الگوی Postgres، بدون Neon.

**بقیه یا مربوط به بازار خارجی و پرداخت دلاری‌اند، یا برای مقیاس فعلی ما زیاده‌اند.** مثال‌ها: x402، Stripe و قوانین اروپا. برای همین کنار گذاشته شده‌اند تا وقت لازمش برسد.

## Verdicts

| Item | Verdict | Why / what we do instead |
| --- | --- | --- |
| x402 / Stripe MPP agent payments | **Skip** | Stripe/USDC rails are unavailable for an Iranian business; buyers are Iranian humans today. Revisit only if we sell an API abroad. |
| Lago usage metering + Polar/Paddle MoR | **Defer** | No outcome-priced product yet. The factory plan's M5 (per-tenant ledger rows) covers metering first; Lago only if billing gets complex. MoR is irrelevant inside Iran. |
| AG-UI / A2UI generative UI | **Defer** | Interesting for the factory's spec-intake chat (M4). Our Next.js + streaming SSE already covers chat. |
| Restate / DBOS durable execution | **Defer (DBOS first if needed)** | Agent runs are idempotent worktree jobs; deploy is already transactional (backup, migrate, rollback). If the factory build pipeline needs durability, DBOS (a library on our Postgres) is lighter than Restate. |
| LangGraph / Microsoft Agent Framework / PydanticAI | **Skip for now** | We already chose OpenCode workers plus the hub as the control plane (`docs/research/AGENT_FACTORY_STACK_2026-10.md`). Do not add a framework without a failing use case. |
| Neon Postgres branching per agent | **Adopt the idea, not Neon** | Use `CREATE DATABASE agent_x TEMPLATE app_template` on our Postgres (instant, free, no data leaves the server) for agent migration tests. |
| Wasm (Wasmtime) / Firecracker sandboxes | **Defer to factory M3** | Customer-generated code must run sandboxed. Firecracker needs KVM (not available on our cloud VM), so plan gVisor/rootless containers with `--network=none`. |
| Bifrost (Go) gateway instead of LiteLLM | **Skip** | Gateway overhead is irrelevant at our request rate; LiteLLM is running and tested. Not worth a migration risk. |
| Semantic caching | **Skip for legal answers** | Similar questions with different facts must not share an answer. Only exact-match caching for agents, if ever. |
| Spec Kit (SDD) | **Skip** | Our task specs plus `claim.sh` issues plus hub review already do this. |
| Mutation testing (mutmut / Stryker) | **Adopt (small)** | Run weekly on tenant isolation, tax signing and legal citation code to catch weak agent-written tests. |
| Property-based tests (Hypothesis / fast-check) | **Adopt where it pays** | Parsers (relay, xlsx, CSV) and tax totals. |
| Lean 4 / Dafny proofs | **Skip** | Cost far above the value for our scale. |
| Langfuse + OpenTelemetry (cost per successful task) | **Adopt** | LiteLLM has a Langfuse callback. Langfuse Cloud free tier first (needs an owner account), self-host later if RAM allows (ClickHouse is heavy on 8 GB). |
| PostHog | **Optional** | Free cloud tier for product analytics and funnels, when we market Roxira. |
| EU AI Act / CRA / NIS2 / Data Act compliance-as-code | **Not applicable now** | Iranian market. Cheap hygiene we can still do: an SBOM per build (syft) and a clear "AI-generated" note in chat (already present). |
| Kill/Scale/Exit gates, micro-SaaS portfolio | **Owner's business decision** | Out of engineering scope. |

## Concrete follow-ups (added to docs/STATE.md backlog)
1. LiteLLM → Langfuse callback (owner creates a free Langfuse Cloud project; keys via `set_server_env.sh`).
2. Weekly mutmut job on `modules/tenants`, `modules/tax_compliance`, `scripts/legal/iran_relay.py`.
3. Agent DB templates for migration tests on the server.
