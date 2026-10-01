"""Non-English / structured source adapters for the tech-radar pipeline (W9 Phase B).

docs/research/bakeoff.md confirmed tech_radar only ever called Tavily/Exa/Brave
with English queries, so every kept source was an English blog. This module
adds:

* Structured, keyless-by-default JSON API adapters — GitHub code/repo search,
  Hugging Face models/datasets, arXiv, Hacker News, ModelScope — that return the same
  ``{"title", "url", "content", "score", "provider", "source_lang"}`` shape
  ``WebIntelligence.search`` already produces, so they merge straight into
  the existing search → crawl → rerank pipeline.
* Site-restricted search adapters for communities that have no simple public
  JSON search API (Qiita, Zenn, Juejin, heise.de): these reuse the existing
  Tavily/Exa/Brave clients with a translated, ``site:`` -scoped query instead
  of inventing a bespoke scraper for each one.

Every adapter degrades to an empty, non-raising result on missing keys,
rate limits or network errors — the caller decides whether an all-empty
sourcing pass is a hard failure (see TechRadarAgent._distributed_search).
"""

from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from typing import Any

import httpx

from src.automation.provider_base import get_env_var
from src.automation.web_intelligence import DEFAULT_USER_AGENT, WebIntelligence, _http_json, _http_text

logger = logging.getLogger("roxira.tech_radar.sources")

# Community sites with no simple public JSON search API: fall back to a
# site-restricted query through the existing web search providers.
SITE_RESTRICTED_ADAPTERS: dict[str, str] = {
    "qiita": "qiita.com",
    "zenn": "zenn.dev",
    "juejin": "juejin.cn",
    "heise": "heise.de",
}


def _result(title: str, url: str, content: str, score: float, provider: str, lang: str) -> dict[str, Any]:
    return {
        "title": title,
        "url": url,
        "content": content,
        "score": score,
        "provider": provider,
        "source_lang": lang,
    }


class GitHubSearchAdapter:
    """GitHub repository search. Works unauthenticated (60 req/hr); set
    GITHUB_TOKEN to raise the limit for daily-radar/project-brief runs."""

    name = "github"

    def __init__(self, timeout: float = 20.0) -> None:
        self.token = get_env_var("GITHUB_TOKEN")
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return True  # public API works without a token

    def search(self, query: str, max_results: int = 6) -> dict[str, Any]:
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": DEFAULT_USER_AGENT,
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        url = (
            "https://api.github.com/search/repositories"
            f"?q={query.replace(' ', '+')}&sort=stars&order=desc&per_page={max_results}"
        )
        response = _http_json("GET", url, headers, timeout=self.timeout)
        if response.get("status") != "SUCCESS":
            return {"status": "ERROR", "provider": self.name, "error": response.get("error"), "results": []}
        items = response["data"].get("items", [])
        results = [
            _result(
                title=item.get("full_name", ""),
                url=item.get("html_url", ""),
                content=(
                    f"{item.get('description') or ''} | stars={item.get('stargazers_count', 0)} | "
                    f"language={item.get('language') or ''} | pushed_at={item.get('pushed_at', '')} | "
                    f"license={(item.get('license') or {}).get('spdx_id', '')}"
                ),
                score=min(1.0, (item.get("stargazers_count", 0) or 0) / 50000),
                provider=self.name,
                lang="en",
            )
            for item in items
        ]
        return {"status": "SUCCESS", "provider": self.name, "results": results}


class HuggingFaceAdapter:
    """Hugging Face Hub model search — public, keyless API."""

    name = "huggingface"

    def __init__(self, timeout: float = 20.0) -> None:
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return True

    def search(self, query: str, max_results: int = 6) -> dict[str, Any]:
        url = (
            f"https://huggingface.co/api/models?search={query.replace(' ', '+')}"
            f"&sort=downloads&direction=-1&limit={max_results}"
        )
        response = _http_json("GET", url, {"Accept": "application/json", "User-Agent": DEFAULT_USER_AGENT}, timeout=self.timeout)
        if response.get("status") != "SUCCESS":
            return {"status": "ERROR", "provider": self.name, "error": response.get("error"), "results": []}
        data = response["data"]
        items = data if isinstance(data, list) else []
        results = [
            _result(
                title=item.get("id", ""),
                url=f"https://huggingface.co/{item.get('id', '')}",
                content=(
                    f"downloads={item.get('downloads', 0)} likes={item.get('likes', 0)} "
                    f"pipeline_tag={item.get('pipeline_tag', '')} library={item.get('library_name', '')}"
                ),
                score=min(1.0, (item.get("downloads", 0) or 0) / 1_000_000),
                provider=self.name,
                lang="en",
            )
            for item in items
        ]
        return {"status": "SUCCESS", "provider": self.name, "results": results}


