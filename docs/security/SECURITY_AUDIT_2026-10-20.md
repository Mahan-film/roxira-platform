# Security audit 2026-10-20 (srv1 91.107.248.99 + repo)

Scope: read-only audit of production (`ssh roxira-prod`) and the repo at origin/main `adec768b`.
No secret value was printed; `.env` was inspected for variable names only.
Re-run the checks with `bash scripts/security/audit.sh` (`--local` / `--remote`).
Fix status: **FIXED-IN-REPO** = changed in this branch, takes effect on next deploy/reload (not applied to the server);
**OWNER** = needs a decision or a server change.

## Summary

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | High | No off-site backup copy from the server: restic repo not configured, local sets only (Mac pull is the only second copy), backup disk 83% used, 12 GB free | OWNER |
| 2 | Medium | Most containers run as root / without `no-new-privileges` / without `cap_drop` (app, nginx, mail, postgres, redis, qdrant, pgbouncer, embeddings, twenty_*) | FIXED-IN-REPO (partly), rest OWNER |
| 3 | Medium | `roxira-docker-firewall.service` is in `failed` state since 2026-10-13 (script `/usr/local/sbin/roxira-docker-firewall.sh` does not exist, and is not in the repo) | OWNER |
| 4 | Medium | Several proxied locations had no rate limit (`/api/backend/`, `/enterprise-hub/`, `/crm-service/`, `/api/judge/`) | FIXED-IN-REPO |
| 5 | Medium | `ufw` still has `80/tcp` and `443/tcp` ALLOW from Anywhere next to the Cloudflare rules (ufw does not govern docker-published ports; the real restriction is `DOCKER-USER -> ROXIRA-CF`) | OWNER |
| 6 | Low | `/.git`, `/.env`, `*.sql` etc. were only 404 because Next.js had no such route; no explicit nginx deny | FIXED-IN-REPO |
| 7 | Low | CSP is report-only and allows `unsafe-inline` for scripts and styles | Partly (added `object-src/base-uri/form-action`), rest OWNER/dev |
| 8 | Low | Mail relay `smtpd_relay_restrictions = permit` (safe only thanks to `smtpd_recipient_restrictions ... reject` + private-range `mynetworks` + no host port) | OWNER (defence in depth) |
| 9 | Low | `/etc/ssh/sshd_config.d/50-cloud-init.conf` says `PasswordAuthentication yes`; effective value is `no` only because `00-roxira-hardening.conf` is read first | OWNER |
| 10 | Low | JWT is hand-rolled HS256 (hmac) with a 7-day default TTL; no refresh/revocation | Dev backlog |
| 11 | Low | No `pip-audit`, `trivy`, `gitleaks` on the server; only `npm` exists. Dependency CVEs not assessed | OWNER |
| 12 | Info | Gitleaks (last 300 commits): 3 `generic-api-key` hits, all in test files (`scripts/ops/notify/tests/test_notify.py`, `inquiries.controller.spec.ts`, `src/ops/test_export_public.py`), look like fixtures | Info |
| 14 | Low | `roxira-cf-refresh.timer` is enabled but `inactive` (never fired); Cloudflare IP ranges in iptables and nginx real-IP are not auto-refreshed, so a new Cloudflare range would be dropped at the origin | OWNER (`systemctl start roxira-cf-refresh.timer`) |
| 13 | Info | Docker image tags: `searxng/searxng:latest`, `litellm main-v1.77.7-stable`, `nginx:alpine@sha256`, app images built locally. Only `searxng:latest` is floating | Info |

No critical findings. No private key or seed on the server, no key pattern in the frontend bundle, no tracked `.env`.

## Evidence per area

