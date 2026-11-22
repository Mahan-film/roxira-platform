#!/usr/bin/env bash
# Builder separation + egress lock, ROOT part (issue #1022, docs/ops/BUILDER_EGRESS.md). Admin runs it ON THE BOX.
#   sudo bash apply_root.sh --lane-user <lane user> [--dry-run]     (default: prints every step, changes nothing)
#   sudo bash apply_root.sh --lane-user <lane user> --apply         (idempotent: a second run changes nothing)
# Options: --builder-user NAME (default roxira-builder)   --opencode-src FILE (default: the lane user's opencode, resolved)
# Steps, each with its UNDO line:  1 users  2 dirs+ACL  3 runner+env  4 opencode copy  5 tinyproxy  6 nft lock
#                                  7 final checks (builder not in docker/sudo).
# Safety: this script NEVER changes the group membership of any existing user. It creates the builder user (not in
# docker, not in sudo) and only READS the docker group. Users that use docker (e.g. a phone stack running docker exec,
# or the lane user) keep their membership; any option that mentions docker is refused. It does not touch xray, ufw,
# sudoers, the existing box lock or production files. The root wrapper verb is installed by lane_runner/install_root.sh.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLY=0 LANE_USER="" BUILDER="roxira-builder" OPENCODE_SRC=""
PROXY_PORT=10810

LIBEXEC=/usr/local/libexec/roxira-lane
ETC=/etc/roxira-lane
OPT=/opt/roxira-builder
DATA=/srv/data/roxira-lane
HOME_B=/var/lib/roxira-builder
TINY_ETC=/etc/tinyproxy
SYSTEMD=/etc/systemd/system
NFT="$(command -v nft 2>/dev/null || echo /usr/sbin/nft)"

die() { printf 'apply_root: ERROR: %s\n' "$*" >&2; exit 2; }
info() { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
undo() { printf '   UNDO: %s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --lane-user) LANE_USER="${2?}"; shift ;;
    --builder-user) BUILDER="${2?}"; shift ;;
    --opencode-src) OPENCODE_SRC="${2?}"; shift ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    *docker*) die "refusing '$1': this script never changes docker group membership" ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done
[ -n "$LANE_USER" ] || die "--lane-user is required"
for n in "$LANE_USER" "$BUILDER"; do
  case "$n" in root | '' | *[!a-z0-9_-]*) die "bad user name '$n'" ;; esac
done
[ "$LANE_USER" != "$BUILDER" ] || die "the builder must not be the lane user"
id "$LANE_USER" >/dev/null 2>&1 || die "no such lane user: $LANE_USER"
if [ "$APPLY" = 1 ] && [ "$(id -u)" != 0 ]; then die "--apply needs root (sudo)"; fi

