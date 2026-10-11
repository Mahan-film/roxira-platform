#!/usr/bin/env bash
# Restrict origin ports 80/443 to Cloudflare's published IP ranges.
#
# Docker publishes 80/443 with DNAT, so those packets traverse FORWARD ->
# DOCKER-USER and never hit ufw's INPUT rules. We therefore enforce the
# allowlist in the DOCKER-USER chain (chain ROXIRA-CF) and mirror it in ufw
# (covers IPv6 via docker-proxy and any non-Docker listener).
#
# Usage (run as root on the origin server):
#   cloudflare_only.sh               dry run: fetch ranges, print every change
#   cloudflare_only.sh --apply       apply (idempotent; safe to re-run weekly)
#   cloudflare_only.sh --rollback    remove our rules, re-open 80/443 in ufw
#   cloudflare_only.sh --status      show current state
# Options:
#   --no-ufw       only touch iptables/ip6tables DOCKER-USER
#   --offline      do not fetch; use the cached ranges in $CACHE_DIR (boot path)
#
# NOT touched on purpose (owner's VPN / admin access): ufw 22/tcp, 8443/tcp
# (xray), 2053/2096 (x-ui), 60000:61000/udp, 8005/tcp. No existing rule other
# than the generic "80/tcp" and "443/tcp" allow-from-anywhere is removed.
set -euo pipefail

CHAIN="ROXIRA-CF"
COMMENT="cf-origin"
CACHE_DIR="${CF_CACHE_DIR:-/var/lib/roxira}"
PORTS=(80 443)

MODE="dry"
USE_UFW=1
OFFLINE=0
for arg in "$@"; do
  case "$arg" in
    --apply) MODE="apply" ;;
    --rollback) MODE="rollback" ;;
    --status) MODE="status" ;;
    --no-ufw) USE_UFW=0 ;;
    --offline) OFFLINE=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

DRY=1
[[ "$MODE" == "apply" || "$MODE" == "rollback" ]] && DRY=0

log() { echo "[cf-firewall] $*"; }
# run: execute, or only print in dry-run mode
run() {
  if (( DRY )); then echo "  + $*"; else "$@"; fi
}

if [[ "$MODE" != "dry" && $EUID -ne 0 ]]; then
  echo "must run as root" >&2; exit 1
fi
if [[ "$MODE" == "dry" && $EUID -ne 0 ]]; then
  log "not root: dry run will skip reading live firewall state"
fi

have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- ranges
# Cloudflare publishes ~15 IPv4 and ~7 IPv6 ranges. A truncated or garbled
# download must never become the allowlist (the chain ends in DROP).
MIN_V4="${CF_MIN_V4:-10}"
MIN_V6="${CF_MIN_V6:-5}"