### 1. Network
- `ss -tulnp`: public listeners are only `22` (sshd), `80`/`443` (docker-proxy -> nginx), `8443` (xray, VPN). All of Postgres 5432, PgBouncer 6432, Redis 6379, Qdrant 6333, app 8000, Nest 3000, frontend 3001, Twenty 3002, Umami 3005, SearXNG 8888, keypool 4000, research 8090 are on `127.0.0.1`. This matches AGENTS.md section 7 (8005 dispatcher: not listening).
- `docker ps`: only `roxira_nginx_prod` publishes on `0.0.0.0`. `roxira_mail` exposes `587/tcp` inside the docker network only.
- ufw active, default deny incoming. Allowed: 22, 60000:61000/udp (mosh), 8005 from `172.16.0.0/12`, 8443, Cloudflare ranges for 80/443 (comment `cf-origin`), plus generic `80`/`443` Anywhere (finding 5).
- iptables: `DOCKER-USER` sends tcp 80/443 (original dst port) to chain `ROXIRA-CF` (127/8, 172.16/12, 19 rules in total, final `DROP`). Test from a non-Cloudflare IP (95.155.139.x): `http://91.107.248.99/` with `Host: roxira.ir` and TLS with SNI to the origin both timed out / failed, no application response, so the origin is not reachable directly. `roxira-cf-refresh.timer` is enabled but inactive and has never run (no journal entries), so the Cloudflare ranges are not being refreshed (finding 14).
- `roxira-docker-firewall.service`: `Failed at step EXEC ... /usr/local/sbin/roxira-docker-firewall.sh: No such file or directory`. Orphan unit; its purpose (block published internal ports) is already met because every internal port is bound to loopback.

### 2. SSH
- `sshd -T`: `passwordauthentication no`, `kbdinteractiveauthentication no`, `permitrootlogin prohibit-password`, `pubkeyauthentication yes`; drop-in also sets `MaxAuthTries 3`, `LoginGraceTime 30`, `X11Forwarding no`.
- fail2ban active, jail `sshd`: 2160 failures, 107 bans total, 0 banned now. crowdsec not installed (not needed).
- Finding 9: cloud-init drop-in re-enables passwords but loses by file order.

### 3. Web
- Headers on `https://ghazihoushmand.ir` and `https://roxira.ir` (identical): HSTS `max-age=15552000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), geolocation=(), payment=(self), microphone=(self)`, `Content-Security-Policy-Report-Only` (with `frame-ancestors 'self'`). No `Server: nginx`/version, no `X-Powered-By`.
- Paths (HTTPS, both domains): `/docs`, `/openapi.json`, `/redoc`, `/api/docs`, `/.env`, `/.git/config`, `/wp-login.php` -> 404. `/admin` -> 307 on ghazihoushmand.ir (frontend redirect, not an API), 404 on roxira.ir.
- nginx config (`output_apps/nginx_config/nginx.conf`): `server_tokens off`; TLS 1.2/1.3 with AEAD ciphers, session tickets off; catch-all `default_server` returns 444 for unknown Host/raw IP; real client IP only from Cloudflare ranges; `limit_req` zones `auth` 5 r/m, `auth_otp` 10 r/m, `api` 30 r/s; OTP/auth/payment routes limited via `snippets/auth_limit_*.conf`; Swagger blocked by `block_docs.conf`; `client_max_body_size 50M` global.

### 4. Application
- JWT: `JWT_SECRET`, `JWT_SECRET_KEY` present in `.env` (names only); both engines raise at import if unset (no default secret). TTL default 7 days, overridable by `JWT_TTL_SECONDS` (finding 10).
- Rate limits: OTP/auth/email-auth routes live under `/api/v1/apps/judge/auth/*` and `/api/v1/auth`, both limited by nginx (5-10 r/m, burst 5); `/api/v1/apps/judge/*` as a whole is under zone `auth` (5 r/m); Zibal under `/api/v1/payment/` (zone `auth`). Gaps closed in finding 4.
- CORS: `output_apps/ecosystem_core/src/security/cors_config.py` uses an allowlist from `CORS_ALLOW_ORIGINS`; the only wildcard CORS is in `backups/landing_redesign_20260905/` (not deployed).
- Admin: `/health` details gated by `X-Admin-Key` (`ADMIN_HEALTH_KEY`). Umami admin UI not public (loopback 3005 only).
- Uploads: STT upload capped by `chat_auth.MAX_UPLOAD_BYTES`; Nest data import capped at 5 MB; nginx global 50 MB.
- SSRF: `urllib.request.urlopen` callers use fixed provider hosts (Zibal, crypto payment, search, LLM); no endpoint found that fetches a user-supplied URL. Not exhaustive (grep only).
- SQL: f-string SQL only interpolates column-list constants (`_COLS`) or sanitised table names (`mkt_store._table`); values are parameterised. `scripts/infra/server_agents/taskq.py:77` builds `SET {keys}` from internal dict keys (not user input).
- Frontend bundle: grep of `.next/static` and `public` in `roxira_enterprise_frontend` for `sk-or-v1`, `AIza`, `gsk_`, `xai-`, `ghp_`, `-----BEGIN ... PRIVATE` -> no hits. (A first pass over all of `.next` matched only `*.nft.json` file-trace lists, i.e. filenames, not secrets.)

