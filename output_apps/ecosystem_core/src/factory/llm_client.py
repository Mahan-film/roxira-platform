#!/usr/bin/env python3
import os
import json
import urllib.request
import urllib.error

ENV_FILE = "/opt/roxira_platform/.env"

def get_env_config():
    cfg = {"api_key": "", "model": "deepseek/deepseek-chat"}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    cfg[k.strip()] = v.strip().strip('"').strip("'")
    return cfg

def call_deepseek(prompt: str, system_prompt: str = "") -> str:
    cfg = get_env_config()
    api_key = cfg.get("OPENROUTER_API_KEY") or cfg.get("api_key")
    model = cfg.get("DEFAULT_LLM_MODEL") or cfg.get("model") or "deepseek/deepseek-chat"

    if not api_key or "YOUR_KEY" in api_key:
        print("⚠️ کلید معتبر OpenRouter در .env یافت نشد؛ ورود به فالبک الگوریتمی.")
        return ""

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://roxira.ir",
        "X-Title": "Roxira Factory Engine"
    }

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    payload = json.dumps({
        "model": model,
        "messages": messages,
        "temperature": 0.2
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"⚠️ خطای API در ارتباط با OpenRouter: {e}")
        return ""

if __name__ == "__main__":
    print("تست استعلام از مدل DeepSeek:")
    res = call_deepseek("یک پیام یک‌خطی تأیید آماده‌باش ارسال کن.")
    print(res if res else "مدل در دسترس نیست (بررسی کلید در .env).")
