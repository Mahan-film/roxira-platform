# Rollout of PR #527 (infra hardening) - owner command sequence

Run every command from your Mac unless it says otherwise. `S='ssh 5.75.200.67'` is
written out in full so each block is copy-pasteable. Do not skip a verify step: if
one fails, run that step's rollback and stop.

Facts confirmed read-only on the server on 2026-10-11 (HEAD e457c54 = origin/main, tree clean):

- Backend is attached only to `roxira_platform_roxira_net`. There is no `research`
  attachment and nothing in `output_apps/enterprise_hub` (excluding the static frontend
  text) uses SearXNG or the research network. The `research` network belongs to
  `research-stack-*` and is untouched.
- Backend runs as root today and mounts `/opt/roxira_platform` rw plus
  `/var/run/docker.sock:ro`. It is currently `unhealthy` because the running image still
  uses the old `curl /docs` healthcheck (fixed in #549, shipped by this deploy).
- `TECH_RADAR_REPORT.md/.json` and `data/tech_radar/` are `root:root` (dir mode 777).
  `roxira-radar.service` runs as root (no `User=`) via host python and writes them with
  `open(path, "w")` (in place, inode kept). Root ignores file ownership, so the
  `chown 100:101` does not break the timer, and the single-file bind mounts stay valid.
- Twenty CRM upstream is `server 127.0.0.1:3002` (IP literal), so nginx starts even
  when Twenty is down; `/crm-service/` just answers 502. The sandbox vhost dir
  `nginx/sandboxes/` is empty. All other proxy_pass use variables plus `resolver 127.0.0.11`.
- Data-service images are already running exactly the digests pinned in compose
  (postgres, pgbouncer, redis, qdrant 1.19.0, nginx). Pinning does not change them.
- Compose services whose definition changes vs main: `enterprise_app` (drops the
  `/usr/bin/docker` mount), `roxira_enterprise_backend` (non-root, read-only, socket proxy),
  `nginx_gateway` (snippets/cloudflare/ssl-default mounts, healthcheck), `docker-socket-proxy`
  (new), and `postgres_prod`, `pgbouncer_prod`, `redis_prod`, `qdrant_prod` (image string only,
  same image id). `deploy_local.sh` recreates app, backend, frontend and nginx only
  (compose change => app+backend+frontend; nginx_config change => nginx force-recreate).
  It does NOT start `docker-socket-proxy` and does NOT recreate the four data services.
  Do not run a bare `docker compose up -d` afterwards unless you accept a brief restart of those four.

## (a) Merge the PR

```bash
gh pr checks 527 --repo Mahan-film/roxira-platform
gh pr merge 527 --repo Mahan-film/roxira-platform --squash
```
Verify: `git fetch origin && git log origin/main -1 --oneline` shows the squash commit.
Rollback: `git revert <squash-sha>` in a new PR (nothing on the server has changed yet).

## (b) On the server BEFORE deploy (prep; outputs are gitignored)

The scripts are run from `origin/main` through `bash -s`, so the repo root cannot be
derived from the script path; the env overrides below pin it.

```bash
ssh 5.75.200.67 'cd /opt/roxira_platform && git fetch -q origin main && git status --short && echo TREE_CLEAN_CHECK_DONE'

# 1. self-signed cert for the catch-all server (nginx/ssl-default, gitignored)
ssh 5.75.200.67 'cd /opt/roxira_platform && git show origin/main:scripts/ops/nginx/gen_snakeoil_cert.sh | SNAKEOIL_DIR=/opt/roxira_platform/nginx/ssl-default bash -s'

# 2. dry run, then apply, of backend mount ownership (uid 100 / gid 101)
ssh 5.75.200.67 'cd /opt/roxira_platform && git show origin/main:scripts/ops/prep_backend_mounts.sh | PREP_ROOT=/opt/roxira_platform bash -s'
ssh 5.75.200.67 'cd /opt/roxira_platform && git show origin/main:scripts/ops/prep_backend_mounts.sh | PREP_ROOT=/opt/roxira_platform bash -s -- --apply'

# 3. Cloudflare real-IP include WITHOUT --reload (the old nginx has no mount for it and is not touched)
ssh 5.75.200.67 'cd /opt/roxira_platform && git show origin/main:scripts/ops/nginx/update_cloudflare_ips.sh | CF_REALIP_DIR=/opt/roxira_platform/nginx/generated bash -s'

# 4. pre-pull the new socket proxy image (does not touch running containers)
ssh 5.75.200.67 'docker pull tecnativa/docker-socket-proxy:v0.5.0@sha256:1f5038b54f06c3e18422902cf00ba21803d1c97805aae032e5e6673d532d3459'
```
Verify (the tree must still be clean so deploy_local.sh will accept it):
```bash
ssh 5.75.200.67 'cd /opt/roxira_platform && git status --short | wc -l && ls -la nginx/ssl-default nginx/generated && stat -c "%u:%g %a %n" TECH_RADAR_REPORT.md TECH_RADAR_REPORT.json data/tech_radar'
```
Expect: `0`, snakeoil.crt/.key present, `cloudflare_real_ip.conf` present, and `100:101` on the three radar paths.
Check the radar timer still works (optional): `ssh 5.75.200.67 'systemctl start roxira-radar.service; systemctl is-failed roxira-radar.service'` should print `active`/not failed.
Rollback (only the files created in this step; names are exact):
```bash
ssh 5.75.200.67 'cd /opt/roxira_platform && rm -f nginx/ssl-default/snakeoil.crt nginx/ssl-default/snakeoil.key nginx/generated/cloudflare_real_ip.conf && chown root:root TECH_RADAR_REPORT.md TECH_RADAR_REPORT.json data/tech_radar && chmod 777 data/tech_radar && chmod 644 TECH_RADAR_REPORT.md TECH_RADAR_REPORT.json'
```

## (c) Deploy

From your Mac, inside a checkout of the repo (it diffs against origin/main):
```bash
cd ~/Developer/roxira-platform && git fetch origin main
scripts/ops/deploy_local.sh plan
scripts/ops/deploy_local.sh deploy --yes
```
Then start the socket proxy (deploy_local does not know about the new service; the backend
will report `degraded` in /health/system but stays up until this runs):
```bash
ssh 5.75.200.67 'cd /opt/roxira_platform && docker compose -f docker-compose.prod.yml up -d --no-deps docker-socket-proxy'
```
The built-in smoke test (health, /admin 404, /chat 200, pricing API 200) auto-rolls back on failure.
Rollback:
```bash
scripts/ops/deploy_local.sh rollback --yes
ssh 5.75.200.67 'cd /opt/roxira_platform && docker compose -f docker-compose.prod.yml stop docker-socket-proxy && docker compose -f docker-compose.prod.yml rm -f docker-socket-proxy'
```
(`rollback` resets the server to the previous commit and recreates app/backend/frontend from the `:prev` images; the old backend root-owned behaviour returns, the chown from (b) is harmless.)

## (d) Verify the deploy

```bash
# raw IP is dropped (expect 000 / empty reply, never a page)
curl -sk -m 10 -o /dev/null -w 'ip443=%{http_code}\n' https://5.75.200.67/
curl -s  -m 10 -o /dev/null -w 'ip80=%{http_code}\n'  http://5.75.200.67/
# domains answer
for d in ghazihoushmand.ir roxira.ir roxira.net; do curl -sL -m 20 -o /dev/null -w "$d %{http_code}\n" https://$d/; done
# /docs is hidden (expect 404 on all three)
for d in roxira.ir roxira.net; do curl -s -m 20 -o /dev/null -w "$d/docs %{http_code}\n" https://$d/docs; done
# chat page and API (expect 200 200)
curl -s -m 20 -o /dev/null -w 'chat %{http_code}\n' https://ghazihoushmand.ir/chat
curl -s -m 20 -o /dev/null -w 'plans %{http_code}\n' https://ghazihoushmand.ir/api/v1/apps/judge/pricing/plans
# backend healthy, non-root, read-only, no docker.sock, on the proxy network only for docker access
ssh 5.75.200.67 'docker inspect roxira_enterprise_backend --format "health={{.State.Health.Status}} user={{.Config.User}} ro={{.HostConfig.ReadonlyRootfs}} privileged={{.HostConfig.Privileged}}"; docker inspect roxira_enterprise_backend --format "{{range .Mounts}}{{.Source}} {{end}}" | grep -c docker.sock; docker exec roxira_enterprise_backend id -u'
# expect health=healthy user=100:101 ro=true privileged=false ; grep count 0 ; uid 100
ssh 5.75.200.67 'docker exec roxira_enterprise_backend curl -s http://127.0.0.1:3000/health/system | head -c 300; echo; docker ps --format "{{.Names}} {{.Status}}" | grep -E "nginx|backend|socket"'
# nginx healthcheck + the proxy refuses writes
ssh 5.75.200.67 'docker exec roxira_enterprise_backend curl -s -o /dev/null -w "%{http_code}\n" -X POST http://docker-socket-proxy:2375/containers/create'   # expect 403
ssh 5.75.200.67 'cd /opt/roxira_platform && git status --short | wc -l'   # expect 0
```
Also open https://ghazihoushmand.ir/chat in a browser and send one message, and try OTP login once
(rate limit: 10 req/min per IP on auth routes). Check the Tech Radar page still loads (live runs that
write outside the three rw paths will now fail because the repo mount is read-only; report if seen).
Rollback: step (c) rollback.

## (e) Firewall: Cloudflare-only on 80/443

Do this only after (d) is fully green. Keep one SSH session open the whole time.

```bash
# Terminal 1 (keep open until the end; this is your safety net)
ssh -o ServerAliveInterval=5 5.75.200.67
# Terminal 2: dry run (changes nothing; prints each iptables/ufw command)
ssh 5.75.200.67 'cd /opt/roxira_platform && scripts/ops/firewall/cloudflare_only.sh'
ssh 5.75.200.67 'cd /opt/roxira_platform && scripts/ops/firewall/cloudflare_only.sh --status'
# Apply
ssh 5.75.200.67 'cd /opt/roxira_platform && scripts/ops/firewall/cloudflare_only.sh --apply'
```
Verify, in this order:
```bash
ssh 5.75.200.67 'echo ssh-ok'                                 # new session still works
nc -vz -w 5 5.75.200.67 8443                                  # xray still reachable (succeeded)
curl -sk -m 8 -o /dev/null -w 'direct443=%{http_code}\n' https://5.75.200.67/   # expect 000 (timeout)
for d in ghazihoushmand.ir roxira.ir roxira.net; do curl -sL -m 20 -o /dev/null -w "$d %{http_code}\n" https://$d/; done   # 200
ssh 5.75.200.67 'cd /opt/roxira_platform && scripts/ops/firewall/cloudflare_only.sh --status'
ssh 5.75.200.67 'iptables -S DOCKER-USER | head -8'           # existing 3000/6432 DROPs still present
```
Rollback (run from terminal 1 if anything is off):
```bash
ssh 5.75.200.67 'cd /opt/roxira_platform && scripts/ops/firewall/cloudflare_only.sh --rollback'
```
Note: the DOCKER-USER rules are not persistent across reboot; step (f) re-applies them.

## (f) Install the refresh timer

Only after (e) is verified.
```bash
ssh 5.75.200.67 'cd /opt/roxira_platform && cp deploy/systemd/roxira-cf-refresh.service deploy/systemd/roxira-cf-refresh.timer /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now roxira-cf-refresh.timer'
ssh 5.75.200.67 'systemctl start roxira-cf-refresh.service; systemctl is-failed roxira-cf-refresh.service; journalctl -u roxira-cf-refresh.service -n 15 --no-pager; systemctl list-timers roxira-cf-refresh.timer --no-pager'
```
Expect the service to finish `active/inactive` (not failed), "nginx reloaded" and the firewall re-applied; repeat the (e) verify block.
Rollback:
```bash
ssh 5.75.200.67 'systemctl disable --now roxira-cf-refresh.timer && rm -f /etc/systemd/system/roxira-cf-refresh.service /etc/systemd/system/roxira-cf-refresh.timer && systemctl daemon-reload'
```

## Known caveats

- `/enterprise-hub/*` now reaches NestJS after #546 (rewrite), so NestJS modules without an
  auth guard are reachable until the global APP_GUARD PR lands (comment in nginx.conf updated).
- Twenty CRM and the sandboxes are stopped; their routes remain and return 502/404-style errors.
- `deploy_local.sh` should learn to start `docker-socket-proxy` (service list is derived from
  changed paths); until then step (c) includes the manual `up -d --no-deps docker-socket-proxy`.
