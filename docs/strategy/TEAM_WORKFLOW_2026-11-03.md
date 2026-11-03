# Team workflow: several people, several Claude accounts, many agents (2026-11-03)

Goal: two or more people, each with their own GitHub and Claude account, plus OpenCode, Antigravity and server
agents, work on one repo at the same time. Nobody duplicates work, anyone can finish what someone else started, and
everyone sees what changed without asking. Extends `docs/COLLABORATION.md`; that page keeps the commands.

## 1. One source of truth: GitHub

| Question | Where the answer lives | Not here |
|---|---|---|
| What needs doing | GitHub issues, one task each, with a `- [ ]` acceptance checklist | chat history, personal notes |
| Who is doing it | Issue assignee + label `in-progress` (set by `claim.sh`) | memory files |
| How far it got | Ticked checklist boxes + the draft PR | "I think X finished it" |
| What shipped | Merged PRs on `main`; `autodeploy-last.json` on srv1 | local branches |
| Where the project stands | `docs/STATE.md`, `docs/strategy/REQUIREMENTS_STATUS.md` (changed only by PR) | a single person's Claude memory |

Each person's Claude memory holds only personal preferences. Project facts go into the repo, because the other
person's Claude cannot read your memory.

## 2. The board (the "tick" list)

One GitHub Project with four columns: **Todo → In progress → Review → Done**. Issues move automatically:
claim = In progress, PR opened = Review, PR merged (`Closes #n`) = Done.

Issue template (every task):
```
Goal: <one sentence>
Lane: <accounting | sales-stock | crm | hr | tax | import | access | factory | judge | legal | ui>
Done when:
- [ ] <test or visible result 1>
- [ ] <test or visible result 2>
Handoff notes: (filled in when someone stops)
```

## 3. Rules that prevent overlap

1. **Lanes** (`docs/AI_HANDOFF.md`): one writer per lane at a time. A `CODEOWNERS` file names the lane owner for
   review, not as a lock.
2. **Claim before coding** with `bash scripts/dev/claim.sh <n>`. It refuses if someone else holds the issue.
3. **Who you are:** on a shared Mac run `bash scripts/dev/iam.sh <login>` first, so claims, commits and PRs show the
   right person.
4. **Draft PR on the first push.** `whoswhat.sh` lists files touched by two open PRs; touching one of those needs a
   comment on the other PR first.
5. **Shared files** (`app.module.ts`, `app-shell.tsx`, lockfiles, new migrations, `docs/STATE.md`): smallest
   possible change, merged first, never reformatted. Take the next migration timestamp right after `git fetch`.
6. **Small PRs, merged the same day.** Rebase on `origin/main` before every push.

## 4. Handing work over (so the other person can finish it)

When you stop before the issue is done:
1. Push the branch (the draft PR shows the state).
2. Fill **Handoff notes** in the issue: what is done, what is next, how to test, any trap.
3. Release the claim: `gh issue edit <n> --remove-label in-progress --remove-assignee @me`, and add the label
   `handoff`.

Anyone may pick up a `handoff` issue with `claim.sh`. An issue that is `in-progress` with no push for 48 hours
may be taken after a comment that tags the holder.

## 5. Knowing what the others did

- **Start of every session (person or Claude):** `git fetch`, `bash scripts/dev/whoswhat.sh`, read
  `docs/AI_HANDOFF.md`. `CLAUDE.md` already tells every Claude session to do this.
- **Push notifications:** watch the repo on GitHub (Participating + Releases). The Telegram owner bot posts each
  merge and each autodeploy result to the team channel (one line: PR, author, deployed or rolled back).
- **End of a working block:** `/handoff` updates `docs/STATE.md` and `docs/progress.md` in a docs PR.
- **Weekly:** `REQUIREMENTS_STATUS.md` rows change only in the PR that closes the gap, with evidence.

## 6. Several Claude accounts and agents

| Worker | Takes | Label | Never |
|---|---|---|---|
| Person A + their Claude | architecture, money, security, migrations, review | `by:<login>` | merges its own diff without a cross-family review |
| Person B + their Claude | same, different lane | `by:<login>` | works in A's worktree or branch |
| OpenCode pool (key pool, server or Mac) | mechanical, well-specified issues with tests | `agent:opencode` | migrations, auth, secrets |
| Antigravity (owner-run) | visual UI tasks from `docs/antigravity/TASKS.md` | `agent:antigravity` | backend, config, pushing |
| Server agents (`run_task.sh`) | batch jobs, long research | `agent:server` | production writes |

Each Claude account works only in its own worktrees, with branches named `<github-login>/<issue>-<slug>`. At most
3 to 4 writers at once across everyone; read-only audits can run wider. Every PR is reviewed by a different model
family before merge (`check_reviewer_family.py`), then merged with `gh pr merge --auto --squash`.

## 7. Public repository

The working repo becomes public with a cleaned history (`docs/ops/PUBLIC_REPO_MIGRATION.md`, to be written with the
switch). A pre-push hook refuses any branch built on the old, key-bearing history. Secrets stay in
`~/Secrets/roxira/roxira.env` and the server `.env`; gitleaks runs in local CI on every push.
