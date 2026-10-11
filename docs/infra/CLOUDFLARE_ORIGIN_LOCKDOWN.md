# Cloudflare origin lockdown and infra hardening runbook

Covers security audit 2026-10-09 findings 2 (nginx part), 5, 6, 7 (nginx part), 8 (headers).
Server: `5.75.200.67`, repo `/opt/roxira_platform`. All commands run as root on the server.

## What changed in the repo

| Area | Change |
|---|---|
| `docker-compose.prod.yml` | `docker-socket-proxy` sidecar (internal network only); backend no longer mounts `docker.sock`; backend runs non-root (100:101), `cap_drop: [ALL]`, `no-new-privileges`, `read_only`, repo mounted `:ro` with rw only for the radar report files and `data/tech_radar`; `/usr/bin/docker` mount removed from `enterprise_app`; images pinned by digest |
| `output_apps/nginx_config/nginx.conf` + `snippets/` | catch-all `default_server` (444) on 80/443, loopback health listener, shared security headers (HSTS 180 days), docs/OpenAPI blocked, `auth_otp` rate limit on all auth/OTP routes, Cloudflare real-IP via includes |
| `scripts/ops/nginx/` | `gen_snakeoil_cert.sh`, `update_cloudflare_ips.sh` |
| `scripts/ops/firewall/cloudflare_only.sh` | origin firewall (DOCKER-USER + ufw), dry-run default, `--apply`, `--rollback` |
| `deploy/systemd/roxira-cf-refresh.{service,timer}` | weekly refresh and re-apply after reboot |
| Backend TS | `DockerEngineClient` accepts `tcp://host:port` (`DOCKER_HOST`), falls back to `DOCKER_SOCKET_PATH` |

## Known behaviour changes (read before rolling out)

1. Radar "run swarm" uses `docker exec` from inside the backend. The proxy blocks POST, so those agents report FAILED. This is the point of the change. `GET /health/system` keeps working.
2. Requests with `Host: localhost`, `127.0.0.1` or the raw IP now get 444 on the public listeners. The container healthcheck moved to `127.0.0.1:8081/nginx-health` (container loopback only, not published). Anything on the host that curls `http://localhost/` expecting the roxira.ir site must send `-H 'Host: roxira.ir'`.
3. `/docs`, `/docs/`, `/docs-json`, `/redoc`, `/openapi.json`, `/swagger*` return 404 on every vhost. The backend container's own healthcheck (`curl 127.0.0.1:3000/docs`) bypasses nginx and is unaffected.
4. HSTS goes from 300 s to 15552000 s (180 days), `includeSubDomains`, no preload. Confirm every subdomain you serve is HTTPS first. CSP stays report-only.
5. `/enterprise-hub/` proxy_pass variable bug is intentionally NOT fixed (see the TODO comment in `nginx.conf`); fix only after the NestJS global auth guard PR is deployed.
6. Rate limit: new zone `auth_otp` (10 r/m per client IP, burst 5, HTTP 429) on `/api/v1/auth/*`, `/api/v1/apps/judge/{auth,unifiedauth,send-otp,verify-otp}`, `/api/judge/...` (same), and NestJS `/api/backend/auth/*`. The judge routes keep the old stricter `auth` zone too. Per-phone limits still need the application fix (audit finding 2).
7. Backend runs as uid 100: the compose-mounted report files must be writable by it (rollout step 2).
8. Existing drift (not changed here): the live backend is also attached to the `research` network, which is not in `docker-compose.prod.yml`. Recreating the backend from this file drops that attachment. Check whether anything needs it (`docker network inspect research`) before step 4; add the network to compose if it does.

## Rollout order (server)

Do each step, run its verify, stop on any failure.

### 0. Pre-flight

```bash
cd /opt/roxira_platform
git status --short            # must be clean
git pull --ff-only            # after the PR is merged
docker compose -f docker-compose.prod.yml config -q && echo compose-ok
ss -tulnp | grep -E ':(80|443|8081) '     # 8081 must NOT be bound on the host (it is container-internal only)
cp docker-compose.prod.yml /root/docker-compose.prod.yml.pre-hardening   # rollback copy
```

### 1. Snakeoil cert and real-IP include (no service change yet)

