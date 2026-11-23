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

## Second opinion (Gemini Deep Research, 2026-11-22)

Saved unchanged in `R22_GEMINI.md` (Stage 1 only; Stage 2 was not received). This section does not replace anything above. Rule used: where the two sides conflict, the claim with a primary URL and a date wins; everything else is UNVERIFIED until a lane reads the page. `R22_RAW.md` is not on main, so "digest only" below means "not in this digest".

### Agreements
- Anthropic Consumer Terms 3.7 ban bot/script access except through an API key or explicit permission; plan limits "assume ordinary, individual usage" (code.claude.com legal page, both sides).
- `claude -p` and the Agent SDK on a subscription still draw from subscription limits (Help Center article, both sides): allowed for one person, not a basis for multi-lane infrastructure.
- Consumer Gemini CLI sign-in ended 2026-06-18; Antigravity Additional Terms clause 6 ("in connection with products not provided by us"); Google reversed its own staff's permission to spawn `agy` from another agent. Consumer Antigravity is the highest ban risk.
- OpenAI bans credential sharing and rate-limit circumvention; `codex exec` with an API key is the supported unattended path.
- Gemini 4 Argon price rise on 2026-12-01.
- OpenCode Go has 5-hour pacing and a shared cross-model cap that can lock a lane out.
- Guardrails: hard spend caps in provider consoles, keys in an EnvironmentFile outside the repo, stagger schedules off the top of the hour, cap turns and timeouts, tool allowlists plus OS sandboxing, stable prompt-cache prefixes.
- Consumer logins stay for one person's interactive work; never shared or rotated.

### Conflicts (resolved by primary URL and date, else UNVERIFIED)
| Topic | This digest | Gemini | Verdict |
|---|---|---|---|
| Help Center article date | updated 2026-10-30 | article 15036540 dated 2026-10-07 | UNVERIFIED; both cite the same page. Lane reads the page date. |
| Google staff permission for `agy` inside another agent | approved 2026-10-05, reversed 2026-11-09 | approved 2026-10-07, reversed about 26.5 h later (one developer blog) | UNVERIFIED; dates differ by source. Conclusion is the same: never build on it. |
| OpenCode Go for unattended lanes | stage 2: unfit; lockout issue closed "not planned" | Option 2, reliability "Medium-High", compliant (API key) | Digest wins: it cites the closed issue. Gemini itself warns about shared weekly cap and repeated limit changes. |
| Model routing | free-first gateway, paid DeepSeek as capped last fallback (owner decision) | paid APIs first (Haiku 5.5 / Luna, Sonnet 5.5 / Sol), USD 20-27/month | Not a fact conflict: owner policy. Gemini's cost maths is illustrative (assumes 72M tokens/month, list prices, UNVERIFIED). |
| Haiku 5.5 cost | tokenizer is denser, adaptive thinking bills more, nearer the 100K price cliff | uses list price per token, no tokenizer correction | Digest correction stands; Gemini's USD 6.20 for routine lanes is a lower bound. |
| Gemini price step on 2027-01-01 | Gemini 3.8 Flash | Gemini 3.6 Flash (0.75/3.75 doubling to 1.50/7.50) | UNVERIFIED; model name differs. Lane re-reads the pricing page. |
| Batch discount | the 2h/8h background discount does not fit interactive CLI loops | Batch is 50% off, USD 11-18/month on async lanes | Gemini applies it only to asynchronous lanes; UNVERIFIED for our loops. |

### Only one side has it
- **Gemini only (all UNVERIFIED):** Google abuse prevention is shared across Antigravity, Gemini CLI and Code Assist (gemini-cli Discussion 20632, 2026-02-27) with one self-service appeal then a permanent ban; a 403 TOS_VIOLATION wave on 2026-11-16 that hit paying Pro users; EEA consumer terms "non-commercial use only"; Usage Policy effective 2026-11-12 and consumer retention up to 5 years if training is on; Max/Ultra include API credits since 2026-10-07 (not for GitHub Action runs); Anthropic Cloud Scheduled Tasks minimum interval 1 h; `CLAUDE_CODE_OAUTH_TOKEN` is personal and not for shared repo secrets; OpenAI SIWC terms allow user-controlled background automations but ban account pooling; Pro plans lost the 5-hour window on 2026-09-29; Gemini API Paid Tier 1 (USD 5 prepay, spend caps, about 10-minute billing lag); free-tier key limits (250 requests/day in Gemini CLI); Commercial Code Assist sunset dates; local Ollama hybrid option; `agy` with `modelProvider: gemini` plus an API key; a metered-key-in-`.env` incident class.
- **Digest only:** our own bridge hit the 5-hour limit on 2026-11-21; 5-minute cache expiry makes long tool calls expensive; loop guard, idempotency key per (issue, head sha), draft PRs only; untrusted issue text; per-lane daily caps and circuit breaker; telemetry per run; model aliases pinned in `config/models.yaml`; PII scrub of logs; revisit triggers; unverified list (subsidy ratio, 2026-10-17 OpenCode console breach, ChatGPT Business seat in our region).

### Row changes
- No new row. Short comments on existing rows: #1078 (T275: turn and timeout caps, billing-lag note), #1080 (T277: OpenCode Go reliability conflict, UNVERIFIED Gemini-only items to re-check).
- Decision 2 (free-first) is unchanged: Gemini's paid-API-first advice is an owner-policy difference, not a new fact.

### Owner decisions (not for agents)
- Hard spend caps in each provider console (also in Gemini's guardrails).
- Whether to add a small direct paid key as secondary now, as Gemini recommends, or only on a revisit trigger (default: on a trigger).
- Whether Anthropic's EEA "non-commercial" clause, if confirmed, changes anything for personal logins used on company work (needs the lane to read the clause first).
