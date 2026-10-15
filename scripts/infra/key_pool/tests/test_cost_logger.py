"""Offline tests for cost_logger: privacy, fields, failure path, never-raise."""
from __future__ import annotations

import asyncio
import json
import pathlib
import sys
import types
from datetime import datetime, timedelta, timezone

HERE = pathlib.Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))

import cost_logger


class _Resp:
    def __init__(self) -> None:
        self.usage = types.SimpleNamespace(prompt_tokens=10, completion_tokens=5)
        message = types.SimpleNamespace(content="SECRET ANSWER")
        self.choices = [types.SimpleNamespace(message=message)]


def _kwargs(exception: BaseException | None = None) -> dict:
    kw = {
        "model": "agent-strong-free",
        "litellm_params": {"model": "groq/openai/gpt-oss-120b"},
        "metadata": {
            "model_group": "agent-strong-free",
            "user_api_key": "SECRET-KEY",
            "messages": [],
        },
        "response_cost": 0.00123,
        "standard_logging_object": {
            "model_id": "agent-strong-free:groq:GROQ_API_KEY:openai/gpt-oss-120b",
            "model_group": "agent-strong-free",
            "custom_llm_provider": "groq",
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            "response_cost": 0.00123,
        },
    }
    if exception is not None:
        kw["exception"] = exception
    return kw


def _run(coro):
    return asyncio.run(coro)


def test_success_record_has_counts_and_no_private_fields(monkeypatch, tmp_path):
    path = tmp_path / "requests.jsonl"
    monkeypatch.setenv("KEYPOOL_COST_LOG", str(path))
    start = datetime.now(timezone.utc)
    end = start + timedelta(milliseconds=250)
    _run(cost_logger.CostLogger().async_log_success_event(_kwargs(), _Resp(), start, end))

    text = path.read_text(encoding="utf-8")
    assert text.count("\n") == 1
    rec = json.loads(text.strip())
    assert rec["model_group"] == "agent-strong-free"
    assert rec["deployment"] == "agent-strong-free:groq:GROQ_API_KEY:openai/gpt-oss-120b"
    assert rec["provider"] == "groq"
    assert rec["prompt_tokens"] == 10 and rec["completion_tokens"] == 5
    assert rec["response_cost"] == 0.00123
    assert rec["latency_ms"] == 250
    assert rec["success"] is True
    assert rec["error"] == ""
    for forbidden in ("SECRET ANSWER", "SECRET-KEY", "messages", "user_api_key", "choices"):
        assert forbidden not in text


def test_failure_record_keeps_only_error_class(monkeypatch, tmp_path):
    path = tmp_path / "requests.jsonl"
    monkeypatch.setenv("KEYPOOL_COST_LOG", str(path))
    err = RuntimeError("secret provider message")
    kwargs = _kwargs(err)
    kwargs.pop("response_cost", None)
    kwargs["standard_logging_object"].pop("response_cost", None)
    _run(cost_logger.CostLogger().async_log_failure_event(kwargs, None, None, None))

    text = path.read_text(encoding="utf-8")
    rec = json.loads(text.strip())
    assert rec["success"] is False
    assert rec["error"] == "RuntimeError"
    assert rec["response_cost"] == 0.0
    assert rec["latency_ms"] == 0
    assert "secret provider message" not in text


def test_broken_input_never_raises(monkeypatch, tmp_path):
    monkeypatch.setenv("KEYPOOL_COST_LOG", str(tmp_path / "requests.jsonl"))
    _run(cost_logger.CostLogger().async_log_success_event(None, None, None, None))
    _run(cost_logger.CostLogger().async_log_failure_event({}, None, None, None))


def test_size_guard_rotates_keeping_one(monkeypatch, tmp_path):
    path = tmp_path / "requests.jsonl"
    monkeypatch.setenv("KEYPOOL_COST_LOG", str(path))
    monkeypatch.setenv("KEYPOOL_COST_LOG_MAX_BYTES", "10")
    logger = cost_logger.CostLogger()
    _run(logger.async_log_success_event(_kwargs(), _Resp(), None, None))
    _run(logger.async_log_success_event(_kwargs(), _Resp(), None, None))
    assert path.exists()
    assert pathlib.Path(str(path) + ".1").exists()
