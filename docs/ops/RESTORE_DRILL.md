# Backup restore drill runbook

Restore the latest off-site backups into **throwaway containers on the owner's
Mac** to prove they are complete and restorable. This is a rehearsal: it never
touches production (`5.75.200.67`) and never writes to a production database or
volume. Docs-only companion to `docs/ops/RESILIENCE.md` §3 (the same commands,
expanded into a repeatable drill).

## خلاصهٔ فارسی

- این رانبوک برای **تمرین بازیابی** است، نه بازیابی واقعی. هرگز روی سرور
  تولید (`5.75.200.67`) اجرا نمی‌شود.
- بکاپ‌های آفلاین روی مک مالک در `~/RoxiraBackups/<تاریخ>/` هستند و هر روز با
  `scripts/ops/pull_backups_to_mac.sh` (لانچ‌دی) کشیده می‌شوند. آن اسکریپت فقط
  می‌خواند و روی سرور چیزی نمی‌نویسد.
- Postgres و Qdrant را در دو کانتینر دورانداختنی (`--rm`، پورت لوکال غیرپیش‌فرض)
  بالا بیاورید، دیتای بکاپ را داخلشان بریزید و بعد پاکشان کنید.
- تأیید: تعداد سطرهای `payment_orders` و `users` باید بزرگ‌تر از صفر و نزدیک به
  تمرین قبلی باشد؛ یک جست‌وجوی حقوقی برداری روی کالکشن `iran_laws_bge_m3` باید
  نتیجه بدهد.
- زمان تقریبی: بار اول ~۱۰ تا ۱۵ دقیقه (شامل دانلود ایمیج‌ها)، بعد از آن ~۵ دقیقه.
- چک‌لیست ماهانه در انتهای همین سند است.

---

## 1. Safety rules (read first)

- **Never run any of this on the server or against prod.** No `docker exec`
  into `roxira_postgres_prod` / `roxira_qdrant_prod`, no writing to a
  production volume. The drill lives entirely on the Mac.
- Throwaway only: containers are started with `--rm`, unique names
  (`roxira_restore_*`), and **localhost-only ports that are not the prod
  defaults** (`5432`/`6333` are avoided).
- No secrets. The throwaway Postgres uses `POSTGRES_HOST_AUTH_METHOD=trust`
  (local, disposable), so no password is ever typed or stored. Never copy the
  production `.env` or `POSTGRES_PASSWORD` into the drill.
- Use the **same image tags as production** so extensions and the storage
  format match. Prod uses `postgres:17-alpine` and `qdrant/qdrant:latest`
  (`docker-compose.prod.yml`). If prod's `qdrant` digest has moved since the
  backup was taken, a newer Qdrant may refuse/migrate the storage — record the
  digest at backup time (read-only `docker inspect`) and use that.
- The only server access anywhere near this drill is the existing read-only
  daily pull (`scripts/ops/pull_backups_to_mac.sh`). Do not add new server
  commands.

## 2. Prerequisites

- Docker Desktop running on the Mac (`docker version` succeeds).
- At least one completed pull, i.e. a date folder under `~/RoxiraBackups/`.
  The pull copies:
  - `postgres_<YYYYmmdd_HHMMSS>.sql.gz` — hourly `pg_dump`, from
    `scripts/auto_backup_daemon.sh`.
  - `qdrant_<YYYYmmdd_HHMMSS>.tar.gz` — hourly raw tar of the Qdrant
    container's `/qdrant/storage`.
  - `twenty_<YYYY-MM-DD>.sql.gz` — Twenty CRM (not part of this drill).
- Optional: `qdrant_<...>.snapshot` — only exists if the **not-yet-installed**
  nightly timer (`scripts/ops/backup.sh`, see `deploy/systemd/`) has been
  enabled. The current pull script does **not** copy `.snapshot` files, so the
  default drill uses the `.tar.gz` above.

## 3. Step 1 — pick the latest backup set

```bash
LATEST="$(ls -1dt "$HOME"/RoxiraBackups/20??-??-?? | head -1)"
echo "drill set: $LATEST"
ls -lh "$LATEST"

PG_DUMP="$(ls -1t "$LATEST"/postgres_*.sql.gz | head -1)"
QD_TAR="$(ls -1t "$LATEST"/qdrant_*.tar.gz | head -1)"
echo "PG_DUMP=$PG_DUMP"
echo "QD_TAR=$QD_TAR"

gzip -t "$PG_DUMP" && echo "pg dump gzip OK"
gzip -t "$QD_TAR"  && echo "qdrant tar gzip OK"
```

If a file is missing or fails `gzip -t`, stop — that is a failed drill and a
finding worth reporting.

## 4. Step 2 — restore Postgres into a throwaway container

