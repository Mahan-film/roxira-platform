> **Plan: `docs/strategy/MASTER_PLAN_2026-10-16.md` (v2: factory first, then a global business via the Malaysian company; Track I Iran / Track G global). Owner decisions are in §0.**

> **Last update: 2026-10-22 (evening). NEW CHAT / OTHER AI? Start at `docs/CONTEXT_HUB.md`, then read this file, then `docs/HANDOFF_2026-10-15.md` (older context; the section "Shipped 2026-10-16..20" below supersedes it). Older: `docs/STRATEGY_STATUS_2026-10-14.md`, `docs/SYSTEM_MAP.md`.**

# Current state (read this first)

Owner speaks Persian: reply in Persian; code, commits and docs in English. The owner wants FULL automation: do not hand them commands unless a secret or a physical action is needed.

## Operating model (changed 2026-10-14; older docs may say otherwise)
- **Hub** (Claude, Opus-class) plans, reviews diffs, tests locally, merges PRs itself (`gh pr merge N --repo Mahan-film/roxira-platform --squash --admin --delete-branch`; the owner's settings allow it; permission mode must not be Auto).
- **Workers** = server agents: `ssh roxira-prod '/opt/roxira_platform/scripts/infra/server_agents/run_task.sh --model ds-flash|--gateway --public [--tier light] --task-file /tmp/t.md --scope <dir>/ --slug <x>'`. Free tier first (`--gateway --public`), DeepSeek (`ds-flash`) for big/long tasks (Groq TPM is too small for large inputs). Stagger parallel launches ~15 s (worktree lock). Agents cannot run npm/tsc/jest: the hub verifies locally (node_modules exist in `.wt/keypool`). Retrieve: `git -c safe.directory='*' -C <worktree> format-patch -1 --stdout`.
- **Deploy is automatic**: systemd `roxira-autodeploy.timer` on srv1, every 5 min, deploys new `origin/main` with backup + migrate + smoke + legal gate + auto-rollback (`docs/ops/AUTODEPLOY.md`). Merge = release. Pause: `touch /opt/roxira_platform/.deploy-freeze`. Status: `/root/deploy-state/autodeploy-last.json`. `services/research` is outside the main compose: after changes run `bash services/research/install.sh --apply`; key pool: `bash scripts/infra/key_pool/install.sh --apply`.
- **Models: free first, paid fallback, also for product data** (owner decision, AGENTS.md §4; customers are test accounts). Ids only in `config/models.yaml` / `config/key_pool.yaml`.
- **Two people** may work in parallel: `bash scripts/dev/whoswhat.sh`, claim with `bash scripts/dev/claim.sh <n>` (`docs/COLLABORATION.md`).

## Live and working (srv1 = 91.107.248.99, ssh alias `roxira-prod`)
- **Smart Judge** ghazihoushmand.ir: landing at `/`, chat `/chat` (free-first via key-pool group `product-free`: Groq gpt-oss-120b x3 keys, Gemini Flash x2, Mistral-medium x4 keys -> paid DeepSeek; English-reasoning leak stripped), payments live (`PAYMENTS_LIVE=true`). Serving laws collection **`iran_laws_v6`** since 2026-10-15 (= v5 + customs 1390 + guild 1382 + guild amendment 1392 from rc.majlis.ir; recall@5 37/37, no regressions; rollback = set `LIGHTRAG_QDRANT_COLLECTION=iran_laws_v5` and recreate `enterprise_app`, .env backup `/root/env-backups/.env.before-laws-v6`). Rulings `iran_rulings_v1` in chat.
- **Public legal pages**: `/laws` 29 laws / 5,890 articles; `/precedents` 300 unity rulings; `/guides` 51 citation-verified guides (31 on 2026-10-15); `/regulations` 112 circulars/resolutions/tax opinions. **Regulations are in chat** (`SMARTJUDGE_REGULATIONS_COLLECTION=iran_regulations_v2`, 539 rows: deregulation board + CBI + relay taxreg/dotic, recall@5 10/10; own prompt block + `regulations` response field, #671; rollback = empty the flag and recreate `enterprise_app`, .env backup `/root/env-backups/.env.before-regulations-v2`). PWA live (manifest + static-only service worker, #670); TWA guide `docs/ops/ANDROID_TWA.md` (owner needs Cafe Bazaar/Myket developer accounts). All in `/sitemap_index.xml` (GSC + Bing verified).
- **Roxira portal** roxira.ir/.net: honest copy, no prices, pre-registration form stored (`enterprise_inquiries`). Enterprise modules (CRM, invoicing, accounting, HR, inventory, damages, tax compliance) are **tenant-isolated** (migrations 1789120000000–1789190000000); access = platform ADMIN or tenant OWNER (`requireTenantAdmin`). `/team` (members), CRM AI import (CSV + xlsx, `/crm/import`). Owner account = ADMIN + OWNER of the default tenant `00000000-…0001`.
- **Infra**: key pool LiteLLM `127.0.0.1:4000` (groups agent-strong-free, agent-light-free, product-free, agent-free-paid, private, embeddings; simple-shuffle — never usage-based-routing-v2), query embeddings via Cloudflare Workers AI with TEI fallback (TEI batch <= 4), research service `127.0.0.1:8090` (searx + tavily, `query_domains`), Xray REALITY VPN on 8443, backups/monitor/selfimprove timers.
- **Owner's Mac**: `ir.roxira.lawwatch` (ekhtebar, 6 h) + **`ir.roxira.iranrelay`** (regulation.tax.gov.ir, dotic.ir, rc.majlis.ir; Sat–Thu 09:30 & 11:00 Tehran, VPN must be OFF) both write to `~/Developer/roxira-lawwatch/data/legal/staged/` and `relay_publish.sh` opens a data PR; `ir.roxira.reposync` fast-forwards `~/Developer/roxira-platform` every 30 min and resets `core.bare` (it flips to true after app worktree cleanups — run `git --git-dir=~/Developer/roxira-platform/.git config core.bare false` if git says "must be run in a work tree").

## Shipped 2026-10-22

- **Incidents**: ghazihoushmand.ir was NXDOMAIN at IRNIC for ~2 h (domain expired; owner renewed). srv1 root disk hit 100 % (build cache 8 GB, 71 agent worktrees 6.5 GB, unused images); cleaned to ~75 %. Smoke tests now hit the local origin (#773) so a DNS outage no longer rolls deploys back.
- **Lean architecture** (`docs/strategy/LEAN_ARCHITECTURE_2026-10-22.md`): **query embeddings on Cloudflare Workers AI `@cf/baai/bge-m3`** (`EMBED_BACKEND=cf`, `CF_ACCOUNT_ID`/`CF_AI_TOKEN` in .env; parity cosine 1.0000 vs TEI, legal gate 70 q in 20 s, strict recall@5 85.7 % = TEI, alias-aware 92.9 %; automatic fallback to TEI). Disk guard timer `roxira-disk-guard.timer` (hourly; build-cache prune, old agent worktrees, Telegram alert >= 88 %). Memory caps on every prod service (#780). nginx edge-cache headers for /laws, /regulations, /guides, sitemaps (2xx/3xx only; Cloudflare needs a Cache Rule to cache HTML). `vm.swappiness=20`. Modal dropped (GPU needs a card; CPU run hung).
- **Answer-quality flags** SMARTJUDGE_MUSTCITE_BOOST / SMARTJUDGE_QUERY_REWRITE measured: no gain, stay off. Legal gate is alias-aware for law names (#778).
- **Legal sources**: ekhtebar WordPress REST client `scripts/legal/ekhtebar_api.py` (tag/category/search/gaps; owner: ekhtebar is complete and trusted; ekhtebar.com = ekhtebar.ir); 167 CBI + registry circular rows staged (#782). `sync_sources.py` finds ekhtebar via www sitemap_index and reports budget-deferred pages separately (#776). Mac relay publishes through a temp worktree with dedupe (#778); 17 relay/law-watch files staged (#779).
- **Business suite** (`docs/strategy/ROXIRA_BUSINESS_SUITE_2026-10-22.md`): own NestJS modules (not ERPNext/Odoo). Live: app at **roxira.ir/app** (dashboard, CRM leads + pipeline, HR employees/contracts, inventory, accounting accounts/trial balance/journal, import wizard; Jalali dates) (#784); **AI import for every entity** (crm-leads, hr-employees, inventory-items, accounting-accounts, accounting-opening-balances; auto-detect, Persian/Jalali/rial normaliser, duplicate checks, import batches with undo; tables `data_import_batches`/`_items` with tenant_id) (#790); PDF and photo import via a vision model with `data_collection: deny` (#786). **Twenty CRM stopped** (data kept; restart command in `/root/deploy-state/disk-guard.log`).
- **Backups**: tier 4 = daily encrypted pg dump to the owner's Telegram (`roxira-telegram-offsite.timer` 04:15 UTC, age recipient `/etc/roxira-backup-age.pub`, private key only on the Mac; restore verified; `docs/ops/TELEGRAM_BACKUP.md`).
- **Monitor**: synthetic chat probe bypasses only the guest daily cap with `MONITOR_BYPASS_TOKEN` (#785). Agent runner no longer dies on diffs > 600 lines (#783).

### 2026-10-22 afternoon/evening
- **Deploy incident**: every backend deploy from #807 to #812 failed (Dockerfile did not copy the new `mcp/` dir)
  and was rolled back; the owner saw the old UI. Fixed in #813 (`COPY mcp ./mcp`). Lesson: a merge is not a deploy —
  check `autodeploy-last.json` / `autodeploy-failed-shas`, and build the image when adding a top-level dir.
- **Pricing**: `/pricing/plans` took ~20 s (Tetherland timeout, Nobitex DNS, old Wallex path 404, no failure cache,
  async route). #814: Tetherland(2 s) → Wallex markets → Exir → Ramzinex → Nobitex, 5-min failure backoff, sync
  routes. Now 0.02 s; USDT ≈ 271,000 toman.
- **Business suite**: multi-currency accounting core (#810: line currency/amount_fx/fx_rate/party_code, invoice
  currency, currency normaliser), whole-database import (#811 UI, #812 backend: SQLite/.sql/.zip, entity detection,
  relationship inference, 8 health checks; .sql/.zip dropped on the file tab switch to the database tab, #813),
  MCP server `/enterprise-hub/mcp` (#807), invoicing + VAT (#795), import limits 10/15 MB (#798).
  Owner's 86,031-row Gemini challenge DB (the .sqlite copy is malformed; the .sql works): analysis exact (5 real
  relationships, balance 116.5 trillion rials, all checks ok). **Isolated E2E commit test** (throwaway Postgres/Redis
  on srv1, `/root/rxtest_e2e.sh`, prod schema only): customers 7,998, items 4,000, invoices 16,000 written; **accounts
  3/31, journal lines 0, CRM activities 0, no undo batch row — being fixed** (account nature mapping from Persian
  groups, dependent tables, batch recording).
- **Cloud**: Cloudflare R2 bucket `roxira-uploads` (object-scoped, IP-restricted token; put/get/delete verified);
  Modal GPU works (workspace `mahanpikasso`, parity cosine 0.99999999; owner caps it at $30/month); Daytona key
  verified and an optional Daytona workbench backend merged (#804, not enabled yet).
- **Mail**: OpenDKIM never started (key dir 711) → all mail unsigned; fixed (750, owner opendkim), verified signed.
- **Security**: production npm advisories 0 high/critical (#799). **Dependabot leftovers** only in data/sandboxes,
  templates, projects (not deployed).
- **Legal corpus v7** built as `iran_laws_v7` (7,295 points) but **not switched** (r@1 72.9 → 67.1 %): duplicate law
  names (e.g. «وارده» vs «وارد شده»); alias dedupe queued (taskq 36).
- **Known gap**: migrations cannot build a fresh database from zero (the first migration assumes existing tables);
  needed for new environments and the factory.

## Shipped 2026-10-21

- Bake-off ladders (#753, docs/eval/MODEL_BAKEOFF_2026-10-20.md): free = Nemotron Ultra :free -> Groq gpt-oss-120b -> Gemini 3.8 Flash -> flash-lite; Pro = Haiku 5.5 -> DeepSeek V4 Pro -> GLM-5.3. Answer quality ~40-49/100 everywhere: retrieval/prompt is the bottleneck.
- Pricing: live USDT rate every 6 h, floor 280,000, margin 10% (SMARTJUDGE_PRICE_MARGIN_PCT). Basic 1.23M, Pro 3.08M, Premium 8.93M, Team 30.49M toman/month.
- Team tier $99 (#759): SJ_TEAM_*, 200/day, 20 answers/day on vip-team (Opus 5 -> Kimi K3 -> vip-pro); contract review for team + premium; sessions expire after 3 days (JWT_TTL_SECONDS=259200).
- Legal strategy (#760): multi-track case plan (criminal / civil-arbitration / disciplinary / other) with per-track retrieval and citation guard; chat chip + intake form.
- USDT panel opens as an overlay (#752); single draft payable in USDT. Next.js 16.4.2 (#754).
- Off-site: nightly Neon restore + hourly Codeberg mirror installed (#758), active once NEON_BACKUP_URL / CODEBERG_TOKEN are set.

## Shipped 2026-10-16..20 (all merged to main and deployed unless noted)
- **Pricing**: 4 tiers Free / Basic $4 / Pro $10 / Premium $29; annual = 10x monthly; toman = USD x max(live Tetherland rate, floor 280,000) (+ optional margin %). Daily chat caps: guest 3, free 8, basic 40, pro 60, premium 100, of which 5 Opus answers/day, then pro models (`CHAT_PREMIUM_TOP_DAILY_LIMIT=5`).
- **Model routing** (`docs/strategy/MODEL_ROUTING_DECISION_2026-10-17.md`): free users get free models only (own Gemini x4 / Groq / Mistral keys, then OpenRouter `:free`; never paid). Paid ladders: `vip-product` Haiku 5.5 -> DeepSeek V4.1 Flash; `vip-pro` DeepSeek V4 Pro -> Haiku -> GLM-5.3; `vip-premium` Opus 5 -> Kimi K3; every paid ladder ends in the free ladder. Anthropic hidden reasoning disabled; prompt-cache injection. Bake-off harness `scripts/eval/model_bakeoff.py` runs on srv1 (results `/var/lib/roxira-eval/bakeoff`).
- **Payments**: Zibal live (a real payment was verified 2026-10-20), result page with receipts, activation retry, verify rate limits, merchant id env-only. **USDT-TRC20 self-custody checkout live** (`CRYPTO_PAY_ENABLED=1`; poller `roxira-usdt-poll.timer` runs inside the app container; `docs/ops/CRYPTO_PAYMENTS.md`).
- **Auth**: phone OTP (auto-submit, WebOTP; Kavenegar template `ghazi-verify`) and email+password accounts with verification, live via the self-hosted mail relay `roxira_mail` (Postfix + DKIM selector rx1; SPF/DKIM/rDNS set for `mail.ghazihoushmand.ir`).
- **UI**: dark brand theme (`.ghazi-theme`), new emblem logo, landing with nav + login, e-namad seal always in the footer (owner rule), owner console at `https://ghazihoushmand.ir/owner` (admins = `SMARTJUDGE_ADMIN_PHONES`; `/admin` stays 404; `docs/ops/ADMIN_CONSOLE.md`), voice live chat with small-talk bypass and barge-in.
- **Content**: 51 citation-verified guides; legal sync from nezamat.ir / ekhtebar.ir (`scripts/legal/sync_sources.py`). qavanin.ir is behind an ArvanCloud challenge and is never bypassed.
- **Marketing**: Telegram channel @ghazihoushmand publishes approved posts (env `/etc/roxira-marketing.env`).
- **CRM dogfooding** (built, NOT yet enabled): `scripts/ops/crm/sync_to_twenty.py` + `roxira-crm-sync.timer` (03:30 UTC) sync users, plans, paid orders and tickets into Twenty; Twenty has 0 workspaces until the owner follows `docs/ops/CRM_SYNC.md`.
- **Security audit** `docs/security/SECURITY_AUDIT_2026-10-20.md`. Open: off-site backup (HIGH), ufw generic 80/443 rules, CSP enforce, dependency audits.
- **Open-source adoption audit**: `docs/research/OSS_ADOPTION_AUDIT_2026-10-20.md`.

## Software factory (built 2026-10-16, plan: docs/strategy/MASTER_PLAN_2026-10-16.md §4)
| Step | What | Where | State |
| --- | --- | --- | --- |
| F1 | Isolated checks for every agent run | scripts/infra/server_agents/workbench.sh (#691) | live |
| F2 | Task queue + model escalation (best -> free -> ds-flash -> strong) | scripts/infra/server_agents/taskq.py, systemd roxira-taskq (#692, #704) | live |
| F3 | Brief -> research -> spec -> owner approval in the bot | scripts/factory/brief_to_spec.py, docs/factory/HOUSE_STACK.md (#693-#695) | live; project my-legal-research specced |
| F4 | Golden SaaS chassis | templates/saas-chassis (#705) | built + verified (npm ci, tsc, lint, build) |
| F5 | Multi-project deploy | scripts/ops/projects/projectctl.py (#700) | built; for the global server |
| F6 | Marketing engine with approval | scripts/marketing/ (#702) | built; needs platform tokens |
| F7 | Umami analytics + weekly Persian KPI report | services/analytics, scripts/ops/kpi (#703) | built; inert until configured |
Also: gemini-best quality-first ladder over all AI Studio keys (#699; add GEMINI_API_KEY_2..4), G2 Malaysian law pilot pipeline (#701, internal eval only until AGC permission).

## Next workstreams, in order
0. **Business suite phase 2** (docs/strategy/ROXIRA_BUSINESS_SUITE_2026-10-22.md §4): owner tests roxira.ir/app with a real Excel; then invoicing UI + VAT, payroll per labour law, insurance list, bank statement import; Moodian after that. **Corpus v7**: v6 + 868 nezamat laws + relay + ekhtebar staged rows, cross-checked, embedded on Workers AI, legal gate must not drop.
1. **Missing laws**: **direct taxes 1366** (rc.majlis.ir 91488 has only the original text, e.g. art. 131 still 4%; needs a consolidated amended source) and the **1403 guild amendment** (no rc.majlis id found). Fix: guild-amendment rows are split on the quoted base-article headings, so chat cites «ماده 27 قانون اصلاح قانون نظام صنفی کشور»; relabel them as «ماده N قانون نظام صنفی کشور (اصلاحی 1392)» in `split_rc_law_articles.py` for v7. Relay rc ids: 801835, 94011, 866380.
2. Regulations: refresh `iran_regulations_v2` (or v3) when new relay batches land (build script takes `DST` + `BUILD_FILES`); frontend can render the `regulations` field as its own card.
3. **Lawyer review loop**: owner sends `~/Downloads/بازبینی_پاسخ‌های_قاضی_هوشمند_۱۴۰۵-۰۷-۲۲.docx`; turn the lawyer's verdicts into `lawyer_verified` golden cases and fix wrong answers.
4. **Moadian live integration** (`docs/research/MOADIAN_REQUIREMENTS_2026-10-14.md` §7 gaps: official wire format, token/send/inquiry, per-tenant keys).
5. **AI Software Factory MVP** (`docs/factory/AI_SOFTWARE_FACTORY_PRODUCT_PLAN_2026-10-14.md`, M1–M6, 26–40 days; tenancy M0 is done). Owner decision pending: shared app shell (recommended) vs app per customer.
6. AI data import for accounting/inventory/HR/invoices (`docs/factory/AI_DATA_IMPORT_PLAN.md`), dotic full-text parsing, dependency-bump batch (#413 #414 #519–521 #535–538) with a full build, review #345 #389 #392 #432.
7. **Solo-factory review** (`docs/research/SOLO_FACTORY_REVIEW_2026-10-15.md`), done 2026-10-15: control bot `scripts/ops/notify/` (#676; owner chose **Telegram**; waiting for `NOTIFY_BOT_TOKEN` via set_server_env.sh, then hub sets `NOTIFY_CHAT_ID` from getUpdates and runs `scripts/ops/notify/install.sh --apply`), key-pool cost log `/var/log/roxira-keypool/requests.jsonl` + `cost_report.py` (#677, installed), weekly mutation timer (#678, installed). The cost log found two bugs, both fixed: product chat fell back onto the agents' $5 key (#679, now `private`), and Groq/Mistral rejected the OpenRouter-only `usage`/`reasoning` fields so free models never answered (#680). DMARC: owner adds TXT records by hand (p=none).
   Also done 2026-10-15: Hypothesis property tests for the legal parsers (#683); throwaway agent DBs `scripts/infra/agent_db/agent_db.sh` (template = live schema + migrations rows, no data; hourly gc timer) and daily SBOM/vuln scan `roxira-sbom` (#684; summary `/root/deploy-state/sbom/summary.txt`). First scan fixes: Alpine `apk upgrade` in backend/frontend (#685: Critical 10→4, 8→2) and Dependabot #537. Open: key pool image (LiteLLM 1.77.7, 34 Critical in OS libs): `main-v1.83.14-stable.patch.3` breaks `/v1/embeddings` to TEI (tested side by side 2026-10-15), so either a derived image `FROM litellm:1.77.7 + apk upgrade` or wait for a fixed release; app image Debian curl CVEs have no fix yet. Agents' OpenRouter key (`OPENROUTER_API_KEY_AGENTS`) is OUT OF CREDIT: free-tier agents fail on tool-permission rules, so the hub wrote #684 itself.
8. Ops: LLM observability (Langfuse or LiteLLM logs → cost per answer), Qdrant cleanup of unused collections (keep v3 + v5), external uptime check, privacy page accuracy, old server 5.75.200.67 decommission (owner OK).

## Known issues
- Anonymous chat limit 10/hour/IP (`CHAT_ANON_HOURLY_LIMIT`): spread QA runs (server 127.0.0.1:8000, server public IP, Mac).
- Python on the Mac has no CA bundle for Iranian sites or ghazihoushmand.ir: use `/usr/bin/curl` (the relay already falls back to it).
- qavanin.ir answers with an ArvanCloud bot challenge: never bypass; it is not a relay source.
- Free-tier agents finish big tasks incompletely about half the time: re-run on `ds-flash` with a note listing what is missing.
- Agents key `OPENROUTER_API_KEY_AGENTS` has a $5 limit (≈$3 left on 2026-10-14); `CEREBRAS_API_KEY` is invalid.

## Waiting on the owner
- Off-site backup storage (HIGH, from the security audit); fix the roxira.ir DKIM record typo; set the Kavenegar template's last line to `@ghazihoushmand.ir #%token`; make one test USDT purchase; create the Twenty workspace + API key and enable the CRM sync timer (`docs/ops/CRM_SYNC.md`).
- Send the lawyer review pack; bring the answers back.
- Optional: more free keys from *other* accounts (Groq, Gemini, a valid Cerebras, NVIDIA) via `scripts/ops/set_server_env.sh NAME`.
- Decide: factory MVP shell vs per-customer apps; when to decommission the old server; Langfuse cloud account (free) if wanted.
