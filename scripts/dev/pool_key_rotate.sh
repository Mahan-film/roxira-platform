#!/usr/bin/env bash
# Revoke the laptop's virtual key on the Mac pool proxy and issue a new one (also the first-time create).
#   bash scripts/dev/pool_key_rotate.sh [--revoke-only]
# Writes the new key to ~/Secrets/roxira/laptop-pool.key (mode 600). The key is never printed.
# Env: POOL_SHARE_URL (default http://127.0.0.1:4181), POOL_KEY_ALIAS (laptop-mahansudo),
#      POOL_KEY_BUDGET (2, USD per day, paid models only), POOL_KEY_RPM (60), POOL_KEY_TPM (300000).
set -euo pipefail
SECRETS="${ROXIRA_SECRETS:-$HOME/Secrets/roxira}"
ALIAS="${POOL_KEY_ALIAS:-laptop-mahansudo}"
# admin calls use the loopback side of the proxy (port+1), so they work even when the LAN side is blocked by a VPN
URL="${POOL_SHARE_URL:-http://127.0.0.1:$(( ${POOL_SHARE_PORT:-4180} + 1 ))}"
OUT="$SECRETS/laptop-pool.key"
MASTER="sk-$(cat "$SECRETS/pool-share.master")"
export URL ALIAS OUT MASTER REVOKE_ONLY=0
[ "${1:-}" = "--revoke-only" ] && REVOKE_ONLY=1
umask 077
python3 - <<'PY'
import json, os, sys, urllib.request, urllib.error
url, alias, out, master = (os.environ[k] for k in ("URL", "ALIAS", "OUT", "MASTER"))
def call(path, body=None):
    req = urllib.request.Request(url + path, data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {master}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, json.load(r)
    except urllib.error.HTTPError as e: return e.code, {}
# revoke every existing key with this alias (alias list is the stable handle; the key value is never needed)
st, _ = call("/key/delete", {"key_aliases": [alias]})
print(f"revoke {alias}: HTTP {st} (404/400 on first run is fine)")
if os.environ["REVOKE_ONLY"] == "1": sys.exit(0)
body = {
    "key_alias": alias,
    "models": ["agent-free", "agent-strong-free", "agent-light-free", "agent-free-paid", "best-all"],
    "max_budget": float(os.environ.get("POOL_KEY_BUDGET", "2")), "budget_duration": "1d",
    "rpm_limit": int(os.environ.get("POOL_KEY_RPM", "60")), "tpm_limit": int(os.environ.get("POOL_KEY_TPM", "300000")),
    "max_parallel_requests": 8,
    "allowed_routes": ["llm_api_routes"],
    "metadata": {"owner": "mahansudo", "purpose": "laptop OpenCode agents"},
}
st, res = call("/key/generate", body)
if st != 200 or "key" not in res: sys.exit(f"generate failed: HTTP {st}")
tmp = out + ".tmp"
with open(tmp, "w") as fh: fh.write(res["key"] + "\n")
os.chmod(tmp, 0o600); os.replace(tmp, out)
print(f"new key written to {out} (mode 600, not shown)")
PY
