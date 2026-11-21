---
name: project-public-repo-and-zero-cost
description: "Public MIT repo mahan-films/roxira, zero-GitHub-spend strategy, secrets file location, what the classifier blocks"
metadata:
  node_type: memory
  type: project
  originSessionId: 8397ea00-8e5d-4ca7-bb7e-b2a46f06fd77
  modified: 2026-10-03T15:09:04.335Z
---

Public MIT repo `mahan-films/roxira` (single clean commit, no history, no data/, gitleaks clean) was created 2026-10-03; private `Mahan-film/roxira-platform` stays the working repo. Owner wants zero GitHub spend: private-repo Actions blocked by billing/spend limit (default $0), so CI runs locally (`scripts/dev/local_ci.sh`, PR #463) and public repo keeps only a secret-free ci.yml.

Owner keeps ALL API keys in `~/Secrets/roxira/roxira.env` (chmod 600), one NAME=value per line; never paste values in chat. Only OPENROUTER_API_KEY needed to start. Old Google/Kavenegar keys were only in the private repo, so rotation is not required unless leaked.

**Why:** owner is tired of rotating keys and paying; the first public push was rejected by GitHub push protection (Google OAuth values), which proves the check works.

**How to apply:** ask for one env var NAME at a time, never the value. Creating/pushing to public repos, reading secret lines, and `gh repo create` get blocked by the auto-mode classifier; hand the owner the exact command instead. Owner merges private PRs with `gh pr merge N --squash --admin` (CI blocked). See [[feedback-test-before-telling]].
