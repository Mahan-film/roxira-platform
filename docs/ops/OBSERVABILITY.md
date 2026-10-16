# Per-project observability (factory milestone F7)

Status: built, not deployed. Nothing here is applied on the server until the steps in
"Rollout" are run with owner approval. Source plan: `docs/strategy/MASTER_PLAN_2026-10-16.md` §4 (F7) and §9.

## What it is

| Part | Where | Notes |
| --- | --- | --- |
| Umami (self-hosted web analytics) | `services/analytics/` | `docker-compose.analytics.yml`, `install.sh` (dry-run default), `nginx/umami-location.conf` (documented, not applied) |
| Tracker in the web app | `output_apps/enterprise_hub/frontend/src/lib/analytics/umami.ts`, `src/app/layout.tsx` | Script tag only when a website id is set for the host; `track(event, data?)` helper |
| Funnel events | chat, login/OTP, checkout, payment callback (see table below) | |
| Weekly KPI report | `scripts/ops/kpi/weekly_report.py` | Persian text, sent through `scripts/ops/notify/notify.py` |
| Timer | `scripts/ops/kpi/roxira-kpi-weekly.{service,timer}`, `scripts/ops/kpi/install.sh` | Friday 06:00 UTC, dry-run default |
| Tests | `scripts/ops/kpi/tests/test_weekly_report.py` | No network: fake Umami, fixture files |

## Port decision: 3005

Umami binds `127.0.0.1:3005`. The reserved list in AGENTS.md section 7 does not include 3005, and no file in
`docs/` mentions it. Before the first start, check on the server (AGENTS.md section 7 requires this):

```bash
ss -tulnp | grep 3005    # must print nothing
```

`install.sh` runs the same check and refuses to start when the port is busy.

## Rollout

Run on `srv1` (`ssh roxira-prod`), repo at `/opt/roxira_platform`, as root. Each step is reversible.

### 1. One-time database and role (on `roxira_postgres_prod`)

The Umami database is separate from `enterprise_db`. The password is read with `read -s` and never written to the repo.

```bash
read -rs -p "umami DB password (letters and digits, 16+): " UMAMI_DB_PASSWORD; echo
docker exec -i roxira_postgres_prod psql -U enterprise_admin -d postgres -v ON_ERROR_STOP=1 -v pw="$UMAMI_DB_PASSWORD" <<'SQL'
CREATE USER umami WITH LOGIN PASSWORD :'pw';
CREATE DATABASE umami OWNER umami;
SQL
```

Note: `-v pw=` puts the password on the `docker exec` command line for a moment. Run it from a shell with no
shared history, or change the password afterwards.

Rollback: `DROP DATABASE umami; DROP USER umami;` (only if Umami has never been started and holds no data).

### 2. Secrets on the server `.env` (names only in the repo)

```bash
printf 'UMAMI_DB_PASSWORD=%s\nUMAMI_APP_SECRET=%s\n' "$UMAMI_DB_PASSWORD" "$(openssl rand -hex 32)" >> /opt/roxira_platform/.env
unset UMAMI_DB_PASSWORD
```

### 3. Install Umami

```bash
bash services/analytics/install.sh          # dry-run: lists every blocker, changes nothing
bash services/analytics/install.sh --apply  # writes generated/umami.env (600), pulls the image, starts it
curl -fs http://127.0.0.1:3005/api/heartbeat && echo ok
```

The image is pinned in `docker-compose.analytics.yml` (`ghcr.io/umami-software/umami:v3.4.0`, the latest GitHub
release on 2026-10-16). Bump it deliberately. The first start creates the tables and an admin user with the
Umami default password. **Log in and change it at once**, then create an API key under Settings.

### 4. nginx (owner approval)

Paste `services/analytics/nginx/umami-location.conf` into the public `server {}` block of **both**
`roxira.ir` and `ghazihoushmand.ir`, then:

```bash
nginx -t && systemctl reload nginx
curl -fsI https://roxira.ir/umami/script.js | head -1
```

The tracker posts to `/umami/api/send` on the page's own host, so both hosts need the location.

### 5. Website ids and the frontend build

Create two websites in Umami (one for `roxira.ir`, one for `ghazihoushmand.ir`). Their ids are public.

Frontend env (build time, inlined into the bundle; the Dockerfile already declares the args):

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | roxira.ir website id. Unset = no tracker on that host. |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID_GHAZI` | ghazihoushmand.ir website id. Unset = no tracker on that host. |
| `NEXT_PUBLIC_UMAMI_SRC` | optional, default `/umami/script.js` |
| `NEXT_PUBLIC_UMAMI_HOST_URL` | optional, default `/umami` |

**Hub step, not done in this change:** `docker-compose.prod.yml`, service `roxira_enterprise_frontend`, under
`build.args`, add:

```yaml
        NEXT_PUBLIC_UMAMI_WEBSITE_ID: ${NEXT_PUBLIC_UMAMI_WEBSITE_ID:-}
        NEXT_PUBLIC_UMAMI_WEBSITE_ID_GHAZI: ${NEXT_PUBLIC_UMAMI_WEBSITE_ID_GHAZI:-}
