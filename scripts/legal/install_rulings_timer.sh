#!/usr/bin/env bash
# Install (or remove) the automatic ruling-update timer. Owner runs this ONCE on the server, as root, from the production checkout:
#   cd /opt/roxira_platform && sudo bash scripts/legal/install_rulings_timer.sh [--uninstall]
# نصب تایمر به‌روزرسانی خودکار آرا (یک بار، با root روی سرور). دوباره اجرا کردن بی‌خطر است.
#
# Install: copies the two units to /etc/systemd/system, creates the state dir (/var/lib/roxira/rulings) and the worker checkout
# (/opt/roxira_legal_worker, cloned from the same origin as the production checkout), runs ONE --dry-run of the job (validate only,
# nothing written to Qdrant), enables the timer and prints `systemctl list-timers`. It does not modify /opt/roxira_platform.
# --uninstall: stops and removes the timer and units. The state dir and worker checkout are kept (delete by hand if wanted).
set -euo pipefail

UNIT=roxira-rulings-update
SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
WORKER=${RULINGS_WORKER_DIR:-/opt/roxira_legal_worker}
STATE_DIR=${RULINGS_STATE_DIR:-/var/lib/roxira/rulings}
SYSTEMD=/etc/systemd/system

[ "$(id -u)" = 0 ] || { echo "run as root (sudo) / با root اجرا کنید" >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemctl not found" >&2; exit 1; }

case "${1:-}" in
  --uninstall)
    systemctl disable --now "$UNIT.timer" 2>/dev/null || true
    systemctl stop "$UNIT.service" 2>/dev/null || true
    rm -f "$SYSTEMD/$UNIT.service" "$SYSTEMD/$UNIT.timer"
    systemctl daemon-reload
    echo "removed $UNIT timer + service. Kept: $STATE_DIR and $WORKER (rm -rf by hand if you want them gone)."
    exit 0
    ;;
  "") ;;
  *) echo "usage: $0 [--uninstall]" >&2; exit 2 ;;
esac

for f in "$UNIT.service" "$UNIT.timer"; do [ -f "$SRC/ops/systemd/$f" ] || { echo "missing $SRC/ops/systemd/$f" >&2; exit 1; }; done
command -v docker >/dev/null || { echo "docker not found" >&2; exit 1; }

echo "== state dir / پوشه وضعیت"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

echo "== worker checkout / کپی مستقل کد"
if [ ! -d "$WORKER/.git" ]; then
  origin=${RULINGS_WORKER_ORIGIN:-$(git -C "$SRC" remote get-url origin)}
  git clone -q --branch "${RULINGS_BRANCH:-main}" "$origin" "$WORKER"
fi
git -C "$WORKER" fetch -q origin "${RULINGS_BRANCH:-main}"
git -C "$WORKER" merge -q --ff-only "origin/${RULINGS_BRANCH:-main}"
[ -f "$WORKER/scripts/legal/rulings_auto_update.sh" ] || { echo "worker checkout lacks the job script; merge the PR first" >&2; exit 1; }
echo "worker at $(git -C "$WORKER" rev-parse --short HEAD)"

echo "== units / یونیت‌ها"
install -m 0644 "$SRC/ops/systemd/$UNIT.service" "$SRC/ops/systemd/$UNIT.timer" "$SYSTEMD/"
# keep the unit paths in sync with a non-default worker/state location
sed -i "s|/opt/roxira_legal_worker|$WORKER|g; s|/var/lib/roxira/rulings|$STATE_DIR|g" "$SYSTEMD/$UNIT.service"
systemctl daemon-reload

echo "== one dry run (nothing is written to Qdrant) / اجرای آزمایشی"
RULINGS_WORKER_DIR="$WORKER" RULINGS_STATE_DIR="$STATE_DIR" bash "$WORKER/scripts/legal/rulings_auto_update.sh" --dry-run

echo "== enable timer / فعال‌سازی"
systemctl enable --now "$UNIT.timer"
systemctl list-timers "$UNIT.timer" --no-pager
echo
echo "check: journalctl -u $UNIT -n 50 --no-pager   |  run now: systemctl start $UNIT.service   |  remove: bash $0 --uninstall"
