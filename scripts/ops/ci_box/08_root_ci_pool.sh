#!/bin/bash
# roxira-ci root setup, part 8 (R20-8, #1024): JIT runner pool + CI resource limits. Owner runs it ONCE:
#   sudo bash scripts/ops/ci_box/08_root_ci_pool.sh --dry-run    # shows what it would do, changes nothing
#   sudo bash scripts/ops/ci_box/08_root_ci_pool.sh
# Idempotent. Prints names and statuses only (no tokens, keys, IPs or configs).
# Does:
#   1. spool + control dirs /srv/data/ci-jit/{spool/light,spool/docker,control}: owner runner, ACL
#      rwx for mahanfilms (the controller writes single-use JIT configs; runner consumes them).
#      ACLs instead of a shared group, so no running session needs a re-login. Also
#      /srv/data/ci-jit/ms-playwright (browsers seeded by mahanfilms via seed_playwright.sh).
#   2. code: scripts/ops/ci_box/jit_pool/* -> /usr/local/lib/roxira-jit (root-owned; job code
#      running as `runner` cannot change the launcher).
#   3. CI resource cap for everything user `runner` runs, including rootless Docker containers
#      (brief section 7: docker slot 4 threads / 6 GB + light slot 1 thread / 2 GB):
#      systemctl set-property user@<runner-uid>.service CPUQuota=500% MemoryHigh=7G MemoryMax=8G TasksMax=8192
#   4. apt: postgresql-client (psql for the RLS gate and app-role steps) and fonts-noto-color-emoji
#      (the one Playwright chromium dependency this box lacks); /opt/hostedtoolcache owned by runner
#      (setup-python's builds only work from that path).
#   5. as user runner: runner_setup.sh (runner template v<same as old runner>, SHA-256 checked;
#      light image; user units roxira-jit@light + roxira-jit@docker, enabled).
# Does NOT touch: nftables, ufw, xray, sudoers, the proxy, the phone stack, production, or the old
# runner (actions-runner keeps running until two JIT runs pass; then mahanfilms drops the flag
# /srv/data/ci-jit/control/retire-old-runner and the runner's own launcher disables it).
# Not limited on purpose: user `phone` (priority 1, never shed; its containers run under the system
# Docker daemon, not the phone user's manager) and the builder lanes (user mahanfilms also runs the
# box hub and bridge; lane limits belong to roxira-orch, #1021).
# Revert: docs/ops/CI_JIT_POOL.md "Revert".
set -euo pipefail

DRY=0
case "${1:-}" in
  --dry-run) DRY=1 ;;
  "") ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac
if [ "$DRY" = 0 ] && [ "$(id -u)" -ne 0 ]; then
  echo "run as root: sudo bash $0   (or add --dry-run)"; exit 1
fi

SRC="$(cd "$(dirname "$0")" && pwd)/jit_pool"
LIB=/usr/local/lib/roxira-jit
BASE=/srv/data/ci-jit
RUNNER=runner
CTRL=mahanfilms
CPU=500%; MEM_HIGH=7G; MEM_MAX=8G; TASKS=8192

ok()   { echo "OK    $*"; }
todo() { echo "TODO  $*"; }
run()  { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }

id "$RUNNER" >/dev/null 2>&1 || { echo "FAIL  user $RUNNER missing"; exit 1; }
id "$CTRL" >/dev/null 2>&1 || { echo "FAIL  user $CTRL missing"; exit 1; }
RUID="$(id -u "$RUNNER")"
RHOME="$(getent passwd "$RUNNER" | cut -d: -f6)"
for f in jit_launcher.sh runner_setup.sh Dockerfile.light 'roxira-jit@.service'; do
  [ -f "$SRC/$f" ] || { echo "FAIL  $SRC/$f missing (run from a checkout of the repo)"; exit 1; }
done
mountpoint -q /srv/data || { echo "FAIL  /srv/data is not mounted"; exit 1; }

echo "== 1. spool and control dirs"
for d in "$BASE" "$BASE/spool" "$BASE/spool/light" "$BASE/spool/docker" "$BASE/control"; do
  if [ -d "$d" ] && [ "$(stat -c %U "$d")" = "$RUNNER" ] \
     && getfacl -p "$d" 2>/dev/null | grep -q "^user:$CTRL:rwx"; then
    ok "$d"
  else
    todo "$d (owner $RUNNER, 0700, ACL $CTRL rwx, default ACL $CTRL rw + $RUNNER rw)"
    run install -d -o "$RUNNER" -g "$RUNNER" -m 0700 "$d"
    run setfacl -m "u:$CTRL:rwx" -m "d:u:$CTRL:rw" -m "d:u:$RUNNER:rw" "$d"
  fi
