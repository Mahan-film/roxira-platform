"""Issue #79: the LightRAG health payload says truthfully which engine answers queries.

``lightrag-hku`` is not installed in the prod image, so the facade must report
``lightrag: unavailable, mode: qdrant_vector`` instead of looking live. Offline:
the graph and Qdrant probes are monkeypatched.
"""

from __future__ import annotations

import pytest

from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as le


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    monkeypatch.setattr(le, "qdrant_fallback_state", lambda: {})


def _health(monkeypatch, *, available, ready, entities):
    monkeypatch.setattr(le, "LIGHTRAG_AVAILABLE", available)
    monkeypatch.setattr(le, "is_ready", lambda: ready)
    monkeypatch.setattr(le, "graph_entity_count", lambda: entities)
    return le.lightrag_health()


def test_missing_package_reports_unavailable_qdrant_mode(monkeypatch):
    health = _health(monkeypatch, available=False, ready=False, entities=0)
    assert health["lightrag"] == "unavailable"
    assert health["mode"] == "qdrant_vector"
    assert health["available"] is False
    assert health["qdrant_fallback"]["active"] is True


def test_installed_but_empty_graph_is_still_qdrant_mode(monkeypatch):
    health = _health(monkeypatch, available=True, ready=True, entities=0)
    assert health["lightrag"] == "available"
    assert health["mode"] == "qdrant_vector"


def test_ready_graph_reports_lightrag_mode(monkeypatch):
    health = _health(monkeypatch, available=True, ready=True, entities=42)
    assert health["lightrag"] == "available"
    assert health["mode"] == "lightrag"
    assert health["qdrant_fallback"]["active"] is False
