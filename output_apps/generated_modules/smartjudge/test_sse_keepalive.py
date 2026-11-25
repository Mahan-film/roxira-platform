"""Tests for T234: SSE keepalive (: ping every 12 s), headers, and nginx stream config."""
from __future__ import annotations

import asyncio
import re
from pathlib import Path

import pytest

from output_apps.generated_modules.smartjudge import chat_fast, smartjudge_module


def test_sse_ping_frame_and_default_interval():
    assert chat_fast.SSE_PING_INTERVAL_S == 12.0
    assert chat_fast.sse_ping_frame() == ": ping\n\n"


def test_iter_sse_queue_with_keepalive_silent_gap_preserves_all_tokens():
    """Scaled 60 s answer with a 45 s silent gap (1000x faster) yields >= 3 pings and every token."""

    async def _run():
        q: asyncio.Queue = asyncio.Queue()

        async def _producer():
            await q.put("بخش اول ")
            # 45 s silent gap scaled to 45 ms with 12 ms ping interval => >= 3 pings
            await asyncio.sleep(0.050)
            await q.put("بخش دوم ")
            await asyncio.sleep(0.015)
            await q.put("بخش سوم")
            return {"status": "OK"}

        task = asyncio.create_task(_producer())
        frames = []
        async for frame in chat_fast.iter_sse_queue_with_keepalive(
            task, q, ping_interval_s=0.012
        ):
            frames.append(frame)
        return frames

    frames = asyncio.run(_run())
    pings = [f for f in frames if f == ": ping\n\n"]
    deltas = [f for f in frames if f.startswith("event: delta\n")]
    assert len(pings) >= 3, f"expected >= 3 keepalive pings, got {len(pings)}: {frames!r}"
    assert len(deltas) == 3
    assert "بخش اول " in deltas[0]
    assert "بخش دوم " in deltas[1]
    assert "بخش سوم" in deltas[2]


def test_sse_headers_disable_buffering_and_transform():
    assert smartjudge_module._SSE_HEADERS["Cache-Control"] == "no-cache, no-transform"
    assert smartjudge_module._SSE_HEADERS["X-Accel-Buffering"] == "no"
    assert smartjudge_module._SSE_HEADERS["Connection"] == "keep-alive"


def test_chat_stream_endpoint_emits_ping_and_headers(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    monkeypatch.setattr(chat_fast, "SSE_PING_INTERVAL_S", 0.015)

    async def _fake_consult(payload, request, user, on_delta=None):
        if on_delta is not None:
            await on_delta("سلام ")
            await asyncio.sleep(0.055)
            await on_delta("دنیا")
        return {"status": "SUCCESS", "reply": "سلام دنیا", "conversation_id": "c-1"}

    monkeypatch.setattr(smartjudge_module, "_run_consult", _fake_consult)
    app = FastAPI()
    app.include_router(smartjudge_module.router)
    client = TestClient(app)

    resp = client.post(
        "/api/v1/apps/judge/chat/stream",
        json={"message": "مهلت تجدیدنظرخواهی چقدر است؟"},
    )
    assert resp.status_code == 200
    assert resp.headers.get("cache-control") == "no-cache, no-transform"
    assert resp.headers.get("x-accel-buffering") == "no"
    body = resp.text
    assert ": ping\n\n" in body
    assert "event: meta\n" in body
    assert "سلام " in body
    assert "دنیا" in body
    assert "event: done\n" in body


def test_nginx_chat_stream_location_has_sse_directives():
    repo_root = Path(__file__).resolve().parents[3]
    conf = (repo_root / "output_apps/nginx_config/nginx.conf").read_text(encoding="utf-8")
    blocks = re.findall(
        r"location\s*=\s*/api/v1/apps/judge/chat/stream\s*\{([^}]*)\}",
        conf,
        flags=re.DOTALL,
    )
    assert len(blocks) == 3, f"expected 3 server blocks with chat/stream location, found {len(blocks)}"
    for block in blocks:
        assert "proxy_buffering off;" in block
        assert "proxy_http_version 1.1;" in block
        assert "proxy_read_timeout 300s;" in block
