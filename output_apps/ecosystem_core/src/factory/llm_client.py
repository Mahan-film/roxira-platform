#!/usr/bin/env python3
import os, json, time, urllib.request

ENV_FILE = "/opt/roxira_platform/.env"

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
    cfg = get_config()
    api_key = cfg.get("api_key")
    if not api_key: return ""

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://roxira.ir",
        "X-Title": "Roxira Resilient LLM Engine"
    }

    # استخر مدل‌های هوشمند با چرخش در صورت بروز 429
    models_pool = [
        "deepseek/deepseek-chat",
        "google/gemini-2.0-flash-001",
        "meta-llama/llama-3.3-70b-instruct",
        "deepseek/deepseek-r1-distill-llama-70b"
    ]

    messages = []
    if system_prompt: messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    for model in models_pool:
        payload = json.dumps({"model": model, "messages": messages, "temperature": 0.2}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=35) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                content = data["choices"][0]["message"]["content"]
                if content:
                    return content
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"  ⚠️ دریافت خطای ۴۲۹ از مدل {model}؛ سوییچ فوری به مدل جایگزین بعدی...")
                time.sleep(1)
                continue
            else:
                print(f"  ⚠️ خطای HTTP {e.code} از {model}")
                continue
        except Exception as e:
            print(f"  ⚠️ خطا در ارتباط با {model}: {e}")
            continue

    return ""

call_deepseek = ask_deepseek
