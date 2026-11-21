#!/usr/bin/env bash
# Run AS THE BUILDER USER on the box after the owner steps (docs/ops/BUILDER_EGRESS.md). Read-only; no secret printed.
#   sudo -u <builder user> bash egress_probe.sh
# Exit 0 only if: a non-allowlisted host fails (proxy and direct), an allowlisted host works, the xray port is refused,
# and the environment holds no key-shaped value.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
proxy="${BUILDER_PROXY:-http://127.0.0.1:10810}"
xray="${BUILDER_XRAY_PORT:-10809}"
fail=0
ok() { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; fail=1; }

# 1. non-allowlisted domain through the proxy must fail
if curl -sS -o /dev/null -m 15 -x "$proxy" https://example.com/ 2>/dev/null; then bad "example.com reachable via proxy"; else ok "example.com refused via proxy"; fi
# 2. direct internet must fail (no proxy)
if curl -sS -o /dev/null -m 10 --noproxy '*' https://example.com/ 2>/dev/null; then bad "direct internet reachable"; else ok "direct internet refused"; fi
# 3. xray port must be refused (bypass of the allowlist)
if curl -sS -o /dev/null -m 10 -x "http://127.0.0.1:$xray" https://example.com/ 2>/dev/null; then bad "xray port usable"; else ok "xray port refused"; fi
# 4. allowlisted host works through the proxy
if curl -sS -o /dev/null -m 30 -x "$proxy" https://api.github.com/zen 2>/dev/null; then ok "api.github.com reachable"; else bad "api.github.com NOT reachable"; fi
# 5. no key-shaped value in the environment (values never printed; only the variable name)
while IFS= read -r line; do
  name="${line%%=*}"
  if printf '%s\n' "${line#*=}" | python3 -I "$here/redact.py" --check; then :; else bad "env var $name looks like a secret"; fi
done < <(env)
case "$(env | grep -c -E '^(GH_TOKEN|GITHUB_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY|GEMINI_API_KEY)=')" in
  0) ok "no known token variables" ;;
  *) bad "a known token variable is set" ;;
esac
exit "$fail"
