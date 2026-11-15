# Research R2 (infrastructure, security, delivery) and R3 (assistant: chat and voice) — digest

Source: the owner's deep-research runs of prompts 3 and 2, received 2026-11-15. This file is the coordinator's digest and the decisions taken from it.

**Caution:** prices, versions, model names and legal dates in those reports were not verified here, and some are later than anything we can check. Treat them as leads. Verify with the vendor or npm before you rely on them.

## Already true in our code (checked 2026-11-15)
- Tenant context uses `set_config('app.tenant_id', $1, true)` inside a transaction. This is transaction-local and safe behind PgBouncer in `POOL_MODE=transaction`.
- PgBouncer runs in transaction mode in `docker-compose.prod.yml`.
- Tenant tables have ENABLE and FORCE RLS (WAVE 12, T29).
- **Gaps:**
  - there is no `AS RESTRICTIVE` guard policy anywhere;
  - there is no CI audit that every tenant table has RLS forced;
  - there is no `security_invoker` rule for future views;
  - production still bypasses RLS through the superuser (T105).

## Decisions — adopted now (WAVE 14 amendments)
**Security and data**

1. **RESTRICTIVE tenant guard.** Each tenant table gets a RESTRICTIVE policy, so a later permissive policy can never widen access across tenants:
   `AS RESTRICTIVE FOR ALL USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (same)`
2. **CI RLS audit.** The audit queries `pg_class` and `pg_policies` and fails if a table with `tenant_id` lacks any of: `relrowsecurity`, `relforcerowsecurity`, a restrictive tenant policy.
3. **Views** are always created `WITH (security_invoker = true)`.
4. **Migrations:**
   - the runner sets `lock_timeout = '3s'` and `statement_timeout = '15s'`;
   - destructive DDL follows expand → backfill → contract, as three PRs. During a deploy the old and new containers run side by side for a while.
5. **GitHub Actions hardening:**
   - third-party actions are pinned to a commit SHA;
   - the default is `permissions: contents: read`;
   - no workflow uses `pull_request_target` to check out PR code.

**Assistant**

6. **Grounding.** Every number in an answer comes from a tool result, with `source_record_id` and `field_path`.
   - The validator normalises Persian and Arabic digits, separators and unit words.
   - The ×10 Rial/Toman conversion is allowed only when the unit is stated.
   - If validation fails, the prose is blocked and the verified tool data is shown as a table.
   - The model never does arithmetic: totals and deltas come pre-computed from the tools.
7. **Calendar context block.** The server injects today (ISO and the tenant's calendar) and exact start/end boundaries for: today, yesterday, this week (tenant week start), last week, this month, this fiscal year. They are computed by `CalendarService`, never by the model.
8. **Tool arguments never carry `tenant_id` or branch IDs.**
   - Tenant, user, branches and permissions come from the verified session.
   - The model passes business filters only, such as a branch *name*. The server resolves the name against the user's allowed branches.
9. **Untrusted text.**
   - Strip Unicode tag characters (U+E0000–E007F) and bidi overrides from memo, description, name and OCR fields before they reach a model.
   - The chat UI never renders Markdown images and never auto-fetches links.
   - Values taken from retrieved text can never fill a write action's amount, recipient or account without a human confirmation.
10. **Audit split.**
    - `ai_interactions` is operational telemetry (sanitised question, tools, tokens, cost, latency, verdict), with `expires_at` = 90 days and a purge job.
    - Once write actions exist, a separate append-only `ai_action_audit` (no UPDATE or DELETE, hash-chained) keeps them for the statutory period.
11. **Writes are proposals.**
    - Propose → the user confirms in the UI (outside the model) → execute with an idempotency key.
    - Undo means a draft is voided, or a posted entry is reversed by a compensating entry. Nothing is ever edited in place.

**E-invoicing and integrations**

12. **External submissions go through an outbox.**
    - The idempotency key is derived from tenant, document and version.
    - On an ambiguous timeout, the worker queries the authority's status first and never re-posts blind.
    - A circuit breaker (5 failures, 5 minutes) switches to manual-export mode, and the UI says "queued".

**Voice**

13. **A deterministic pre-TTS verbaliser** turns amounts (both Rial and Toman in the default pack), dates and phone numbers into words before synthesis.
14. **Persian end-of-turn heuristic.** Commit about 300 ms after a verb or question ending. Hold about 900 ms after a connector or a digit.
15. While a tool runs, interruptions are disabled; a short filler phrase covers waits over 400 ms.

## Decisions — later (with trigger)
- **Semantic layer (Cube Core) for analytical questions.** Trigger: the curated tools no longer cover common questions. Keep curated tools now, and later collapse them to about 12 domain tools. Never use raw text-to-SQL.
- **Zero-downtime deploys** (Kamal 2 or a health-gated rolling compose). Trigger: deploy blips get noticed, or merges reach about 20 a day. Needs owner server time.
- **Secrets as SOPS + age in git.** Trigger: before a second server exists.
- **Observability** with OTel, Grafana/Loki/Tempo and GlitchTip (about €26 a month), plus 5 symptom alerts:
  - API 5xx;
  - PgBouncer waiting;
  - outbox stall;
  - voice p95 latency;
  - LLM daily spend.
- **Nightly backup-restore drill** on a throwaway server; monthly chaos test of the LLM fallbacks. Needs owner server access.
- **Regional pods.** EU pod for Germany, because books must stay in the EU without tax-office approval. Singapore pod for Malaysia, which is allowed with a transfer assessment and model clauses. Tenants never cross pods. Trigger: the first customer in that country. The report estimates about €120–140 a month for both pods at 100 tenants (unverified).
- **Voice providers.** Evaluate Deepgram Nova-3 streaming STT and Azure/ElevenLabs TTS on our own call recordings before switching.

## Owner decision needed
- **Free-tier key pooling.** The reports say that pooling several free accounts of one provider to get around rate limits breaks those providers' terms and risks suspension. They also say free tiers may train on prompts.
- **Proposal:**
  - keep the free pooled keys for development, CI and the code-review desk, which handle no customer data;
  - put customer data (assistant, voice, OCR) on one paid, no-training project per provider, with cheap models first.
- The report estimates the chat cost at under $1 per 1,000 questions (unverified).
