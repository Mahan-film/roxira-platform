"""search_with_fallback(query): wraps the existing src/automation search clients.

Clients are injected through a small protocol (`.search(query) -> dict` with
`status`/`results`), so tests use fakes. Real clients are built lazily.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

from src.ops_fallback.chains import Cooldown, StepFailure, run_with_fallback
from src.ops_fallback.loader import active_steps, load_config


class SearchClient(Protocol):
    def search(self, query: str) -> dict[str, Any]: ...


_COOLDOWN = Cooldown()


def default_clients() -> dict[str, SearchClient]:
    from src.automation.web_intelligence import (
        BraveSearchClient,
        ExaSearchClient,
        TavilySearchClient,
    )

    return {
        "tavily": TavilySearchClient(),
        "brave": BraveSearchClient(),
        "exa": ExaSearchClient(),
    }


def search_with_fallback(
    query: str,
    *,
    clients: Mapping[str, SearchClient] | None = None,
    config: dict[str, Any] | None = None,
    env: Mapping[str, str] | None = None,
    cooldown: Cooldown | None = None,
    chain: str = "search_web",
) -> dict[str, Any]:
    """Returns {"results", "provider", "attempts"}; raises AllStepsFailed.

    Steps with no key or no client (jina has no search client yet) are
    skipped. An empty result list counts as a failure so the next step runs.
    """
    cfg = config or load_config()
    pool = clients if clients is not None else default_clients()
    steps = [s for s in active_steps(cfg, chain, env) if s in pool]

    def call(name: str) -> list:
        resp = pool[name].search(query)
        if resp.get("status") != "SUCCESS":
            code = resp.get("http_code")
            raise StepFailure(code if isinstance(code, int) and code else None)
        results = resp.get("results") or []
        if not results:
            raise StepFailure(None, "empty")
        return results

    out = run_with_fallback(steps, call, cooldown=cooldown or _COOLDOWN)
    return {"results": out["result"], "provider": out["step"], "attempts": out["attempts"]}
