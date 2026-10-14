"""Offline unit tests for the roxira-research API (no network; GPTResearcher mocked)."""
from __future__ import annotations

import asyncio
import importlib.util
import pathlib
import sys

import httpx
import pytest

_APP_PATH = pathlib.Path(__file__).resolve().parent / "app.py"
_spec = importlib.util.spec_from_file_location("research_app", _APP_PATH)
assert _spec and _spec.loader
app = importlib.util.module_from_spec(_spec)
sys.modules["research_app"] = app
_spec.loader.exec_module(app)


class _Tracker:
    def __init__(self) -> None:
        self.max_active = 0
        self._active = 0

    def enter(self) -> None:
        self._active += 1
        self.max_active = max(self.max_active, self._active)

    def exit(self) -> None:
        self._active -= 1


class _FakeResearcher:
    tracker: _Tracker
    delay: float = 0.0

    def __init__(self, **kwargs) -> None:
        self.kwargs = kwargs

    async def conduct_research(self) -> None:
        self.tracker.enter()
        try:
            await asyncio.sleep(self.delay)
        finally:
            self.tracker.exit()

    async def write_report(self) -> str:
        return "# گزارش\n\nمتن نمونه"

    def get_research_sources(self) -> list[dict[str, str]]:
        return [
            {"url": "https://example.invalid/a", "title": "الف"},
            {"url": "https://example.invalid/b", "title": "ب"},
            {"url": "https://example.invalid/c", "title": "ج"},
        ]

    def get_costs(self) -> float:
        return 0.001


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setattr(app, "GPTResearcher", _FakeResearcher)
    monkeypatch.delenv("RESEARCH_TOKEN", raising=False)
    tracker = _Tracker()
    _FakeResearcher.tracker = tracker
    _FakeResearcher.delay = 0.0
    return tracker


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app.app), base_url="http://test")


def _post(payload: dict, headers: dict | None = None) -> httpx.Response:
    async def _call() -> httpx.Response:
        async with _client() as client:
            return await client.post("/research", json=payload, headers=headers)

    return asyncio.run(_call())


def test_health(fake):
    async def _call() -> httpx.Response:
        async with _client() as client:
            return await client.get("/health")

    response = asyncio.run(_call())
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_auth_disabled_when_token_unset(fake):
    assert _post({"query": "سلام"}).status_code == 200


def test_auth_required_when_token_set(fake, monkeypatch):
    monkeypatch.setenv("RESEARCH_TOKEN", "s3cret")
    assert _post({"query": "سلام"}).status_code == 401
    assert _post({"query": "سلام"}, {"Authorization": "Bearer wrong"}).status_code == 401
    assert _post({"query": "سلام"}, {"Authorization": "Bearer s3cret"}).status_code == 200


@pytest.mark.parametrize(
    "payload",
    [
        {"query": ""},
        {"query": "x", "report_type": "deep"},
        {"query": "x", "max_sources": 0},
        {"query": "x", "max_sources": 21},
        {"query": "x", "max_sources": "many"},
    ],
)
def test_validation_rejects_bad_input(fake, payload):
    assert _post(payload).status_code == 422


def test_response_shape_and_max_sources(fake):
    response = _post({"query": "سلام", "report_type": "outline_report", "max_sources": 2})
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"report_markdown", "sources", "costs", "duration_s"}
    assert body["report_markdown"].startswith("# گزارش")
    assert len(body["sources"]) == 2
    assert set(body["sources"][0]) == {"url", "title"}
    assert body["costs"] == pytest.approx(0.001)
    assert isinstance(body["duration_s"], (int, float))


def test_concurrency_is_capped_at_two(fake):
    _FakeResearcher.delay = 0.05

    async def _burst() -> list[httpx.Response]:
        async with _client() as client:
            return await asyncio.gather(
                *[client.post("/research", json={"query": f"q{i}"}) for i in range(5)]
            )

    responses = asyncio.run(_burst())
    assert [r.status_code for r in responses] == [200] * 5
    assert fake.max_active == app.MAX_CONCURRENT_JOBS == 2
