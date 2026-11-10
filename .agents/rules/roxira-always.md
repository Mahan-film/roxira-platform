---
trigger: always_on
---

# Roxira rules for every agent (always on)

Read `docs/agents/LESSONS.md` before every task. Your task queue is the newest `## WAVE` comment on issue 592.

## Never
- Never merge a PR, use `--admin`, `--no-verify`, or push to `main`. The review desk merges.
- Never rename, retimestamp or edit a migration that is already on `main`. New migrations get a timestamp after the newest one on `main`.
- Never weaken, skip or delete a test to make CI green. Never move a file so a check stops seeing it.
- Never put a key, token or password in code, tests, PR text or frontend. Never read `repomix-output.xml`, `database_snapshots/`, `*.sql`, `*.tar.gz`.
- Never run `pytest` over `src/` or the repo root.
- Never invent a field, column, endpoint, route, UI label or file. Open the real file first and copy the exact name or text.
- Never report something you did not run or open. "100% green" without the command and its counts is not evidence.

## Always
- Money is bigint minor units through `output_apps/enterprise_hub/modules/accounting/money.ts`; no `Number()`, `parseFloat` or float maths on money.
- Every tenant table: FORCE RLS, `TenantScope` on every query, and a `*.pg.spec.ts` that runs the real service as the `roxira_app` role (NOSUPERUSER NOBYPASSRLS).
- Fail closed: a missing role, tenant, setting or permission means "deny", never a permissive default.
- Same idempotency key + different body = HTTP 409.
- A new module goes in `app.module.ts` and a new page in `frontend/src/lib/nav-menu.ts`, or the PR body has a "Coordinator must add" section.
- Specs assert what the PR body claims. If a claim has no assertion, remove the claim.
- Before you call a PR ready: `gh pr view <n> --json mergeable,headRefOid`, then read the latest `Cross-family review` comment. A `Verdict: blocker` on the current head means the task is not done.

## Before you send the REPORT
Save the report to a file and run:

```
python3 scripts/dev/verify_agent_report.py --since <wave start date> <report file>
```

Fix every problem it lists (or move the row to BLOCKED with the reason) until it prints `RESULT: OK`. Paste its last line under the report.