```bash
scripts/ops/nginx/gen_snakeoil_cert.sh        # creates nginx/ssl-default/snakeoil.{crt,key}
scripts/ops/nginx/update_cloudflare_ips.sh    # creates nginx/generated/cloudflare_real_ip.conf
ls -l nginx/ssl-default nginx/generated
```
Verify: both directories exist and are non-empty. If they do not exist when nginx is recreated, Docker creates empty root-owned directories and nginx fails to start (catch-all has no cert).
`nginx/generated/` ships in git with a `.keep.conf` placeholder, so the directory always exists (and is owned by the deploy user). `nginx/ssl-default/` does not; it must be generated before nginx is recreated.
Rollback: `rm -r nginx/ssl-default; rm -f nginx/generated/cloudflare_real_ip.conf` (do not remove the tracked `.keep.conf`; only needed if you abandon the change).

### 2. Backend prerequisites (radar write paths for uid 100)

If a bind-mount source file is missing, Docker silently creates a root-owned *directory* with that name and the mount breaks. So do this BEFORE any `docker compose up`:

```bash
scripts/ops/prep_backend_mounts.sh            # dry run: prints touch/chown/install
sudo scripts/ops/prep_backend_mounts.sh --apply
ls -l TECH_RADAR_REPORT.md TECH_RADAR_REPORT.json; ls -ld data/tech_radar   # files (not dirs), owner 100:101
```
The script never deletes: if a path already exists as a directory it reports it and exits non-zero.
Root cron jobs can still write these files. If `git pull` complains later, it will not be about ownership (git tracks mode, not owner).

### 3. Start the socket proxy and recreate the backend

```bash
docker compose -f docker-compose.prod.yml pull docker-socket-proxy
docker compose -f docker-compose.prod.yml up -d docker-socket-proxy
docker compose -f docker-compose.prod.yml up -d --no-deps --build roxira_enterprise_backend
```
Verify:
```bash
docker inspect -f '{{.State.Health.Status}}' roxira_enterprise_backend     # healthy
docker exec roxira_enterprise_backend id                                   # uid=100(nestjs)
docker inspect -f '{{range .Mounts}}{{.Source}} -> {{.Destination}} rw={{.RW}}{{"\n"}}{{end}}' roxira_enterprise_backend   # no docker.sock; repo rw=false
curl -s http://127.0.0.1:3000/v1/enterprise-hub/health/system | head -c 300    # container list still returned (path may differ; use the health route you use today)
docker exec roxira_enterprise_backend sh -c 'wget -qO- --post-data= http://docker-socket-proxy:2375/containers/create' ; echo   # must be 403/forbidden
```
Rollback: restore `/root/docker-compose.prod.yml.pre-hardening` over `docker-compose.prod.yml` (or `git checkout <previous commit> -- docker-compose.prod.yml`), then `docker compose -f docker-compose.prod.yml up -d --no-deps roxira_enterprise_backend`; `docker rm -f roxira_docker_socket_proxy`.

### 4. enterprise_app (drops `/usr/bin/docker` mount, pinned images)

```bash
docker compose -f docker-compose.prod.yml up -d --no-deps enterprise_app
```
Verify: `docker inspect -f '{{.State.Health.Status}}' roxira_app_prod` -> healthy; `curl -s https://ghazihoushmand.ir/health`.
Pinned postgres/pgbouncer/redis/qdrant digests equal the images already running, so `up -d` should report them as up to date and not recreate them (check the output: nothing should say "Recreated" for those four). If compose wants to recreate one, stop and investigate before continuing.
Rollback: as step 3.

### 5. nginx

```bash
docker compose -f docker-compose.prod.yml up -d --no-deps nginx_gateway    # new mounts + healthcheck need a recreate, not just reload
```
Verify (from the server, via the origin):
```bash
docker exec roxira_nginx_prod nginx -t
docker inspect -f '{{.State.Health.Status}}' roxira_nginx_prod                         # healthy
curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1/                           # 000 / empty reply (444)
curl -s  -o /dev/null -w '%{http_code}\n' -H 'Host: 5.75.200.67' http://127.0.0.1/     # 000 / empty reply
curl -sk --resolve roxira.ir:443:127.0.0.1 -o /dev/null -w '%{http_code}\n' https://roxira.ir/        # 200
for p in /docs /docs/ /docs-json /redoc /openapi.json; do curl -sk --resolve roxira.net:443:127.0.0.1 -o /dev/null -w "$p %{http_code}\n" https://roxira.net$p; done   # all 404
curl -sI https://roxira.ir/ | grep -i strict-transport      # max-age=15552000; includeSubDomains
```
Verify real-IP: `docker logs --tail 20 roxira_nginx_prod` shows visitor IPs, not 172.69.x / 104.x Cloudflare addresses. From outside: `curl -sI https://roxira.ir/api/v1/auth/request-otp -X POST` repeated 20 times returns some 429.
Verify certbot renewal still works (ACME webroot is served on the real vhosts): `certbot renew --dry-run`.
Rollback: restore the previous compose file and `nginx.conf` (`git checkout <previous commit> -- docker-compose.prod.yml output_apps/nginx_config`), `docker compose -f docker-compose.prod.yml up -d --no-deps nginx_gateway`. Reload-only changes: `docker exec roxira_nginx_prod nginx -t && docker exec roxira_nginx_prod nginx -s reload`.

