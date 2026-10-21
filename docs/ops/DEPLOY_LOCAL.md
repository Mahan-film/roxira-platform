# Local deploy (`scripts/ops/deploy_local.sh`)

GitHub Actions is off, so the owner deploys from the Mac. The script uses only
your existing ssh config (`DEPLOY_SSH_HOST`, default `$ROXIRA_HOST`, itself defaulting to the `roxira-prod` alias) and never
prints secret values (env checks print variable NAMES only).

## دستورات دقیق به ترتیب

Run from a checkout of the repo on your Mac:

```bash
scripts/ops/deploy_local.sh check          # read-only status + pre-flight
scripts/ops/deploy_local.sh plan           # what deploy would do
scripts/ops/deploy_local.sh deploy         # dry-run (default), changes nothing
scripts/ops/deploy_local.sh deploy --yes   # real deploy; type the short SHA when asked
scripts/ops/deploy_local.sh rollback --yes # manual rollback to the previous deployment
```

`deploy --yes` does: freeze check, migration check, required-env check, clean
tree check, records previous commit and tags current images `:prev` (state in
`/root/deploy-state/` on the server, outside the git tree), `git merge --ff-only`,
`compose config -q`, build and `up -d --no-deps` only the services whose files
changed, nginx reload (recreate if `nginx.conf` changed), then a smoke test.
Any failed smoke check triggers an automatic rollback.

## چک‌لیست پیش از استقرار (pre-flight)

These names must exist in the server `.env` (`check` lists any that are missing):

- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- ADMIN_HEALTH_KEY
- JWT_SECRET
- KAVENEGAR_API_KEY

`check` also reports any other `${VAR}` in `docker-compose.prod.yml` or name in
`.env.example` that the server `.env` lacks. Add them on the server by hand;
the script never writes `.env`.

## توقف‌ها (freeze, migrations)

- `.deploy-freeze` present locally (repo root) or on the server (`/opt/roxira_platform`) blocks deploy and rollback.
- If the diff contains migration files, deploy stops and points to `migrate` (below). Migration files land only via reviewed PRs; `migrate` applies them to the production DB, then you run `deploy`.

## Database migrations (`migrate`, `migrate-rollback`) — owner-run, L4

```bash
scripts/ops/deploy_local.sh migrate                 # dry-run: lists pending migrations + exact steps
scripts/ops/deploy_local.sh migrate --yes           # real run; type the short SHA of origin/main
scripts/ops/deploy_local.sh migrate-rollback /root/deploy-state/db-backups/<timestamp>.dump        # dry-run
scripts/ops/deploy_local.sh migrate-rollback /root/deploy-state/db-backups/<timestamp>.dump --yes  # restore
```

Pending = files in `output_apps/enterprise_hub/migrations/` (at origin/main) whose
`<ClassName><timestamp>` is not in the production `migrations` table. The first pending one is
`1789120000000-AddCrmTenantIsolation.ts` (adds `tenant_id` to `crm_leads` and `contact_messages`).

`migrate --yes` does: freeze check (local + server), refuses if the migrations table is unreadable or
the server tree is dirty, preflight (`roxira_postgres_prod` and `roxira_enterprise_backend` running, the
backend container env has the DB user/credential/name), then exports the target commit's
Dockerfile, package files, `tsconfig.json`, `data-source.ts` and `migrations/` into
`/root/deploy-state/migrate-work` and builds a one-off image `roxira-migrate:<sha>` from the Dockerfile's
`deps` stage (full `npm ci`, so ts-node and the TypeORM CLI exist). The Dockerfile is not edited and the
server checkout is not changed (so `deploy` still sees the full diff). Then `pg_dump -Fc` inside
`roxira_postgres_prod` to `/root/deploy-state/db-backups/<timestamp>.dump` (verified with
`pg_restore --list`), then `docker run --rm --network <network of roxira_postgres_prod>` with the migration
files bind-mounted read-only, running `npm run migration:run`. The image, env file and work dir are removed
afterwards (also on failure). Finally psql checks that `tenant_id` exists and is NOT NULL on both CRM
tables. On any failure it prints the exact restore command and does NOT restore automatically.

Why a one-off container: the backend runner image is built with `npm ci --omit=dev` and copies only
`dist/`, so it has neither ts-node nor `migrations/`. The `builder` stage lacks them too (it copies only
`main.ts`, `app.module.ts`, `modules/`), hence `deps` + bind mounts.

Env: the DB user, credential and name are read on the server from the backend container's environment
(`docker inspect`, filtered by variable name) into a mode-0600 env file that is passed with `--env-file`
and deleted afterwards; values are never printed or sent to the Mac. `DATABASE_HOST` is overridden to
`roxira_postgres_prod` and `DATABASE_PORT` to `5432` (direct, bypassing pgbouncer, which the backend uses
on 6432). Names read: `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` (as set in
`docker-compose.prod.yml`). The command can be overridden with `DEPLOY_MIGRATE_CMD`
(default `npm run migration:run`).

Restore replaces database objects with the dump (data written after the dump is lost); stop the backend
first if you can.

## اگر چیزی خراب شد

- Smoke failure: automatic rollback runs, then smoke is re-run. If that also fails the script says "manual attention"; ssh in and inspect `docker compose -f docker-compose.prod.yml ps` and `docker logs <container>`.
- Server tree not clean (for example `.env.bak.*`): move those files to `/root/env-backups/`, retry.
- Missing env name: add it to the server `.env`, retry.
- Later regret: `scripts/ops/deploy_local.sh rollback --yes` (uses the last recorded previous commit).
- A rollback does not undo database migrations or data changes (use `migrate-rollback <dump>`).
- Smoke settings can be overridden: `DEPLOY_DOMAINS`, `DEPLOY_CHAT_DOMAIN`, `DEPLOY_SMOKE_API_PATH`.

## Setting server env variables safely / گذاشتن متغیر روی سرور

`scripts/ops/set_server_env.sh NAME [--from-local | --generate] [--replace]` writes one variable into
the production `.env` without printing its value: the value travels over ssh stdin only, a timestamped
backup `.env.bak-<time>` is made first, the file keeps its permissions, only the NAME and the value LENGTH
are printed. `--from-local` copies the value from `~/Secrets/roxira/roxira.env`; `--generate` makes a random
64-hex value and saves it in the local file too, but only after the server write is verified (atomic write,
previous local file kept as `roxira.env.bak-<time>`, chmod 600; a refusal without `--replace` or any
failure leaves the local file untouched). Use it for `ADMIN_HEALTH_KEY`. Containers read `.env`
only when they are (re)started, so run it BEFORE `deploy`.

Required before the first deploy of the Oct-2026 changes: `ADMIN_HEALTH_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

## Retrieval accuracy gate (non-blocking)

After a successful smoke test, `deploy` runs `scripts/eval/legal_gate.py retrieval` on the server (a one-off
container beside Qdrant, no LLM, 0 USD) and prints `retrieval@5` for the 70 questions of
`data/eval/chat_golden/legal_gate_2026-10-21.json`. It logs a `WARNING` when retrieval@5 is more than 5 points below
`data/eval/chat_golden/legal_gate_baseline.json`. It never blocks or rolls back a deploy; `DEPLOY_EVAL_GATE=0` skips it.

Capture or refresh the baseline (needs the gate script already deployed to the server):

    scripts/ops/deploy_local.sh eval-baseline          # dry run: prints the comparison
    scripts/ops/deploy_local.sh eval-baseline --yes    # writes the baseline file locally; commit it

Questions are `draft_needs_lawyer` until reviewed (docs/legal/LAWYER_REVIEW_GATE_FA.md).