done
# Playwright browsers seeded by mahanfilms through its proxy (seed_playwright.sh); runner reads + runs them.
d="$BASE/ms-playwright"
if [ -d "$d" ] && getfacl -p "$d" 2>/dev/null | grep -q "^default:user:$RUNNER:r-x"; then ok "$d"; else
  todo "$d (owner $RUNNER, ACL $CTRL rwx, default ACL $CTRL rwx + $RUNNER r-x)"
  run install -d -o "$RUNNER" -g "$RUNNER" -m 0755 "$d"
  run setfacl -m "u:$CTRL:rwx" -m "d:u:$CTRL:rwx" -m "d:u:$RUNNER:rx" "$d"
fi
if [ -d /srv/data/ci-cache/jit ]; then ok "/srv/data/ci-cache/jit"; else
  todo "/srv/data/ci-cache/jit (owner $RUNNER, 0750)"
  run install -d -o "$RUNNER" -g "$RUNNER" -m 0750 /srv/data/ci-cache/jit
fi

echo "== 2. launcher code in $LIB"
changed=0
for f in jit_launcher.sh runner_setup.sh Dockerfile.light 'roxira-jit@.service'; do
  if [ -f "$LIB/$f" ] && cmp -s "$SRC/$f" "$LIB/$f"; then ok "$LIB/$f"; else todo "$LIB/$f"; changed=1; fi
done
if [ "$changed" = 1 ]; then
  run install -d -o root -g root -m 0755 "$LIB"
  run install -o root -g root -m 0755 "$SRC/jit_launcher.sh" "$SRC/runner_setup.sh" "$LIB/"
  run install -o root -g root -m 0644 "$SRC/Dockerfile.light" "$SRC/roxira-jit@.service" "$LIB/"
fi

echo "== 3. resource cap for user $RUNNER (user@$RUID.service)"
cur_cpu="$(systemctl show "user@$RUID.service" -p CPUQuotaPerSecUSec --value 2>/dev/null || true)"
cur_mem="$(systemctl show "user@$RUID.service" -p MemoryMax --value 2>/dev/null || true)"
if [ "$cur_cpu" = "5s" ] && [ "$cur_mem" = "$((8 * 1024 * 1024 * 1024))" ]; then ok "CPUQuota=$CPU MemoryMax=$MEM_MAX"; else
  todo "CPUQuota=$CPU MemoryHigh=$MEM_HIGH MemoryMax=$MEM_MAX TasksMax=$TASKS (now: cpu ${cur_cpu:-unknown}, mem ${cur_mem:-unknown})"
  run systemctl set-property "user@$RUID.service" "CPUQuota=$CPU" "MemoryHigh=$MEM_HIGH" "MemoryMax=$MEM_MAX" "TasksMax=$TASKS"
fi

echo "== 4. packages and tool cache (what GitHub-hosted images have and CI jobs expect)"
for pkg in postgresql-client fonts-noto-color-emoji; do
  if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q "install ok installed"; then
    ok "$pkg"
  else
    todo "apt-get install $pkg"
    run env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends "$pkg"
  fi
done
# actions/setup-python builds only run from /opt/hostedtoolcache (their shared-library path is fixed
# at build time); elsewhere python fails as soon as a test starts it with a clean environment.
if [ -d /opt/hostedtoolcache ] && [ "$(stat -c %U /opt/hostedtoolcache)" = "$RUNNER" ]; then
  ok "/opt/hostedtoolcache"
else
  todo "/opt/hostedtoolcache (owner $RUNNER, 0755)"
  run install -d -o "$RUNNER" -g "$RUNNER" -m 0755 /opt/hostedtoolcache
fi

echo "== 5. runner side (as $RUNNER): template, light image, launchers"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] runuser -u $RUNNER -- env HOME=$RHOME XDG_RUNTIME_DIR=/run/user/$RUID bash $LIB/runner_setup.sh"
  if [ "$(id -u)" -eq 0 ]; then
    for s in light docker; do
      st="$(runuser -u "$RUNNER" -- env XDG_RUNTIME_DIR="/run/user/$RUID" systemctl --user is-active "roxira-jit@$s.service" 2>/dev/null || true)"
      echo "now   roxira-jit@$s: ${st:-unknown}"
    done
    st="$(runuser -u "$RUNNER" -- env XDG_RUNTIME_DIR="/run/user/$RUID" systemctl --user is-active actions-runner.service 2>/dev/null || true)"
    echo "now   actions-runner (old): ${st:-unknown}"
    code="$(runuser -u "$RUNNER" -- curl -s -o /dev/null -m 15 -w '%{http_code}' https://api.github.com/zen 2>/dev/null || true)"
    echo "now   $RUNNER reaches api.github.com: HTTP ${code:-none}"
  fi
else
  runuser -u "$RUNNER" -- env HOME="$RHOME" USER="$RUNNER" XDG_RUNTIME_DIR="/run/user/$RUID" bash "$LIB/runner_setup.sh"
fi

echo
if [ "$DRY" = 1 ]; then echo "dry-run done: nothing changed. Run again without --dry-run to apply."; else
  echo "done. Next (mahanfilms): bash scripts/ops/ci_box/jit_pool/seed_playwright.sh; python3 ~/roxira-jit/jit_pool.py --status; then dry_run = false in ~/.config/roxira-jit/jit_pool.toml"
fi