### 6. Origin firewall

Make sure the site works through Cloudflare first (step 5 verify from outside).

```bash
scripts/ops/firewall/cloudflare_only.sh            # DRY RUN: read every line
ufw status numbered > /root/ufw-before-cf.txt      # keep a copy
iptables-save > /root/iptables-before-cf.txt
```
Keep a second SSH session open, then:
```bash
scripts/ops/firewall/cloudflare_only.sh --apply
scripts/ops/firewall/cloudflare_only.sh --status
```
Verify from your Mac (not Cloudflare):
```bash
curl -sk --max-time 8 -o /dev/null -w '%{http_code}\n' https://5.75.200.67/                 # timeout (000)
curl -s  --max-time 8 -o /dev/null -w '%{http_code}\n' -H 'Host: roxira.ir' http://5.75.200.67/   # timeout (000)
curl -s -o /dev/null -w '%{http_code}\n' https://roxira.ir/                                  # 200 via Cloudflare
nc -z -w3 5.75.200.67 22 && echo ssh-open
nc -z -w3 5.75.200.67 8443 && echo xray-open                                                # unchanged
```
From the server: `ufw status | grep -E '^(22|8443)'` still present; `iptables -S DOCKER-USER | head`.
The script never edits the ufw rules for 22, 8443, 2053/2096, 60000:61000/udp or 8005.
Rollback (instant, safe to run any time):
```bash
scripts/ops/firewall/cloudflare_only.sh --rollback
```
This removes `ROXIRA-CF` and its jump rules and re-adds `ufw allow 80/tcp` and `443/tcp`. Full restore if needed: `iptables-restore < /root/iptables-before-cf.txt` (will also drop Docker's own rules until docker restarts; prefer `--rollback`).

### 7. Weekly refresh and boot persistence

DOCKER-USER rules do not survive a reboot. After step 6 has been verified:
```bash
cp deploy/systemd/roxira-cf-refresh.service deploy/systemd/roxira-cf-refresh.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now roxira-cf-refresh.timer
systemctl list-timers roxira-cf-refresh.timer
systemctl start roxira-cf-refresh.service && journalctl -u roxira-cf-refresh.service -n 30 --no-pager
```
Between a reboot and the timer firing (about 3 minutes), the ufw 80/443 world-open rules are already gone but Docker's DNAT path is open; if that gap matters, run `cloudflare_only.sh --apply --offline` from a unit ordered `After=docker.service` (cached ranges in `/var/lib/roxira/`).
Rollback: `systemctl disable --now roxira-cf-refresh.timer`.

## Phase 2 (optional): Authenticated Origin Pulls (mTLS)

Cloudflare IP allowlisting still lets any other Cloudflare customer reach the origin by pointing their own zone at the IP. Authenticated Origin Pulls closes that.

1. Cloudflare dashboard, each zone (roxira.ir, roxira.net, ghazihoushmand.ir): SSL/TLS > Origin Server > Authenticated Origin Pulls > On. (Zone-level uses Cloudflare's shared client certificate.)
2. Download Cloudflare's origin-pull CA: `https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem` and save as `nginx/ssl-default/cloudflare_origin_pull_ca.pem` (the dir is already mounted at `/etc/nginx/ssl-default`).
3. In `nginx.conf`, in the `http {}` block (applies to all vhosts):
   ```
   ssl_client_certificate /etc/nginx/ssl-default/cloudflare_origin_pull_ca.pem;
   ssl_verify_client on;
   ```
   The catch-all server needs `ssl_verify_client off;` so its 444 is not preceded by a handshake failure. Certbot's HTTP-01 on port 80 is not affected; if renewals ever use TLS-ALPN, exempt them.
4. `docker exec roxira_nginx_prod nginx -t && docker exec roxira_nginx_prod nginx -s reload`
5. Verify: via Cloudflare returns 200; `curl -sk --resolve roxira.ir:443:5.75.200.67 https://roxira.ir/` returns 400 "No required SSL certificate was sent".
6. Rollback: remove the two directives and reload, or switch the zone toggle off. Do not enable while any non-Cloudflare client (monitoring, health pingers, the Mac backup pull) hits 443 directly.
