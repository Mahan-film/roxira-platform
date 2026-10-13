#!/usr/bin/env bash
# OWNER POLICY (2026-10-13): lawyers pay like every user. Use this ONLY for lawyers who work
# for/with Roxira, on the owner's explicit decision. Never as a public free-VIP programme.
# Owner-run: grant VIP to ONE phone AFTER you verified the lawyer's licence on the bar association
# (کانون وکلا) website. Never run from automation: the grant is always a manual owner decision.
#
# Mechanism (same one the app reads in smartjudge_module._entitlement_tier): a row in the Postgres table
# user_entitlements, key = sha256("smartjudge:<phone>")[:16], plan_type "VIP", status "VIP_ACTIVE".
# No container restart and no env change is needed (the app caches tiers for 60 s).
#
# Usage:
#   scripts/ops/grant_lawyer_vip.sh 09121234567            # DRY RUN: prints what it would do
#   scripts/ops/grant_lawyer_vip.sh 09121234567 --apply    # writes the row (default 30 days)
#   scripts/ops/grant_lawyer_vip.sh 09121234567 --apply --days 60
#   scripts/ops/grant_lawyer_vip.sh 09121234567 --revoke   # expires the row (dry run unless --apply)
#
# The phone is normalised like the app does (09xxxxxxxxx). Only the hashed ref is printed.
# Look pending requests up first: they are kept 90 days in the app KV (key lawyer_pilot:req:<id>,
# status PENDING_REVIEW); nothing about them grants access.
set -euo pipefail

SSH_HOST="${DEPLOY_SSH_HOST:-${ROXIRA_HOST:-roxira-prod}}"
PG_CONTAINER="${ROXIRA_PG_CONTAINER:-roxira_postgres_prod}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)

die() { echo "ERROR: $*" >&2; exit 1; }

PHONE_RAW="${1:-}"
[ -n "$PHONE_RAW" ] || { sed -n '2,17p' "$0" >&2; exit 2; }
shift || true
APPLY=0; REVOKE=0; DAYS=30
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --revoke) REVOKE=1 ;;
    --days) shift; DAYS="${1:-}" ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done
[[ "$DAYS" =~ ^[0-9]{1,3}$ ]] && [ "$DAYS" -ge 1 ] || die "--days must be 1..999"

PHONE="$(python3 -I - "$PHONE_RAW" <<'PY'
import sys
t = sys.argv[1].translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))
t = "".join(ch for ch in t if ch.isdigit())
if t.startswith("0098"): t = "0" + t[4:]
elif t.startswith("98") and len(t) == 12: t = "0" + t[2:]
elif len(t) == 10 and t.startswith("9"): t = "0" + t
if not (len(t) == 11 and t.startswith("09")):
    sys.exit("invalid Iranian mobile number")
print(t)
PY
)" || die "invalid phone"
REF="$(printf 'smartjudge:%s' "$PHONE" | python3 -I -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest()[:16])')"

if [ "$REVOKE" -eq 1 ]; then
  SQL="UPDATE user_entitlements SET expires_at = now(), status = 'revoked', updated_at = now() WHERE user_ref = '$REF';"
  ACTION="revoke"
else
  SQL="INSERT INTO user_entitlements (user_ref, plan_type, status, activated_at, expires_at, updated_at) VALUES ('$REF', 'VIP', 'VIP_ACTIVE', now(), now() + interval '$DAYS days', now()) ON CONFLICT (user_ref) DO UPDATE SET plan_type = 'VIP', status = 'VIP_ACTIVE', activated_at = now(), expires_at = now() + interval '$DAYS days', updated_at = now();"
  ACTION="grant VIP for $DAYS days"
fi

echo "phone ref : $REF"
echo "action    : $ACTION"
echo "target    : $SSH_HOST container $PG_CONTAINER"
if [ "$APPLY" -ne 1 ]; then
  echo "DRY RUN (nothing written). Confirm the licence on the bar association site, then add --apply."
  exit 0
fi

# the SQL travels over ssh stdin; psql reads credentials from the container's own environment
printf '%s\n' "$SQL" | ssh "${SSH_OPTS[@]}" "$SSH_HOST" \
  "docker exec -i $PG_CONTAINER sh -c 'psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"'"
echo "done. The app sees the new tier within about 60 seconds."
