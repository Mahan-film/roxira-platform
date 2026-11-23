# Box merge gate: spec, dry-run comparison, go-live list

Why: on a private Free repo there is no branch protection, no ruleset, no merge queue and no auto-merge (verified on a
throwaway private Free repo: the API answers HTTP 403 with an upgrade message; `PRIVATE_FLIP_CHECKLIST.md`, section 1).
Draft PRs and JIT runner registration do work. The replacement is a polling gate on the
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
| 6 | Protected paths (decision B7, `protected_globs`: migrations, payment and billing, auth, `Dockerfile.prod`, prod compose, deploy scripts and units, workflow files, the gate's own code, tests and spec) are class **owner sentence required**: the gate never merges such a PR without an owner marker comment `OWNER-OK #<PR> <head sha7>` from an id in `owner_approver_ids`; it reports once per head and waits. Details in section 1a | yes (`OWNER` status, `owner_ok`) | the marker is tied to the head SHA (a push voids it). `owner_approver_ids` is empty on the box, so today every protected PR waits (fails closed). The label `owner-approved` is retired and ignored |
| 7 | Merges cleanly into the current `main` (B7-2): GitHub `mergeable` is true and the state is not `dirty` (unknown = wait one tick); the head need not be up to date. After a gate merge, no further merge until the push CI run of that merge on `main` has finished; if it failed the gate pauses itself (`PAUSE` file) and alerts | yes (`require_up_to_date`, default **false** since B7-2; `main_guard`) | `require_up_to_date = true` restores update-branch + wait (new head, new review). Section 6 has the decision and the trade-off |
| 8 | Kill switch, lock, dry-run | yes (`KILL` file, flock, `dry_run`) | |

### 1a. Rule 6 in detail: owner sentence required (decision B7)

Source: hub answer B7 on #592 and AGENTS.md section 4a: changes to migrations, payment, auth, `Dockerfile.prod` and deploy
scripts are never merged by a hub alone; they wait for an owner sentence in chat (main autodeploys, so a merge is a
production write). Everything else merges on "no blocker".

- **Classification.** Any changed file (or the old path of a rename) matching one of `protected_globs` makes the PR class
  `OWNER`. The list is configuration (code default and `merge_gate.example.toml` are kept equal by a test; the list in the live
  toml replaces the default, so it must be synced when the default changes). Default groups: migrations; payment, billing and
  auth; `Dockerfile.prod`, `docker-compose.prod.yml`, deploy scripts, `scripts/ops/autodeploy/**` and `deploy/**`;
  `.github/workflows/**`; the gate's own code, config example, tests and this spec. If GitHub's file list may be truncated
  (3000 files) the PR is also class `OWNER`.
- **Behaviour.** The gate never merges an `OWNER` PR without the marker. Without it: one PR comment per head SHA
  (`merge-gate: not merged: owner sentence required: ...`), nothing else, then it waits. The comment never contains a line that
  starts with the marker, so the gate cannot approve itself.
- **Marker.** A comment line that starts with `OWNER-OK #<PR number> <head sha>` (hex, 7 to 40 characters, a prefix of the
  exact head; case-insensitive; nothing after it on the line). Quoted lines (`> OWNER-OK ...`) and mid-line text do not count.
  The author's numeric id must be in `owner_approver_ids` (config only, never in git; empty list = no marker is ever valid).
  Those ids must belong to accounts that no agent, automation or box token can act as; otherwise the marker proves nothing.
- **Head-bound.** The marker names the head. A later push (including `update-branch`) makes it stale and the PR is `OWNER`
  again until the owner writes a new one on the final head. There is no revoke command: push, or put the PR on hold
  (`do-not-merge`, `needs-human`, `BLOCKER:` comment).
- **Not a shortcut.** After a valid marker the other rules still apply (review on the head, required checks, base, conflicts,
  holds, rule 7). The marker is the owner sentence, not a review.
- **Offline tests:** `src/ops/test_box_merge_gate_b7.py` (globs, marker forms, wrong author/PR/head, fail-closed, once per head,
  dry-run, self-approval impossible, history replay).

**DECISION B7-1 (for the hub; not decided here): who types the marker.** B7 says "an owner sentence in chat". The gate can only
see GitHub. Option (a, recommended): the owner writes the marker line on the PR from their own account; the hub only tells the
owner the exact line (the gate's comment contains it inline). Option (b): the hub posts it after the owner's sentence; this needs
the hub account's id in `owner_approver_ids`, which means a hub alone can release B7 PRs (against the B7 text) and can be
impersonated by anything holding that token. Without (a) or (b) chosen, protected PRs simply wait.

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

Under B7 the `protected` column of this report means "would have needed an owner sentence" (the replay accepts a marker
written before the merge). The result below predates B7: it counts the old, shorter glob list.

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
   = the numeric ids of the review-desk accounts (`gh api users/<login> --jq .id`); `owner_approver_ids` = the owners' own
   numeric ids (accounts no agent or box token can act as; decision B7-1); `approver_ids` = any human reviewer ids;
   `protected_globs` copied from the example (the live list replaces the default); decision on `require_up_to_date`
   (section 6). Ids stay in the box config, never in git. The label `owner-approved` is no longer used.
3. `required_checks` names re-verified against a recent head: `gh api repos/<repo>/commits/<sha>/check-runs --jq '.check_runs[].name'`.
4. `gh` login on the box is the merge account and the token can merge (`gh auth status`); merge works at all on a private
   repo from this account (test on a throwaway repo or the first live PR with the kill switch at hand).
5. Telegram: `notify.env` filled, one test message received; alert timer active and logging in dry-run for a day.
6. Comparison report re-run and accepted (section 2). `needs-human` and `owner-approved` labels exist in the repo.
7. `loginctl enable-linger` is on for the lane user (timers survive logout): `loginctl show-user <user> -p Linger`.
8. Runner capacity: CI on the box is the path that produces the checks (JIT pool, `CI_RUNNER_MODE`); otherwise the gate
   waits on hosted minutes.
9. The rest of `PRIVATE_FLIP_CHECKLIST.md` (P1-P15) is done. The gate is proven on 20 real PRs (hub answer B3; definition in
   checklist section 0). The flip itself is the owners' call alone.
10. Rollback known: `touch ~/.local/state/roxira-merge-gate/KILL` stops merging at once; `dry_run = true` returns to logging.

## 5. What the owner says "go" to

One sentence, in the hub chat: **"go: merge gate live"**. It authorises exactly: set `dry_run = false` in the live toml
(both the gate and the alert share it), watch one tick in the journal, and report on #592. It does not authorise the
repository flip, which stays with the main hub or the owner.

## 6. Decision for the hub: `require_up_to_date` (rule 7)

**DECISION B7-2 (taken by the box hub under the owner's delegated authority, 2026-11-23): `require_up_to_date = false`.**
The dry-run of 2026-11-21/22 (31 h, issue #592) measured the up-to-date rule blocking 80 of 90 merged PRs. What replaces
it, all implemented in `merge_gate.py`:

1. **Merges cleanly into current main.** `mergeable` must be true (not conflicting). `null` (GitHub has not computed it
   after `main` moved) waits one tick without a comment. Required checks must be green on the head (rule 3).
2. **One merge per tick, and one main CI cycle per merge.** After a gate merge the gate records the merge commit. It
   does not merge another PR until the `ci.yml` push run of that commit on `main` has completed. No run after
   `main_ci_grace_seconds` (300) means a paths-ignored push (docs only), treated as passed. `cancelled` is not a failure.
3. **Pause on a red main.** If that run ended `failure`, `timed_out` or `startup_failure`, the gate writes
   `<state_dir>/PAUSE`, sends one Telegram alert (`notify.env`, same path as the direct-push alert) and merges nothing
   until a human removes the file. It does not use `KILL`, which also silences the direct-push alert.
4. **Re-evaluation.** Every tick re-reads every labelled PR against the new `main`; nothing is cached between ticks.

Known residual risk: two PRs that are each green but break together can land one CI cycle apart; step 3 limits the
damage to one merge and stops the gate. Main failures that are not gate merges (a manual push) do not pause the gate:
the direct-push alert covers them.

The original comparison, kept for the record (section 2 numbers, 30 merged PRs):

Numbers (section 2, 30 merged PRs, 2026-11-21): 26 of 30 were behind `main` at their head. With the switch on the gate
would merge 1 of 30; with it off, 10 of 30 (the other 20 fail review, checks or protected paths, which is the gate working).
So nearly every PR is behind when it is ready: the switch is not an edge case, it decides the throughput of the whole gate.

| | `true` (code default today) | `false` |
|---|---|---|
| What it guarantees | the head contains every commit on `main`, so the green checks ran on what will be merged (what the merge queue's merge-group commit gave) | the head was green on its own base; the merge result is not tested before it lands |
| Cost | every merge makes all other open PRs behind: each needs `update-branch`, a fresh CI run and, because the head changes, a new review-desk cycle (about 2 h); one merge per cycle, and a PR can chase `main` indefinitely while others merge. With 26 of 30 behind this stalls most of the flow | none; ready PRs merge one per tick (5 min) |
| Risk | slow, and agents re-review the same diff repeatedly | two PRs that are each green but break together can land back to back; `main` autodeploys, so a semantic conflict reaches production unless caught after the merge |
| Protected-path PRs | each update voids the owner's `OWNER-OK`, the owner must re-approve the final head | the marker stays valid unless the author pushes |

Recommendation (adopted, with the guard implemented as steps 2 and 3 above rather than a "most recent run on `main` is green" precondition): default **`false`**, and the post-merge CI
run plus the direct-push alert (section 3) stay on. Optional hardening, if the hub wants it: treat a behind PR as up to date
only when the files changed on `main` since its merge base do not overlap the PR's files (a compare call), else wait.
`true` stays available as a one-line config change if semantic conflicts are seen. The overlap check is not implemented.

Keeping branches current without the gate rewriting history (applies whichever default is chosen):

1. **Agent-side (recommended).** The agent that owns a branch rebases or merges `main` into it before asking for review
   (label `merge-queue`) and when the gate comment says "behind". History of a branch is only ever rewritten by its owner.
2. **`update-branch` by the gate (exists, active only when the switch is `true`).** GitHub merges `main` into the branch; no
   history is rewritten, no force-push, and `expected_head_sha` makes the call fail rather than overwrite a push that raced it.
   It still pushes to an agent's branch unasked and voids review and `OWNER-OK` for that head. Safe, but noisy.
3. **Rebase plus force-push by the gate: not enabled, and not to be added without an owner rule.** If the owners want it, the
   rule should say at least: opt-in per PR by a label an owner id set; `agent/*` branches only; `--force-with-lease` against the
   head the gate evaluated; never on a PR that is class `OWNER` or has an `OWNER-OK`; stop on any conflict and hold the PR; the
   previous head SHA is written in a PR comment before the push so the old state can be found.
