#!/usr/bin/env bash
# Create a test tenant and its OWNER user inside the running sandbox and write a browser session file.
#
#   mkuser.sh <label>
#
# <label> is [a-z0-9-]+ (e.g. seeded, import-chromium). Writes $RX_OUT/session.<label>.json in the format the
# frontend keeps in localStorage under "roxira.auth.session", and prints three lines on stdout:
#   SESSION_FILE=<path>
#   TENANT_ID=<uuid>
#   USER_ID=<uuid>
# The JWT is signed INSIDE the backend container with its random JWT_SECRET (read from the container
# environment there); the secret never reaches this shell or the output. Re-running with the same label
# creates a fresh tenant/user and overwrites the file (idempotent from the caller's view).
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

LABEL="${1:-}"
[[ "$LABEL" =~ ^[a-z0-9][a-z0-9-]*$ ]] || rx_die "usage: mkuser.sh <label>   (label must match [a-z0-9-]+)"
rx_need docker
[ "$(docker inspect -f '{{.State.Running}}' "$RX_BE" 2>/dev/null || true)" = true ] ||
  rx_die "$RX_BE is not running; run sandbox_up.sh first"

umask 077
mkdir -p "$RX_OUT"
chmod 700 "$RX_WORK" "$RX_OUT"

psql_q() { docker exec -i "$RX_PG" psql -U rx -d rxtest -Atq -v ON_ERROR_STOP=1 "$@"; }

TENANT="$(psql_q -c "select gen_random_uuid()" | head -1)"
SUFFIX="$(rx_rand_hex 3)"
PHONE="$(printf '09%09d' $(((RANDOM * 32768 + RANDOM) % 1000000000)))"
psql_q -c "insert into tenants (id, name, slug) values ('$TENANT', 'e2e-$LABEL', 'e2e-$LABEL-$SUFFIX')" >/dev/null
USER_ID="$(psql_q -c "insert into users (phone, \"displayName\", role, \"serviceDomain\", tenant_id, tenant_role) values ('$PHONE', 'E2E $LABEL', 'ADMIN', 'ROXIRA', '$TENANT', 'OWNER') returning id" | head -1)"
[ -n "$USER_ID" ] || rx_die "could not create user for $LABEL"

OUT="$RX_OUT/session.$LABEL.json"
# shellcheck disable=SC2016  # the JS below is single-quoted on purpose; it runs inside the container
docker exec -w /app -e "T=$TENANT" -e "U=$USER_ID" -e "P=$PHONE" -e "L=$LABEL" "$RX_BE" node -e '
const e = process.env;
const accessToken = require("jsonwebtoken").sign(
  { sub: e.U, phone: e.P, role: "ADMIN", domain: "ROXIRA", tenantId: e.T, tenantRole: "OWNER" },
  e.JWT_SECRET,
  { expiresIn: "3h" },
);
console.log(JSON.stringify({
  accessToken,
  tokenType: "Bearer",
  user: { id: e.U, phone: e.P, displayName: "E2E " + e.L, email: null, role: "ADMIN",
          serviceDomain: "ROXIRA", createdAt: new Date().toISOString() },
  expiresAt: Date.now() + 3 * 3600e3,
}));
' >"$OUT.tmp"
mv "$OUT.tmp" "$OUT"

rx_log "user for '$LABEL': tenant=$TENANT"
printf 'SESSION_FILE=%s\nTENANT_ID=%s\nUSER_ID=%s\n' "$OUT" "$TENANT" "$USER_ID"
