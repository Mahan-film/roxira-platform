# Multi-project hosting (factory F5)

Runs many products (built from `templates/saas-chassis`: Next.js + Postgres in Docker) on one
server. It is separate from `roxira-autodeploy` (docs/ops/AUTODEPLOY.md) and never touches
`/opt/roxira_platform`, the Roxira compose project, or its nginx.

Code: `scripts/ops/projects/` (`projectctl.py`, `projects/<name>.yaml` manifests,
`docker-compose.projects.yml`, `install.sh` + `projects-deploy.{service,timer}`).

## Layout on the server

```
/srv/projects/.infra.env            PROJECTS_PG_PASSWORD=...   (mode 600, not in git)
/srv/projects/<name>/repo/          git checkout of the product
/srv/projects/<name>/.env           DB credentials + app env (mode 600, written by `create`)
/srv/projects/<name>/.deploy-state.json   deployed / previous / failed commit
/srv/projects/<name>/backups/       pg_dump taken before each migration
/srv/projects/_proxy/Caddyfile      generated, mounted into projects_caddy
/root/deploy-state/projects.jsonl   one JSON line per deploy result
```

Shared containers (`docker-compose.projects.yml`, network `projects_net`):
`projects_postgres` (postgres:17, no published port) and `projects_caddy` (caddy:2, profile
`proxy`). Each product runs as its own compose project (`docker compose -p <name>`), its app
service joins `projects_net` with alias `<name>-app`, and gets its own database and role on
`projects_postgres`.

## One-time setup (hub/owner, on the server)

```
install -d -m 700 /srv/projects
printf 'PROJECTS_PG_PASSWORD=%s\n' "$(openssl rand -hex 24)" > /srv/projects/.infra.env
chmod 600 /srv/projects/.infra.env
cd /opt/roxira_platform/scripts/ops/projects
docker compose -f docker-compose.projects.yml --env-file /srv/projects/.infra.env up -d projects_postgres
./install.sh            # dry-run: prints what it would do
./install.sh --yes      # installs + enables the 5-minute timer (deploy-all)
```

The 5-minute timer runs `projectctl.py deploy-all`: for every manifest with `enabled: true` it
fetches the branch and deploys only when there is a new commit.

## Add a product

1. Copy `projects/example.yaml` to `projects/<name>.yaml` (file name == `name`) and fill it in:
   repo URL + branch, `domains`, `compose_file`, `service` + `port` of the HTTP service,
   `health_url`, `db_name` (also the DB role name), optional `migrate_command`.
   Quote names such as `"off"` or `"no"`: YAML reads them as booleans (the validator rejects it).
2. Land the manifest through a reviewed PR; on the server the repo checkout is updated by autodeploy.
3. On the server: `python3 scripts/ops/projects/projectctl.py create <name>`. This clones the
   repo, creates the database and role on `projects_postgres` and writes a random password into
   the env file (mode 600). The password is never printed. Re-running `create` keeps existing credentials.
   Private repos: put a read-only deploy key in root's ssh config for the git host.
4. Set `enabled: true` in the manifest (PR). The next timer tick, or `projectctl.py deploy <name>`,
   builds and starts it.

The product's compose file may keep its own `db` service; the deploy override only attaches the
HTTP service to `projects_net`. Point the app at `DATABASE_URL` from the env file (host
`projects_postgres`).

## Deploy, status, logs, rollback

```
projectctl.py list                  # manifests: enabled?, domains, repo
projectctl.py status                # deployed/previous/failed commit + container status
projectctl.py deploy <name> [--force]
projectctl.py logs <name> [service]
projectctl.py rollback <name>       # re-activate the previous image tag (no rebuild)
projectctl.py disable <name>        # sets enabled: false, stops containers, re-renders proxy
projectctl.py render-proxy [--reload]
```

Deploy flow: fetch; same commit as deployed = nothing; same as the last failed commit = skip
(a newer commit retries; `--force` overrides). Otherwise: checkout the commit, `docker compose
-p <name> build` with image tag `<name>-app:<sha12>`, `pg_dump` backup (only if `migrate_command`
is set), run migrations in a one-off container, `up -d`, then poll `health_url` (24 x 5 s, 2xx/3xx).
On a failed health check the previous image tag is re-activated automatically and the commit is
remembered as failed. A failed build or migration never switches the running version.
Migrations are NOT reverted by rollback: restore from `backups/` by hand if a migration was
destructive, and write migrations backward-compatible.

A global lock (`/run/projectctl.lock`) means two `projectctl` mutations never overlap; a busy lock
exits with code 3. Each result is appended to `/root/deploy-state/projects.jsonl` and
deployed/rolled_back/failed results are sent to the owner bot through `scripts/ops/notify/notify.py`
(best effort; silent if the bot is not configured). Pause everything with
`systemctl disable --now projects-deploy.timer` (`install.sh --disable`) or per project with `disable`.

## Routing and the global server (Track G)

`render-proxy` writes `/srv/projects/_proxy/Caddyfile` from the enabled manifests (one block per
project: all its domains -> `reverse_proxy <name>-app:<port>`); `deploy-all` / `create` /
`disable` re-render it and reload `projects_caddy` if it is running. Caddy obtains and renews
HTTPS certificates automatically, so for every domain DNS (or Cloudflare, DNS-only or proxied)
must point at the server running the proxy, and ports 80/443 must be reachable for the ACME challenge.

Ports 80/443 on the **Roxira server (srv1) belong to the Roxira nginx**. Do not start
`projects_caddy` there. The proxy is meant for the separate **global server (Track G)**. The
listen ports are configurable for other layouts: `PROJECTS_HTTP_PORT` / `PROJECTS_HTTPS_PORT`
(default 80/443; written to the Caddyfile as `http_port`/`https_port` and to the compose
port mapping), `PROJECTS_BIND` (default 0.0.0.0), `PROJECTS_ACME_EMAIL`, `PROJECTS_PROXY_DIR`.
Before binding any port run `ss -tulnp | grep <port>` (AGENTS.md section 7).

## Tests

`python3 -m pytest scripts/ops/projects/tests -q` (no docker, git or network: runner and HTTP are
injected).
