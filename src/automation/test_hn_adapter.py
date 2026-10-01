"""Unit tests for the Hacker News Algolia source adapter."""

from __future__ import annotations

import httpx

from src.automation import source_adapters


def _adapter_with_transport(monkeypatch, handler):
    real_client = httpx.Client
    transport = httpx.MockTransport(handler)

    class FakeClient:
        def __init__(self, **kwargs):
            self.client = real_client(transport=transport, **kwargs)

        def __enter__(self):
            return self.client

        def __exit__(self, *args):
            self.client.close()

    monkeypatch.setattr(source_adapters.httpx, "Client", FakeClient)
    return source_adapters.HackerNewsAdapter()


def test_hn_search_maps_story_hits(monkeypatch):
    seen = {}

    def handler(request):
        seen["host"] = request.url.host
        seen["params"] = dict(request.url.params)
        return httpx.Response(
            200,
            json={"hits": [{"title": "Useful agent tool", "url": "https://example.com/tool", "points": 120, "num_comments": 35}]},
        )

    result = _adapter_with_transport(monkeypatch, handler).search("agent tooling")

    assert result["status"] == "SUCCESS"
    assert seen == {"host": "hn.algolia.com", "params": {"query": "agent tooling", "tags": "story", "hitsPerPage": "10"}}
    assert result["results"] == [{"title": "Useful agent tool", "url": "https://example.com/tool", "content": "points=120 comments=35", "score": 0.155, "provider": "hackernews", "source_lang": "en"}]


def test_hn_search_uses_discussion_url_when_story_url_is_missing(monkeypatch):
    adapter = _adapter_with_transport(
        monkeypatch,
        lambda request: httpx.Response(200, json={"hits": [{"title": "Ask HN", "objectID": "42", "points": 1, "num_comments": 2}]}),
    )

    result = adapter.search("ask")

    assert result["results"][0]["url"] == "https://news.ycombinator.com/item?id=42"


def test_hn_search_returns_no_results_on_http_error(monkeypatch):
    adapter = _adapter_with_transport(monkeypatch, lambda request: httpx.Response(503))

    result = adapter.search("offline")

    assert result["results"] == []
