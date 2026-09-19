#!/usr/bin/env python3
import time, json, urllib.request, urllib.parse

KEYS = {
    "Tavily_Key_1": ("tavily", "REDACTED_SECRET_06"),
    "Tavily_Key_2": ("tavily", "REDACTED_SECRET_25"),
    "Tavily_Key_3": ("tavily", "REDACTED_SECRET_26"),
    "Tavily_Key_4": ("tavily", "REDACTED_SECRET_27"),
    "Exa_AI":       ("exa",    "REDACTED_SECRET_08"),
    "Brave_Search": ("brave",  "REDACTED_SECRET_13"),
    "Jina_Search":  ("jina",   "REDACTED_SECRET_03"),
    "Firecrawl":    ("firecrawl", "REDACTED_SECRET_09")
}

results = []
valid_tavily = []
valid_others = {}

for name, (provider, key) in KEYS.items():
    start = time.time()
    status, reason = "FAILED", "Unknown"
    try:
        if provider == "tavily":
            url = "https://api.tavily.com/search"
            payload = json.dumps({"api_key": key, "query": "latest AI news 2026", "max_results": 1}).encode("utf-8")
            req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    status = "HEALTHY"
                    valid_tavily.append(key)

        elif provider == "exa":
            url = "https://api.exa.ai/search"
            payload = json.dumps({"query": "AI systems", "numResults": 1}).encode("utf-8")
            req = urllib.request.Request(url, data=payload, headers={"x-api-key": key, "Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    status = "HEALTHY"
                    valid_others["EXA_API_KEY"] = key

        elif provider == "brave":
            url = "https://api.search.brave.com/res/v1/web/search?q=test&count=1"
            req = urllib.request.Request(url, headers={"X-Subscription-Token": key, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    status = "HEALTHY"
                    valid_others["BRAVE_API_KEY"] = key

        elif provider == "jina":
            url = "https://s.jina.ai/test"
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    status = "HEALTHY"
                    valid_others["JINA_API_KEY"] = key

        elif provider == "firecrawl":
            url = "https://api.firecrawl.dev/v1/scrape"
            payload = json.dumps({"url": "https://example.com"}).encode("utf-8")
            req = urllib.request.Request(url, data=payload, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status in [200, 201]:
                    status = "HEALTHY"
                    valid_others["FIRECRAWL_API_KEY"] = key

    except urllib.error.HTTPError as e:
        reason = f"HTTP {e.code}"
    except Exception as e:
        reason = str(e)[:25]

    latency = int((time.time() - start) * 1000)
    results.append((name, status, f"{latency}ms", reason if status == "FAILED" else "OK"))

print("\n" + "="*65)
print(f"{'ارائه‌دهنده':<16} | {'وضعیت':<10} | {'تاخیر':<8} | {'جزئیات'}")
print("="*65)
for r in results:
    print(f"{r[0]:<16} | {r[1]:<10} | {r[2]:<8} | {r[3]}")
print("="*65 + "\n")

# به‌روزرسانی فایل .env صرفاً با کلیدهای موفق و پایدار
env_file = "/opt/roxira_platform/.env"
lines = [l for l in open(env_file).readlines() if not any(k in l for k in ["TAVILY_KEYS", "EXA_API_KEY", "BRAVE_API_KEY", "JINA_API_KEY", "FIRECRAWL_API_KEY"])]
if valid_tavily:
    lines.append(f'TAVILY_KEYS="{",".join(valid_tavily)}"\n')
for k, v in valid_others.items():
    lines.append(f'{k}="{v}"\n')

with open(env_file, "w") as f:
    f.writelines(lines)
print(f"✅ ممیزی تکمیل شد: تعداد {len(valid_tavily)} کلید Tavily و {len(valid_others)} ارائه‌دهنده تایید و ذخیره شدند.")
