# Team split from 2026-11-17

Two machines work in parallel on `Mahan-film/roxira-platform`. Both follow AGENTS.md, `docs/antigravity/LANE_PROMPT_FA.md` (v6) and the latest `## WAVE` comment on issue #592.

| Machine | Antigravity lanes | Claude Code | Areas |
|---|---|---|---|
| Owner | L1, L2, L3, L4 | hub: strategy, review routing, merges, production | L1 ops/CI/infra · L2 frontend + currency · L3 security/data · L4 Smart Judge |
| Colleague | L5, L6 | second hub for L5/L6 only | L5 core ledger (T206 → T178 → T180, T194, T195) · L6 Germany pack (T191 → T188 → T189, then T186 after T178) |

## Rules for both
- Each lane's queue is the GitHub issues labelled `lane:L<k>` (order in the latest `## WAVE` comment on #592). Claim on the issue with `bash scripts/dev/claim.sh <issue> --agent antigravity` (draft PR = lock); never take an issue labelled `in-progress`. Research rows carry `research-row` and a "Done when" spec; backlog issues are checked on origin/main first and closed with evidence if already done.
- WIP limit 3 open PRs per lane; at most 2 CI fix rounds, then post the hand-off block.
- Migration ids: above the newest on `origin/main` **and** every open PR (CI check `check_migration_ids.py --open-prs` enforces it); renumber on rebase.
- Shared files (permission matrix, `app.module.ts`, nav menu): append-only, alphabetical.
- Every PR gets a cross-family review (review desk: `gh workflow run review-desk.yml`, one dispatch without `-f pr` reviews all open PRs at their heads; per-PR dispatches cancel each other). No merge without "no blocker" on the current head.
- Merge only through the queue: `gh pr merge N --auto --squash`.
- The colleague's Claude Code reviews and merges only L5/L6 PRs; the owner's hub handles everything else and all production steps.
- Production: read-only for agents; never print environment variables or secrets (an agent did on 2026-11-17).

## Colleague setup (once)
1. `gh auth login` with an account that has write access to the repo; `git clone https://github.com/Mahan-film/roxira-platform && cd roxira-platform`.
2. Read `docs/AI_HANDOFF.md`, `docs/HANDOFF_2026-11-17.md`, this file, and `docs/strategy/INFRA_TARGET_2026-11-17.md`.
3. Antigravity: open two chats and paste `docs/antigravity/prompts/L5.txt` and `L6.txt` (one per chat).
4. Claude Code: start in the repo and say: "You are the hub for lanes L5/L6 per docs/TEAM_SPLIT_2026-11-17.md; review and merge only their PRs."
