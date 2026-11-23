#!/usr/bin/env bash
# Run AS THE BUILDER USER on the box (docs/ops/BUILDER_EGRESS.md). Read-only; no secret printed. The builder cannot read the
# repo checkout, so apply_root.sh installs a root-owned copy; run that one:
#   sudo -u <builder user> env -i PATH=/usr/bin:/bin HOME=/var/lib/roxira-builder bash /usr/local/libexec/roxira-lane/probe/egress_probe.sh
# Negative control: run it once BEFORE the nft table is loaded. Checks 2 and 3 must then say FAIL (the probe detects an
# open path); after the lock is loaded every line must say PASS.
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
# 6. the gateway tunnel on loopback must be reachable (LLM calls); BUILDER_PROBE_GATEWAY=0 skips it when the tunnel is down
if [ "${BUILDER_PROBE_GATEWAY:-1}" = 1 ]; then
  if curl -sS -o /dev/null -m 10 --noproxy '*' "http://127.0.0.1:${BUILDER_GATEWAY_PORT:-4181}/health/liveliness" 2>/dev/null; then ok "gateway tunnel reachable"; else bad "gateway tunnel NOT reachable"; fi
fi
# 7. the docker socket must not be connectable (a docker-group user bypasses every uid rule)
if python3 -I -c 'import socket,sys
s=socket.socket(socket.AF_UNIX)
try:
    s.connect("/var/run/docker.sock")
except OSError:
    sys.exit(0)
sys.exit(1)'; then ok "docker socket not usable"; else bad "docker socket CONNECTABLE"; fi
# 8. no privileged groups
if id -nG | tr ' ' '\n' | grep -Eqx 'docker|sudo|adm|lxd|root'; then bad "builder is in a privileged group"; else ok "no docker/sudo/adm/lxd group"; fi
# 9. other users' homes are closed
open_home=0
for d in /home/*; do [ -d "$d" ] && [ -r "$d" ] && [ -x "$d" ] && open_home=1; done
if [ "$open_home" = 0 ]; then ok "no other home directory is readable"; else bad "a home directory under /home is readable"; fi
# 10. second allowlisted host (package registry)
if curl -sS -o /dev/null -m 30 -x "$proxy" https://registry.npmjs.org/ 2>/dev/null; then ok "registry.npmjs.org reachable"; else bad "registry.npmjs.org NOT reachable"; fi
case "$(env | grep -c -E '^(GH_TOKEN|GITHUB_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY|GEMINI_API_KEY)=')" in
  0) ok "no known token variables" ;;
  *) bad "a known token variable is set" ;;
esac
exit "$fail"
