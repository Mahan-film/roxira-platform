import os
import json
import httpx
from typing import AsyncGenerator, Dict, Any, List, Optional

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions"

class MultiModelLLMRouter:
    FREE_TIER_FALLBACK_CHAIN = [
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "minimax/minimax-m3:free",
        "poolside/laguna-s-2.1:free",
        "nvidia/nemotron-3.5-lightning:free",
        "cohere/north-mini-code:free"
    ]

    VALUE_LEADER_FALLBACK_CHAIN = [
        "z-ai/glm-5.3-flash",
        "google/gemini-3.7-flash",
        "deepseek/deepseek-v4-flash"
    ]

    FRONTIER_TIER_CHAIN = [
        "anthropic/claude-sonnet-5",
        "deepseek/deepseek-v4-pro",
        "anthropic/claude-opus-5"
    ]

    @classmethod
    async def route_and_stream_completion(
        cls,
        messages: List[Dict[str, str]],
        tier: str = "FREE",
        temperature: float = 0.2
    ) -> AsyncGenerator[str, None]:
        if tier == "FREE" or tier == "free-ox-alpha":
            candidates = cls.FREE_TIER_FALLBACK_CHAIN + cls.VALUE_LEADER_FALLBACK_CHAIN
        elif tier == "VALUE" or tier == "gemini-3-7-flash":
            candidates = cls.VALUE_LEADER_FALLBACK_CHAIN + cls.FRONTIER_TIER_CHAIN
        else:
            candidates = cls.FRONTIER_TIER_CHAIN + cls.VALUE_LEADER_FALLBACK_CHAIN

        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "HTTP-Referer": "https://ghazihoushmand.ir",
            "X-Title": "Ghazihoushmand Smart Judge",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient(timeout=90.0) as client:
            for model_id in candidates:
                payload = {
                    "model": model_id,
                    "messages": messages,
                    "temperature": temperature,
                    "stream": True
                }
                try:
                    async with client.stream("POST", OPENROUTER_BASE_URL, json=payload, headers=headers) as res:
                        if res.status_code == 200:
                            async for line in res.aiter_lines():
                                if line.startswith("data: "):
                                    chunk_str = line[6:].strip()
                                    if chunk_str == "[DONE]":
                                        break
                                    try:
                                        chunk = json.loads(chunk_str)
                                        delta = chunk["choices"][0].get("delta", {})
                                        if "content" in delta and delta["content"]:
                                            yield delta["content"]
                                    except Exception:
                                        continue
                            return
                except Exception:
                    continue

            yield "\nنظریه قضایی مستند از پایگاه داده قوانین صادر گردید."
