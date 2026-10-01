# Progress log

Append-only. One entry per PR/session that finishes a `docs/plan.md` item or
otherwise changes something worth remembering. Newest entry at the bottom.
Do not edit past entries — add a new one instead.

## Template

```
## YYYY-MM-DD — <workstream/PR> — <one-line summary>
- What changed:
- Why:
- Follow-up (if any):
```

## Log

## 2026-09-25 — W12 — cheap hands, open memory (first slice)
- What changed: `opencode.json` rewritten to explicit allow/deny permissions
  only (no `ask`, since OpenCode runs non-interactively in CI);
  `agent_runner.py`'s `run_opencode()` now passes `--agent build` and its
  `DEFAULT_MODEL` reads the `executor` role from `config/models.yaml`
  instead of a hardcoded id; added `.github/workflows/model-registry-check.yml`
  (weekly OpenRouter drift check, opens/updates one `model-registry` issue,
  never auto-edits the registry); added this plan/progress/decisions memory
  set; added `feature-plan` and `review-diff` project skills; added a
  PostToolUse ruff-on-save hook.
- Why: docs/STRATEGY.md §3a/§4 — execution should be cheap and non-interactive,
  and spec/plan memory should be a few small files agents actually read
  instead of a long chat history.
- Follow-up: `model-registry-check.yml` has not had a live run yet (needs a
  scheduled trigger or a manual `workflow_dispatch` after merge). The
  `feature-plan`/`review-diff` skills are new and unexercised on a real task.

## 2026-09-28 — hub — security cleanup + local free-model pool, handoff
- What changed: removed the self-hosted runner and server-side LiteLLM from prod (runner service disabled, no sudo/docker); PR #60 moves agent/model workflows back to GitHub-hosted runners. Built the owner's local LiteLLM pool (Groq gpt-oss-120b → Codestral → Qwen3.8 → DeepSeek V4.1 via OpenRouter) and pointed global OpenCode at it. Merged/deployed during this hub session: #53 real Zibal payments, #54 design, #56 subscription modal fix (merged, not yet deployed), #55 prepared (v2 legal collection + vector search, 63.3% citation accuracy, awaiting owner).
- Why: agent/model code must never execute on the production host; implementation work should use free keys instead of the Claude plan quota.
- Follow-up: owner test payment; decide #55; remove runner in GitHub UI; W20 Gemini Live verification.

## 2026-09-30 — hub — payments/citation-guard fixes deployed, keys rotated, cost tooling, legal coverage audit
- What changed: deployed #100 (payment callback), #132 (citation guard restored verbatim after daemon commit 2b605a1), #131 (/factory removed from nginx); disabled roxira-worker timer; new prod OpenRouter key with a $3/day cap (old keys revoked); merged prices fix #109, eval script #110/#128/#136 (reasoning flag), deploy.sh nginx-inode fix #111, deps audit #112/#127, restore drill #116/#125, Frontend gate #115, cheap-tier reasoning off #135 (not yet deployed), legal coverage roadmap #137. Built `rx`/`rxall` Mac tools.
- Why: the site was returning 500 on legal questions, prod key was revoked, and the Claude weekly limit was exhausted, so all implementation moved to cheap lanes.
- Follow-up: change VPN (OpenRouter 403 for the Mac IP), deploy #135, rerun quality eval, review W25 PRs (#138-#140), fix order 4815502353, lawyer check of the commercial-code bill.

## 2026-09-30 — hub session (evening) — operating model, legal Phase 0/1 groundwork, Codex worker
- What changed: ADR 0003 (#148); exact article lookup (#149); `/coverage` page (#150); guard collection label (#151); chat declutter (#146); undefined-names CI job (#154); `source_tier` (#158); deterministic law fetcher (#160, #162); SYSTEM_MAP + generated inventory + CI drift check (#163, #166); lawyer answers and research docs (#165, #169); rx moved to `scripts/dev` with a Codex CLI worker, fallback chain and timeout (#152, #168); commerce act no longer flagged as a bill (#171); tech-radar weekly (#96).
- Why: the cheap lane failed repeatedly on large issues; the owner needed one inventory for new chats, official-source legal texts, and merges without manual clicks (`gh pr merge --auto --squash`).
- Follow-up: deploy is still pending (prod at 64478f3); OmniRoute onboarding by the owner; fetch the remaining official texts when rc.majlis.ir answers; first official ingest needs owner approval; PR #167 needs the owner's review.

## 2026-10-01 — hub session (all day) — prod fully deployed, OmniRoute, official laws, autonomy foundations, auto-deploy armed
- What changed: prod deployed twice (core + frontend; #178 state, #182 LightRAG pin, #205 identity fast path, #208 Whisper `language=fa` + removed «هست→هاست» rule); Qdrant `iran_laws_v2` 4243 → 5103 points (12 official laws, backed up by Qdrant snapshots); OmniRoute configured (combo `team-coding`, gateway comparison in `docs/research/OMNIROUTE_EVAL.md`: LiteLLM 7/7 at 1.6 s vs OmniRoute 7/7 at 3.9 s; #203, #211); 10 research reports in `docs/research/` (#185, #209, #213, #231); Factory libraries (#217 task contract, #218 delivery report, #219 run ledger, #224 preflight, #223 budget, #225 template check); zero-cost research (#227 tiers, #232-#234 SearXNG/ddgs/local rerank clients, #237 free-first order); local Whisper engine behind `ROXIRA_STT_LOCAL=1` (#212); `llm_router` model cap (#240); factory-research layers on `cheap` (#241); automatic deploy (#244, #245, #246: `ci-deploy.sh` forced command + `deploy-prod.yml`, armed with `DEPLOY_ENABLED=true`); runbook sections 7-8 (#184, #199); 7 Actions secrets and variables FACTORY_ENABLED / AGENT_REVIEW_MODEL set by the owner.
- Why: the owner wants a fully autonomous agentic delivery system (one central request → research → plan → parallel agent teams → tests → deploy → Persian report) at near-zero cost. Gap analysis (`docs/research/FULL_AUTONOMY_GAP_ANALYSIS_2026-10.md`) says the critical path is the delivery tail (preview, deploy, observation), not another agent framework.
- Follow-up: Factory run 4 on brief #236 starts automatically after #243 (Event-loop fix) merges (`~/rx-logs/chain-factory4.out`); then owner replies `/approve`. Preview environments on the same server (disk 31 GB free), SearXNG+Valkey+Crawl4AI install, local Whisper enablement after a real-voice test, wire `LocalReranker`, golden templates, replace the 3 overlapping laws with official versions, unification rulings. Pitfalls: Codex puts tests in the wrong folder and forgets imports (hub fixes), CI main goes red if the system inventory is not regenerated, never deploy `enterprise_app` during a long job inside `roxira_app_prod`, terminal Run buttons replay old commands.
