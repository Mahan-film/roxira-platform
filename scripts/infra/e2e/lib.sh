#!/usr/bin/env bash
# Shared helpers for the Gate 3 app E2E sandbox (docs/strategy/FACTORY_V2_2026-10-22.md section 3).
# Sourced by sandbox_up.sh / sandbox_down.sh / mkuser.sh / run_app_e2e.sh; not meant to be run on its own.
#
# Safety contract: every docker object this tooling creates is named rxtest_* (containers, network) or
# rxtest-*:<sha> (images). Nothing here ever stops, removes, restarts or writes to a production container,
# volume or network. The only prod access is the optional READ-ONLY `pg_dump --schema-only` (see
# sandbox_up.sh; set RX_SCHEMA_FILE to avoid even that).

# shellcheck disable=SC2034  # variables are consumed by the scripts that source this file
E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RX_REPO="${RX_E2E_REPO:-$(cd "$E2E_DIR" && git rev-parse --show-toplevel)}"

RX_NET=rxtest_net
RX_PG=rxtest_pg
RX_REDIS=rxtest_redis
RX_BE=rxtest_be
RX_FE=rxtest_fe
RX_PROXY=rxtest_proxy
RX_CONTAINERS=("$RX_PROXY" "$RX_FE" "$RX_BE" "$RX_REDIS" "$RX_PG")

# Work dir: extracted sources and session files. The session files hold short-lived (3h) tokens signed with
# a random secret that exists only inside the sandbox backend container; the dir is private (mode 700).
RX_WORK="${RX_E2E_WORK:-${TMPDIR:-/tmp}/rxtest}"
RX_OUT="$RX_WORK/out"

# Ports that belong to live services (AGENTS.md section 7). The sandbox must never bind these.
RX_RESERVED_PORTS=" 80 443 8000 3000 3001 3002 5432 6432 6379 6333 8888 8005 4000 4001 2053 2096 8443 11111 62789 "

rx_log() { printf '[rxtest] %s\n' "$*" >&2; }
rx_die() { printf '[rxtest] ERROR: %s\n' "$*" >&2; exit 1; }

rx_need() { command -v "$1" >/dev/null 2>&1 || rx_die "missing required command: $1"; }

# Remove ONLY the sandbox's own containers and network (fixed rxtest_* names). Idempotent, never fails.
rx_cleanup() {
  local c
  for c in "${RX_CONTAINERS[@]}"; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  docker network rm "$RX_NET" >/dev/null 2>&1 || true
}

# True when something listens on TCP port $1 on this host.
rx_port_in_use() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -tuln 2>/dev/null | awk '{print $5}' | grep -Eq "[:.]${p}\$"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

# Resolve a ref to a full commit sha in $RX_REPO, fetching it from origin when it is not known locally.
rx_resolve_ref() {
  local ref="$1" sha=""
  sha="$(git -C "$RX_REPO" rev-parse --verify --quiet "${ref}^{commit}" 2>/dev/null)" ||
    sha="$(git -C "$RX_REPO" rev-parse --verify --quiet "origin/${ref}^{commit}" 2>/dev/null)" || sha=""
  if [ -z "$sha" ]; then
    git -C "$RX_REPO" fetch -q origin "$ref" 2>/dev/null || true
    sha="$(git -C "$RX_REPO" rev-parse --verify --quiet 'FETCH_HEAD^{commit}' 2>/dev/null)" || sha=""
  fi
  [ -n "$sha" ] || return 1
  printf '%s\n' "$sha"
}

rx_rand_hex() { # $1 = number of random bytes
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'
  fi
}
