# Hub token strategy: who does what, cheapest first (2026-11-15)

**Goal:** spend Claude tokens only where judgement is needed, and push all volume work to free or cheap models and scripts. This builds on `docs/strategy/TEAM_OPERATING_MODEL_2026-11-12.md`.

## Ladder: use the first rung that can do the job

| Rung | Who | Use for | Never for |
|---|---|---|---|
| 0 | **Scripts** (`gh --jq`, `scripts/dev/*.py`, `.sh` in scratchpad) | status, CI, verify reports, timings, repeated checks | anything needing judgement |
| 1 | **Review desk** (`scripts/dev/review_desk.py`, PR #808) | every PR review at head. Order: Gemini direct → SambaNova → Mistral → Groq → OpenRouter. It skips models in the author's family. | — |
| 2 | **Antigravity lanes L1–L4** (Gemini, owner side) | building wave tasks: features, tests, fixes on their own PRs | secrets, srv1 writes |
| 3 | **`rx-scout`** (Claude Haiku 5.5, read-only subagent) | code search, reading big files and logs, summarising docs | edits |
| 4 | **`rx-builder`** (Claude Sonnet 5.5, own worktree, own PR) | one scoped change with a clear brief, when no lane is free or it touches the edge box or hub tooling | Antigravity PRs, design |
| 4 | **`rx-critic`** (Sonnet, read-only) | a second review of critical PRs (money, tax, migrations, auth, workflows) when the desk failed or disagrees | routine PRs |
| 5 | **Hub** (Claude Opus 5.5, this chat) | planning waves, decisions, verifying, merging, srv1 operations, the owner's questions | reading whole files, bulk coding, routine reviews |

## Rules that save the most

1. **The hub reads conclusions, not material.** Anything over about 200 lines of reading goes to `rx-scout`. Ask for at most 300 words with `file:line`.
2. **One brief, one agent, one worktree, one PR.**
   - Builders work in `~/Developer/rx-wt/<slug>` on branch `mahansudo/<slug>`.
   - Never two writers on the same files.
   - Remove the worktree after merge (`git worktree remove`).
3. **Parallelism only where it is independent.** At most 3 agents at once. Independent research (scout) can run alongside a build (builder).
4. **Scripts over prompts.** A check run twice becomes a script. Gate prompts on a script result ("run X; act only if it fails").
5. **Handoff instead of long chats.**
   - When a chat passes about 60% of context, or the topic changes, write `docs/HANDOFF_<date>.md` (state, open PRs, next 3 steps) and the memory files, then start a fresh session with a 10-line brief.
   - Unrelated work goes to its own session.
6. **Short outputs everywhere.**
   - Use `--jq` and `head_limit`.
   - Read files by line range.
   - Agent reports have word caps.
   - Every PR body has a "What was NOT checked" section, so reviewers do not re-derive it.
7. **No Claude in loops.** Timers and scheduled work run as scripts (systemd/cron), never as scheduled Claude sessions, unless the step needs judgement.
8. **Model choice inside the product** stays in `config/models.yaml`: free models first, paid only when free ones fail, OpenRouter last.

## Daily hub loop (about 15 minutes of Opus)

1. Run a script: open PRs, CI, latest verdict at head, and the reports on #592.
2. Merge every PR that is green with no blocker (`gh pr merge --auto --squash`).
3. Verify reports with `verify_agent_report.py`, then post the next WAVE.
4. Send the one or two judgement items to `rx-critic` or `rx-builder`.
5. Update the memory files and the handoff.
