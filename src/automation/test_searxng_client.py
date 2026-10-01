from src.automation.searxng_client import SearxngSearchClient


def test_unconfigured_search_skips_http(monkeypatch):
    called = False

    def fake_http(*args, **kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr("src.automation.web_intelligence._http_json", fake_http)
    result = SearxngSearchClient(base_url="").search("test")

    assert result["status"] == "ERROR"
    assert result["results"] == []
    assert not called


def test_search_maps_and_limits_results(monkeypatch):
    seen_url = ""

    def fake_http(method, url, headers, timeout):
        nonlocal seen_url
        seen_url = url
        return {
            "status": "SUCCESS",
            "http_code": 200,
            "elapsed_ms": 4,
            "data": {"results": [
                {"title": "one", "url": "https://one", "content": "first", "score": 1},
                {"title": "two", "url": "https://two", "content": "second"},
            ]},
        }

    monkeypatch.setattr("src.automation.web_intelligence._http_json", fake_http)
    result = SearxngSearchClient("http://127.0.0.1:8888/").search("test query", 1)

    assert seen_url.startswith("http://127.0.0.1:8888/search?")
    assert "format=json" in seen_url
    assert result["results"] == [{"title": "one", "url": "https://one", "content": "first", "score": 1, "provider": "searxng"}]


def test_search_returns_error_for_failed_response(monkeypatch):
    monkeypatch.setattr(
        "src.automation.web_intelligence._http_json",
        lambda *args, **kwargs: {"status": "ERROR", "error": "offline"},
    )

    result = SearxngSearchClient("http://127.0.0.1:8888").search("test")

    assert result["status"] == "ERROR"
    assert result["error"] == "offline"
    assert result["results"] == []
