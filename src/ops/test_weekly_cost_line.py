from __future__ import annotations

import pathlib
import sys

import pytest


@pytest.fixture()
def wr():
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts" / "ops" / "kpi"))
    import weekly_report
    return weekly_report


def test_digest_line_is_one_line_with_cap_share(wr):
    cost = {"status": "ok", "agg": {"total_cost": 0.5, "calls": 100, "success": 90}}
    line = wr.digest_line(cost, 7, 2.0)
    assert "\n" not in line and "$0.5000" in line and "100" in line and "$14.00" in line


def test_digest_line_without_cap_and_without_log(wr):
    ok = {"status": "ok", "agg": {"total_cost": 0, "calls": 0, "success": 0}}
    assert "سقف" not in wr.digest_line(ok, 7, None)
    assert "در دسترس نیست" in wr.digest_line({"status": "missing", "reason": "no log"}, 7, 2.0)
