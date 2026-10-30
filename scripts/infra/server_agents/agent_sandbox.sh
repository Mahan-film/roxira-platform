#!/usr/bin/env bash
# Sandbox for agent processes on the production host: a transient systemd unit (filesystem, privileges, resources)
# plus the uid firewall in agent_egress.nft (network). Sourced by run_task.sh; also a CLI:
#   agent_sandbox.sh props                 print the systemd-run properties, one per line
#   agent_sandbox.sh check [WORKDIR]       run the control test inside the sandbox; exit 0 only if every control holds
# The check is the pre-run proof of the controls: run_task.sh refuses to start an agent when it fails.
# Env overrides: ROXIRA_AGENT_USER, ROXIRA_AGENTS_HOME, AGENT_SANDBOX_MEMORY (2G), AGENT_SANDBOX_CPU (150%).

SANDBOX_USER="${ROXIRA_AGENT_USER-roxira-agent}"
SANDBOX_STATE="${ROXIRA_AGENTS_HOME:-/var/lib/roxira-agents}"
SANDBOX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX_HIDE=(/opt/roxira_platform /root /home /etc/roxira /etc/ssh /etc/letsencrypt /var/lib/docker /var/lib/containerd
  /run/docker.sock /var/run/docker.sock /var/log/roxira-keypool /var/lib/roxira /var/lib/roxira-admin
  /var/lib/roxira-backup /var/lib/roxira-eval /var/lib/roxira-factory /var/lib/roxira-legal-sync /var/lib/roxira-mail
  /var/lib/roxira-marketing /var/lib/roxira-mirror /var/lib/roxira-monitor /var/lib/roxira-mutation
  /var/lib/roxira-offsite /var/lib/roxira-selfimprove)

sandbox_props() { # WORKDIR RUNTIME_SECONDS -> one property per line
  local wd="$1" secs="${2:-1800}" p
  cat <<EOF
User=$SANDBOX_USER
WorkingDirectory=$wd
RuntimeMaxSec=$secs
ProtectSystem=strict
ReadWritePaths=$wd $SANDBOX_STATE/home $SANDBOX_STATE/xdg
PrivateTmp=yes
PrivateDevices=yes
PrivatePIDs=yes
ProtectProc=invisible
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
NoNewPrivileges=yes
CapabilityBoundingSet=
RestrictSUIDSGID=yes
RestrictNamespaces=yes
RestrictRealtime=yes
LockPersonality=yes
SystemCallArchitectures=native
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryMax=${AGENT_SANDBOX_MEMORY:-2G}
MemorySwapMax=0
CPUQuota=${AGENT_SANDBOX_CPU:-150%}
TasksMax=512
EOF
  for p in "${SANDBOX_HIDE[@]}"; do printf 'InaccessiblePaths=-%s\n' "$p"; done
}

sandbox_env_file() { # PATH NAME... -> root-only file with the named variables, read by systemd before it drops to the agent user
  local path="$1"; shift
  (umask 077; python3 - "$path" "$@" <<'PY'
import os, sys
with open(sys.argv[1], "w") as f:
    for name in sys.argv[2:]:
        value = os.environ.get(name)
        if value is not None:
            f.write(name + "='" + value.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ") + "'\n")
PY
  )
}

sandbox_run() { # UNIT WORKDIR RUNTIME_SECONDS ENV_FILE CMD... -> runs CMD in the sandbox, exit code of CMD
  local unit="$1" wd="$2" secs="$3" envf="$4" line
  shift 4
  local args=()
  while IFS= read -r line; do args+=(-p "$line"); done < <(sandbox_props "$wd" "$secs")
  if [ -n "$envf" ]; then args+=(-p "EnvironmentFile=$envf"); fi
  systemd-run --quiet --wait --pipe --collect --unit="$unit" "${args[@]}" -- "$@"
}

sandbox_check() { # WORKDIR
  local wd="${1:-$SANDBOX_STATE/worktrees}" unit="roxira-agent-check-$$" rc=0
  # the probe arrives on stdin: the repo path is hidden from the sandbox
  sandbox_run "$unit" "$wd" 60 "" /usr/bin/python3 -I - "$wd" <"$SANDBOX_DIR/agent_sandbox_probe.py" || rc=$?
  return "$rc"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  case "${1:-}" in
    props) sandbox_props "${2:-$SANDBOX_STATE/worktrees}" "${3:-1800}" ;;
    check) sandbox_check "${2:-}" ;;
    *) echo "usage: $0 props [WORKDIR] [SECONDS] | check [WORKDIR]" >&2; exit 2 ;;
  esac
fi
