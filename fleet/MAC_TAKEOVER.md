# Taking over on the Mac (read after HANDOFF.md)
A Claude session cannot move between computers. The new session continues from this folder and GitHub.
1. `git fetch origin fleet-state && git worktree add ../roxira-fleet origin/fleet-state`
2. Read `fleet/HANDOFF.md`, then line 2 onward of `fleet/QUEUE.md`.
3. Before starting anything, check the laptop is really gone: `git log -1 origin/fleet-state` older than 30 minutes, and no recent pushes on open draft PRs. Two coordinators on one PR is the failure to avoid; the draft PR is the lock.
4. The scripts hardcode /home/mahan paths and use GNU tools. Set them to the Mac's paths before use.
Secrets stay on each computer in ~/Secrets/roxira and are never in this branch.
