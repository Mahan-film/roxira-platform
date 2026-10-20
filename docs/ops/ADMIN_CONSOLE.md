# Owner admin console (`/owner`)

One page for the owner: dashboard, users and subscriptions, payments, models and cost, research and agents,
marketing, system health. Persian, RTL, dark `.ghazi-theme` (navy / gold / cyan), usable on a phone.

- URL: `https://roxira.ir/admin` (middleware redirects `/owner` from ghazihoushmand.ir to roxira.ir).
- Frontend: `output_apps/enterprise_hub/frontend/src/app/admin/page.tsx` + `src/components/admin/*`,
  client `src/lib/api/admin-console-client.ts`. `/admin/mission-control` (factory control room) is a separate page, linked from the header.
- API: `output_apps/generated_modules/smartjudge/admin_api.py` (routes, authz, validation), `admin_store.py`
  (Postgres repository), `admin_hostdata.py` (files / sqlite / small services), `admin_site_check.py` (SSRF-safe fetch).
  Mounted by `smartjudge_module.py` under `/api/v1/apps/judge/admin/console/*`.

## How admins are configured

Admins are the phones listed in the environment variable **`SMARTJUDGE_ADMIN_PHONES`** (comma separated, e.g.
`09120000009,09350000000`), in `/opt/roxira_platform/.env`. It is the same list the older admin routes use
(`/admin/export-dataset`, `/legal-graph/ingest`). The code reads it from the container environment on every
request, but the container only sees `.env` at start: after adding or removing a phone, recreate `roxira_app_prod`.

- Empty list = nobody is admin (the default). E-mail accounts can never be admins.
- Sign in on the page with the normal SMS code. The token goes in `sessionStorage` (gone when the tab closes).
- Hiding the page is NOT the protection. Every endpoint does, in this order: valid bearer token (401) -> phone in
  the admin list (403) -> per-admin hourly rate limit (429 + `Retry-After`; reads 1200/h, writes 120/h, heavy
  actions 40/h) -> Pydantic body with `extra="forbid"` (422).
- No secret reaches the browser: the browser holds only the owner's login token. Host data is read server-side.
- Nothing accepts shell text. The one subprocess is `taskq.py add` with a fixed argv list, `shell=False`; the task
  text is written to a file, never to argv. Slugs/scopes/ladder steps are validated by regex/enum first.

## Tabs

1. **داشبورد (Dashboard)** - today (since Tehran midnight) / 7 days / 30 days: new users, active users, questions by
   plan level, paid orders, revenue in toman and USDT, active subscriptions per level, LLM cost and calls, error rate,
   margin (USD revenue equivalent minus LLM cost), Umami visitors if reachable.
   Definitions: *new users* = e-mail accounts created + phone users whose first conversation falls in the window
   (phones have no signup table); *active* = distinct users who asked a question (guests are not stored);
   *questions by plan* use the user's CURRENT plan. Toman revenue is converted with `ADMIN_USD_TOMAN_RATE`
   or the pricing service rate; if no rate is known the margin shows "-".
   A red banner counts recent paid orders whose owner has no active plan (see "activation suspect" below).
2. **کاربران و اشتراک‌ها (Users)** - search by phone or e-mail: plan, expiry, today's usage per level (read from the
   rate-limit counters without incrementing), recent orders. **Grant / extend / revoke** with a mandatory reason.
   The entitlement write and the `admin_audit` row are ONE transaction. The 60 s tier cache is cleared after a change.
   Grantable plans: the `SJ_*` plans from `pricing_service` and `7_DAYS_TRIAL`. The audit log (last 50) is shown here.
