#!/bin/bash
# Telegram failure notice for the box backup (systemd OnFailure hook). No-op (exit 0) when the env file is
# missing or has no token/chat id. Credentials come ONLY from ~/.config/roxira-box-backup/notify.env (mode 600,
# NOTIFY_BOT_TOKEN=... and NOTIFY_CHAT_ID=...), never from the repo. The message carries the unit name and a
# fixed hint, no log content, no paths, no secrets.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENVF="${BOX_BACKUP_NOTIFY_ENV:-${XDG_CONFIG_HOME:-$HOME/.config}/roxira-box-backup/notify.env}"
unit="${1:-roxira-box-backup.service}"
if [ ! -f "$ENVF" ]; then
  echo "notify: $ENVF missing, Telegram notice skipped (create it, mode 600, to enable)"; exit 0
fi
case "$(stat -c %a "$ENVF")" in 600|400) ;; *) echo "notify: $ENVF must be mode 600, Telegram notice skipped"; exit 0 ;; esac
tok=$(grep -E '^NOTIFY_BOT_TOKEN=' "$ENVF" | tail -1 | cut -d= -f2- | tr -d "\"' ")
chat=$(grep -E '^NOTIFY_CHAT_ID=' "$ENVF" | tail -1 | cut -d= -f2- | tr -d "\"' ")
if [ -z "$tok" ] || [ -z "$chat" ]; then
  echo "notify: token or chat id empty in $ENVF, Telegram notice skipped"; exit 0
fi
NOTIFY_PY="$HERE/notify.py"
[ -f "$NOTIFY_PY" ] || { echo "notify: $NOTIFY_PY missing, skipped"; exit 0; }
host=$(hostname -s)
NOTIFY_BOT_TOKEN="$tok" NOTIFY_CHAT_ID="$chat" NOTIFY_ENV_FILE=/nonexistent \
  python3 -I "$NOTIFY_PY" "[box] backup FAILED: $unit on $host. See: journalctl --user -u ${unit%.service} -n 50; box_backup.sh --status" \
  && echo "notify: sent" || echo "notify: send failed (ignored)"
exit 0
