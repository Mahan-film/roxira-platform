#!/usr/bin/env python3
"""LiteLLM CustomLogger: one JSON line per request (cost + latency), privacy-safe.

Wired in by render_litellm.py as `cost_logger.proxy_handler_instance` when
`gateway.cost_log` is true. Inside the gateway container the file lives at the path in
$KEYPOOL_COST_LOG (default /logs/requests.jsonl); the host directory /var/log/roxira-keypool
is bind-mounted there by docker-compose.keypool.yml.

Only counts, costs, timing and model ids are written, plus the cost-attribution tags the app
sends as request `metadata` (llm_gateway.tag(): `roxira_answer_id`, `roxira_feature`,
`roxira_tenant`, `roxira_plan`; whitelisted and length-capped here) and the deployment's
free/paid tier from its model_info. Prompts, responses, keys, headers and user ids are NEVER
logged. Logging must never break a request: every path is wrapped in
try/except and errors are swallowed.
"""
from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:  # litellm only exists in the gateway image; tests import this module without it.
    from litellm.integrations.custom_logger import CustomLogger
except Exception:  # pragma: no cover - only when litellm is absent

    class CustomLogger:  # type: ignore[no-redef]
        pass


DEFAULT_LOG_PATH = "/logs/requests.jsonl"
DEFAULT_MAX_BYTES = 200 * 1024 * 1024
# request metadata key -> record field. Nothing else from metadata is ever written.
TAG_KEYS = {
    "roxira_answer_id": "answer_id",
    "roxira_feature": "feature",
    "roxira_tenant": "tenant",
    "roxira_plan": "plan",
}
_TAG_MAX = 64
_TAG_CHARS = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:-")


def _num(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _usage_field(usage: Any, name: str) -> int:
    if usage is None:
        return 0
    if isinstance(usage, dict):
        return _num(usage.get(name))
    return _num(getattr(usage, name, None))


def _latency_ms(start_time: Any, end_time: Any) -> int:
    try:
        delta = (end_time - start_time).total_seconds()
    except Exception:
        return 0
    return max(0, int(round(delta * 1000)))


def _tag_value(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return "".join(ch for ch in value if ch in _TAG_CHARS)[:_TAG_MAX]


def _tags(
    kw: dict[str, Any], slo: dict[str, Any], litellm_params: dict[str, Any]
) -> dict[str, str]:
    """The whitelisted roxira_* request tags, wherever this LiteLLM build put them."""
    sources: list[Any] = []
    slo_meta = slo.get("metadata")
    if isinstance(slo_meta, dict):
        sources.append(slo_meta.get("requester_metadata"))
    lp_meta = litellm_params.get("metadata")
    if isinstance(lp_meta, dict):
        sources.extend([lp_meta.get("requester_metadata"), lp_meta])
    kw_meta = kw.get("metadata")
    if isinstance(kw_meta, dict):
        sources.extend([kw_meta.get("requester_metadata"), kw_meta])
    out = {field: "" for field in TAG_KEYS.values()}
    for src in sources:
        if not isinstance(src, dict):
            continue
        for key, field in TAG_KEYS.items():
            if not out[field]:
                out[field] = _tag_value(src.get(key))
    return out


def _tier(litellm_params: dict[str, Any], kw: dict[str, Any]) -> str:
    """'free' / 'paid' from the deployment's model_info (render_litellm sets it); '' if unknown."""
    for info in (litellm_params.get("model_info"), kw.get("model_info")):
        if isinstance(info, dict) and info.get("tier") in ("free", "paid"):
            return str(info["tier"])
    return ""


def build_record(
    kwargs: Any,
    response_obj: Any,
    start_time: Any,
    end_time: Any,
    success: bool,
    error: BaseException | None = None,
) -> dict[str, Any]:
    """Build the record from a LiteLLM callback. Pure: never touches the filesystem."""
    kw = kwargs if isinstance(kwargs, dict) else {}
    slo = kw.get("standard_logging_object")
    if not isinstance(slo, dict):
        slo = {}
    litellm_params = kw.get("litellm_params")
    if not isinstance(litellm_params, dict):
        litellm_params = {}
    metadata = kw.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}

    model = str(litellm_params.get("model") or kw.get("model") or "")
    model_group = str(
        slo.get("model_group") or metadata.get("model_group") or kw.get("model") or model
    )
    deployment = str(slo.get("model_id") or metadata.get("model_id") or model)
    provider = str(
        slo.get("custom_llm_provider")
        or kw.get("custom_llm_provider")
        or metadata.get("custom_llm_provider")
        or (model.split("/")[0] if "/" in model else "")
    )

    usage = getattr(response_obj, "usage", None)
    if usage is None:
        usage = slo.get("usage")
    if usage is None:
        usage = kw.get("usage")

    cost = kw.get("response_cost")
    if cost is None:
        cost = slo.get("response_cost")
    try:
        cost = float(cost)
    except (TypeError, ValueError):
        cost = 0.0
    if not math.isfinite(cost) or cost < 0:
        cost = 0.0

    tags = _tags(kw, slo, litellm_params)
    return {
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "model_group": model_group,
        "deployment": deployment,
        "provider": provider,
        "prompt_tokens": _usage_field(usage, "prompt_tokens"),
        "completion_tokens": _usage_field(usage, "completion_tokens"),
        "response_cost": cost,
        "latency_ms": _latency_ms(start_time, end_time),
        "success": bool(success),
        "error": type(error).__name__ if error is not None else "",
        "tier": _tier(litellm_params, kw),
        **tags,
    }


def log_path() -> Path:
    return Path(os.environ.get("KEYPOOL_COST_LOG") or DEFAULT_LOG_PATH)


def _max_bytes() -> int:
    try:
        return int(os.environ.get("KEYPOOL_COST_LOG_MAX_BYTES") or DEFAULT_MAX_BYTES)
    except (TypeError, ValueError):
        return DEFAULT_MAX_BYTES


def append_record(record: dict[str, Any]) -> None:
    """Append one JSON line, rotating to `<file>.1` once past the size guard (keep one)."""
    path = log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if path.exists() and path.stat().st_size >= _max_bytes():
            os.replace(str(path), str(path) + ".1")
    except OSError:
        pass
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=True, separators=(",", ":")) + "\n")


class CostLogger(CustomLogger):
    """Appends one privacy-safe JSON line per LLM call; never raises."""

    def _emit(
        self,
        kwargs: Any,
        response_obj: Any,
        start_time: Any,
        end_time: Any,
        success: bool,
        error: BaseException | None = None,
    ) -> None:
        try:
            append_record(build_record(kwargs, response_obj, start_time, end_time, success, error))
        except Exception:
            pass

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        self._emit(kwargs, response_obj, start_time, end_time, True)

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        error = kwargs.get("exception") if isinstance(kwargs, dict) else None
        self._emit(kwargs, response_obj, start_time, end_time, False, error)


proxy_handler_instance = CostLogger()
