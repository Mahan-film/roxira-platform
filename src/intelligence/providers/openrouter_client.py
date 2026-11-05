from __future__ import annotations

import os
import json
import pathlib
import sys
from typing import Dict, Any, Optional

ENV_FILE = pathlib.Path.cwd() / ".env"


def _llm_route():
    root = pathlib.Path(__file__).resolve().parents[3]
    dev = str(root / "scripts" / "dev")
    if dev not in sys.path:
        sys.path.insert(0, dev)
    import llm_route

    return llm_route


def get_api_key(key_name: str = "OPENROUTER_API_KEY") -> str:
    if os.environ.get(key_name):
        return os.environ[key_name]
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{key_name}="):
                return line.split("=", 1)[1].strip().strip("'\"")
    return ""


class OpenRouterClient:
    """Routed chat client (free first, then cheap, then strong)."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or get_api_key("OPENROUTER_API_KEY")

    def generate(
        self,
        model: str,
        prompt: str,
        system_prompt: str = "You are an expert AI assistant.",
        temperature: float = 0.2,
        json_mode: bool = False,
        timeout: float = 60.0
    ) -> Dict[str, Any]:
        llm_route = _llm_route()
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]
        try:
            result = llm_route.route(
                "fleet",
                messages,
                llm_route.attempts_for("fleet", timeout=timeout),
                public=True,
            )
        except (llm_route.AllAttemptsFailed, llm_route.CapReached) as exc:
            return {"status": "ERROR", "error": str(exc)}

        try:
            parsed_data = json.loads(result.text) if json_mode else result.text
        except ValueError as exc:
            return {"status": "ERROR", "error": f"invalid JSON: {exc}"}
        return {"status": "SUCCESS", "model": result.served, "content": parsed_data}
