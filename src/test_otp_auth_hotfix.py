"""Offline tests for the OTP master-code hotfix and the CORS allowlist. No network."""

import asyncio
import json

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from output_apps.ecosystem_core.src.security import cors_config
from output_apps.generated_modules.smartjudge import chat_auth
from output_apps.generated_modules.smartjudge import smartjudge_module as mod

PHONE = "09120000001"
GOOD = "54321"


def _verify(code):
    chat_auth.reset_for_tests()
    mod._otp_store(PHONE, GOOD)
    resp = asyncio.run(mod.verify_auth_otp({"phone": PHONE, "code": code}))
    chat_auth.reset_for_tests()
    return resp


def _status(resp):
    return getattr(resp, "status_code", 200)


def test_wrong_code_rejected():
    assert _status(_verify("00000")) == 400


def test_master_code_12345_rejected():
    assert _status(_verify("12345")) == 400


def test_correct_code_accepted():
    resp = _verify(GOOD)
    assert isinstance(resp, dict) and resp["status"] == "success" and resp["token"]


def test_no_universal_otp_routes_left():
    assert not hasattr(mod, "_GLOBAL_OTP_CACHE") and not hasattr(mod, "_OTP_CACHE")
    paths = {getattr(r, "path", "") for r in mod.router.routes}
    assert not any(p.endswith(("/send-otp", "/verify-otp")) and "/auth/" not in p for p in paths)


def _send(monkeypatch, delivered):
    async def fake_deliver(phone, code, template=None):
        return delivered

    monkeypatch.setattr(mod, "_deliver_verification_code", fake_deliver)

    class Req:
        headers = {"host": "x"}

    chat_auth.reset_for_tests()
    resp = asyncio.run(mod.send_auth_otp(Req(), {"phone": PHONE}))
    chat_auth.reset_for_tests()
    return resp if isinstance(resp, dict) else json.loads(resp.body)


def test_dev_code_absent_by_default(monkeypatch):
    monkeypatch.delenv("OTP_DEV_ECHO", raising=False)
    monkeypatch.delenv("ROXIRA_ENV", raising=False)
    assert "dev_code" not in _send(monkeypatch, False)


def test_dev_code_never_in_production(monkeypatch):
    monkeypatch.setenv("OTP_DEV_ECHO", "1")
    monkeypatch.setenv("ROXIRA_ENV", "production")
    assert "dev_code" not in _send(monkeypatch, False)


def test_dev_code_never_in_response_even_when_opted_in(monkeypatch):
    monkeypatch.setenv("OTP_DEV_ECHO", "1")
    monkeypatch.setenv("ROXIRA_ENV", "development")
    assert "dev_code" not in _send(monkeypatch, False)


def test_otp_not_logged(monkeypatch, capsys):
    monkeypatch.delenv("OTP_DEV_ECHO", raising=False)
    _send(monkeypatch, False)
    out = capsys.readouterr()
    assert PHONE not in out.out + out.err


def test_cors_rejects_evil_origin(monkeypatch):
    monkeypatch.delenv("CORS_ALLOW_ORIGINS", raising=False)
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_config.cors_allowed_origins(),
        allow_credentials=True,
        allow_methods=cors_config.CORS_METHODS,
        allow_headers=cors_config.CORS_HEADERS,
    )

    @app.get("/x")
    def x():
        return {}

    client = TestClient(app)
    evil = client.get("/x", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in evil.headers
    good = client.get("/x", headers={"Origin": "https://roxira.ir"})
    assert good.headers["access-control-allow-origin"] == "https://roxira.ir"
    assert "*" not in cors_config.cors_allowed_origins()
