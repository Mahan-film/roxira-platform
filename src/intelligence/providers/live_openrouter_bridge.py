import os, json, urllib.request, pathlib
from typing import Tuple

# ماتریس مدرن‌ترین مدل‌های شهریور ۱۴۰۵ (سپتامبر ۲۰۲۶)
LIVE_MODELS = {
    "gemini_frontier": "google/gemini-3.8-flash",
    "deepseek_fast": "deepseek/deepseek-v4-flash-0731",
    "deepseek_fallback": "deepseek/deepseek-v4-flash",
    "coding_engine": "poolside/laguna-xs-2.1:free",
    "deep_reasoning": "thinkingmachines/inkling:free",
    "orchestrator_free": "nvidia/nemotron-3.5-lightning:free"
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

def call_live_model(prompt: str, system_prompt: str = "", task_type: str = "gemini_frontier") -> Tuple[str, str]:
    api_key = get_api_key()
    if not api_key:
        return "ERROR: No API Key found.", "None"

    # اولویت‌بندی مدل‌ها: ابتدا مدل درخواستی، سپس پشتیبان‌های نسل جدید
    candidate_models = [
        LIVE_MODELS.get(task_type, "google/gemini-3.8-flash"),
        LIVE_MODELS["deepseek_fast"],
        LIVE_MODELS["deepseek_fallback"],
        "google/gemini-3.7-flash",
        "google/gemini-2.5-pro",
        LIVE_MODELS["coding_engine"],
        LIVE_MODELS["deep_reasoning"]
    ]

    for model in candidate_models:
        try:
            payload = json.dumps({
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt or "You are Roxira OS Chief Autonomous Engine."},
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
                    "X-Title": "Roxira OS Live Autonomous Platform"
                }
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                content = data["choices"][0]["message"]["content"]
                if content and len(content.strip()) > 5:
                    return content, model
        except Exception:
            continue

    return "Fallback Engine Active", "Local-Rule-Engine"

if __name__ == "__main__":
    print("Testing Updated Frontier AI Models (Gemini 3.8 & DeepSeek V4)...")
    res, m = call_live_model("Verify Roxira autonomous stack integrity and report status in one sentence.", task_type="gemini_frontier")
    print(f"Response from [{m}]:\n{res}")
