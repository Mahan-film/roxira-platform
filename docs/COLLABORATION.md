# Working together without duplicate work

Two people (the owner and a collaborator), each with **their own** Claude account and their own Claude
Code sessions, work on this repository at the same time. This page is the agreed workflow.

## خلاصه برای مالک (فارسی)

- **منبع حقیقت، GitHub است، نه یک فایل.** یک فایل مشترک که هر دو مدام ویرایش کنند، دائم conflict می‌دهد و عقب می‌ماند. استاندارد صنعت این است: هر کار یک **Issue** در GitHub دارد و پیش از شروع، کار به یک نفر **تخصیص** (assign) داده می‌شود.
- **پیش از هر کار** این را بزنید:
  ```bash
  bash scripts/dev/whoswhat.sh
  ```
  این دستور نشان می‌دهد چه کسی روی چه کاری است، چه PRهایی باز هستند و کدام فایل‌ها را دو نفر هم‌زمان تغییر می‌دهند.
- **برای شروع یک کار** این را بزنید:
  ```bash
  bash scripts/dev/claim.sh <شماره-issue>
  ```
  کار به اسم شما ثبت می‌شود، یک شاخه جدا ساخته می‌شود و یک PR پیش‌نویس باز می‌شود تا همه ببینند. کار جدید هم این‌طور ثبت می‌شود:
  ```bash
  bash scripts/dev/claim.sh new "عنوان کار"
  ```
- **حوزه‌ها را تقسیم کنید.** مثلاً یک نفر «قاضی هوشمند و قوانین»، نفر دیگر «Roxira و ماژول‌های سازمانی». هر کس در حوزه خودش کار کند، تداخل تقریباً صفر می‌شود.
- **PRهای کوچک و زود merge شوند.** هر روز کار را با `main` به‌روز کنید. deploy را هیچ‌کس دستی انجام نمی‌دهد؛ سرور خودکار منتشر می‌کند.
- **هر کس با حساب Claude خودش کار کند.** استفاده مشترک از یک حساب طبق قوانین Anthropic مجاز نیست.
- **هر نفر یک کامپیوتر.** ریپو، issueها، PRها و سرور مشترک‌اند؛ کامپیوتر، حساب‌ها و کلیدها جدا. هر عامل با `claim.sh <n> --agent <ابزار>` شروع می‌شود و اسم صاحبش خودکار روی شاخه می‌آید، پس `team_status.py` نشان می‌دهد عامل‌های هر نفر الان روی چه کاری هستند.

## The rules

1. **One task = one GitHub issue.** Small and concrete, with an acceptance test in the body.
2. **Check before you start:** `bash scripts/dev/whoswhat.sh` (claimed issues, open PRs, files touched by
   more than one PR).
3. **Claim before you code:** `bash scripts/dev/claim.sh <n>` assigns you, labels the issue `in-progress`,
   creates branch `<login>/<n>-<slug>` in a new worktree and opens a **draft PR** (`Closes #<n>`). A draft PR
   makes the files you change visible to everyone from the first push.
4. **Areas reduce overlap.** Agree who owns which area for the week (label issues `area:judge`,
   `area:legal`, `area:roxira`, `area:infra`). Touching the other person's area: comment on their issue first.
5. **Small PRs, merge often, rebase daily** (`git fetch origin && git rebase origin/main`). Long-lived
   branches are what cause painful conflicts.
6. **Shared files that change often** (`docs/STATE.md`, `docs/progress.md`, `config/*.yaml`,
   `docker-compose.prod.yml`, migrations): only change them in a PR that needs it, keep the diff minimal,
   and never reformat. Migration timestamps must be unique: pull `main` right before creating one.
7. **Release what you drop:** `gh issue edit <n> --remove-label in-progress --remove-assignee @me`.
8. **Deploys are automatic** (server timer, docs/ops/AUTODEPLOY.md). Nobody deploys by hand. A merge to
   `main` is a release, so only merge green, reviewed PRs.
9. **Each person uses their own Claude account.** Sharing one account is against Anthropic's terms.
10. **One person, one computer** (see "Two developers, many agents" below). `bash scripts/dev/iam.sh
    <your-login>` is only a stopgap for a day when both must use one Mac: it switches gh, git push,
    `claim.sh` and the git author together. `bash scripts/dev/iam.sh` shows who is active.

## Live status report

`python3 scripts/dev/team_status.py` prints a Markdown report: main sha, last autodeploy result on prod
(over ssh) and HTTP status of the public sites, claimed issues and open PRs with the actor type (human,
`agent:<id>`, relay, dependabot), stale claims (idle more than 2 h on `agent/` branches, 24 h otherwise),
files touched by more than one open PR, PRs merged in the last 24 h, and a "Next actions" list. Flags:
`--no-ssh`, `--no-sites`, `--out FILE`, `--json`, `--telegram` (short version via `scripts/ops/notify`),
`--stale-hours N`. It is read-only, except `--release-stale`, which changes GitHub: it removes the
`in-progress` label and assignees from stale claims and comments on them. Without that flag it only prints
what it would do.