valid_v4_cidr() { # $1 = a.b.c.d/n
  local ip="${1%/*}" len="${1#*/}" o
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]] || return 1
  (( 10#$len <= 32 )) || return 1
  local IFS=.
  for o in $ip; do (( 10#$o <= 255 )) || return 1; done
}
valid_v6_cidr() { # $1 = addr/n
  local len="${1#*/}"
  [[ "$1" =~ ^[0-9a-fA-F:]+:[0-9a-fA-F:]*/[0-9]{1,3}$ ]] || return 1
  (( 10#$len <= 128 )) || return 1
}
# validate_ranges <4|6> <list>: every non-empty line must be valid CIDR
validate_family() {
  local fam="$1" list="$2" n=0 min r
  while read -r r; do
    [[ -z "$r" ]] && continue
    if [[ "$fam" == 4 ]]; then valid_v4_cidr "$r" || { echo "invalid IPv4 CIDR: $r" >&2; return 1; }
    else valid_v6_cidr "$r" || { echo "invalid IPv6 CIDR: $r" >&2; return 1; }; fi
    n=$((n + 1))
  done <<<"$list"
  min=$MIN_V4; [[ "$fam" == 6 ]] && min=$MIN_V6
  if (( n < min )); then echo "refusing: only $n IPv$fam ranges (need >= $min)" >&2; return 1; fi
}
validate_ranges() { validate_family 4 "$V4" && validate_family 6 "$V6"; }

fetch_ranges() {
  mkdir -p "$CACHE_DIR" 2>/dev/null || true
  if (( OFFLINE )); then
    [[ -s "$CACHE_DIR/cloudflare-ips-v4" ]] || { echo "no cached ranges in $CACHE_DIR" >&2; exit 1; }
    V4="$(cat "$CACHE_DIR/cloudflare-ips-v4")"
    V6="$(cat "$CACHE_DIR/cloudflare-ips-v6" 2>/dev/null || true)"
    validate_ranges || { echo "cached ranges failed validation; nothing changed" >&2; exit 1; }
    return
  fi
  local v4 v6
  if v4="$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4)" &&
     v6="$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6)"; then
    # keep only CIDR-shaped lines, then validate strictly (any bad line aborts)
    V4="$(tr -d '\r' <<<"$v4" | grep -E '^[0-9.]+/[0-9]+$' || true)"
    V6="$(tr -d '\r' <<<"$v6" | grep -E '^[0-9a-fA-F:]+/[0-9]+$' || true)"
    validate_ranges || { echo "downloaded ranges failed validation; nothing changed" >&2; exit 1; }
    if (( DRY == 0 )); then
      printf '%s\n' "$V4" >"$CACHE_DIR/cloudflare-ips-v4"
      printf '%s\n' "$V6" >"$CACHE_DIR/cloudflare-ips-v6"
    fi
  else
    echo "could not fetch Cloudflare ranges; nothing changed" >&2; exit 1
  fi
}

# ------------------------------------------------------------- iptables
# Build the chain with a single iptables-restore --noflush transaction so there
# is no window with an empty chain.
restore_chain() { # $1 = iptables-restore binary, $2 = family (4|6), stdin = ranges
  local bin="$1" fam="$2" ranges rules
  ranges="$(cat)"
  rules="*filter"$'\n'":${CHAIN} - [0:0]"$'\n'"-F ${CHAIN}"$'\n'
  if [[ "$fam" == "4" ]]; then
    # containers/host talking to their own published ports, loopback
    rules+="-A ${CHAIN} -s 127.0.0.0/8 -j RETURN"$'\n'
    rules+="-A ${CHAIN} -s 172.16.0.0/12 -j RETURN"$'\n'
  else
    rules+="-A ${CHAIN} -s ::1/128 -j RETURN"$'\n'
    rules+="-A ${CHAIN} -s fe80::/10 -j RETURN"$'\n'
  fi
  local r
  while read -r r; do
    [[ -n "$r" ]] && rules+="-A ${CHAIN} -s ${r} -j RETURN"$'\n'
  done <<<"$ranges"
  rules+="-A ${CHAIN} -j DROP"$'\n'"COMMIT"$'\n'
  if (( DRY )); then
    echo "  + ${bin} --noflush  <<EOF"; while IFS= read -r line; do echo "    $line"; done <<<"$rules"; echo "    EOF"
  else
    "$bin" --noflush <<<"$rules"
  fi
}

ensure_jumps() { # $1 = iptables binary
  local ipt="$1" p
  for p in "${PORTS[@]}"; do
    if (( DRY == 0 )) && "$ipt" -C DOCKER-USER -p tcp -m conntrack --ctorigdstport "$p" --ctdir ORIGINAL -j "$CHAIN" 2>/dev/null; then
      log "$ipt: jump for port $p already present"
    else
      run "$ipt" -I DOCKER-USER 1 -p tcp -m conntrack --ctorigdstport "$p" --ctdir ORIGINAL -j "$CHAIN"
    fi
  done
}

remove_jumps() { # $1 = iptables binary
  local ipt="$1" p
  for p in "${PORTS[@]}"; do
    while "$ipt" -C DOCKER-USER -p tcp -m conntrack --ctorigdstport "$p" --ctdir ORIGINAL -j "$CHAIN" 2>/dev/null; do
      run "$ipt" -D DOCKER-USER -p tcp -m conntrack --ctorigdstport "$p" --ctdir ORIGINAL -j "$CHAIN"
    done
  done
}

apply_iptables() { # $1 = fam (4|6)
  local fam="$1" ipt="iptables" res="iptables-restore" ranges="$V4"
  [[ "$fam" == "6" ]] && { ipt="ip6tables"; res="ip6tables-restore"; ranges="$V6"; }
  have "$ipt" || { log "$ipt not installed, skipping IPv$fam"; return; }
  if (( EUID == 0 )) && ! "$ipt" -nL DOCKER-USER >/dev/null 2>&1; then
    log "$ipt: no DOCKER-USER chain (Docker not managing IPv$fam), skipping"
    return
  fi
  [[ -n "$ranges" ]] || { log "no IPv$fam ranges, skipping"; return; }
  log "IPv$fam: loading $(wc -l <<<"$ranges") Cloudflare ranges into $CHAIN"
  restore_chain "$res" "$fam" <<<"$ranges"
  ensure_jumps "$ipt"
}

rollback_iptables() {
  local ipt
  for ipt in iptables ip6tables; do
    have "$ipt" || continue
    "$ipt" -nL DOCKER-USER >/dev/null 2>&1 || continue
    remove_jumps "$ipt"
    if "$ipt" -nL "$CHAIN" >/dev/null 2>&1; then
      run "$ipt" -F "$CHAIN"
      run "$ipt" -X "$CHAIN"
    fi
  done
}

# ------------------------------------------------------------------ ufw
ufw_tagged_sources() {
  ufw status | grep "# ${COMMENT}" | grep -oE '[0-9a-fA-F:.]+/[0-9]+' | sort -u || true
}

apply_ufw() {
  have ufw || { log "ufw not installed, skipping"; return; }
  local all r
  all="$(printf '%s\n%s\n' "$V4" "$V6" | grep -v '^$' | sort -u)"
  log "ufw: allowing 80,443/tcp from $(wc -l <<<"$all") Cloudflare ranges"
  while read -r r; do
    run ufw allow proto tcp from "$r" to any port 80,443 comment "$COMMENT"
  done <<<"$all"
  # drop tagged rules whose range Cloudflare no longer publishes
  if (( EUID == 0 )); then
    local old
    while read -r old; do
      [[ -z "$old" ]] && continue
      grep -qxF "$old" <<<"$all" || run ufw delete allow proto tcp from "$old" to any port 80,443
    done < <(ufw_tagged_sources)
  fi
  # only now remove the world-open rules (so there is never a gap)
  if (( EUID == 0 )); then
    local port
    for port in 80 443; do
      if ufw status | grep -qE "^${port}/tcp +ALLOW +Anywhere( |$)"; then
        run ufw delete allow "${port}/tcp"
      fi
    done
  else
    echo "  + ufw delete allow 80/tcp   (if present)"
    echo "  + ufw delete allow 443/tcp  (if present)"
  fi
}

rollback_ufw() {
  have ufw || return
  run ufw allow 80/tcp
  run ufw allow 443/tcp
  local old
  while read -r old; do
    [[ -z "$old" ]] && continue
    run ufw delete allow proto tcp from "$old" to any port 80,443
  done < <(ufw_tagged_sources)
}

show_status() {
  for ipt in iptables ip6tables; do
    have "$ipt" || continue
    echo "== $ipt DOCKER-USER"; "$ipt" -nL DOCKER-USER --line-numbers 2>&1 | head -20
    echo "== $ipt $CHAIN (first/last rules)"; "$ipt" -nL "$CHAIN" 2>&1 | sed -n '1,5p;$p'
  done
  have ufw && { echo "== ufw (ports of interest)"; ufw status | grep -E '^(22|80|443|8443|80,443)' | head -40; }
}

# ----------------------------------------------------------------- main
case "$MODE" in
  status) show_status; exit 0 ;;
  rollback)
    log "ROLLBACK: removing $CHAIN and re-opening 80/443 in ufw"
    (( USE_UFW )) && rollback_ufw
    rollback_iptables
    log "done"; exit 0 ;;
esac

fetch_ranges
(( DRY )) && log "DRY RUN (nothing is changed). Re-run with --apply to execute."
apply_iptables 4
apply_iptables 6
(( USE_UFW )) && apply_ufw
log "untouched: ssh 22, xray 8443, x-ui 2053/2096"
if (( DRY )); then log "dry run finished"; else log "applied"; fi
exit 0