```bash
docker rm -f roxira_restore_pg 2>/dev/null || true

docker run -d --rm \
  --name roxira_restore_pg \
  -e POSTGRES_USER=enterprise_admin \
  -e POSTGRES_DB=enterprise_db \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -p 127.0.0.1:55432:5432 \
  postgres:17-alpine

until docker exec roxira_restore_pg \
  pg_isready -U enterprise_admin -d enterprise_db >/dev/null 2>&1; do
  sleep 1
done
echo "postgres ready"

gunzip -c "$PG_DUMP" \
  | docker exec -i roxira_restore_pg \
      psql -v ON_ERROR_STOP=1 -U enterprise_admin -d enterprise_db
```

Notes:

- The dump was produced with `pg_dump --clean --if-exists --no-owner`, so the
  `DROP ... IF EXISTS` statements are harmless no-ops on the fresh container and
  no role/ownership setup is required.
- `-v ON_ERROR_STOP=1` makes any SQL error fail the pipe — a non-zero exit here
  means the backup did not restore cleanly. Investigate before continuing.
- A clean restore prints a long stream of `CREATE TABLE` / `COPY` / `ALTER`
  lines and finishes without an error.

## 5. Step 3 — restore Qdrant into a throwaway container

### 5a. From the hourly `.tar.gz` (default)

The archive is the contents of `/qdrant/storage` at its root, so extract it to a
host directory and mount that as Qdrant's storage:

```bash
QD_DIR="$HOME/RoxiraRestore/qdrant"
rm -rf "$QD_DIR" && mkdir -p "$QD_DIR"
tar xzf "$QD_TAR" -C "$QD_DIR"
ls "$QD_DIR"          # expect: collections/  (and possibly snapshots/, aliases/)

docker rm -f roxira_restore_qdrant 2>/dev/null || true

docker run -d --rm \
  --name roxira_restore_qdrant \
  -p 127.0.0.1:16333:6333 \
  -v "$QD_DIR":/qdrant/storage \
  qdrant/qdrant:latest
```

Wait for the HTTP API (Qdrant rebuilds/loads HNSW indexes on boot, so this can
take a minute or two):

```bash
until curl -sf "http://127.0.0.1:16333/collections" >/dev/null; do sleep 2; done
echo "qdrant ready"
```

### 5b. From a `.snapshot` (only if the nightly timer is installed)

`scripts/ops/backup.sh` uses Qdrant's full-storage snapshot API (`POST
/snapshots`), which is a **different format** from the hourly `.tar.gz`. It is
not pulled to the Mac today. If you have one, start a fresh Qdrant container,
copy the file into its `/qdrant/snapshots/` directory, and follow Qdrant's
full-snapshot recovery procedure, then verify with the same checks in Step 4.
Do not confuse it with the collection-level
`PUT /collections/{name}/snapshots/recover` endpoint (that is for per-collection
snapshots, not the full-storage archive `backup.sh` produces).

## 6. Step 4 — verify

### 6a. Postgres row counts

```bash
docker exec roxira_restore_pg psql -U enterprise_admin -d enterprise_db -tAc \
  "SELECT 'payment_orders', count(*) FROM payment_orders
   UNION ALL
   SELECT 'users', count(*) FROM users;"
```

Expected: both counts **> 0**. Compare `users` against the previous drill's
number (logged below); a large unexpected drop means the dump is stale or
truncated. `payment_orders` may legitimately be small (no real test payment has
been made yet, per `docs/STATE.md`), so 0 there is a valid result — but the
`SELECT` must succeed, proving the table restored.

Also confirm the schema is present, not just the row count:

```bash
docker exec roxira_restore_pg psql -U enterprise_admin -d enterprise_db -c \
  "\d payment_orders" -c "\d users"
```

### 6b. One legal search (Qdrant)

Check the collection loaded and how many points it has:

```bash
curl -sf "http://127.0.0.1:16333/collections/iran_laws_bge_m3" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; print("status", r["status"], "| points", r["points_count"], "| vectors", r["config"]["params"]["vectors"])'
```

Then run one real nearest-neighbour search. Pull an existing vector from the
restored collection and use it as the query (no embedding model needed):

```bash
VID="$(curl -sf -X POST \
  "http://127.0.0.1:16333/collections/iran_laws_bge_m3/points/scroll" \
  -H 'Content-Type: application/json' \
  -d '{"limit":1,"with_vector":true,"with_payload":false}' \
  | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["result"]["points"][0]["vector"]))')"

curl -sf -X POST \
  "http://127.0.0.1:16333/collections/iran_laws_bge_m3/points/search" \
  -H 'Content-Type: application/json' \
  -d "{\"vector\":${VID},\"limit\":3,\"with_payload\":true}" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; print(len(r),"hits"); [print(round(h["score"],4), (h.get("payload") or {}).get("article") or (h.get("payload") or {}).get("title") or h["id"]) for h in r]'
