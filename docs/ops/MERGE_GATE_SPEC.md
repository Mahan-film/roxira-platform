# Box merge gate: spec, dry-run comparison, go-live list

Why: on a private Free repo there is no branch protection, no ruleset, no merge queue and no auto-merge
(`PRIVATE_FLIP_CHECKLIST.md`, section 1). Draft PRs and JIT runners do work. The replacement is a polling gate on the
CI box (`scripts/ops/ci_box/merge_gate/`, issues #1018/#1029, #951) plus a direct-push alert (#1049/#1088).
Operation, install and kill switch: that directory's `README.md`. This page is the rule spec, the way to measure the gate
before it is switched on, and the go-live list. **The gate is in dry-run and must stay there until the owner says "go".**

## 1. Rules: required / enforced / gap

All rules are evaluated on the exact head SHA of the PR; the merge call carries `sha=<head>`, so a push after the
evaluation makes GitHub refuse the merge. One merge per tick (every 5 min, oldest PR first).

| # | Rule | Enforced in `merge_gate.py` | Gap / note |
|---|---|---|---|
| 1 | The PR asks to be merged: label `merge-queue` (or auto-merge requested while `allow_auto_merge_flag = true`) | yes | the flag is for the transition only; auto-merge does not exist on private Free, so only the label counts after the flip |
| 2 | Not a draft, base is `main`, no merge conflict | yes (`draft`, `base`, `mergeable_state == dirty`) | drafts are skipped silently |
| 3 | Required checks green on the head: every name in `required_checks` is `success`/`skipped`/`neutral`; missing or running = wait; failed = refuse. Latest run per name wins | yes | names must equal the real check-run names; the live toml lacks `Semgrep CE (new findings)` (code default and example have it). Only check-runs are read, not legacy commit statuses |
| 4 | Review: the latest `Cross-family review ... @ <sha>` comment names this head and says `Verdict: no blocker`, written by a review-desk account; or an allowlisted human APPROVED this head. Only the latest desk comment counts: a later "no blocker" on the same head overrides an earlier "blocker", and a later comment for another head voids it | yes | authors matched by **numeric id** when `review_comment_author_ids` is set (this PR); until it is set on the box the check falls back to the login, which can be renamed. Human approval ids (`approver_ids`) are empty on the box. The desk runs about every 2 h, so a new head waits for its review |
| 5 | No hold: label `needs-human` or `do-not-merge`; `[needs owner]` in the title; an unresolved `BLOCKER:` comment from an allowlisted human id (cleared by a later `UNBLOCK:` from one) | yes, added in this PR (`block_labels`, `block_title_markers`, `hold_reason`) | the BLOCKER/UNBLOCK convention needs `approver_ids` or `owner_approver_ids` filled; label holds work without ids. A blocker verdict from the review desk already fails rule 4 |
| 6 | Protected paths (`migrations/**`, `.github/workflows/**`, `scripts/ops/deploy*.sh`, `docker-compose.prod.yml`) need label `owner-approved`, whose latest `labeled` event was made by an id in `owner_approver_ids` | yes | `owner-approved` is not tied to a head SHA: a push after the label keeps it (owner removes the label to revoke). `owner_approver_ids` is empty on the box, so today every protected PR is refused |
| 7 | Rebase before merge: the head contains the tip of `main`; if behind, the gate calls `update-branch` and waits for the checks on the new head | yes (`require_up_to_date`, default true) | it merges `main` into the branch (a rebase would need a force-push); the PR is squash-merged so history stays linear. Each merge makes every other open PR behind, so with several ready PRs the gate merges one per CI cycle (about 6 min). Set `require_up_to_date = false` to mirror the old ruleset (strict off); owner decision, see section 2 |
| 8 | Kill switch, lock, dry-run | yes (`KILL` file, flock, `dry_run`) | |

Not enforced and not planned here: reviewer identity beyond the id allowlist, CODEOWNERS, signed commits, "no direct push"
(the alert below detects it, it cannot prevent it on Free).

## 2. Dry-run comparison report

Question it answers: "if the gate had been live, which of the PRs that actually merged would it have blocked, and why?"
A rule that blocks many merged PRs is either too strict for the current workflow, or a real process gap.

`compare_history.py` (same directory; read-only, GET requests only, enforced in code and in a test). It imports the gate's
own rule methods, so the replay cannot drift from the gate. Per merged PR it replays, as of the merge time (comments,
reviews and timeline events after `merged_at` and check-runs started after it are ignored): hold, protected paths, review,
required checks, and behind-ness against the commit the PR was merged onto (first parent of the merge commit). Not
replayable: the `merge-queue` label, draft state, `mergeable_state`. Output: a Markdown table (`--format json` also) with
verdict and the failing rules, and a summary: gate would merge N, would have blocked M, blocked-by-rule counts.

```
python3 scripts/ops/ci_box/merge_gate/compare_history.py --config ~/.config/roxira-merge-gate/merge_gate.toml --limit 30 > report.md
```
About 7 API calls per PR, roughly 4 minutes for 30 PRs through the proxy. Blind spot: PRs closed without merge are not
replayed, so "gate would have merged something humans rejected" is not measured; for that, watch the live dry-run log
(`journalctl --user -u roxira-merge-gate`) for `would squash-merge` lines on PRs you do not want merged.

Result on 2026-11-21 (last 30 merged PRs, live config, before the new rules were on the box): gate would merge 1,
would have blocked 29. By rule (a PR can fail several): behind 26, review 12, checks 6, protected 4. If rule 7 is relaxed
(`require_up_to_date = false`) 10 of 30 would merge; the other 20 fail review (head had no matching "no blocker" review,
either none yet or only on an older head), a required check (Pytest failed on its head), or a protected path (migrations,
`docker-compose.prod.yml`). Reading: the merge queue tested every PR on a merge-group commit, so being behind at the PR head was normal and harmless
there; the gate has no merge group, so it asks for an up-to-date head instead (rule 7). Many PRs were also merged with the review
desk lagging the head, and six were merged with `Pytest (unit)` already failed on the head (for example #1167: failed at 14:37 UTC, merged
at 17:23 UTC). The gate will slow that down until reviews land on the final head. That is the intended trade, but
the owner should know it before "go".

Acceptance bar for go-live (proposal): re-run the report over a week of normal work with the gate config as it will be
live (ids filled, `Semgrep CE` added). Every "would block" row is explained as a rule working, not a misconfiguration, and
nothing the owner wanted merged is stuck in the live dry-run log for more than one review-desk cycle.

## 3. Direct-push alert (`check_main_push.py`) in dry-run

What it does: every 10 min compares the last seen `main` SHA with the current one; every commit between must belong to a
merged PR (`commits/<sha>/pulls`), else one Telegram line `[ALERT] Direct push to ...`; a failed compare (force-push,
unknown old SHA) alerts as "history rewritten". Change in this PR: in dry-run it now keeps its own pointer
`last_main_sha.dryrun` and runs the whole detection path, so the dry-run journal is meaningful; it never touches the live
pointer (the first live run initialises it at go-live) and never sends.

Verified end to end on the box on 2026-11-21 with the repo copy, a scratch state dir and the real GitHub API through the
proxy (live state untouched):

Run with the PR's code (the `.dryrun` pointer) on 2026-11-21:

| Case | Result |
|---|---|
| First run, no state | initialises `last_main_sha.dryrun` at the current `main`, exit 0, no live pointer written |
| Pointer 39 commits back | compared 39 commits, all from merged PRs, exit 0 (an earlier run with the old code covered 139 commits: also clean, 170 s, longer than the unit's `TimeoutStartSec=120`; irrelevant at a 10-min cadence, matters only for a catch-up after a long pause) |
| Pointer set to an unknown SHA | `[ALERT] ... history rewritten or compare failed`, exit 1, "Telegram alert not sent" (dry-run) |
| True positive: scratch config with `base` = my pushed branch, pointer = its fork point | `[ALERT] Direct push to <repo>:<branch> without a merged PR: <short sha>`, exit 1 (the branch commit belongs only to an open PR, so it counts as direct); second run quiet ("unchanged") |
| Live pointer file present | left untouched by a dry-run, only `.dryrun` changes |

No commit among the last 139 on `main` was a direct push, so the concern in checklist item P12 (alert firing on daemon
audit pushes) did not show up in this window. Not verified: the Telegram send itself (needs the owner's `notify.env`), and
a real direct push (would need pushing to `main`; deliberately not done).

**Finding: the alert is not installed on the box.** The installed gate predates #1088: there is no
`roxira-check-main-push.timer`, no `notify.env`, and `~/roxira-merge-gate/` has no `check_main_push.py` or `notify.py`.
Fix (as the lane user, dry-run first is built in): `bash <repo>/scripts/ops/ci_box/merge_gate/install_user.sh`, then
`systemctl --user list-timers | grep main-push`, then fill `~/.config/roxira-merge-gate/notify.env` (mode 600).

## 4. Before go-live: what must be true

1. This PR merged, then `install_user.sh` re-run on the box (new gate code, alert timer, `notify.py`, empty `notify.env`).
2. Live `merge_gate.toml` brought in line: `Semgrep CE (new findings)` in `required_checks`; `review_comment_author_ids`
   = the numeric ids of the review-desk accounts (`gh api users/<login> --jq .id`); `owner_approver_ids` = the owner's
   numeric id; `approver_ids` = any human reviewer ids; decision on `require_up_to_date`. Ids stay in the box config,
   never in git.
3. `required_checks` names re-verified against a recent head: `gh api repos/<repo>/commits/<sha>/check-runs --jq '.check_runs[].name'`.
4. `gh` login on the box is the merge account and the token can merge (`gh auth status`); merge works at all on a private
   repo from this account (test on a throwaway repo or the first live PR with the kill switch at hand).
5. Telegram: `notify.env` filled, one test message received; alert timer active and logging in dry-run for a day.
6. Comparison report re-run and accepted (section 2). `needs-human` and `owner-approved` labels exist in the repo.
7. `loginctl enable-linger` is on for the lane user (timers survive logout): `loginctl show-user <user> -p Linger`.
8. Runner capacity: CI on the box is the path that produces the checks (JIT pool, `CI_RUNNER_MODE`); otherwise the gate
   waits on hosted minutes.
9. The rest of `PRIVATE_FLIP_CHECKLIST.md` (P1-P15) is done; the main hub, not this gate, decides the flip.
10. Rollback known: `touch ~/.local/state/roxira-merge-gate/KILL` stops merging at once; `dry_run = true` returns to logging.

## 5. What the owner says "go" to

One sentence, in the hub chat: **"go: merge gate live"**. It authorises exactly: set `dry_run = false` in the live toml
(both the gate and the alert share it), watch one tick in the journal, and report on #592. It does not authorise the
repository flip, which stays with the main hub or the owner.
