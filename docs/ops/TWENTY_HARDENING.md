# Twenty CRM hardening (docker-compose.modern-stack.yml)

Owner runbook for issue #397. The Twenty stack is **not** part of
`docker-compose.prod.yml`; the owner applies `docker-compose.modern-stack.yml`
on the server. This change edits that file: it pins every image, moves every
secret out to the server `.env`, turns off the prefilled sign-in page, and adds
per-service resource and privilege limits. This runbook is the companion doc.

## Pinned images

| Service | Before | After |
| --- | --- | --- |
| `twenty_crm` | `twentycrm/twenty:latest` | `twentycrm/twenty:v2.41.0` |
| `twenty_db` | `postgres:16-alpine` | `postgres:16.9-alpine` |
| `twenty_redis` | `redis:7-alpine` | `redis:7.4.11-alpine` |

`v2.41.0` is the release the running `:latest` already resolved to (audit
2026-10-02), so this pin is a no-op at deploy time; `redis:7.4.11-alpine` matches
the `7.4.11` the audit verified as **not** vulnerable to RediShell
(CVE-2025-49844). Postgres stays on the 16 major.

No registry API was reachable from the worktree that prepared this change, so the
pins were fixed to the versions already running on prod rather than blindly to
"current". Confirm each tag exists before applying:

```bash
for ref in twentycrm/twenty:v2.41.0 postgres:16.9-alpine redis:7.4.11-alpine; do
  docker manifest inspect "$ref" >/dev/null && echo "ok $ref"
done
```

If a tag is missing, pick the closest existing `v2.41.x` / `16.x` / `7.4.x` tag
and record the substitution in the issue.

## Required server `.env` keys

The compose file now **fails closed** (`${VAR:?…}`) if any of these are missing.
The names already exist in the server `.env`; only their values live there:

| Variable | Used by |
| --- | --- |
| `TWENTY_DB_PASSWORD` | `twenty_db` (`POSTGRES_PASSWORD`) and `twenty_crm` (`PG_DATABASE_URL`) |
| `TWENTY_APP_SECRET` | `twenty_crm` (`APP_SECRET`) |
| `TWENTY_ENCRYPTION_KEY` | `twenty_crm` (`ENCRYPTION_KEY`) |

Never commit a value; never print `.env`. The sign-in page is now
`SIGN_IN_PREFILLED=false` so no credentials are rendered in the browser.

## Owner steps

Run from the server checkout that holds the compose file.

1. **Confirm the env keys exist** (names only, no values printed):

   ```bash
   grep -cE '^(TWENTY_DB_PASSWORD|TWENTY_APP_SECRET|TWENTY_ENCRYPTION_KEY)=' .env
   # must print 3
   ```

2. **Back up the Twenty database** before touching the stack (logical dump plus
   an offline copy of the volume directory):

   ```bash
   mkdir -p /opt/roxira_backups
   docker exec roxira_twenty_db \
     pg_dump -U twenty -d default | gzip \
     > /opt/roxira_backups/twenty_$(date +%F_%H%M%S).sql.gz
   ls -lh /opt/roxira_backups/twenty_*.sql.gz | tail -1
   ```

   Keep the hourly/off-site backups working as before (`docs/ops/RESTORE_DRILL.md`).

3. **Validate without starting anything** (this is where a missing env key
   fails):

   ```bash
   docker compose -f docker-compose.modern-stack.yml config -q
   # silent + exit 0 = valid
   ```

4. **Apply** the pinned stack:

   ```bash
   docker compose -f docker-compose.modern-stack.yml up -d
   docker compose -f docker-compose.modern-stack.yml ps
   ```

5. **Verify** the app and the limits:

   ```bash
   curl -fsS http://127.0.0.1:3002/healthz && echo OK
   docker inspect -f '{{.Name}} no-new-privileges={{.HostConfig.SecurityOpt}} mem={{.HostConfig.Memory}} pids={{.HostConfig.PidsLimit}}' \
     roxira_twenty_crm roxira_twenty_db roxira_twenty_redis
   ```

   Ports stay on `127.0.0.1:3002` only; the public path remains the nginx
   `/crm-service` proxy (`SERVER_URL=https://roxira.ir/crm-service`).

## Rollback

Because the image is already v2.41.0 on prod, this change does not trigger a
schema migration — rollback is just restoring the previous compose file and
re-applying it.

1. Restore the previous file from the commit just before this merge and
   re-apply (use the real SHA; `git checkout --` would restore the *new*
   committed file, not the old one):

   ```bash
   git show <PREV_SHA>:docker-compose.modern-stack.yml > docker-compose.modern-stack.yml
   docker compose -f docker-compose.modern-stack.yml up -d
   ```

2. If Twenty did start a migration (version drift between `:latest` and
   `v2.41.0`), stop the app first, restore the dump, then bring the stack up:

   ```bash
   docker compose -f docker-compose.modern-stack.yml stop twenty_crm
   gunzip -c /opt/roxira_backups/twenty_<timestamp>.sql.gz \
     | docker exec -i roxira_twenty_db psql -U twenty -d default
   docker compose -f docker-compose.modern-stack.yml up -d
   ```

3. Re-check `curl -fsS http://127.0.0.1:3002/healthz` and record the outcome.

## One-day Persian / RTL / Jalali spike checklist

Timeboxed to one day on the pinned `v2.41.0` build, before any CRM rollout. Goal:
decide whether Twenty is usable as-is for Persian (fa) users or needs a fork /
custom code. Record **every** row — a "no" is as useful as a "yes".

### What to test

- **Locale**
  - Switch the workspace/user language to Persian (fa); reload.
  - Check settings labels, menus, buttons, empty states.
- **RTL layout**
  - Whole-app direction (`dir="rtl"`): sidebar, top bar, record page.
  - Kanban/pipeline drag order, table column alignment, form field alignment.
  - Long Persian strings: truncation/ellipsis and no horizontal clipping.
- **Jalali calendar**
  - Date and date-time fields: which calendar does the picker show?
  - Display vs. stored value for `createdAt`/`updatedAt` and date filters.
  - Can a Jalali value be kept in a text field / formula column as a workaround
    without corrupting the built-in Gregorian date fields?
- **Persian text and numbers**
  - Create/filter/sort records with Persian names; check ZWNJ (‌) and
    Persian vs. Latin digits.
  - Search across Persian fields, including partial words.
- **Export / interoperability**
  - CSV export of Persian records: UTF-8 preserved, opens correctly (watch the
    Excel BOM issue).
  - REST API round-trip of a Persian field (create → read → export).

### How to record results

One row per check, posted as a comment on issue #397 (or a linked follow-up)
and attached as the spike note. Include the exact image tag.

| Date | Build | Area | Steps | Expected | Observed | Pass/Fail | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | `twentycrm/twenty:v2.41.0` | e.g. Jalali date field | | | | | screenshot path / link | |

Finish with a one-paragraph verdict: adopt, adopt-with-workaround, or fork. If
fork, note the minimum change (locale bundle, calendar, or RTL) and open a
separate issue.
