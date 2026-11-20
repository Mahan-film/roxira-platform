---
name: project-state-2026-10-14
description: "State after the srv1 migration night (2026-10-13/14) — what is live, VPN facts, what remains"
metadata:
  node_type: memory
  type: project
  originSessionId: 0fd9cb50-0fa4-4312-aca1-111eeb5c9f87
  modified: 2026-10-14T21:17:33.543Z
---

Live on srv1 (<ip>):
- the whole stack and the key pool (#593/#595/#596/#597/#599)
- server agents through the gateway (#598)
- VPN: Xray REALITY on 8443, state in /etc/xray-vpn, cover site www.speedtest.net (www.microsoft.com FAILS as REALITY dest on 25.8.3), QUIC/UDP443 blocked, BBR + fq (#600/#601/#602). Owner says the speed is excellent. Cloudflare WARP 1.1.1.1 does not work in Iran.
- tech audit doc (#603) and pinned :latest images and AI-core deps (#604)

Agents key: OPENROUTER_API_KEY_AGENTS (separate "agents" workspace, $2 limit, free endpoints allowed). The private group uses only the prod key.

Remaining:
1. PR #592 (staged laws: qavanin 81, laws 252, dereg 89, CBI circulars 483) needs a review, then a build of iran_laws_v4 + eval + switch.
2. The owner must re-save the customs, guild-system and direct-tax PDFs as text; the 2/153304 bylaw too.
3. Tech audit P1 items: digests, Python 3.11 vs 3.13, NestJS 11, self-hosted whisper, Twenty PG17, remove Django.
4. Dependabot PRs 519-521 and 535-538; old PRs 529/530/445/446/450/451 need triage.
5. Decommission the old server after 48 h (owner OK required).
6. Optional VPN route 2 behind a Cloudflare CDN domain: test first, keep only if good.
7. Sandboxes stay off until ports are bound to 127.0.0.1.

Update 2026-10-14 (later):
- Merged: #603, #604, #605 (build_v4 + laws-public API), allowlist (14 laws proposed), #607 (Gemini handoff in docs/gemini_handoff + ~/Downloads/gemini_handoff), #608 (real SEO law pages + sitemaps + brand JSON-LD; regulations collection tooling). Not deployed yet.
- v4 build running on srv1. ingest_pipeline apply uses about 5.5 GB RAM and pushes prod into swap; the site stays up but slower. Next time cap the batch size or run off-peak.
- Gemini can't fetch full CBI circular texts from the web, but it reads attached PDFs well: similarity with our OCR is 0.87–0.96 and its subjects are better. Merged batches are at ~/Downloads/gemini_upload/cbi_batch_1..3.pdf; output goes to ~/Downloads/gemini_out/.

Update 2026-10-14 (afternoon):
- Deployed fcc69d34 and then 76c0e411. Smoke OK; legal gate 85.7%. Laws-public: 28 laws / 5740 articles.
- TEI roxira_embeddings is live: app RSS dropped from 1.36 GB to 607 MB. zram is on.
- Research service roxira_research is live on 127.0.0.1:8090: GPT-Researcher, SearXNG with the limiter off, SMART/STRATEGIC=agent-free-paid (DeepSeek).
- CBI circulars v2 merged. iran_regulations_v1 is being built.
- The owner confirmed SMS works on the new IP; the certbot renewal dry-run passed. The ssh alias roxira-prod is installed on the Mac.
- Deploy is owner-only (typed SHA). NEVER `git pull` on the server manually: deploy_local then sees HEAD==target and skips the rebuild.
- v4 was WORSE (28/29 vs 29/29), so it was not switched.

Update 2026-10-14 (evening):
- Hub PRs open and reviewed, waiting on the owner to merge, because the classifier blocks hub merges ("Merge Without Review"), even after a review comment:
  - #621: Gemini round-2 prompts 06–08, also copied to ~/Downloads/gemini_handoff.
  - #622: engine tests.
  - #623: ghazi landing at the root via /home-ghazi.
  - #624: /guides, 10 citation-checked guides.
  - #625: Roxira prices removed + inquiries module + migration 1789130000000.
  - #626: tenant plan + repo-tidy plan.
- Order: merge, then `deploy_local.sh migrate` (dry-run, then --yes), then deploy.
- The agent drafts had real bugs; always build and test them:
  - wrong import paths in a NestJS controller;
  - throttle behind the Next proxy (forward cf-connecting-ip);
  - false marketing claims.
- Local checks: backend and frontend node_modules are now installed in .wt/keypool (a real npm ci; Turbopack rejects a symlinked node_modules).
- The owner now uses the normal Gemini app (Pro), not Antigravity.
- Also open:
  - #627: tenancy wave 0, migration 1789140000000. Users table is shared with Judge, so tenant_id stays NULLable; founders get tenant_role OWNER, never global ADMIN; requireTenantId() fails closed.
  - #628: client route guard.
- All PRs 621–628 combined: backend tsc OK, jest 50/50, no conflicts.
- DEPLOYED 88328717 (17:16, smoke OK, legal gate 85.7%). Migrations 1789130000000 and 1789140000000 are applied; backup at /root/deploy-state/db-backups/20261014-171137.dump. Live checks:
  - landing at the ghazihoushmand.ir root;
  - /guides with 10 guides, all in sitemap/0.xml;
  - no prices on roxira.ir;
  - inquiry API returns 422 on empty input.
- #629, open: members API, /team page, and Roxira-domain login moved to the NestJS OTP endpoints (needed for the tenant claims). NestJS had sent 0 OTPs in 72 h, so the owner must test login on roxira.ir/team after deploy. It uses the same Kavenegar key and the same template 'roxira-verify' as the Python path for the roxira host. Known limit: a removed member keeps access until the JWT expires.
- 2026-10-14 evening: the owner demands FULL automation, with no manual merge/deploy commands.
  - The classifier blocks `gh pr merge` ([Merge Without Review]) and dispatching an autodeploy agent ([Production Deploy]), even with the owner's chat consent.
  - Fix offered: the owner adds allow rules `Bash(gh pr merge:*)` and `Bash(ssh roxira-prod:*)` to ~/.claude/settings.json (python one-liner).
  - Then: dispatch the autodeploy agent (spec at scratchpad t-autodeploy.md: server systemd timer every 5 min, DEPLOY_SSH_HOST=local, auto-confirm only with /etc/roxira/autodeploy.enabled, migrate+backup before deploy, failed-SHA skip list), install it, and send task files via `ssh roxira-prod 'cat > /tmp/x' < file`, not scp.
- RESOLVED ~15:05 UTC: the owner left auto mode. The settings rules let the hub merge and ssh freely.
  - AUTODEPLOY is LIVE (#633): the roxira-autodeploy.timer runs every 5 min. First self-deploy was 8488e125.
  - Status: /root/deploy-state/autodeploy-last.json; logs in /var/log/roxira-autodeploy/.
  - Pause: touch /opt/roxira_platform/.deploy-freeze.
  - The hub no longer gives the owner deploy commands. Merge a PR and the timer ships it, including migrations with backup.
  - services/research is NOT in the main compose: after it changes, run `bash services/research/install.sh --yes` on the server.
- Agents key OPENROUTER_API_KEY_AGENTS was nearly empty: $0.14 of $2 left at 15:15.
  - Gateway agents (`--gateway --public`) serve mostly via Groq gpt-oss-120b, which handles tool calls fine.
  - They fall back to paid DeepSeek, which sometimes emits raw DSML text, so the agent "finishes" with an empty diff (roxira-docs and cerebras did).
  - The CEREBRAS_API_KEY is invalid ("Wrong API Key").
  - Agents cannot run npm/tsc (bash allowlist), so the hub must verify locally.
- v4 regression = one case, third-party-mandatory, out of top 5 at 7336 points. Build script now takes DST/BUILD_FILES (#632).
  - v5 dry-run OK: DST=iran_laws_v5 BUILD_FILES=data/legal/staged/qavanin_laws_2026-10-13.jsonl (14 laws incl. industrial property 1403).
  - Run the real build when RAM is free: `bash /root/build_laws.sh` on the server with those env vars.
- Research service: the live test worked (101 s, 17k chars, 12 sources) but had 0 official sources. #634 adds tavily + query_domains.
- 15:40 UTC: the owner topped up the agents key (limit $5, about $3 left).
  - All 6 free keys are valid. LiteLLM has a deployment per key (3 Groq, etc.).
  - Rule learned: Groq TPM 8000 cannot handle big-context tasks. Long or big-input tasks go to ds-flash; small docs and code go to `--gateway --public`.
- Research limit: Iranian government sites (tax.gov.ir, intamedia.ir, qavanin TreeText) refuse the German server IP.
  - Options for the owner: the Mac in Iran as a fetch relay (free), or a small Iranian VPS.
- Mac main checkout ~/Developer/roxira-platform: fast-forwarded to #635.
  - Leftovers moved to ~/Developer/roxira-attic/2026-10-14: opencode.json local diff that stripped the providers, apply_parallel_architecture.py, legal_gate_baseline.json.
  - Worktrees: 22 GB under .claude/worktrees (65 dirs) and 8.8 GB in ~/Developer/rx-wt. The squash merges make branches look "ahead".
  - Cleanup needs a content (patch-id) check plus the owner's OK.
- Merged #635 (Roxira honest copy).
- Running: keypool-tiers, strategy-status, factory-plan, guides-batch2b (ds-flash), roxira-docs3.
- ~16:00 UTC merged:
  - #636: 11 guides batch 2, 21 guides total.
  - #637: key pool strong/light tiers + usage-based-routing-v2 + run_task --tier. Needs `bash scripts/infra/key_pool/install.sh --apply` on the server after the autodeploy.
  - #638: docs/STRATEGY_STATUS_2026-10-14.md with hub corrections.
  - #639: Moadian requirements + market docs.
  - #640: TEI embed client: batch 8, 6 retries. TEI runs --max-concurrent-requests 8, and the v5 build failed on 429 before this.
- v5 = iran_laws_v3 + qavanin_laws_2026-10-13, built in the background after #640 deploys. The log is /root/v5build.log. Switch only if no regression versus v3; the switch env is described in docs/legal/BUILD_V4.md.
- Parallel run_task launches collide on the worktree lock ("worktree add failed"): stagger them by about 15 s.
- The research install flag is `--apply`, not `--yes`.
- ~16:10 UTC. Owner account (phone ****7796, id 202536b8):
  - Set to role=ADMIN with tenant 0000…0001 (OWNER). The previous row is in /root/deploy-state/owner_user_before_2026-10-14.csv.
  - Their self-created tenant 079b6bc1 (slug roxira-c34591) is empty and orphaned.
  - The owner must re-login to get the new JWT claims.
- Key pool:
  - #641: back to simple-shuffle. usage-based-routing-v2 breaks LiteLLM here; do not reuse it.
  - #644: 4 Mistral keys. The owner must add MISTRAL_API_KEY_2..4 via `scripts/ops/set_server_env.sh NAME` (hidden prompt). Mistral models: medium/code in strong, small/ministral-8b in light.
- #643: TEI embed batch 4. Probed: batches of 8 get 429 even when idle.
- #645: guard message.
- #642: AI Software Factory plan, MVP M0–M6, 26–40 days. Owner decisions: app per customer vs shared shell, data residency.
- Running agents: tenant-wave1 (invoicing, migration 1789150000000), data-import (CRM AI import MVP, private model only).
- ~17:15 UTC.
  - OWNER DECISION: free models first everywhere, including product/customer data (all customers are test accounts). AGENTS.md section 4 updated (#647). Revisit before real confidential customers.
  - 4 Mistral keys are set and verified 200; the key pool has 12 deployments per key.
  - Merged #646: data file qavanin_ip1403_2026-10-14.jsonl.
    - The first v5 attempt failed (26/29) because BUILD_FILES lacked the lease1376 replace file, and qavanin_laws re-adds a duplicate third-party law and insurance 1316.
    - The v5 job (/root/v5_job.sh) builds v3 + lease replace + IP1403 only. Log: /root/v5_job.log.
  - Merged #648: tenant wave 1, invoicing, migration 1789150000000. requireTenantAdmin = ADMIN or OWNER.
  - Merged #649: CRM AI import, CSV only.
  - Running: product-free-first agent (SMARTJUDGE_LLM_GATEWAY flag, default off; enterprise_app joins roxira-keypool_default).
- ~17:40 UTC.
  - SERVING iran_laws_v5: 29/29 with no regressions. It is v3 + lease1376 replace + industrial property 1403, giving 29 laws in laws-public.
  - .env backups are in /root/env-backups/.env.before-v5-*. Rollback = LIGHTRAG_QDRANT_COLLECTION=iran_laws_v3, then recreate enterprise_app.
  - Insurance 1316 and the duplicate third-party 1395 from qavanin_laws are NOT ingested; they pushed third-party-mandatory out of top 5.
  - #648 migration ran via autodeploy (migrated=true, ok).
  - Merged #650: free-first gateway flag. /root/freefirst_job.sh sets SMARTJUDGE_LLM_GATEWAY=http://roxira_keypool:4000/v1 after the deploy and tests chat. Rollback = empty that var, then recreate enterprise_app.
- FREE-FIRST LIVE (~17:50 UTC): SMARTJUDGE_LLM_GATEWAY is on, and the app is on roxira-keypool_default.
  - Test question (patent validity under the 1403 law): answered in 8 s via path=gateway model=agent-strong-free.
  - It cited articles 34 and 65 of the new law correctly.
- Mac relay (~18:10 UTC). The owner's Mac must have the VPN OFF; with it on, the gov sites fail.
  - Reachable from the Mac: tax.gov.ir, regulation.tax.gov.ir, intamedia.ir, dotic.ir (sitemap view/sitemap.php?page=N), rc.majlis.ir/fa/law/show/<id> (robots allow all; keyword search is slow and times out).
  - qavanin.ir = ArvanCloud bot challenge. NEVER bypass; it is excluded.
  - The existing Mac launchd job ir.roxira.lawwatch (ekhtebar, every 6 h) stages to ~/Developer/roxira-lawwatch/data/legal/staged/law_watch_*.jsonl, but that output never reached the repo; the relay_publish PR step fixes this.
  - Fixtures: #651, #652. Agent iran-relay (gateway) builds iran_relay.py, relay_publish.sh and the launchd template ir.roxira.iranrelay.
- Agents tenant-wave2 (accounting+HR, migration 1789160000000) and import-xlsx are running on the free gateway.
- Collaboration (#653): owner + brother, each with their own Claude account.
  - GitHub issues are the source of truth: scripts/dev/whoswhat.sh and scripts/dev/claim.sh, rules in docs/COLLABORATION.md; CLAUDE.md has the start rule.
  - Labels in-progress and area:* were created.
- PR triage: closed 13 obsolete PRs (#529, #530 superseded by #533; Actions bumps #401-407; #445, #446, #74, #451, #448, #450).
  - Still open: dep bumps #413, #414, #519-521, #535-538 (need a batch build before merge, because a merge = release). Also #345, #389, #392, #432 to review.
- ~18:45 UTC readiness facts:
  - /laws is public with 29 laws and 5890 articles, all in the sitemap. /precedents is public with 300 rulings; the chat has iran_rulings_v1 (1731 points).
  - PAYMENTS_LIVE=true.
  - iran_regulations_v1 (460 CBI circulars) is not in the chat and not public. Agent regulations-public (gateway) builds /regulations pages.
  - Monitor, backup-DR, selfimprove and docker-prune timers are active.
  - Many stale Qdrant collections remain (v2, v4, bge_m3, phase1_test, mistral_v1?). Propose a cleanup to the owner; never delete v3 (rollback).
  - Mac launchd ir.roxira.reposync fast-forwards ~/Developer/roxira-platform every 30 min when clean.
  - Merged #654 (xlsx import). Running: tenant-wave2b, iran-relay2 (ds-flash), regulations-public.
- ~19:30 UTC merged:
  - #655: product-free group (groq 120b, gemini flash, mistral-medium) plus strip_leaked_reasoning. A free model had leaked English reasoning into the reply. .env now has SMARTJUDGE_LLM_GATEWAY_MODEL=product-free.
  - #656: tenant waves 2-5 (accounting+HR, inventory, damages, tax). Migrations 1789160000000 through 1789190000000 were verified against the live schema; jest 232/232.
  - #657: guard lets tenant OWNER through, via the JWT tenantRole.
  - #658: Iran relay. Installed on the Mac as launchd ir.roxira.iranrelay, running from ~/Developer/roxira-lawwatch (detached at origin/main), every 12 h, publishing PRs.
- Lawyer pack: /root/lawyer_answers.json is filling (30 questions, 15 categories) via /root/lawyer_run.py. Builder: scratchpad make_lawyer_docx.py (python-docx, RTL).
- Running: regulations-public2 (ds-flash).
- LAWYER PACK DELIVERED (~20:30 UTC): ~/Downloads/بازبینی_پاسخ‌های_قاضی_هوشمند_۱۴۰۵-۰۷-۲۲.docx.
  - 30 questions across 15 areas, all with citations, from the live free-first chat. The data is in scratchpad lawyer_final.json.
  - Anonymous chat limit is CHAT_ANON_HOURLY_LIMIT=10 per IP; spread QA runs over server-internal 127.0.0.1:8000, the server public IP and the Mac.
  - Python on the Mac fails TLS to Iranian sites and to ghazihoushmand.ir (no CA bundle); use /usr/bin/curl.
- Relay fixes: #659 (TLS via system curl, worktree .git file), #660 (percent-encode Persian URLs). The lawwatch checkout must be re-detached at origin/main after relay fixes.
- ~20:45 UTC: the relay works end to end.
  - #661: first data batch, merged. It holds 8 law_watch files plus iran_relay_2026-10-14.jsonl (80 rows: 40 taxreg with full text, 40 dotic with short draft text).
  - #662: publish uses SKIP_LOCAL_CI=1 and re-detaches origin/main.
  - core.bare flipped to true AGAIN and broke git ops. The Mac reposync job now auto-resets it.
  - #663: /regulations public pages (460 CBI circulars). Live check pending.
  - Next: ingest relay rows (taxreg) into iran_regulations (v2) + eval, add rc_law_ids for the 3 missing laws, improve the dotic full-text parse.
- 2026-10-15: HANDOFF DONE (#665).
  - docs/STATE.md was rewritten as the source of truth for the new chat.
  - docs/research/BLUEPRINT_REVIEW_2026-10-15.md: adopt Langfuse, mutmut and Postgres-template DBs per agent; skip x402/Stripe/EU compliance/Bifrost/Neon; never use Camoufox or residential-proxy anti-bot evasion.
  - The relay is on Iranian office hours (#664).
  - Running: guides-batch3 (ds-flash), pwa-twa (gateway; Cafe Bazaar/Myket TWA). regulations-v2 has finished; review pending.
  - Growth plan told to the owner:
    - Smart Judge first: SEO/GEO, an app on Bazaar/Myket, Telegram/Bale/Instagram content, lawyers and law students.
    - Roxira: the Moadian compliance wedge, with accountants as channel.
    - Owner provides pricing, ad budget, store dev accounts, social accounts, a bot token.
- PR #631 (Gemini round-2 report, docs only) is open and unmerged; the guides batch 2 / Roxira copy / Moadian / industrial-property-1403 agents wait on it.
- Next waves (invoicing → accounting+HR → inventory → damages → tax) use requireTenantId + tenant_role.

**Why/How:** continue from here, dispatching to server agents (see [[feedback-no-claude-subagents]]). Related: [[project-migration-srv1-2026-10-13]].
