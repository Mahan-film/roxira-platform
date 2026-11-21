"""Tests for T254 (#993): Smart Judge resource caps and ERP guard alert."""

from __future__ import annotations

import pathlib
import re
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import erp_guard_alert as guard  # noqa: E402


def test_erp_p95_rise_over_10_pct_fires_telegram_alert() -> None:
    sent: list[str] = []
    ev = guard.run_check(
        erp_p95_ms=225.0,
        baseline_7d_p95_ms=200.0,  # +12.5% > 10%
        host_ram_samples_gb=[(0.0, 5.5), (900.0, 5.6)],
        sender=sent.append,
    )
    assert ev.should_alert is True
    assert len(sent) == 1
    assert "ERP p95 latency" in sent[0]
    assert "move Smart Judge to its own server" in sent[0]


def test_host_ram_over_7gb_for_15_min_fires_telegram_alert() -> None:
    sent: list[str] = []
    ev = guard.run_check(
        erp_p95_ms=205.0,
        baseline_7d_p95_ms=200.0,  # +2.5% <= 10%
        host_ram_samples_gb=[(0.0, 7.2), (300.0, 7.3), (600.0, 7.4), (900.0, 7.5)],
        sender=sent.append,
    )
    assert ev.should_alert is True
    assert len(sent) == 1
    assert "Host RAM 7.50 GB > 7.0 GB for 15.0 min" in sent[0]


def test_normal_metrics_do_not_fire_alert() -> None:
    sent: list[str] = []
    ev = guard.run_check(
        erp_p95_ms=215.0,
        baseline_7d_p95_ms=200.0,  # +7.5% <= 10%
        host_ram_samples_gb=[(0.0, 7.2), (600.0, 6.8), (900.0, 7.1)],  # brief dip resets 15m window
        sender=sent.append,
    )
    assert ev.should_alert is False
    assert sent == []


def test_compose_smart_judge_caps_within_budget() -> None:
    compose = (REPO_ROOT / "docker-compose.prod.yml").read_text(encoding="utf-8")
    services = ("enterprise_app", "qdrant_prod", "roxira_embeddings")
    total_mb = 0
    total_cpus = 0.0

    for svc in services:
        m = re.search(rf"^  {svc}:\n(.*?)(?=^  [a-zA-Z0-9_-]+:|\Z)", compose, re.MULTILINE | re.DOTALL)
        assert m is not None, f"service {svc} not found in docker-compose.prod.yml"
        block = m.group(1)
        mem_m = re.search(r"^\s+mem_limit:\s*(\d+)m", block, re.MULTILINE)
        cpu_m = re.search(r"^\s+cpus:\s*([0-9.]+)", block, re.MULTILINE)
        assert mem_m is not None, f"{svc} missing mem_limit"
        assert cpu_m is not None, f"{svc} missing cpus"
        total_mb += int(mem_m.group(1))
        total_cpus += float(cpu_m.group(1))

    assert total_mb <= 4608, f"Smart Judge mem_limit total {total_mb}m exceeds 4.5 GB (4608m)"
    assert total_cpus <= 2.5, f"Smart Judge cpus total {total_cpus} exceeds 2.5 vCPU"
