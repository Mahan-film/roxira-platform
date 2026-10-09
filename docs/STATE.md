> **Last update: 2026-10-09. Read `docs/HANDOFF_2026-10-04.md` for the full picture; this file is the short, current snapshot. Then `docs/SYSTEM_MAP.md`, then `docs/STRATEGY.md` only as needed.**

# Current state (read this first)

Owner speaks Persian: reply in Persian; code, commits and docs in English. Hub = strategist/architect (Opus-class), workers = cheap models (`rx <issue> dsflash`) or Claude `implementer` subagents in worktrees. The hub never merges or deploys: the owner does (`gh pr merge N --repo Mahan-film/roxira-platform --squash --admin --delete-branch`, ONE command per message; the owner's terminal Run buttons replay old blocks, so ask them to type or paste into a new tab).

## Rules that changed in 2026-10 (older docs may still say otherwise)
- GitHub Actions is OFF (zero spend). CI = `bash scripts/dev/local_ci.sh` (about 1230 tests, quarantined). Never run pytest over `src/` or the repo root. Auto-deploy via Actions does NOT exist: deploys go through `scripts/ops/deploy_local.sh` (owner-run).
- Keys only in `~/Secrets/roxira/roxira.env` (chmod 600). Never print or ask for values. Server `.env` writes only through `scripts/ops/set_server_env.sh` (owner-run).
- Autonomy ladder `config/autonomy_ladder.json`: L0 docs, L1 non-sensitive code, L2 smartjudge prompts/retrieval/corpus/models.yaml (`hub-approved`), L3 auth/billing/migrations (owner reads), L4 `.github`, `scripts/ci`, `scripts/ops`, rx, compose, nginx (owner writes).
- Case data never goes to a `:free` model. Model ids only in `config/models.yaml`.
- Every agent worktree: run full `local_ci.sh` before the PR. Test files must not run code at import (quarantine guard).
- Claude desktop app leaves `core.bare=true`: run `git config core.bare false` at the start of every bash chain; launch agents one at a time.

## LIVE on prod (verified read-only 2026-10-09): main bea3d19 (#518)
Deployed with `deploy_local.sh` on 2026-10-04 (537d94c0, smoke test green, `/health` minimal, `/admin` 404 on all 3 domains); #516-#518 (Qdrant `iran_laws_mistral_v1` with 1444 points, live fallback via SearXNG, Persian STT `language=fa`, parallel legal engine) were later applied on the server by hand, NOT through `deploy_local.sh` (so `/root/deploy-state/prev_commit` is stale at 160081b: rollback would go to the wrong commit). CRM migration `AddCrmTenantIsolation` applied (tenant_id NOT NULL on crm_leads/contact_messages; pg_dump backup `/root/deploy-state/db-backups/20261004-152742.dump`). Server `.env` has GOOGLE_CLIENT_ID/SECRET, ADMIN_HEALTH_KEY, JWT_SECRET, KAVENEGAR_API_KEY (names only); its backups are in `/root/deploy-state/env-backups/`.
Collections on prod Qdrant: `iran_laws_mistral_v1` 1444 (served), `iran_laws_v2` 5083, plus precedents, circulars, advisory opinions.

## URGENT, found 2026-10-09 (all read-only evidence, nothing fixed yet)
1. **Server git tree is in a merge-conflict state**: `UU docker-compose.prod.yml` with conflict markers (left by a `git stash pop`), 3 stashes pending. The running containers are fine, but ANY `docker compose` command or `deploy_local.sh deploy/migrate` will fail or refuse (dirty tree). The conflict is in `roxira_app_prod` volumes: the live container uses the upstream side (`/usr/bin/docker:ro`). Fix (owner approves, server write): `git restore --source=HEAD --staged --worktree docker-compose.prod.yml`, then `git status --short` must be empty; keep the stashes until reviewed (they may hold server-only changes).
2. **Disk 96% full (7 GB free of 150 GB)**: Docker images 75 GB (45 GB reclaimable), build cache 38 GB. Safe order: `docker builder prune -f` first, then list unused images and prune per image after review. Never prune volumes. AGENTS.md section 6 bans bulk destructive commands: audit first, owner approves.
3. `roxira_enterprise_backend` mounts `/var/run/docker.sock` (root-equivalent; was on the S1 list: remove it, the Dockerfile also installs docker-cli).
4. Deploys outside `deploy_local.sh` break rollback bookkeeping; from now on only `deploy_local.sh` deploys.

## NEXT STEPS, in order (owner types each, hub reads the output)
1. Fix item 1 and 2 above (needs the owner). Then run `bash scripts/ops/deploy_local.sh check`.
2. Owner runs `python3 scripts/legal/fetch_laws.py --dry-run` from their own network (`docs/ops/LEGAL_FETCH_LAWS.md`), then the real fetch. ekhtebar.ir works (cybercrime law matched at 0.9); qavanin.ir reachable; rc.majlis.ir, rrk.ir unreachable, dotic.ir 403 (never bypass).
3. Corpus: `data/legal/phase1_canonical.jsonl` (1444 articles, 17 laws) is clean and already served from `iran_laws_mistral_v1`. Add new laws only through `scripts/legal/ingest_pipeline.py` (validate -> plan -> apply -> eval), into a NEW collection with a rollback switch; owner yes + lawyer signs the repeal list.
4. Evaluation: 50-question Persian legal set. The owner's Deep Research draft (in `~/Downloads`) has UNVERIFIED article numbers (several look wrong): treat every statutory authority as TO-VERIFY and have a lawyer check; never use it as automatic ground truth. Promptfoo gate in `local_ci`.
5. Model roles: bake-off `docs/research/BAKEOFF_2026-10-04.md` (Gemini 3.8 Flash 0.23 pass, others <= 0.07, no RAG). Candidate reviewer = Gemini 3.8 Flash (different family from the DeepSeek executor). Decide in `config/models.yaml` (L2).
6. Secrets plan from `docs/research/SECRETS_AND_SAFE_DEPLOY_2026-10.md` (sops+age, fail-closed `redact` filter, rotate any key that was ever printed; expand/contract migrations; health-poll instead of `sleep 20`; off-box backups). Never give the owner a command that prints env values.
7. Commit-ready audit report was NOT produced (agents hit usage limits); rerun `docs/research/AUDIT_2026-10-04.md` scope with a general-purpose agent when limits reset.

## Tools verdicts (docs/research/TOOLS_ADOPTION_2026-10.md)
ADOPT/TRY: SearXNG + Crawl4AI (server), Wayback CDX client, Tesseract `fas` baseline vs Surya/Docling on 20 gazette pages, Promptfoo, bge-reranker-v2-m3 behind a flag. SKIP: Flowise (archived), Composio (SaaS), n8n, Dify, Mem0. AVOID: HexStrike AI ("Hexbot" ambiguous: ask the owner which one; never install the offensive tool).

## Known open work (see HANDOFF for detail)
rx not wired to `src/factory_pipeline/task_caps.py`; `opencode serve` spike; product split (smart-judge / roxira / core) not started beyond import-boundary check; header token count hard-coded 0, Persian digits remain in `formatPersianNumber`; about 230 stale worktrees and about 20 stale/Dependabot PRs (open: #519-#521, #445, #446, #432, #414, #413, #407-#401 etc.) (do NOT merge Dependabot majors); backend Dockerfile runner stage has no ts-node (migrate uses a one-off `--target deps` image instead); `set_server_env.sh` rewrite fails if server `.env` holds only that variable.

## Waiting on the owner
Merges; the `migrate`/`deploy` runs above; Twenty CRM hardening (`docs/ops/TWENTY_HARDENING.md`); local Whisper decision (needs a real Persian recording, `scripts/dev/stt_bakeoff.py --make-sample`); DB fixes (order 4815502353, user `authenticated_user`, SINGLE_DRAFT #101); a second copy of `~/Backups/roxira-legal/phase1_20261004/`; lawyer review of repeal list and benchmark answers; Iran-related account risk (Anthropic supported-country list, GitHub, Groq 403): keep local backups.
