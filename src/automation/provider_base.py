from __future__ import annotations

import json
import os
import pathlib
import ssl
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

ENV_CANDIDATES = [
    pathlib.Path.cwd() / ".env",
    pathlib.Path("/opt/roxira_platform/.env"),
    pathlib.Path("/app/.env"),
]

_ENV_CACHE: Dict[str, str] = {}
_ENV_LOADED = False


def _load_env_file() -> None:
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    _ENV_LOADED = True
    for env_file in ENV_CANDIDATES:
        if not env_file.is_file():
            continue
        try:
            for raw_line in env_file.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                _ENV_CACHE.setdefault(key.strip(), value.strip().strip("'\""))
        except OSError:
            continue


def get_env_var(name: str, default: str = "") -> str:
    if os.environ.get(name):
        return os.environ[name]
    _load_env_file()
    return _ENV_CACHE.get(name, default)


def get_env_var_any(names: List[str], default: str = "") -> str:
    """Return the first non-empty value among several candidate env var names.

    A live W9 run against the production server (2026-09-24) found its `.env`
    actually sets `BRAVE_API_KEY` and `TAVILY_KEYS`, not the
    `BRAVE_SEARCH_API_KEY` / `TAVILY_API_KEYS` names the search clients in
    web_intelligence.py were hardcoded to — both providers were silently
    "not configured" despite valid keys being present, exactly the systemic
    gap docs/research/bakeoff.md §1 finding 5 warned about. Callers should
    list the documented/canonical name first, then any known production
    alias.
    """
    for name in names:
        value = get_env_var(name)
        if value:
            return value
    return default


class OpenAICompatibleClient:
    BASE_URL = ""
    API_KEY_ENV = ""
    DEFAULT_MODEL = ""
    HEALTH_PATH = "/models"
    CHAT_PATH = "/chat/completions"

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        default_model: Optional[str] = None,
        timeout: float = 30.0,
    ) -> None:
        self.api_key = api_key or get_env_var(self.API_KEY_ENV)
        self.base_url = (base_url or self.BASE_URL).rstrip("/")
        self.default_model = default_model or self.DEFAULT_MODEL
        self.timeout = timeout
        self._ssl_ctx = ssl.create_default_context()

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "RoxiraFactoryEngine/1.0 (+https://roxira.net)",
        }

    def _request(
        self,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        if not self.configured:
            return {"status": "ERROR", "error": f"{self.API_KEY_ENV} is missing", "http_code": 0}

        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(
            self._url(path), data=data, headers=self._headers(), method=method
        )
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(
                req, timeout=timeout or self.timeout, context=self._ssl_ctx
            ) as resp:
                body = resp.read().decode("utf-8")
                elapsed_ms = (time.perf_counter() - started) * 1000.0
                return {
                    "status": "SUCCESS",
                    "http_code": resp.status,
                    "elapsed_ms": round(elapsed_ms, 2),
                    "data": json.loads(body) if body else {},
                }
        except urllib.error.HTTPError as exc:
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = {"raw": raw[:500]}
            return {
                "status": "ERROR",
                "http_code": exc.code,
                "elapsed_ms": round(elapsed_ms, 2),
                "error": parsed,
            }
        except Exception as exc:
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            return {
                "status": "ERROR",
                "http_code": 0,
                "elapsed_ms": round(elapsed_ms, 2),
                "error": str(exc),
            }

    def health(self, timeout: Optional[float] = None) -> Dict[str, Any]:
        return self._request("GET", self.HEALTH_PATH, timeout=timeout)

    def list_models(self) -> List[str]:
        result = self.health()
        if result.get("status") != "SUCCESS":
            return []
        return [m.get("id", "") for m in result.get("data", {}).get("data", []) if m.get("id")]

    def measure_latency(self, samples: int = 3, budget_ms: float = 200.0) -> Dict[str, Any]:
        timings: List[float] = []
        codes: List[int] = []
        for _ in range(max(1, samples)):
            result = self.health()
            codes.append(int(result.get("http_code", 0)))
            if result.get("elapsed_ms") is not None:
                timings.append(float(result["elapsed_ms"]))
        if not timings:
            return {"samples_ms": [], "min_ms": None, "avg_ms": None,
                    "within_budget": False, "budget_ms": budget_ms, "http_codes": codes}
        return {
            "samples_ms": timings,
            "min_ms": round(min(timings), 2),
            "avg_ms": round(sum(timings) / len(timings), 2),
            "within_budget": max(timings) <= budget_ms,
            "budget_ms": budget_ms,
            "http_codes": codes,
        }

    def chat(
        self,
        prompt: str,
        system_prompt: str = "You are an expert software engineer.",
        model: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: int = 1024,
        json_mode: bool = False,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "model": model or self.default_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        result = self._request("POST", self.CHAT_PATH, payload=payload, timeout=timeout)
        if result.get("status") != "SUCCESS":
            return result

        try:
            content = result["data"]["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            return {"status": "ERROR", "error": f"malformed response: {exc}"}
        return {
            "status": "SUCCESS",
            "model": payload["model"],
            "elapsed_ms": result.get("elapsed_ms"),
            "content": content,
        }


# نگاشت سلسله‌مراتبی مدل‌های هوش مصنوعی (سپتامبر ۲۰۲۶)
#
# "executor_tier"/"reviewer_tier" mirror config/models.yaml's executor/reviewer
# roles (W12 model registry) when that file/module is importable, so this
# legacy map and the registry do not silently drift apart; other tiers here
# have no direct registry equivalent yet (W12 is a first slice) and stay
# hardcoded, with retired ids fixed directly per the 2026-09-25 audit
# (docs/research/TECH_CURRENCY_2026-09.md): "zhipu/glm-5.2" is retired/renamed
# to "z-ai/glm-5.2" (provider namespace moved), and "qwen/qwen3.8-max" is an
# unknown/retired id — the nearest live evergreen id is "qwen/qwen3-max".
FRONTIER_MODELS: Dict[str, List[str]] = {
    "architect_tier": [
        "anthropic/claude-opus-5", "anthropic/claude-sonnet-5", "anthropic/claude-fable-5",
    ],
    "balanced_tier": ["anthropic/claude-sonnet-5", "z-ai/glm-5.2", "qwen/qwen3-max"],
    "swarm_worker_tier": ["deepseek/deepseek-v4-flash-0731", "anthropic/claude-haiku-4.5"],
    "contract_tier": ["qwen/qwen3-coder", "deepseek/deepseek-v4-flash-0731"],
}

try:
    from output_apps.generated_modules.smartjudge import model_registry as _model_registry

    FRONTIER_MODELS["executor_tier"] = _model_registry.role_models("executor")
    FRONTIER_MODELS["reviewer_tier"] = _model_registry.role_models("reviewer")
except Exception:  # registry is optional; keep the hardcoded map usable alone
    pass