3. **پرداخت‌ها (Payments)** - `payment_orders` for Zibal and USDT (status, amount, track id, tx hash).
   `activation_suspect` is a heuristic: paid in the last 3 days and the owner has neither an active entitlement nor
   one updated since the payment (the payment flow does not persist its in-memory `activation_pending` flag).
   *Unmatched USDT*: rows of `crypto_unmatched_tx`; **match to order** takes an order id and re-validates on the
   server before anything changes: crypto enabled and address configured, order is `usdt_trc20` and pending/expired,
   order address equals our address, unmatched amount equals the order amount to the micro-USDT, the transfer is not
   older than the order, AND the transfer is fetched again from TronGrid (right USDT contract, `to` is our address,
   same value). Then order paid + tx marked resolved + audit row in one transaction (a tx can never pay two orders -
   unique index), then the normal `activate_with_retry`. If activation fails it is reported and audited as
   `crypto_match_activation_pending` (grant manually in tab 2). **Re-verify** (Zibal, non-paid orders only) calls the
   existing `payment_service.verify_invoice` (amount check and idempotency included).
4. **مدل‌ها و هزینه (Models)** - tier -> gateway group (`llm_gateway.model_for`, i.e. the live env), fallback
   chains from `config/key_pool.yaml`, last-hour and 24 h requests per group with errors, empty answers (success with 0
   completion tokens), p50/p95 latency and cost, and the newest `*.md` bake-off report from
   `/var/lib/roxira-eval/bakeoff` (otherwise the "run it on the server" command). "fallback" marks groups that only
   occur as a fallback target (approximation: the cost log has the served group, not the requested one).
5. **پژوهش و ایجنت‌ها (Research and agents)** -
   (a) Research box: calls `roxira_research` (`POST /research`, GPT-Researcher + SearXNG) as a background job, polls
   every 4 s, shows elapsed time against the 900 s limit (the service reports no stages) and the final report with
   source links. Two jobs at a time. Public questions only: phone numbers / 10-digit ids in the query are refused.
   (b) Site check: one polite fetch, `RoxiraBot/1.0 (+https://ghazihoushmand.ir)`, robots.txt honoured (a robots.txt
   that cannot be read means "do not crawl"), no redirects followed, 10 s timeout, 1.5 MB cap. Only http/https on
   ports 80/443; every resolved address must be globally routable and the socket connects to the validated address
   (no DNS rebinding). Reports status, headers, title/description/canonical/hreflang/JSON-LD and quick checks (h1, alt,
   viewport, compression, security headers, page weight, TTFB). No Lighthouse library exists in the repo, so these are
   our own static checks. No bot-detection bypass, captcha solving or TLS/browser fingerprint spoofing.
   (c) Task queue: form (slug, text, scope dirs, ladder, public flag, priority) -> writes
   `/var/lib/roxira-agents/admin-tasks/<ts>-<rand>-<slug>.md` and runs `taskq.py add` with a fixed argv; recent tasks
   come from `taskq.db` opened read-only. The worker (`taskq.py run`) is unchanged and picks the task up.
6. **بازاریابی (Marketing)** - `proposed` and `draft` posts with approve / reject, and the last 30 published. The
   transitions are executed by the engine's own `mkt_store.Store.transition` (loaded from `scripts/marketing`), so they
   are the same as `mkt.py`: proposed -> approved | rejected; draft -> rejected; a draft is approved by passing through
   `proposed` (the owner is looking at it, which is what "propose" means). Nothing is published here; `publish-due`
   still publishes only approved posts, and the PAUSE file still stops it. Each decision writes an audit row.
7. **سلامت سیستم (Health)** - container list (from the host snapshot written by `roxira-admin-snapshot.timer`,
   no inspect so no env vars are fetched), disk, last deploy (`autodeploy-last.json`), and key timers from a host snapshot.

## What is mounted into the app container, and why

All paths are mounted at the same path inside and outside the container (so a path stored by `taskq.py` is valid for
the host worker). The Docker socket is NOT mounted. In `docker-compose.prod.yml`, service `enterprise_app`:

