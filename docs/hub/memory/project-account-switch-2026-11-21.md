---
name: project-account-switch-2026-11-21
description: Mac Claude account moves to the colleague (main owner); old account goes to the Linux laptop box hub; approval rule O-1 open
metadata:
  node_type: memory
  type: project
  originSessionId: cf07ce5b-aa34-4385-9e89-7531103e2c5b
  modified: 2026-11-21T05:54:06.382Z
---

2026-11-21: the owner asked to switch the Mac's Claude login to his colleague, the main owner, who becomes the main hub user. The old account stays on the Linux laptop (`roxira-ci`, user `mahanfilms`) as the box hub. GitHub accounts do not change: Mac `mahan-films`, laptop `mahansudo`.

The handover lives in git:
- `docs/hub/MAIN_HUB_MASTER_BRIEF.md`: the main hub's role is chief architect, planner and general manager.
- `docs/hub/HUB_START.md` §2a: the switch checklist and the first prompt.
- `docs/STATE.md`, updated 2026-11-21.

No artifacts, scheduled tasks or cron jobs were tied to the old account.

**Why:** the first account was used on the Mac only to learn the strategy. Now that the build is done, the main owner runs the Mac hub.

**How to apply:**
- Production and spend approvals come from the person running the Mac hub, until the partners settle O-1.
- Rebuild live state from GitHub, not from the docs.
- Mac-to-laptop tasks go through #965.

Related: [[project-two-github-accounts]], [[project-ci-box-and-phone-stack]].
