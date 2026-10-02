"""Offline tests for the append-only radar decision log (issue #338).

The script is loaded by path inside a fixture (no import-time side effects), and
every test writes to a pytest ``tmp_path`` file -- never the real
``docs/radar/DECISIONS.md``. No network, models, or API keys are needed.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "radar" / "decision_log.py"

VALID = dict(
    name="DBOS Transact",
    url="https://github.com/dbos-inc/dbos-transact-py",
    source="github",
    verdict="trial",
    reason="Postgres-backed durable workflow spike",
)


@pytest.fixture(scope="module")
def log() -> ModuleType:
    spec = importlib.util.spec_from_file_location("decision_log_under_test", SCRIPT_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_add_creates_file_with_header_and_row(log: ModuleType, tmp_path: Path) -> None:
    path = tmp_path / "DECISIONS.md"
    row = log.add_decision(path, **VALID)

    assert row["name"] == "DBOS Transact"
    assert row["verdict"] == "trial"
    text = path.read_text(encoding="utf-8")
    assert "# Radar decision log" in text
    assert "https://github.com/dbos-inc/dbos-transact-py" in text
    assert log.list_decisions(path) == [row]


def test_add_rejects_non_https_url(log: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(log.DecisionError):
        log.add_decision(tmp_path / "DECISIONS.md", **{**VALID, "url": "http://example.com/x"})


def test_add_rejects_missing_url(log: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(log.DecisionError):
        log.add_decision(tmp_path / "DECISIONS.md", **{**VALID, "url": ""})


def test_add_rejects_unknown_verdict(log: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(log.DecisionError):
        log.add_decision(tmp_path / "DECISIONS.md", **{**VALID, "verdict": "maybe"})


def test_add_rejects_short_reason(log: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(log.DecisionError):
        log.add_decision(tmp_path / "DECISIONS.md", **{**VALID, "reason": "too short"})


def test_add_rejects_duplicate_url(log: ModuleType, tmp_path: Path) -> None:
    path = tmp_path / "DECISIONS.md"
    log.add_decision(path, **VALID)
    with pytest.raises(log.DecisionError):
        log.add_decision(path, **{**VALID, "name": "Other"})
    assert len(log.list_decisions(path)) == 1


def test_list_filters_by_verdict(log: ModuleType, tmp_path: Path) -> None:
    path = tmp_path / "DECISIONS.md"
    log.add_decision(path, **VALID)
    log.add_decision(
        path,
        name="Temporal",
        url="https://docs.temporal.io/self-hosted-guide",
        source="github",
        verdict="skip",
        reason="Too much control plane for one host",
    )

    assert [row["name"] for row in log.list_decisions(path)] == ["DBOS Transact", "Temporal"]
    assert [row["name"] for row in log.list_decisions(path, verdict="skip")] == ["Temporal"]
    assert log.list_decisions(path, verdict="adopt") == []


def test_log_is_append_only_and_only_grows(log: ModuleType, tmp_path: Path) -> None:
    path = tmp_path / "DECISIONS.md"
    log.add_decision(path, **VALID)
    first = path.read_text(encoding="utf-8")

    log.add_decision(
        path,
        name="gVisor",
        url="https://github.com/google/gvisor",
        source="github",
        verdict="trial",
        reason="Userspace kernel for untrusted workers",
    )
    second = path.read_text(encoding="utf-8")

    assert len(second) > len(first)
    assert second.startswith(first)
    assert len(log.list_decisions(path)) == 2
