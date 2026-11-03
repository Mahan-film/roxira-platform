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
10. **Same Mac, two people:** log in both GitHub accounts once (`gh auth login`), then run
    `bash scripts/dev/iam.sh <your-login>` when you sit down. It switches gh, git push, `claim.sh` and the
    git author together, so every commit, claim and PR shows who did it. `bash scripts/dev/iam.sh` shows
    who is active.

## For Claude sessions (both people)

At the start of every session, before writing code: run `bash scripts/dev/whoswhat.sh`, pick or create
an issue, and claim it with `scripts/dev/claim.sh`. Do not edit files listed under "touched by more than
one open PR" without telling the user.

## Onboarding the collaborator

1. Add their GitHub account to the `Mahan-film` organisation (repository write access).
2. They install the GitHub CLI and run `gh auth login`, then
   `git clone git@github.com:Mahan-film/roxira-platform.git`.
3. They read `CLAUDE.md`, `docs/STATE.md` and this page, then use `whoswhat.sh` / `claim.sh`.
4. Secrets stay on the owner's side (`~/Secrets/roxira/roxira.env`, server `.env`). The collaborator
   does not need production secrets for normal work.
