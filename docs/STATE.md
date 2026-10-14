> **Last update: 2026-10-15. NEW CHAT? Read `docs/HANDOFF_2026-10-15.md` first (complete context), then this file. Older: `docs/STRATEGY_STATUS_2026-10-14.md`, `docs/SYSTEM_MAP.md`.**

# Current state (read this first)

Owner speaks Persian: reply in Persian; code, commits and docs in English. The owner wants FULL automation: do not hand them commands unless a secret or a physical action is needed.

## Operating model (changed 2026-10-14; older docs may say otherwise)
- **Hub** (Claude, Opus-class) plans, reviews diffs, tests locally, merges PRs itself (`gh pr merge N --repo Mahan-film/roxira-platform --squash --admin --delete-branch`; the owner's settings allow it; permission mode must not be Auto).
- **Workers** = server agents: `ssh roxira-prod '/opt/roxira_platform/scripts/infra/server_agents/run_task.sh --model ds-flash|--gateway --public [--tier light] --task-file /tmp/t.md --scope <dir>/ --slug <x>'`. Free tier first (`--gateway --public`), DeepSeek (`ds-flash`) for big/long tasks (Groq TPM is too small for large inputs). Stagger parallel launches ~15 s (worktree lock). Agents cannot run npm/tsc/jest: the hub verifies locally (node_modules exist in `.wt/keypool`). Retrieve: `git -c safe.directory='*' -C <worktree> format-patch -1 --stdout`.
- **Deploy is automatic**: systemd `roxira-autodeploy.timer` on srv1, every 5 min, deploys new `origin/main` with backup + migrate + smoke + legal gate + auto-rollback (`docs/ops/AUTODEPLOY.md`). Merge = release. Pause: `touch /opt/roxira_platform/.deploy-freeze`. Status: `/root/deploy-state/autodeploy-last.json`. `services/research` is outside the main compose: after changes run `bash services/research/install.sh --apply`; key pool: `bash scripts/infra/key_pool/install.sh --apply`.
- **Models: free first, paid fallback, also for product data** (owner decision, AGENTS.md §4; customers are test accounts). Ids only in `config/models.yaml` / `config/key_pool.yaml`.
- **Two people** may work in parallel: `bash scripts/dev/whoswhat.sh`, claim with `bash scripts/dev/claim.sh <n>` (`docs/COLLABORATION.md`).

## Live and working (srv1 = 91.107.248.99, ssh alias `roxira-prod`)
- **Smart Judge** ghazihoushmand.ir: landing at `/`, chat `/chat` (free-first via key-pool group `product-free`: Groq gpt-oss-120b x3 keys, Gemini Flash x2, Mistral-medium x4 keys -> paid DeepSeek; English-reasoning leak stripped), payments live (`PAYMENTS_LIVE=true`). Serving laws collection **`iran_laws_v5`** (= v3 + lease1376 fix + industrial property law 1403; recall@5 29/29; rollback = set `LIGHTRAG_QDRANT_COLLECTION=iran_laws_v3` and recreate `enterprise_app`). Rulings `iran_rulings_v1` in chat.
- **Public legal pages**: `/laws` 29 laws / 5,890 articles; `/precedents` 300 unity rulings; `/guides` 21 citation-checked guides; `/regulations` 33 circulars/resolutions (iran_regulations_v1, not yet in chat). All in `/sitemap_index.xml` (GSC + Bing verified).
- **Roxira portal** roxira.ir/.net: honest copy, no prices, pre-registration form stored (`enterprise_inquiries`). Enterprise modules (CRM, invoicing, accounting, HR, inventory, damages, tax compliance) are **tenant-isolated** (migrations 1789120000000–1789190000000); access = platform ADMIN or tenant OWNER (`requireTenantAdmin`). `/team` (members), CRM AI import (CSV + xlsx, `/crm/import`). Owner account = ADMIN + OWNER of the default tenant `00000000-…0001`.
- **Infra**: key pool LiteLLM `127.0.0.1:4000` (groups agent-strong-free, agent-light-free, product-free, agent-free-paid, private, embeddings; simple-shuffle — never usage-based-routing-v2), TEI embeddings (batch <= 4), research service `127.0.0.1:8090` (searx + tavily, `query_domains`), Xray REALITY VPN on 8443, backups/monitor/selfimprove timers.
- **Owner's Mac**: `ir.roxira.lawwatch` (ekhtebar, 6 h) + **`ir.roxira.iranrelay`** (regulation.tax.gov.ir, dotic.ir, rc.majlis.ir; Sat–Thu 09:30 & 11:00 Tehran, VPN must be OFF) both write to `~/Developer/roxira-lawwatch/data/legal/staged/` and `relay_publish.sh` opens a data PR; `ir.roxira.reposync` fast-forwards `~/Developer/roxira-platform` every 30 min and resets `core.bare` (it flips to true after app worktree cleanups — run `git --git-dir=~/Developer/roxira-platform/.git config core.bare false` if git says "must be run in a work tree").

## Next workstreams, in order
1. **Regulations v2 into chat**: agent `regulations-v2` (running 2026-10-15) adapts ingest to relay rows + golden set + eval; build `iran_regulations_v2`, eval, then set `SMARTJUDGE_REGULATIONS_COLLECTION`.
2. **Three missing laws** (customs 1390, guild system 1382 + 1403 amendment, direct taxes 1366): add their rc.majlis.ir law ids to `config/iran_relay.json` (`rc_law_ids`; find ids in Iranian office hours), relay fetches, stage, build v6 + eval.
3. **Lawyer review loop**: owner sends `~/Downloads/بازبینی_پاسخ‌های_قاضی_هوشمند_۱۴۰۵-۰۷-۲۲.docx`; turn the lawyer's verdicts into `lawyer_verified` golden cases and fix wrong answers.
4. **Moadian live integration** (`docs/research/MOADIAN_REQUIREMENTS_2026-10-14.md` §7 gaps: official wire format, token/send/inquiry, per-tenant keys).
5. **AI Software Factory MVP** (`docs/factory/AI_SOFTWARE_FACTORY_PRODUCT_PLAN_2026-10-14.md`, M1–M6, 26–40 days; tenancy M0 is done). Owner decision pending: shared app shell (recommended) vs app per customer.
6. AI data import for accounting/inventory/HR/invoices (`docs/factory/AI_DATA_IMPORT_PLAN.md`), dotic full-text parsing, dependency-bump batch (#413 #414 #519–521 #535–538) with a full build, review #345 #389 #392 #432.
7. Ops: LLM observability (Langfuse or LiteLLM logs → cost per answer), Qdrant cleanup of unused collections (keep v3 + v5), external uptime check, privacy page accuracy, old server 5.75.200.67 decommission (owner OK).

## Known issues
- Anonymous chat limit 10/hour/IP (`CHAT_ANON_HOURLY_LIMIT`): spread QA runs (server 127.0.0.1:8000, server public IP, Mac).
- Python on the Mac has no CA bundle for Iranian sites or ghazihoushmand.ir: use `/usr/bin/curl` (the relay already falls back to it).
- qavanin.ir answers with an ArvanCloud bot challenge: never bypass; it is not a relay source.
- Free-tier agents finish big tasks incompletely about half the time: re-run on `ds-flash` with a note listing what is missing.
- Agents key `OPENROUTER_API_KEY_AGENTS` has a $5 limit (≈$3 left on 2026-10-14); `CEREBRAS_API_KEY` is invalid.

## Waiting on the owner
- Send the lawyer review pack; bring the answers back.
- Optional: more free keys from *other* accounts (Groq, Gemini, a valid Cerebras, NVIDIA) via `scripts/ops/set_server_env.sh NAME`.
- Decide: factory MVP shell vs per-customer apps; when to decommission the old server; Langfuse cloud account (free) if wanted.
