#!/usr/bin/env bash
# Read-only security audit for the Roxira production server and repo.
# Re-runs the checks from docs/security/SECURITY_AUDIT_2026-10-20.md.
#
#   bash scripts/security/audit.sh            # remote (ssh $ROXIRA_HOST, default roxira-prod) + local checks
#   bash scripts/security/audit.sh --local    # repo checks only (no ssh)
#   bash scripts/security/audit.sh --remote   # server + public web checks only
#
# Never changes anything, never prints secret values (only variable NAMES, counts, file paths).
# Exit code = number of FAIL lines (WARN does not fail).
set -u
HOST="${ROXIRA_HOST:-roxira-prod}"
SITES="${ROXIRA_SITES:-ghazihoushmand.ir roxira.ir}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="all"; case "${1:-}" in --local) MODE=local;; --remote) MODE=remote;; esac
FAILS=0
ok()   { printf 'PASS  %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS+1)); }
rsh()  { ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "$@" 2>/dev/null; }

web_checks() {
  echo "== web headers / exposed paths =="
  for h in $SITES; do
    hdr="$(curl -sI -m 15 "https://$h/" | tr -d '\r' | tr 'A-Z' 'a-z')"
    for n in strict-transport-security x-content-type-options x-frame-options referrer-policy permissions-policy content-security-policy; do
      echo "$hdr" | grep -q "^$n\|^$n-report-only" || echo "$hdr" | grep -q "^$n" || { [ "$n" = content-security-policy ] && echo "$hdr" | grep -q "^content-security-policy-report-only" && continue; bad "$h missing header $n"; continue; }
    done
    echo "$hdr" | grep -q '^content-security-policy:' && ok "$h CSP enforced" || warn "$h CSP is report-only (not enforced)"
    echo "$hdr" | grep -qE '^(x-powered-by|server: (nginx|apache))' && bad "$h leaks server/x-powered-by"
    for p in docs openapi.json redoc .env .git/config .git/HEAD backup.sql wp-login.php; do
      c="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "https://$h/$p")"
      case "$c" in 200|301|302|401|403) bad "$h /$p -> $c";; *) ok "$h /$p -> $c";; esac
    done
  done
}

remote_checks() {
  echo "== server: $HOST =="
  rsh true || { bad "cannot ssh to $HOST"; return; }
  echo "-- listeners (public = not 127.0.0.1/::1/127.0.0.5x)"
  pub="$(rsh "ss -H -tuln" | awk '{print $1" "$5}' | grep -vE ' (127\.|\[::1\]|::1)' | grep -vE '%lo' | sort -u)"
  echo "$pub" | sed 's/^/      /'
  echo "$pub" | grep -E ' (\*|0\.0\.0\.0|\[::\]):' | grep -vE ':(22|80|443|8443|68)$' | grep -v '^udp .*:68$' && warn "unexpected public listener above (AGENTS.md section 7)" || ok "public listeners limited to 22/80/443/8443"
  echo "-- published docker ports (anything not on 127.0.0.1 besides nginx 80/443)"
  rsh "docker ps --format '{{.Names}} {{.Ports}}'" | grep -E '0\.0\.0\.0|\[::\]' | grep -v roxira_nginx_prod && bad "container publishes a port publicly" || ok "only nginx publishes publicly"
  echo "-- firewall"
  rsh "ufw status | head -1" | grep -q active && ok "ufw active" || bad "ufw not active"
  rsh "iptables -S DOCKER-USER" | grep -q ROXIRA-CF && ok "DOCKER-USER -> ROXIRA-CF (Cloudflare-only 80/443)" || bad "no Cloudflare-only rule in DOCKER-USER"
  for u in roxira-docker-firewall fail2ban roxira-cf-refresh.timer; do
    [ "$(rsh "systemctl is-active $u")" = active ] && ok "unit $u active" || warn "unit $u not active"
  done
  echo "-- sshd"
  s="$(rsh "sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin|pubkeyauthentication|kbdinteractiveauthentication) '")"
  echo "$s" | grep -qi '^passwordauthentication no' && ok "ssh password auth off" || bad "ssh password auth ON"
  echo "$s" | grep -qiE '^permitrootlogin (no|prohibit-password|without-password)' && ok "root login keys-only/off" || bad "root login with password"
  rsh "fail2ban-client status sshd | grep -E 'Currently banned|Total banned'" | sed 's/^/      /'
  echo "-- containers (root / read_only / cap_drop / no-new-privileges)"
  rsh "for c in \$(docker ps --format '{{.Names}}'); do docker inspect \$c --format '{{.Name}}|u={{.Config.User}}|ro={{.HostConfig.ReadonlyRootfs}}|cd={{.HostConfig.CapDrop}}|so={{.HostConfig.SecurityOpt}}|{{.Config.Image}}'; done" | while IFS='|' read -r n u ro cd so img; do
    f=""; case "$u" in u=|u=root|u=0*) f="$f root";; esac
    case "$so" in *no-new-privileges*) ;; *) f="$f no-nnp";; esac
    case "$cd" in *ALL*) ;; *) f="$f no-capdrop";; esac
    case "$img" in *@sha256:*|*:[0-9]*) ;; *) f="$f unpinned-image";; esac
    [ -n "$f" ] && warn "$n:$f" || ok "$n hardened"
  done
  rsh "docker ps -q | xargs docker inspect --format '{{.Name}} {{range .Mounts}}{{if eq .Source \"/var/run/docker.sock\"}}SOCK:{{.Mode}} {{end}}{{end}}'" | grep SOCK | grep -v roxira_docker_socket_proxy && bad "docker.sock mounted outside the socket proxy" || ok "docker.sock only in socket proxy"
  echo "-- secrets on server (names only)"
  rsh "stat -c '%a %U %n' /opt/roxira_platform/.env" | grep -q '^600 ' && ok ".env mode 600" || bad ".env permissions too open"
  rsh "docker exec roxira_enterprise_frontend sh -c 'cd /app; grep -rlE \"sk-or-v1|AIza[0-9A-Za-z_-]{30,}|gsk_[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE\" .next/static public 2>/dev/null | head -3'" | grep . && bad "provider-key pattern in frontend bundle (files above)" || ok "no key patterns in frontend client bundle"
  rsh "grep -oE '^[A-Z0-9_]*(PRIVATE|SEED|MNEMONIC)[A-Z0-9_]*=' /opt/roxira_platform/.env" | grep . && bad "private-key-like variable names in .env (above)" || ok "no private key / seed variable in .env (address only)"
  echo "-- mail relay"
  rsh "docker exec roxira_mail postconf -h mynetworks" | grep -qE '(^|,)(0\.0\.0\.0/0|::/0)' && bad "mail mynetworks is open" || ok "mail mynetworks limited to private ranges"
  rsh "docker ps --format '{{.Names}} {{.Ports}}'" | grep roxira_mail | grep -q -- '->' && bad "roxira_mail publishes a host port" || ok "roxira_mail has no host port"
  rsh "docker exec roxira_mail postconf -h smtpd_relay_restrictions" | grep -qE '^permit$' && warn "smtpd_relay_restrictions = permit (safe only because recipient restrictions reject everything else)"
  echo "-- backups"
  rsh "systemctl list-timers --all --no-pager | grep roxira-backup-dr" | sed 's/^/      /'
  rsh "journalctl -u roxira-backup-dr-run.service -n 60 --no-pager | grep -E 'backup run|no restic repository|FAILED|ERROR' | tail -3" | sed 's/^/      /'
  rsh "journalctl -u roxira-backup-dr-run.service -n 60 --no-pager | grep -q 'no restic repository configured'" && warn "no off-site restic repository on the server (local sets only)"
  echo "-- dependency audit tooling on server"
  for t in pip-audit npm trivy gitleaks; do rsh "command -v $t" >/dev/null && ok "$t available" || warn "$t not installed on server"; done
}

