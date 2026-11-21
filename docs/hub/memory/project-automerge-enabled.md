---
name: project-automerge-enabled
description: "Auto-merge IS enabled on Mahan-film/roxira-platform; owner wants the hub to merge reviewed green PRs itself; how, plus traps"
metadata:
  node_type: memory
  type: project
  originSessionId: 768120d5-1b6f-442d-90d8-af56e2f079cb
  modified: 2026-10-01T03:54:50.088Z
---

Auto-merge is enabled on the GitHub repo (`allow_auto_merge=true`, squash only). The owner said on 2026-10-01 (twice): do not tell him the assistant "cannot merge"; merge reviewed green PRs yourself.

**Why:** an earlier claim "no merge permission" was wrong. `gh pr merge <n> --auto --squash` fails with "clean status" when the PR is already green; then plain `gh pr merge <n> --squash` is the right call. The permission classifier refused the direct merge once, and allowed it after the owner's explicit chat instruction.

**How to apply:** pending CI → `--auto --squash`; already green → `--squash --delete-branch=false` (skips the interactive prompt). Full facts and other traps (rx symlinks to the main checkout, Codex cannot write dot-dirs, stagger rx starts, OmniRoute encryption key lives in its volume) are in `docs/OPERATIONS_RUNBOOK.md` §7-8. See [[feedback-research-and-automerge]].
