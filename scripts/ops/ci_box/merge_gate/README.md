# Polling merge gate (R20-2, issue #1018)

Replaces GitHub merge queue + auto-merge once the repo is private on GitHub Free. Runs on the CI box as
user `mahanfilms` from a `systemd --user` timer every 5 minutes (box is behind NAT, so no webhooks). Python
stdlib only (3.11+, uses `tomllib`); talks to GitHub with `gh api` (logged in as `mahansudo`), optionally
through a local HTTP proxy (`proxy` in the config).

## Merge rules
A PR is squash-merged, with `sha=<head>` as guard, only when all of these hold on its exact head SHA:
1. label `merge-queue` (or auto-merge requested, while `allow_auto_merge_flag = true`);
2. not a draft, base is `main`, no conflicts;
3. every check in `required_checks` is success/skipped/neutral (missing or running = wait, failed = refuse);
4. the latest `Cross-family review ... @ <sha>` comment (author in `review_comment_authors`) names this head
   and has `Verdict: no blocker`, or an allowlisted human (numeric id in `approver_ids`) APPROVED this head;
5. no file matches `protected_globs`, unless label `owner-approved` is present and its latest `labeled`
   timeline event was made by an id in `owner_approver_ids`;
6. branch not behind main; if behind, the gate calls update-branch and waits for checks on the next tick.

One merge per tick (oldest PR number first). A comment is posted on the PR when it is merged, and when it is
refused (once per head SHA and reason). Waiting states (checks running) are silent.

## Operate
- Dry-run (default): `dry_run = true` in the config or `--dry-run`. It only logs "would merge/comment".
  Try it by hand: `python3 merge_gate.py --config ~/.config/roxira-merge-gate/merge_gate.toml --dry-run`
- Logs: `journalctl --user -u roxira-merge-gate -f`
- Kill switch: `touch ~/.local/state/roxira-merge-gate/KILL` (remove to resume). Lock: `flock` on `lock` in the
  same dir, so overlapping ticks exit quietly. State: `state.json` (comment dedupe, merged PRs).
- Go live at the flip: set `dry_run = false`, fill `approver_ids` / `owner_approver_ids`, and check that
  `required_checks` match the real names:
  `gh api repos/Mahan-film/roxira-platform/commits/<sha>/check-runs --jq '.check_runs[].name'`.

## Install on the box (as mahanfilms)
```
git clone https://github.com/Mahan-film/roxira-platform.git ~/rx-gate-src   # or git pull in an existing clone
bash ~/rx-gate-src/scripts/ops/ci_box/merge_gate/install_user.sh
gh auth status                      # must be mahansudo
systemctl --user list-timers | grep merge-gate
```
Once as root: `loginctl enable-linger mahanfilms` so the timer runs without a login session.

## Direct-push alert (#1049)
`check_main_push.py` (timer `roxira-check-main-push`, every 10 min, same user, config, proxy, state dir and `KILL`
switch) alerts on Telegram when `main` gets a commit that is not part of a merged PR, or when its history was
rewritten. It remembers the last seen SHA in `<state_dir>/last_main_sha`, so each push alerts once. First run only
records the SHA. Dry-run (the default while `dry_run = true`) logs and sends nothing, writes no state.
Telegram goes through `scripts/ops/notify/notify.py`; put `NOTIFY_BOT_TOKEN=...` and `NOTIFY_CHAT_ID=...` in
`~/.config/roxira-merge-gate/notify.env` (mode 600, created empty by `install_user.sh`). Without them the alert is
only logged. Try: `python3 check_main_push.py --config ~/.config/roxira-merge-gate/merge_gate.toml --dry-run`.
Note: while `dry_run = true` the first-run state is not written, so every tick re-initialises quietly; it starts
guarding after the flip.

## Known limits
- `owner-approved` is not tied to a head SHA: removing the label after a suspicious push is the owner's job.
- Only check-runs are read (not legacy commit statuses). Review comments from authors not in the allowlist are ignored.

## Tests
`python3 -m pytest scripts/ops/ci_box/merge_gate -q` (gh mocked, no network). Never run pytest over `src/` or the repo root.
