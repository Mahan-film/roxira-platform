"""roxira-research: self-hosted deep-research API (PUBLIC questions only).

Thin FastAPI wrapper around GPTResearcher. Do NOT send customer/case data here:
all LLM calls go through the key-pool ``agent-free`` group, which may route to
free models that log or train on prompts (AGENTS.md section 4). See
``docs/infra/RESEARCH_SERVICE.md``.
"""
from __future__ import annotations

import asyncio
import inspect
import logging
import os
import secrets
import time
from typing import Any, Literal

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

try:
    from gpt_researcher import GPTResearcher
except ImportError:  # keeps this module importable for the offline unit tests
    GPTResearcher = None  # type: ignore[assignment]

logger = logging.getLogger("roxira_research")

MAX_CONCURRENT_JOBS = 2
JOB_TIMEOUT_S = 900

# Short API language codes mapped to the names the researcher's prompt layer uses.
_LANGUAGE_NAMES = {"fa": "persian", "en": "english", "ar": "arabic"}

_semaphore: asyncio.Semaphore | None = None
_semaphore_loop: asyncio.AbstractEventLoop | None = None


def _get_semaphore() -> asyncio.Semaphore:
    """Return a semaphore bound to the running loop (at most MAX_CONCURRENT_JOBS)."""
    global _semaphore, _semaphore_loop
    loop = asyncio.get_running_loop()
    if _semaphore is None or _semaphore_loop is not loop:
        _semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)
        _semaphore_loop = loop
    return _semaphore


class ResearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    report_type: Literal["research_report", "resource_report", "outline_report"] = "research_report"
    tone: str | None = None
    max_sources: int | None = Field(default=None, ge=1, le=20)
    language: str = "fa"


class Source(BaseModel):
    url: str
    title: str = ""


class ResearchResponse(BaseModel):
    report_markdown: str
    sources: list[Source]
    costs: float | None = None
    duration_s: float


app = FastAPI(title="roxira-research", version="0.1.0")


def _require_auth(authorization: str | None) -> None:
    token = os.environ.get("RESEARCH_TOKEN")
    if not token:
        return
    expected = f"Bearer {token}"
    if not authorization or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


def _filter_kwargs(factory: Any, kwargs: dict[str, Any]) -> dict[str, Any]:
    """Drop kwargs the researcher's constructor does not accept."""
    try:
        params = inspect.signature(factory).parameters
    except (TypeError, ValueError):
        return kwargs
    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return kwargs
    return {k: v for k, v in kwargs.items() if k in params}


def _build_researcher(request: ResearchRequest) -> Any:
    if GPTResearcher is None:
        raise HTTPException(status_code=503, detail="gpt-researcher is not installed")
    if request.language:
        os.environ["LANGUAGE"] = _LANGUAGE_NAMES.get(request.language.lower(), request.language)
    kwargs: dict[str, Any] = {"query": request.query, "report_type": request.report_type}
    if request.tone:
        kwargs["tone"] = request.tone
    return GPTResearcher(**_filter_kwargs(GPTResearcher, kwargs))


def _extract_sources(researcher: Any, limit: int | None) -> list[Source]:
    raw: Any = None
    for method in ("get_research_sources", "get_source_urls"):
        getter = getattr(researcher, method, None)
        if callable(getter):
            try:
                raw = getter()
            except Exception:
                raw = None
            if raw:
                break
    sources: list[Source] = []
    seen: set[str] = set()
    for item in raw or []:
        if isinstance(item, dict):
            url = str(item.get("url") or item.get("href") or "")
            title = str(item.get("title") or "")
        else:
            url, title = str(item), ""
        if not url or url in seen:
            continue
        seen.add(url)
        sources.append(Source(url=url, title=title))
        if limit and len(sources) >= limit:
            break
    return sources


def _extract_costs(researcher: Any) -> float | None:
    getter = getattr(researcher, "get_costs", None)
    if not callable(getter):
        return None
    try:
        return float(getter())
    except Exception:
        return None


async def _run_research(request: ResearchRequest) -> ResearchResponse:
    started = time.monotonic()
    logger.info("research start report_type=%s language=%s", request.report_type, request.language)
    researcher = _build_researcher(request)
    await researcher.conduct_research()
    report = await researcher.write_report()
    response = ResearchResponse(
        report_markdown=report or "",
        sources=_extract_sources(researcher, request.max_sources),
        costs=_extract_costs(researcher),
        duration_s=round(time.monotonic() - started, 3),
    )
    logger.info(
        "research done sources=%d duration_s=%s",
        len(response.sources),
        response.duration_s,
    )
    return response


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/research", response_model=ResearchResponse)
async def research(
    request: ResearchRequest,
    authorization: str | None = Header(default=None),
) -> ResearchResponse:
    _require_auth(authorization)
    semaphore = _get_semaphore()

    async def _bounded() -> ResearchResponse:
        async with semaphore:
            return await _run_research(request)

    try:
        return await asyncio.wait_for(_bounded(), timeout=JOB_TIMEOUT_S)
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="research timed out") from exc
