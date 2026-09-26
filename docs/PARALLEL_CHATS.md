# Running several chats in parallel

Goal: the most work per Claude plan limit. Expensive models decide, cheap ones execute.

## Lanes

| Lane | Where | Model | Max at once | Uses Claude plan quota? |
| --- | --- | --- | --- | --- |
| **Hub** | 1 Claude Code chat | Opus 5.5 | 1 | yes |
| **Workstream** | Claude Code chats, one per W-row | **Sonnet 5** (Medium effort) | 2 | yes, ~1/5 of Opus per token |
| **Subagents** | inside any chat (`.claude/agents/`) | `tester` = Haiku, `implementer` = Sonnet, `reviewer` = Opus | ad hoc | yes (Haiku is cheapest) |
| **Cheap agents** | GitHub issues labelled `agent` | DeepSeek V4.1 Flash via OpenRouter | many (queued) | **no**: OpenRouter key, daily $ cap |

The hub plans, reviews and merges, and runs server steps only after the owner says yes in chat. The hub does not type code.

A workstream chat does one W-row, in its own worktree, and ends with a PR.

Cheap agents take small, well-specified, non-sensitive tasks: one issue, ≤ ~3 files, a clear acceptance test. Anything that touches auth, payments, secrets, `.github/`, compose, nginx or migrations is labelled `needs-human` and never auto-merges.

Rule of thumb: if a task can be fully described in an issue with an acceptance test, it goes to the **agent** lane. Otherwise it goes to a **Sonnet** chat. Only strategy, architecture and security go to the **Hub**.

## Starting a workstream chat
1. In the Claude app: **New chat (+)**, model **Sonnet 5**, effort **Medium**, "Isolated worktree" on.
2. Paste the prompt for that row (below). The chat reads `docs/STATE.md` first, not the whole history.
3. When it opens its PR, tell the hub chat: "PR #N ready". The hub reviews and merges.

### Prompts
- **W14:** `/start-workstream W14 — Playwright E2E smoke in CI: Smart Judge chat reply, create-invoice returns 200, homepage renders. Runs on schedule + workflow_dispatch against https://ghazihoushmand.ir, read-only, no secrets needed. See docs/STATE.md.`
- **W15:** `/start-workstream W15 — STT robustness: remove/replace the dead google/gemini-2.0-flash-001 fallback in stt_engine.py (read from config/models.yaml), add offline tests, and write a short plan for self-hosted faster-whisper large-v3-turbo on the server. No server changes. See docs/STATE.md.`
- **W16:** `/start-workstream W16 — nginx: make /health on ghazihoushmand.ir and roxira.net reach the app (currently 404 outside, 200 inside). PR only; deploy is owner-approved via /deploy-prod.`

### Agent issues (hub or owner files them)
Title plus body with: the file(s), expected behaviour, and "Scope: only X plus one offline test collected by CI". Add the label `agent`.

## Context and handoff
- A chat's context is not memory. The memory is: `docs/STATE.md` (now), `docs/STRATEGY.md` (why), `docs/progress.md` (log), plus engram for short personal lessons.
- When a chat reaches ~60% context, finishes its W-row, or you want to switch to a new chat: run **`/handoff`**. It updates `docs/STATE.md` and `docs/progress.md` through a PR and prints a ready-to-paste starter prompt for the next chat.
- New chat, same work: paste that starter prompt. Nothing else is needed.
- Prefer `/handoff` + a new chat over repeated `/compact`. Each compaction costs tokens and loses detail.

## Limits and costs (observed 2026-09-26)
- The Claude plan limit is shared across all chats. 3 heavy Opus chats hit it on 2026-09-24, hence at most 1 Opus + 2 Sonnet.
- Cheap-agent run: a few cents. `agent-review` (Sonnet 5 via API): ~$0.006 per PR. Coding eval: under $0.01 per model.