class ArxivAdapter:
    """arXiv Atom search API — public, keyless."""

    name = "arxiv"

    def __init__(self, timeout: float = 20.0) -> None:
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return True

    def search(self, query: str, max_results: int = 6) -> dict[str, Any]:
        url = (
            "http://export.arxiv.org/api/query"
            f"?search_query=all:{query.replace(' ', '+')}&sortBy=submittedDate&sortOrder=descending"
            f"&max_results={max_results}"
        )
        response = _http_text("GET", url, {"User-Agent": DEFAULT_USER_AGENT}, timeout=self.timeout)
        if response.get("status") != "SUCCESS":
            return {"status": "ERROR", "provider": self.name, "error": response.get("error"), "results": []}
        try:
            root = ET.fromstring(response["text"])
        except ET.ParseError as exc:
            return {"status": "ERROR", "provider": self.name, "error": f"bad Atom XML: {exc}", "results": []}
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        results = []
        for entry in root.findall("atom:entry", ns):
            title = (entry.findtext("atom:title", default="", namespaces=ns) or "").strip()
            summary = (entry.findtext("atom:summary", default="", namespaces=ns) or "").strip()
            link = entry.findtext("atom:id", default="", namespaces=ns) or ""
            results.append(_result(title=title, url=link, content=summary, score=0.5, provider=self.name, lang="en"))
        return {"status": "SUCCESS", "provider": self.name, "results": results}


class HackerNewsAdapter:
    """Hacker News story search through Algolia's free public API."""

    name = "hackernews"

    def __init__(self, timeout: float = 20.0) -> None:
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return True

    def search(self, query: str, max_results: int = 6) -> dict[str, Any]:
        try:
            with httpx.Client(timeout=self.timeout, headers={"User-Agent": DEFAULT_USER_AGENT}) as client:
                response = client.get(
                    "https://hn.algolia.com/api/v1/search",
                    params={"query": query, "tags": "story", "hitsPerPage": 10},
                )
                response.raise_for_status()
                hits = response.json().get("hits", [])
        except Exception as exc:  # noqa: BLE001 - public API isolation boundary
            return {"status": "ERROR", "provider": self.name, "error": str(exc), "results": []}

        results = []
        for hit in hits[:max_results] if isinstance(hits, list) else []:
            if not isinstance(hit, dict):
                continue
            points = hit.get("points") or 0
            comments = hit.get("num_comments") or 0
            engagement = sum(value for value in (points, comments) if isinstance(value, (int, float)))
            object_id = hit.get("objectID", "")
            url = hit.get("url") or f"https://news.ycombinator.com/item?id={object_id}"
            results.append(
                _result(
                    title=hit.get("title") or "",
                    url=url,
                    content=f"points={points} comments={comments}",
                    score=min(1.0, engagement / 1_000),
                    provider=self.name,
                    lang="en",
                )
            )
        return {"status": "SUCCESS", "provider": self.name, "results": results}


class ModelScopeAdapter:
    """ModelScope (魔搭) model listing API — best-effort: ModelScope has no
    stable public search API, so a non-200/unexpected-shape response is
    treated as an ordinary empty result, not a crash."""

    name = "modelscope"

    def __init__(self, timeout: float = 20.0) -> None:
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return True

    def search(self, query: str, max_results: int = 6) -> dict[str, Any]:
        url = "https://modelscope.cn/api/v1/dolphin/models"
        response = _http_json(
            "PUT",
            url,
            {"Content-Type": "application/json", "User-Agent": DEFAULT_USER_AGENT},
            payload={"PageSize": max_results, "PageNumber": 1, "Query": query},
            timeout=self.timeout,
        )
        if response.get("status") != "SUCCESS":
            logger.info("modelscope adapter unavailable (best-effort): %s", response.get("error"))
            return {"status": "SUCCESS", "provider": self.name, "results": []}
        try:
            items = response["data"]["Data"]["Model"]["Models"]
        except (KeyError, TypeError):
            return {"status": "SUCCESS", "provider": self.name, "results": []}
        results = [
            _result(
                title=item.get("Name", ""),
                url=f"https://modelscope.cn/models/{item.get('Path', '')}",
                content=f"{item.get('ChineseName', '')} downloads={item.get('Downloads', 0)}",
                score=0.4,
                provider=self.name,
                lang="zh",
            )
            for item in items
            if isinstance(item, dict)
        ]
        return {"status": "SUCCESS", "provider": self.name, "results": results}


class SiteRestrictedAdapter:
    """Qiita / Zenn / Juejin / heise via the existing Tavily/Exa/Brave clients,
    scoped with a ``site:`` query in the community's own language."""

    def __init__(self, key: str, web: WebIntelligence) -> None:
        self.name = key
        self.domain = SITE_RESTRICTED_ADAPTERS[key]
        self.web = web

    @property
    def configured(self) -> bool:
        return any(self.web.providers().values())

    def search(self, query: str, max_results: int = 6, lang: str = "") -> dict[str, Any]:
        scoped_query = f"site:{self.domain} {query}"
        response = self.web.search(scoped_query, max_results=max_results)
        results = [
            {**item, "provider": self.name, "source_lang": lang or item.get("source_lang", "")}
            for item in response.get("results", [])
        ]
        status = "SUCCESS" if response.get("status") in ("SUCCESS", "EMPTY") else response.get("status", "ERROR")
        return {"status": status, "provider": self.name, "results": results}


def structured_adapters() -> list[Any]:
    """API-based adapters that never need the web search providers."""
    return [GitHubSearchAdapter(), HuggingFaceAdapter(), ArxivAdapter(), HackerNewsAdapter(), ModelScopeAdapter()]


def site_restricted_adapters(web: WebIntelligence) -> list[SiteRestrictedAdapter]:
    return [SiteRestrictedAdapter(key, web) for key in SITE_RESTRICTED_ADAPTERS]