## For Claude sessions (both people)

At the start of every session, before writing code: run `bash scripts/dev/whoswhat.sh`, pick or create
an issue, and claim it with `scripts/dev/claim.sh`. Do not edit files listed under "touched by more than
one open PR" without telling the user.

## Two developers, many agents

Both developers trust each other fully and have equal standing. They are kept apart for practical
reasons only: attribution, separate usage limits, and no shared git config, stash or worktrees.

**One person, one computer.** Each developer works on their own computer, with their own GitHub, Claude
Code, Antigravity, DeepSeek, OpenCode and Zed accounts and their own API keys. Two people on one Mac share
`~/.gitconfig`, the git stash, `~/.claude` and the key files, which mixes up authorship and lets one
person's agents overwrite the other's work. If you must share a Mac for a day, use two macOS user
accounts.

**Shared:** the GitHub repository, issues and PRs, the production server, and `team_status.py`.

**Weekly lane split.** Each lane in `docs/AI_HANDOFF.md` has one owner for the week, recorded in the pinned
issue "Lane owners" (one line per lane, `Accounting: @login`). Your agents only work in your lanes.
Suggested start: one developer owns infrastructure, the server, keys, deploy and the factory; the other
owns the product lanes (accounting, sales and stock, CRM, UI). Production changes go through the
infrastructure owner.

**Every agent is claimed.** Each agent run, of any tool, starts with `claim.sh <n> --agent <tool>`. The
script appends your login, so branches read `agent/opencode-<login>/<n>-<slug>` and `team_status.py` shows
whose agent is doing what. One issue, one agent, one worktree. Two agents share a lane only when their
files are disjoint.

**Seeing each other.** Run `whoswhat.sh` before every claim. `team_status.py --telegram` runs every morning
and on demand: it lists every human and agent claim, stale claims, and files touched by more than one open
PR. A file listed there is off-limits until one of those PRs merges.

**Merging.** The merge queue orders merges. Agent PRs need a review by a different model family
(`.claude/agents/reviewer.md`). Shared hotspots (`package.json`, lockfiles, `app.module.ts`,
`app-shell.tsx`, `permission-matrix.snapshot.json`, new migrations) take one writer at a time: put
`[hotspot]` in the PR title and merge it before the next one starts.

## Daily team report

Every day at 09:00 (local time of the installing computer) one short message goes to Telegram: deploy
result, sites down, counts of claims, open PRs, stale claims, overlaps and merges in the last 24 h, then
the numbered next actions. The Mac runs `team_status.py` (it needs `gh`); Telegram is reachable only from
the server, so the text is piped over ssh to `scripts/ops/notify/notify.py` on `roxira-prod`, which uses
the server's own env. The full Markdown report is also written to `~/Library/Logs/roxira-team-status.md`.

- Install: `bash scripts/dev/install_team_status_launchd.sh` (needs `gh auth login` and the `roxira-prod`
  ssh alias). Log: `~/Library/Logs/roxira-team-status.log`.
- Uninstall: `bash scripts/dev/install_team_status_launchd.sh --uninstall`.
- Test by hand: `python3 scripts/dev/team_status.py --telegram-host roxira-prod` (or set
  `ROXIRA_NOTIFY_HOST`).
- Install it on one computer only. With two developers, if both install it, the team gets two messages a
  day.

## Setting up the second developer

1. Add their GitHub account to the `Mahan-film` organisation with the Maintain or Admin role.
2. On their own computer: `gh auth login`, `git clone https://github.com/Mahan-film/roxira-platform.git`,
   then `bash scripts/dev/install_hooks.sh` (pre-push local CI and the old-history guard).
3. Secrets: each developer uses their own API keys in their own `~/Secrets/roxira/roxira.env` (mode 600).
   Shared service keys (SMS, payment, OAuth) move only over a private channel (AirDrop or USB), never chat
   or email.
4. Production server: add their own SSH public key (one key per person, so the log shows who logged in) and
   copy `scripts/ops/ssh_config.example` into `~/.ssh/config`.
5. They read `CLAUDE.md`, `docs/AI_HANDOFF.md` and this page, then use `whoswhat.sh` / `claim.sh`.

## Two computers

The Mac and the Windows laptop (WSL 2): setup, secrets, Wi-Fi checks and rollback are in [ops/TWO_COMPUTERS.md](ops/TWO_COMPUTERS.md).
