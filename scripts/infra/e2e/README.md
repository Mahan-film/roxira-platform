# Gate 3: browser E2E sandbox for the business app (`/app/*`)

Builds an isolated copy of the app from a git ref and runs the Playwright suite in `e2e/app/` against it in
Chromium **and** WebKit (the owner uses Safari). Part of the factory v2 gates
(`docs/strategy/FACTORY_V2_2026-10-22.md` section 3): unit tests and `tsc` do not catch UI/integration bugs
such as a drop overlay that never goes away in Safari.

```
bash scripts/infra/e2e/run_app_e2e.sh <git-ref>      # up -> install browsers -> test -> down; last line:
                                                       #   APP_E2E RESULT: PASS | FAIL   (exit 0 / 1)
bash scripts/infra/e2e/sandbox_up.sh <git-ref> [KEEP]  # only the sandbox (left running on success)
bash scripts/infra/e2e/sandbox_down.sh [PRUNE]         # remove it (PRUNE also removes the rxtest-* images)
bash scripts/infra/e2e/mkuser.sh <label>               # extra tenant + OWNER user + session JSON
```

## What the sandbox is

| Piece | Name | Notes |
| --- | --- | --- |
| network | `rxtest_net` | `--internal`: no internet, no route to prod |
| postgres | `rxtest_pg` | postgres:17-alpine, data on tmpfs, random password |
| redis | `rxtest_redis` | redis:7-alpine |
| backend | `rxtest_be` (`rxtest-be:<sha>`) | built from the ref; random `JWT_SECRET`; NestJS on :3000 (internal only) |
| frontend | `rxtest_fe` (`rxtest-fe:<sha>`) | built from the ref with `NEST_API_ORIGIN=http://rxtest_be:3000`; Next on :3001 (internal only) |
| proxy | `rxtest_proxy` | socat, publishes **only `127.0.0.1:${RX_E2E_PORT:-3901}`** (an internal network cannot publish ports) |

* Data: the **schema only** of the production `enterprise_db` plus the migrations ledger, then the ref's new
  migrations. No production rows ever enter the sandbox. Test data is the repo fixture
  `output_apps/enterprise_hub/modules/data_import/__fixtures__/erp_multicurrency_small.sqlite`.
* Tenants: `seeded` (fixture imported through the import API, used by accounting / hr / invoices / palette specs)
  and `import-chromium` / `import-webkit` (empty, used by the specs that import through the UI, so the two
  browsers never collide on duplicate detection).
* Secrets: DB password and JWT secret are generated at runtime (`openssl rand`), live only in the container
  environments, and are never written to disk or printed. Session JSON files (3 h tokens signed with that
  secret, useless after teardown) go to `${RX_E2E_WORK:-$TMPDIR/rxtest}/out` (mode 700) and are deleted by
  `sandbox_down.sh`.
* Safety: everything is named `rxtest_*` / `rxtest-*`; the scripts never stop, remove, restart or write to any
  other container, volume or network. The only touch of production is a **read-only** `docker exec
  roxira_postgres_prod pg_dump --schema-only` (and `-t migrations`). Avoid even that with
  `RX_SCHEMA_FILE=/path/to/schema_dump RX_LEDGER_FILE=/path/to/ledger_dump`.
* Port: 3901 by default; refused when it is one of the reserved service ports (AGENTS.md section 7) or already
  in use (`ss -tuln`/`lsof` check). Override with `RX_E2E_PORT`.
* Idempotent: `sandbox_up.sh` first removes a previous `rxtest_*` sandbox; sources are cached per commit sha in
  `$RX_E2E_WORK/src_<sha8>`. On failure the sandbox is removed (unless the second argument is `KEEP`).

## Running the suite by hand

```
bash scripts/infra/e2e/sandbox_up.sh origin/main
set -a; source "${TMPDIR:-/tmp}/rxtest/out/app_e2e.env"; set +a
cd e2e && npm ci && npx playwright install chromium webkit      # add --with-deps on a fresh Linux host
npx playwright test -c playwright.app.config.ts [--project=webkit] [-g "drop"]
bash ../scripts/infra/e2e/sandbox_down.sh
```

Env contract of the suite (`e2e/playwright.app.config.ts`): `APP_E2E_BASE_URL` (use `http://127.0.0.1:<port>`;
the Next middleware redirects `/app` on other hostnames), `APP_E2E_SESSION_FILE` (seeded tenant),
`APP_E2E_SESSION_FILE_IMPORT_CHROMIUM` / `_WEBKIT`, `APP_E2E_FIXTURE`. The session JSON is injected into
`localStorage["roxira.auth.session"]` with `context.addInitScript`.

`run_app_e2e.sh` extras: `RX_E2E_KEEP=1` keeps the sandbox, `RX_E2E_PW_ARGS="--project=webkit -g drop"`
forwards arguments to `playwright test`, `RX_E2E_WITH_DEPS=1|0` forces / skips `--with-deps`.

## Specs (`e2e/app/`, run in this order, one worker)

`01-drop-overlay` (overlay appears, hides **without** dragleave/drop/dragend, never on `/app/import`, drop of a
.sqlite switches to the «انتقال کامل دیتابیس» tab), `02-db-import` (upload, analysis, «تأیید و انتقال», result
counts: 31 accounts, 200 journal lines), `03-accounting` (31 accounts, balanced trial balance), `04-hr`
(contracts load, no 400 notice), `05-invoices` (list, create a draft through the form), `06-command-palette`
(Cmd/Ctrl+K). Every test also fails on an uncaught page error or an unexpected `console.error`
(`BENIGN_CONSOLE_ERRORS` in `e2e/app/fixtures.ts` is the one allow-list; keep it short).

## Workbench (opt-in)

`scripts/infra/server_agents/workbench.sh <worktree> --app-e2e` (or `WB_APP_E2E=1`) adds the group `e2e:app`
when the change touches `frontend/src/app/app`, `frontend/src/components/app`, `modules/data_import`,
`modules/accounting`, `modules/invoicing` or `modules/hr`. It builds **HEAD** of the worktree, so commit first.

## Host requirements (srv1 / any runner)

docker (with access to the prod postgres container for the schema dump, or `RX_SCHEMA_FILE`), git, curl, tar,
node >= 20 + npm, network access to the npm registry and the Playwright CDN on first run, `alpine/socat`,
`postgres:17-alpine`, `redis:7-alpine` images. First run builds two images (several minutes) and downloads about
300 MB of browsers; later runs reuse the docker layer cache and `~/.cache/ms-playwright`.
