---
name: project-fleet-supervision-2026-11-05
description: How the fleet really works and the supervision setup (batches 1-4), traps found
metadata:
  type: project
---

Fleet (`scripts/dev/fleet.py`, launchd `ir.roxira.fleet`) only continues jobs queued with `fleet.py run <n...>`; it does not poll labels. `lane:<x>` label forces a lane. Area locks use 3 path levels, so add an `Areas: scripts/lock/<n>` line to issue bodies to run in parallel.

**Why:** batch 1-4 findings: free models wrote specs blind (fixed by jest gate #293), fabricated help pages and Playwright specs (check labels with grep before merge), Claude lane dead when OAuth expires (force `lane:opencode`), merge queue refuses `--delete-branch`, M1 gate must stay report-only.

**How to apply:** supervisor daemon `~/.roxira-fleet/supervisor.py` + `supervise.sh` (DeepSeek review, only a line starting `VERDICT`); queue jobs with `--no-merge`; empty verdict = reviewer timeout, not a pass. Tally goes on issue #230 every 4 h. See [[project-state-2026-10-30]].
