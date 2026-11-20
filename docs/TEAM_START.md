# Team start: new colleague and their AI accounts

One page. Details live in the files linked at the end.

## What this is
Roxira is a modular accounting and ERP suite (NestJS hub, Next.js frontend, Python/FastAPI AI core, PostgreSQL, Redis, Qdrant). Smart Judge is a separate legal-answer product on the same stack. Work is split into lanes L1-L7 and queued as GitHub issues; humans and AI agents (Claude, Gemini, others) work in parallel through draft PRs.

## Accounts
- A GitHub account with access to the `Mahan-film/roxira-platform` org repo (ask the owner for an invite). The repo is public.
- Your own Claude and/or Gemini accounts are fine. Never share a login or paste a key into a chat or file.

## First commands
```
gh auth login
git clone https://github.com/Mahan-film/roxira-platform && cd roxira-platform
bash scripts/dev/whoswhat.sh                       # who has claimed what
bash scripts/dev/claim.sh <issue> --agent <id>     # draft PR = the lock
LOCAL_CI_SKIP_PYTEST=1 FRESH_DB_PORT=<unique> git push   # pre-push local CI, 20-30 min
```
Agent ids: `claude-<login>`, `opencode`, `antigravity`, `server-<lane>`. Pick a `FRESH_DB_PORT` no other session uses. Read `AGENTS.md` and `docs/agents/LESSONS.md` before every task.

## Where work comes from
Issues labelled `lane:L1`..`lane:L7` (plus `prio:1..3`, `research-row`). The order per lane is in the latest `## WAVE` comment on issue #592. Never take an issue labelled `in-progress`. At most 3 open PRs per lane.

## Review and merge
Every PR gets a cross-family review from the review desk (`gh workflow run review-desk.yml`, once, without `-f pr`). Merge only with "no blocker" on the current head, through the queue: `gh pr merge N --auto --squash`. Never merge your own PR without that verdict. The main hub (Mac) merges L1-L4 and hub PRs; the box hub merges L5-L7.

## Hard rules
- No secrets in code, docs, logs or chat; read them from the environment only. Never print env values.
- Never use `--no-verify` and never bypass the pre-push hook.
- Never run `pytest` over `src/` or the repo root; run only what `.github/workflows/ci.yml` runs.
- The repo is public: no `.env` files, keys or customer data.
- Production is read-only for agents; changes there need the owner.
- New tenant tables need a tenant column, an access policy and FORCE RLS. Money is bigint minor units only.

## The machines
- **Mac:** the main hub (Claude Code: strategy, WAVE posts, review routing, merges, production steps) and lanes L1-L4.
- **Linux box `roxira-ci`:** the box hub (Claude Code: merges L5-L7, box upkeep, phone stack), the CI runner, and lanes L5-L7 (Gemini CLI fallback builder). The hubs coordinate only through GitHub; box reports on #592 start with `BOX:`.

## Where to ask
Comment on issue #592. Handing work over: post the Handoff block (Done / Not done / Tests run / Not verified / Next step) as a PR comment.

## Read next
`docs/AI_HANDOFF.md`, `docs/STATE.md`, `docs/COLLABORATION.md`, `docs/TEAM_SPLIT_2026-11-17.md`, `docs/ops/LINUX_CI_BOX.md`.
