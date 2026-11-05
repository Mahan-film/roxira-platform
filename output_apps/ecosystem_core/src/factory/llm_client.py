#!/usr/bin/env python3
import os
import pathlib
import sys

ENV_FILE = "/opt/roxira_platform/.env"


def _llm_route():
    root = pathlib.Path(__file__).resolve().parents[4]
    dev = str(root / "scripts" / "dev")
    if dev not in sys.path:
        sys.path.insert(0, dev)
    import llm_route

    return llm_route


def get_config():
    config = {
        "api_key": os.environ.get("OPENROUTER_API_KEY", ""),
        "model": "deepseek/deepseek-chat"
    }
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.strip().split("=", 1)
                    val = v.strip().strip('"').strip("'")
                    key_name = k.strip()
                    config[key_name] = val
                    if key_name in ["OPENROUTER_API_KEY", "OPENAI_API_KEY"]:
                        config["api_key"] = val
    return config


def ask_deepseek(prompt: str, system_prompt: str = "") -> str:
    """One routed chat call (free first, then cheap, then strong) via scripts/dev/llm_route.py."""
    llm_route = _llm_route()
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    try:
        result = llm_route.route(
            "fleet", messages, llm_route.attempts_for("fleet"), public=True
        )
    except (llm_route.AllAttemptsFailed, llm_route.CapReached):
        return ""
    return result.text


call_deepseek = ask_deepseek
