"""host_snapshot.py: fixed-argv systemctl calls, atomic write, no secrets. systemctl is faked."""
import json
import sys
from pathlib import Path

ADMIN_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ADMIN_DIR))

import host_snapshot as hs  # noqa: E402


class Done:
    def __init__(self, out):
        self.stdout = out


def test_show_uses_fixed_argv_without_shell(monkeypatch):
    seen = []

    def fake_run(argv, **kw):
        seen.append((argv, kw))
        return Done("ActiveState=active\nUnitFileState=enabled\nNextElapseUSecRealtime=Tue 2026-10-20 10:00:00 UTC\nLastTriggerUSec=x\nLoadState=loaded\n")

    monkeypatch.setattr(hs.subprocess, "run", fake_run)
    out = hs._show("roxira-autodeploy.timer")
    argv, kw = seen[0]
    assert argv[:3] == ["systemctl", "show", "roxira-autodeploy.timer"] and kw["shell"] is False
    assert out["state"] == "active" and out["enabled"] == "enabled"


def test_missing_unit_and_systemctl_failure(monkeypatch):
    monkeypatch.setattr(hs.subprocess, "run", lambda *a, **k: Done("LoadState=not-found\nActiveState=inactive\n"))
    assert hs._show("x.timer")["state"] == "not installed"

    def boom(*a, **k):
        raise FileNotFoundError

    monkeypatch.setattr(hs.subprocess, "run", boom)
    assert hs._show("x.timer")["state"] == "unknown"


def test_snapshot_shape_and_atomic_write(tmp_path, monkeypatch):
    monkeypatch.setattr(hs.subprocess, "run", lambda *a, **k: Done("LoadState=loaded\nActiveState=active\n"))
    data = hs.snapshot()
    assert {t["unit"] for t in data["timers"]} == set(hs.TIMERS) and data["disk"]
    out = tmp_path / "sub" / "host_status.json"
    hs.write_atomic(out, data)
    assert json.loads(out.read_text())["timers"][0]["state"] == "active"
    assert [p.name for p in out.parent.iterdir()] == ["host_status.json"]  # no temp file left behind
