#!/usr/bin/env bash
# Update the Xray binary with a checksum gate and automatic rollback. Dry-run by default.
# Usage: update_xray.sh --version v25.9.0 (--sha256 HEX | --fetch-dgst) [--asset NAME] [--apply]
#        update_xray.sh --rollback [--apply]     restore the binary saved by the last update
# Flow (--apply): download -> verify sha256 -> test the CURRENT config with the NEW binary (nothing touched
#   if that fails) -> save the old binary to $ETC/prev -> install -> restart -> wait for the service and
#   path-1 port -> on any failure restore the old binary and restart it.
# --sha256 is the safe choice (copy it from the release page). --fetch-dgst trusts the .dgst file next to
# the zip, which only detects a corrupted download, not a tampered release.
# Env: XRAY_INSTALL_DIR (/usr/local/bin), XRAY_SHARE_DIR (/usr/local/share/xray), XRAY_DOWNLOAD_BASE,
#      ROXIRA_VPN_WAIT (seconds to wait for the service after restart, default 10).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
BIN_DIR="${XRAY_INSTALL_DIR:-/usr/local/bin}"
SHARE_DIR="${XRAY_SHARE_DIR:-/usr/local/share/xray}"
BASE="${XRAY_DOWNLOAD_BASE:-https://github.com/XTLS/Xray-core/releases/download}"
version="" sha="" fetch=0 asset="" apply=0 rollback=0
while [ $# -gt 0 ]; do case "$1" in
  --apply) apply=1 ;; --rollback) rollback=1 ;; --fetch-dgst) fetch=1 ;;
  --version) version="$2"; shift ;; --sha256) sha="$2"; shift ;; --asset) asset="$2"; shift ;;
  *) die "unknown arg: $1" ;; esac; shift; done
PREV="$ETC/prev"

restore_prev() { [ -x "$PREV/xray" ] || die "no saved binary in $PREV"
  install -m 755 "$PREV/xray" "$BIN_DIR/xray"
  for g in geoip.dat geosite.dat; do [ -f "$PREV/$g" ] && install -m 644 "$PREV/$g" "$SHARE_DIR/$g"; done
  return 0; }

load_settings
cur="$("$BIN_DIR/xray" version 2>/dev/null | head -1 || true)"

if [ "$rollback" = 1 ]; then
  log "plan: restore previous Xray from $PREV ($(cat "$PREV/VERSION" 2>/dev/null || echo unknown)); current: ${cur:-unknown}"
  [ "$apply" = 1 ] || { log "dry-run: nothing changed. Re-run with --apply."; exit 0; }
  need_root; restore_prev; restart_xray
  wait_up || die "service did not come back after rollback; see: journalctl -u xray-vpn -n 20"
  log "rolled back to $(cat "$PREV/VERSION" 2>/dev/null || echo previous binary)"; exit 0
fi

[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--version vX.Y.Z is required (no implicit latest)"
[ -n "$asset" ] || asset="$(xray_asset)"
[[ "$asset" =~ ^[A-Za-z0-9._-]+\.zip$ ]] || die "invalid asset name"
[ -z "$sha" ] || [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || die "--sha256 must be 64 lowercase hex chars"
[ -n "$sha" ] || [ "$fetch" = 1 ] || die "give --sha256 HEX (preferred) or --fetch-dgst"
url="$BASE/$version/$asset"
log "plan: $cur -> $version ($asset) from $url"
if [ -n "$sha" ]; then src="given --sha256"; else src="from $asset.dgst (integrity only)"; fi
log "      checksum: $src; old binary kept in $PREV for --rollback"
[ "$apply" = 1 ] || { log "dry-run: nothing changed. Re-run with --apply."; exit 0; }
need_root
for t in curl unzip; do command -v "$t" >/dev/null || die "missing tool: $t"; done
tmp="$(mktemp -d "${TMPDIR:-/tmp}/xrayupd.XXXXXX")"; trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/x.zip" "$url"
if [ -z "$sha" ]; then
  curl -fsSL -o "$tmp/x.dgst" "$url.dgst"
  sha="$(sed -n 's/^SHA2-256= *//p' "$tmp/x.dgst" | head -1)"
  [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || die "could not read SHA2-256 from $asset.dgst"
fi
got="$(sha256_of "$tmp/x.zip")"
[ "$got" = "$sha" ] || die "SHA256 mismatch for $asset (expected $sha, got $got); nothing changed"
unzip -q -o "$tmp/x.zip" xray geoip.dat geosite.dat -d "$tmp/out"
chmod +x "$tmp/out/xray"
XRAY_LOCATION_ASSET="$tmp/out" "$tmp/out/xray" run -test -c "$ETC/config.json" >/dev/null 2>&1 \
  || die "new Xray rejects the current config; nothing changed"

install -d -m 700 "$PREV"
install -m 755 "$BIN_DIR/xray" "$PREV/xray"
for g in geoip.dat geosite.dat; do [ -f "$SHARE_DIR/$g" ] && install -m 644 "$SHARE_DIR/$g" "$PREV/$g"; done
printf '%s\n' "$cur" >"$PREV/VERSION"
install -d -m 755 "$SHARE_DIR"
install -m 755 "$tmp/out/xray" "$BIN_DIR/xray"
install -m 644 "$tmp/out/geoip.dat" "$tmp/out/geosite.dat" "$SHARE_DIR/"
restart_xray
if wait_up; then log "updated to: $("$BIN_DIR/xray" version | head -1). Roll back with: $0 --rollback --apply"; exit 0; fi
log "new version failed health check; restoring previous binary"
restore_prev; restart_xray
wait_up || die "ROLLBACK ALSO FAILED; see: journalctl -u xray-vpn -n 20"
die "update to $version rolled back automatically; the service runs the previous version again"
