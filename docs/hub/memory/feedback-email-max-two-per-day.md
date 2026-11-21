---
name: feedback-email-max-two-per-day
description: Owner wants at most one email per 12 hours; urgent alerts go to Telegram only; GitHub repo notifications set to ignored
metadata:
  node_type: memory
  type: feedback
  originSessionId: d089f50d-4d5d-43d3-9d64-464656318ead
  modified: 2026-11-04T11:06:48.802Z
---

Owner (2026-11-04): emails arrived every 2-3 minutes (GitHub PR/review/dependabot mails + server alerts). Rule: **no more than 1-2 emails per day, one digest every 12 hours** (about 08:00 and 20:00 Tehran). Urgent problems go to Telegram only, with a cooldown.

**Why:** The flood wasted the owner's time; he reads mail on his phone.

**How to apply:** Never add a new mail sender; route everything through `scripts/ops/notify/notify.py` digest queue (session email-digest, 2026-11-04). The Mac set `Mahan-film/roxira-platform` subscription to ignored for both `mahan-films` and `mahansudo` — do not re-subscribe or @-mention the owner's accounts in PRs. Keep costs near zero (free models, key pool, callbacks/event-driven instead of polling). Related: [[feedback-owner-minimal-work]].
