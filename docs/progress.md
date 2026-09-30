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
