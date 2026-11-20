---
name: project-public-ci-and-team-tools-2026-11-03
description: "Public repo has GitHub Actions ON with only ci.yml enabled, secret scanning + push protection, team_status.py report; workflow pushes need mahan-films (workflow scope)"
metadata:
  node_type: memory
  type: project
  originSessionId: 7a35ddb3-e1bb-4ad0-83c5-8ab526c35869
  modified: 2026-11-03T13:39:28.821Z
---

2026-11-03 (owner said "Yes, CI only"): on public Mahan-film/roxira-platform, Actions enabled; every workflow except `ci.yml` is disabled in GitHub settings (Dependabot's dynamic one stays). Token default read-only, fork PRs need approval for all outside contributors. Secret scanning, push protection, validity checks and Dependabot alerts on. CI on main was 13/13 green. PR #56 adds `merge_group` to ci.yml so a merge queue can gate main; planned required checks: Detect changes, Secret scan (new commits only), Undefined names, System inventory up to date, Frontend gate.

Team tooling merged: `scripts/dev/team_status.py` (#54, live report + next actions, `--release-stale`, `--telegram`), handoff template + AGENTS.md §8 + `claim.sh --agent <id>` (#55).

**Why:** public repo makes Actions minutes and secret scanning free; owner wants autonomous parallel agents with safe merges.

Merge queue is LIVE (ruleset main-protection: required checks + merge_queue SQUASH). Merge with `gh pr merge N --squash` (adds to queue). Trap: CI started by `workflow_dispatch` does NOT count as the PR's required checks (statusCheckRollup null → BLOCKED forever); give the PR a real pull_request event (push, close+reopen, or `@dependabot rebase`). Old repo roxira-platform-private is archived (read-only).

**How to apply:** pushing changes to `.github/workflows/*` needs the mahan-films token (mahansudo lacks `workflow` scope). Never re-enable agent-review/agent-task/factory-* workflows without owner OK: they trigger on outsiders' PRs/issues. Cross-family review from the Mac fails without VPN; run `scripts/dev/llm_pool.py -g agent-strong-free` on srv1 after sourcing /etc/roxira/agents.env. In zsh never name a loop var `path` (it clobbers PATH). See [[project-public-repo-migrated-2026-11-03]].
