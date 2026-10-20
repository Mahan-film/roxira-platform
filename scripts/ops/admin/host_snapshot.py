#!/usr/bin/env python3
"""Write a small read-only status snapshot of the HOST for the owner admin console.

The app container cannot see systemd, so a root timer on the host (roxira-admin-snapshot.timer, every
minute) writes /var/lib/roxira-admin/host_status.json and the console reads it through a read-only bind
mount (docs/ops/ADMIN_CONSOLE.md). Output is metadata only: unit names and states, disk and load numbers.
Never secrets, env values or log contents.

systemctl is run with a FIXED argv per unit (no shell, unit names from the list below, never from input).
Env: ADMIN_SNAPSHOT_OUT (default /var/lib/roxira-admin/host_status.json). Stdlib only.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(os.environ.get("ADMIN_SNAPSHOT_OUT", "/var/lib/roxira-admin/host_status.json"))
TIMERS = (
    "roxira-autodeploy.timer", "roxira-backup.timer", "roxira-usdt-poll.timer", "roxira-marketing-publish.timer",
    "roxira-kpi-weekly.timer", "roxira-monitor-synthetic.timer", "roxira-monitor-logs.timer",
    "roxira-selfimprove-hourly.timer", "roxira-cf-refresh.timer", "roxira-docker-prune.timer",
    "projects-deploy.timer",
)
PROPS = ("ActiveState", "UnitFileState", "NextElapseUSecRealtime", "LastTriggerUSec", "LoadState")
DISK_PATHS = ("/", "/var/lib/docker", "/var/lib/roxira-agents", "/var/log")


def _show(unit: str) -> dict:
    argv = ["systemctl", "show", unit] + [f"--property={p}" for p in PROPS]
    try:
        res = subprocess.run(argv, capture_output=True, text=True, timeout=10, check=False, shell=False)
    except (OSError, subprocess.SubprocessError):
        return {"unit": unit, "state": "unknown"}
    values = dict(line.split("=", 1) for line in res.stdout.splitlines() if "=" in line)
    if values.get("LoadState") == "not-found":
        return {"unit": unit, "state": "not installed"}
    return {"unit": unit, "state": values.get("ActiveState", "unknown"), "enabled": values.get("UnitFileState", ""),
            "next": values.get("NextElapseUSecRealtime", ""), "last": values.get("LastTriggerUSec", "")}


def snapshot() -> dict:
    disk = []
    for path in DISK_PATHS:
        try:
            u = shutil.disk_usage(path)
        except OSError:
            continue
        disk.append({"path": path, "total_gb": round(u.total / 1e9, 1), "used_gb": round(u.used / 1e9, 1),
                     "free_gb": round(u.free / 1e9, 1), "used_pct": round(100 * u.used / u.total, 1) if u.total else 0})
    try:
        load = [round(x, 2) for x in os.getloadavg()]
    except OSError:
        load = []
    try:
        uptime_s = int(float(Path("/proc/uptime").read_text().split()[0]))
    except (OSError, ValueError, IndexError):
        uptime_s = None
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "timers": [_show(t) for t in TIMERS],
            "disk": disk, "load": load, "uptime_s": uptime_s, "containers": _containers()}


def _containers() -> list:
    """Name/image/state/status only (docker ps), so the app container never needs Docker API access."""
    try:
        out = subprocess.run(["docker", "ps", "-a", "--format", "{{json .}}"], capture_output=True,
                             text=True, timeout=10, check=False).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    rows = []
    for line in out.splitlines():
        try:
            c = json.loads(line)
        except ValueError:
            continue
        status = str(c.get("Status", ""))
        rows.append({"name": c.get("Names", "?"), "image": str(c.get("Image", ""))[:80],
                     "state": c.get("State", ""), "status": status,
                     "healthy": "unhealthy" not in status and c.get("State") == "running"})
    rows.sort(key=lambda r: (r["healthy"], r["name"]))
    return rows


def write_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".host_status.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def main() -> int:
    started = time.monotonic()
    write_atomic(OUT, snapshot())
    print(f"wrote {OUT} in {time.monotonic() - started:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
