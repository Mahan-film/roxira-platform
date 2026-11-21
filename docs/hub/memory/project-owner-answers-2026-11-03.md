---
name: project-owner-answers-2026-11-03
description: "Owner's answers to the 8 infra review questions (Telegram daily, rotate keys now, fleet low cap, worktree cleanup, review rule, colleague access, old server)"
metadata:
  node_type: memory
  type: project
  originSessionId: 7a35ddb3-e1bb-4ad0-83c5-8ab526c35869
  modified: 2026-11-03T17:11:45.388Z
---

Answers given 2026-11-03 to the colleague-review questions:
1. Daily dev report: short version to Telegram, details by email.
2. Mac backup pull moved to srv1 (done by hub session: restic, daily 10:15, pass in ~/Secrets/roxira/restic-dr.pass).
3. KEYS: owner 2026-11-03 (later): do NOT touch any keys at all, including the Google secret and DB passwords. No rotation. (Supersedes an earlier 'rotate now' suggestion.)
4. Fleet: install with a low cap (start $2-5/day, owner sets the number); paid lanes only as fallback.
5. Old worktrees: remove one by one, only with no dirty files and no unique commits; keep branches.
6. Merges: agent PRs need a cross-family model review as a required check; CODEOWNERS on migrations/, auth, access, scripts/ops, .github/, config/ needing the other human; admin bypass only for emergencies, with the reason written in the PR.
7. Colleague: GitHub write (not admin); srv1 read-only user NOT in the docker group (docker = root).
8. Old server <ip>: decommission after 7 consecutive days of successful backup + restore drill on srv1, and a final snapshot.

The two developers are fully trusted peers, one computer and one GitHub/Claude account each; a Windows laptop joins on the same Wi-Fi. Lane owners: issue #61.

**Why:** owner forwarded these as the decisions to act on.
**How to apply:** act on them without asking again; the colleague's GitHub login is still unknown (needed for CODEOWNERS and #61). See [[project-public-ci-and-team-tools-2026-11-03]].

Done 2026-11-03 evening:
- Daily team report: Mac launchd `ir.roxira.team-status` at 09:00, which sends over ssh to srv1's notify.py (PR #70).
- `.gitattributes` (LF; fixtures kept as `-text`) in PR #71.
- docs/ops/TWO_COMPUTERS.md in PR #72.
- Removed 4 safe worktrees: agy/a17, a17-fix, a18, a19.
- Old-history branches with work still missing from main were rescued as LOCAL branches only: rescue/issue-497, rescue/issue-959, rescue/agy-a3, rescue/agy-a10. They are not pushed.
- 5 old branches conflicted and look superseded: issue-500, issue-501, agy/a6, agy/a7, agy/a8.
- Still to do: CODEOWNERS (needs the colleague's GitHub login), fleet. Key rotation is cancelled.

The two developers live and work together. Either account may be used on either laptop; the owner said the choice doesn't matter. Owner gave full authority for everything except keys.

Accounts (owner, 2026-11-03 night): Mac = GitHub mahan-films. It is active in gh; the repo-local git identity is mahan-films with its noreply email (the global email is a real gmail, so don't use it); branch prefix is mahan-films. Windows WSL laptop = mahansudo, agent id claude-win. #61 is updated.
