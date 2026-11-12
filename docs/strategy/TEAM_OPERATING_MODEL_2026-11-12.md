# Team operating model (2026-11-12, from the owner's deep research)

Two people, each with their own GitHub account, Claude subscription and machine: **Person A** (owner, Mac, non-programmer, strategy and approvals) and **Person B** (collaborator, Windows laptop, programmer). Products: **Roxira** (roxira.ir accounting/ERP, Iran first; roxira.net global later) and **Smart Judge** (ghazihoushmand.ir legal AI). One public monorepo `Mahan-film/roxira-platform`; merge = release (autodeploy on srv1).

## Decisions taken now (no owner input needed)
1. **Claude is scarce; Gemini and DeepSeek do the volume.** Antigravity (4 lanes, owner-run) builds and fixes. The review desk runs every 2 h with **DeepSeek only** (OpenRouter API, no Claude agents). Claude chats only plan waves and handle what agents cannot.
2. **Never automate Antigravity** (no unattended `agy` daemons on a consumer plan: account risk). Only the owner pastes prompts.
3. **Do not take PRs away from a lane.** If a lane is stuck, it hands off by comment, not by someone else pushing to its branch.
4. **Handoff lives on GitHub**, not in a chat: a `[HANDOFF-STATE]` comment on the issue/PR plus pushed commits; a Claude chat continues with `claude --from-pr <n>`. Repo-wide state stays in `docs/STATE.md` + the newest `docs/HANDOFF_*.md`.
5. **Each person logs in with their own accounts** (Claude, GitHub, OpenRouter, Antigravity). Never share credentials, `~/.claude`, `~/.gemini`, OpenCode `auth.json`, SSH keys or prod secrets. Unset `ANTHROPIC_API_KEY` so Claude Code uses the subscription, not API billing.

## Target setup (next steps, in order; small PRs, Gemini lanes can do 1-4)
1. **CI guard for migrations** (T101): fail on a new duplicate timestamp or class name (grandfather the 7 old ones); later a check against open PRs.
2. **GitHub Project v2 "Roxira Control Plane"** as the single hub instead of the long #592 thread: fields Wave, Lane (L1-L4, B-infra), Risk (low/medium/high-money-tax-rls-migration), Reviewer family; views Board (owner), Lane table (agents), Human gate, Roadmap. Waves become one issue per task (`T<n>`), linked as sub-issues of a wave issue. Needs `gh auth refresh -s project` once.
3. **Atomic claim**: extend `scripts/dev/claim.sh` to refuse an issue that already has `status:claimed`, add assignee + lane + `author:gemini|claude` labels; no agent pushes to a branch with another author label.
4. **Templates**: agent task issue (objective, allowed files, forbidden files, migration yes/no, verification commands, acceptance criteria), PR `## Agent Execution Report`, `[HANDOFF-STATE]` comment, weekly status update.
5. **CODEOWNERS** for money/tax/cheques/RLS/migrations/.github/deploy → Person B (code) + Person A (business); only after the two agree on approval rules (open question 1).
6. **Context hygiene**: keep `CLAUDE.md`/`AGENTS.md` short; split `docs/agents/LESSONS.md` into path-scoped rules in `.claude/rules/` and `.agents/rules/` (Antigravity: flat folder, `trigger:` must be `always_on|model_decision|glob|manual`); add a `# Compact instructions` section (keep issue no., branch, changed files, test output, migration numbers).
7. **Move the review desk off the Mac** (GitHub Actions schedule or srv1 timer running `opencode run` with the OpenRouter key) so it does not depend on the laptop or Claude quota.

## Area split (proposal)
- **Person A + Antigravity L1-L4**: product features (ledger, HR, tax, cheques, inventory, sales, import UI), via waves.
- **Person B + his Claude Code (Sonnet/Haiku)**: infrastructure, RLS, migrations, BullMQ, CI, the Python/FastAPI Smart Judge service, hard bugs, and reviewing high-risk PRs.

## Daily rhythm (proposal)
- Start of a 5-hour window: one short Claude/Gemini planning step (new wave or issues), then the 4 lanes run.
- Mid-day: 15-minute sync between A and B on the "Human gate" list; B approves code, A approves business rules.
- End of day: every unfinished task has a pushed branch and a `[HANDOFF-STATE]` comment.

## Open questions for Person A and Person B
1. CODEOWNERS: is one approval (A or B) enough for money/tax paths, or B for code and A on the board?
2. Where should the review desk run: GitHub Actions schedule, srv1, or a small separate VPS?
3. Plans and weekly reset times of each Claude and Antigravity account.
4. Will Person B also run Antigravity on Windows, or only Claude Code + OpenCode?
5. Turn off "use interactions for training" in Antigravity settings?
6. Maximum wait for a PR in "needs human approval" before an alert (Telegram)?
