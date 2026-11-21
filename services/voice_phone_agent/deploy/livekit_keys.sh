#!/bin/bash
# LiveKit API key pair guard for the phone stack (#1036). Root-owned copy lives in /usr/local/lib/phone-stack.
#   livekit_keys.sh check    exit 1 when the agent env still holds LiveKit's public dev pair; prints lengths only
#   livekit_keys.sh rotate   generate a random pair (openssl rand) and write it to the agent env and to every
#                            LiveKit / SIP config file under the stack dir that holds the dev pair; env stays mode 600
# Values are never printed, logged or passed on a command line (perl reads them from its environment).
# Env: STACK (root-owned stack dir), AGENT_ENV (agent .env), AGENT_USER (owner of AGENT_ENV).
set -euo pipefail
umask 077
STACK=${STACK:?STACK not set}
AGENT_ENV=${AGENT_ENV:?AGENT_ENV not set}
AGENT_USER=${AGENT_USER:-phone}
# The public LiveKit dev pair, built from parts so no tracked file carries the literal pair.
DEF_K="dev""key"
DEF_S="sec""ret"

getv() { { grep -E "^$1=" "$AGENT_ENV" || true; } | tail -1 | cut -d= -f2- | tr -d "\"' "; }

cur_k=$(getv LIVEKIT_API_KEY)
cur_s=$(getv LIVEKIT_API_SECRET)
is_default() { [ "$cur_k" = "$DEF_K" ] && [ "$cur_s" = "$DEF_S" ]; }

report() {
  echo "LiveKit key length ${#cur_k}, secret length ${#cur_s}"
  if is_default; then echo "FAIL pair is the public LiveKit dev default"; else echo "OK   pair is not the dev default"; fi
  [ "${#cur_s}" -ge 32 ] || echo "WARN secret shorter than 32 characters"
}

# Config files in the stack that still carry the dev key name (names only are ever printed).
holders() { grep -rIlE -e "(^|[^[:alnum:]_])${DEF_K}([^[:alnum:]_]|$)" "$STACK" 2>/dev/null || true; }

case "${1:-check}" in
  check)
    report
    if is_default; then exit 1; fi
    left=$(holders | wc -l)
    [ "$left" -eq 0 ] || { echo "FAIL $left stack config file(s) still hold the dev key name"; exit 1; }
    ;;
  rotate)
    [ -f "$AGENT_ENV" ] || { echo "no agent env"; exit 1; }
    command -v openssl >/dev/null || { echo "openssl missing"; exit 1; }
    report
    if ! is_default; then echo "nothing to do: not the dev default"; exit 0; fi
    NEWK="API$(openssl rand -hex 8)"
    NEWS=$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48)
    [ "${#NEWS}" -ge 32 ] || { echo "random generation failed"; exit 1; }
    export OLDK="$DEF_K" OLDS="$DEF_S" NEWK NEWS
    # Three line shapes: "<oldkey>: <oldsecret>" (livekit.yaml keys map, LIVEKIT_KEYS) and
    # api_key / api_secret / LIVEKIT_API_KEY / LIVEKIT_API_SECRET assignments (SIP config, agent env).
    # shellcheck disable=SC2016  # perl program: $ENV is perl, not shell
    PROG='
      s/\b\Q$ENV{OLDK}\E(\s*:\s*)\Q$ENV{OLDS}\E\b/$ENV{NEWK}$1$ENV{NEWS}/g;
      s/\b((?:livekit_)?api[_-]?key\s*[:=]\s*["\x27]?)\Q$ENV{OLDK}\E(?=["\x27]?\s*$)/$1$ENV{NEWK}/gi;
      s/\b((?:livekit_)?api[_-]?secret\s*[:=]\s*["\x27]?)\Q$ENV{OLDS}\E(?=["\x27]?\s*$)/$1$ENV{NEWS}/gi;'
    changed=0
    for f in $(holders) "$AGENT_ENV"; do
      t=$(mktemp "${TMPDIR:-/tmp}/lk.XXXXXX")
      perl -pe "$PROG" "$f" > "$t"
      if ! cmp -s "$t" "$f"; then
        # In place with `cat >`: single-file bind mounts reject rename (see 05_root_phone_stack.sh).
        cat "$t" > "$f"; changed=$((changed + 1)); echo "updated ${f#"$STACK"/}"
      fi
      rm -f "$t"
    done
    chown "$AGENT_USER:$AGENT_USER" "$AGENT_ENV" 2>/dev/null || true
    chmod 600 "$AGENT_ENV"
    cur_k=$(getv LIVEKIT_API_KEY); cur_s=$(getv LIVEKIT_API_SECRET)
    if is_default || [ "$(holders | wc -l)" -ne 0 ]; then
      echo "FAIL dev pair still present after rotation ($changed file(s) changed); fix by hand, do not start the stack"; exit 1
    fi
    echo "rotated: $changed file(s) updated; new key length ${#cur_k}, secret length ${#cur_s}"
    echo "restart the stack: sudo phone-stack up"
    ;;
  *) echo "usage: livekit_keys.sh check|rotate" >&2; exit 2 ;;
esac