```

Until that is merged and the frontend is rebuilt, no tracker script is rendered (the feature is inert, not broken).

### 6. KPI report

```bash
cp scripts/ops/kpi/kpi.env.example /etc/roxira/kpi.env && chmod 600 /etc/roxira/kpi.env
# edit /etc/roxira/kpi.env: UMAMI_API_TOKEN (the API key from step 3) and the two UMAMI_WEBSITE_* ids
python3 /opt/roxira_platform/scripts/ops/kpi/weekly_report.py --dry-run   # prints the report, sends nothing
bash scripts/ops/kpi/install.sh                                          # dry-run of the timer install
sudo bash scripts/ops/kpi/install.sh --yes                               # enable Friday 06:00 UTC
```

Manual send to the bot: `systemctl start roxira-kpi-weekly.service`.

## Tracked events

Defined in `src/lib/analytics/umami.ts` (`ANALYTICS_EVENTS`). Names must match `FUNNEL_EVENTS` in `weekly_report.py`.

| Event | Fired in | Data |
| --- | --- | --- |
| `chat_started` | `components/chat/chat-shell.tsx`, first send in a page load | none |
| `answer_shown` | `components/chat/chat-shell.tsx`, final assistant reply rendered | none |
| `signup_completed` | `components/auth/login-modal.tsx`, OTP verified | none |
| `checkout_started` | `components/judge/subscription/subscription-modal.tsx`, `PaymentCheckoutModal.tsx` | `plan` |
| `payment_success` | `app/judge/payment/callback/page.tsx`, verify returned PAID | none |

No phone numbers, message text or case content are sent. Umami is configured as a cookieless, self-hosted
service, so no consent banner is added by this change. Confirm with the privacy page before go-live.

## What the weekly report contains

Window: the last 7 days, UTC, ending at the run time. Each section fails soft and says why it is missing.

| Section | Source | Read |
| --- | --- | --- |
| Umami | Umami API (`UMAMI_API_URL`, token in env) | visitors, page views, top 3 pages, funnel counts and rates, per host |
| LLM cost | `requests.jsonl` via `scripts/infra/key_pool/cost_report.py` | calls, success %, cost, cost per successful call, per group and per day |
| Agent queue | `taskq.db` (`TASKQ_DB`, opened `mode=ro`) | done, failed, attempts, average attempts per task, queued and running now |
| Deploys | `/root/deploy-state/*.json*` (`AUTODEPLOY_STATE_DIR`) | records in the window, ok and failed, last result |

The report never prints tokens or prompts. It goes through `notify.send()`, which scrubs phone numbers, e-mails,
IPs and long tokens, and is a silent no-op when the bot is not configured.

## Known gaps (flagged, not fixed here)

- **Signup vs login.** The OTP endpoint does not say whether the account is new. `signup_completed` therefore
  counts every successful OTP login. Fix: the backend returns an `is_new_user` flag; then gate the event on it.
- **Cost log has no project tag.** The F7 plan asks for cost per project. `cost_logger.py` does not write one yet.
  The report is per model group and per day only.
- **Deploy history.** `autodeploy.sh` keeps only the last run in `autodeploy-last.json`. The deploy section
  therefore reads at most one record today. Full history would need the logs in `/var/log/roxira-autodeploy`.
- **Umami API shape is unverified against v3.4.0.** The report uses `/api/websites/{id}/stats` and
  `/api/websites/{id}/metrics` (`type=url|event`) with `startAt`/`endAt` in ms, which is the v2 shape. The
  token is sent both as `Authorization: Bearer` and as `x-umami-api-key`. Verify with one real call before
  trusting the numbers:
  `curl -s -H "x-umami-api-key: $UMAMI_API_TOKEN" "http://127.0.0.1:3005/umami/api/websites/<id>/stats?startAt=<ms>&endAt=<ms>"`.
- **Uptime and error alerts** from the F7 plan are not part of this change.
- **Scale/kill gate at 30/60/90 days** is an owner decision and is not automated.
- **CI.** `scripts/ops/kpi/tests/test_weekly_report.py` is not in the CI workflow. The hub decides whether to add it.

## Hub verification checklist

1. `ss -tulnp | grep 3005` prints nothing on srv1.
2. `services/analytics/install.sh` (dry-run) reports zero blockers before `--apply`.
3. Umami admin password changed; API key created; the one-call check above returns JSON.
4. nginx location applied to both hosts; `https://roxira.ir/umami/script.js` returns 200.
5. Frontend rebuilt with the two build args; the page source of one host contains `data-website-id` only for that host.
6. A real chat turn, a checkout click and a test payment each show up as an event in Umami.
7. `weekly_report.py --dry-run` on srv1 prints all four sections (missing ones say why).
8. Timer listed by `systemctl list-timers roxira-kpi-weekly.timer`.

## Rollback

- Frontend: unset the two build args and rebuild. The tracker is not rendered.
- Umami: `docker compose -f services/analytics/docker-compose.analytics.yml -p roxira-analytics down`.
  Data stays in the `umami` database.
- KPI timer: `sudo bash scripts/ops/kpi/install.sh --disable`.
- nginx: remove the `/umami/` location, `nginx -t`, reload.
