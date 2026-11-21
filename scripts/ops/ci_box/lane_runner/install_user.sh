#!/usr/bin/env bash
# Box lane runner, part 1 of 2 (NO sudo): run as the lane user (the Linux user that runs L5-L7, not root).
# Dry-run by default: prints what it would change and touches nothing. Add --apply to do it.
#   install_user.sh [--apply] [--enable-tunnel] [--repo-url URL]
# It: creates ~/.config/roxira-lane (mode 700) with config and EMPTY mode-600 key files, creates a dedicated
# forwarding-only ssh key for the tunnel (prints the PUBLIC half), renders the user units, makes the box-local taskq
# state dir and bare clone, links lane-run into ~/.local/bin. It never enables the timer, never writes a key value,
# never touches /etc, nftables or sudoers (that is install_root.sh).
set -euo pipefail

APPLY=0 ENABLE_TUNNEL=0 REPO_URL="https://github.com/Mahan-film/roxira-platform.git"
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --enable-tunnel) ENABLE_TUNNEL=1 ;;
    --repo-url) REPO_URL="${2?}"; shift ;;
    -h | --help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

[ "$(id -u)" != 0 ] || { echo "run as the lane user, not root" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
CFG="$HOME/.config/roxira-lane"
STATE="$HOME/.local/state/roxira-lane"
UNITS="$HOME/.config/systemd/user"
SSHKEY="$HOME/.ssh/roxira_gateway_tunnel"
BIN="$HOME/.local/bin"
WARN=0

say() { printf '%s\n' "$*"; }
act() { if [ "$APPLY" = 1 ]; then say "[apply]   $*"; else say "[dry-run] would: $*"; fi; }
warn() { WARN=$((WARN + 1)); say "[warn]    $*"; }
# lane-run is always installed; in --apply mode a missing nc -X or opencode is fatal, in dry-run only a warning.
need() { if [ "$APPLY" = 1 ]; then say "[error]   $*" >&2; exit 1; else warn "$*"; fi; }

say "== checks (read-only)"
[ -x "$HERE/lane-run" ] || warn "lane-run is not executable in $HERE"
command -v ssh >/dev/null || warn "ssh missing"
command -v python3 >/dev/null || warn "python3 missing"
command -v git >/dev/null || warn "git missing"
if /usr/bin/nc -h 2>&1 | grep -q -- '-X'; then say "nc supports -X (proxy CONNECT): ok"
else need "/usr/bin/nc has no -X option: install netcat-openbsd (admin step) or the tunnel cannot use the box proxy"; fi
if command -v opencode >/dev/null || [ -x "$BIN/opencode" ]; then say "opencode: found"
else need "opencode not found: install it for this user first (docs/ops/BOX_LANE_RUNNER.md step 3)"; fi
if command -v ss >/dev/null; then
  if ss -tln 2>/dev/null | grep -q '127.0.0.1:10809 '; then say "box proxy 127.0.0.1:10809: listening"
  else warn "nothing listens on 127.0.0.1:10809 (box proxy off? ask the admin to run: sudo box-proxy on)"; fi
  if ss -tln 2>/dev/null | grep -q ':4181 '; then say "local port 4181: already in use (ok only if it is this tunnel)"; else say "local port 4181: free"; fi
fi

say "== plan"
act "mkdir -p $CFG (mode 700), $STATE/logs, $STATE/etc, $UNITS, $BIN"
act "copy lane-run.conf.example -> $CFG/lane-run.conf (only if missing)"
act "create EMPTY $CFG/gateway.env and $CFG/tunnel.env, mode 600 (only if missing; no values written)"
act "ssh-keygen ed25519 (no passphrase) -> $SSHKEY (only if missing); print the PUBLIC key"
act "render roxira-gateway-tunnel.service, roxira-lane-taskq.service, roxira-lane-taskq.timer -> $UNITS"
act "git clone --bare $REPO_URL -> $STATE/repo.git (only if missing; fetch refspec main only)"
act "symlink $BIN/lane-run -> $HERE/lane-run"
act "systemctl --user daemon-reload  (timer stays DISABLED; tunnel only with --enable-tunnel)"
if [ -x /usr/local/sbin/roxira-lane-root ]; then act "sudo -n /usr/local/sbin/roxira-lane-root linger-on"
else say "[note]    root wrapper not installed: linger (units survive logout) needs install_root.sh once"; fi

if [ "$APPLY" = 0 ]; then
  say ""
  say "Nothing changed. Re-run with --apply. Warnings above: $WARN"
  exit 0
fi

mkdir -p "$STATE/logs" "$STATE/etc" "$UNITS" "$BIN" "$HOME/.ssh"
mkdir -p "$CFG"
chmod 700 "$CFG" "$HOME/.ssh"
[ -f "$CFG/lane-run.conf" ] || cp "$HERE/lane-run.conf.example" "$CFG/lane-run.conf"
for f in gateway.env tunnel.env; do
  if [ ! -f "$CFG/$f" ]; then
    ( umask 077; cp "$HERE/$f.example" "$CFG/$f" )
  fi
  chmod 600 "$CFG/$f"
done
if [ ! -f "$SSHKEY" ]; then
  ssh-keygen -q -t ed25519 -N '' -C "roxira-box-gateway-tunnel" -f "$SSHKEY"
  chmod 600 "$SSHKEY"
fi
say "Public key to give the owner (safe to share; it is the PUBLIC half):"
cat "$SSHKEY.pub"

for u in roxira-gateway-tunnel.service roxira-lane-taskq.service roxira-lane-taskq.timer; do
  sed -e "s#@REPO@#$REPO#g" -e "s#@STATE@#$STATE#g" "$HERE/$u" >"$UNITS/$u"
done

if [ ! -d "$STATE/repo.git" ]; then
  git clone --bare --quiet "$REPO_URL" "$STATE/repo.git"
  git --git-dir="$STATE/repo.git" config remote.origin.fetch '+refs/heads/main:refs/remotes/origin/main'
fi
ln -sf "$HERE/lane-run" "$BIN/lane-run"
systemctl --user daemon-reload

if [ -x /usr/local/sbin/roxira-lane-root ]; then
  sudo -n /usr/local/sbin/roxira-lane-root linger-on || warn "linger-on failed"
fi

if [ "$ENABLE_TUNNEL" = 1 ]; then
  if ! grep -q '^TUNNEL_HOST=.' "$CFG/tunnel.env" || ! grep -q '^TUNNEL_USER=.' "$CFG/tunnel.env"; then
    warn "tunnel.env is still empty; fill it first, tunnel NOT enabled"
  else
    systemctl --user enable --now roxira-gateway-tunnel.service
    say "tunnel enabled. Check: curl -s http://127.0.0.1:4181/health/liveliness"
  fi
fi
say "done. Warnings: $WARN. Next: docs/ops/BOX_LANE_RUNNER.md"