run() { # run a command, or print it in dry-run
  if [ "$APPLY" = 1 ]; then "$@"; else printf '   [dry-run] %s\n' "$*"; fi
}
PUT_CHANGED=0
put() { # SRC DEST MODE OWNER:GROUP  -> install when missing or different (idempotent); sets PUT_CHANGED=1 when it wrote
  local src="$1" dest="$2" mode="$3" own="$4"
  if [ -e "$dest" ] && cmp -s "$src" "$dest"; then info "   unchanged: $dest"; return 0; fi
  if [ "$APPLY" = 1 ]; then
    install -D -o "${own%%:*}" -g "${own##*:}" -m "$mode" "$src" "$dest"
    PUT_CHANGED=1
    info "   installed: $dest"
  else
    printf '   [dry-run] would install %s (%s %s)\n' "$dest" "$mode" "$own"
  fi
}
ensure_dir() { # DIR MODE OWNER:GROUP
  if [ -d "$1" ] && [ "$(stat -c '%a %U:%G' "$1")" = "$2 $3" ]; then info "   ok: $1"; return 0; fi
  run install -d -o "${3%%:*}" -g "${3##*:}" -m "$2" "$1"
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---- 0. dependency check (docker group dependency, tools) --------------------------------------------------
step "0. checks (read only)"
need() { # missing tools are fatal for --apply, a warning in the dry run
  if [ "$APPLY" = 1 ]; then die "missing command: $1"; else info "   WARN: command not found here: $1 (needed for --apply)"; fi
}
for c in python3 useradd setfacl systemd-run systemctl install cmp; do
  command -v "$c" >/dev/null 2>&1 || need "$c"
done
for c in nft runuser; do
  [ -x "/usr/sbin/$c" ] || command -v "$c" >/dev/null 2>&1 || need "$c"
done
DOCKER_MEMBERS="$(getent group docker | cut -d: -f4 || true)"
info "   docker group members (left untouched): ${DOCKER_MEMBERS:-none}"
info "   DEPENDENCY: members of the docker group may be using it (docker exec, rootless tooling, CI). This script"
info "   does not edit any group of any existing user, and never removes anyone from docker."
for g in docker sudo adm lxd root; do
  if id "$BUILDER" >/dev/null 2>&1 && id -nG "$BUILDER" | tr ' ' '\n' | grep -qx "$g"; then
    die "builder user '$BUILDER' is in group '$g': a builder must be unprivileged. Fix it by hand (not done here)."
  fi
done
if [ -z "$OPENCODE_SRC" ]; then
  OPENCODE_SRC="$(readlink -f "/home/$LANE_USER/.local/bin/opencode" 2>/dev/null || true)"
fi
if [ -f "$OPENCODE_SRC" ] && [ "$(head -c4 "$OPENCODE_SRC" | od -An -c | tr -d ' ')" = '177ELF' ]; then
  info "   opencode binary to copy: $OPENCODE_SRC"
else
  info "   WARN: no ELF opencode binary at '${OPENCODE_SRC:-<none>}' (pass --opencode-src FILE); step 4 will be skipped"
  OPENCODE_SRC=""
fi
python3 -I "$HERE/gen_egress.py" --user "$BUILDER" --out-dir "$TMP/gen" --write >/dev/null
python3 -I "$HERE/gen_egress.py" --user nobody --out-dir "$TMP/gen-check" --write >/dev/null

# ---- 1. users ----------------------------------------------------------------------------------------------
step "1. builder user '$BUILDER' (system user, no shell, no password, no groups besides its own)"
if id "$BUILDER" >/dev/null 2>&1; then
  info "   exists: $(id "$BUILDER")"
else
  run useradd --system --user-group --home-dir "$HOME_B" --no-create-home --shell /usr/sbin/nologin "$BUILDER"
fi
undo "userdel $BUILDER   (then: rm -rf $HOME_B $DATA $OPT $ETC $LIBEXEC)"
info "   (no separate publisher user: the publisher stays under the lane user, see docs/ops/BUILDER_EGRESS.md)"

# ---- 2. directories + ACL ----------------------------------------------------------------------------------
step "2. directories (root-owned parents) and the lane user's write ACL on the tasks dir"
ensure_dir "$DATA" 755 root:root
# (not ensure_dir for tasks/: with an ACL the mode bits show the ACL mask, and re-running chmod would reset the mask)
[ -d "$DATA/tasks" ] || run install -d -o root -g root -m 755 "$DATA/tasks"
if [ -d "$DATA/tasks" ] && getfacl -p "$DATA/tasks" 2>/dev/null | grep -qx "user:$LANE_USER:rwx"; then
  info "   ok: ACL u:$LANE_USER:rwx on $DATA/tasks"
else
  run setfacl -m "u:$LANE_USER:rwx" "$DATA/tasks"
fi
ensure_dir "$ETC" 755 root:root
ensure_dir "$LIBEXEC" 755 root:root
ensure_dir "$OPT/bin" 755 root:root
if [ "$APPLY" = 1 ] || id "$BUILDER" >/dev/null 2>&1; then
  for d in "$HOME_B" "$HOME_B/home" "$HOME_B/xdg" "$HOME_B/xdg/config" "$HOME_B/xdg/data" "$HOME_B/xdg/cache" "$HOME_B/xdg/state"; do
    ensure_dir "$d" 700 "$BUILDER:$BUILDER"
  done
else
  info "   [dry-run] would create $HOME_B/{home,xdg/*} (700, owned by $BUILDER) once the user exists"
fi
undo "setfacl -x u:$LANE_USER $DATA/tasks ; rmdir $DATA/tasks $DATA ; rm -rf $HOME_B"

# ---- 3. runner, probe, env ---------------------------------------------------------------------------------
step "3. root-owned runner, probe copies and the fixed builder environment"
put "$HERE/builder_run.py" "$LIBEXEC/builder-run" 755 root:root
put "$HERE/egress_probe.sh" "$LIBEXEC/probe/egress_probe.sh" 755 root:root
put "$HERE/redact.py" "$LIBEXEC/probe/redact.py" 755 root:root
put "$TMP/gen/builder-proxy.env" "$ETC/builder-proxy.env" 644 root:root
undo "rm -rf $LIBEXEC $ETC/builder-proxy.env"
info "   (the wrapper verb 'run-builder' comes from lane_runner/install_root.sh --apply, run it AFTER this script)"

# ---- 4. opencode copy --------------------------------------------------------------------------------------
step "4. opencode binary for the builder (a root-owned copy: the lane user's home is closed to other users)"
if [ -n "$OPENCODE_SRC" ]; then
  put "$OPENCODE_SRC" "$OPT/bin/opencode" 755 root:root
else
  info "   skipped (no binary found); the verb will refuse to run until $OPT/bin/opencode exists"
fi
undo "rm -rf $OPT"
# OpenCode searches with ripgrep. Without it on PATH it tries to download one into the builder's cache from a release host
# that is not on the allowlist, and every search fails ("ripgrep execution failed"). A root-owned package avoids that.
if dpkg -s ripgrep >/dev/null 2>&1; then
  info "   package ripgrep present"
else
  info "   ripgrep: needs network for apt (box proxy on: 'sudo box-proxy on')"
  run apt-get install -y ripgrep
fi
undo "apt-get remove ripgrep   (only if nothing else uses it)"

# ---- 5. tinyproxy ------------------------------------------------------------------------------------------
step "5. tinyproxy: package, our filter/conf, a second instance on 127.0.0.1:$PROXY_PORT"
if dpkg -s tinyproxy >/dev/null 2>&1; then
  info "   package tinyproxy present"
else
  info "   needs network for apt (box proxy on: 'sudo box-proxy on')"
  run apt-get install -y tinyproxy
fi
# The package starts its own default instance (all interfaces, no filter): never leave it running.
if [ "$APPLY" = 1 ]; then
  if systemctl is-enabled tinyproxy.service >/dev/null 2>&1 || systemctl is-active tinyproxy.service >/dev/null 2>&1; then
    systemctl disable --now tinyproxy.service
  fi
else
  info "   [dry-run] would 'systemctl disable --now tinyproxy.service' (the packaged default instance) if it is enabled/active"
fi
PROXY_WAS_ACTIVE=0
if [ "$APPLY" = 1 ] && systemctl is-active --quiet roxira-builder-proxy.service; then PROXY_WAS_ACTIVE=1; fi
PUT_CHANGED=0
put "$TMP/gen/tinyproxy.filter" "$TINY_ETC/roxira-builder.filter" 644 root:root
put "$TMP/gen/tinyproxy.conf" "$TINY_ETC/roxira-builder.conf" 644 root:root
put "$HERE/roxira-builder-proxy.service" "$SYSTEMD/roxira-builder-proxy.service" 644 root:root
# Ubuntu ships an AppArmor profile for /usr/bin/tinyproxy that only allows /etc/tinyproxy/tinyproxy.conf. Without this
# override the second instance dies with: Could not open config file ... (kernel log: apparmor="DENIED"). The packaged
# profile includes <local/tinyproxy>, so we allow read of OUR two files only.
AA_LOCAL=/etc/apparmor.d/local/tinyproxy
if [ -f /etc/apparmor.d/tinyproxy ] && command -v apparmor_parser >/dev/null 2>&1; then
  if grep -qs 'roxira-builder.conf' "$AA_LOCAL"; then
    info "   apparmor local override already present"
  elif [ "$APPLY" = 1 ]; then
    printf '%s\n%s\n%s\n' '# box hub: let the second, allowlist-only tinyproxy instance read its own files' \
      "file r $TINY_ETC/roxira-builder.conf," "file r $TINY_ETC/roxira-builder.filter," >>"$AA_LOCAL"
    apparmor_parser -r /etc/apparmor.d/tinyproxy
    PUT_CHANGED=1
    info "   apparmor override written and profile reloaded"
  else
    info "   [dry-run] would append 2 'file r' lines for roxira-builder.{conf,filter} to $AA_LOCAL and run apparmor_parser -r"
  fi
  undo "remove the roxira-builder lines from $AA_LOCAL ; apparmor_parser -r /etc/apparmor.d/tinyproxy"
fi
if [ "$APPLY" = 1 ]; then
  systemctl daemon-reload
  systemctl enable --now roxira-builder-proxy.service
  # a changed filter/conf/unit only takes effect after a restart (the proxy is not a hot-reload service)
  if [ "$PUT_CHANGED" = 1 ] && [ "$PROXY_WAS_ACTIVE" = 1 ]; then systemctl restart roxira-builder-proxy.service; fi
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    ss -ltn "sport = :$PROXY_PORT" | grep -q LISTEN && break
    sleep 1
  done
  ss -ltn "sport = :$PROXY_PORT" | grep -q LISTEN || die "proxy is not listening on 127.0.0.1:$PROXY_PORT (journalctl -u roxira-builder-proxy); nft lock NOT loaded"
  info "   proxy listening on 127.0.0.1:$PROXY_PORT"
else
  info "   [dry-run] would daemon-reload, enable --now roxira-builder-proxy.service and wait for the port"
fi
undo "systemctl disable --now roxira-builder-proxy ; rm $SYSTEMD/roxira-builder-proxy.service $TINY_ETC/roxira-builder.* ; systemctl daemon-reload   (apt remove tinyproxy only if nothing else uses it)"

# ---- 6. nft lock -------------------------------------------------------------------------------------------
step "6. nftables: table inet roxira_builder (matches ONLY uid $BUILDER), loaded after a syntax check"
if [ "$APPLY" = 1 ]; then
  id "$BUILDER" >/dev/null 2>&1 || die "builder user missing"
  "$NFT" -c -f "$TMP/gen/roxira_builder.nft"
  info "   nft -c: syntax OK"
else
  if unshare -Urn "$NFT" -c -f "$TMP/gen-check/roxira_builder.nft" >/dev/null 2>&1; then
    info "   syntax check in a throwaway user namespace (user 'nobody'): OK"
  else
    info "   syntax check not possible without root here; --apply runs 'nft -c' before loading"
  fi
fi
put "$TMP/gen/roxira_builder.nft" "$ETC/roxira_builder.nft" 644 root:root
put "$HERE/roxira-builder-nft.service" "$SYSTEMD/roxira-builder-nft.service" 644 root:root
if [ "$APPLY" = 1 ]; then
  systemctl daemon-reload
  systemctl enable roxira-builder-nft.service
  # never 'restart': stop deletes the table and leaves a window with no lock. 'reload' runs one atomic 'nft -f'.
  if systemctl is-active --quiet roxira-builder-nft.service; then
    systemctl reload roxira-builder-nft.service
  else
    systemctl start roxira-builder-nft.service
  fi
  "$NFT" list table inet roxira_builder >/dev/null
  info "   table loaded and persistent (roxira-builder-nft.service)"
else
  info "   [dry-run] would enable + start roxira-builder-nft.service (loads the table, reloads it at boot)"
fi
undo "systemctl disable --now roxira-builder-nft ; nft delete table inet roxira_builder ; rm $SYSTEMD/roxira-builder-nft.service $ETC/roxira_builder.nft"

# ---- 7. final checks ---------------------------------------------------------------------------------------
step "7. final checks"
if id "$BUILDER" >/dev/null 2>&1; then
  info "   $BUILDER groups: $(id -nG "$BUILDER")"
  if id -nG "$BUILDER" | tr ' ' '\n' | grep -Eqx 'docker|sudo|adm|lxd'; then die "builder is in a privileged group"; fi
fi
info "   docker group members now (unchanged by this script): $(getent group docker | cut -d: -f4)"
info "   next: sudo bash $(dirname "$HERE")/lane_runner/install_root.sh --lane-user $LANE_USER --apply   (adds the run-builder verb)"
info "         then the probe: docs/ops/BUILDER_EGRESS.md, section "Probe plan""
if [ "$APPLY" = 0 ]; then info "
Nothing changed (dry run). Re-run with --apply as root."; fi
