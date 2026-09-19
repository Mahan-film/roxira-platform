#!/usr/bin/env python3
import os, json, urllib.request

ENV_FILE = "/opt/roxira_platform/.env"

def get_config():
    config = {
        "api_key": os.environ.get("OPENROUTER_API_KEY", ""),
        "model": os.environ.get("DEFAULT_LLM_MODEL", "deepseek/deepseek-chat")
    }
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    val = v.strip().strip('"').strip("'")
                    key_name = k.strip()
                    config[key_name] = val
                    if key_name in ["OPENROUTER_API_KEY", "OPENAI_API_KEY"]:
                        config["api_key"] = val
                    if key_name in ["DEFAULT_LLM_MODEL", "LLM_MODEL"]:
                        config["model"] = val

    if not config.get("api_key") and "OPENROUTER_API_KEY" in config:
        config["api_key"] = config["OPENROUTER_API_KEY"]

    return config

def ask_deepseek(prompt: str, system_prompt: str = "") -> str:
    cfg = get_config()
    api_key = cfg.get("api_key")
    model = cfg.get("model", "deepseek/deepseek-chat")
    if not api_key: return ""

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://roxira.ir",
        "X-Title": "Roxira Autonomous Software Factory"
    }
    messages = []
    if system_prompt: messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    req = urllib.request.Request(
        url,
        data=json.dumps({"model": model, "messages": messages, "temperature": 0.2}).encode("utf-8"),
        headers=headers,
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"⚠️ خطای API دیپ‌سیک: {e}")
        return ""

call_deepseek = ask_deepseek
