---
name: project-deploy-tests-tty-hang
description: Antigravity pushes on the Mac failed pre-push because 6 deploy tests read /dev/tty and hung; fixed 2026-11-20 with start_new_session
metadata:
  node_type: memory
  type: project
  originSessionId: cf07ce5b-aa34-4385-9e89-7531103e2c5b
  modified: 2026-11-20T11:53:05.194Z
---

2026-11-20: all Mac Antigravity lanes (L2, L3, ...) were blocked: the pre-push local CI's pytest step timed out (60 s) in `src/ops/test_autodeploy.py` (`test_auto_confirm_ignored_*`) and `src/ops/test_deploy_migrate.py` (`test_migrate_yes_*`). Root cause: `scripts/ops/deploy_local.sh` reads the human confirmation from `/dev/tty` when a controlling terminal exists; Antigravity runs commands in a real pty, so the script waited for a human. Claude's shells have no tty, so the hub never saw it ("fails locally only" in STATE was this).

Fix: on main via #1000 (commit 7ce68e100, `_run_script` helper with `start_new_session=True`); the hub's duplicate #1006 was closed. Phone stack on roxira-ci is up 2026-11-20 (all checks OK) except carrier SIP registration "Unregistered". Reproduce with `script -q /dev/null <python> -m pytest ... < /dev/null`.

**How to apply:** when a lane says "tests time out only on macOS/in Antigravity", suspect tty/interactive reads first and reproduce under `script -q /dev/null`. Interim unblock for lanes: `LOCAL_CI_SKIP_PYTEST=1 FRESH_DB_PORT=<unique> git push` (GitHub CI still runs pytest).
