#!/usr/bin/env bash
# llm_spend.sh - show today's OpenRouter spend and remaining limit per key.
#
# Read-only. Never prints a key (only the env var NAME). Keys are passed to curl
# through stdin config (-K -), so they never appear in `ps` output either.
#
# Which keys are checked: OPENROUTER_API_KEY plus any env var named
# OPENROUTER_API_KEY_<SUFFIX> (e.g. OPENROUTER_API_KEY_DEV, OPENROUTER_API_KEY_PROD).
# Source: ~/Secrets/roxira/roxira.env (override with ROXIRA_ENV_FILE).
#
# Endpoints (OpenRouter docs): GET /api/v1/key (per-key usage/limit),
# GET /api/v1/credits (account-wide purchased vs used).
#
# Usage: scripts/dev/llm_spend.sh [--json]
set -euo pipefail

ENV_FILE="${ROXIRA_ENV_FILE:-$HOME/Secrets/roxira/roxira.env}"
BASE="${OPENROUTER_BASE:-https://openrouter.ai/api/v1}"
JSON=0; [ "${1:-}" = "--json" ] && JSON=1

if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

# Collect key variable NAMES (never values).
names=$(env | sed 's/=.*//' | grep -E '^OPENROUTER_API_KEY(_[A-Z0-9_]+)?$' | sort -u || true)
if [ -z "$names" ]; then echo "No OPENROUTER_API_KEY* variable found (looked in $ENV_FILE)." >&2; exit 2; fi

fetch() { # $1 = var name, $2 = path ; prints JSON body or {"error":...}
  local val="${!1}"
  printf 'header = "Authorization: Bearer %s"\n' "$val" \
    | curl -sS -m 20 -K - "$BASE/$2" 2>/dev/null || echo '{"error":"network"}'
}

python_fmt() { python3 -I - "$@"; }

out=""
for n in $names; do
  key_json=$(fetch "$n" key)
  cred_json=$(fetch "$n" credits)
  out+=$(NAME="$n" KEY_JSON="$key_json" CRED_JSON="$cred_json" JSON="$JSON" python_fmt <<'PY'
import json, os
name = os.environ["NAME"]
def load(s):
    try: return json.loads(s)
    except Exception: return {"error": "bad json"}
k = load(os.environ["KEY_JSON"]); c = load(os.environ["CRED_JSON"])
kd = k.get("data") or {}
cd = c.get("data") or {}
row = {
  "env_var": name,
  "ok": bool(kd),
  "limit_usd": kd.get("limit"),
  "limit_reset": kd.get("limit_reset"),
  "remaining_usd": kd.get("limit_remaining"),
  "spend_today_usd": kd.get("usage_daily"),
  "spend_week_usd": kd.get("usage_weekly"),
  "spend_month_usd": kd.get("usage_monthly"),
  "spend_total_usd": kd.get("usage"),
  "free_model_requests_remaining": (kd.get("free_model_daily_requests") or {}).get("remaining"),
  "account_credits_usd": cd.get("total_credits"),
  "account_used_usd": cd.get("total_usage"),
}
if cd.get("total_credits") is not None and cd.get("total_usage") is not None:
    row["account_balance_usd"] = round(cd["total_credits"] - cd["total_usage"], 4)
if not kd: row["error"] = str(k.get("error"))[:120]
print(json.dumps(row))
PY
)$'\n'
done

ROWS="$out" JSON="$JSON" python3 -I - <<'PY'
import json, os
rows = [json.loads(l) for l in os.environ["ROWS"].splitlines() if l.strip()]
if os.environ["JSON"] == "1":
    print(json.dumps(rows, indent=2)); raise SystemExit
def f(v):
    if v is None: return "n/a"
    return "${:,.4f}".format(v) if isinstance(v, (int, float)) else str(v)
print("OpenRouter spend (UTC day; key names only, no key values)")
print("-" * 72)
for r in rows:
    if not r["ok"]:
        print("%s: FAILED (%s)" % (r["env_var"], r.get("error"))); continue
    print(r["env_var"])
    print("  today %s   limit %s (%s)   remaining %s" % (f(r["spend_today_usd"]), f(r["limit_usd"]), r["limit_reset"] or "no reset", f(r["remaining_usd"])))
    print("  week  %s   month %s   lifetime %s" % (f(r["spend_week_usd"]), f(r["spend_month_usd"]), f(r["spend_total_usd"])))
    print("  free-model requests left today: %s" % r["free_model_requests_remaining"])
    if "account_balance_usd" in r:
        print("  ACCOUNT balance %s (credits %s - used %s)" % (f(r["account_balance_usd"]), f(r["account_credits_usd"]), f(r["account_used_usd"])))
        if r["account_balance_usd"] < 5: print("  WARNING: account balance under $5")
PY
