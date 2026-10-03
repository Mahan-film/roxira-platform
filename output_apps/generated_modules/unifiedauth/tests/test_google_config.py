"""Google login must be env-only: no baked-in credentials, 503 when unconfigured."""

import importlib
import pathlib
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

MODULE = "output_apps.generated_modules.unifiedauth.unifiedauth_module"


@pytest.fixture
def mod(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret-not-real")
    monkeypatch.setenv("KAVENEGAR_API_KEY", "test-kavenegar-not-real")
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("GOOGLE_REDIRECT_URI", raising=False)
    return importlib.reload(importlib.import_module(MODULE))


def _client(mod):
    app = FastAPI()
    app.include_router(mod.router)
    return TestClient(app)


def test_empty_env_imports_with_empty_credentials(mod):
    assert mod.GOOGLE_CLIENT_ID == ""
    assert mod.GOOGLE_CLIENT_SECRET == ""


@pytest.mark.parametrize(
    "path", ["/api/v1/auth/google/url", "/api/v1/auth/google/callback?code=x"]
)
def test_google_endpoints_return_503_when_unconfigured(mod, path):
    resp = _client(mod).get(path)
    assert resp.status_code == 503
    assert resp.json()["detail"] == "google login not configured"


def test_503_when_only_id_is_set(mod, monkeypatch):
    monkeypatch.setattr(mod, "GOOGLE_CLIENT_ID", "only-an-id")
    resp = _client(mod).get("/api/v1/auth/google/url")
    assert resp.status_code == 503


def test_no_hardcoded_google_credentials_in_source():
    src = pathlib.Path(__file__).resolve().parents[1] / "unifiedauth_module.py"
    text = src.read_text(encoding="utf-8")
    literal = re.compile(r"[\"']([A-Za-z0-9._-]{20,})[\"']")
    offenders = []
    for line in text.splitlines():
        if re.match(r"\s*GOOGLE_\w+\s*=", line):
            offenders += [m for m in literal.findall(line) if not m.startswith("GOOGLE_")]
    assert offenders == []
    assert not re.search(r"getenv\(\s*[\"']GOOGLE_\w+[\"']\s*,\s*[\"'][^\"']{8,}[\"']", text)
    assert "apps.googleusercontent.com" not in text
    assert "GOCSPX-" not in text
