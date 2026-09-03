from __future__ import annotations

import os
import json
import httpx
import pathlib
from typing import Dict, Any, Optional

ENV_FILE = pathlib.Path.cwd() / ".env"

def get_api_key(key_name: str = "OPENROUTER_API_KEY") -> str:
    if os.environ.get(key_name):
        return os.environ[key_name]
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{key_name}="):
                return line.split("=", 1)[1].strip().strip("'\"")
    return ""

class OpenRouterClient:
    BASE_URL = "https://openrouter.ai/api/v1/chat/completions"

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
        if not self.api_key:
            return {"status": "ERROR", "error": "OPENROUTER_API_KEY is missing in .env"}

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://roxira.net",
            "X-Title": "ROXIRA Intelligence Engine"
        }

        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            "temperature": temperature,
            "max_tokens": 4096
        }

        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        try:
            with httpx.Client(timeout=timeout, verify=True) as client:
                response = client.post(self.BASE_URL, headers=headers, json=payload)
                if response.status_code != 200:
                    return {"status": "ERROR", "http_code": response.status_code, "error": response.text}

                res_json = response.json()
                content = res_json["choices"][0]["message"]["content"]
                parsed_data = json.loads(content) if json_mode else content
                return {"status": "SUCCESS", "model": model, "content": parsed_data}
        except Exception as e:
            return {"status": "ERROR", "error": str(e)}
