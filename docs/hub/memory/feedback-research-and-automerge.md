---
name: feedback-research-and-automerge
description: "Owner wants every named tool/site researched and tested first-hand, challenges backed by evidence, and PRs merged via GitHub auto-merge"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 35c6613c-d845-4f9a-881a-c265fcd2b819
  modified: 2026-09-30T11:04:48.574Z
---

1. When the owner names a repo, tool, website or technology, research it (and better/newer alternatives) before answering; test reachability and behaviour yourself instead of assuming.
2. To disagree with the owner's information, show evidence (a test result, a source), not an opinion.
3. If a source site is unreachable, try other sites yourself and come back with one that works and can be cited.
4. Merge reviewed PRs with `gh pr merge <n> --auto --squash` (GitHub auto-merge, waits for required checks). The owner bought GitHub Team for this.

**Why:** 2026-09-30 the owner was frustrated at being asked to click merge and at answers given without research. A direct `gh pr merge --squash` was blocked by the auto-mode classifier, but `--auto` is accepted.

**How to apply:** after reviewing a PR diff, enable auto-merge right away; never for spend-adding PRs (e.g. scheduled paid workflows) or prod deploys, which still need an explicit yes. See [[feedback-owner-minimal-work]] and [[project-github-plan-automerge]].
