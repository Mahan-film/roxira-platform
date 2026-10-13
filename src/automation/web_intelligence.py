from __future__ import annotations

import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from src.automation.provider_base import get_env_var, get_env_var_any

ROTATION_HTTP_CODES = {401, 402, 403, 429, 432}
DEFAULT_USER_AGENT = "RoxiraWebIntelligence/1.0 (+https://roxira.net)"


def _split_keys(raw: str) -> List[str]:
    return [part.strip() for part in raw.split(",") if part.strip()]


def _http_json(
    method: str,
    url: str,
    headers: Dict[str, str],
    payload: Optional[Dict[str, Any]] = None,
    timeout: float = 30.0,
) -> Dict[str, Any]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(
            request, timeout=timeout, context=ssl.create_default_context()
        ) as response:
            body = response.read().decode("utf-8", errors="replace")
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            try:
                parsed = json.loads(body) if body else {}
            except json.JSONDecodeError:
                parsed = {"raw": body}
            return {
                "status": "SUCCESS",
                "http_code": response.status,
                "elapsed_ms": round(elapsed_ms, 2),
                "data": parsed,
            }
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"raw": raw[:500]}
        return {
            "status": "ERROR",
            "http_code": exc.code,
            "elapsed_ms": round(elapsed_ms, 2),
            "error": parsed,
        }
    except Exception as exc:  # noqa: BLE001 - network isolation boundary
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        return {
            "status": "ERROR",
            "http_code": 0,
            "elapsed_ms": round(elapsed_ms, 2),
            "error": str(exc),
        }


def _http_text(
    method: str,
    url: str,
    headers: Dict[str, str],
    timeout: float = 30.0,
) -> Dict[str, Any]:
    request = urllib.request.Request(url, headers=headers, method=method)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(
            request, timeout=timeout, context=ssl.create_default_context()
        ) as response:
            body = response.read().decode("utf-8", errors="replace")
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            return {
                "status": "SUCCESS",
                "http_code": response.status,
                "elapsed_ms": round(elapsed_ms, 2),
                "text": body,
            }
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        return {
            "status": "ERROR",
            "http_code": exc.code,
            "error": raw[:500],
        }
    except Exception as exc:  # noqa: BLE001
        return {"status": "ERROR", "http_code": 0, "error": str(exc)}


class KeyPool:
    """Round-robin API key pool with automatic quarantine on auth/quota failures."""

    def __init__(self, keys: List[str], env_name: str) -> None:
        self.env_name = env_name
        self._keys = list(keys)
        self._disabled: Dict[str, int] = {}
        self._cursor = 0

    @classmethod
    def from_env(cls, env_name: str) -> "KeyPool":
        return cls(_split_keys(get_env_var(env_name)), env_name)

    @classmethod
    def from_env_any(cls, env_names: List[str]) -> "KeyPool":
        """Same as `from_env`, but accepts the first non-empty of several
        candidate env var names (production `.env` key-name aliases;
        see provider_base.get_env_var_any)."""
        return cls(_split_keys(get_env_var_any(env_names)), env_names[0])

    @property
    def configured(self) -> bool:
        return any(self._is_active(key) for key in self._keys)

    def active_keys(self) -> List[str]:
        return [key for key in self._keys if self._is_active(key)]

    def _is_active(self, key: str) -> bool:
        return key and self._disabled.get(key, 0) == 0

    def disable(self, key: str) -> None:
        if key in self._keys:
            self._disabled[key] = 1

    def next(self) -> Optional[str]:
        total = len(self._keys)
        for _ in range(total):
            key = self._keys[self._cursor % total] if total else None
            self._cursor += 1
            if key and self._is_active(key):
                return key
        return None


