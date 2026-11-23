#!/usr/bin/env bash
# roxira-root installer (ROOT, owner only, once; issue #1315). Installs a FROZEN copy of the fixed-verb root runner.
#   sudo bash install_root.sh              dry run (default): prints every step and the sudoers drop-in, changes nothing
#   sudo bash install_root.sh --dry-run    same
#   sudo bash install_root.sh --apply      install (idempotent; re-running it is the ONLY way to update the frozen copy)
#   sudo bash install_root.sh --undo --apply   remove everything this script installed
# Installs, all root:root:
#   /usr/local/lib/roxira-root/roxira-root   0755  the frozen script (copy of ./roxira-root, syntax-checked)
#   /usr/local/lib/roxira-root/SHA256SUMS    0644  hash of the frozen script
#   /usr/local/sbin/roxira-root              0755  two-line stub that execs the frozen script (the sudoers target)
#   /etc/sudoers.d/roxira-root               0440  users mahan and mahanfilms: NOPASSWD for that stub ONLY (visudo-checked)
# Run it from a checkout you have reviewed (the PR); it prints the sha256 of what it installs.
# Undo: rm /etc/sudoers.d/roxira-root /usr/local/sbin/roxira-root; rm -r /usr/local/lib/roxira-root
set -euo pipefail

APPLY=0 UNDO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --undo) UNDO=1 ;;
    -h | --help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/roxira-root"
LIBDIR=/usr/local/lib/roxira-root
FROZEN=$LIBDIR/roxira-root
STUB=/usr/local/sbin/roxira-root
SUDOERS=/etc/sudoers.d/roxira-root
USERS=(mahan mahanfilms)

STUB_BODY='#!/bin/bash -p
# roxira-root stub: installed by install_root.sh. Only forwards to the frozen, root-owned script.
exec /usr/local/lib/roxira-root/roxira-root "$@"'
SUDOERS_BODY="# Installed by scripts/ops/ci_box/root_runner/install_root.sh. Passwordless path to ONE fixed-verb wrapper, nothing else.
# Undo: rm $SUDOERS
Defaults!$STUB !setenv"
for u in "${USERS[@]}"; do SUDOERS_BODY+=$'\n'"$u ALL=(root) NOPASSWD: $STUB"; done

step() { printf '\n== %s\n' "$*"; }
undo_line() { printf '   UNDO: %s\n' "$*"; }
[ -f "$SRC" ] || { echo "missing $SRC" >&2; exit 2; }
HASH="$(sha256sum "$SRC" | cut -d' ' -f1)"

if [ "$UNDO" = 1 ]; then
  step "remove (sudoers first, so the passwordless path disappears before the files)"
  if [ "$APPLY" = 0 ]; then
    echo "[dry-run] would remove $SUDOERS $STUB and $LIBDIR"
    echo "Nothing changed. Add --apply (as root) to remove."
    exit 0
  fi
  [ "$(id -u)" = 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
  rm -f "$SUDOERS" "$STUB"
  rm -rf "$LIBDIR"
  echo "removed $SUDOERS $STUB $LIBDIR"
  exit 0
fi

step "1 frozen script ($FROZEN), sha256 $HASH"
undo_line "rm -r $LIBDIR"
step "2 stub ($STUB)"
printf '%s\n' "$STUB_BODY" | sed 's/^/   | /'
undo_line "rm $STUB"
step "3 sudoers drop-in ($SUDOERS, 0440, checked with visudo -cf)"
printf '%s\n' "$SUDOERS_BODY" | sed 's/^/   | /'
undo_line "rm $SUDOERS"

if [ "$APPLY" = 0 ]; then
  echo
  echo "[dry-run] Nothing changed. Re-run with --apply as root to install."
  exit 0
fi

[ "$(id -u)" = 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
for u in "${USERS[@]}"; do id "$u" >/dev/null 2>&1 || { echo "no such user: $u" >&2; exit 2; }; done
for d in /usr /usr/local /usr/local/lib /usr/local/sbin /etc/sudoers.d; do # the places we write must not be writable by others
  [ "$(stat -c %u "$d")" = 0 ] && [ -z "$(find "$d" -maxdepth 0 -perm /022)" ] || { echo "refusing: $d is not root-owned or is group/world writable" >&2; exit 1; }
done

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
cp "$SRC" "$T/roxira-root" # one read of the source; everything below installs from this root-owned copy
bash -n "$T/roxira-root"
[ "$(sha256sum "$T/roxira-root" | cut -d' ' -f1)" = "$HASH" ] || { echo "source changed while installing" >&2; exit 1; }
printf '%s\n' "$STUB_BODY" >"$T/stub"
bash -n "$T/stub"
printf '%s\n' "$SUDOERS_BODY" >"$T/sudoers"
visudo -cf "$T/sudoers"

install -d -o root -g root -m 755 "$LIBDIR"
install -o root -g root -m 755 "$T/roxira-root" "$FROZEN"
(cd "$LIBDIR" && sha256sum roxira-root >SHA256SUMS && chmod 644 SHA256SUMS)
install -o root -g root -m 755 "$T/stub" "$STUB"
install -o root -g root -m 440 "$T/sudoers" "$SUDOERS" # last: the grant only appears once the files exist
echo "installed $FROZEN, $STUB, $SUDOERS (sha256 $HASH)"
echo "check (as mahan): sudo -n $STUB box-status"
echo "undo: sudo bash $0 --undo --apply"