### 5. Containers
Running state (`docker inspect`):

| Container | User | read_only | cap_drop | no-new-privileges | Image pin |
|-----------|------|-----------|----------|-------------------|-----------|
| roxira_app_prod | root | no | none | no | local build |
| roxira_enterprise_frontend | nextjs | no | none | no | local build |
| roxira_enterprise_backend | 100:101 | yes | ALL | yes | local build |
| roxira_nginx_prod | root (master) | no | none | no | digest |
| roxira_postgres_prod / redis / pgbouncer / qdrant | image default (qdrant root) | no | none | no | digest |
| roxira_embeddings | root | no | none | no | digest |
| roxira_mail | root | no | none | no | tag `boky/postfix:5.1.0` |
| roxira_docker_socket_proxy | root | no | ALL | yes | tag+digest |
| roxira_umami, keypool, research, searxng, valkey | non-root or ALL dropped | no | ALL | yes | tag (searxng `latest`) |
| roxira_twenty_* | 1000/db/redis | no | none | yes | tag |

- docker.sock is mounted only in `roxira_docker_socket_proxy`, read-only; its env allows `CONTAINERS=1` only, `POST=0`, `EXEC=0`, `IMAGES=0`, `VOLUMES=0`. Good.
- No privileged containers.

### 6. Secrets in git
- gitleaks (last 300 commits, redacted): 3 `generic-api-key`, all in test files (finding 12).
- Regex scan over tracked files for `sk-or-v1-`, `AIza`, `gsk_`, `xai-`, `gh[pousr]_`, `AKIA`, `sk-ant-`, private-key headers: no hits.
- No tracked `.env` (only `.env.example`). On the server `.env` is `600`, owner uid 501.

### 7. Dependencies
Server has no `pip-audit`, `trivy`, `gitleaks`; `npm` exists (`output_apps/enterprise_hub/package.json`) but I did not run `npm audit` there to avoid network egress/lockfile writes on prod. The app container has 179 pip packages and no pip-audit. Result: not assessed (finding 11). Run `npm audit --omit=dev` and `pip-audit -r` in CI or on the Mac.

### 8. Backups
- Timers: `roxira-backup-dr-run.timer` hourly (last run 2026-10-20 17:08 UTC, OK in 14 s, 1 warning), `roxira-backup-dr-report.timer` daily 06:30, `roxira-backup-dr-check.timer` weekly (restic check 5%).
- The run log says: `no restic repository configured; BACKUP_ALLOW_LOCAL_ONLY=1, local sets only (the Mac pull is the second copy)`, and a low-disk alert (83%, 12 GB free, cooldown-suppressed). So there is **no off-site copy made by the server itself**; `/opt/roxira_backups` is root-only (700), local to the same disk.
- Encryption: the config bundle is encrypted with `age` to the owner's public key; the Mac copy lives in an encrypted restic repo (AES-256). Local dump sets on the server are not encrypted (rely on 700 perms + same host).

### 9. Mail relay
- `roxira_mail`: `mynetworks = 127.0.0.0/8,10/8,172.16/12,192.168/16`, no SASL, TLS "may", recipient restrictions `reject_non_fqdn_recipient, reject_unknown_recipient_domain, check_sender_access allowed_senders, reject`, no host port (only `587/tcp` inside docker). Not an open relay. `smtpd_relay_restrictions = permit` is permissive by itself (finding 8).

