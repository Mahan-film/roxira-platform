# History rewrite plan (NOT executed — owner sign-off required)

This is a **plan only**. Nothing in this doc has been run against `main` or
any clone the team shares. Rewriting history rewrites every collaborator's
clone and invalidates every open PR and fork; it must not run until the
owner explicitly says go.

## Why

Two separate problems currently live in git history, not just the working
tree:

1. **Secrets in history.** Real API keys / DB passwords were committed at
   some point before W1/W2 (PRs [#2](https://github.com/Mahan-film/roxira-platform/pull/2),
   [#4](https://github.com/Mahan-film/roxira-platform/pull/4)) moved
   config to `.env`. Removing them from the current tree does not remove
   them from history — anyone with clone access (or a leaked git bundle)
   can still `git log -p` or `git show <old-sha>` to read them.
2. **Large tracked blobs.** `venv/` (~2,900 files), `database_snapshots/`,
   `*.sql` dumps and `repomix-output.xml` were committed and then deleted
   in later commits (this PR). Deleting them only stops *new* clones from
   growing further from this point forward — the blobs stay in every
   existing commit's history and in `.git/objects`, so `git clone` still
   downloads them and repo size stays large.

`docs/STRATEGY.md` §6 records that the owner has chosen **not** to rotate
the leaked keys yet, so this plan treats the purge as a repo-hygiene /
size problem the owner can schedule independently of rotation — but the
plan below still removes the key material from history, since a shrink
pass touches the same commits anyway.

## Tool

[`git-filter-repo`](https://github.com/newren/git-filter-repo) (not
`git filter-branch`, not BFG — filter-repo is the currently maintained,
Git-recommended tool and is much faster on a repo this size).

```bash
# macOS
brew install git-filter-repo
# or
pip install --user git-filter-repo
```

## Step-by-step plan

1. **Freeze the repo.** Announce a change freeze; pause the ~30-minute
   daemon commits (`roxira-autodaemon.service`/`.timer` on the server —
   see W8) and merge or close any open PRs first, since their branches
   will need to be rebuilt against the rewritten history.

2. **Take a full backup** of the repo (bare clone) before touching
   anything:
   ```bash
   git clone --bare git@github.com:Mahan-film/roxira-platform.git roxira-platform-backup.git
   ```

3. **Fresh clone to work from** (filter-repo refuses to run on a clone
   that still has a remote configured, to avoid accidental pushes):
   ```bash
   git clone git@github.com:Mahan-film/roxira-platform.git roxira-rewrite
   cd roxira-rewrite
   ```

4. **Strip the large/dump paths from every commit:**
   ```bash
   git filter-repo \
     --path venv/ \
     --path database_snapshots/ \
     --path production_bundle/enterprise_db_dump.sql \
     --path postgres_full_dump.sql \
     --path repomix-output.xml \
     --path roxira_before_upgrade_2026-08-22.tar.gz \
     --invert-paths
   ```

5. **Strip known secret strings.** Build a replacement list of every real
   key/password found in history (grep history first, do not guess):
   ```bash
   git clone --bare git@github.com:Mahan-film/roxira-platform.git /tmp/scan.git
   cd /tmp/scan.git
   git log -p --all | grep -EoI '(sk-[a-zA-Z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|postgres://[^ ]+|OPENROUTER_API_KEY=.*|KAVENEGAR_API_KEY=.*|SMS_IR_API_KEY=.*|JWT_SECRET=.*)' \
     | sort -u > /tmp/found_secrets.txt
   # review /tmp/found_secrets.txt by hand, then build replacements.txt as:
   #   <literal-secret-value>==>REDACTED-<name>
   ```
   Then, in `roxira-rewrite`:
   ```bash
   git filter-repo --replace-text /tmp/replacements.txt
   ```
   (This is why keys should still be rotated eventually — a purge only
   removes them from *future* clones, not from any backup/fork/bundle
   made before the rewrite, including this session's SSH access to the
   production host.)

6. **Verify:**
   ```bash
   git log --oneline | wc -l          # commit count should match expectations
   du -sh .git                         # should shrink drastically from current size
   git log --all -p | grep -c 'sk-'    # spot-check: 0 hits for known patterns
   git log --stat --all -- venv/       # should be empty
   ```

7. **Re-add the remote and force-push**, protected branch rules
   temporarily relaxed:
   ```bash
   git remote add origin git@github.com:Mahan-film/roxira-platform.git
   git push origin --force --all
   git push origin --force --tags
   ```

8. **Every collaborator (and the CI/CD checkout, and the production
   server) must re-clone**, not pull/rebase:
   ```bash
   # on 5.75.200.67
   cd /opt
   mv roxira_platform roxira_platform.old-history
   git clone git@github.com:Mahan-film/roxira-platform.git roxira_platform
   cp roxira_platform.old-history/.env roxira_platform/.env
   # re-point docker compose, verify `docker compose config -q`, then swap in
   ```
   Any local branch not yet merged must be re-created by
   `git rebase --onto` against the new history or, more simply, its diff
   re-applied as a fresh branch — old commit SHAs no longer exist upstream.

9. **Rotate the leaked keys anyway**, once convenient — the rewrite
   reduces exposure but does not guarantee no copy of the old history
   survives (local clones, CI caches, forks, this SSH session's shell
   history on the production host).

## Rollback

The bare backup from step 2 is the rollback: `git push --force` it back
to `origin` restores the pre-rewrite history exactly, provided no one has
already re-cloned from the rewritten remote.

## Explicitly out of scope for this PR

- Running any of the above. This PR only stops the tree from growing
  further (`git rm --cached` + `.gitignore`); the historical blobs and
  secrets remain in `origin/main`'s history until the owner approves this
  plan and schedules the freeze window.