| Mount | Mode | Why |
|---|---|---|
| `./scripts/marketing` -> `/app/scripts/marketing` | ro | import `mkt_store.py` so approve/reject use the engine's own state machine |
| `./scripts/infra/server_agents` -> `/app/scripts/infra/server_agents` | ro | run `taskq.py add` (fixed argv) |
| `./config/key_pool.yaml` -> `/app/config/key_pool.yaml` | ro | tier -> group fallback chains (env var names only, no keys) |
| `/var/log/roxira-keypool` | ro | `requests.jsonl` cost/latency log (no prompts in it) |
| `/var/lib/roxira-eval/bakeoff` | ro | newest bake-off report |
| `/root/deploy-state` | ro | `autodeploy-last.json`, `autodeploy-failed-shas` |
| `/var/lib/roxira-admin` | ro | `host_status.json` written by the host snapshot timer (timers, disk, load) |
| `/var/lib/roxira-agents` | **rw** | `taskq.db` (sqlite needs its directory writable for the journal) and `admin-tasks/` for task files |
| `/var/lib/roxira-marketing` | **rw** | `marketing.db` (approve/reject; same sqlite journal reason) |

The app has no Docker API access: the container list comes from the host snapshot timer (`docker ps` on the host).
Risk to know: the proxy allows `GET /containers/*`, so anything on that network can also call container *inspect*
(which includes env vars). The NestJS backend already had this; the app container now has it too. The console never calls inspect.
The two rw mounts are the only writes outside Postgres. If you prefer zero host writes, replace the task/marketing
writes by a root-owned drop-box consumed by a host timer; the API shape would not change.

New env vars (all optional; defaults in code): `SMARTJUDGE_ADMIN_PHONES` (required for access), `ADMIN_TENANT`
(audit tenant column, default `smartjudge`), `ADMIN_USD_TOMAN_RATE`, `RESEARCH_TOKEN` (only if roxira_research has one),
`UMAMI_API_URL` (use `http://roxira_umami:3000`, NOT the `127.0.0.1:3005` of kpi.env, the container cannot reach host
loopback), `UMAMI_API_TOKEN` or `UMAMI_ADMIN_PASSWORD`, `UMAMI_WEBSITE_ROXIRA`, `UMAMI_WEBSITE_GHAZI`.
Path overrides for tests: `ADMIN_COST_LOG`, `ADMIN_AGENTS_HOME`, `ADMIN_TASKQ_SCRIPT`, `ADMIN_MKT_HOME`,
`ADMIN_MKT_SCRIPT_DIR`, `ADMIN_BAKEOFF_DIR`, `ADMIN_DEPLOY_STATE_DIR`, `ADMIN_HOST_STATUS`, `ADMIN_KEYPOOL_CONFIG`,
`ADMIN_DOCKER_PROXY`, `ADMIN_RESEARCH_URL`.

## Database

`admin_audit` is created idempotently on first use (same convention as `payment_orders.py`; no migration tool exists
for this layer): `id, tenant, actor, action, target, reason, detail jsonb, ts`, indexes on `ts` and `target`. The
`tenant` column is set from the server (`ADMIN_TENANT`) and every audit read filters on it; a client value is never used.
`actor` is the masked admin phone (`0912***0009`). `user_entitlements` is NOT altered (no tenant column added to a live
billing table from an endpoint); it is created with the same DDL as the payment flow if missing.

## Server steps (owner or hub, needs approval - not done by this change)

1. Put `SMARTJUDGE_ADMIN_PHONES=<owner phone>` (and optional UMAMI_*) in `/opt/roxira_platform/.env`.
2. `sudo bash scripts/ops/admin/install.sh --yes` (creates `/var/lib/roxira-admin`, installs the snapshot timer).
   Make sure the other mount sources exist (`/var/lib/roxira-agents`, `/var/lib/roxira-marketing`,
   `/var/lib/roxira-eval/bakeoff`, `/var/log/roxira-keypool`, `/root/deploy-state`), otherwise Docker creates empty root dirs.
3. Recreate the app container (compose changed), deploy the frontend. Open `https://roxira.ir/admin`.

## Tests

- `output_apps/generated_modules/smartjudge/tests/test_admin_api.py` - authz (401 / 403 / 429 on every route), strict
  validation, entitlement grant + audit, crypto match, reverify, research jobs, site-check refusals, real `taskq.py`
  in a temp dir, real `mkt_store` in a temp dir, cost-log reader.
- `tests/test_admin_store_pg.py` - the Postgres repository; skipped unless `TEST_PG_DSN` points at a THROWAWAY database.
- `scripts/ops/admin/tests/test_host_snapshot.py`.