class TavilySearchClient:
    API_KEY_ENV = "TAVILY_API_KEYS"
    # Production `.env` on the prod server uses this name instead (confirmed by a
    # live W9 run 2026-09-24) — see provider_base.get_env_var_any.
    API_KEY_ENV_ALIASES = ("TAVILY_API_KEYS", "TAVILY_KEYS")

    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout: float = 30.0,
        pool: Optional[KeyPool] = None,
    ) -> None:
        self.base_url = (base_url or get_env_var("TAVILY_BASE_URL", "https://api.tavily.com")).rstrip("/")
        self.timeout = timeout
        self.pool = pool or KeyPool.from_env_any(list(self.API_KEY_ENV_ALIASES))

    @property
    def configured(self) -> bool:
        return self.pool.configured

    def search(
        self,
        query: str,
        max_results: int = 8,
        search_depth: str = "basic",
        include_answer: bool = False,
    ) -> Dict[str, Any]:
        if not self.configured:
            return {"status": "ERROR", "error": f"{self.API_KEY_ENV} is missing", "results": []}

        attempts: List[Dict[str, Any]] = []
        while True:
            api_key = self.pool.next()
            if not api_key:
                break
            payload = {
                "api_key": api_key,
                "query": query,
                "max_results": max_results,
                "search_depth": search_depth,
                "include_answer": include_answer,
            }
            response = _http_json(
                "POST",
                f"{self.base_url}/search",
                {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": DEFAULT_USER_AGENT,
                },
                payload=payload,
                timeout=self.timeout,
            )
            if response.get("status") == "SUCCESS":
                raw = response["data"].get("results", [])
                results = [
                    {
                        "title": item.get("title", ""),
                        "url": item.get("url", ""),
                        "content": item.get("content", ""),
                        "score": item.get("score", 0.0),
                        "provider": "tavily",
                    }
                    for item in raw
                ]
                return {
                    "status": "SUCCESS",
                    "provider": "tavily",
                    "http_code": response.get("http_code"),
                    "elapsed_ms": response.get("elapsed_ms"),
                    "answer": response["data"].get("answer"),
                    "results": results,
                }
            attempts.append(response)
            if response.get("http_code") in ROTATION_HTTP_CODES:
                self.pool.disable(api_key)
                continue
            break
        return {
            "status": "ERROR",
            "provider": "tavily",
            "error": attempts[-1].get("error") if attempts else "no active key",
            "attempts": len(attempts),
            "results": [],
        }


class ExaSearchClient:
    API_KEY_ENV = "EXA_API_KEY"

    def __init__(self, base_url: Optional[str] = None, timeout: float = 30.0) -> None:
        self.api_key = get_env_var(self.API_KEY_ENV)
        self.base_url = (base_url or get_env_var("EXA_BASE_URL", "https://api.exa.ai")).rstrip("/")
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def search(
        self,
        query: str,
        num_results: int = 8,
        include_text: bool = True,
    ) -> Dict[str, Any]:
        if not self.configured:
            return {"status": "ERROR", "error": f"{self.API_KEY_ENV} is missing", "results": []}

        payload = {
            "query": query,
            "numResults": num_results,
            "contents": {"text": include_text},
        }
        response = _http_json(
            "POST",
            f"{self.base_url}/search",
            {
                "x-api-key": self.api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": DEFAULT_USER_AGENT,
            },
            payload=payload,
            timeout=self.timeout,
        )
        if response.get("status") != "SUCCESS":
            return {"status": "ERROR", "provider": "exa", "error": response.get("error"), "results": []}

        results = [
            {
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "content": item.get("text", "") or item.get("summary", ""),
                "score": item.get("score", 0.0),
                "provider": "exa",
            }
            for item in response["data"].get("results", [])
        ]
        return {
            "status": "SUCCESS",
            "provider": "exa",
            "http_code": response.get("http_code"),
            "elapsed_ms": response.get("elapsed_ms"),
            "results": results,
        }


