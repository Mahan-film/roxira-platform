from unittest.mock import patch

from src.automation.ddgs_client import DdgsSearchClient


def test_ddgs_search_maps_results_and_honors_count():
    backend = lambda query, count: [
        {"title": "One", "href": "https://one.test", "body": "first"},
        {"title": "Two", "href": "https://two.test", "body": "second"},
    ]

    client = DdgsSearchClient(backend=backend)
    result = client.search("query", count=1)

    assert client.configured is True
    assert result["status"] == "SUCCESS"
    assert result["results"] == [
        {"title": "One", "url": "https://one.test", "content": "first", "score": 0, "provider": "ddgs"}
    ]


def test_ddgs_search_returns_errors_and_rate_limits():
    client = DdgsSearchClient(backend=lambda query, count: (_ for _ in ()).throw(RuntimeError("limited")))
    result = client.search("query")
    assert result["status"] == "ERROR"
    assert result["results"] == []

    client = DdgsSearchClient(backend=lambda query, count: [], min_interval_s=5)
    with patch("src.automation.ddgs_client._sleep") as sleep:
        client.search("one")
        client.search("two")
    assert sleep.call_count == 1
