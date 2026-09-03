from __future__ import annotations

import json
import os
import pathlib
import urllib.request
import urllib.error
from typing import Literal, Dict, Any, List

ENV_FILE = pathlib.Path("/Users/mac/Developer/project-foundry/.env")

def get_env_var(name: str) -> str:
    if os.environ.get(name):
        return os.environ[name]
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip("'\"")
    return ""

TaskType = Literal["FREE_EXTRACTION", "FREE_REASONING", "BUDGET_FAST", "DEEP_LEGAL"]

# زنجیره مدل‌های اولویت‌دار بر اساس کمترین هزینه و بالاترین کیفیت فارسی
MODEL_FALLBACK_CHAINS: Dict[TaskType, List[str]] = {
    # اولویت ۱: مدل‌های کاملاً رایگان برای استخراج و پارس متون
    "FREE_EXTRACTION": [
        "z-ai/glm-5.2:free",
        "nvidia/nemotron-3.5-lightning:free",
        "google/gemma-4-26b-a4b:free",
        "deepseek/deepseek-v4-flash" # فال‌بک ارزان در صورت شلوغی سرور رایگان
    ],
    # اولویت ۲: مدل‌های رایگان برای کارهای تحلیلی و ممیزی
    "FREE_REASONING": [
        "z-ai/glm-5.2:free",
        "nvidia/nemotron-3-ultra:free",
        "deepseek/deepseek-chat"
    ],
    # اولویت ۳: کارهای فوق سریع با هزینه ناچیز
    "BUDGET_FAST": [
        "deepseek/deepseek-v4-flash",
        "inclusionai/ling-3.0-flash",
        "z-ai/glm-5.2:free"
    ],
    # اولویت ۴: لوایح قضایی حساس و تنظیم دادخواست
    "DEEP_LEGAL": [
        "z-ai/glm-5.2",
        "deepseek/deepseek-v4-pro",
        "deepseek/deepseek-reasoner"
    ]
}

class CostOptimizedAIRouter:
    """Multi-Tier AI Router prioritizing OpenRouter Free Models with resilient failover."""

    def __init__(self) -> None:
        self.openrouter_key = get_env_var("OPENROUTER_API_KEY")
        self.deepseek_key = get_env_var("DEEPSEEK_API_KEY")

    def execute(
        self,
        prompt: str,
        system_prompt: str,
        task_tier: TaskType = "FREE_EXTRACTION",
        json_mode: bool = True
    ) -> Dict[str, Any]:
        models_to_try = MODEL_FALLBACK_CHAINS.get(task_tier, ["z-ai/glm-5.2:free"])
        last_error = ""

        for model in models_to_try:
            try:
                # مسیریابی بین OpenRouter و DeepSeek Direct
                if "deepseek/" in model and self.deepseek_key and not model.endswith(":free"):
                    endpoint = "https://api.deepseek.com/chat/completions"
                    api_key = self.deepseek_key
                    model_name = model.replace("deepseek/", "")
                else:
                    endpoint = "https://openrouter.ai/api/v1/chat/completions"
                    api_key = self.openrouter_key
                    model_name = model

                if not api_key:
                    continue

                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://roxira.net",
                    "X-Title": "Roxira Control Center"
                }

                payload: Dict[str, Any] = {
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt}
                    ],
                    "max_tokens": 4096
                }

                if json_mode and "reasoner" not in model_name:
                    payload["response_format"] = {"type": "json_object"}

                req = urllib.request.Request(
                    endpoint,
                    data=json.dumps(payload).encode("utf-8"),
                    headers=headers,
                    method="POST"
                )

                with urllib.request.urlopen(req, timeout=45) as resp:
                    res = json.loads(resp.read().decode("utf-8"))

                content = res["choices"][0]["message"]["content"]
                parsed_json = json.loads(content) if json_mode else {"text": content}
                
                return {
                    "status": "SUCCESS",
                    "model_used": model,
                    "is_free_tier": ":free" in model,
                    "data": parsed_json
                }

            except urllib.error.HTTPError as http_err:
                last_error = f"HTTP {http_err.code}: {http_err.reason}"
                continue # سوییچ خودکار به مدل بعدی زنجیره در صورت خطای لود سرور
            except Exception as err:
                last_error = str(err)
                continue

        return {"status": "ALL_MODELS_FAILED", "last_error": last_error}

if __name__ == "__main__":
    router = CostOptimizedAIRouter()
    print("=== TESTING FREE-TIER AI ROUTING ===")
    out = router.execute(
        prompt="سه اصل اساسی حسابداری دوبل را در قالب یک شیء JSON با کلید principles فهرست کن.",
        system_prompt="پاسخ را فقط به صورت JSON معتبر ارائه بده.",
        task_tier="FREE_EXTRACTION",
        json_mode=True
    )
    print(json.dumps(out, indent=2, ensure_ascii=False))
