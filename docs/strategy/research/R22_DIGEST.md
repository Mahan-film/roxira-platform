# R22 digest: unattended agent CLIs on subscription logins (2026-11-21, stage 1 + stage 2)

Source: owner-run deep research, stage 1 and stage 2 (skeptical review). Prices, limits and dates are
"requires primary check" before they drive spend. Facts and decisions are kept apart.

## Verified facts (stage 2)
- Anthropic Consumer Terms 3.7 ban bot/script access except via an API key or explicit permission
  (verified). Claude Code docs say plan limits "assume ordinary, individual usage" and are enforced
  "without prior notice" (verified; canonical URL is now code.claude.com).
- Help Center (updated 2026-10-30): `claude -p` and the Agent SDK on a subscription still draw from
  the subscription limits. That is permitted for individual use; it is not a basis for unattended
  multi-lane infrastructure. Our own bridge hit the 5-hour limit on 2026-11-21 (pilot failed).
- Google: consumer Gemini CLI sign-in ended 2026-06-18 (verified). Antigravity Additional Terms 6 bans
  using the service "in connection with products not provided by us" (verified). Google staff
  approved launching `agy -p` from another agent on 2026-10-05 and reversed it on 2026-11-09:
  policy whiplash, so never build on it.
- OpenAI: terms ban credential sharing and rate-limit circumvention (verified). `codex exec` with an
  API key is the supported unattended path.
- Planned price rises: Gemini 4 Argon/Carbon on 2026-12-01, Gemini 3.8 Flash on 2027-01-01 (verified).
- OpenCode Go: the cross-model 5-hour lockout issue was closed as "not planned" (intended behaviour).
  Stage 2 rates Go unfit for unattended production.
- Corrections to stage 1: Haiku 5.5 uses a denser tokenizer and adaptive thinking (more billed tokens,
  nearer the 100K price cliff); the 2h/8h background discount does not fit interactive CLI loops;
  a 5-minute prompt-cache expiry makes long tool calls expensive.

## Decision
1. No consumer login (Claude Pro, Antigravity, Gemini consumer) on any unattended path. They stay
   for each person's own interactive work: one account per person, never rotated or shared.
2. Lanes L5-L7 run on the existing free-first key-pool gateway (OpenCode + LiteLLM), with paid DeepSeek
   as the capped last fallback. Stage 2 recommends two paid APIs; we keep free-first by owner
   decision and add direct OpenAI/Anthropic keys only as a later, capped secondary if the free chain
   proves unreliable (revisit trigger below).
3. Rows: T275 (#1078 box lane runner), T276 (#1079 orch), T277 (#1080 gateway audit).
4. Safety rules for every unattended lane (all go into T275/T276):
   - per-lane daily dollar/token caps and a circuit breaker, not only a monthly ceiling;
   - loop guard: ignore bot-authored events, idempotency key per (issue, head sha), draft PRs only,
     never auto-merge;
   - issue, comment and log text is untrusted data (prompt injection can use a legitimate token);
   - structured telemetry per run (lane, model alias, tokens, cost, exit status, git sha);
   - pin model aliases through config/models.yaml; tolerate API-contract changes between versions;
   - deterministic scripts first (lint, dependency diff, log regex); LLM only where needed;
   - stagger schedules off the top of the hour; keys in an EnvironmentFile outside the repo,
     rotated every 90 days; egress allowlist (gateway tunnel plus Git host).
5. Treat logs that may contain personal data as PII: scrub before any model call.

## Revisit triggers
Actual spend above USD 30 per month twice in a row; a price rise above 25 percent; human rework of
agent PRs above 25 percent over 30 days; provider 429/5xx above 5 percent of runs in 14 days; any new
high-severity advisory in a CLI we run.

## Owner decisions
- Hard spend caps in each provider console (what the hub cannot set).
- Whether to add a small direct OpenAI/Anthropic key as secondary (default: later, only on a trigger).

## Not verified
Zed/InfoWorld subsidy ratio; the 2026-10-17 OpenCode console breach (secondary sources only);
several Gemini price rows; whether a one-seat ChatGPT Business workspace is available in our region.
