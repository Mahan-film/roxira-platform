"""Offline tests for the public/admin health split (no server import)."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from output_apps.ecosystem_core.src.security.server_health import build_health_router

MODULES = ["output_apps/secret_module/router.py", "output_apps/other/api.py"]


def _client():
    app = FastAPI()
    app.include_router(build_health_router(lambda: 7, lambda: MODULES))
    return TestClient(app)


def test_public_health_hides_internals():
    r = _client().get("/health")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"status", "service", "version", "loaded_routers"}
    assert body["status"] == "ONLINE"
    assert body["loaded_routers"] == 7
    assert "failed_imports" not in body
    assert "secret_module" not in r.text and "output_apps" not in r.text


def test_details_404_when_env_unset(monkeypatch):
    monkeypatch.delenv("ADMIN_HEALTH_KEY", raising=False)
    c = _client()
    assert c.get("/health/details").status_code == 404
    assert c.get("/health/details", headers={"X-Admin-Key": ""}).status_code == 404


def test_details_404_wrong_key_200_right_key(monkeypatch):
    monkeypatch.setenv("ADMIN_HEALTH_KEY", "test-key-123")
    c = _client()
    assert c.get("/health/details").status_code == 404
    assert c.get("/health/details", headers={"X-Admin-Key": "nope"}).status_code == 404
    r = c.get("/health/details", headers={"X-Admin-Key": "test-key-123"})
    assert r.status_code == 200
    assert r.json()["failed_imports"] == MODULES
