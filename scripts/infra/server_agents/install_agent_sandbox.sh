#!/usr/bin/env bash
# Install or remove the agent sandbox on srv1. Default is a dry run that changes nothing.
#   install_agent_sandbox.sh            validate the ruleset, print what --apply would do
#   install_agent_sandbox.sh --apply    load the firewall, keep it across boots, enable the sandbox in taskq.env, restart taskq
#   install_agent_sandbox.sh --remove   undo all of that
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
RULES=/etc/roxira/agent_egress.nft
UNIT=/etc/systemd/system/roxira-agent-egress.service
TASKQ_ENV=/etc/roxira/taskq.env
MODE="${1:-}"

write_unit() {
  cat >"$UNIT" <<EOF
[Unit]
Description=Network limits for the roxira-agent user
After=network-pre.target
Before=roxira-taskq.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f $RULES
ExecStop=/usr/sbin/nft delete table inet roxira_agent

[Install]
WantedBy=multi-user.target
EOF
}

case "$MODE" in
  "")
    nft -c -f "$HERE/agent_egress.nft"
    echo "ruleset valid"
    echo "--apply would: install $RULES and $UNIT, set ROXIRA_AGENT_SANDBOX=1 in $TASKQ_ENV, restart roxira-taskq"
    ;;
  --apply)
    install -m 0600 "$HERE/agent_egress.nft" "$RULES"
    write_unit
    systemctl daemon-reload
    systemctl enable --now roxira-agent-egress.service
    if ! "$HERE/agent_sandbox.sh" check; then
      echo "control test failed: rolling back" >&2
      "$0" --remove
      exit 1
    fi
    grep -q '^ROXIRA_AGENT_SANDBOX=' "$TASKQ_ENV" 2>/dev/null || echo 'ROXIRA_AGENT_SANDBOX=1' >>"$TASKQ_ENV"
    systemctl restart roxira-taskq
    echo "agent sandbox active"
    ;;
  --remove)
    if [ -f "$TASKQ_ENV" ]; then sed -i '/^ROXIRA_AGENT_SANDBOX=/d' "$TASKQ_ENV"; fi
    systemctl disable --now roxira-agent-egress.service 2>/dev/null || true
    rm -f "$UNIT" "$RULES"
    systemctl daemon-reload
    systemctl restart roxira-taskq
    echo "agent sandbox removed"
    ;;
  *) echo "usage: $0 [--apply|--remove]" >&2; exit 2 ;;
esac
