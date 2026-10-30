#!/usr/bin/env python3
"""One chat call for the factory's architect and reviewer hooks (stdlib only).

Two transports:
  - model_cmd: a shell command that reads the prompt on stdin and prints the reply
    (e.g. `claude -p` for the subscription-billed architect role, or a mock in tests);
  - HTTP: OpenAI-compatible POST to $FACTORY_LLM_URL (default OpenRouter chat completions)
    with the key from the env var named by $FACTORY_LLM_KEY_VAR (default
    OPENROUTER_API_KEY_AGENTS). Model ids come from config/models.yaml via the caller.

Every direct (non-gateway) HTTP call appends one line to $ROXIRA_AGENTS_HOME/logs/llm_calls.jsonl in the key-pool
cost-log format (scripts/infra/key_pool/cost_logger.py) plus a `lane` field, so taskq's per-lane
budgets (lane_budget.py) count it. Prompts and replies are never logged.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_GATEWAY = "http://127.0.0.1:4000/v1"


class LLMError(RuntimeError):
    """The model call failed (transport, HTTP or empty reply)."""


def calls_log() -> Path:
    home = Path(os.environ.get("ROXIRA_AGENTS_HOME", "/var/lib/roxira-agents"))
    return home / "logs" / "llm_calls.jsonl"


def log_call(model: str, lane: str, usage: dict, latency_ms: int, success: bool, error: str = "", task: int | None = None) -> None:
    """Append one cost record; never raises."""
    try:
        cost = float(usage.get("cost") or 0.0)
    except (TypeError, ValueError):
        cost = 0.0
    rec = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "model_group": model, "deployment": model, "provider": model.split("/", 1)[0],
        "prompt_tokens": int(usage.get("prompt_tokens") or 0),
        "completion_tokens": int(usage.get("completion_tokens") or 0),
        "response_cost": max(cost, 0.0), "latency_ms": latency_ms, "success": success,
        "error": error, "lane": lane,
    }
    if task is not None:  # taskq attributes this call to the task (lane_budget.task_spend)
        rec["task"] = task
    try:
        path = calls_log()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, separators=(",", ":")) + "\n")
    except OSError:
        pass


def run_model_cmd(cmd: str, prompt: str, timeout: int = 900) -> str:
    try:
        res = subprocess.run(shlex.split(cmd), input=prompt, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise LLMError(f"model command failed: {type(exc).__name__}") from exc
    if res.returncode != 0 or not res.stdout.strip():
        raise LLMError(f"model command exit {res.returncode}: {res.stderr.strip()[-300:]}")
    return res.stdout


def endpoint(via: str | None = None) -> tuple[str, str, bool]:
    """(chat-completions URL, key, is_gateway). $FACTORY_LLM_URL + $FACTORY_LLM_KEY_VAR override everything; else the
    key-pool gateway when KEYPOOL_MASTER_KEY is set (free providers first, the only route open from the agent
    sandbox); else OpenRouter direct with OPENROUTER_API_KEY_AGENTS. `via` forces one route: "gateway" serves
    key-pool GROUP names only (agent-strong-free, ...), "openrouter" serves OpenRouter model ids."""
    if via == "openrouter":
        return DEFAULT_URL, os.environ.get("OPENROUTER_API_KEY_AGENTS", ""), False
    if via == "gateway":
        return (os.environ.get("AGENT_GATEWAY_URL", DEFAULT_GATEWAY).rstrip("/") + "/chat/completions",
                os.environ.get("KEYPOOL_MASTER_KEY", ""), True)
    url = os.environ.get("FACTORY_LLM_URL")
    if url:
        return url, os.environ.get(os.environ.get("FACTORY_LLM_KEY_VAR", "KEYPOOL_MASTER_KEY"), ""), False
    master = os.environ.get("KEYPOOL_MASTER_KEY", "")
    if master:
        return os.environ.get("AGENT_GATEWAY_URL", DEFAULT_GATEWAY).rstrip("/") + "/chat/completions", master, True
    return DEFAULT_URL, os.environ.get("OPENROUTER_API_KEY_AGENTS", ""), False


def chat(model: str, system: str, prompt: str, *, lane: str, model_cmd: str | None = None,
         max_tokens: int = 8000, timeout: int = 600, task: int | None = None) -> str:
    """Return the reply text. model_cmd wins over HTTP when given."""
    return chat_full(model, system, prompt, lane=lane, model_cmd=model_cmd, max_tokens=max_tokens, timeout=timeout,
                     task=task)[0]


def chat_full(model: str, system: str, prompt: str, *, lane: str, model_cmd: str | None = None,
              max_tokens: int = 8000, timeout: int = 600, task: int | None = None,
              via: str | None = None) -> tuple[str, str]:
    """(reply text, model that actually served it). `model` may be a gateway group name; the served model comes
    from the response, so the caller can check the vendor family. model_cmd replies report `model` itself."""
    if model_cmd:
        return run_model_cmd(model_cmd, f"{system}\n\n{prompt}", timeout), model
    url, key, gateway = endpoint(via)
    if not key:
        raise LLMError(f"no API key for route {via or 'default'} (KEYPOOL_MASTER_KEY / OPENROUTER_API_KEY_AGENTS)")
    body = {"model": model, "max_tokens": max_tokens, "temperature": 0,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
    if not gateway:
        body["usage"] = {"include": True}  # OpenRouter extension (returns the cost); the LiteLLM gateway must not get it
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        if not gateway:
            log_call(model, lane, {}, int((time.monotonic() - start) * 1000), False, type(exc).__name__, task)
        raise LLMError(f"HTTP call failed: {type(exc).__name__}") from exc
    usage = dict(data.get("usage")) if isinstance(data.get("usage"), dict) else {}
    served = str(data.get("model") or model)
    if not gateway:  # a gateway call is already in the key-pool cost log (requests.jsonl): logging it here would count it twice
        log_call(served, lane, usage, int((time.monotonic() - start) * 1000), True, "", task)
    try:
        text = data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError("reply has no choices[0].message.content") from exc
    if not text.strip():
        raise LLMError("empty reply")
    return text, served


def extract_json(text: str):
    """First JSON object/array in a reply, tolerating ``` fences and prose around it."""
    s = text.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else ""
        s = s.rsplit("```", 1)[0]
    try:
        return json.loads(s)
    except ValueError:
        pass
    dec = json.JSONDecoder()
    for i, ch in enumerate(s):
        if ch in "{[":
            try:
                return dec.raw_decode(s[i:])[0]
            except ValueError:
                continue
    raise LLMError("no JSON in the model reply")