class BraveSearchClient:
    API_KEY_ENV = "BRAVE_SEARCH_API_KEY"
    # Production `.env` on the prod server uses this name instead (confirmed by a
    # live W9 run 2026-09-24, per docs/STRATEGY.md §6 "known facts") — without
    # this fallback, .configured is silently False on the server and Brave
    # never runs (a real instance of the "missing keys" degraded-run gap,
    # W9 live-ready). See provider_base.get_env_var_any.
    API_KEY_ENV_ALIASES = ("BRAVE_SEARCH_API_KEY", "BRAVE_API_KEY")

    def __init__(self, base_url: Optional[str] = None, timeout: float = 30.0) -> None:
        self.api_key = get_env_var_any(list(self.API_KEY_ENV_ALIASES))
        self.base_url = (
            base_url or get_env_var("BRAVE_SEARCH_BASE_URL", "https://api.search.brave.com/res/v1")
        ).rstrip("/")
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def search(self, query: str, count: int = 8) -> Dict[str, Any]:
        if not self.configured:
            return {
                "status": "ERROR",
                "error": f"none of {', '.join(self.API_KEY_ENV_ALIASES)} is set",
                "results": [],
            }

        params = urllib.parse.urlencode({"q": query, "count": count})
        response = _http_json(
            "GET",
            f"{self.base_url}/web/search?{params}",
            {
                "X-Subscription-Token": self.api_key,
                "Accept": "application/json",
                "User-Agent": DEFAULT_USER_AGENT,
            },
            timeout=self.timeout,
        )
        if response.get("status") != "SUCCESS":
            return {
                "status": "ERROR",
                "provider": "brave",
                "error": response.get("error"),
                "results": [],
            }

        results = [
            {
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "content": item.get("description", ""),
                "score": 0.0,
                "provider": "brave",
            }
            for item in response["data"].get("web", {}).get("results", [])
        ]
        return {
            "status": "SUCCESS",
            "provider": "brave",
            "http_code": response.get("http_code"),
            "elapsed_ms": response.get("elapsed_ms"),
            "results": results,
        }


class FirecrawlScraper:
    API_KEY_ENV = "FIRECRAWL_API_KEY"

    def __init__(self, base_url: Optional[str] = None, timeout: float = 45.0) -> None:
        self.api_key = get_env_var(self.API_KEY_ENV)
        self.base_url = (base_url or get_env_var("FIRECRAWL_BASE_URL", "https://api.firecrawl.dev")).rstrip("/")
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def scrape(self, url: str) -> Dict[str, Any]:
        if not self.configured:
            return {"status": "ERROR", "error": f"{self.API_KEY_ENV} is missing"}
        response = _http_json(
            "POST",
            f"{self.base_url}/v1/scrape",
            {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": DEFAULT_USER_AGENT,
            },
            payload={"url": url, "formats": ["markdown"], "onlyMainContent": True},
            timeout=self.timeout,
        )
        if response.get("status") != "SUCCESS":
            return {"status": "ERROR", "engine": "firecrawl", "error": response.get("error")}
        data = response["data"].get("data", {})
        return {
            "status": "SUCCESS",
            "engine": "firecrawl",
            "url": url,
            "markdown": data.get("markdown", ""),
            "title": data.get("metadata", {}).get("title", ""),
            "http_code": response.get("http_code"),
            "elapsed_ms": response.get("elapsed_ms"),
        }


