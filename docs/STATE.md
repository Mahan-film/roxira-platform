> **Last update: 2026-10-12. Gap audit and ranked backlog: `docs/STRATEGY_GAP_2026-10-12.md` (read its section 4 for what to do next). Older picture: `docs/HANDOFF_2026-10-04.md`. Then `docs/SYSTEM_MAP.md`, then `docs/STRATEGY.md` only as needed.**

# Current state (read this first)

Owner speaks Persian: reply in Persian; code, commits and docs in English. Hub = strategist/architect (Opus-class), workers = cheap models (`rx <issue> dsflash`) or Claude `implementer` subagents in worktrees. The hub never merges or deploys: the owner does (`gh pr merge N --repo Mahan-film/roxira-platform --squash --admin --delete-branch`, ONE command per message; the owner's terminal Run buttons replay old blocks, so ask them to type or paste into a new tab).

## Rules that changed in 2026-10 (older docs may still say otherwise)
- GitHub Actions is OFF (zero spend). CI = `bash scripts/dev/local_ci.sh` (about 1230 tests, quarantined). Never run pytest over `src/` or the repo root. The `factory-*`, `agent-*`, `uptime`, `deploy-prod` workflows are dormant. Deploys go through `scripts/ops/deploy_local.sh` (owner-run) and nothing else.
- **Legal source: ekhtebar.ir is the ONLY source** (owner, 2026-10-12). It is reachable only from Iranian IPs, so fetchers and `law_watch.py` run on the owner's Mac. All of it is `unofficial` tier until a lawyer signs; the lawyer's earlier "official sources only" rule (LAWYER_ANSWERS R-B) conflicts and needs a recorded decision (gap doc, action 3). No open-web legal search in the product.
- Models: cheap only. Default chat = DeepSeek V4.1 Flash; free models only for public data; Gemini Pro banned; Gemini 3.8 Flash is only the vision/OCR model and a last `strong` fallback. Ids only in `config/models.yaml`. Groq is reachable only from the server IP.
- Keys only in `~/Secrets/roxira/roxira.env` (chmod 600). Never print or ask for values. Server `.env` writes only through `scripts/ops/set_server_env.sh` (owner-run).
- Autonomy ladder `config/autonomy_ladder.json`: L0 docs, L1 non-sensitive code, L2 smartjudge prompts/retrieval/corpus/models.yaml (`hub-approved`), L3 auth/billing/migrations (owner reads), L4 `.github`, `scripts/ci`, `scripts/ops`, rx, compose, nginx (owner writes).
- Every agent worktree: run full `local_ci.sh` before the PR. Test files must not run code at import (quarantine guard).
- Claude desktop app leaves `core.bare=true`: run `git config core.bare false` at the start of every bash chain; launch agents one at a time.

## What is merged on main (5a089ace, PR #568); production NOT re-verified on 2026-10-12
Last verified read-only on prod: 2026-10-09 (main bea3d19). Treat everything below as "merged"; running state needs action 1 of the gap doc.
- **Chat**: auth-derived tier and phone, streaming SSE, grounded prompt, source filtering, exact-article lookup, hybrid dense+lexical retrieval (#533, #528, #540). Citation guard runs on chat and drafts.
- **Drafting and upload**: conversational `/draft-assist` (#557), ruling/indictment without the router flag (#558), async case-file upload with progress (#560), vision OCR fix (#559). UX P0 batch and lazy-loading (#556, #562).
- **Corpus**: `iran_laws_v3` = v2 + 247 fill rows + 1376 lease replacement + 492 articles of four ekhtebar laws (تعزیرات, دیوان عدالت اداری, بیمه شخص ثالث, قاچاق کالا و ارز); built by `scripts/legal/build_v3_on_server.sh` (#564, #566). The owner reports v3 is now serving: the served collection is env `LIGHTRAG_QDRANT_COLLECTION` (embedder map in `legal_graph/lightrag_engine.py:83-93`). `iran_laws_mistral_v1` vectors cannot be queried with bge-m3 and are NOT the answering collection (earlier STATE text was wrong). Law watch P0 tracks ekhtebar changes (#567).
- **Ops**: restic backups and DR (#526), backup emails with encrypted offsite parts (#565), synthetic monitoring (#531), self-improvement loop (#553), deploy smoke checks run from the server with a readiness wait (#568), infra hardening (docker socket proxy, nginx catch-all, CF-only firewall script) (#527/#549-#551), security fixes (#523, #525).
- **Factory (local)**: `rx` reads executor id from `models.yaml` (#563), `dispatch_opencode.sh`, `llm_spend.sh` (#561).

## URGENT (carried from 2026-10-09; status unknown until re-verified read-only)
1. Server git tree was in a merge-conflict state (`UU docker-compose.prod.yml`, 3 stashes). Any `docker compose`/`deploy_local.sh deploy` would fail. Fix with owner approval: `git restore --source=HEAD --staged --worktree docker-compose.prod.yml`, keep the stashes.
2. Disk was 96% full (Docker images 75 GB, build cache 38 GB). `docker builder prune -f` first; never prune volumes; audit before anything else (AGENTS.md s6).
3. Deploys outside `deploy_local.sh` leave `/root/deploy-state/prev_commit` stale (was 160081b): rollback would go to the wrong commit. Re-record after the next clean deploy.
4. Confirm #527 actually rolled out (docs/infra/ROLLOUT_527.md): socket proxy, no `docker.sock` in the backend, CF-only firewall, selfimprove/monitor/backup timers.
5. Iran path: owner to turn Cloudflare HTTP/3 off and relax challenge settings (docs/ops/SITE_HEALTH_2026-10-09.md hypotheses 1-2).

## NEXT STEPS, in order (details and specs: gap doc section 4)
1. Reconcile production (item 1-4 above), then `bash scripts/ops/deploy_local.sh check`.
2. Cloudflare Iran-path settings plus an Iranian-vantage probe.
3. ADR for ekhtebar-only / unofficial tier; delete the dead open-web fallback in `smartjudge_module.py:2-100`; show the source tier in answers.
4. Eval gate: 50 + 20 held-out lawyer-verified questions, deterministic checks, wired into the deploy smoke. Current sets (10 chat, about 30 retrieval) are DRAFT.
5. One executed and logged restore drill; second copy of `~/Backups/roxira-legal/phase1_20261004/`.
6. Close unauthenticated stubs (`/legal-graph/ingest`, `/admin/export-dataset`, `/telephony-session`, `/crm/sync-case`), OAuth `state`, HttpOnly cookie (L3, owner reads).
7. Product: chat history UI (backend ready), `/plans` with visible prices, privacy-preserving funnel analytics.
8. Corpus: unity rulings (آرای وحدت رویه) in a separate collection; reranker and embedder A/B after the eval gate; law watch P1.
9. Factory: wire `task_caps.py` into `rx`; per-key OpenRouter budgets and top-up (balance about 6 USD on 2026-10-12); fix the codebase-memory lock (docs/factory/FACTORY_AUDIT_2026-10-12.md 1.1).

## Tools verdicts (docs/research/TOOLS_ADOPTION_2026-10.md, docs/factory/FACTORY_AUDIT_2026-10-12.md)
ADOPT: OpenCode (batch runner), Goose (recipes only), Aider (fallback), Crawl4AI (corpus crawl), bge-reranker-v2-m3 behind a flag. KEEP: LiteLLM (key rotation), OmniRoute (public code only; fix broken combos). SKIP: Flowise, Composio, n8n, Dify, Mem0, Crush, browser-use, LangGraph/deer-flow, hermes-agent, Neo4j/pgvector. AVOID: HexStrike AI (ask the owner which "Hexbot"; never install the offensive tool). Promptfoo is no longer required: use deterministic scripts.

## Known open work
`task_caps.py` not wired into `rx`; `opencode serve` spike; product split (smart-judge / roxira / core) not started beyond the import-boundary check; legacy root daemons and handover files still in the repo root; dead frontend code (`components/judge/*`, `chat-sidebar.tsx`, `/judge` workbench) not deleted; `security/pii_scrubber.py` unused; `jurisdiction_rules.yaml` loader not wired into answers; about 230 stale worktrees and about 20 stale/Dependabot PRs (do NOT merge Dependabot majors); backend Dockerfile runner stage has no ts-node (migrate uses a one-off `--target deps` image); `set_server_env.sh` rewrite fails if server `.env` holds only that variable; `public/factory/index.html` still loads Google Fonts.

## Waiting on the owner
Merges; the `migrate`/`deploy` runs; prod reconciliation (above); Cloudflare settings; OpenRouter keys and top-up; codebase-memory lock fix; Twenty CRM hardening (`docs/ops/TWENTY_HARDENING.md`); local Whisper / Groq STT decision (needs a real Persian recording, `scripts/dev/stt_bakeoff.py --make-sample`, and a data-policy call because voice carries case data); decision D1 (users inside Iran vs abroad, `docs/research/HOME_SERVER_VOIP_S2S_2026-10-09.md`); DB fixes (order 4815502353, user `authenticated_user`, SINGLE_DRAFT #101); lawyer review of: the `proposed` allowlist entries, the repeal list, cheque-law paraphrase points, R1 (is «لایحه اصلاحی قانون تجارت» in force), and the eval gold answers; Iran-related account risk (Anthropic supported-country list, GitHub, Groq 403): keep local backups.
