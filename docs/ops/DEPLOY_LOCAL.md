# Local deploy (`scripts/ops/deploy_local.sh`)

GitHub Actions is off, so the owner deploys from the Mac. The script uses only
your existing ssh config (`DEPLOY_SSH_HOST`, default `5.75.200.67`) and never
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
- If the diff contains migration files, deploy stops. Review and apply migrations by hand via a reviewed PR process, then deploy.

## اگر چیزی خراب شد

- Smoke failure: automatic rollback runs, then smoke is re-run. If that also fails the script says "manual attention"; ssh in and inspect `docker compose -f docker-compose.prod.yml ps` and `docker logs <container>`.
- Server tree not clean (for example `.env.bak.*`): move those files to `/root/env-backups/`, retry.
- Missing env name: add it to the server `.env`, retry.
- Later regret: `scripts/ops/deploy_local.sh rollback --yes` (uses the last recorded previous commit).
- A rollback does not undo database migrations or data changes.
- Smoke settings can be overridden: `DEPLOY_DOMAINS`, `DEPLOY_CHAT_DOMAIN`, `DEPLOY_SMOKE_API_PATH`.

## Setting server env variables safely / گذاشتن متغیر روی سرور

`scripts/ops/set_server_env.sh NAME [--from-local | --generate] [--replace]` writes one variable into
the production `.env` without printing its value: the value travels over ssh stdin only, a timestamped
backup `.env.bak-<time>` is made first, the file keeps its permissions, only the NAME and the value LENGTH
are printed. `--from-local` copies the value from `~/Secrets/roxira/roxira.env`; `--generate` makes a random
64-hex value and saves it in the local file too (use it for `ADMIN_HEALTH_KEY`). Containers read `.env`
only when they are (re)started, so run it BEFORE `deploy`.

Required before the first deploy of the Oct-2026 changes: `ADMIN_HEALTH_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
