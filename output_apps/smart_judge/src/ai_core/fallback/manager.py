import os
import json
import httpx
from typing import AsyncGenerator, Dict, Any, List, Optional

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions"

class SmartJudgeFallbackManager:
    # دسته‌بندی سه‌سطحی مدل‌ها بر اساس بنچمارک‌های ۲۰۲۶
    MODEL_TIERS = {
        "FRONTIER": [
            {"id": "anthropic/claude-sonnet-5", "name": "Claude Sonnet 5 (انشای فاخر و استدلال)", "context": "1M"},
            {"id": "deepseek/deepseek-v4-pro", "name": "DeepSeek V4 Pro (استدلال فقهی و حقوقی سنگین)", "context": "1M"},
            {"id": "z-ai/glm-5.2", "name": "GLM 5.2 (دقت بالا در تطبیق قوانین)", "context": "256K"}
        ],
        "VALUE_LEADERS": [
            {"id": "deepseek/deepseek-v4-flash", "name": "DeepSeek V4 Flash ($0.035/$0.10)", "context": "1M"},
            {"id": "inclusionai/ling-3.0-flash", "name": "Ling 3.0 Flash ($0.021/$0.063)", "context": "262K"},
            {"id": "google/gemini-3.7-flash", "name": "Gemini 3.7 Flash", "context": "1M"}
        ],
        "FREE_TIER": [
            {"id": "stealth/ox-alpha", "name": "Ox Alpha (رایگان - بافت ۱M)", "context": "1M"},
            {"id": "poolside/laguna-s-2.1:free", "name": "Laguna S 2.1 (رایگان - استدلال ساختاریافته)", "context": "1M"},
            {"id": "nvidia/nemotron-3.5-lightning:free", "name": "Nemotron 3.5 Lightning (رایگان)", "context": "1M"},
            {"id": "cohere/north-mini-code:free", "name": "North Mini Code (رایگان)", "context": "256K"}
        ]
    }

    @classmethod
    def get_fallback_candidates(cls, preferred_model_id: Optional[str] = None) -> List[Dict[str, str]]:
        candidates = []
        if preferred_model_id:
            candidates.append({"id": preferred_model_id, "name": f"مدل انتخابی: {preferred_model_id}"})
        
        # اولویت‌بندی: مدل انتخابی -> پیشروهای اقتصادی -> استخر رایگان
        for tier in ["VALUE_LEADERS", "FREE_TIER", "FRONTIER"]:
            for m in cls.MODEL_TIERS[tier]:
                if m["id"] != preferred_model_id:
                    candidates.append(m)
        return candidates

    @classmethod
    async def execute_resilient_completion(
        cls,
        messages: List[Dict[str, str]],
        preferred_model_id: Optional[str] = None,
        temperature: float = 0.2
    ) -> AsyncGenerator[str, None]:
        candidates = cls.get_fallback_candidates(preferred_model_id)
        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "HTTP-Referer": "https://ghazihoushmand.ir",
            "X-Title": "Ghazihoushmand AI Core",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            for model in candidates:
                payload = {
                    "model": model["id"],
                    "messages": messages,
                    "temperature": temperature,
                    "stream": True
                }
                try:
                    async with client.stream("POST", OPENROUTER_BASE_URL, json=payload, headers=headers) as res:
                        if res.status_code == 200:
                            async for line in res.aiter_lines():
                                if line.startswith("data: "):
                                    data_str = line[6:].strip()
                                    if data_str == "[DONE]":
                                        break
                                    try:
                                        chunk = json.loads(data_str)
                                        delta = chunk["choices"][0].get("delta", {})
                                        if "reasoning" in delta and delta["reasoning"]:
                                            yield f"[THOUGHT]{delta['reasoning']}[/THOUGHT]"
                                        if "content" in delta and delta["content"]:
                                            yield delta["content"]
                                    except json.JSONDecodeError:
                                        continue
                            return
                        else:
                            continue
                except Exception:
                    continue

            yield "\n[هشدار]: تمام مدل‌های زنجیره فالبک با خطا مواجه شدند. لطفاً اتصال شبکه یا کلید OpenRouter را بررسی نمایید."
