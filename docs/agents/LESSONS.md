# Lessons for every agent (read before every task)

These are real mistakes found in review. Each line is a rule. Reviewers add a line when they find a new mistake. Do not delete lines.

## Never hide from a check
1. Never rename, move or split a file so that a test, lint or guard stops seeing it. Example: `x.controller.ts` → `x.routes.ts`, which skipped `permission-matrix.spec.ts` (#636, #640). If a check fails, fix the cause, or write in the PR body why it fails.
2. Never weaken, skip or delete a test to make CI green. Never use `--no-verify`.

## Say what is not wired
3. A new Nest module must be imported in `app.module.ts`, and a new page needs a menu entry in `nav-menu.ts`. If you may not edit those files, add a section **"Coordinator must add"** to the PR body with the exact lines. Otherwise the feature is not live and must not be reported as done (#636, #640).
4. "Ready" means mergeable and wired. Check `gh pr view <n> --json mergeable` before you report a PR as ready (#448, #449 were reported ready while CONFLICTING).

## Tenant isolation (RLS)
5. CI connects as the superuser `postgres`, so RLS errors never show in CI. Production connects as `roxira_app` (NOSUPERUSER NOBYPASSRLS). Every pg spec for tenant tables must run the **real repository or service methods** as such a role (#618).
6. Every query on a tenant table runs inside `TenantScope`. This includes workers, crons and other modules' joins. Find every caller with `git grep` on the table and entity names before you enable FORCE RLS (#618).
7. Tables read before the tenant is known (login, refresh, invites, public forms) must not get a tenant-equality policy. They need their own design (#618).

## Money, data, text
8. Money is bigint minor units through `modules/accounting/money.ts`. In the UI use `formatMoneyRial`. Never use `Number()`, `parseFloat` or float division (#593: a missing «ریال»).
9. User-built queries: identifiers come from a whitelist, values are bound parameters, and nothing is interpolated. CSV export neutralises `= + - @` at the start of a cell.
10. Help pages describe only what the code does today. Check every route, label and role against the code. An API with no page must say so plainly (10 help PRs needed 1 to 9 fixes each).
11. Use only fields that exist in `frontend/src/types` and the real entities. Never invent a column or an endpoint.

## Process
12. Plan first: put the plan as the first PR comment. One task per PR, and stay inside your area's files.
13. Before reporting, list exactly what you did **not** check.
14. A log-only "shadow" flag must keep the old decision authoritative and only log the diff; if turning it on changes who gets access it is not shadow mode (#634).
15. A new Nest module must provide every provider it injects. `AccessModule` exports `AuditService` but not `TenantScope`; registering such a module unseen fails app boot (#636, #640).
16. Check that the role that must call an endpoint can pass its guard: `members:approve` is owner and admin only, so named approvers and delegates were always refused (#636).
17. A page guard must match the server rule: the payroll page was admin-only in the browser while the server allowed hr, and the server allowed admin and read_only to payslips (#634).
18. Idempotency: the same key with a different body is a 409 (store a request fingerprint), and take a lock before the insert so a skipped insert never runs a numbering trigger and burns a number (#638).
19. A page calls the real proxy through `lib/api/*-client.ts` (`/api/backend/...` with the auth client), never a made-up `/api/proxy/...` path with a bare `fetch` (#640).
20. User-built SQL: validate aliases against a strict pattern, bind LIMIT and OFFSET, validate value types per column, and add an injection attempt to the pg spec (#640).
21. Every file path, spec name and PR number in a report or audit must be one you opened. Run `git cat-file -e origin/main:<path>` on each cited path before posting (#671 cited four files that do not exist and marked all 29 #230 lines complete).
22. A REPORT row names only a PR you opened or pushed in this wave, with its current head SHA. Never reuse an old PR number for a task you did not do (WAVE 4 listed T59 as "PR #134 MERGED": #134 is from October and the tour was never run). An issue is not a PR.
23. Before reporting a PR as done, read its latest `Cross-family review` comment. A `Verdict: blocker` for the current head means the task is not done.
24. Copy UI text, field names and error codes from the real source file before you write a spec (WAVE 4 #681 asserted four labels and a 400 that do not exist; #644 read `total_amount` where capture drafts store `total`).
25. A permissive default (`roleKey = 'owner'`, a missing setting treated as allowed) is a security bug. Fail closed (#675).
26. Pre-tenant webhook entrypoints (Telegram/Bale) execute without app.tenant_id context and require narrow SECURITY DEFINER lookup and code consumption functions with explicit grants to roxira_app role before entering TenantScope.
27. Cost masking interceptors must run by default across all authenticated routes with an explicit exempt list, use case-insensitive regex pattern matching with negative lookahead to protect dimension keys (e.g. costCenter), and enforce WeakSet cycle guards on object traversal to prevent stack overflows on bidirectional relationships.
28. FX revaluation ledger reconciliation must never skip zero-balance accounts, ensuring accounts with 0 Rial ledger balances cannot be manipulated to recognize arbitrary foreign exchange gains or losses.