local_checks() {
  echo "== repo: $ROOT =="
  cd "$ROOT" || return
  git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE 'example|sample|template' | grep . && bad "tracked .env file(s) above" || ok "no tracked .env files"
  pat='sk-or-v1-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35}|gsk_[A-Za-z0-9]{40,}|xai-[A-Za-z0-9]{40,}|gh[pousr]_[A-Za-z0-9]{36,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9_-]{20,}'
  git grep -lIE "$pat" -- . ':!*.lock' ':!package-lock.json' | grep . && bad "provider key pattern in files above" || ok "no provider key patterns in tracked files"
  if command -v gitleaks >/dev/null; then
    gitleaks detect --no-banner --redact -s . --log-opts="-n 300" >/dev/null 2>&1 && ok "gitleaks (last 300 commits) clean" || warn "gitleaks findings in last 300 commits (known: test fixtures, see audit doc)"
  else warn "gitleaks not installed"; fi
  git grep -nE "(execute|text|query)\(\s*f[\"'].*(SELECT|INSERT|UPDATE|DELETE)" -- '*.py' ':!scripts' | grep -vE '_COLS' | grep . && warn "f-string SQL above: verify no user input is interpolated" || ok "no f-string SQL with user input found (excluding column constants)"
  git grep -nE "allow_origins=\[\"\*\"\]" -- '*.py' ':!backups' | grep . && bad "wildcard CORS" || ok "no wildcard CORS outside backups/"
  git grep -nE "server_tokens off" -- output_apps/nginx_config/nginx.conf >/dev/null && ok "nginx server_tokens off" || bad "nginx server_tokens not off"
  for f in block_docs block_dotfiles security_headers; do [ -f "output_apps/nginx_config/snippets/$f.conf" ] && ok "snippet $f.conf present" || bad "snippet $f.conf missing"; done
  n=$(grep -c 'block_dotfiles.conf' output_apps/nginx_config/nginx.conf); s=$(grep -c 'block_docs.conf' output_apps/nginx_config/nginx.conf)
  [ "$n" = "$s" ] && ok "dotfile block included in every server block that blocks docs ($n)" || bad "block_dotfiles ($n) != block_docs ($s) includes"
  git grep -nE "^\s*-?\s*[\"']?(0\.0\.0\.0:)?[0-9]+:[0-9]+[\"']?\s*$" -- docker-compose.prod.yml | grep -vE '127\.0\.0\.1|"80:80"|"443:443"' | grep . && bad "compose publishes a non-loopback port (above)" || ok "compose publishes only 127.0.0.1 ports plus nginx 80/443"
}

[ "$MODE" != remote ] && local_checks
[ "$MODE" != local ] && { web_checks; remote_checks; }
echo; echo "FAIL count: $FAILS"
exit "$FAILS"
