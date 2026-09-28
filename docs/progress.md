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
