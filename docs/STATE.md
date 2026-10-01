# Current state (read this first)

Short snapshot for a new chat. Next read `docs/SYSTEM_MAP.md` (what exists: domains, server, keys by name, toolchain, permissions). `docs/STRATEGY.md` explains **why**. Every chat updates this file through `/handoff`. Keep it under 100 lines. Last update: 2026-10-01 (hub).

## Roles and lanes (ADR `docs/decisions/0003-agent-operating-model.md`)
- The hub chat is the control room: strategy, issue specs, diff review, merge. It does not implement product code.
- Escalation ladder, cheapest first: (1) `rx <issue>` / `rxall` (`scripts/dev/`, linked from `~/bin`): default worker is the **Codex CLI** (owner's ChatGPT Plus login, no Claude quota), fallback dsflash → dspro → codestral on the LiteLLM pool, 15-minute timeout per attempt, ruff undefined-name gate before a PR; (2) a Claude `implementer`/general-purpose subagent on Sonnet that only edits files in a prepared worktree (subagents cannot run git: the hub commits); (3) a separate Sonnet chat (design, investigation); (4) Opus for ADRs only. Caps: 3 rx, 2 subagents, 1 extra chat.
- Research lane: `codex --search exec ...` (live web search, no Claude quota). A Sonnet research subagent cost 311k tokens on 2026-09-30: avoid for web research.
- Merging: the hub reviews the diff, then `gh pr merge <n> --auto --squash`. Not for PRs that add spend or touch the auto-merge workflow itself.
- Owner rules (memory): test every link/command before presenting it; research anything the owner names (and alternatives) first-hand on several sites; disagree only with evidence; the lawyer gets only hard questions that search cannot settle.

## Live and working (prod `5.75.200.67`)
- **Prod is fully deployed as of 2026-09-30 19:57 UTC** (core app + frontend at 129ef71, `/coverage` and `/health` 200). Merged since and NOT yet deployed: #182 (pin lightrag-hku 1.5.7 + openai 3.22.1), #192-#195 (DESIGN.md contract, status tokens, LegalProvenanceCard/LegalResultState, not yet used by pages), #200 (amending-law splitter, script only). Deploy recipe (detached, interactive ssh drops): `ssh 5.75.200.67 'cd /opt/roxira_platform && nohup scripts/ops/deploy.sh <service> > /root/deploy.log 2>&1 &'`. See `docs/OPERATIONS_RUNBOOK.md`.
- Site https://ghazihoushmand.ir: Zibal payments, SMS OTP login, STT/TTS voice, `/health` 200. Details in SYSTEM_MAP §1-3.
- Keys: prod `roxira-prod-chat` ($3/day); `roxira-agent` for GitHub and the Mac ($4/day, set back to $2). Only ONE Actions secret exists (`OPENROUTER_AGENT_KEY`): workflows that want search keys or `OPENROUTER_RESEARCH_KEY` get empty values (incl. `tech-radar-weekly.yml`, merged in #96, runs Mondays, $1.50 cap).
- CI: required checks Detect changes, Secret scan, Pytest (unit), Frontend gate; new jobs `Undefined names` (#154) and `System inventory up to date` (#166) are not yet in the required list (owner adds them in the ruleset).
- OmniRoute (Mac, Docker, `127.0.0.1:20128`) is configured: DB already encrypted (key auto-generated into the volume's `server.env`, backed up in `~/omniroute-backups/`; never set a new storage key), Cloud off, combo `team-coding` = Priority [mistral codestral-latest, groq gpt-oss-120b], OpenCode provider `omniroute` (key env `OMNIROUTE_OPENCODE_KEY`). `rx <n> team` uses it. First comparison: `team` failed the F821 gate on #198, Codex passed; LiteLLM-vs-OmniRoute 5-step comparison still to run.
- Gemini CLI returns 403 from this Mac (region); Codex CLI works.

## Legal corpus (W25)
- Served corpus: `iran_laws_v2`, 8 laws, 4,216 article rows, all without `source_tier` (manifest shows them as unknown/unofficial). `docs/LEGAL_COVERAGE_MANIFEST.md` is generated.
- Lawyer rules (`docs/LAWYER_ANSWERS_2026-09-30.md`): delete repealed articles; official sources only (Official Gazette, rc.majlis.ir); advisory opinions not authoritative; unification rulings authoritative; peace court up to 1,000,000,000 rials (art. 12 of the 1402 law, adjustable every 3 years).
- Research (`docs/LEGAL_RESEARCH_2026-09-30.md`): «لایحه اصلاحی قانون تجارت» is enacted law (1347/12/24); only arts 51 and 53-71 were declared invalid (1403/11/15) and must be removed. Official rc.majlis.ir ids for the remaining laws are listed there (reported by the agent; the hub could not re-open them). A second, deeper pass by Codex is being written to `docs/LEGAL_RESEARCH_ROUND2_2026-09-30.md` (branch `docs-legal-research-2`, may be unfinished).
- Tools: `scripts/legal_fetch_page.py` (deterministic, works on `https://rc.majlis.ir/fa/law/print_version/<id>`), `scripts/w6_ingest_dotic.py --file ... --source-tier official`. rc.majlis.ir is reachable only intermittently: retry later rather than switching source.
- Staged, NOT in Qdrant: `data/raw/phase1/phase1_official_v2.jsonl` (git-ignored, Mac only): 1504 rows, 17 law units, all `source_tier=official`, built from the official rc.majlis.ir texts fetched 2026-10-01 into `data/raw/phase1/*.txt` with the #177 filters and the #200 `--amending` splitter (reduction 1399, cheque amendments 1397/1400). Ingest into prod Qdrant needs the owner's explicit yes (plan: backup, separate collection, spot-check lookups, then switch).
- Remaining legal gaps: re-fetch of the 8 laws served in `iran_laws_v2` (commerce, civil code, etc. not in the staged file except commerce 96314 not staged yet), unification rulings (Phase 4), wiring `config/jurisdiction_rules.yaml` into answers after the lawyer replies.

## Waiting on the owner
1. Yes/no: write the 1504 official rows into Qdrant (prod write).
2. Deploy: `deploy.sh enterprise_app` (LightRAG pin) and `roxira_enterprise_frontend` (new tokens/components) with the detached recipe above.
3. Send (or not) the five expert questions at the end of `docs/LEGAL_RESEARCH_ROUND2_2026-09-30.md` to the lawyer.
4. Add allow rules himself in an interactive `claude` terminal (`/permissions`): `Bash(gh pr merge:*)`, `Bash(ssh 5.75.200.67:*)`. The auto-mode classifier otherwise refuses direct merges, ssh writes and secret-file handling for the assistant. Auto-merge IS enabled on the repo (runbook §7).
5. DB fixes: order 4815502353 paid but `pending`; revoke fake user `authenticated_user`; SINGLE_DRAFT credits (#101).
6. Server housekeeping: kernel reboot; CI required checks `Undefined names` and `System inventory up to date`; missing Actions secrets for the weekly radar.

## Next workstreams
| Id | What | Lane |
| --- | --- | --- |
| W25 | Fetch remaining official texts and rebuild the staged JSONL with the new ingest filters (#177 drops inactive rows and commerce arts 51/53-71), special splitter for the 1399 law, wire `config/jurisdiction_rules.yaml` (#176; only the peace-court threshold is `confirmed`) into answers after the lawyer's reply, unification rulings (Phase 4 first item) | rx (codex) |
| W26b | Design tokens + visual pass (separate Sonnet chat started 2026-09-30; status unknown to this chat) | chat |
| infra | Promptfoo gateway fixtures (docs/research/AGENTIC_TOOLING_RESEARCH_2026-10.md task 1-2); OmniRoute vs LiteLLM comparison on one real issue; rx timeout/fallback paths never exercised; eval_cheap_tier needs a stable network (Mac run had >20% API errors) | rx |
| misc | #99, #77, #113, #67, #66, #84 voice, #94/#95 research, #74 e2e (red) | rx |

## Known issues
- Dockerfile.prod is Python 3.11 while pyproject says >=3.13; `.env.example` names differ from prod (SYSTEM_MAP §3-4).
- The Mac's link to GitHub, OpenRouter and Iranian sites drops often: retry loops are normal; `gh` needs `SSL_CERT_FILE` from certifi.
- rtk wraps git/pytest: use `rtk proxy python3 -m pytest <file>`. Never run pytest over `src/` or the repo root.
- Git worktree creation needs the sandbox disabled (writes `.git/config`). Many stale worktrees under `.claude/worktrees/` and `~/Developer/rx-wt/` can be pruned.
