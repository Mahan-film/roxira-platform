# Current state (read this first)

Short snapshot for a new chat. `docs/STRATEGY.md` explains **why** (incl. the "Role rule"); this file says **where we are now**. Every chat updates it through `/handoff`. Keep it under 100 lines. Last update: 2026-09-30 (hub, Sonnet 5.5).

## Roles and lanes (hard rule)
- Opus = big decisions only. Day-to-day hub = Sonnet: writes specs as GitHub issues, reviews PRs, merges, asks the owner ONE question before any prod deploy. The hub never implements product code.
- Implementation lanes, in order: (1) GitHub `agent` label (OpenCode+DeepSeek on GitHub runners; unreliable today: can report success with no PR, issue #99, queue fix #77 not delivered); (2) owner runs `rx <issue>` / `rxall <issues…>` on the Mac (OpenCode pool/dsflash; OpenCode has no shell tool, so `git show`-style jobs fail: do those with a tiny script); (3) Claude subagents only as last resort, one at a time (they exhausted the weekly limit on 2026-09-28).
- Mac tools: `~/bin/rx`, `~/bin/rxall` (also linked in /opt/homebrew/bin), LiteLLM pool in Docker (`~/.config/litellm/`), OpenCode config `~/.config/opencode/opencode.json`. Gemini CLI / `agy` installed for low-level tasks only.

## Live and working (prod `5.75.200.67`, deployed main ≥ 2026-09-29)
- Site https://ghazihoushmand.ir: real Zibal payments, fixed Toman prices (single draft 100k, VIP monthly 490k, voice pack 63k, diaspora 1.015M; env `PRICE_TOMAN_*`), glass UI, SMS OTP login (Kavenegar), STT/TTS voice, `/health` 200, `uptime.yml` green.
- Payment callback fixed (#100): legacy Zibal callback only redirects; real verify via `payment_orders`. Citation guard restored verbatim (#132, sha256 verified) after daemon commit 2b605a1 deleted it.
- Answer retrieval uses Qdrant `iran_laws_v2` (4,243 pts, 8 laws; env `LIGHTRAG_QDRANT_COLLECTION`); the citation guard still uses old `iran_laws_bge_m3` (issue #117).
- Security: runner removed; `roxira-worker.timer` disabled; `/factory` routes removed from nginx (#131); `roxira-autodaemon` (health audit only) still runs; owner 2FA on; paid GitHub Advanced Security deliberately NOT enabled. Rule: model/agent code never runs on prod.
- Keys: prod uses OpenRouter key `roxira-prod-chat` (cap $3/day) in `/opt/roxira_platform/.env`; GitHub agents and the Mac share key `roxira-agent` (cap raised to $4/day: set back to $2). Old keys revoked. Never paste keys in chat.
- Ruleset `main-protection`: PR + checks Detect changes, Secret scan, Pytest (unit), Frontend gate. Weekly deps audit workflow (#127).
- Resilience merged but NOT installed on prod: `scripts/ops/deploy.sh` (auto-rollback; recreates nginx when nginx.conf changed), `rollback.sh`, `backup.sh`, compose healthchecks (#81). The existing hourly backup cron + daily pull to the Mac stay in charge. Restore drill: `docs/ops/RESTORE_DRILL.md`.
- Config: `config/models.yaml` prices corrected 2026-09-29 (#109). Cheap tier now sends `reasoning: {enabled:false}` (#135, merged, **not deployed**).

## Waiting on the owner
1. VPN/network: OpenRouter returns 403 "Access denied" for the Mac's IP (the server key still works). Change VPN location, then `curl -s -o /dev/null -w "%{http_code}" https://openrouter.ai/api/v1/models` must print 200.
2. Approve ONE deploy for #135 and any newer merges. Then re-run the quality eval: `SSL_CERT_FILE=$(python3 -c "import certifi;print(certifi.where())") python3 scripts/eval_cheap_tier.py --models deepseek/deepseek-v4-flash,deepseek/deepseek-v4.1-flash --n 30 --budget-usd 1.00` (qwen3.8-flash is blocked by the account's ZDR setting).
3. DB fixes (explicit approval needed): owner's order 4815502353 is paid but `pending`; revoke fake user `authenticated_user`. Design SINGLE_DRAFT credits (#101; needs a reviewed migration).
4. A lawyer must review `لایحه اصلاحی قانون تجارت` (possibly a bill, stored as active).
5. Server housekeeping: kernel reboot, delete old `.env.bak.*`, `git checkout` the 2 radar files, an nginx-recreate window for compose healthchecks.

## Next workstreams
| Id | What | Lane |
| --- | --- | --- |
| W25 | Legal coverage (`docs/LEGAL_COVERAGE_ROADMAP.md`): #138 exact article lookup, #139 coverage manifest, #140 public coverage page, then ingest waves | rx / agent |
| W9b | Research system: #93 (PR #96 red CI), #94, #95 | rx |
| W20b | Gemini Live voice (#84) | rx |
| misc | #117 guard collection env, #122 F821 CI check, #99 agent no-change status, #77 queue, #66 cost report, #113 pin prod Python deps, #67 Kimi role | rx / agent |

## Known issues
- Legal search is weak on exact lookups («ماده ۱۰» returned 1010) and covers only 8 laws; marketing text overclaims (fix in #140).
- Token packs are "coming soon" (no backend plan).
- No secondary sources (circulars, advisory opinions, cabinet decrees, rulings) in the corpus.
- Keys remain in git history (owner chose not to rotate). `@RTK.md` is loaded globally; rtk is installed.
- `pytest`/`git` may be intercepted by the rtk wrapper: use `python3 -m pytest <file>` and `/usr/bin/git`.
