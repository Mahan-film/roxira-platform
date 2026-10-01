"""Keyless client for a self-hosted SearXNG JSON endpoint."""

from urllib.parse import urlencode

from .provider_base import get_env_var


class SearxngSearchClient:
    BASE_URL_ENV = "SEARXNG_BASE_URL"

    def __init__(self, base_url=None, timeout=20.0):
        base_url = base_url if base_url is not None else get_env_var(self.BASE_URL_ENV, "")
        self.base_url = (base_url or "").rstrip("/")
        self.timeout = timeout

    @property
    def configured(self):
        return bool(self.base_url)

    def search(self, query, count=8):
        if not self.configured:
            return {
                "status": "ERROR",
                "provider": "searxng",
                "error": f"{self.BASE_URL_ENV} is not configured",
                "results": [],
            }

        from src.automation.web_intelligence import DEFAULT_USER_AGENT, _http_json

        url = f"{self.base_url}/search?{urlencode({'q': query, 'format': 'json'})}"
        response = _http_json(
            "GET",
            url,
            {"Accept": "application/json", "User-Agent": DEFAULT_USER_AGENT},
            timeout=self.timeout,
        )
        if response.get("status") != "SUCCESS":
            return {
                "status": "ERROR",
                "provider": "searxng",
                "error": response.get("error", "SearXNG request failed"),
                "results": [],
            }

        results = response.get("data", {}).get("results", [])
        return {
            "status": "SUCCESS",
            "provider": "searxng",
            "http_code": response.get("http_code"),
            "elapsed_ms": response.get("elapsed_ms"),
            "results": [
                {
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "content": item.get("content", ""),
                    "score": item.get("score", 0),
                    "provider": "searxng",
                }
                for item in results[:count]
            ],
        }
