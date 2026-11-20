---
name: project-github-plan-automerge
description: "Repo moved to org Mahan-film (GitHub Team) on 2026-09-25; server deploy key needs the org \"allow deploy keys\" setting on"
metadata:
  node_type: memory
  type: project
  originSessionId: 4da31019-fd4c-4f74-bea0-a21965e340d9
  modified: 2026-09-26T12:23:06.949Z
---

On 2026-09-25 the repo moved from `mahan-films/roxira-platform` (personal, Free) to **`Mahan-film/roxira-platform`**, an organization on GitHub Team with 1 seat. It is still private. Rulesets now work there.

- The server pulls over SSH with a repo deploy key (read/write). The new org had `deploy_keys_enabled_for_repositories: false`, so the server's `git fetch` failed with "Repository not found" until the owner enabled deploy keys in the org settings.
- The auto-mode classifier blocks Claude from changing repo or org settings (rulesets, allow_auto_merge, variables) through `gh api`. The owner does those in the UI.

- As of 2026-09-26 the whole agent chain works end to end: issue labelled `agent` → OpenCode on Actions (executor model `deepseek-v4.1-flash`) → PR → CI → `agent-review` by Sonnet 5 → auto-merge gate. The first run was issue #42 → PR #45. `AGENT_ENABLED`, `AUTO_MERGE_ENABLED` and `AGENT_REVIEW_MODEL` are set as repo variables. To stop it, delete `AUTO_MERGE_ENABLED` or set `AGENT_ENABLED` to false.

**Why:** auto-merge needs a ruleset on `main`, and private repos on a Free plan cannot have one.

**How to apply:** use the new repo path in every `gh` call. If a server pull fails, check the org deploy-key setting first. Setup checklist: `docs/ops/AUTO_MERGE.md`. Related: [[project-roxira-overview]].