```

Expected: `status green`, a plausible `points` count, and 3 hits with scores near
1.0 for the first hit. For reference, the W6 audit found `points_count: 1308`
(vector size 1024, cosine, unnamed vector — `docs/W6_legal_corpus_diagnosis.md`);
a wildly different number means the wrong snapshot or a corrupt restore.

Optional end-to-end: if you also run the app against the throwaway Qdrant, the
legal search is `POST /api/v1/apps/judge/query` with body
`{"query":"..."}` (`smartjudge_module.py`, the `/query` route). That is heavier
(it needs the app image and models) and is not required for the drill.

### 6c. Record the result

Append one line to the drill log so next month has a baseline to compare with:

```bash
mkdir -p "$HOME/RoxiraBackups"
printf '%s set=%s users=%s payment_orders=%s qdrant_points=%s\n' \
  "$(date +%Y-%m-%d)" "$(basename "$LATEST")" \
  "$(docker exec roxira_restore_pg psql -U enterprise_admin -d enterprise_db -tAc 'SELECT count(*) FROM users')" \
  "$(docker exec roxira_restore_pg psql -U enterprise_admin -d enterprise_db -tAc 'SELECT count(*) FROM payment_orders')" \
  "$(curl -sf http://127.0.0.1:16333/collections/iran_laws_bge_m3 | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["points_count"])')" \
  >> "$HOME/RoxiraBackups/drill.log"
tail -1 "$HOME/RoxiraBackups/drill.log"
```

## 7. Step 5 — clean up

```bash
docker rm -f roxira_restore_pg roxira_restore_qdrant
rm -rf "$HOME/RoxiraRestore/qdrant"
```

Both containers were started with `--rm`; `docker rm -f` stops them and the
`--rm` removes them. Nothing in `~/RoxiraBackups/` is modified.

## 8. Expected duration

| Phase | First run | Subsequent runs |
| --- | --- | --- |
| Image pulls (`postgres:17-alpine`, `qdrant/qdrant`) | 2–5 min | ~0 |
| Postgres container + restore | < 1 min | < 1 min |
| Qdrant extract + boot + HNSW load | 2–4 min | 1–2 min |
| Verification + logging | 2 min | 2 min |
| **Total** | **~10–15 min** | **~5 min** |

These are estimates: the hourly Qdrant archive is ~39 MB, and the whole
`/opt/roxira_backups` was ~2.1 GB at the 2026-09-28 audit
(`docs/ops/RESILIENCE.md`). The Postgres dump is much smaller than the Qdrant
archives.

## 9. Monthly checklist

Run this once a month (and after any change to the backup scripts, the Postgres
major version, or the Qdrant image). Tick each item and paste the log line.

- [ ] Confirm Docker Desktop is running and the latest `~/RoxiraBackups/<date>/`
      folder exists (daily launchd pull succeeded).
- [ ] `gzip -t` passes on both the Postgres dump and the Qdrant archive.
- [ ] Postgres restores with `ON_ERROR_STOP=1` and exits 0.
- [ ] `payment_orders` and `users` row counts both query successfully; `users`
      is > 0 and within a reasonable range of the previous drill's number.
- [ ] `iran_laws_bge_m3` reports `status green` and a plausible `points_count`.
- [ ] The one nearest-neighbour legal search returns 3 hits (first score near
      1.0).
- [ ] A log line was appended to `~/RoxiraBackups/drill.log`.
- [ ] Throwaway containers and `~/RoxiraRestore/qdrant` were removed.
- [ ] Any anomaly (failed `gzip -t`, SQL error, missing file, big count drop)
      was written up as a finding — and, if it is a real gap, an issue filed.

## 10. Related files

- `docs/ops/RESILIENCE.md` — audit of restart/healthcheck/backup behavior and
  the short Persian runbook (§3) this drill expands.
- `scripts/auto_backup_daemon.sh` — hourly Postgres `pg_dump` + Qdrant storage
  tar (the `.tar.gz` this drill restores).
- `scripts/ops/backup.sh` — nightly, snapshot-API alternative (`.snapshot`;
  not installed yet).
- `scripts/ops/pull_backups_to_mac.sh` — read-only daily pull to
  `~/RoxiraBackups/` (the off-site copy).
- `output_apps/ecosystem_core/src/billing/payment_orders.py` — `payment_orders`
  schema (`ensure_schema`).
- `output_apps/ecosystem_core/src/factory/user_auth_models.py` — `users`
  schema (`class User`, `__tablename__ = "users"`).
- `output_apps/generated_modules/smartjudge/smartjudge_module.py` — `/query`
  legal search and `CITATION_QDRANT_COLLECTION = "iran_laws_bge_m3"`.