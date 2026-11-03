# Public repo migration (2026-11-03)

All of this was done on 2026-11-03. No secret value is written in this file.

## Why

- Live keys were in git history: Kavenegar, SMS.ir, Tavily (two keys), Brave, Exa, Jina, Firecrawl, Kira and AssemblyAI.
- Also in history: a Google OAuth client secret, and srv1 values for POSTGRES_PASSWORD, TWENTY_DB_PASSWORD and ZIBAL_MERCHANT.
- GitHub keeps PR refs, so the old repo could not be made public.
- The Team org has 1 seat, so `mahansudo` could not join the private repo.

## What was done

- The old repo was renamed to `Mahan-film/roxira-platform-private`. It stays private. It is a read-only archive (old PRs, closed issues).
- A new public repo `Mahan-film/roxira-platform` was built from `main` with `git filter-repo`.
- Removed paths: `venv/`, `database_snapshots/`, `postgres_full_dump.sql`, `production_bundle/enterprise_db_dump.sql`, `repomix-output.xml`, `roxira_before_upgrade_2026-08-22.tar.gz`.
- 27 literal replacements were applied to file contents and commit messages. The list is private and never committed.
- Test fixtures got fake values of the same length, so tests still pass.
- Result: 1,262 commits, `.git` about 55 MB.
- New root commit: `a72e19fd`. Old root commit: `c0c36302`.
- New `main` is `407c9b93`. It equals old `da5bca39` except 6 test-fixture lines.
- Tag `v1.0.0-stable` was kept.

## Verification

- gitleaks with the repo `.gitleaks.toml`: no leaks over the full history.
- The default-only ruleset reports 1 false positive in `.env.example`. It is an empty placeholder and is already allowlisted.
- The sha256 of every value was checked against all history objects. Sources checked:
  - `~/Secrets/roxira/roxira.env`
  - the Mac `.env`
  - srv1 `/opt/roxira_platform/.env`
  - `scripts/infra/key_pool/generated/keypool.env`
  - `/etc/roxira/*.env`
- No secret matches. Only URLs, model ids, collection names, public phone/email and a DB user name matched.
- Server values were compared by hash only. No secret left srv1.

## Settings copied to the new repo

- Auto-merge on. Delete branch on merge. Squash, merge and rebase allowed.
- 31 labels.
- Ruleset `main-protection`: no deletion, no force push, PR required, 0 approvals, repo admins can bypass.
- Actions stay disabled (we use local CI).
- Deploy keys were moved from the archive, because a key can be on one repo only: `roxira-platform` (write) and `srv1 (91.107.248.99) read-only`.
- `mahansudo` is an admin collaborator (invite accepted).

## Issues and PRs

- GitHub cannot transfer issues from a private to a public repo.
- The 40 open issues were recreated as new numbers 9-48 (body, comments, labels). Each footer links the old number.
- The old issues were closed with a link to the new one.
- Open PRs:
  - 957 (fleet) is now #51.
  - 974 (relay batch) is now #49.
  - 908 (UI) was recreated (new number #52).
  - The rest were closed with a note. Dependabot reopens its own.

## The switch

- srv1 `/opt/roxira_platform`: frozen, fetched, `git reset --keep origin/main`, old head kept as branch `old-main-da5bca39`, unfrozen. Autodeploy reports it is already at `407c9b93`.
- Mac `~/Developer/roxira-platform`: `main` moved to the new main. The old heads are kept as branches `old-main-da5bca39` and `old-main-local-dc62cc2`.
- `~/Developer/roxira-lawwatch` is a worktree of the Mac repo.
- `relay_publish.sh` publishes from a fresh worktree of `origin/main`, so it needs nothing.
- Other old worktrees and branches stay local only.

## Guard against pushing old history

- Script: `scripts/dev/guard_old_history.sh`.
- `scripts/dev/install_hooks.sh` installs it as `.git/hooks/guard-old-history`. The `pre-push` hook calls it before local CI. `SKIP_LOCAL_CI` does not skip it.
- It refuses any push whose commits have root `c0c36302`, unless the remote URL contains `roxira-platform-private`.
- Installed on the Mac (shared `.git/hooks`) and on srv1.
- Tested: it blocks old history, allows new history and allows the archive. It also blocked a real stale branch push during the migration.

## Open items

- **Codeberg mirror is STOPPED.** `roxira-codeberg-mirror.timer` on srv1 is off.
  - The private Codeberg repo `mahanofficial/roxira-platform` still has the old history.
  - Its default branch is an old `agent/121-...` branch.
  - Codeberg's pre-receive refused the forced update. The mirror token has no admin right.
  - Owner fix: in Codeberg, delete and recreate the empty private repo (or set the default branch to `main` and allow force-push). Then run `systemctl start roxira-codeberg-mirror.timer` on srv1.
- The keys stay in use, but they are no longer in public history. Rotating them is still recommended later.
- Old worktrees: before pushing, move the work with `git rebase --onto origin/main old-main-da5bca39 <branch>` (or cherry-pick).

## How to work now

- Clone or fetch the public repo.
- Run `bash scripts/dev/install_hooks.sh` once per clone.
