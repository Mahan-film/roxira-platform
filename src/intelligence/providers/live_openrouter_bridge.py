import os, json, urllib.request, pathlib
from typing import Tuple, Optional

# ماتریس مدل‌های زنده استخراج‌شده از سرور
LIVE_FREE_MODELS = {
    "coding": "poolside/laguna-xs-2.1:free",
    "reasoning": "thinkingmachines/inkling:free",
    "orchestrator": "nvidia/nemotron-3.5-lightning:free",
    "finance": "inclusionai/ling-3.0-flash-fin:free"
}

LIVE_VALUE_MODELS = {
    "agentic_lead": "z-ai/glm-5.3-flash",
    "code_fallback": "deepseek/deepseek-v4-flash-0731"
}

def get_api_key() -> str:
    key = os.getenv("OPENROUTER_API_KEY", "")
    if not key:
        env_p = pathlib.Path("/opt/roxira_platform/.env")
        if env_p.exists():
            for l in env_p.read_text().splitlines():
                if l.startswith("OPENROUTER_API_KEY="):
                    key = l.split("=", 1)[1].strip().strip("'\"")
    return key

def call_live_model(prompt: str, system_prompt: str = "", task_type: str = "coding") -> Tuple[str, str]:
    api_key = get_api_key()
    if not api_key:
        return "ERROR: No API Key found.", "None"

    # اولویت ۱: مدل‌های کاملاً رایگان متناسب با تسک
    preferred_free = LIVE_FREE_MODELS.get(task_type, "poolside/laguna-xs-2.1:free")
    candidate_models = [
        preferred_free,
        "poolside/laguna-s-2.1:free",
        "nvidia/nemotron-3.5-lightning:free",
        "thinkingmachines/inkling:free",
        LIVE_VALUE_MODELS["agentic_lead"],
        LIVE_VALUE_MODELS["code_fallback"]
    ]

    for model in candidate_models:
        try:
            payload = json.dumps({
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt or "You are Roxira OS Autonomous Engine."},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.1,
                "max_tokens": 3000
            }).encode("utf-8")

            req = urllib.request.Request(
                "https://openrouter.ai/api/v1/chat/completions",
                data=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://roxira.net",
                    "User-Agent": "RoxiraAutonomousBridge/3.0"
                }
            )
            with urllib.request.urlopen(req, timeout=35) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                content = data["choices"][0]["message"]["content"]
                if content and len(content.strip()) > 10:
                    return content, model
        except Exception:
            continue

    return "ERROR: All models in pool failed.", "Failed"

if __name__ == "__main__":
    print("Testing Live Model Bridge...")
    res, m = call_live_model("Explain in 1 short sentence why modular architectures succeed.", task_type="reasoning")
    print(f"Response from [{m}]:\n{res}")