### 10. Crypto payments
- `.env` has `CRYPTO_PAY_ENABLED` and `CRYPTO_USDT_TRC20_ADDRESS` only; no variable whose name contains PRIVATE/SEED/MNEMONIC. Code (`crypto_payment_service.py`) talks to a fixed https host with a 15 s timeout. Address-only model holds.

## Changes made in this branch (nothing applied to the server)

| File | Change | Why / risk |
|------|--------|-----------|
| `output_apps/nginx_config/snippets/block_dotfiles.conf` (new) | 404 for any `/.xxx` path except `/.well-known/`, and for `*.sql|bak|swp|orig|old|env` | Defence in depth for `/.git`, `/.env`. ACME unaffected (negative lookahead). Regex location precedence over `location /`. |
| `output_apps/nginx_config/nginx.conf` | include the snippet in the 3 server blocks; `limit_req zone=api` (30 r/s, burst 60; CRM burst 100) on `/api/backend/`, `/enterprise-hub/`, `/crm-service/`, `/api/judge/`; `client_header_timeout 15s`, `client_body_timeout 60s`, `keepalive_timeout 30s`, `large_client_header_buffers 4 16k` | Rate limit uses real client IP (Cloudflare real-IP). Timeouts do not touch `proxy_read_timeout`, so long LLM and voice streams are unaffected. Burst is generous; lower later from logs. |
| `output_apps/nginx_config/snippets/security_headers.conf` | CSP report-only gains `object-src 'none'; base-uri 'self'; form-action 'self'`; add `X-Permitted-Cross-Domain-Policies: none` | Report-only, cannot break pages. |
| `docker-compose.prod.yml` | `no-new-privileges:true` on app, postgres, pgbouncer, redis, qdrant, embeddings, nginx, frontend; `cap_drop: [ALL]` on frontend | Takes effect when each container is recreated. Frontend runs as `nextjs` on port 3001, so it needs no capabilities. The same options already run on twenty_db/redis (postgres/redis images). Not applied to `roxira_mail` (postfix uses setgid helpers) or to cap_drop on root services that drop privileges at start (postgres, redis, nginx need CHOWN/SETUID/SETGID/NET_BIND_SERVICE; do per-service tests). |
| `scripts/security/audit.sh` (new) | Read-only audit re-run (server + web + repo), exit code = number of FAILs | Uses `ssh roxira-prod`; prints names only. |

Not tested with `nginx -t` here (no nginx/docker on the Mac and no changes allowed on prod); `scripts/ops/deploy.sh` runs `nginx -t` before reload, which is the gate. Brace balance was checked.

## Needs the owner

1. Off-site backup (finding 1): create the Hetzner Storage Box restic repo (or S3) and set `RESTIC_REPOSITORY`/password env for the backup unit; free disk space (83%).
2. Deploy: pull this branch, `docker exec roxira_nginx_prod nginx -t && nginx -s reload` (or the normal `deploy.sh`), then recreate containers in a quiet window to pick up `no-new-privileges` (restart decision is yours).
3. Orphan unit (finding 3): `systemctl disable --now roxira-docker-firewall` or restore its script.
4. ufw (finding 5): `ufw delete allow 80/tcp; ufw delete allow 443/tcp` (the `cf-origin` rules stay), after confirming Cloudflare rules work, e.g. with `scripts/ops/firewall/cloudflare_only.sh --status`.
5. Remove `PasswordAuthentication yes` from `/etc/ssh/sshd_config.d/50-cloud-init.conf` (finding 9).
6. Mail: set `POSTFIX_smtpd_relay_restrictions=permit_mynetworks,reject_unauth_destination` and re-test sending.
7. Run dependency audits (finding 11) and decide on running root containers (`app`, `nginx`, `mail`, `qdrant`) as non-root.
8. CSP enforcement needs nonce-based scripts in Next.js (dev task) before dropping `unsafe-inline`; HSTS `preload` only after all subdomains are HTTPS-only.
