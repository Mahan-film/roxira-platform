# Antigravity /automation lanes

Design: lanes are stateless queue workers (skill `.agents/skills/process-queue/SKILL.md`, rules in `GEMINI.md`). An Antigravity automation starts a fresh agent conversation on a schedule, with no memory of earlier runs and with no chat open. State lives in git, GitHub and issue 592.

Verified 2026-11-26 against the Antigravity docs (`/docs/commands/automation/`, `/docs/skills`): `/automation` exists in the Antigravity App; it creates an automation stored as `~/.gemini/config/sidecars/<id>/sidecar.json`; new automations start Paused until switched on in the Automations tab; the default model is Flash (Flash Lite / Flash / Pro selectable); Agent Skills are read from `.agents/skills/<name>/SKILL.md`. `/schedule` is different (it dies with its chat) and stays banned.

Each automation prompt is one line. The skill holds the loop, so the prompt never changes between rounds.

## Automations (all model Flash, all start Paused, owner switches them on)

| Id | Lane | Schedule (the agent pins the computer's timezone) | Prompt |
| --- | --- | --- | --- |
| Q1 | L5 (accounting core) | every 3 h, 08:00-23:00: `0 8,11,14,17,20,23 * * *` | `Use skill process-queue for lane L5. Queue: P1 accounting rows for #1473.` |
| Q2 | L1 (CI and ops fixes) | every 4 h: `0 9,13,17,21 * * *` | `Use skill process-queue for lane L1.` |
| Q3 | L8 (desk-blocker fixer) | every 2 h: `0 */2 * * *` | `Use skill process-queue for lane L8. Repair existing PRs only.` |
| Q4 | L11 (docs and tests) | every 6 h: `0 10,16,22 * * *` | `Use skill process-queue for lane L11.` |
| M1 | M1 (labeler) | every hour: `0 * * * *` | `Use skill process-queue for lane M1. Only label ready PRs merge-queue.` |

Notes:
- Q1 first because owner priority 1 is automatic accounting gated by #1473. Other builder lanes (L2, L3, L9, L10) are not automated until Q1-Q4 are stable.
- Max 5 automations running at the same moment (quota is compute-based; weekly lockouts were reported). Stagger the minutes if two fall on the same hour.
- One lane runs in one place at a time. Do not run the same lane from an automation and a manual chat together.
- Each run stops itself after 8-12 PRs or an empty queue. No run opens a new row above 8 open PRs per lane.
- Automations cannot merge: the skill only adds `merge-queue`; the box gate merges.

## Stay manual
- L4 (Smart Judge) and L6 (country packs): B1 core, human-hub only. Run in a chat the owner watches.
- L7 (box and phone): needs the laptop and `NEEDS BOX RUN` follow-up.
- L12 (decision packs), P1 (planner, uses `/plan`), M2 and M3 (conflict and health roles): started by the owner when needed.

## Check an automation
Automations tab -> the automation -> last run. Then on GitHub: new `agent/antigravity-<lane>/*` PRs, a `REPORT` comment on issue 592, and `python3 scripts/dev/pr_board.py` for the queue. If a run did nothing, the queue was empty or the lane was at the WIP cap.

## Switch off
Automations tab -> toggle off (or delete). Nothing else to clean up; open PRs stay as they are.
