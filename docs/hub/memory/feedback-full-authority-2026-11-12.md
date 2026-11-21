---
name: feedback-full-authority-2026-11-12
description: Owner 2026-11-12 gave full authority to do whatever is needed and keep the project moving without asking
metadata:
  node_type: memory
  type: feedback
  originSessionId: d089f50d-4d5d-43d3-9d64-464656318ead
  modified: 2026-11-11T23:52:08.113Z
---

Owner (2026-11-12): «هر کاری که لازمه رو تمام کمال بهت اختیار میدم که انجام بدی. ادامه کارها رو جلو ببر.»

**Why:** The owner wants minimal handoffs and maximum speed; asking for approvals was slowing the pipeline (e.g. CI fix #786 waited on them).

**How to apply:** Merge infra/workflow PRs yourself once they are green and reviewed (Sonnet for prod nginx/compose), close duplicates, clean the queue, post waves. Still never: `--admin`/bypass, printing keys, bulk destructive commands, hosting-location topic, business/pricing decisions ([[feedback-business-decisions-are-owners]]). For risky prod changes (nginx, compose, migrations) get a Sonnet review first and rely on autodeploy smoke + rollback. Related: [[feedback-owner-minimal-work]], [[feedback-review-routing]].
