"""Focused tests for the reachability matrix's injectable network boundaries."""

import importlib.util
from pathlib import Path

import pytest


@pytest.fixture
def matrix():
    spec = importlib.util.spec_from_file_location(
        "reachability_matrix", Path(__file__).parents[2] / "scripts/ops/reachability_matrix.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _resolver(addresses: list[str]):
    return lambda _endpoint: addresses


def test_normal_result(matrix, monkeypatch):
    monkeypatch.setattr(matrix, "ENDPOINTS", ("example.test",))
    report = matrix.run_matrix(_resolver(["93.184.216.34"]), lambda _host, _timeout: 200)
    result = report["results"][0]
    assert result["filtered_dns"] is False
    assert result["status_code"] == 200
    assert result["latency_ms"] is not None


def test_filtered_dns_result(matrix, monkeypatch):
    monkeypatch.setattr(matrix, "ENDPOINTS", ("example.test",))
    report = matrix.run_matrix(_resolver(["10.10.35.9"]), lambda _host, _timeout: 204)
    assert report["results"][0]["filtered_dns"] is True


def test_timeout_is_reported(matrix, monkeypatch):
    monkeypatch.setattr(matrix, "ENDPOINTS", ("example.test",))

    def timeout(_host: str, _timeout: float) -> int:
        raise TimeoutError("timed out")

    result = matrix.run_matrix(_resolver(["1.1.1.1"]), timeout)["results"][0]
    assert result["status_code"] is None
    assert result["error"] == "https: timed out"
