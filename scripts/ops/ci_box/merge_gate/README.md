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
4. the latest `Cross-family review ... @ <sha>` comment (author id in `review_comment_author_ids`, else login in `review_comment_authors`) names this head
   and has `Verdict: no blocker`, or an allowlisted human (numeric id in `approver_ids`) APPROVED this head, or an id in
   `approver_ids` / `owner_approver_ids` wrote a comment line `DESK-OVERRIDE #<PR> <head sha>: <reason>` for this exact
   PR and head (it replaces only the review; protected paths, holds and checks still apply);
5. no hold: no label in `block_labels` (`needs-human`, `do-not-merge`), no `[needs owner]` in the title, no unresolved
   `BLOCKER:` comment from an allowlisted human id (cleared by a later `UNBLOCK:`), and no unresolved `Verdict: blocker`
   line in a comment from an id in `approver_ids` / `owner_approver_ids` posted after the head commit (cleared by a later
   `UNBLOCK:` from those ids, or a later `OWNER-OK` / `DESK-OVERRIDE` for the exact head). Bot desk comments are rule 4;
6. no file matches `protected_globs` (decision B7: migrations, payment, auth, Dockerfile.prod, deploy scripts,
   workflows, the gate itself), unless an owner comment line `OWNER-OK #<PR> <head sha7>` exists, written by an id in
   `owner_approver_ids` for this exact head. Without it the PR is class "owner sentence required": never merged, one
   comment per head, then it waits. Empty `owner_approver_ids` = such PRs are never merged by the gate;
7. the PR merges cleanly into the current main (`mergeable` true; unknown = wait a tick). `require_up_to_date` is
   `false` by default (decision B7-2): a green head that is only behind main merges. `true` makes the gate call
   update-branch and wait for checks on the next tick.

Main CI guard: after a gate merge the gate waits for that commit's push CI run on main (`main_ci_workflow`) before the
next merge. If it fails the gate pauses itself: it writes `<state_dir>/PAUSE`, sends one Telegram alert and merges
nothing until main is green again. Auto-resume (`auto_resume = true`, default): at the start of each tick, if the newest
completed `ci.yml` push run on main is on the current main HEAD and succeeded, the gate deletes PAUSE and sends one
Telegram notice (`merge gate resumed: main green at <sha7>`); never while `KILL` exists, and dry-run only logs.
`rm <state_dir>/PAUSE` still resumes by hand. Review desk dispatch: a PR that passed every other rule, has every required
check green on its head and has no desk verdict for that head gets a `review-desk.yml` dispatch (one per tick, only when
no desk run is queued or running). If no verdict appears `desk_retry_minutes` (90) after a dispatch, the same head is
dispatched again, at most `desk_max_dispatches_per_head` (2) times. `dispatch_review_desk = false` turns it off. It is
the only write done in dry-run.

`queue_mode = "github"` (opt-in; the code default is `"legacy"`): main uses GitHub's native merge queue, so the gate only ENQUEUES PRs
(GraphQL `enqueuePullRequest` bound to the head SHA; the queue then runs CI per merge group and merges). Per tick it
enqueues up to `max_enqueue_per_tick` (default 5) eligible PRs, oldest first, skipping PRs already in the queue
(`isInMergeQueue`), and does not wait for the main push CI of each merge. It enqueues nothing while `PAUSE` exists
or the newest completed `ci.yml` push run on main is red (one Telegram alert per red run). `queue_mode = "legacy"`:
one REST squash merge per tick, then wait for that merge's main CI run (rule below).

Legacy: one merge per tick (oldest PR number first). A comment is posted on the PR when it is merged, and when it is
refused (once per head SHA and reason). Waiting states (checks running) are silent.

## Operate
- Dry-run (default): `dry_run = true` in the config or `--dry-run`. It only logs "would merge/comment".
  Try it by hand: `python3 merge_gate.py --config ~/.config/roxira-merge-gate/merge_gate.toml --dry-run`
- Logs: `journalctl --user -u roxira-merge-gate -f`
- Kill switch: `touch ~/.local/state/roxira-merge-gate/KILL` (remove to resume). Lock: `flock` on `lock` in the
  same dir, so overlapping ticks exit quietly. State: `state.json` (comment dedupe, dispatches, last merge), `state.dryrun.json` in dry-run (so go-live still
  posts the real comments).
- Pause: `PAUSE` file in the state dir (written by the gate after a red main CI; removed by the gate when main CI is
  green on the main HEAD again, or remove it by hand). `KILL` stops the gate and the direct-push alert; `PAUSE` stops
  only merges.
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
records the SHA. Dry-run (the default while `dry_run = true`) logs and sends nothing.
Telegram goes through `scripts/ops/notify/notify.py`; put `NOTIFY_BOT_TOKEN=...` and `NOTIFY_CHAT_ID=...` in
`~/.config/roxira-merge-gate/notify.env` (mode 600, created empty by `install_user.sh`). Without them the alert is
only logged. Try: `python3 check_main_push.py --config ~/.config/roxira-merge-gate/merge_gate.toml --dry-run`.
In dry-run it keeps its own pointer `last_main_sha.dryrun` (detection and alert text run for real, nothing is sent, the live
pointer is untouched; the first live run initialises it). Spec, comparison report and go-live list: `docs/ops/MERGE_GATE_SPEC.md`.

## Dry-run comparison with history
`python3 compare_history.py --config ~/.config/roxira-merge-gate/merge_gate.toml --limit 30` replays the last N merged PRs
through the gate rules (read-only, GET only) and prints what would have been blocked and why. See the spec.

## Known limits
- Auto-resume needs a `ci.yml` push run on the current main HEAD. If the newest push is docs-only (paths-ignored, no
  run), the gate stays paused until the next code push to main turns green or someone removes `PAUSE`.
- `protected_globs` in the live toml replaces the code default: the B1 core globs (decision 2026-11-25) only take effect
  on the box once copied from `merge_gate.example.toml`.
- `OWNER-OK` is tied to the head SHA (a later push voids it); there is no revoke command, push or add `do-not-merge`.
- Rule 4 reads only the latest desk comment, so a `Verdict: blocker` comment newer than the head from another author (a hub re-review) is not seen. `scripts/dev/hub_merge.py` (#1282) closes this for hub merges; the box gate still needs the same check against the head commit date.
- Only check-runs are read (not legacy commit statuses). Review comments from authors not in the allowlist are ignored.

## Tests
`python3 -m pytest scripts/ops/ci_box/merge_gate -q` (gh mocked, no network). Never run pytest over `src/` or the repo root.
