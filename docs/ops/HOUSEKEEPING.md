# Safe housekeeping and branch backups

These scripts are deliberately conservative. They do not remove repository data,
branches, stashes, worktrees, containers, or persistent Docker data.

## Docker build-cache housekeeping

Run the report first (this is also the default):

```sh
scripts/ops/housekeeping.sh --dry-run
```

The report shows root filesystem capacity and the exact two Docker cache commands
that would be used. It does not invoke Docker. To carry out only those two
commands, confirmation must be explicit:

```sh
scripts/ops/housekeeping.sh --apply --yes
```

The apply mode runs only `docker builder prune -f` and `docker image prune -f`.
It is limited to build cache and dangling image layers.

## Local branch backups

```sh
scripts/dev/branch_backup.sh
scripts/dev/branch_backup.sh --dir /safe/backup/location
```

By default, backup artifacts are written beneath `$HOME/branch-backups`. For each
local branch with commits that are not present on any configured remote, the
script creates a Git bundle. It also saves the current stash listing and, for each
linked worktree, a porcelain status file and an unstaged diff patch.

Branch names containing `/` are encoded as `__` in bundle filenames. Existing
backup artifacts are preserved: a numeric suffix is added instead of replacing
an existing file. The script only reads the repository and writes new files to
the selected backup directory.
