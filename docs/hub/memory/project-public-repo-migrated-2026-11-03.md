---
name: project-public-repo-migrated-2026-11-03
description: Mahan-film/roxira-platform is now PUBLIC with scrubbed history; old repo = roxira-platform-private; guard refuses old root c0c36302
metadata:
  node_type: memory
  type: project
  originSessionId: 7a35ddb3-e1bb-4ad0-83c5-8ab526c35869
  modified: 2026-11-03T12:37:22.227Z
---

On 2026-11-03 the working repo became public: new `Mahan-film/roxira-platform` (root a72e19fd) built with git filter-repo; old repo renamed `Mahan-film/roxira-platform-private` (private archive, old PRs/issues closed with links). mahansudo is admin collaborator. Issue/PR numbers restarted (issues 9-48, PRs from #49). Deploy keys moved to the new repo. srv1 and Mac main follow the new history; old heads kept as `old-main-da5bca39`.

**Why:** live keys (Kavenegar, SMS.ir, Tavily, Brave, Exa, Jina, Firecrawl, Kira, AssemblyAI, a Google OAuth secret, srv1 DB/Zibal values) were in old history; Team org had 1 seat.

**How to apply:** any branch or worktree created before 2026-11-03 has OLD history — the pre-push guard (`scripts/dev/guard_old_history.sh`, Mac shared .git/hooks + srv1) refuses it; rebase/cherry-pick onto new origin/main. Open item: Codeberg mirror timer on srv1 stopped (Codeberg repo has old history; owner must recreate it). Details: docs/ops/PUBLIC_REPO_MIGRATION.md. Supersedes the "mahansudo not a collaborator" note in [[project-two-github-accounts]] and the key-leak state in [[project-key-leak-audit-2026-11-03]].
