---
name: project-two-github-accounts
description: "Two collaborators share this Mac — GitHub mahan-films (org admin) and mahansudo; local git author is \"Test User\""
metadata:
  node_type: memory
  type: project
  originSessionId: 57956b53-2027-4640-9c32-5946ce2ceda4
  modified: 2026-11-03T09:12:52.641Z
---

As of 2026-11-03 two people work on Roxira from the same Mac: GitHub `mahan-films` (admin of org Mahan-film, logged in via gh) and `mahansudo` (id 211047265, not yet a collaborator on Mahan-film/roxira-platform; owns an old private repo `mahansudo/ghazihoushmand`, last updated 2025-12-13). They fully trust each other and want any task picked up by either, but with per-person attribution.

**Why:** `.git/config` has user `Test User <test@example.invalid>`, so local commits are not attributable; PRs all show mahan-films.

**How to apply:** before committing/claiming, run `bash scripts/dev/iam.sh <login>` (branch mahansudo/iam-switch, 2026-11-03; switches gh + git author to noreply address). Both accounts are in gh keyring. The auto-mode classifier blocks Claude from adding repo collaborators — the owner runs that command. See [[project-roxira-overview]].