class JinaReaderScraper:
    API_KEY_ENV = "JINA_API_KEY"

    def __init__(self, base_url: str = "https://r.jina.ai", timeout: float = 45.0) -> None:
        self.api_key = get_env_var(self.API_KEY_ENV)
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def scrape(self, url: str) -> Dict[str, Any]:
        headers = {
            "Accept": "text/plain",
            "User-Agent": DEFAULT_USER_AGENT,
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        response = _http_text("GET", f"{self.base_url}/{url}", headers, timeout=self.timeout)
        if response.get("status") != "SUCCESS":
            return {"status": "ERROR", "engine": "jina", "error": response.get("error")}
        return {
            "status": "SUCCESS",
            "engine": "jina",
            "url": url,
            "markdown": response["text"],
            "title": "",
            "http_code": response.get("http_code"),
            "elapsed_ms": response.get("elapsed_ms"),
        }


class JinaReranker:
    API_KEY_ENV = "JINA_API_KEY"
    DEFAULT_MODEL = "jina-reranker-v2-base-multilingual"

    def __init__(
        self,
        base_url: str = "https://api.jina.ai",
        model: Optional[str] = None,
        timeout: float = 30.0,
    ) -> None:
        self.api_key = get_env_var(self.API_KEY_ENV)
        self.base_url = base_url.rstrip("/")
        self.model = model or get_env_var("JINA_RERANK_MODEL", self.DEFAULT_MODEL)
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def rerank(
        self,
        query: str,
        documents: List[str],
        top_n: Optional[int] = None,
    ) -> Dict[str, Any]:
        if not self.configured:
            return {"status": "ERROR", "error": f"{self.API_KEY_ENV} is missing", "results": []}
        if not documents:
            return {"status": "SUCCESS", "provider": "jina-reranker", "results": []}

        payload: Dict[str, Any] = {
            "model": self.model,
            "query": query,
            "documents": documents,
            "return_documents": False,
        }
        if top_n:
            payload["top_n"] = top_n

        response = _http_json(
            "POST",
            f"{self.base_url}/v1/rerank",
            {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": DEFAULT_USER_AGENT,
            },
            payload=payload,
            timeout=self.timeout,
        )
        if response.get("status") != "SUCCESS":
            return {
                "status": "ERROR",
                "provider": "jina-reranker",
                "error": response.get("error"),
                "results": [],
            }

        results = [
            {
                "index": item.get("index"),
                "relevance_score": item.get("relevance_score", 0.0),
                "document": documents[item["index"]] if item.get("index") is not None else "",
            }
            for item in response["data"].get("results", [])
        ]
        return {
            "status": "SUCCESS",
            "provider": "jina-reranker",
            "model": self.model,
            "elapsed_ms": response.get("elapsed_ms"),
            "results": results,
        }


FREE_FIRST_ORDER = ("searxng", "ddgs", "tavily")
PAID_CAPABLE = frozenset({"exa", "brave"})


def _search_order(engines):
    if engines is not None:
        return engines
    configured_order = os.getenv("RESEARCH_SEARCH_ORDER")
    if configured_order:
        return tuple(engine.strip() for engine in configured_order.split(",") if engine.strip())
    return FREE_FIRST_ORDER


class WebIntelligence:
    """Unified facade for multi-provider neural search, clean scraping and RAG reranking."""

    def __init__(
        self,
        tavily: Optional[TavilySearchClient] = None,
        exa: Optional[ExaSearchClient] = None,
        brave: Optional[BraveSearchClient] = None,
        firecrawl: Optional[FirecrawlScraper] = None,
        jina_reader: Optional[JinaReaderScraper] = None,
        jina_reranker: Optional[JinaReranker] = None,
        searxng: Optional[Any] = None,
        ddgs: Optional[Any] = None,
        local_reranker: Optional[Any] = None,
    ) -> None:
        from src.automation.ddgs_client import DdgsSearchClient
        from src.automation.searxng_client import SearxngSearchClient

        self.tavily = tavily or TavilySearchClient()
        self.exa = exa or ExaSearchClient()
        self.brave = brave or BraveSearchClient()
        self.firecrawl = firecrawl or FirecrawlScraper()
        self.jina_reader = jina_reader or JinaReaderScraper()
        self.jina_reranker = jina_reranker or JinaReranker()
        self.local_reranker = local_reranker
        if self.local_reranker is None and os.environ.get("ROXIRA_LOCAL_RERANK") == "1":
            from src.automation.local_reranker import LocalReranker

            self.local_reranker = LocalReranker()
        self.searxng = searxng if searxng is not None else SearxngSearchClient()
        self.ddgs = ddgs if ddgs is not None else DdgsSearchClient()

    def providers(self) -> Dict[str, bool]:
        return {
            "searxng": self.searxng.configured,
            "ddgs": self.ddgs.configured,
            "tavily": self.tavily.configured,
            "exa": self.exa.configured,
            "brave": self.brave.configured,
            "firecrawl": self.firecrawl.configured,
            "jina_reader": self.jina_reader.configured,
            "jina_reranker": self.jina_reranker.configured,
        }

    def search(
        self,
        query: str,
        max_results: int = 8,
        engines: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        order = _search_order(engines)
        clients = {
            "searxng": lambda: self.searxng.search(query, count=max_results),
            "ddgs": lambda: self.ddgs.search(query, count=max_results),
            "tavily": lambda: self.tavily.search(query, max_results=max_results),
            "exa": lambda: self.exa.search(query, num_results=max_results),
            "brave": lambda: self.brave.search(query, count=max_results),
        }

        aggregated: List[Dict[str, Any]] = []
        traces: Dict[str, Any] = {}
        seen_urls: set[str] = set()
        allow_paid = os.getenv("RESEARCH_ALLOW_PAID") == "1"
        for engine in order:
            if engine in PAID_CAPABLE and not allow_paid:
                traces[engine] = {"status": "SKIPPED_PAID"}
                continue
            if len(aggregated) >= max_results:
                traces[engine] = {"status": "NOT_NEEDED"}
                continue
            if engine in {"searxng", "ddgs", "tavily", "exa", "brave"} and not getattr(
                getattr(self, engine, None), "configured", True
            ):
                traces[engine] = {"status": "SKIPPED_UNCONFIGURED"}
                continue
            runner = clients.get(engine)
            if runner is None:
                traces[engine] = {"status": "UNKNOWN_ENGINE"}
                continue
            response = runner()
            traces[engine] = {
                "status": response.get("status"),
                "http_code": response.get("http_code"),
                "elapsed_ms": response.get("elapsed_ms"),
                "count": len(response.get("results", [])),
            }
            for item in response.get("results", []):
                url = item.get("url", "")
                if url and url in seen_urls:
                    continue
                if url:
                    seen_urls.add(url)
                aggregated.append(item)
                if len(aggregated) >= max_results:
                    break

        return {
            "status": "SUCCESS" if aggregated else "EMPTY",
            "query": query,
            "providers": traces,
            "results": aggregated,
        }

    def scrape_clean_markdown(self, url: str, engine: str = "auto") -> Dict[str, Any]:
        if engine in ("firecrawl", "auto") and self.firecrawl.configured:
            result = self.firecrawl.scrape(url)
            if result.get("status") == "SUCCESS" and result.get("markdown"):
                return result
            if engine == "firecrawl":
                return result

        if engine in ("jina", "auto"):
            result = self.jina_reader.scrape(url)
            if result.get("status") == "SUCCESS":
                return result
            return result

        return {"status": "ERROR", "error": "no scraping engine could handle the request"}

    def rerank_documents(
        self,
        query: str,
        documents: List[Any],
        top_n: Optional[int] = None,
        text_key: str = "content",
    ) -> Dict[str, Any]:
        if not documents:
            return {"status": "SUCCESS", "results": []}

        texts: List[str] = []
        for doc in documents:
            if isinstance(doc, str):
                texts.append(doc)
            elif isinstance(doc, dict):
                texts.append(str(doc.get(text_key, "")))
            else:
                texts.append(str(doc))

        if self.local_reranker is not None:
            response = self.local_reranker.rerank(query, texts, top_n=top_n)
            if response.get("status") == "SUCCESS":
                return {"status": "SUCCESS", "provider": "local-bge", "results": [
                    {"document": documents[item["index"]], "relevance_score": item["score"]}
                    for item in response["results"]
                ]}
        response = self.jina_reranker.rerank(query, texts, top_n=top_n)
        if response.get("status") != "SUCCESS":
            return response

        reranked: List[Dict[str, Any]] = []
        for item in response["results"]:
            index = item.get("index")
            source = documents[index] if index is not None and index < len(documents) else {}
            reranked.append(
                {
                    "document": source,
                    "relevance_score": item.get("relevance_score", 0.0),
                }
            )
        return {
            "status": "SUCCESS",
            "provider": "jina-reranker",
            "model": response.get("model"),
            "elapsed_ms": response.get("elapsed_ms"),
            "results": reranked,
        }
