# Current state (read this first)

Short snapshot for a new chat. Next read `docs/SYSTEM_MAP.md` (what exists: domains, server, keys by name, toolchain, permissions). `docs/STRATEGY.md` explains **why**. Every chat updates this file through `/handoff`. Keep it under 100 lines. Last update: 2026-09-30 late (hub).

## Roles and lanes (ADR `docs/decisions/0003-agent-operating-model.md`)
- The hub chat is the control room: strategy, issue specs, diff review, merge. It does not implement product code.
- Escalation ladder, cheapest first: (1) `rx <issue>` / `rxall` (`scripts/dev/`, linked from `~/bin`): default worker is the **Codex CLI** (owner's ChatGPT Plus login, no Claude quota), fallback dsflash → dspro → codestral on the LiteLLM pool, 15-minute timeout per attempt, ruff undefined-name gate before a PR; (2) a Claude `implementer`/general-purpose subagent on Sonnet that only edits files in a prepared worktree (subagents cannot run git: the hub commits); (3) a separate Sonnet chat (design, investigation); (4) Opus for ADRs only. Caps: 3 rx, 2 subagents, 1 extra chat.
- Research lane: `codex --search exec ...` (live web search, no Claude quota). A Sonnet research subagent cost 311k tokens on 2026-09-30: avoid for web research.
- Merging: the hub reviews the diff, then `gh pr merge <n> --auto --squash`. Not for PRs that add spend or touch the auto-merge workflow itself.
- Owner rules (memory): test every link/command before presenting it; research anything the owner names (and alternatives) first-hand on several sites; disagree only with evidence; the lawyer gets only hard questions that search cannot settle.

## Live and working (prod `5.75.200.67`)
- **Prod is half-deployed (2026-09-30 15:09 UTC):** the owner ran `git pull` there, so the repo on disk is at 66431cf, but `scripts/ops/deploy.sh enterprise_app` stopped at "working tree is not clean" (three untracked `.env.bak.*` files). No container was recreated; `output_apps/` is bind-mounted into `roxira_app_prod`, so new code is on disk while the running process is the old one (health was 200). Pending in that deploy: #135, #149, #151, #171, #176, #177 (app) and #150, #146 (frontend, separate deploy). The assistant cannot run ssh writes or edit Claude Code permission settings (both refused by the app's classifier): the owner runs deploy commands or adds `Bash(ssh 5.75.200.67:*)` via `/permissions`.
- Site https://ghazihoushmand.ir: Zibal payments, SMS OTP login, STT/TTS voice, `/health` 200. Details in SYSTEM_MAP §1-3.
- Keys: prod `roxira-prod-chat` ($3/day); `roxira-agent` for GitHub and the Mac ($4/day, set back to $2). Only ONE Actions secret exists (`OPENROUTER_AGENT_KEY`): workflows that want search keys or `OPENROUTER_RESEARCH_KEY` get empty values (incl. `tech-radar-weekly.yml`, merged in #96, runs Mondays, $1.50 cap).
- CI: required checks Detect changes, Secret scan, Pytest (unit), Frontend gate; new jobs `Undefined names` (#154) and `System inventory up to date` (#166) are not yet in the required list (owner adds them in the ruleset).
- OmniRoute pilot: Docker on the Mac, `127.0.0.1:20128`, 3 GB cap, MITM off, next to LiteLLM (`127.0.0.1:4000`). Not configured yet: the owner must paste the one-time bootstrap token (`docker logs omniroute | grep -i bootstrap`) in the onboarding Security step (use Chrome; Safari showed a client-side error), add API keys, create an endpoint key. API-key mode only.
- Gemini CLI returns 403 from this Mac (region); Codex CLI works.

## Legal corpus (W25)
- Served corpus: `iran_laws_v2`, 8 laws, 4,216 article rows, all without `source_tier` (manifest shows them as unknown/unofficial). `docs/LEGAL_COVERAGE_MANIFEST.md` is generated.
- Lawyer rules (`docs/LAWYER_ANSWERS_2026-09-30.md`): delete repealed articles; official sources only (Official Gazette, rc.majlis.ir); advisory opinions not authoritative; unification rulings authoritative; peace court up to 1,000,000,000 rials (art. 12 of the 1402 law, adjustable every 3 years).
- Research (`docs/LEGAL_RESEARCH_2026-09-30.md`): «لایحه اصلاحی قانون تجارت» is enacted law (1347/12/24); only arts 51 and 53-71 were declared invalid (1403/11/15) and must be removed. Official rc.majlis.ir ids for the remaining laws are listed there (reported by the agent; the hub could not re-open them). A second, deeper pass by Codex is being written to `docs/LEGAL_RESEARCH_ROUND2_2026-09-30.md` (branch `docs-legal-research-2`, may be unfinished).
- Tools: `scripts/legal_fetch_page.py` (deterministic, works on `https://rc.majlis.ir/fa/law/print_version/<id>`), `scripts/w6_ingest_dotic.py --file ... --source-tier official`. rc.majlis.ir is reachable only intermittently: retry later rather than switching source.
- Staged, NOT in Qdrant: `data/raw/phase1/phase1_staged.jsonl` (git-ignored, on the Mac only), 586 rows, 7 laws with no missing article numbers (labour 203, civil execution 180, family protection 58, courts 38, rent 1356 32, financial sentences 29, civil liability 16).
- Still to fetch: rent 1362 and 1376, social security (+ regulations), registration 1310 (id 92284; 91802 is the 1308 law), civil procedure 1379, cheque (base + 1397 + 1400), dispute councils 1402, re-fetch of all 8 served laws from the official source. «کاهش مجازات حبس تعزیری» needs a special splitter (it quotes penal-code article numbers).

## Waiting on the owner
1. Finish the deploy: `ssh 5.75.200.67 'mkdir -p /root/env-backups && cd /opt/roxira_platform && mv .env.bak.* /root/env-backups/ && git status --short && scripts/ops/deploy.sh enterprise_app'`, then the frontend deploy; verify /health and an exact lookup.
2. OmniRoute onboarding (above; alternative: recreate the container with the owner's own `-e INITIAL_PASSWORD=...`, untested). Decide whether to keep it after a real comparison with LiteLLM.
3. Send (or not) the five expert questions at the end of `docs/LEGAL_RESEARCH_ROUND2_2026-09-30.md` to the lawyer.
4. Approve the first official ingest into Qdrant (prod write) once the staged laws are complete.
5. DB fixes: order 4815502353 paid but `pending`; revoke fake user `authenticated_user`; SINGLE_DRAFT credits (#101).
6. Server housekeeping: kernel reboot, old `.env.bak.*`, nginx-recreate window.
7. Add the missing Actions secrets, or accept that the weekly radar runs without web search.

## Next workstreams
| Id | What | Lane |
| --- | --- | --- |
| W25 | Fetch remaining official texts and rebuild the staged JSONL with the new ingest filters (#177 drops inactive rows and commerce arts 51/53-71), special splitter for the 1399 law, wire `config/jurisdiction_rules.yaml` (#176; only the peace-court threshold is `confirmed`) into answers after the lawyer's reply, unification rulings (Phase 4 first item) | rx (codex) |
| W26b | Design tokens + visual pass (separate Sonnet chat started 2026-09-30; status unknown to this chat) | chat |
| infra | OmniRoute vs LiteLLM comparison on one real issue; rx timeout/fallback paths never exercised; eval_cheap_tier needs a stable network (Mac run had >20% API errors) | rx |
| misc | #99, #77, #113, #67, #66, #84 voice, #94/#95 research, #74 e2e (red) | rx |

## Known issues
- Dockerfile.prod is Python 3.11 while pyproject says >=3.13; `.env.example` names differ from prod (SYSTEM_MAP §3-4).
- The Mac's link to GitHub, OpenRouter and Iranian sites drops often: retry loops are normal; `gh` needs `SSL_CERT_FILE` from certifi.
- rtk wraps git/pytest: use `rtk proxy python3 -m pytest <file>`. Never run pytest over `src/` or the repo root.
- Git worktree creation needs the sandbox disabled (writes `.git/config`). Many stale worktrees under `.claude/worktrees/` and `~/Developer/rx-wt/` can be pruned.
