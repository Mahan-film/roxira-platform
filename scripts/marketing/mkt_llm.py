"""Key-pool client for the marketing engine (OpenAI-compatible gateway, stdlib only).

Same convention as scripts/factory/brief_to_spec.py: POST {gateway}/chat/completions with
KEYPOOL_MASTER_KEY from the environment or /opt/roxira_platform/.env. The key is never printed.
Model *groups* (not model ids) come from env: MKT_MODEL_GROUP, MKT_IMAGE_GROUP.
"""

from __future__ import annotations

import base64
import json
import os
import urllib.request

GATEWAY = os.environ.get("AGENT_GATEWAY_URL", "http://127.0.0.1:4000/v1").rstrip("/")
REPO_ENV = os.environ.get("ROXIRA_REPO_ENV", "/opt/roxira_platform/.env")
DEFAULT_GROUP = "agent-strong-free"


class LLMError(RuntimeError):
    pass


def model_group() -> str:
    return os.environ.get("MKT_MODEL_GROUP") or DEFAULT_GROUP


def image_group() -> str:
    return os.environ.get("MKT_IMAGE_GROUP", "")


def env_value(name: str) -> str:
    if os.environ.get(name):
        return os.environ[name]
    try:
        with open(REPO_ENV, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith(name + "="):
                    return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return ""


def _post(path: str, payload: dict, timeout: float) -> dict:
    key = env_value("KEYPOOL_MASTER_KEY")
    if not key:
        raise LLMError("KEYPOOL_MASTER_KEY not set")
    req = urllib.request.Request(
        GATEWAY + path, data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (local gateway)
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # never include headers/key in the message
        raise LLMError(f"gateway call failed: {type(exc).__name__}") from None


def chat(system: str, user: str, *, group: str | None = None, temperature: float = 0.4,
         timeout: float = 240) -> str:
    data = _post("/chat/completions", {
        "model": group or model_group(),
        "temperature": temperature,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }, timeout)
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        raise LLMError("unexpected gateway response") from None


def image_png(prompt: str, *, group: str | None = None, timeout: float = 240) -> bytes:
    """Ask the gateway's /images/generations; returns PNG bytes or raises LLMError."""
    grp = group or image_group()
    if not grp:
        raise LLMError("MKT_IMAGE_GROUP not set")
    data = _post("/images/generations", {"model": grp, "prompt": prompt, "n": 1,
                                         "size": "1024x1024", "response_format": "b64_json"}, timeout)
    try:
        item = data["data"][0]
        if item.get("b64_json"):
            return base64.b64decode(item["b64_json"])
        if item.get("url", "").startswith("https://"):
            with urllib.request.urlopen(item["url"], timeout=timeout) as resp:  # noqa: S310
                return resp.read()
    except (KeyError, IndexError, TypeError, ValueError):
        pass
    raise LLMError("no image in gateway response")
