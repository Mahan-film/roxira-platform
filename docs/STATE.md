> **Last update: 2026-10-04 (late). Read `docs/HANDOFF_2026-10-04.md` for the full picture; this file is the short, current snapshot. Then `docs/SYSTEM_MAP.md`, then `docs/STRATEGY.md` only as needed.**

# Current state (read this first)

Owner speaks Persian: reply in Persian; code, commits and docs in English. Hub = strategist/architect (Opus-class), workers = cheap models (`rx <issue> dsflash`) or Claude `implementer` subagents in worktrees. The hub never merges or deploys: the owner does (`gh pr merge N --repo Mahan-film/roxira-platform --squash --admin --delete-branch`, ONE command per message; the owner's terminal Run buttons replay old blocks, so ask them to type or paste into a new tab).

## Rules that changed in 2026-10 (older docs may still say otherwise)
- GitHub Actions is OFF (zero spend). CI = `bash scripts/dev/local_ci.sh` (about 1230 tests, quarantined). Never run pytest over `src/` or the repo root. Auto-deploy via Actions does NOT exist: deploys go through `scripts/ops/deploy_local.sh` (owner-run).
- Keys only in `~/Secrets/roxira/roxira.env` (chmod 600). Never print or ask for values. Server `.env` writes only through `scripts/ops/set_server_env.sh` (owner-run).
- Autonomy ladder `config/autonomy_ladder.json`: L0 docs, L1 non-sensitive code, L2 smartjudge prompts/retrieval/corpus/models.yaml (`hub-approved`), L3 auth/billing/migrations (owner reads), L4 `.github`, `scripts/ci`, `scripts/ops`, rx, compose, nginx (owner writes).
- Case data never goes to a `:free` model. Model ids only in `config/models.yaml`.
- Every agent worktree: run full `local_ci.sh` before the PR. Test files must not run code at import (quarantine guard).
- Claude desktop app leaves `core.bare=true`: run `git config core.bare false` at the start of every bash chain; launch agents one at a time.

## On main, NOT yet on the live site (prod still runs 160081b)
Everything since #461: court-aware drafting (14 court types), indictment draft, prompt library (off unless `SMARTJUDGE_PROMPT_LIBRARY=1`), escalation (off unless `SMARTJUDGE_ESCALATION=1`), fallback chains, chat restyle, minimal `/health` (#475; live `/health` still leaks details), CRM tenant isolation (migration `1789120000000-AddCrmTenantIsolation.ts` pending), local deploy tooling (#502, #509 `migrate`), merge-gate fixes (#508), set_server_env fix (#512), law fetcher (#511).
Server `.env` already set (names only): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ADMIN_HEALTH_KEY (take effect at next restart). JWT_SECRET, KAVENEGAR_API_KEY already present. Backups `.env.bak-*` on server.

## NEXT STEPS, in order (owner types each, hub reads the output)
1. `bash scripts/ops/deploy_local.sh migrate` (plan, read-only) was run: ONE pending migration (AddCrmTenantIsolation). Then `migrate --yes` (type short SHA; pg_dump backup first, never auto-restore). Result not yet known when this was written.
2. `bash scripts/ops/deploy_local.sh deploy` (dry-run), then `deploy --yes`; verify `/health` minimal, `/admin` 404, Google login, chat. Rollback is automatic on smoke-test failure.
3. Owner runs `python3 scripts/legal/fetch_laws.py --dry-run` from their own network (see `docs/ops/LEGAL_FETCH_LAWS.md`), then the real fetch. ekhtebar.ir works; qavanin.ir reachable; rc.majlis.ir, rrk.ir unreachable, dotic.ir returns 403 (do not bypass).
4. Hub + agents: fix 99 duplicate-key rows (39 keys) and missing `approval_date` in staged `phase1_official_v2.jsonl`, then local `validate -> plan -> apply -> eval`; production ingest only with owner yes, into a NEW collection with a rollback switch; lawyer signs the repeal list.
5. Evaluation: build the 50-question Persian legal set (`docs/research/DEEP_RESEARCH_PROMPTS_2026-10.md`; the owner has a Deep Research draft in `~/Downloads`: its article numbers are UNVERIFIED and partly look wrong, treat every `statutory authority` as TO-VERIFY and have a lawyer check). Promptfoo gate in `local_ci`.
6. Model roles: bake-off (`docs/research/BAKEOFF_2026-10-04.md`): Gemini 3.8 Flash 0.23 pass, others <= 0.07 (strict citation criteria, no RAG). Candidate reviewer = Gemini 3.8 Flash (different family from DeepSeek executor). Decide in `config/models.yaml` (L2); verify MiMo id with `--list-verify`.

## Tools verdicts (docs/research/TOOLS_ADOPTION_2026-10.md)
ADOPT/TRY: SearXNG + Crawl4AI (server), Wayback CDX client, Tesseract `fas` baseline vs Surya/Docling on 20 gazette pages, Promptfoo, bge-reranker-v2-m3 behind a flag. SKIP: Flowise (archived), Composio (SaaS), n8n, Dify, Mem0. AVOID: HexStrike AI ("Hexbot" ambiguous: ask the owner which one; never install the offensive tool).

## Known open work (see HANDOFF for detail)
rx not wired to `src/factory_pipeline/task_caps.py`; `opencode serve` spike; product split (smart-judge / roxira / core) not started beyond import-boundary check; header token count hard-coded 0, Persian digits remain in `formatPersianNumber`; about 230 stale worktrees and about 20 stale/Dependabot PRs (do NOT merge Dependabot majors); backend Dockerfile runner stage has no ts-node (migrate uses a one-off `--target deps` image instead); `set_server_env.sh` rewrite fails if server `.env` holds only that variable.

## Waiting on the owner
Merges; the `migrate`/`deploy` runs above; Twenty CRM hardening (`docs/ops/TWENTY_HARDENING.md`); local Whisper decision (needs a real Persian recording, `scripts/dev/stt_bakeoff.py --make-sample`); DB fixes (order 4815502353, user `authenticated_user`, SINGLE_DRAFT #101); a second copy of `~/Backups/roxira-legal/phase1_20261004/`; lawyer review of repeal list and benchmark answers; Iran-related account risk (Anthropic supported-country list, GitHub, Groq 403): keep local backups.
